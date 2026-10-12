import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

// Isolated injected-wallet cases. No personal profile, MetaMask or public write is used.
const artifact = JSON.parse(await readFile('build/FreelancePay.json', 'utf8'));
const html = (await readFile('templates/index.html', 'utf8'))
  .replace("{{ url_for('static', filename='app.css') }}", '/static/app.css')
  .replace("{{ url_for('static', filename='app.js') }}", '/static/app.js');
const account = '0x0000000000000000000000000000000000000001';
const otherAccount = '0x0000000000000000000000000000000000000002';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks = [], pageErrors = [];
const config = { configured: true, chainId: '11155111', networkName: 'Ethereum Sepolia',
  contractAddress: '0x0000000000000000000000000000000000000003', explorerUrl: '', abi: artifact.abi };
async function createCase(options = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
  await context.route('http://wallet-recovery.test/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: html });
    if (path.startsWith('/static/')) return route.fulfill({ contentType: path.endsWith('.css') ? 'text/css' : 'application/javascript', body: await readFile('.' + path) });
    const body = path === '/api/config' ? config : path === '/api/health' ? { status: 'ready' }
      : { items: [], total: '0', offset: '0', observedBlock: '1' };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await context.addInitScript(({ options, account, otherAccount }) => {
    const listeners = new Map();
    const driver = { authorized: false, account, calls: [], requestHold: false, requestError: null,
      holdChain: false, holdBalance: false, holdSwitch: false, revokeError: false, ...options,
      emit(name, value) { for (const callback of listeners.get(name) || []) callback(value); },
      approveWithEvent() { this.authorized = true; this.emit('accountsChanged', [this.account]); } };
    window.__recoveryWallet = driver;
    if (options.noWallet) return;
    const wallet = { isMetaMask: true,
      on(name, callback) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(callback); },
      async request({ method }) {
        driver.calls.push(method);
        if (method === 'eth_requestAccounts') {
          if (driver.requestError) throw { code: driver.requestError };
          if (driver.requestHold) await new Promise((resolve, reject) => { driver.resolveConnect = resolve; driver.rejectConnect = reject; });
          driver.authorized = true; return [driver.account];
        }
        if (method === 'eth_accounts') return driver.authorized ? [driver.account] : [];
        if (method === 'eth_chainId') { if (driver.holdChain) return new Promise(() => {}); return '0xaa36a7'; }
        if (method === 'eth_getBalance') { if (driver.holdBalance) return new Promise(() => {}); return '0x2386f26fc10000'; }
        if (method === 'wallet_requestPermissions') {
          if (driver.holdSwitch) await new Promise(resolve => { driver.resolveSwitch = resolve; });
          driver.account = otherAccount; driver.emit('accountsChanged', [otherAccount]); return [{ parentCapability: 'eth_accounts' }];
        }
        if (method === 'wallet_revokePermissions') {
          if (driver.revokeError) throw { code: 4200 };
          driver.authorized = false; driver.emit('accountsChanged', []); return null;
        }
        throw new Error('Unexpected wallet method: ' + method);
      } };
    window.ethereum = wallet;
    window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider',
      { detail: { info: { rdns: 'io.metamask' }, provider: wallet } })));
  }, { options, account, otherAccount });
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.clock.install();
  await page.goto('http://wallet-recovery.test/');
  await page.locator('#notice').filter({ hasText: 'Connect MetaMask' }).waitFor();
  return { context, page };
}
const connected = async page => {
  await page.locator('#connect').filter({ hasText: 'Connected' }).waitFor();
  await page.waitForFunction(() => !document.getElementById('switch-account').disabled);
  assert.equal(await page.locator('#account').innerText(), account);
};
try {
  await mkdir('docs/evidence/screenshots', { recursive: true });
  {
    const { context, page } = await createCase({ requestHold: true });
    await page.locator('#connect').click();
    await page.waitForFunction(() => Boolean(window.__recoveryWallet.rejectConnect));
    await page.evaluate(() => document.getElementById('connect').click());
    await page.clock.fastForward(8100);
    await page.locator('#wallet-status').filter({ hasText: 'Still waiting' }).waitFor();
    assert(await page.locator('#check-connection').isEnabled());
    await page.locator('#check-connection').click();
    await page.locator('#wallet-status').filter({ hasText: 'has not allowed an account' }).waitFor();
    assert(await page.locator('#connect').isDisabled());
    await page.screenshot({ path: 'docs/evidence/screenshots/wallet-recovery-pending-fixture.png', fullPage: true });
    assert.equal(await page.evaluate(() => window.__recoveryWallet.calls.filter(x => x === 'eth_requestAccounts').length), 1);
    checks.push('Unanswered approval has visible guidance; duplicate clicks and empty read checks do not create another approval or claim a connection');
    await page.evaluate(() => { window.__recoveryWallet.authorized = true; });
    await page.locator('#check-connection').click();
    await connected(page);
    assert.equal(await page.evaluate(() => window.__recoveryWallet.calls.filter(x => x === 'eth_requestAccounts').length), 1);
    assert.equal(await page.evaluate(() => window.__recoveryWallet.calls.some(x => x === 'eth_sendTransaction')), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: 'docs/evidence/screenshots/wallet-recovery-connected-fixture.png', fullPage: true });
    checks.push('Previously approved eth_accounts recovers a hung approval with validated network and connected controls, no repeated permission request or transaction; 390px has no overflow');
    await page.evaluate(() => { window.__recoveryWallet.holdSwitch = true; });
    await page.locator('#switch-account').click();
    await page.waitForFunction(() => Boolean(window.__recoveryWallet.resolveSwitch));
    await page.evaluate(() => window.__recoveryWallet.rejectConnect({ code: 4001 }));
    assert(await page.locator('#switch-account').isDisabled());
    await page.evaluate(() => window.__recoveryWallet.resolveSwitch());
    await page.waitForFunction(() => !document.getElementById('switch-account').disabled);
    assert.equal(await page.locator('#account').innerText(), otherAccount);
    checks.push('Late rejection from a recovered approval cannot clear a newer account-selection operation');
    await context.close();
  }
  {
    const { context, page } = await createCase({ requestHold: true });
    await page.locator('#connect').click();
    await page.evaluate(() => window.__recoveryWallet.approveWithEvent());
    await connected(page);
    checks.push('An actual exposed-account event releases the connection controls even if the original approval promise remains unresolved');
    await context.close();
  }
  {
    const { context, page } = await createCase({ requestError: -32002 });
    await page.locator('#connect').click();
    await page.locator('#wallet-status').filter({ hasText: 'already waiting' }).waitFor();
    assert(await page.locator('#connect').isDisabled());
    await page.evaluate(() => { window.__recoveryWallet.authorized = true; });
    await page.locator('#check-connection').click();
    await connected(page);
    assert.equal(await page.evaluate(() => window.__recoveryWallet.calls.filter(x => x === 'eth_requestAccounts').length), 1);
    checks.push('MetaMask -32002 remains pending with no duplicate permission request and recovers through a permission read after approval');
    await context.close();
  }
  {
    const { context, page } = await createCase();
    await page.evaluate(() => { window.__recoveryWallet.holdChain = true; });
    await page.locator('#connect').click();
    await page.waitForFunction(() => window.__recoveryWallet.calls.includes('eth_requestAccounts'));
    await page.clock.fastForward(10010);
    await page.locator('#wallet-status').filter({ hasText: 'did not answer the wallet read' }).waitFor();
    await page.waitForFunction(() => !document.getElementById('connect').disabled);
    assert.equal(await page.locator('#account').innerText(), 'Wallet not connected');
    await page.evaluate(() => { window.__recoveryWallet.holdChain = false; });
    await page.locator('#check-connection').click();
    await connected(page);
    checks.push('Hung account/network read ends within ten seconds and recovers via a read; approval is never timed out or automatically retried');
    await page.evaluate(() => { window.__recoveryWallet.holdBalance = true; });
    await page.locator('#refresh-balance').click();
    await page.clock.fastForward(10010);
    await page.locator('#balance-value').filter({ hasText: 'Unavailable' }).waitFor();
    assert((await page.locator('#connect').innerText()).includes('Connected'));
    await page.evaluate(() => { window.__recoveryWallet.holdBalance = false; });
    await page.locator('#refresh-balance').click();
    await page.locator('#balance-status').filter({ hasText: 'Balance updated' }).waitFor();
    checks.push('Hung balance read preserves the connection, unlocks refresh and permits read-only recovery');
    await page.evaluate(() => { window.__recoveryWallet.revokeError = true; });
    await page.locator('#disconnect').click();
    await page.locator('#wallet-status').filter({ hasText: 'Disconnected from this app' }).waitFor();
    await page.locator('#check-connection').click();
    await page.locator('#wallet-status').filter({ hasText: 'You disconnected' }).waitFor();
    assert.equal(await page.locator('#account').innerText(), 'Wallet not connected');
    checks.push('A read check does not undo an explicit local disconnect when MetaMask permission remains');
    await context.close();
  }
  for (const options of [{ requestError: 4001 }, { noWallet: true }]) {
    const { context, page } = await createCase(options);
    await page.locator('#connect').click();
    await page.locator('#wallet-status').filter({ hasText: options.noWallet ? 'not detected' : 'cancelled' }).waitFor();
    assert(await page.locator('#connect').isEnabled());
    await context.close();
  }
  checks.push('Declined approval and absent provider restore Connect with explicit feedback');
  assert.deepEqual(pageErrors, []);
  const record = { recordedAtUtc: new Date().toISOString(), result: 'Passed', checks, pageErrors,
    scope: 'Isolated Chrome with injected EIP-6963 wallet and HTTP fixtures. These results verify application recovery; actual in-app-browser MetaMask approval/connection remains unverified.' };
  await writeFile('docs/evidence/wallet-connection-recovery.json', JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify({ result: record.result, checks: checks.length, scope: record.scope }));
} finally { await browser.close(); }
