import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { freePort } from '../tools/local-chain.mjs';

// These fixtures exercise browser UX, not an actual MetaMask extension or chain.
const port = await freePort(), url = `http://127.0.0.1:${port}`;
const python = process.env.PYTHON_BINARY || (process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
let browser, server;
const checks = [], errors = [];
try {
  server = spawn(python, ['tools/deploy_server.py', '--port', String(port)], { windowsHide: true, stdio: 'ignore' });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { const response = await fetch(`${url}/artifact`); await response.arrayBuffer(); if (response.ok) { ready = true; break; } }
    catch { /* Wait for the disposable server. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(ready, 'Helper server starts');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  async function fixture(mode) {
    const context = await browser.newContext();
    await context.addInitScript((input) => {
      const options = typeof input === 'object' ? input : { mode: input };
      const address = '0x1111111111111111111111111111111111111111';
      window.fixture = { mode: options.mode, calls: [], requests: [], accounts: options.authorized ? [address] : [], address,
        chain: options.chain || '0xaa36a7', listeners: {}, balance: '0xde0b6b3a7640000', switchError: options.switchError };
      window.fixture.emit = (name, value) => {
        if (name === 'accountsChanged') window.fixture.accounts = value;
        if (name === 'chainChanged') window.fixture.chain = value;
        for (const listener of window.fixture.listeners[name] || []) listener(value);
      };
      if (options.mode === 'missing') return;
      window.ethereum = { isMetaMask: true, on(name, listener) { (window.fixture.listeners[name] ||= []).push(listener); }, async request({ method, params }) {
        const f = window.fixture; f.calls.push(method); f.requests.push({ method, params });
        if (method === 'eth_accounts') return f.accounts;
        if (method === 'eth_chainId') return f.chain;
        if (method === 'eth_getBalance') {
          if (f.mode === 'balance-error') throw { code: -32603 };
          if (f.deferBalance) return new Promise((resolve) => { f.finishBalance = () => { f.deferBalance = false; resolve(f.balance); }; });
          return f.balance;
        }
        if (method === 'wallet_switchEthereumChain') {
          if (f.switchError) throw { code: f.switchError };
          return new Promise((resolve) => { f.approveSwitch = () => { f.emit('chainChanged', params[0].chainId); resolve(null); }; });
        }
        if (method === 'eth_requestAccounts') {
          if (f.mode === 'waiting') return new Promise((resolve) => { f.approve = () => { f.accounts = [f.address]; resolve(f.accounts); }; });
          if (typeof f.mode === 'number') throw { code: f.mode, message: 'Fixture text must not be sent to the diagnostic server' };
          if (f.mode === 'empty') return [];
          f.accounts = [f.address]; return f.accounts;
        }
        throw new Error(`Unexpected wallet method: ${method}`);
      } };
    }, mode);
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    await page.locator('#build').filter({ hasText: '0.8.30' }).waitFor();
    await page.locator('#wallet-status').filter({ hasText: mode === 'missing' ? 'not available' : mode?.authorized ? 'Account connected' : 'MetaMask detected' }).waitFor();
    assert.equal(await page.evaluate(() => window.fixture.calls.filter((method) => method === 'eth_requestAccounts').length), 0, 'No approval requested on load');
    return { context, page };
  }
  async function closeFixture({ context, page }) {
    const calls = await page.evaluate(() => window.fixture.calls);
    assert(calls.every((method) => ['eth_accounts', 'eth_chainId', 'eth_requestAccounts', 'eth_getBalance', 'wallet_switchEthereumChain'].includes(method)), 'Connection flow never signs or submits transactions');
    await context.close();
  }

  const pending = await fixture('waiting');
  await pending.page.clock.install();
  await pending.page.locator('#connect').click();
  await pending.page.locator('#wallet-status').filter({ hasText: 'Connection request sent' }).waitFor();
  assert(await pending.page.locator('#connect').isDisabled());
  await pending.page.clock.fastForward(8500);
  await pending.page.locator('#wallet-status').filter({ hasText: 'Still waiting for MetaMask' }).waitFor();
  // Even an explicitly dispatched extra click must not enqueue another request.
  await pending.page.locator('#connect').dispatchEvent('click');
  assert.equal(await pending.page.evaluate(() => window.fixture.calls.filter((method) => method === 'eth_requestAccounts').length), 1);
  await pending.page.evaluate(() => window.fixture.approve());
  await pending.page.waitForFunction(() => !document.getElementById('deploy').disabled);
  await pending.page.locator('#wallet-status').filter({ hasText: 'Account connected' }).waitFor();
  assert(await pending.page.locator('#connect').isDisabled());
  assert.equal(await pending.page.locator('#connect').innerText(), '✓ Connected');
  checks.push('Hidden or delayed approval remains visibly pending, prevents duplicate requests and accepts late approval');
  await closeFixture(pending);

  const existing = await fixture(-32002);
  await existing.page.locator('#connect').click();
  await existing.page.locator('#wallet-status').filter({ hasText: 'already has a connection request pending (-32002)' }).waitFor();
  assert(await existing.page.locator('#connect').isDisabled());
  await existing.page.waitForFunction(async () => {
    const report = await (await fetch('/connection-status')).json();
    return report.observations.some((item) => item.connectionState === 'pending' && item.errorCode === -32002);
  });
  await existing.page.evaluate(() => { window.fixture.accounts = [window.fixture.address]; });
  await existing.page.locator('#refresh-wallet').click();
  await existing.page.waitForFunction(() => !document.getElementById('deploy').disabled);
  assert(await existing.page.locator('#connect').isDisabled());
  assert.equal(await existing.page.locator('#connect').innerText(), '✓ Connected');
  assert.equal(await existing.page.evaluate(() => window.fixture.calls.filter((method) => method === 'eth_requestAccounts').length), 1);
  checks.push('Existing pending request is reported with -32002; Refresh balance recovers account access without another approval request');
  await closeFixture(existing);

  for (const [code, expected] of [[4001, 'Connection was declined'], [4200, 'method is unavailable'], [4900, 'cannot reach the requested network'], [-32603, 'connection request failed (-32603)']]) {
    const test = await fixture(code);
    await test.page.locator('#connect').click();
    await test.page.locator('#wallet-status').filter({ hasText: expected }).waitFor();
    assert(await test.page.locator('#connect').isEnabled());
    assert(await test.page.locator('#deploy').isDisabled());
    checks.push(`Wallet error ${code} produces actionable connection feedback and does not enable deployment`);
    await closeFixture(test);
  }
  const empty = await fixture('empty');
  await empty.page.locator('#connect').click();
  await empty.page.locator('#wallet-status').filter({ hasText: 'returned no account' }).waitFor();
  assert(await empty.page.locator('#deploy').isDisabled());
  checks.push('An empty account response is not presented as connected');
  await closeFixture(empty);

  const balance = await fixture('balance-error');
  await balance.page.locator('#connect').click();
  await balance.page.locator('#wallet-status').filter({ hasText: 'balance could not be read' }).waitFor();
  assert.equal(await balance.page.locator('#account').innerText(), '0x1111111111111111111111111111111111111111');
  assert(await balance.page.locator('#deploy').isDisabled());
  checks.push('Balance RPC failure preserves the connected account and keeps deployment disabled');
  await closeFixture(balance);

  const missing = await fixture('missing');
  await missing.page.locator('#connect').click();
  assert.equal(await missing.page.evaluate(() => window.fixture.calls.length), 0);
  checks.push('Missing wallet explains the browser requirement without a fake connection or signature');
  await closeFixture(missing);

  const connected = await fixture({ mode: 'normal', authorized: true });
  await connected.page.waitForFunction(() => !document.getElementById('deploy').disabled);
  assert.equal(await connected.page.locator('#connect').innerText(), '✓ Connected');
  assert(await connected.page.locator('#connect').isDisabled());
  assert.equal(await connected.page.locator('#switch').innerText(), '✓ Sepolia active');
  assert(await connected.page.locator('#switch').isDisabled());
  await connected.page.locator('#switch').dispatchEvent('click');
  assert.equal(await connected.page.evaluate(() => window.fixture.calls.filter((method) => method === 'wallet_switchEthereumChain').length), 0);
  await connected.page.evaluate(() => { window.fixture.deferBalance = true; window.fixture.balance = '0x1bc16d674ec80000'; });
  await connected.page.locator('#refresh-wallet').click();
  await connected.page.waitForFunction(() => Boolean(window.fixture.finishBalance));
  assert.equal(await connected.page.locator('#refresh-wallet').innerText(), 'Refreshing…');
  assert.equal(await connected.page.locator('#balance-panel').getAttribute('aria-busy'), 'true');
  assert(await connected.page.locator('#refresh-wallet').isDisabled());
  await connected.page.evaluate(() => window.fixture.finishBalance());
  await connected.page.locator('#balance').filter({ hasText: '2.0 Sepolia ETH' }).waitFor();
  await connected.page.locator('#balance-status').filter({ hasText: 'Updated at' }).waitFor();
  assert.equal(await connected.page.locator('#balance-panel #refresh-wallet').count(), 1);
  await connected.page.screenshot({ path: 'docs/evidence/screenshots/setup-controls-desktop.png', fullPage: true });
  await connected.page.setViewportSize({ width: 390, height: 844 });
  assert(await connected.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await connected.page.locator('#connect').scrollIntoViewIfNeeded();
  await connected.page.screenshot({ path: 'docs/evidence/screenshots/setup-controls-mobile.png' });
  await connected.page.evaluate(() => window.fixture.emit('accountsChanged', []));
  await connected.page.locator('#connect').filter({ hasText: 'Connect MetaMask' }).waitFor();
  assert(await connected.page.locator('#connect').isEnabled());
  assert(await connected.page.locator('#deploy').isDisabled());
  checks.push('Authorized account shows Connected; balance refresh has visible progress and timestamp beside the amount; disconnect restores Connect; mobile layout fits');
  await closeFixture(connected);

  const switchFlow = await fixture({ mode: 'normal', authorized: true, chain: '0x1' });
  assert(await switchFlow.page.locator('#switch').isEnabled());
  await switchFlow.page.locator('#switch').click();
  await switchFlow.page.locator('#network-status').filter({ hasText: 'Network change requested' }).waitFor();
  assert(await switchFlow.page.locator('#switch').isDisabled());
  assert(await switchFlow.page.locator('#deploy').isDisabled());
  await switchFlow.page.locator('#switch').dispatchEvent('click');
  assert.deepEqual(await switchFlow.page.evaluate(() => window.fixture.requests.filter((request) => request.method === 'wallet_switchEthereumChain')),
    [{ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xaa36a7' }] }]);
  await switchFlow.page.evaluate(() => window.fixture.approveSwitch());
  await switchFlow.page.locator('#switch').filter({ hasText: 'Sepolia active' }).waitFor();
  await switchFlow.page.waitForFunction(() => !document.getElementById('deploy').disabled);
  checks.push('Wrong-network action sends the exact Sepolia switch request, blocks duplicates, verifies the returned chain and shows Sepolia active');
  await closeFixture(switchFlow);

  for (const [code, expected] of [[4001, 'Network change declined'], [4902, 'does not recognize Sepolia'], [-32002, 'already pending']]) {
    const networkError = await fixture({ mode: 'normal', authorized: true, chain: '0x1', switchError: code });
    await networkError.page.locator('#switch').click();
    await networkError.page.locator('#network-status').filter({ hasText: expected }).waitFor();
    assert(await networkError.page.locator('#deploy').isDisabled());
    assert.equal(await networkError.page.locator('#switch').isDisabled(), code === -32002);
    if (code === -32002) {
      await networkError.page.evaluate(() => window.fixture.emit('chainChanged', '0xaa36a7'));
      await networkError.page.locator('#switch').filter({ hasText: 'Sepolia active' }).waitFor();
    }
    checks.push(`Network-switch error ${code} is visible near Network and cannot falsely enable deployment`);
    await closeFixture(networkError);
  }
  assert.deepEqual(errors, []);
  const evidence = { recordedAt: new Date().toISOString(), result: 'Passed', publicNetwork: false,
    environment: 'Isolated headless Chrome with injected EIP-1193 fixtures and a disposable loopback Flask helper. NOT actual MetaMask or the user’s in-app browser.', checks };
  await writeFile('docs/evidence/wallet-connection-browser.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
}
