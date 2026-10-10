/* The rename from Comp Loader to Zlatura, as a person meets it: the old app
 * (3.3.0, taken from git) is used on a site, then the new app replaces it at
 * the same address and opens with everything there. Then the move finishes
 * once a backup is made, and a backup made by the old app restores into a
 * fresh copy of the new one.
 *
 * Both apps are served here on one port (one origin, so one browser storage),
 * one after the other, the way a deploy replaces the files. The old backup
 * this makes is also kept as tests/fixtures/backup-comp-loader-3.3.0.json. */
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import { phone } from './lib.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const F = new URL('./files/', import.meta.url).pathname;
const OLD_COMMIT = '8ddc4e9'; // 3.3.0, the last release named Comp Loader (on main)
const OLD_DIR = `${F}old-app/`;
const PORT = Number(process.env.RENAME_PORT || 8097);
const URL0 = `http://localhost:${PORT}/`;
const R = []; const check = (n, c, d = '') => R.push([c ? 'PASS' : 'FAIL', n, d]);

fs.rmSync(OLD_DIR, { recursive: true, force: true });
fs.mkdirSync(OLD_DIR, { recursive: true });
execFileSync('sh', ['-c', `git -C "${ROOT}" archive ${OLD_COMMIT} | tar -x -C "${OLD_DIR}"`]);

let server = null;
async function serve(dir) {
  if (server) { server.kill(); await new Promise((r) => server.once('exit', r)); }
  server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', dir], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { await fetch(URL0); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error(`no server on ${PORT}`);
}
const stop = () => { if (server) server.kill(); };
process.on('exit', stop);

const desk = { viewport: { width: 1360, height: 900 }, isMobile: false, hasTouch: false, userAgent: undefined, deviceScaleFactor: 1 };
const dbNames = (page) => page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name).sort());
const meta = (page) => page.evaluate(() => new Promise((res) => { const r = indexedDB.open('zlatura'); r.onsuccess = () => { const g = r.result.transaction('meta').objectStore('meta').get('rename'); g.onsuccess = () => { res(g.result || null); r.result.close(); }; }; }));
const kv = (page, db, k) => page.evaluate(([name, key]) => new Promise((res) => { const r = indexedDB.open(name); r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get(key); g.onsuccess = () => { res(g.result ?? null); r.result.close(); }; }; }), [db, k]);

try {
  // ------------------------------------------------ the old app, in use
  await serve(OLD_DIR);
  const { browser, page, errors } = await phone(desk);
  if (process.env.DEBUG_NAV) page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log('NAV', f.url(), new Date().toISOString().slice(17, 23)); });
  await page.goto(URL0 + '#comps', { waitUntil: 'load' });
  check('the old app is the one being served', (await page.title()).includes('Comp Loader'), await page.title());
  await page.setInputFiles('#file', F + 'costar-comps.pdf');
  await page.waitForFunction(() => document.querySelectorAll('#sales-table tbody tr').length > 0, null, { timeout: 20000 });
  const compsBefore = await page.locator('#sales-table tbody tr').count();
  await page.click('.sidebar .tab[data-view="deal"]');
  await page.setInputFiles('#om-file', F + 'om-retail.pdf');
  await page.waitForSelector('#deal-tiles .tile');
  await page.setInputFiles('#photo-file', F + 'photo1.jpg');
  await page.fill('#deal-task-title', 'Call the listing broker');
  await page.press('#deal-task-title', 'Enter');
  await page.waitForFunction(() => /Call the listing broker/.test(document.querySelector('#deal-crm').textContent));
  await page.locator('#deal-crm button', { hasText: '+ New contact' }).click();
  await page.fill('#contact-name', 'Dana Whitlock');
  await page.fill('#contact-company', 'Harbor Capital Advisors');
  await page.click('#contact-save');
  await page.waitForFunction(() => /Dana Whitlock/.test(document.querySelector('#deal-crm').textContent));
  await page.fill('#loan-ltv', '60');
  await page.press('#loan-ltv', 'Tab');
  await page.click('.sidebar [data-theme-set="dark"]');
  await page.waitForTimeout(1200); // past the save debounce
  await page.click('.sidebar .tab[data-view="settings"]');
  await page.waitForSelector('#settings-data #backup-make');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#backup-make')]);
  const oldBackup = `${F}old-backup.json`;
  await dl.saveAs(oldBackup);
  const ob = JSON.parse(fs.readFileSync(oldBackup, 'utf8'));
  check('the old app made a backup in its own format', ob.format === 'comp-loader-backup' && ob.app === '3.3.0' && ob.deals.length === 1 && 'comp-loader.loan.v1' in ob.local, `${ob.format} ${ob.app}`);
  check('old storage is what it was', JSON.stringify(await dbNames(page)) === '["comp-loader"]', JSON.stringify(await dbNames(page)));
  const oldErrors = errors.splice(0);

  // ---------------------------------- the new app replaces it at the same address
  await serve(ROOT);
  let ready = false;
  let loads = 0;
  for (; loads < 12 && !ready; loads++) {
    // the old service worker answers from its cache until the new one has installed and taken over,
    // as on a real phone (where the app then offers "a new version is ready")
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1500);
    ready = await page.evaluate(() => !!window.__zlaturaReady).catch(() => false);
  }
  if (process.env.DEBUG_NAV) console.log('ready', ready, 'after', loads, 'loads', new Date().toISOString().slice(17, 23));
  check('the new app loads at the same address', ready && (await page.title()).includes('Zlatura'), await page.title());
  await page.waitForLoadState('load');
  await page.waitForTimeout(800);
  const m = await meta(page);
  check('the old database was copied across, all of it', m && m.from === 'comp-loader' && m.copied === true && m.counts.deals === 1 && m.counts.kv >= 3 && m.counts.session === 1, JSON.stringify(m));
  check('the old database is kept for now', JSON.stringify(await dbNames(page)) === '["comp-loader","zlatura"]', JSON.stringify(await dbNames(page)));
  const ls = await page.evaluate(() => ({ ...localStorage }));
  check('settings moved to the new names; the old ones are kept for now', ls['zlatura.loan.v1'] && ls['comp-loader.loan.v1'] && ls['zlatura.theme'] === 'dark' && ls['zlatura.renamed'], Object.keys(ls).sort().join(', '));
  check('the dark theme is still chosen', (await page.getAttribute('html', 'data-theme')) === 'dark');
  await page.click('.sidebar .tab[data-view="home"]');
  await page.waitForSelector('#home-continue .cont-row');
  check('Home lists the deal made in the old app', /4410 Example Avenue NW/.test(await page.textContent('#home-continue')));
  check('the task and the contact are there', /Call the listing broker/.test(await page.textContent('#home-tasks')) && /Dana Whitlock/.test(await page.textContent('#home-contacts')));
  await page.locator('#home-continue .cont-row').first().click();
  await page.waitForSelector('#deal-tiles .tile');
  check('the loan terms remembered by the old app are used', (await page.inputValue('#loan-ltv')) === '60');
  check('the site-visit photo came across', (await kv(page, 'zlatura', 'crm.contacts')) !== null && await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('zlatura'); r.onsuccess = () => { const g = r.result.transaction('deals').objectStore('deals').getAll(); g.onsuccess = () => res(g.result[0].visit.photos.length === 1 && g.result[0].visit.photos[0].blob instanceof Blob); }; })));
  await page.click('.sidebar .tab[data-view="comps"]');
  await page.waitForFunction(() => document.querySelectorAll('#sales-table tbody tr').length > 0, null, { timeout: 20000 });
  check('the comp set came across', (await page.locator('#sales-table tbody tr').count()) === compsBefore, String(compsBefore));
  await page.click('.sidebar .tab[data-view="settings"]');
  await page.waitForSelector('#settings-data #backup-make');
  check('Settings says the data moved and the old copy is kept', /moved here from Comp Loader/.test(await page.textContent('#settings-data')));
  check('Settings shows the tagline and the name’s meaning', /Every source\. Every assumption\. Every number\./.test(await page.textContent('#settings-about')) && /zlato/.test(await page.textContent('#settings-about')));

  // a backup made now makes the old copy safe to delete
  const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#backup-make')]);
  check('a backup is now named and formatted for Zlatura', /^Zlatura backup /.test(dl2.suggestedFilename()) && JSON.parse(fs.readFileSync(await dl2.path(), 'utf8')).format === 'zlatura-backup', dl2.suggestedFilename());
  await page.waitForTimeout(800);
  check('after that backup the old database is deleted', JSON.stringify(await dbNames(page)) === '["zlatura"]', JSON.stringify(await dbNames(page)));
  const ls2 = await page.evaluate(() => Object.keys(localStorage));
  check('and the old settings keys are removed', !ls2.some((k) => k.startsWith('comp-loader.')) && ls2.includes('zlatura.loan.v1'), ls2.join(', '));
  check('the move is recorded as finished', !!(await meta(page)).finishedAt);
  await page.reload({ waitUntil: 'load' });
  await page.click('.sidebar .tab[data-view="home"]');
  await page.waitForSelector('#home-continue .cont-row');
  check('everything is still there after the old copy is gone', /4410 Example Avenue NW/.test(await page.textContent('#home-continue')));
  const newErrors = errors.splice(0);
  await browser.close();

  // ------------------------- a fresh device: the old app's backup restores
  const P = await phone(desk);
  await P.page.goto(URL0 + '#settings', { waitUntil: 'load' });
  await P.page.waitForSelector('#settings-data #backup-file', { state: 'attached' });
  check('a fresh copy has no old database and nothing to move', JSON.stringify(await dbNames(P.page)) === '["zlatura"]' && (await meta(P.page)).from === null);
  await P.page.setInputFiles('#backup-file', oldBackup);
  await P.page.waitForSelector('dialog.action-sheet');
  await Promise.all([P.page.waitForEvent('load', { timeout: 30000 }), P.page.locator('dialog.action-sheet .action-item', { hasText: 'Merge into this device' }).click()]);
  await P.page.click('.sidebar .tab[data-view="home"]');
  await P.page.waitForSelector('#home-continue .cont-row');
  check('a pre-rename backup restores: the deal', /4410 Example Avenue NW/.test(await P.page.textContent('#home-continue')));
  check('a pre-rename backup restores: the task and contact', /Call the listing broker/.test(await P.page.textContent('#home-tasks')) && /Dana Whitlock/.test(await P.page.textContent('#home-contacts')));
  const ls3 = await P.page.evaluate(() => ({ ...localStorage }));
  check('a pre-rename backup restores: its settings under the new names', ls3['zlatura.loan.v1'] && JSON.parse(ls3['zlatura.loan.v1']).ltv === 60 && !Object.keys(ls3).some((k) => k.startsWith('comp-loader.')), Object.keys(ls3).join(', '));
  check('a pre-rename backup restores: the photo', await P.page.evaluate(() => new Promise((res) => { const r = indexedDB.open('zlatura'); r.onsuccess = () => { const g = r.result.transaction('deals').objectStore('deals').getAll(); g.onsuccess = () => res(g.result.length === 1 && g.result[0].visit.photos[0].blob.size > 1000); }; })));
  await P.page.click('.sidebar .tab[data-view="comps"]');
  await P.page.waitForFunction(() => document.querySelectorAll('#sales-table tbody tr').length > 0, null, { timeout: 20000 });
  check('a pre-rename backup restores: the comp set', (await P.page.locator('#sales-table tbody tr').count()) === compsBefore);
  await P.browser.close();

  for (const [s, n, d] of R) console.log(s, '|', n, d ? `| ${d}` : '');
  console.log('PASS', R.filter((x) => x[0] === 'PASS').length, 'FAIL', R.filter((x) => x[0] === 'FAIL').length, 'errors', { oldApp: oldErrors, newApp: newErrors, fresh: P.errors });
} finally {
  stop();
  fs.rmSync(OLD_DIR, { recursive: true, force: true });
}
