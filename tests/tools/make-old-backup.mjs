/* Make tests/fixtures/backup-3.1.0-before-rent-roll.json with the real old
 * apps, taken from git: deals read from OMs by the version before the rent
 * roll existed (b688872), then a backup made by the first version with
 * backups (62c887d, 3.1.0) without opening them, so they reach the file in
 * their old shape (OM rows only: no `rr`, no `schema`, no `moneyVersion`).
 * The OMs are the suite's invented test PDFs (tests/e2e/make_pdfs.py).
 *
 *   python3 tests/e2e/make_pdfs.py tests/e2e/files
 *   node tests/tools/make-old-backup.mjs [out.json]
 *
 * Needs Chromium with Playwright (as tests/e2e). Run once; the file is kept. */
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import { chromium } from '../e2e/lib.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const F = `${ROOT}tests/e2e/files/`;
const OUT = process.argv[2] || `${ROOT}tests/fixtures/backup-3.1.0-before-rent-roll.json`;
const PORT = Number(process.env.OLD_PORT || 8097);
const URL0 = `http://localhost:${PORT}/`;
const BEFORE_RR = 'b688872'; // deals, but no rent roll yet
const FIRST_BACKUP = '62c887d'; // 3.1.0: backup and restore added

const tmp = fs.mkdtempSync(`${os.tmpdir()}/old-apps-`);
const take = (commit) => { const d = `${tmp}/${commit}/`; fs.mkdirSync(d); execFileSync('sh', ['-c', `git -C "${ROOT}" archive ${commit} | tar -x -C "${d}"`]); return d; };
let server = null;
async function serve(dir) {
  if (server) { server.kill(); await new Promise((r) => server.once('exit', r)); }
  server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', dir], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(URL0); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  throw new Error(`no server on ${PORT}`);
}
process.on('exit', () => { if (server) server.kill(); fs.rmSync(tmp, { recursive: true, force: true }); });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, serviceWorkers: 'block', acceptDownloads: true });
// routing every request turns off the HTTP cache, so the second app isn't served the first one's files
await ctx.route('**/*', (r) => r.continue());
const sheetAction = (page, label) => page.locator('.action-sheet .action-item', { hasText: label }).first().click();

// 1. the version before the rent roll: three deals from three OMs, the last one left open
await serve(take(BEFORE_RR));
let page = await ctx.newPage();
await page.goto(`${URL0}#deal`, { waitUntil: 'load' });
const oms = [['om-retail.pdf', '4410'], ['om-multifamily.pdf', null], ['om-netlease.pdf', '8820']];
for (const [i, [file, name]] of oms.entries()) {
  if (i) { await page.click('#deal-root .view-head button[aria-label="More deal actions"]'); await sheetAction(page, 'Scan another OM'); await page.waitForTimeout(200); }
  await page.setInputFiles('#om-file', F + file);
  await page.waitForSelector('#deal-tiles .tile');
  if (name) await page.waitForFunction((n) => document.querySelector('#deal-root h2')?.textContent.includes(n), name);
  await page.waitForTimeout(600); // the debounced save
}
await page.close();

// 2. 3.1.0 at the same address: the backup, made from Home without opening the first two deals
await serve(take(FIRST_BACKUP));
page = await ctx.newPage();
page.on('pageerror', (e) => console.error(`[3.1.0] ${e.message}`));
await page.goto(`${URL0}#home`, { waitUntil: 'load' });
try { await page.waitForSelector('#home-data #backup-make', { timeout: 15000 }); } catch (e) { console.error((await page.textContent('body')).replace(/\s+/g, ' ').slice(0, 600)); throw e; }
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#backup-make')]);
await dl.saveAs(OUT);
await browser.close();

const j = JSON.parse(fs.readFileSync(OUT, 'utf8'));
for (const d of j.deals) console.log(`${d.name || d.figures.address}: ${(d.rentRoll || []).length} OM rows, rr ${d.rr ? 'yes' : 'no'}, schema ${d.schema ?? 'none'}, moneyVersion ${d.moneyVersion ?? 'none'}`);
process.exit(0);
