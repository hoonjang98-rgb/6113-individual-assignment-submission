import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import solc from 'solc';
import { version as ethersVersion } from 'ethers';
import { startLocalChain, freePort } from './local-chain.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const python = resolve(root, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
const result = spawnSync(python, ['-c',
  'import json,sys,importlib.metadata as m; print(json.dumps({"python":sys.version.split()[0],"packages":{x:m.version(x) for x in ["Flask","web3","pytest","eth-account","eth-abi","eth-utils","eth-typing","hexbytes"]}}))',
], { encoding: 'utf8', windowsHide: true });
if (result.status !== 0) throw new Error(result.stderr || 'Python environment check failed');
const report = {
  recordedAt: new Date().toISOString(), scope: 'Development environment only; no application tests or live wallet verification',
  ...JSON.parse(result.stdout), node: process.version, solc: solc.version(), ethers: ethersVersion,
};
const chain = await startLocalChain(await freePort());
let browser;
try {
  report.localChainId = Number(BigInt(await chain.rpc('eth_chainId')));
  report.localTestAccountCount = (await chain.rpc('eth_accounts')).length;
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
  report.isolatedBrowser = browser.version();
  report.result = 'Passed';
} finally {
  if (browser) await browser.close();
  chain.stop();
}
await mkdir(resolve(root, 'docs/evidence'), { recursive: true });
await writeFile(resolve(root, 'docs/evidence/environment.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
