import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startLocalChain, freePort } from '../tools/local-chain.mjs';

// Only a disposable local Anvil instance. Matching the configured chain ID does
// not make this a public Sepolia test, and the output records that distinction.
const chain = await startLocalChain(await freePort(), 11155111);
let server, browser;
try {
  const port = await freePort(), url = `http://127.0.0.1:${port}`;
  const python = process.env.PYTHON_BINARY || (process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
  server = spawn(python, ['tools/deploy_server.py', '--port', String(port)], { windowsHide: true, stdio: 'ignore' });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`${url}/artifact`);
      await response.arrayBuffer();
      if (response.ok) { ready = true; break; }
    } catch { /* Server starts asynchronously. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(ready, 'Deployment helper starts');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();
  await context.exposeBinding('__localRpc', (_, request) => chain.rpc(request.method, request.params || []));
  await context.addInitScript(() => {
    window.ethereum = { isMetaMask: true, on() {}, async request({ method, params }) {
      if (method === 'eth_requestAccounts') return window.__localRpc({ method: 'eth_accounts' });
      return window.__localRpc({ method, params });
    } };
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await page.locator('#build').filter({ hasText: '0.8.30' }).waitFor();
  await page.locator('#connect').filter({ hasText: 'Connected' }).waitFor();
  await page.waitForFunction(() => !document.getElementById('deploy').disabled);
  await page.locator('#connection-report').filter({ hasText: 'Connection status shared locally' }).waitFor();
  const connectionResponse = await fetch(`${url}/connection-status`);
  const connection = await connectionResponse.json();
  assert.equal(connection.observations[0].chainId, '11155111');
  assert.equal(connection.observations[0].account.toLowerCase(), (await chain.rpc('eth_accounts', []))[0].toLowerCase());
  await page.locator('#deploy').click();
  await page.locator('#status').filter({ hasText: 'Deployment verified' }).waitFor();
  const record = JSON.parse(await page.locator('#result').innerText());
  const artifact = JSON.parse(await readFile('build/FreelancePay.json', 'utf8'));
  assert.equal(record.sourceSha256, artifact.sourceSha256);
  assert.equal(await chain.rpc('eth_getCode', [record.contractAddress, 'latest']), artifact.deployedBytecode);
  const transaction = await chain.rpc('eth_getTransactionByHash', [record.transactionHash]);
  assert.equal(BigInt(transaction.chainId), 11155111n);
  assert(await page.locator('#deploy').isDisabled());
  assert(await page.locator('#download').isEnabled());
  const downloadEvent = page.waitForEvent('download');
  await page.locator('#download').click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), 'freelancepay-sepolia-deployment.json');
  await page.reload();
  assert.equal(await page.locator('#hash').inputValue(), record.transactionHash);
  await page.locator('#connect').filter({ hasText: 'Connected' }).waitFor();
  await page.locator('#check').click();
  await page.locator('#status').filter({ hasText: 'Deployment verified' }).waitFor();
  assert(await page.locator('#deploy').isDisabled());
  assert.deepEqual(errors, []);
  const evidence = { recordedAt: new Date().toISOString(), result: 'Passed', publicNetwork: false,
    environment: 'Disposable loopback Anvil configured with chain ID 11155111 solely to test the Sepolia-only helper. Injected test wallet; NOT public Sepolia or actual MetaMask.',
    sourceSha256: artifact.sourceSha256,
    checks: ['connect and balance read', 'public connection state shared with loopback helper', 'explicit target chain on deployment', 'creation receipt and exact runtime verification', 'duplicate deployment disabled', 'deployment record download', 'hash recovery and verification after reload', 'no uncaught JavaScript errors'] };
  await writeFile('docs/evidence/deployment-helper-flow.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
  chain.stop();
}
