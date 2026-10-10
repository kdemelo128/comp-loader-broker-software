/* The migration registry (app/migrate.js) in the browser, on a real old
 * backup: deals read by the version before the rent roll and backed up by
 * 3.1.0 without being opened (tests/fixtures/backup-3.1.0-before-rent-roll.json).
 *
 *   1. Restored: each deal is brought up to date as it is stored, before
 *      anything opens it, and the restore sheet and each deal's history say
 *      so. (Before the registry, a deal stayed in its old shape until opened.)
 *   2. Opened: the deal on screen, and the deal stored, are what the code
 *      before the registry gives (taken from git, OLD_COMMIT, run side by
 *      side on another port); opening it again changes nothing.
 *   3. A deal in its old shape opened directly (as one never restored, from
 *      before 4.1): its rounding and its new rent roll are two history
 *      entries, each with its own changes.
 *   4. A backup holding a deal saved by a newer version is refused, and
 *      nothing is restored. */
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import { phone, BASE, SHOTS } from './lib.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const F = new URL('./files/', import.meta.url).pathname;
const FIX = `${ROOT}tests/fixtures/backup-3.1.0-before-rent-roll.json`;
const OLD_COMMIT = process.env.OLD_COMMIT || '3a2e05d'; // 4.4.1: the code before the registry
const OLD_DIR = `${F}old-migrate/`;
const OLD_PORT = Number(process.env.MIGRATE_PORT || 8096);
const OLD = `http://localhost:${OLD_PORT}/`;
const R = []; const check = (n, c, d = '') => R.push([c ? 'PASS' : 'FAIL', n, d]);

fs.rmSync(OLD_DIR, { recursive: true, force: true });
fs.mkdirSync(OLD_DIR, { recursive: true });
execFileSync('sh', ['-c', `git -C "${ROOT}" archive ${OLD_COMMIT} | tar -x -C "${OLD_DIR}"`]);
const server = spawn('python3', ['-m', 'http.server', String(OLD_PORT), '--bind', '127.0.0.1', '--directory', OLD_DIR], { stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let i = 0; i < 50; i++) { try { await fetch(OLD); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }

const { browser, page, errors } = await phone({ serviceWorkers: 'block' });
const oldCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
const oldPage = await oldCtx.newPage();

const idb = (p, store, fn = 'getAll') => p.evaluate(([s, f]) => new Promise((res) => { const r = indexedDB.open('zlatura'); r.onsuccess = () => { const g = r.result.transaction(s).objectStore(s)[f](); g.onsuccess = () => res(g.result); }; }), [store, fn]);
const deals = async (p) => Object.fromEntries((await idb(p, 'deals')).map((d) => [d.figures.address || d.name, d]));
const historyOf = (p, id) => p.evaluate((dealId) => new Promise((res) => { const r = indexedDB.open('zlatura'); r.onsuccess = () => { const g = r.result.transaction('history').objectStore('history').getAll(IDBKeyRange.bound([dealId, 0], [dealId, Infinity])); g.onsuccess = () => res(g.result); }; }), id);
// a stored deal without what is new every time (lease ids, the time it was saved)
const comparable = (d) => JSON.parse(JSON.stringify({ ...d, updatedAt: 0, rr: d.rr && { ...d.rr, leases: d.rr.leases.map(({ id, ...l }) => l) } }));
async function restore(p, base, file) {
  await p.goto(`${base}#settings`, { waitUntil: 'load' });
  await p.waitForSelector('#settings-data #backup-file', { state: 'attached' });
  await p.setInputFiles('#backup-file', file);
  await p.waitForSelector('dialog.action-sheet');
  const sheet = await p.textContent('dialog.action-sheet');
  await Promise.all([p.waitForEvent('load', { timeout: 30000 }), p.locator('dialog.action-sheet .action-item', { hasText: 'Merge into this device' }).click()]);
  await p.waitForTimeout(800);
  return sheet;
}
async function open(p, base, id) {
  // the deal last open is opened as the app starts
  await p.evaluate((x) => localStorage.setItem('zlatura.deal.current', x), id);
  await p.goto(`${base}#deal`, { waitUntil: 'load' });
  await p.reload({ waitUntil: 'load' });
  try { await p.waitForSelector('#tab-rentroll', { timeout: 15000 }); await p.waitForFunction((x) => localStorage.getItem('zlatura.deal.current') === x, id); } catch (e) { await p.screenshot({ path: `${SHOTS}migrate-fail.png` }); console.log((await p.textContent('body')).replace(/\s+/g, ' ').slice(0, 500)); throw e; }
  await p.waitForTimeout(1200); // the rent roll's save, debounced
  await p.click('#tab-rentroll');
  await p.waitForSelector('#deal-rentroll table');
  await p.waitForTimeout(600);
}
// what the deal screen shows, without what differs by version or by the minute
const shown = (p) => p.evaluate(() => {
  const text = (sel) => [...document.querySelectorAll(sel)].map((e) => e.innerText).join('\n');
  return [text('#deal-root h1'), text('#deal-tiles'), text('#deal-root .deal-analysis, #deal-analysis'), text('#deal-rentroll table')].join('\n')
    .replace(/\b\d+\.\d+\.\d+\b/g, 'v').replace(/updated [^\n·]*/gi, 'updated');
});

// ---- 1. restored: brought up to date before anything opens it
const sheet = await restore(page, BASE, FIX);
check('the restore sheet says which deals an older version saved, and what bringing them up to date changes',
  /3 deals saved by an older version are brought up to date as they are restored: money rounded to whole cents \(1\), rent roll set up \(3\)/.test(sheet), sheet.replace(/\s+/g, ' ').slice(0, 300));
let after = await deals(page);
check('3 deals restored', Object.keys(after).length === 3, Object.keys(after).join(' / '));
check('each is up to date before it is opened: a rent roll, schema 2, money version 1',
  Object.values(after).every((d) => d.rr && d.schema === 2 && d.moneyVersion === 1),
  Object.values(after).map((d) => `${d.figures.address}: rr ${!!d.rr} schema ${d.schema} money ${d.moneyVersion}`).join(' / '));
const ex = after['4410 Example Avenue NW'];
check('the OM’s five rent roll rows became five leases', ex && ex.rr && ex.rr.leases.length === 5);
const h0 = ex ? await historyOf(page, ex.id) : [];
const restoredEntry = h0.find((e) => /^Restored from the backup/.test(e.label));
check('its history says it was brought up to date as it was restored',
  !!restoredEntry && /Restored from the backup of .*, and brought up to date: money rounded to whole cents, rent roll set up/.test(restoredEntry.label), restoredEntry && restoredEntry.label);
const roundingLog = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('zlatura'); r.onsuccess = () => { const g = r.result.transaction('meta').objectStore('meta').get('rounding'); g.onsuccess = () => res(g.result); }; }));
check('the value it rounded is in the rounding log', !!roundingLog && roundingLog.entries.some((e) => /4410 Example Avenue NW/.test(e.where)), JSON.stringify(roundingLog && roundingLog.entries.slice(-2)));

// ---- 2. opened: the same deal, on screen and stored, as the code before the registry gives
await restore(oldPage, OLD, FIX);
const oldBefore = await deals(oldPage);
check(`(old code, ${OLD_COMMIT}) the restored deals were still in their old shape`, Object.values(oldBefore).every((d) => !d.rr), Object.values(oldBefore).map((d) => `${d.figures.address}: rr ${!!d.rr}`).join(' / '));
for (const name of Object.keys(after)) {
  await open(page, BASE, after[name].id);
  await open(oldPage, OLD, after[name].id);
  const [a, b] = [await shown(page), await shown(oldPage)];
  check(`${name}: the deal screen shows what it showed before`, a === b && a.includes(name.split(' ')[0]) && a.length > 100, a === b ? `${a.length} characters: ${a.slice(0, 80).replace(/\n/g, " | ")}` : `new: ${a.slice(0, 300)} | old: ${b.slice(0, 300)}`);
  const [na, ob] = [(await deals(page))[name], (await deals(oldPage))[name]];
  const [ca, cb] = [comparable(na), comparable(ob)];
  const same = JSON.stringify(ca) === JSON.stringify(cb);
  let diff = '';
  if (!same) for (const k of new Set([...Object.keys(ca), ...Object.keys(cb)])) if (JSON.stringify(ca[k]) !== JSON.stringify(cb[k])) diff += `${k}: ${String(JSON.stringify(ca[k])).slice(0, 160)} vs ${String(JSON.stringify(cb[k])).slice(0, 160)}; `;
  check(`${name}: the stored deal is what the code before the registry stores`, same, diff);
}
const h1 = await historyOf(page, ex.id);
await open(page, BASE, ex.id);
const h2 = await historyOf(page, ex.id);
check('opening it again adds nothing to its history', h2.length === h1.length, `${h1.length} → ${h2.length}`);
check('no “Rent roll set up” entry after the restore brought it up to date', !h2.some((e) => e.label === 'Rent roll set up'), h2.map((e) => e.label).join(' / '));
await page.screenshot({ path: `${SHOTS}migrate-opened.png` });

// ---- 3. an old-shape deal opened directly: each step its own history entry
const raw = JSON.parse(fs.readFileSync(FIX, 'utf8')).deals.find((d) => d.figures.address === '4410 Example Avenue NW');
const direct = { ...raw, id: 'dmigrate1', name: 'Direct from 3.1' };
await page.evaluate((d) => new Promise((res) => { const r = indexedDB.open('zlatura'); r.onsuccess = () => { const t = r.result.transaction('deals', 'readwrite'); t.objectStore('deals').put(d, d.id); t.oncomplete = res; }; }), direct);
await open(page, BASE, direct.id);
const hd = await historyOf(page, direct.id);
const rnd = hd.find((e) => e.kind === 'rounding' && /Stored money rounded/.test(e.label));
const made = hd.find((e) => e.label === 'Rent roll set up');
check('opened directly: the rounding is an entry of its own, with only the value it rounded', !!rnd && (rnd.changes || []).length >= 1 && (rnd.changes || []).every((c) => !/^rr\b|rr\./.test(c.path || '')), hd.map((e) => `${e.kind}:${e.label}:${(e.changes || []).length}`).join(' / '));
check('and the new rent roll is the next entry, holding the rent roll', !!made && (made.changes || []).some((c) => /rr/.test(JSON.stringify(c.path || c.key || c))), made && JSON.stringify(made.changes).slice(0, 200));
const storedDirect = (await deals(page))['4410 Example Avenue NW'] && (await idb(page, 'deals')).find((d) => d.id === direct.id);
check('and it is stored up to date', storedDirect && storedDirect.rr && storedDirect.schema === 2 && storedDirect.moneyVersion === 1);

// ---- 4. a backup with a deal from a newer version is refused, nothing restored
const newer = JSON.parse(fs.readFileSync(FIX, 'utf8'));
newer.deals[0].schema = 99; newer.deals[0].id = 'dfuture'; newer.deals[1].id = 'dfuture2'; newer.deals[2].id = 'dfuture3';
fs.writeFileSync(`${F}backup-newer-deal.json`, JSON.stringify(newer));
const count0 = (await idb(page, 'deals')).length;
await page.goto(`${BASE}#settings`, { waitUntil: 'load' });
await page.waitForSelector('#settings-data #backup-file', { state: 'attached' });
await page.setInputFiles('#backup-file', `${F}backup-newer-deal.json`);
await page.waitForTimeout(800);
const toastText = await page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' '));
const sheetOpen = await page.locator('dialog.action-sheet[open]').count();
check('a backup holding a deal saved by a newer version is refused, saying which', /saved by a newer version of Zlatura \(“8820 Sample Pike”\): update the app first\. Nothing was restored\./.test(toastText) && !sheetOpen, toastText);
check('and nothing is restored', (await idb(page, 'deals')).length === count0);

for (const r of R) console.log(r.join(' | '));
console.log(`PASS ${R.filter((r) => r[0] === 'PASS').length} FAIL ${R.filter((r) => r[0] === 'FAIL').length} errors`, errors.filter((e) => !/Service Worker registration blocked/.test(e)));
await browser.close();
process.exit(R.some((r) => r[0] === 'FAIL') ? 1 : 0);
