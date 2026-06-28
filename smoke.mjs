/**
 * Self-contained browser smoke test.
 *   npm run smoke            (builds, starts preview, drives Edge/Chromium headless)
 *
 * Spawns `vite preview`, discovers its port from stdout, exercises every
 * interactive feature, and fails (exit 1) on any console/page error or broken
 * interaction. Uses the installed Edge channel so no browser download is needed.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const errors = [];
const log = (...a) => console.log(...a);

/* ── Start the preview server and discover its URL ──────── */
const server = spawn('npm', ['run', 'preview'], { shell: true });
const stripAnsi = (s) => s.replace(/\[[0-9;]*m/g, '');
const baseUrl = await new Promise((resolve, reject) => {
  let buf = '';
  const t = setTimeout(() => reject(new Error('preview server did not start in 30s')), 30000);
  const scan = (d) => {
    buf += stripAnsi(d.toString());
    const m = buf.match(/http:\/\/localhost:\d+\/\S*/);
    if (m) { clearTimeout(t); resolve(m[0]); }
  };
  server.stdout.on('data', scan);
  server.stderr.on('data', scan);
  server.on('exit', (c) => reject(new Error(`preview exited early (code ${c})`)));
});
log(`preview: ${baseUrl}`);

function shutdown(code) {
  try { server.kill(); } catch { /* ignore */ }
  process.exit(code);
}

/* ── Drive the page ─────────────────────────────────────── */
// Prefer the installed Edge channel (no download); fall back to Playwright's
// bundled Chromium for CI (run `npx playwright install chromium` first).
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
} catch {
  try {
    browser = await chromium.launch({ headless: true });
  } catch (e) {
    log(`could not launch a browser: ${e.message}`);
    log('install one with: npx playwright install chromium');
    shutdown(1);
  }
}
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(baseUrl, { waitUntil: 'networkidle' });

async function check(name, fn) {
  try { const r = await fn(); log(`  ✓ ${name}${r ? ' — ' + r : ''}`); }
  catch (e) { log(`  ✗ ${name} — ${e.message}`); errors.push(`${name}: ${e.message}`); }
}

log('\n== presence ==');
for (const sel of ['#app', '#lesson-panel', '#panel-a', '#misconception', '#mental-box',
  '#predict-toggle', '#panel-budget', '#panel-sources', '#panel-challenge', '#panel-glossary']) {
  await check(sel, async () => { if (!(await page.locator(sel).count())) throw new Error('missing'); });
}
await check('panel count', async () => `${await page.locator('section.panel').count()} panels`);

log('\n== guided lesson ==');
await check('start lesson', async () => { await page.click('#lesson-start'); return await page.textContent('#lesson-progress'); });
for (let i = 0; i < 4; i++) {
  await check(`next ${i + 1}`, async () => { await page.click('#lesson-next'); return await page.textContent('#lesson-progress'); });
}

log('\n== prediction mode ==');
await check('exit lesson + reset', async () => { await page.click('#lesson-exit'); await page.click('#reset-btn'); });
await check('toggle predict', async () => { await page.check('#predict-toggle'); });
await check('step shows prompt', async () => {
  await page.click('#step-btn');
  if (!(await page.locator('.predict-choice').count())) throw new Error('no choices');
});
await check('commit guess reveals', async () => {
  await page.locator('.predict-choice').first().click();
  if (!(await page.locator('.predict-result').count())) throw new Error('no result');
  return (await page.textContent('.predict-result')).slice(0, 60);
});

log('\n== mental models ==');
for (const v of ['algebra', 'amplitudes', 'geometry']) {
  await check(`view ${v}`, async () => {
    await page.click(`.mental-btn[data-view="${v}"]`);
    const t = await page.textContent('#mental-box');
    if (!t || t.length < 20) throw new Error('empty box');
    return t.slice(0, 40);
  });
}

log('\n== oracle budget ==');
await check('select AES-128', async () => {
  await page.selectOption('#budget-selector', '128');
  const t = await page.textContent('#budget-box');
  if (!t.includes('2^64')) throw new Error('missing 2^64');
  return '2^64 shown';
});

log('\n== challenge ==');
await check('answer Q1', async () => {
  await page.locator('.challenge-opt').first().click();
  const fb = await page.textContent('.challenge-card .challenge-feedback');
  if (!fb || !fb.trim()) throw new Error('no feedback');
  return fb.slice(0, 40);
});

log('\n== collapsible references ==');
await check('sources collapsed by default', async () => {
  if (await page.locator('#panel-sources .sources-table').isVisible()) throw new Error('table visible while collapsed');
});
await check('sources expands on click', async () => {
  await page.click('#panel-sources .ref-details > summary');
  if (!(await page.locator('#panel-sources .sources-table').isVisible())) throw new Error('table not shown after open');
});
await check('glossary expands on click', async () => {
  await page.click('#panel-glossary .ref-details > summary');
  if (!(await page.locator('#panel-glossary .glossary').isVisible())) throw new Error('glossary not shown after open');
});

log('\n== misconception reactive ==');
await check('misconception non-empty', async () => {
  const t = await page.textContent('#misconception');
  if (!t || t.length < 20) throw new Error('empty');
  return t.slice(0, 40);
});

await browser.close();

log(`\n== ${errors.length} console/page error(s) ==`);
errors.forEach((e) => log('  !! ' + e));
shutdown(errors.length ? 1 : 0);
