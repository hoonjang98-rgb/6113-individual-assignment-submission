import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const url = process.env.DEPLOY_HELPER_URL || 'http://127.0.0.1:8765';
const expected = JSON.parse(await readFile('build/FreelancePay.json', 'utf8'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1100 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await page.locator('#build').filter({ hasText: '0.8.30' }).waitFor();
  await page.locator('#connect').click();
  if (!(await page.locator('#status').innerText()).includes('MetaMask installed')) throw new Error('Missing-wallet guidance failed');
  if (!(await page.locator('#deploy').isDisabled())) throw new Error('Deployment enabled without wallet');
  const response = await page.request.get(`${url}/artifact`);
  const artifact = await response.json();
  if (artifact.sourceSha256 !== expected.sourceSha256) throw new Error('Unexpected build');
  if (errors.length) throw new Error(errors.join('; '));
  await mkdir('docs/evidence/screenshots', { recursive: true });
  await page.screenshot({ path: 'docs/evidence/screenshots/deployment-helper-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Mobile horizontal overflow');
  await page.screenshot({ path: 'docs/evidence/screenshots/deployment-helper-mobile.png', fullPage: true });
  const evidence = { recordedAt: new Date().toISOString(), result: 'Passed', sourceSha256: expected.sourceSha256,
    checks: ['build identity', 'wallet absence guidance', 'deployment disabled without wallet', 'no JavaScript errors', '390px layout without overflow'],
    scope: 'Local helper only; no MetaMask signing or public deployment' };
  await writeFile('docs/evidence/deployment-helper.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
} finally { await browser.close(); }
