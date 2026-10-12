import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { ContractFactory, JsonRpcProvider, getAddress } from 'ethers';
import { startLocalChain, freePort } from '../tools/local-chain.mjs';

const artifact = JSON.parse(await readFile('build/FreelancePay.json', 'utf8'));
const hashes = Object.fromEntries(await Promise.all(['static/app.js', 'static/app.css', 'templates/index.html', 'tests/connected-accounts.mjs'].map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])));
const chain = await startLocalChain(await freePort());
const provider = new JsonRpcProvider(chain.url);
let server, browser;
const checks = [], errors = [];
async function until(check, label) {
  const start = Date.now();
  while (Date.now() - start < 20000) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(`Timed out: ${label}`);
}
try {
  const addresses = (await chain.rpc('eth_accounts')).map(getAddress);
  const [issuer, client] = addresses;
  const contract = await new ContractFactory(artifact.abi, artifact.bytecode, await provider.getSigner(0)).deploy();
  await contract.waitForDeployment();
  await (await contract.createInvoice(client, 1n, 'MULTI-ACCOUNT-001')).wait();
  const port = await freePort(), url = `http://127.0.0.1:${port}`;
  const python = process.env.PYTHON_BINARY || (process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
  server = spawn(python, ['app.py'], { windowsHide: true, stdio: 'ignore', env: { ...process.env, PORT: String(port), CHAIN_ID: '31337', RPC_URL: chain.url, CONTRACT_ADDRESS: contract.target } });
  await until(async () => { try { return (await fetch(`${url}/api/health`)).ok; } catch { return false; } }, 'Flask ready');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1050 } });
  const walletMethods = [], submitted = [];
  await context.exposeBinding('__multiMethod', (_, request) => { walletMethods.push(request.method); if (request.method === 'eth_sendTransaction') submitted.push(request.params[0]); });
  await context.exposeBinding('__multiRpc', (_, request) => chain.rpc(request.method, request.params || []));
  await context.addInitScript(({ issuer, client }) => {
    const listeners = new Map();
    const driver = { accounts: [issuer, client], chain: '0x7a69', holdNextAccounts: false, removeAfterNextRead: false, revokeAfterEstimate: false, networkAfterEstimate: false,
      emit() { for (const callback of listeners.get('accountsChanged') || []) callback([...this.accounts]); } };
    window.__multiWallet = driver;
    window.ethereum = { isMetaMask: true, on(name, callback) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(callback); }, async request(request) {
      await window.__multiMethod(request);
      const { method } = request;
      if (method === 'eth_accounts') {
        const result = [...driver.accounts];
        if (driver.holdNextAccounts) { driver.holdNextAccounts = false; await new Promise(resolve => { driver.releaseAccounts = resolve; }); }
        if (driver.removeAfterNextRead) { driver.removeAfterNextRead = false; driver.accounts = [issuer]; }
        return result;
      }
      if (method === 'eth_chainId') return driver.chain;
      if (method === 'wallet_revokePermissions') { driver.accounts = []; driver.emit(); return null; }
      if (method === 'eth_requestAccounts' || method === 'wallet_requestPermissions') throw new Error('No new permissions allowed in multi-account fixture');
      const result = await window.__multiRpc(request);
      if (method === 'eth_estimateGas' && driver.revokeAfterEstimate) { driver.revokeAfterEstimate = false; driver.accounts = [issuer]; }
      if (method === 'eth_estimateGas' && driver.networkAfterEstimate) { driver.networkAfterEstimate = false; driver.chain = '0x1'; }
      return result;
    } };
  }, { issuer, client });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  const selected = async account => { await page.locator('#account').filter({ hasText: account }).waitFor(); await until(() => page.locator('#active-account').isEnabled(), 'Account selection complete'); };
  const restoreBoth = async () => {
    await page.evaluate(({ issuer, client }) => { window.__multiWallet.accounts = [issuer, client]; window.__multiWallet.chain = '0x7a69'; window.__multiWallet.emit(); }, { issuer, client });
    await until(() => page.locator('#active-account').isEnabled(), 'Both accounts restored');
  };
  const reviewCreate = async (name, target) => {
    await until(() => page.locator('#new-invoice').isEnabled(), 'Create enabled');
    await page.locator('#new-invoice').click(); await page.locator('#reference').fill(name);
    await page.locator('#client').fill(target); await page.locator('#amount').fill('0.000000000000000001');
    await page.locator('#review-invoice').click(); await page.locator('#confirm-invoice').waitFor({ state: 'visible' });
  };
  await page.goto(url); await selected(issuer);
  assert.deepEqual(await page.locator('#active-account option').allTextContents(), [issuer, client]);
  await reviewCreate('STALE-MULTI', client);
  await page.locator('#close-create').click();
  // Reopen a reviewed form and change the selection through its normal change handler.
  await reviewCreate('STALE-MULTI', client);
  await page.evaluate(client => { const select = document.getElementById('active-account'); select.value = client; select.dispatchEvent(new Event('change')); }, client);
  await selected(client);
  assert.equal(await page.locator('#create-dialog').evaluate(dialog => dialog.open), false);
  assert(await page.locator('#confirm-invoice').isHidden());
  assert.equal(submitted.length, 0);
  checks.push('Selecting an already-authorized second account clears a stale review without a transaction or permission request.');
  await page.reload(); await selected(client);
  assert.equal(await page.locator('#active-account').inputValue(), client);
  checks.push('Explicit second-account preference survives reload while still authorized.');
  await page.evaluate(() => { window.__multiWallet.accounts.reverse(); window.__multiWallet.emit(); });
  await selected(client);
  assert.equal(await page.locator('#active-account').inputValue(), client);
  assert.deepEqual(await page.locator('#active-account option').allTextContents(), [client, issuer]);
  await restoreBoth(); await selected(client);
  checks.push('Authorized account order changes preserve the explicitly selected client.');
  await page.evaluate(() => { window.__multiWallet.holdNextAccounts = true; });
  await page.locator('#active-account').selectOption(issuer);
  await until(() => page.evaluate(() => Boolean(window.__multiWallet.releaseAccounts)), 'Selection account read held');
  await page.evaluate(client => { window.__multiWallet.accounts = [client]; window.__multiWallet.emit(); }, client);
  await page.locator('#account').filter({ hasText: client }).waitFor();
  await page.evaluate(() => { window.__multiWallet.releaseAccounts(); window.__multiWallet.releaseAccounts = null; });
  await until(() => page.locator('#switch-account').isEnabled(), 'Stale selection read completed');
  assert.equal(await page.locator('#account').innerText(), client);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('freelancepay:wallet-account')), client);
  assert(await page.locator('#account-picker').isHidden());
  assert.equal(submitted.length, 0);
  await restoreBoth(); await selected(client);
  checks.push('Revocation while account selection is reading discards the late authorized snapshot and retains the valid account.');
  await page.evaluate(() => { window.__multiWallet.holdNextAccounts = true; });
  await page.locator('#active-account').selectOption(issuer);
  await until(() => page.evaluate(() => Boolean(window.__multiWallet.releaseAccounts)), 'Second selection read held');
  await page.evaluate(() => {
    localStorage.setItem('freelancepay:wallet-disconnected', 'true');
    window.dispatchEvent(new StorageEvent('storage', { key: 'freelancepay:wallet-disconnected', newValue: 'true' }));
    window.__multiWallet.releaseAccounts(); window.__multiWallet.releaseAccounts = null;
  });
  await page.locator('#account').filter({ hasText: 'Wallet not connected' }).waitFor();
  assert.equal(await page.evaluate(() => sessionStorage.getItem('freelancepay:wallet-account')), null);
  assert(await page.locator('#new-invoice').isDisabled());
  assert.equal(submitted.length, 0);
  await page.reload(); await page.locator('#notice').filter({ hasText: 'Disconnected from FreelancePay' }).waitFor();
  checks.push('Cross-tab disconnect during a delayed selection clears the preference and ignores the late response across reload.');
  // Reset only the disposable fixture's local opt-out before the existing payment checks.
  await page.evaluate(() => localStorage.removeItem('freelancepay:wallet-disconnected'));
  await page.reload(); await selected(issuer);
  await page.locator('#active-account').selectOption(client); await selected(client);
  await page.locator('#received').click(); await page.getByRole('button', { name: 'Open invoice 1, MULTI-ACCOUNT-001, Pending', exact: true }).click();
  await page.getByRole('button', { name: 'Review payment · 0.000000000000000001 ETH', exact: true }).click();
  const before = BigInt(await chain.rpc('eth_getBalance', [issuer, 'latest']));
  await page.locator('#confirm-action').click();
  await page.locator('#tx-title').filter({ hasText: 'Transaction confirmed' }).waitFor();
  await until(() => page.locator('#switch-account').isEnabled(), 'Payment finished');
  assert.equal(submitted.length, 1); assert.equal(submitted[0].from.toLowerCase(), client.toLowerCase());
  assert.equal(BigInt(submitted[0].value), 1n); assert.equal((await contract.getInvoice(1)).status, 1n);
  assert.equal(BigInt(await chain.rpc('eth_getBalance', [issuer, 'latest'])) - before, 1n);
  checks.push('Second exposed account signs the exact local payment; requested from, transfer and Paid receipt/state agree.');
  await page.getByRole('button', { name: 'Switch to issuer wallet', exact: true }).click(); await selected(issuer);
  assert.equal(await page.locator('#issued').getAttribute('aria-pressed'), 'true');
  await page.locator('#detail-content').filter({ hasText: 'Paid' }).waitFor();
  assert.equal(submitted.length, 1);
  checks.push('Already-authorized invoice handoff changes role and restores the same Paid record without another permission prompt.');
  await page.locator('#active-account').selectOption(client); await selected(client);
  await page.evaluate(issuer => { window.__multiWallet.accounts = [issuer]; window.__multiWallet.emit(); }, issuer);
  await page.locator('#account').filter({ hasText: issuer }).waitFor();
  assert(await page.locator('#account-picker').isHidden());
  assert.equal(await page.evaluate(() => sessionStorage.getItem('freelancepay:wallet-account')), null);
  await restoreBoth(); await selected(issuer);
  checks.push('Removing selected wallet permission clears the preference and prevents later silent reselection.');
  await page.evaluate(address => sessionStorage.setItem('freelancepay:wallet-account', address), addresses[2]);
  await page.reload(); await selected(issuer);
  assert.equal(await page.locator('#active-account option').count(), 2);
  checks.push('Tampered stored preference cannot add or select an address outside current wallet authorization.');
  await page.locator('#active-account').selectOption(client); await selected(client);
  await reviewCreate('LOST-BEFORE-SIGNER', issuer);
  await page.evaluate(() => { window.__multiWallet.removeAfterNextRead = true; });
  await page.locator('#confirm-invoice').click();
  await page.locator('#tx-title').filter({ hasText: 'Request not completed' }).waitFor();
  await until(() => page.locator('#switch-account').isEnabled(), 'Signer loss completed');
  assert.equal(submitted.length, 1); assert.equal(await contract.invoiceCount(), 1n);
  checks.push('Permission loss during signer lookup cannot trigger an implicit reconnection or transaction.');
  await restoreBoth(); await selected(client);
  await reviewCreate('LOST-BEFORE-SEND', issuer);
  await page.evaluate(() => { window.__multiWallet.revokeAfterEstimate = true; });
  await page.locator('#confirm-invoice').click();
  await page.locator('#tx-title').filter({ hasText: 'Request not completed' }).waitFor();
  await until(() => page.locator('#switch-account').isEnabled(), 'Revocation guard completed');
  assert.equal(submitted.length, 1); assert.equal(await contract.invoiceCount(), 1n);
  checks.push('Fresh authorization check blocks a revoked selected address immediately before wallet submission.');
  await restoreBoth(); await selected(client);
  await reviewCreate('NETWORK-BEFORE-SEND', issuer);
  await page.evaluate(() => { window.__multiWallet.networkAfterEstimate = true; });
  await page.locator('#confirm-invoice').click();
  await page.locator('#tx-title').filter({ hasText: 'Request not completed' }).waitFor();
  await until(() => page.locator('#switch-account').isEnabled(), 'Network guard completed');
  assert.equal(submitted.length, 1); assert.equal(await contract.invoiceCount(), 1n);
  checks.push('A network change without a provider event is blocked before any wallet submission.');
  await restoreBoth();
  await page.setViewportSize({ width: 390, height: 1050 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator('#account-picker').scrollIntoViewIfNeeded();
  await mkdir('docs/evidence/screenshots', { recursive: true });
  await page.screenshot({ path: 'docs/evidence/screenshots/connected-account-picker-mobile-fixture.png' });
  checks.push('The full-address account selector fits a 390px viewport.');
  await page.locator('#disconnect').click();
  await page.locator('#account').filter({ hasText: 'Wallet not connected' }).waitFor();
  assert.equal(await page.evaluate(() => sessionStorage.getItem('freelancepay:wallet-account')), null);
  await page.reload(); await page.locator('#notice').filter({ hasText: 'Disconnected from FreelancePay' }).waitFor();
  assert(await page.locator('#account-picker').isHidden());
  assert.equal(await page.locator('#active-account option').count(), 0);
  checks.push('Disconnect and reload remove the preference and account choices.');
  assert(!walletMethods.some(method => ['eth_requestAccounts', 'wallet_requestPermissions'].includes(method)));
  assert.deepEqual(errors, []);
  await writeFile('docs/evidence/connected-account-tests.json', JSON.stringify({ recordedAtUtc: new Date().toISOString(), result: 'passed', checks, sourceHashes: hashes,
    environment: 'Isolated headless Chrome with injected wallet, real disposable Anvil chain 31337 and Flask; not actual MetaMask or Sepolia.',
    permissionRequests: 0, localWalletTransactions: submitted, publicTransactions: 0, pageErrors: errors }, null, 2)+'\n');
  console.log(JSON.stringify({ result: 'passed', checks: checks.length, permissionRequests: 0, localWalletTransactions: submitted.length, publicTransactions: 0 }));
} catch (error) {
  await writeFile(`docs/evidence/connected-account-failure-${Date.now()}.json`, JSON.stringify({ recordedAtUtc: new Date().toISOString(), checks, error: error.stack, sourceHashes: hashes }, null, 2)+'\n');
  console.error(error); process.exitCode = 1;
} finally { if (browser) await browser.close(); if (server) server.kill(); provider.destroy(); chain.stop(); }
