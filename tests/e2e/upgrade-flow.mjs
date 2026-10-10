/* The database upgrade from version 1 (4.2) to version 2 (4.3, checkpoint d):
 * no data lost, and an older tab still open is handled out loud.
 *
 *   1. 4.2.1 (taken from git) is used: a deal, a photo, a task, a backup.
 *      The new app opens at the same address while the 4.2 tab is still
 *      open: 4.2 lets go of the database, the upgrade runs, and everything is
 *      there, the photo byte for byte. An edit made afterwards in the old tab
 *      can't be saved there, but its recovery copy brings it back on reload.
 *      The 4.2 backup restores into the new app.
 *   2. A tab that holds the database open and doesn't let go: the new tab
 *      says why it is waiting, and carries on once that tab closes.
 *   3. A newer version takes the database from a 4.3 tab: that tab says to
 *      reload to finish updating, keeps the edit made meanwhile in its
 *      recovery copy, and doesn't fail quietly.
 * Both apps are served on one port, one after the other, as a deploy does.
 * Service workers are blocked here: this is about storage, not the cache. */
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import { phone } from './lib.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const F = new URL('./files/', import.meta.url).pathname;
const OLD_COMMIT = process.env.OLD_COMMIT || 'd7db07d'; // 4.2.1 on main: database version 1
const OLD_DIR = `${F}old-42/`;
const PORT = Number(process.env.UPGRADE_PORT || 8098);
const URL0 = `http://localhost:${PORT}/`;
const R = []; const check = (n, c, d = '') => R.push([c ? 'PASS' : 'FAIL', n, d]);

fs.rmSync(OLD_DIR, { recursive: true, force: true });
fs.mkdirSync(OLD_DIR, { recursive: true });
execFileSync('sh', ['-c', `git -C "${ROOT}" archive ${OLD_COMMIT} | tar -x -C "${OLD_DIR}"`]);

let server = null;
async function serve(dir) {
  if (server) { server.kill(); await new Promise((r) => server.once('exit', r)); }
  server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', dir], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(URL0); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  throw new Error(`no server on ${PORT}`);
}
process.on('exit', () => { if (server) server.kill(); });

const desk = { viewport: { width: 1360, height: 900 }, isMobile: false, hasTouch: false, userAgent: undefined, deviceScaleFactor: 1, serviceWorkers: 'block' };
const version = (page) => page.evaluate(async () => ((await indexedDB.databases()).find((d) => d.name === 'zlatura') || {}).version);
// everything in the database, with each Blob as its size and first bytes, for a before/after comparison
const dump = (page) => page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('zlatura');
  r.onsuccess = async () => {
    const db = r.result; const out = {};
    const enc = async (v) => {
      if (v instanceof Blob) return `blob:${v.size}:${Array.from(new Uint8Array(await v.slice(0, 32).arrayBuffer())).join('.')}`;
      if (Array.isArray(v)) return Promise.all(v.map(enc));
      if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v).sort()) o[k] = await enc(v[k]); return o; }
      return v;
    };
    for (const name of ['session', 'deals', 'kv', 'meta']) {
      const t = db.transaction(name).objectStore(name);
      const [keys, vals] = await Promise.all([new Promise((ok) => { const g = t.getAllKeys(); g.onsuccess = () => ok(g.result); }), new Promise((ok) => { const g = t.getAll(); g.onsuccess = () => ok(g.result); })]);
      out[name] = await enc(Object.fromEntries(keys.map((k, i) => [String(k), vals[i]])));
    }
    out.stores = [...db.objectStoreNames].sort();
    db.close();
    res(out);
  };
}));
// a deploy changes files at the same address: nothing is kept in the HTTP cache, so no page can reuse the previous build
async function noCache(ctx) {
  await ctx.route('**/*', async (route) => {
    try {
      const res = await route.fetch();
      await route.fulfill({ response: res, headers: { ...res.headers(), 'cache-control': 'no-store' } });
    } catch { await route.abort().catch(() => {}); }
  });
}
const ready = async (page) => { for (let i = 0; i < 40; i++) { if (await page.evaluate(() => !!window.__zlaturaReady).catch(() => false)) return true; await page.waitForTimeout(250); } return false; };

try {
  /* --------------------------- 1. a 4.2 database, then the new app beside the old tab */
  await serve(OLD_DIR);
  const A = await phone(desk);
  await noCache(A.ctx);
  const old = A.page;
  await old.goto(`${URL0}#deal`, { waitUntil: 'load' });
  await old.setInputFiles('#om-file', `${F}om-retail.pdf`);
  await old.waitForSelector('#deal-tiles .tile');
  await old.click('#tab-visit');
  await old.setInputFiles('#photo-file', `${F}photo1.jpg`);
  await old.waitForSelector('#deal-photos .photo img');
  await old.click('#tab-overview');
  await old.fill('#deal-task-title', 'Order the appraisal');
  await old.press('#deal-task-title', 'Enter');
  await old.waitForTimeout(1200);
  await old.click('.sidebar .tab[data-view="settings"]');
  await old.waitForSelector('#settings-data #backup-make');
  const [dl] = await Promise.all([old.waitForEvent('download', { timeout: 30000 }), old.click('#backup-make')]);
  const oldBackup = `${F}backup-4.2.1.json`;
  await dl.saveAs(oldBackup);
  const ob = JSON.parse(fs.readFileSync(oldBackup, 'utf8'));
  check('4.2.1 made a backup (format version 1)', ob.app === '4.2.1' && ob.version === 1 && ob.deals.length === 1, `${ob.app} v${ob.version}`);
  await old.click('.sidebar .tab[data-view="deal"]');
  await old.waitForSelector('#deal-tiles .tile');
  check('4.2.1 keeps its data in database version 1', (await version(old)) === 1);
  const before = await dump(old);
  check('before: one deal with one photo, a task, the backup noted', Object.keys(before.deals).length === 1 && Object.values(before.deals)[0].visit.photos.length === 1 && /Order the appraisal/.test(JSON.stringify(before.kv['crm.tasks'])) && !!before.kv['backup.last']);

  await serve(ROOT);
  const fresh = await A.ctx.newPage();
  await fresh.goto(`${URL0}#deal`, { waitUntil: 'load' });
  check('the new app loads at the same address, with the old tab still open', await ready(fresh));
  await fresh.waitForSelector('#deal-tiles .tile', { timeout: 20000 });
  check('the database is upgraded to version 2', (await version(fresh)) === 2);
  const after = await dump(fresh);
  check('the upgrade adds the history, snapshot and trash stores', ['history', 'snapshots', 'trash'].every((s) => after.stores.includes(s)), after.stores.join(', '));
  for (const s of ['session', 'deals', 'kv']) check(`nothing in “${s}” changed or went missing`, JSON.stringify(after[s]) === JSON.stringify(before[s]), s);
  check('the photo is there, byte for byte', JSON.stringify(Object.values(after.deals)[0].visit.photos) === JSON.stringify(Object.values(before.deals)[0].visit.photos));
  check('no storage warning: the old tab let go', (await fresh.$('#storage-banner')) === null);

  // the old tab: an edit it can no longer save stays in its recovery copy, and comes back
  await old.fill('#fig-noi', '412,345');
  await old.press('#fig-noi', 'Tab');
  await old.waitForTimeout(1200);
  const kept = await old.evaluate(() => JSON.parse(localStorage.getItem('zlatura.deal.unsaved') || 'null'));
  check('the old tab’s edit, unsaved there, is kept in its recovery copy', kept && kept.figures && kept.figures.noi === 412345, kept && kept.figures && kept.figures.noi);
  await old.reload({ waitUntil: 'load' });
  await ready(old);
  await old.waitForSelector('#fig-noi', { timeout: 20000 });
  await old.waitForTimeout(1200);
  check('reloaded (now the new app), the edit is back and saved', (await old.inputValue('#fig-noi')).replace(/\D/g, '') === '412345' && (await old.evaluate(() => localStorage.getItem('zlatura.deal.unsaved'))) === null, await old.inputValue('#fig-noi'));

  // the 4.2.1 backup restores into the new app (merge)
  await fresh.close();
  await old.click('.sidebar .tab[data-view="settings"]');
  await old.waitForSelector('#settings-data #backup-file', { state: 'attached' });
  await old.setInputFiles('#backup-file', oldBackup);
  await old.waitForSelector('dialog.action-sheet');
  await old.locator('dialog.action-sheet .action-item', { hasText: 'Replace everything on this device' }).click();
  await old.waitForSelector('dialog.action-sheet .action-item:has-text("Yes, replace everything")');
  await Promise.all([old.waitForEvent('load', { timeout: 30000 }), old.locator('dialog.action-sheet .action-item', { hasText: 'Yes, replace everything' }).click()]);
  await ready(old);
  await old.waitForTimeout(1000);
  const restored = await dump(old);
  const rd = Object.values(restored.deals)[0];
  check('the 4.2.1 backup restores into the new app: the deal and its photo, byte for byte', Object.keys(restored.deals).length === 1 && JSON.stringify(rd.visit.photos) === JSON.stringify(Object.values(before.deals)[0].visit.photos) && rd.figures.noi === 393450, `${Object.keys(restored.deals).length} deals, NOI ${rd.figures.noi}`);
  const errA = A.errors.filter((e) => !/Service Worker registration blocked/.test(e));
  check('no unexpected errors (the old tab’s failed save aside)', errA.length === 0, errA.join(' | '));
  await A.browser.close();

  /* --------------------------- 2. a tab that won't let go: the new one says why it waits */
  await serve(OLD_DIR);
  const B = await phone(desk);
  await noCache(B.ctx);
  await B.page.goto(`${URL0}#deal`, { waitUntil: 'load' });
  await B.page.setInputFiles('#om-file', `${F}om-retail.pdf`);
  await B.page.waitForSelector('#deal-tiles .tile');
  await B.page.waitForTimeout(1200);
  // a connection with no versionchange handler: an upgrade must wait for it
  await B.page.evaluate(() => new Promise((res) => { const r = indexedDB.open('zlatura'); r.onsuccess = () => { window.__hold = r.result; res(); }; }));
  await serve(ROOT);
  const y = await B.ctx.newPage();
  await y.goto(`${URL0}#deal`, { waitUntil: 'load' });
  const banner = await y.waitForSelector('#storage-banner[data-state="blocked"]', { timeout: 15000 }).then((h) => h.textContent(), () => '');
  check('blocked by an older tab: the new tab says so and how to finish', /still open in another tab on the older version/.test(banner) && /Close or reload that tab/.test(banner), banner);
  await B.page.evaluate(() => window.__hold.close());
  await B.page.close();
  const gone = await y.waitForSelector('#storage-banner', { state: 'detached', timeout: 15000 }).then(() => true, () => false);
  check('once that tab closes, the update finishes and the message goes', gone && (await version(y)) === 2);
  await y.waitForSelector('#deal-tiles .tile', { timeout: 20000 });
  check('and the deal is there', /4410 Example Avenue NW/.test(await y.textContent('#view-deal')));
  await B.browser.close();

  /* --------------------------- 3. a newer version takes the database: reload to finish */
  const C = await phone(desk);
  await noCache(C.ctx);
  await C.page.goto(`${URL0}#deal`, { waitUntil: 'load' });
  await C.page.setInputFiles('#om-file', `${F}om-retail.pdf`);
  await C.page.waitForSelector('#deal-tiles .tile');
  await C.page.waitForTimeout(1200);
  const newer = await C.ctx.newPage();
  await newer.goto(`${URL0}manifest.webmanifest`);
  await newer.evaluate(() => new Promise((res, rej) => { const r = indexedDB.open('zlatura', 3); r.onupgradeneeded = () => {}; r.onsuccess = () => { r.result.close(); res(); }; r.onerror = () => rej(r.error); }));
  const out = await C.page.waitForSelector('#storage-banner[data-state="outdated"]', { timeout: 15000 }).then((h) => h.textContent(), () => '');
  check('updated in another tab: this one says to reload to finish', /updated in another tab\. Reload to finish updating/.test(out) && !!(await C.page.$('#storage-banner button')), out);
  await C.page.fill('#fig-noi', '421,000');
  await C.page.press('#fig-noi', 'Tab');
  await C.page.waitForTimeout(1200);
  const kept3 = await C.page.evaluate(() => JSON.parse(localStorage.getItem('zlatura.deal.unsaved') || 'null'));
  check('an edit made meanwhile is kept in the recovery copy, not lost', kept3 && kept3.figures && kept3.figures.noi === 421000);
  await C.browser.close();
} finally {
  if (server) server.kill();
}

for (const [s, n, x] of R) console.log(s, '|', n, x ? `| ${x}` : '');
console.log('PASS', R.filter((x) => x[0] === 'PASS').length, 'FAIL', R.filter((x) => x[0] === 'FAIL').length);
