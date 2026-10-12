import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

// Isolated UI-only fixture. No real wallet, RPC endpoint or chain transaction.
const first = '0x0000000000000000000000000000000000000011';
const second = '0x0000000000000000000000000000000000000022';
const files = ['templates/index.html', 'static/app.js', 'static/app.css', 'static/vendor/ethers.min.js'];
const contents = Object.fromEntries(await Promise.all(files.map(async name => [name, await readFile(name)])));
const hashes = Object.fromEntries(files.map(name => [name, createHash('sha256').update(contents[name]).digest('hex')]));
const checks = [], errors = [], walletMethods = [];
let browser;
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path === '/') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(contents['templates/index.html'].toString('utf8').replace(/\{\{ url_for\('static', filename='([^']+)'\) \}\}/g, (_, name) => `/static/${name}`));
  } else if (contents[path.slice(1)]) {
    response.setHeader('Content-Type', path.endsWith('.css') ? 'text/css' : 'text/javascript'); response.end(contents[path.slice(1)]);
  } else if (path.startsWith('/api/')) {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(path === '/api/config'
      ? { chainId: '11155111', networkName: 'Ethereum Sepolia', configured: true, abi: [], explorerUrl: '', contractAddress: second }
      : path === '/api/health' ? { status: 'ready' } : { items: [], total: '0', offset: '0', limit: 20, observedBlock: '1' }));
  } else { response.statusCode = 404; response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await context.exposeBinding('__recordAccountDetailsMethod', (_, method) => { walletMethods.push(method); });
  await context.addInitScript(({ first, second }) => {
    const callbacks = new Map();
    const driver = { accounts: [first, second], calls: [], update(accounts) { this.accounts = accounts; for (const callback of callbacks.get('accountsChanged') || []) callback(accounts); } };
    window.__accountDetailsFixture = driver;
    const provider = { isMetaMask: true, on(name, callback) { if (!callbacks.has(name)) callbacks.set(name, []); callbacks.get(name).push(callback); }, async request({ method }) {
      driver.calls.push(method);
      await window.__recordAccountDetailsMethod(method);
      if (method === 'eth_accounts') return [...driver.accounts];
      if (method === 'eth_chainId') return '0xaa36a7';
      if (method === 'eth_getBalance') return '0x38d7ea4c68000';
      if (method === 'wallet_revokePermissions') { driver.update([]); return null; }
      throw new Error(`Unexpected wallet method: ${method}`);
    } };
    window.ethereum = provider;
  }, { first, second });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.locator('#account').filter({ hasText: first }).waitFor();
  await page.getByText('Wallet connection details', { exact: true }).click();
  assert.deepEqual(await page.locator('#wallet-accounts li').allTextContents(), [first + ' — Used for actions', second]);
  assert((await page.locator('#wallet-account-count').innerText()).includes('2 accounts'));
  assert((await page.locator('#connect').innerText()).includes('0011'));
  checks.push('Multiple exposed accounts are visible, with only the first marked for actions.');
  const readsBefore = await page.evaluate(() => window.__accountDetailsFixture.calls.length);
  await page.getByText('Wallet connection details', { exact: true }).click();
  await page.getByText('Wallet connection details', { exact: true }).click();
  assert.equal(await page.evaluate(() => window.__accountDetailsFixture.calls.length), readsBefore);
  checks.push('Opening the disclosure makes no wallet request or account change.');
  await page.evaluate(({ first, second }) => window.__accountDetailsFixture.update([second, first]), { first, second });
  await page.locator('#account').filter({ hasText: second }).waitFor();
  assert.deepEqual(await page.locator('#wallet-accounts li').allTextContents(), [second + ' — Used for actions', first]);
  checks.push('A genuine fixture accountsChanged event updates both the action account and list order.');
  await page.evaluate(first => window.__accountDetailsFixture.update([first, '<img src=x onerror=alert(1)>']), first);
  await page.locator('#account').filter({ hasText: first }).waitFor();
  assert.equal(await page.locator('#wallet-accounts img').count(), 0);
  assert((await page.locator('#wallet-accounts').innerText()).includes('<img src=x onerror=alert(1)>'));
  checks.push('Additional provider values render as plain text without injected HTML.');
  await page.evaluate(first => window.__accountDetailsFixture.update([first]), first);
  await page.locator('#wallet-account-count').filter({ hasText: '1 account with' }).waitFor();
  await page.setViewportSize({ width: 390, height: 1100 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.locator('#wallet-connection-details').scrollIntoViewIfNeeded();
  await mkdir('docs/evidence/screenshots', { recursive: true });
  await page.screenshot({ path: 'docs/evidence/screenshots/wallet-account-details-mobile-fixture.png' });
  checks.push('Single-account wording and expanded 390px layout remain readable without horizontal overflow.');
  await page.locator('#disconnect').click();
  await page.locator('#account').filter({ hasText: 'Wallet not connected' }).waitFor();
  assert(await page.locator('#wallet-connection-details').isHidden());
  assert.equal(await page.locator('#wallet-accounts li').count(), 0);
  await page.reload();
  await page.locator('#notice').filter({ hasText: 'Disconnected from FreelancePay' }).waitFor();
  assert(await page.locator('#wallet-connection-details').isHidden());
  assert.equal(await page.locator('#wallet-accounts li').count(), 0);
  checks.push('Disconnect and reload hide the disclosure and remove all previous accounts.');
  assert(!walletMethods.some(method => ['eth_sendTransaction', 'eth_requestAccounts', 'wallet_requestPermissions'].includes(method)));
  assert.deepEqual(errors, []);
  await writeFile('docs/evidence/wallet-account-details-tests.json', JSON.stringify({ recordedAtUtc: new Date().toISOString(), result: 'passed', scope: 'Isolated headless Chrome, static UI fixture and injected wallet; no actual MetaMask, Flask-chain or public transaction claim.', checks, sourceHashes: hashes, testSha256: createHash('sha256').update(await readFile('tests/wallet-account-details.mjs')).digest('hex'), pageErrors: errors, walletMethods, walletWriteRequests: 0, newPermissionRequests: 0, observationScope: 'Method recorder persists outside the page across reload.', initialRecord: 'docs/evidence/wallet-account-details-tests-initial.json' }, null, 2) + '\n');
  console.log(JSON.stringify({ result: 'passed', checks: checks.length, walletWriteRequests: 0, newPermissionRequests: 0 }));
} catch (error) {
  await writeFile(`docs/evidence/wallet-account-details-failure-${Date.now()}.json`, JSON.stringify({ recordedAtUtc: new Date().toISOString(), checks, error: error.message, sourceHashes: hashes }, null, 2) + '\n');
  console.error(error); process.exitCode = 1;
} finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
