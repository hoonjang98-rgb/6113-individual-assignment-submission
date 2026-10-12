import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { ContractFactory, JsonRpcProvider } from 'ethers';
import { startLocalChain, freePort } from '../tools/local-chain.mjs';

const artifact = JSON.parse(await readFile('build/FreelancePay.json', 'utf8'));
const chain = await startLocalChain(await freePort());
const provider = new JsonRpcProvider(chain.url);
let server, browser;
const checks = [], errors = [];
const passed = (name) => checks.push(name);
async function until(check, label, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await check()) return; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error(`Timed out: ${label}`);
}
try {
  const accounts = await chain.rpc('eth_accounts', []);
  const contract = await new ContractFactory(artifact.abi, artifact.bytecode, await provider.getSigner(0)).deploy();
  await contract.waitForDeployment();
  const port = await freePort(), url = `http://127.0.0.1:${port}`;
  const python = process.env.PYTHON_BINARY || (process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
  server = spawn(python, ['app.py'], { windowsHide: true, stdio: 'ignore', env: { ...process.env, PORT: String(port), CHAIN_ID: '31337', RPC_URL: chain.url, CONTRACT_ADDRESS: contract.target } });
  await until(async () => { try { return (await fetch(`${url}/api/health`)).ok; } catch { return false; } }, 'Flask readiness');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, timezoneId: 'UTC' });
  await context.exposeBinding('__testRpc', (_, { method, params }) => chain.rpc(method, params || []));
  await context.addInitScript(({ accounts }) => {
    const listeners = new Map();
    const driver = { account: accounts[Number(sessionStorage.getItem('test-wallet-account') || 0)], chain: '0x7a69', authorized: sessionStorage.getItem('test-wallet-authorized') === 'true', permissionRequests: 0,
      switchTo: 0, permissionError: null, revokeError: null, holdPermissions: false, holdNextBalance: false, balanceError: false,
      walletCalls: [], rejectNext: false, changeNetworkAfterSend: false, sent: [],
      emit(name, value) { for (const callback of listeners.get(name) || []) callback(value); },
      select(index) { this.account = accounts[index]; sessionStorage.setItem('test-wallet-account', String(index)); this.emit('accountsChanged', this.authorized ? [this.account] : []); },
      network(chain) { this.chain = chain; this.emit('chainChanged', chain); } };
    window.__walletTest = driver;
    const wallet = { isMetaMask: true,
      on(name, callback) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(callback); },
      removeListener(name, callback) { listeners.set(name, (listeners.get(name) || []).filter((item) => item !== callback)); },
      async request({ method, params }) {
        driver.walletCalls.push({ method, params });
        if (method === 'eth_requestAccounts') {
          driver.permissionRequests++; driver.authorized = true; sessionStorage.setItem('test-wallet-authorized', 'true'); return [driver.account];
        }
        if (method === 'eth_accounts') return driver.authorized ? [driver.account] : [];
        if (method === 'eth_chainId') return driver.chain;
        if (method === 'wallet_requestPermissions') {
          driver.permissionRequests++;
          if (driver.permissionError) { const code = driver.permissionError; driver.permissionError = null; throw Object.assign(new Error('Test permission error'), { code }); }
          if (driver.holdPermissions) await new Promise(resolve => { driver.finishSelection = () => { driver.holdPermissions = false; resolve(); }; });
          driver.select(driver.switchTo);
          return [{ parentCapability: 'eth_accounts' }];
        }
        if (method === 'wallet_revokePermissions') {
          if (driver.revokeError) throw Object.assign(new Error('Test revoke error'), { code: driver.revokeError });
          driver.authorized = false; sessionStorage.setItem('test-wallet-authorized', 'false'); driver.emit('accountsChanged', []); return null;
        }
        if (method === 'eth_getBalance') {
          if (driver.balanceError) { driver.balanceError = false; throw new Error('Test balance unavailable'); }
          if (driver.holdNextBalance) await new Promise(resolve => { driver.finishBalance = () => { driver.holdNextBalance = false; resolve(); }; });
        }
        if (method === 'wallet_switchEthereumChain') { driver.network(params[0].chainId); return null; }
        if (method === 'eth_sendTransaction' && driver.rejectNext) { driver.rejectNext = false; throw Object.assign(new Error('User rejected request'), { code: 4001 }); }
        const result = await window.__testRpc({ method, params });
        if (method === 'eth_sendTransaction') {
          driver.sent.push(params[0]);
          if (driver.changeNetworkAfterSend) { driver.changeNetworkAfterSend = false; driver.network('0x1'); }
        }
        return result;
      } };
    window.ethereum = wallet;
    window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { rdns: 'io.metamask' }, provider: wallet } })));
  }, { accounts });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await page.locator('#notice').filter({ hasText: 'Connect MetaMask' }).waitFor();
  await mkdir('docs/evidence/screenshots', { recursive: true });
  await page.screenshot({ path: 'docs/evidence/screenshots/app-local-disconnected.png', fullPage: true });
  await page.locator('#connect').click();
  await until(() => page.locator('#new-invoice').isEnabled(), 'Connected account');
  assert((await page.locator('#connect').innerText()).includes('Connected'));
  assert(await page.locator('#connect').isDisabled());
  passed('Injected EIP-6963 test-provider connection and real Flask health');

  await page.locator('#switch-account').click();
  await page.locator('#wallet-status').filter({ hasText: 'same account' }).waitFor();
  assert.deepEqual((await page.evaluate(() => window.__walletTest.walletCalls.filter(call => call.method === 'wallet_requestPermissions').at(-1))).params, [{ eth_accounts: {} }]);
  for (const [code, text] of [[4001, 'cancelled'], [-32002, 'already waiting'], [4200, 'cannot open account selection']]) {
    await page.evaluate(code => { window.__walletTest.permissionError = code; }, code);
    await page.locator('#switch-account').click();
    await page.locator('#wallet-status').filter({ hasText: text }).waitFor();
    assert((await page.locator('#account').innerText()).toLowerCase() === accounts[0].toLowerCase());
    assert(await page.locator('#new-invoice').isEnabled());
  }
  passed('Account reselection uses wallet_requestPermissions; same-account, declined, pending and unsupported results are explicit and preserve the connection');
  const requestsBefore = await page.evaluate(() => window.__walletTest.permissionRequests);
  await page.evaluate(() => { window.__walletTest.holdPermissions = true; window.__walletTest.switchTo = 1; });
  await page.locator('#switch-account').click();
  await until(() => page.evaluate(() => Boolean(window.__walletTest.finishSelection)), 'Account-selection prompt pending');
  assert(await page.locator('#new-invoice').isDisabled());
  assert(await page.locator('#disconnect').isDisabled());
  await page.evaluate(() => document.getElementById('switch-account').click());
  assert.equal(await page.evaluate(() => window.__walletTest.permissionRequests), requestsBefore + 1);
  await page.evaluate(() => window.__walletTest.finishSelection());
  await until(() => page.locator('#switch-account').isEnabled(), 'Account selection completes');
  assert.equal((await page.locator('#account').innerText()).toLowerCase(), accounts[1].toLowerCase());
  assert.equal(await page.evaluate(() => window.__walletTest.sent.length), 0);
  await page.evaluate(() => { window.__walletTest.switchTo = 0; });
  await page.locator('#switch-account').click();
  await until(() => page.locator('#new-invoice').isEnabled(), 'Issuer reselected');
  passed('Pending account selection disables conflicting controls, ignores duplicate clicks and never submits a transaction');
  await until(() => page.locator('#refresh-balance').isEnabled(), 'Initial balance loaded');
  await page.evaluate(() => { window.__walletTest.balanceError = true; });
  await page.locator('#refresh-balance').click();
  await page.locator('#balance-value').filter({ hasText: 'Unavailable' }).waitFor();
  assert((await page.locator('#connect').innerText()).includes('Connected'));
  await page.locator('#refresh-balance').click();
  await page.locator('#balance-status').filter({ hasText: 'Balance updated at' }).waitFor();
  passed('Balance read failure preserves the wallet connection and explicit refresh visibly recovers');

  const create = async (reference, amount = '0.000000000000000001') => {
    await page.locator('#new-invoice').click();
    await page.locator('#reference').fill(reference);
    await page.locator('#client').fill(accounts[1]);
    await page.locator('#amount').fill(amount);
    await page.locator('#review-invoice').click();
    await page.locator('#confirm-invoice').waitFor({ state: 'visible' });
  };
  const finishCreate = async (number) => {
    await page.locator('#confirm-invoice').click();
    await until(async () => await contract.invoiceCount() === BigInt(number), 'Created invoice');
    await page.locator('#tx-title').filter({ hasText: 'Transaction confirmed' }).waitFor();
    await until(() => page.locator('#new-invoice').isEnabled(), 'Write completes');
  };
  await create('INV-001');
  assert((await page.locator('#review').innerText()).includes('0.000000000000000001 ETH'));
  await finishCreate(1);
  passed('Review, exact one-wei invoice creation, receipt and state confirmation');
  await page.evaluate(() => { window.__walletTest.switchTo = 1; });
  await page.getByRole('button', { name: 'Switch to client wallet', exact: true }).click();
  await page.locator('#account').filter({ hasText: accounts[1].slice(2, 8) }).waitFor();
  await until(() => page.locator('#switch-account').isEnabled(), 'Invoice handoff completes');
  assert.equal(await page.locator('#received').getAttribute('aria-pressed'), 'true');
  await page.locator('#detail-title').filter({ hasText: 'INV-001' }).waitFor();
  passed('Switch to client wallet selects received invoices and reopens the exact invoice without sending payment');
  await page.getByRole('button', { name: 'Review payment · 0.000000000000000001 ETH', exact: true }).click();
  const before = BigInt(await chain.rpc('eth_getBalance', [accounts[0], 'latest']));
  await page.locator('#confirm-action').click();
  await until(async () => (await contract.getInvoice(1)).status === 1n, 'Paid invoice');
  await page.locator('#tx-title').filter({ hasText: 'Transaction confirmed' }).waitFor();
  await page.locator('#history').filter({ hasText: 'Invoice Paid' }).waitFor();
  assert.equal(BigInt(await chain.rpc('eth_getBalance', [accounts[0], 'latest'])) - before, 1n);
  assert.equal(await page.getByRole('button', { name: /Review payment|Cancel unpaid invoice/ }).count(), 0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'docs/evidence/screenshots/app-local-paid-desktop.png', fullPage: true });
  passed('Client account switch, exact payment, issuer balance increase, paid-state controls and real event history');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'docs/evidence/screenshots/app-local-paid-mobile.png', fullPage: true });
  passed('390px viewport has no horizontal overflow');
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.evaluate(() => { window.__walletTest.switchTo = 0; });
  await page.getByRole('button', { name: 'Switch to issuer wallet', exact: true }).click();
  await until(() => page.locator('#switch-account').isEnabled(), 'Issuer handoff completes');
  assert.equal(await page.locator('#issued').getAttribute('aria-pressed'), 'true');
  assert.equal((await page.locator('#account').innerText()).toLowerCase(), accounts[0].toLowerCase());
  assert((await page.locator('#detail-content').innerText()).includes('Paid'));
  passed('Switch to issuer wallet reopens the same Paid invoice in the issuer view');
  await page.evaluate(() => window.__walletTest.network('0x1'));
  await page.locator('#switch').waitFor({ state: 'visible' });
  assert(await page.locator('#new-invoice').isDisabled());
  await page.locator('#switch').click();
  await until(() => page.locator('#new-invoice').isEnabled(), 'Network restored');
  passed('Wrong network disables writes and explicit switch recovers');

  await page.evaluate(() => window.__walletTest.select(0));
  await page.locator('#issued').click();
  await until(() => page.locator('#new-invoice').isEnabled(), 'Issuer restored');
  await page.locator('#new-invoice').click();
  await page.locator('#reference').fill('INV-002'); await page.locator('#client').fill(accounts[1]); await page.locator('#amount').fill('1e-3');
  await page.locator('#review-invoice').click();
  await page.locator('#form-error').filter({ hasText: 'plain decimal' }).waitFor();
  assert(await page.locator('#confirm-invoice').isHidden());
  await page.locator('#amount').fill('0'); await page.locator('#review-invoice').click();
  await page.locator('#form-error').filter({ hasText: 'positive amount' }).waitFor();
  await page.locator('#client').fill(accounts[0]); await page.locator('#amount').fill('0.001'); await page.locator('#review-invoice').click();
  await page.locator('#form-error').filter({ hasText: 'different' }).waitFor();
  await page.locator('#close-create').click();
  passed('UI rejects exponent, zero amount and self-client before wallet submission');

  await create('DECLINED');
  await page.evaluate(() => { window.__walletTest.rejectNext = true; });
  await page.locator('#confirm-invoice').click();
  await page.locator('#tx-description').filter({ hasText: 'declined' }).waitFor();
  assert.equal(await contract.invoiceCount(), 1n);
  await until(() => page.locator('#new-invoice').isEnabled(), 'Declined request unlocked');
  passed('Wallet rejection does not create an invoice or a false success');

  await create('<b>PUBLIC</b>'); await finishCreate(2);
  assert.equal(await page.locator('#invoice-list b').count(), 0);
  await page.getByRole('button', { name: 'Open invoice 2, <b>PUBLIC</b>, Pending', exact: true }).click();
  assert.equal(await page.locator('#detail-title b').count(), 0);
  await page.getByRole('button', { name: 'Cancel unpaid invoice', exact: true }).click(); await page.locator('#confirm-action').click();
  await until(async () => (await contract.getInvoice(2)).status === 2n, 'Cancelled invoice');
  await page.locator('#history').filter({ hasText: 'Invoice Cancelled' }).waitFor();
  await until(() => page.locator('#new-invoice').isEnabled(), 'Cancellation complete');
  passed('Public reference is text, issuer cancellation is confirmed, terminal controls removed');

  await create('RECOVER');
  await chain.rpc('evm_setAutomine', [false]);
  await page.locator('#confirm-invoice').click();
  await page.locator('#tx-title').filter({ hasText: 'Awaiting confirmation' }).waitFor();
  const hash = await page.locator('#tx-link').innerText();
  assert.match(hash, /^0x[0-9a-f]{64}$/i);
  await page.reload();
  await page.locator('#tx-title').filter({ hasText: 'Awaiting confirmation' }).waitFor();
  assert.equal(await page.locator('#tx-link').innerText(), hash);
  await page.locator('#connect').filter({ hasText: 'Connected' }).waitFor();
  assert.equal(await page.evaluate(() => window.__walletTest.permissionRequests), 0);
  passed('Reload restores an already-authorized wallet and Connected label without another account permission prompt');
  await page.locator('#disconnect').click();
  await page.locator('#wallet-status').filter({ hasText: 'permission revoked' }).waitFor();
  assert.equal(await page.locator('#tx-link').innerText(), hash);
  assert(await page.locator('#new-invoice').isDisabled());
  const revokeCall = await page.evaluate(() => window.__walletTest.walletCalls.find(call => call.method === 'wallet_revokePermissions'));
  assert.deepEqual(revokeCall.params, [{ eth_accounts: {} }]);
  await page.reload();
  await page.locator('#notice').filter({ hasText: 'Disconnected from FreelancePay' }).waitFor();
  assert.equal(await page.locator('#account').innerText(), 'Wallet not connected');
  assert.equal(await page.locator('#tx-link').innerText(), hash);
  await page.locator('#connect').click();
  await page.locator('#connect').filter({ hasText: 'Connected' }).waitFor();
  passed('Disconnect revokes site permission, survives reload and preserves the submitted hash for explicit reconnect and recovery');
  await chain.rpc('evm_mine', []); await chain.rpc('evm_setAutomine', [true]);
  await page.locator('#check-transaction').click();
  await page.locator('#tx-title').filter({ hasText: 'Transaction confirmed' }).waitFor();
  assert.equal(await contract.invoiceCount(), 3n);
  passed('Pending transaction survives reload and is confirmed from the receipt without resending');

  await until(() => page.locator('#new-invoice').isEnabled(), 'Existing account permission restored after reload');
  assert((await page.locator('#connect').innerText()).includes('Connected'));
  await create('NETWORK-CHANGE');
  await page.evaluate(() => { window.__walletTest.changeNetworkAfterSend = true; });
  await page.locator('#confirm-invoice').click();
  await until(async () => await contract.invoiceCount() === 4n, 'Transaction sent before network change');
  await page.locator('#tx-title').filter({ hasText: 'Transaction confirmed' }).waitFor();
  assert.match(await page.locator('#tx-link').innerText(), /^0x[0-9a-f]{64}$/i);
  assert((await page.locator('#tx-origin').innerText()).includes('Local test network'));
  await page.locator('#switch').waitFor({ state: 'visible' });
  assert(await page.locator('#new-invoice').isDisabled());
  const sent = await page.evaluate(() => window.__walletTest.sent);
  assert.equal(BigInt(sent[0].chainId), 31337n);
  passed('Network change immediately after wallet submission preserves the hash, original chain and backend-verified receipt');
  await page.locator('#switch').click();
  await until(() => page.locator('#new-invoice').isEnabled(), 'Network change recovery');

  await create('STALE-NETWORK');
  await page.evaluate(() => { window.__walletTest.chain = '0x1'; });
  await page.locator('#confirm-invoice').click();
  await page.locator('#tx-title').filter({ hasText: 'Request not completed' }).waitFor();
  assert.equal(await contract.invoiceCount(), 4n);
  assert.equal(await page.evaluate(() => window.__walletTest.sent.length), 1);
  passed('Unexpected wallet chain is rejected before submission even when no chainChanged event arrives');

  await page.route('**/api/health', route => route.fulfill({ status: 503, contentType: 'application/json',
    body: JSON.stringify({ error: { message: 'Test RPC unavailable.' } }) }));
  await page.reload();
  await page.locator('#connect').filter({ hasText: 'Connected' }).waitFor();
  await page.locator('#page-info').filter({ hasText: 'Block' }).waitFor();
  assert((await page.locator('#notice').innerText()).includes('Test RPC unavailable.'), 'Restored account must not hide an unsuccessful network check');
  assert(await page.locator('#new-invoice').isDisabled());
  await page.unroute('**/api/health');
  await page.locator('#refresh').click();
  await until(() => page.locator('#new-invoice').isEnabled(), 'Successful health retry enables writes');
  assert((await page.locator('#notice').innerText()).includes('Your wallet is connected.'));
  assert.equal(await contract.invoiceCount(), 4n);
  assert.equal(await page.evaluate(() => window.__walletTest.sent.length), 0);
  passed('Restored wallet cannot hide RPC health failure; explicit successful refresh clears the error and restores controls without submitting a transaction');

  await create('STALE-REVIEW');
  await page.evaluate(() => window.__walletTest.select(1));
  await page.locator('#account').filter({ hasText: accounts[1].slice(2, 8) }).waitFor();
  assert.equal(await page.locator('#create-dialog').evaluate(dialog => dialog.open), false);
  assert(await page.locator('#confirm-invoice').isHidden());
  await page.locator('#received').click();
  await page.getByRole('button', { name: 'Open invoice 4, NETWORK-CHANGE, Pending', exact: true }).click();
  await page.getByRole('button', { name: 'Review payment · 0.000000000000000001 ETH', exact: true }).click();
  await page.evaluate(() => window.__walletTest.select(0));
  await page.locator('#account').filter({ hasText: accounts[0].slice(2, 8) }).waitFor();
  assert.equal(await page.locator('#action-dialog').evaluate(dialog => dialog.open), false);
  assert.equal(await contract.invoiceCount(), 4n);
  assert.equal(await page.evaluate(() => window.__walletTest.sent.length), 0);
  passed('Account changes close stale creation and payment reviews without submitting an old action');

  await until(() => page.locator('#refresh-balance').isEnabled(), 'Balance idle before disconnect');
  await page.evaluate(() => { window.__walletTest.revokeError = 4200; window.__walletTest.holdNextBalance = true; });
  await page.locator('#refresh-balance').click();
  await until(() => page.evaluate(() => Boolean(window.__walletTest.finishBalance)), 'Delayed balance request started');
  await page.locator('#disconnect').click();
  await page.locator('#wallet-status').filter({ hasText: 'could not revoke' }).waitFor();
  await page.evaluate(() => { window.__walletTest.finishBalance(); window.__walletTest.select(1); });
  assert.equal(await page.locator('#account').innerText(), 'Wallet not connected');
  assert(await page.locator('#wallet-balance').isHidden());
  assert(await page.locator('#detail').isHidden());
  await page.reload();
  await page.locator('#notice').filter({ hasText: 'Disconnected from FreelancePay' }).waitFor();
  assert.equal(await page.locator('#account').innerText(), 'Wallet not connected');
  assert.equal(await page.evaluate(() => window.__walletTest.authorized), true);
  await page.locator('#connect').click();
  await until(() => page.locator('#new-invoice').isEnabled(), 'Explicit reconnect after local disconnect');
  assert.equal((await page.locator('#account').innerText()).toLowerCase(), accounts[1].toLowerCase());
  passed('Unsupported revocation leaves explicit local disconnection; late balance/account responses and reload cannot silently reconnect');

  const secondPage = await context.newPage();
  await secondPage.goto(url);
  await secondPage.locator('#connect').click();
  await secondPage.locator('#connect').filter({ hasText: 'Connected' }).waitFor();
  await secondPage.locator('#disconnect').click();
  await page.locator('#wallet-status').filter({ hasText: 'another tab' }).waitFor();
  assert.equal(await page.locator('#account').innerText(), 'Wallet not connected');
  assert(await page.locator('#new-invoice').isDisabled());
  await secondPage.close();
  passed('Disconnect in another tab immediately clears this tab account and write controls');

  // Exercise the approved page filter against genuine local records, including a second page.
  for (let id = 5; id <= 21; id++) await (await contract.createInvoice(accounts[1], 1n, `PAGE-${id}`)).wait();
  await (await contract.connect(await provider.getSigner(1)).payInvoice(21, { value: 1n })).wait();
  await page.locator('#connect').click();
  await until(() => page.locator('#new-invoice').isEnabled(), 'Reconnect for page checks');
  await page.evaluate(() => window.__walletTest.select(0));
  await page.locator('#issued').click();
  await until(() => page.locator('#status-filter').isEnabled(), 'First invoice page ready');
  assert.equal(await page.locator('.invoice-row').count(), 20);
  assert((await page.locator('#page-info').innerText()).includes('21 issued · 1–20 shown'));
  const submissionsBeforeFilters = await page.evaluate(() => window.__walletTest.sent.length);
  for (const [status, count] of [['Pending', 18], ['Paid', 1], ['Cancelled', 1], ['all', 20]]) {
    await page.locator('#status-filter').selectOption(status);
    assert.equal(await page.locator('.invoice-row').count(), count);
    if (status !== 'all') {
      assert.deepEqual(await page.locator('.invoice-row>.status').allTextContents(), Array(count).fill(status));
      assert((await page.locator('#page-info').innerText()).includes(`${count} ${status.toLowerCase()} on this page`));
    }
  }
  assert.equal(await page.evaluate(() => window.__walletTest.sent.length), submissionsBeforeFilters);
  passed('All three status filters use genuine local invoice states, preserve account total/page range and submit no transaction');

  await page.locator('#status-filter').selectOption('Paid');
  await page.locator('#status-filter').focus();
  assert.equal(await page.locator('#status-filter').evaluate(element => element === document.activeElement), true);
  assert.equal(await page.locator('#status-filter').getAttribute('aria-describedby'), 'filter-help');
  assert((await page.locator('#filter-help').innerText()).includes('on this page'));
  await page.getByRole('button', { name: 'Open invoice 21, PAGE-21, Paid', exact: true }).click();
  await page.locator('#history .activity').filter({ hasText: 'Invoice Paid' }).waitFor();
  const paidRecord = await contract.getInvoice(21);
  const createdClock = new Date(Number(paidRecord.createdAt) * 1000).toISOString().slice(11, 19);
  const paidClock = new Date(Number(paidRecord.settledAt) * 1000).toISOString().slice(11, 19);
  assert((await page.locator('#detail-content').innerText()).includes('Paid at'));
  assert((await page.locator('#detail-content').innerText()).includes(paidClock));
  assert((await page.locator('#history .activity').filter({ hasText: 'Invoice Created' }).innerText()).includes(createdClock));
  assert((await page.locator('#history .activity').filter({ hasText: 'Invoice Paid' }).innerText()).includes(paidClock));
  assert((await page.locator('#history').innerText()).includes('UTC'));
  await page.locator('#status-filter').selectOption('Cancelled');
  await page.getByRole('button', { name: 'Open invoice 2, <b>PUBLIC</b>, Cancelled', exact: true }).click();
  await page.locator('#history .activity').filter({ hasText: 'Invoice Cancelled' }).waitFor();
  const cancelledRecord = await contract.getInvoice(2);
  const cancelledClock = new Date(Number(cancelledRecord.settledAt) * 1000).toISOString().slice(11, 19);
  assert((await page.locator('#detail-content').innerText()).includes('Cancelled at'));
  assert((await page.locator('#history .activity').filter({ hasText: 'Invoice Cancelled' }).innerText()).includes(cancelledClock));
  passed('Payment and cancellation details/activity use their on-chain creation/settlement times with an explicit time zone; the filter has a keyboard focus and scope label');

  await page.locator('#status-filter').selectOption('Cancelled');
  let releasePage, delayedPageReady;
  const held = new Promise(resolve => { delayedPageReady = resolve; });
  await page.route('**/api/invoices?*', async route => {
    if (new URL(route.request().url()).searchParams.get('offset') !== '20') return route.continue();
    const response = await route.fetch();
    await new Promise(resolve => { releasePage = resolve; delayedPageReady(); });
    await route.fulfill({ response });
  });
  await page.locator('#next').click(); await held;
  assert(await page.locator('#previous').isDisabled()); assert(await page.locator('#next').isDisabled());
  assert(await page.locator('#status-filter').isDisabled());
  assert.equal(await page.locator('#page-info').innerText(), 'Loading this page…');
  releasePage();
  await page.locator('#invoice-list').filter({ hasText: 'No cancelled invoices on this page.' }).waitFor();
  assert.equal(await page.locator('#status-filter').inputValue(), 'Cancelled');
  assert((await page.locator('#page-info').innerText()).includes('0 cancelled on this page · 21 issued · Page 21–21'));
  assert(await page.locator('#previous').isEnabled()); assert(await page.locator('#next').isDisabled());
  await page.unroute('**/api/invoices?*');
  await page.locator('#previous').click();
  await until(() => page.locator('#status-filter').isEnabled(), 'Earlier filtered page restored');
  assert.equal(await page.locator('.invoice-row').count(), 1);
  passed('Filtered empty later page retains its correct range and account total; pagination is disabled while loading and preserves the selected filter');

  await page.route('**/api/invoices?*', route => new URL(route.request().url()).searchParams.get('offset') === '20'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Test page unavailable.' } }) }) : route.continue());
  await page.locator('#next').click();
  await page.locator('#invoice-list').filter({ hasText: 'Invoices unavailable.' }).waitFor();
  assert.equal(await page.locator('#page-info').innerText(), 'This page could not be loaded');
  assert(await page.locator('#previous').isEnabled()); assert(await page.locator('#next').isDisabled());
  assert(await page.locator('#status-filter').isDisabled());
  await page.unroute('**/api/invoices?*');
  await page.locator('#previous').click();
  await until(() => page.locator('#status-filter').isEnabled(), 'Recover after failed page');
  assert.equal(await page.locator('.invoice-row').count(), 1);
  await page.locator('#received').click();
  await until(() => page.locator('#status-filter').isEnabled(), 'New role loaded');
  assert.equal(await page.locator('#status-filter').inputValue(), 'all');
  assert.equal(await page.locator('.invoice-row').count(), 0);
  passed('Failed page clears obsolete counts and permits Previous recovery; role change resets filter and clears the old page');

  await page.locator('#issued').click();
  await until(() => page.locator('#status-filter').isEnabled(), 'Issuer page restored');
  await page.locator('#status-filter').selectOption('Paid');
  let releaseOld, staleReady;
  const staleHeld = new Promise(resolve => { staleReady = resolve; });
  await page.route('**/api/invoices?*', async route => {
    if (new URL(route.request().url()).searchParams.get('address')?.toLowerCase() !== accounts[0].toLowerCase()) return route.continue();
    const response = await route.fetch();
    await new Promise(resolve => { releaseOld = resolve; staleReady(); });
    await route.fulfill({ response });
  });
  await page.locator('#refresh').click(); await staleHeld;
  await page.evaluate(() => window.__walletTest.select(2));
  await until(() => page.locator('#status-filter').isEnabled(), 'Different empty account ready');
  assert.equal(await page.locator('#status-filter').inputValue(), 'all');
  releaseOld();
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.invoice-row').count(), 0);
  assert((await page.locator('#page-info').innerText()).includes('0 issued'));
  assert(await page.locator('#detail').isHidden());
  await page.unroute('**/api/invoices?*');
  passed('Account change resets the filter and discards a delayed previous-account list without restoring old Paid records');

  await page.evaluate(() => window.__walletTest.select(0));
  await until(() => page.locator('#status-filter').isEnabled(), 'Issuer restored for screenshots');
  await page.locator('#status-filter').selectOption('Paid');
  await page.getByRole('button', { name: 'Open invoice 21, PAGE-21, Paid', exact: true }).click();
  await page.locator('#history .activity').filter({ hasText: 'Invoice Paid' }).waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'docs/evidence/screenshots/app-local-phase7-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'docs/evidence/screenshots/app-local-phase7-mobile.png', fullPage: true });
  passed('Status filters, honest pagination and activity times fit a 390px viewport without horizontal overflow');

  await page.setViewportSize({ width: 1440, height: 1100 });
  const fundedBalance = await chain.rpc('eth_getBalance', [accounts[0], 'latest']);
  const beforeUnderfunded = await page.evaluate(() => window.__walletTest.sent.length);
  await chain.rpc('anvil_setBalance', [accounts[0], '0x0']);
  await create('NO-FUNDS', '0.0001');
  await page.locator('#confirm-invoice').click();
  await page.locator('#tx-title').filter({ hasText: 'Request not completed' }).waitFor();
  assert((await page.locator('#tx-description').innerText()).includes('enough test ETH'));
  assert.equal(await contract.invoiceCount(), 21n);
  assert.equal(await page.evaluate(() => window.__walletTest.sent.length), beforeUnderfunded);
  assert.equal(await page.locator('#tx-link').innerText(), '');
  await chain.rpc('anvil_setBalance', [accounts[0], fundedBalance]);
  await until(() => page.locator('#new-invoice').isEnabled(), 'Underfunded attempt finishes');
  passed('Genuinely underfunded local issuer receives amount-and-fee guidance with no hash, invoice or successful broadcast');

  await page.route('**/api/transactions/*', route => route.fulfill({ status: 503, contentType: 'application/json',
    body: JSON.stringify({ error: { message: 'Test receipt service unavailable.' } }) }));
  const sendsBeforeOutage = await page.evaluate(() => window.__walletTest.sent.length);
  await create('RECEIPT-RECOVERY');
  await page.locator('#confirm-invoice').click();
  await page.locator('#tx-title').filter({ hasText: 'Confirmation unavailable' }).waitFor();
  await until(() => page.locator('#check-transaction').isEnabled(), 'Confirmation retry ready');
  const outageHash = await page.locator('#tx-link').innerText();
  assert.match(outageHash, /^0x[0-9a-f]{64}$/i);
  assert(await page.locator('#new-invoice').isDisabled());
  assert.equal(await contract.invoiceCount(), 22n);
  assert.equal(await page.evaluate(() => window.__walletTest.sent.length), sendsBeforeOutage + 1);
  await page.unroute('**/api/transactions/*');
  await page.locator('#check-transaction').click();
  await page.locator('#tx-title').filter({ hasText: 'Transaction confirmed' }).waitFor();
  assert.equal(await page.locator('#tx-link').innerText(), outageHash);
  assert.equal(await page.evaluate(() => window.__walletTest.sent.length), sendsBeforeOutage + 1);
  assert.equal(await contract.invoiceCount(), 22n);
  passed('Receipt API failure retains the mined transaction hash, blocks duplicate writes and recovers the same receipt without resending');

  assert.deepEqual(errors, []);
  passed('No uncaught browser JavaScript errors');
  const evidence = { recordedAt: new Date().toISOString(), result: 'Passed', chainId: 31337, sourceSha256: artifact.sourceSha256,
    environment: 'Isolated headless Chrome; injected EIP-1193/EIP-6963 test provider; real local Anvil EVM and Flask. Not real MetaMask or Sepolia.', checks };
  await writeFile('docs/evidence/browser-tests.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
  provider.destroy(); chain.stop();
}
