import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { ContractFactory, JsonRpcProvider, MaxUint256, formatEther, getAddress } from 'ethers';
import { startLocalChain, freePort } from '../tools/local-chain.mjs';

// Focused V04 coverage. All transaction signing is forbidden in this fixture.
const inputs = ['contracts/FreelancePay.sol', 'abi/FreelancePay.json', 'build/FreelancePay.json',
  'app.py', 'chain_service.py', 'templates/index.html', 'static/app.js', 'tests/input-boundaries.mjs'];
const hashes = Object.fromEntries(await Promise.all(inputs.map(async path =>
  [path, createHash('sha256').update(await readFile(path)).digest('hex')])));
const artifact = JSON.parse(await readFile('build/FreelancePay.json', 'utf8'));
const chain = await startLocalChain(await freePort());
const provider = new JsonRpcProvider(chain.url);
const cases = [], errors = [];
let server, browser, contract, fixtureState;
async function until(check, label) {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}`);
}
try {
  const accounts = await chain.rpc('eth_accounts');
  contract = await new ContractFactory(artifact.abi, artifact.bytecode, await provider.getSigner(0)).deploy();
  await contract.waitForDeployment();
  const port = await freePort(), url = `http://127.0.0.1:${port}`;
  const python = process.env.PYTHON_BINARY || (process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
  server = spawn(python, ['app.py'], { windowsHide: true, stdio: 'ignore', env: {
    ...process.env, PORT: String(port), CHAIN_ID: '31337', RPC_URL: chain.url, CONTRACT_ADDRESS: contract.target,
  } });
  await until(async () => { try { return (await fetch(`${url}/api/health`)).ok; } catch { return false; } }, 'Isolated Flask readiness');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 1000 } });
  await context.exposeBinding('__boundaryRpc', (_, { method, params }) => chain.rpc(method, params || []));
  await context.addInitScript(({ account }) => {
    const driver = { authorized: false, writeRequests: 0, connectionRequests: 0 };
    window.__boundaryWallet = driver;
    const wallet = { isMetaMask: true, on() {}, async request({ method, params }) {
      if (method === 'eth_requestAccounts') { driver.authorized = true; driver.connectionRequests++; return [account]; }
      if (method === 'eth_accounts') return driver.authorized ? [account] : [];
      if (method === 'eth_chainId') return '0x7a69';
      if (['eth_sendTransaction', 'eth_signTransaction', 'eth_sendRawTransaction', 'eth_sign', 'personal_sign'].includes(method)) {
        driver.writeRequests++; throw new Error('Signing is forbidden in this input-boundary fixture');
      }
      return window.__boundaryRpc({ method, params });
    } };
    window.ethereum = wallet;
    window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: { info: { rdns: 'io.metamask' }, provider: wallet },
    })));
  }, { account: getAddress(accounts[0]) });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.locator('#connect').waitFor({ state: 'visible' });
  await until(() => page.locator('#connect').isEnabled(), 'Connection enabled');
  await page.locator('#connect').click();
  await until(() => page.locator('#new-invoice').isEnabled(), 'Fixture account connected');
  const valid = { reference: 'BOUNDARY', client: getAddress(accounts[1]), amount: '0.000000000000000001' };
  const badChecksum = valid.client.replace(/[A-F]/, char => char.toLowerCase());
  assert.notEqual(badChecksum, valid.client);
  const rejected = [
    ['Missing client', 'client', '', null],
    ['Malformed client', 'client', 'not-an-address', 'valid Ethereum'],
    ['Invalid mixed-case checksum', 'client', badChecksum, 'valid Ethereum'],
    ['Zero client', 'client', '0x' + '0'.repeat(40), 'different, nonzero'],
    ['Issuer as client', 'client', getAddress(accounts[0]), 'different, nonzero'],
    ['Missing reference', 'reference', '', null],
    ['Leading reference space', 'reference', ' BOUNDARY', '1–32'],
    ['Trailing reference space', 'reference', 'BOUNDARY ', '1–32'],
    ['Non-ASCII reference', 'reference', '\u00e9', '1–32'],
    ['Reference beyond HTML maxlength', 'reference', 'X'.repeat(33), '1–32'],
    ['Missing amount', 'amount', '', null],
    ['Zero amount', 'amount', '0', 'positive amount'],
    ['Negative amount', 'amount', '-1', 'plain decimal'],
    ['Exponent amount', 'amount', '1e-3', 'plain decimal'],
    ['Excess precision', 'amount', '0.0000000000000000001', 'plain decimal'],
    ['Leading zero amount', 'amount', '01', 'plain decimal'],
    ['Non-numeric amount', 'amount', 'NaN', 'plain decimal'],
    ['Amount above uint256', 'amount', formatEther(MaxUint256 + 1n), 'positive amount'],
  ];
  await mkdir('docs/evidence/screenshots', { recursive: true });
  for (const [name, field, value, expected] of rejected) {
    await page.locator('#new-invoice').click();
    for (const [id, text] of Object.entries({ ...valid, [field]: value })) {
      // A programmatic overlength value also exercises JS behind the HTML maxlength.
      await page.locator(`#${id}`).evaluate((element, text) => { element.value = text; }, text);
    }
    await page.locator('#review-invoice').click();
    if (expected) await page.locator('#form-error').filter({ hasText: expected }).waitFor();
    else assert(await page.locator(`#${field}`).evaluate(element => !element.checkValidity() && Boolean(element.validationMessage)));
    assert(await page.locator('#confirm-invoice').isHidden());
    assert(await page.locator('#review').isHidden());
    assert.equal(await page.evaluate(() => window.__boundaryWallet.writeRequests), 0);
    assert.equal(await contract.invoiceCount(), 0n);
    cases.push({ name, expected: 'Rejected before review/signing', passed: true,
      feedback: expected ? await page.locator('#form-error').innerText() : 'Native required-field validation' });
    if (name === 'Zero client') await page.screenshot({ path: 'docs/evidence/screenshots/input-boundary-invalid-client-fixture.png', fullPage: true });
    await page.locator('#close-create').click();
  }
  const accepted = [
    ['One-character reference and one wei', 'A', '0.000000000000000001', 1n],
    ['32-character reference and 18-decimal amount', 'A'.repeat(32), '1.000000000000000001', 1000000000000000001n],
    ['Literal HTML-shaped reference', '<b>PUBLIC</b>', '0.0001', 100000000000000n],
    ['Maximum uint256 amount review', 'MAX', formatEther(MaxUint256), MaxUint256],
  ];
  for (const [name, reference, amount, wei] of accepted) {
    await page.locator('#new-invoice').click();
    await page.locator('#reference').fill(reference);
    await page.locator('#client').fill(valid.client);
    await page.locator('#amount').fill(amount);
    await page.locator('#review-invoice').click();
    await page.locator('#confirm-invoice').waitFor({ state: 'visible' });
    const text = await page.locator('#review').innerText();
    assert(text.includes(`Reference: ${reference}`) && text.includes(valid.client));
    assert(text.includes(`Amount: ${formatEther(wei)} ETH`));
    assert.equal(await page.locator('#review b').count(), 0);
    assert.equal(await page.evaluate(() => window.__boundaryWallet.writeRequests), 0);
    assert.equal(await contract.invoiceCount(), 0n);
    cases.push({ name, expected: 'Exact review only; no wallet transaction', passed: true, amountWei: wei.toString() });
    if (wei === 1n) await page.screenshot({ path: 'docs/evidence/screenshots/input-boundary-one-wei-review-fixture.png', fullPage: true });
    await page.locator('#close-create').click();
  }
  assert.deepEqual(errors, []);
  fixtureState = await page.evaluate(() => window.__boundaryWallet);
  assert.equal(fixtureState.connectionRequests, 1);
  assert.equal(fixtureState.writeRequests, 0);
  const evidence = { recordedAtUtc: new Date().toISOString(), result: 'Passed', checks: cases,
    rejectedCases: rejected.length, acceptedReviewCases: accepted.length, uncaughtBrowserErrors: errors,
    sourceHashes: hashes, sourceSha256: artifact.sourceSha256, chainId: 31337,
    environment: 'Isolated headless Chrome with an injected provider, real disposable Anvil and Flask. No personal wallet, Sepolia signing or Render operation.',
    wallet: fixtureState, invoiceCount: String(await contract.invoiceCount()),
    scope: 'Focused V04 UI boundaries and exact review rendering. The Anvil contract deployment is fixture setup; zero application invoice transactions were requested. Accepted maximum amount is a parsing/review case, not evidence of affordability.',
    preserved: 'The public app on port 8765 and the historical 31-group browser evidence were not changed.',
  };
  await writeFile('docs/evidence/input-boundary-tests.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ result: evidence.result, rejectedCases: rejected.length, acceptedReviewCases: accepted.length,
    walletWriteRequests: fixtureState.writeRequests, invoiceCount: evidence.invoiceCount, record: 'docs/evidence/input-boundary-tests.json' }));
} catch (error) {
  await mkdir('docs/evidence', { recursive: true });
  await writeFile(`docs/evidence/input-boundary-failure-${Date.now()}.json`, JSON.stringify({ recordedAtUtc: new Date().toISOString(),
    result: 'Failed', completedCases: cases, error: error.message, sourceHashes: hashes, chainId: 31337,
    scope: 'Failed focused local fixture execution; not actual MetaMask or public-network evidence.' }, null, 2) + '\n');
  console.error(error); process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
  provider.destroy(); chain.stop();
}
