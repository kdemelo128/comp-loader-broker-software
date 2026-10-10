/* Backups version 2 and the storage limits (checkpoint d, parts C and D):
 *   C. a backup carries each deal's history and snapshots (or leaves them out
 *      when asked); restored on an empty device, Undo and the snapshot work;
 *      a version 1 backup (made by 4.2.1) still restores, and the deal's
 *      history starts with the restore;
 *   D. per deal, 1,000 entries or 2 MB of history (the oldest go, and History
 *      says since when it runs); clearing a deal's history; across deals, the
 *      space allowed (here the browser's quota is made small, so half of it is
 *      under 50 MB): automatic snapshots go first, named ones stay, and
 *      Settings warns from 80%. */
import fs from 'fs';
import { phone, BASE } from './lib.mjs';

const F = new URL('./files/', import.meta.url).pathname;
const R = []; const check = (n, c, d = '') => R.push([c ? 'PASS' : 'FAIL', n, d]);
const DESK = { viewport: { width: 1360, height: 900 }, isMobile: false, hasTouch: false, userAgent: undefined, deviceScaleFactor: 1 };
const settle = (p) => p.waitForTimeout(800);
const openHistory = async (p) => {
  await p.click('button[aria-label="More deal actions"]');
  await p.locator('.action-sheet .action-item', { hasText: 'History' }).click();
  await p.waitForSelector('#snapshots');
};
const backup = async (p, file, withHistory = true) => {
  await p.click('.sidebar .tab[data-view="settings"]');
  await p.waitForSelector('#settings-data #backup-make');
  await p.setChecked('#backup-history', withHistory);
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), p.click('#backup-make')]);
  await dl.saveAs(file);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};
const restoreInto = async (p, file) => {
  await p.click('.sidebar .tab[data-view="settings"]');
  await p.waitForSelector('#settings-data #backup-file', { state: 'attached' });
  await p.setInputFiles('#backup-file', file);
  await p.waitForSelector('dialog.action-sheet');
  await Promise.all([p.waitForEvent('load', { timeout: 30000 }), p.locator('dialog.action-sheet .action-item', { hasText: 'Merge into this device' }).click()]);
  await p.waitForTimeout(1200);
  await p.click('.sidebar .tab[data-view="home"]');
  await p.waitForSelector('#home-continue .cont-row');
  await p.locator('#home-continue .cont-row').first().click();
  await p.waitForSelector('#tab-overview');
  await p.click('#tab-overview');
  await p.waitForSelector('#fig-noi');
  await settle(p);
};

/* ------------------------------------------------- C. backups, version 2 */
const A = await phone(DESK);
let p = A.page;
await p.goto(`${BASE}#deal`, { waitUntil: 'load' });
await p.setInputFiles('#om-file', `${F}om-retail.pdf`);
await p.waitForSelector('#deal-tiles .tile');
await p.fill('#fig-noi', '400,000');
await p.press('#fig-noi', 'Tab');
await settle(p);
await openHistory(p);
p.once('dialog', (d) => d.accept('Before the call'));
await p.click('#snapshots button:has-text("Take a snapshot")');
await p.waitForSelector('#snapshots li');
await p.click('#sheet-close');
const withH = await backup(p, `${F}v2-with.json`, true);
check('a backup is version 2, with each deal’s history and snapshots', withH.version === 2 && withH.counts.historyEntries >= 2 && withH.counts.snapshots === 1 && Object.keys(withH.history).length === 1, JSON.stringify(withH.counts));
const without = await backup(p, `${F}v2-without.json`, false);
check('unticked, the backup leaves history and snapshots out', without.version === 2 && !('history' in without) && !('snapshots' in without), Object.keys(without).join(','));
check('and is smaller', fs.statSync(`${F}v2-without.json`).size < fs.statSync(`${F}v2-with.json`).size);
await A.browser.close();

const B = await phone(DESK);
p = B.page;
await p.goto(`${BASE}#settings`, { waitUntil: 'load' });
await restoreInto(p, `${F}v2-with.json`);
check('restored on an empty device, Undo knows the last change made on the other', /^Undo: NOI: 393,450 → 400,000/.test(await p.getAttribute('#deal-undo', 'aria-label')), await p.getAttribute('#deal-undo', 'aria-label'));
await p.click('#deal-undo');
await settle(p);
check('and undoes it', (await p.inputValue('#fig-noi')).replace(/\D/g, '') === '393450', await p.inputValue('#fig-noi'));
await openHistory(p);
const sn = await p.$$eval('#snapshots li .li-title', (xs) => xs.map((x) => x.textContent));
const hl = await p.$$eval('#history-list li .li-title', (xs) => xs.map((x) => x.textContent));
check('the snapshot came across', sn.includes('Before the call'), sn.join(' | '));
check('the history came across, with the restore in it', hl.some((t) => /^Restored from the backup of/.test(t)) && hl.some((t) => /^NOI: 393,450 → 400,000/.test(t)), hl.join(' | '));
await p.click('#sheet-close');
await B.browser.close();

// a version 1 backup, made by 4.2.1 (upgrade-flow keeps it), or the 3.3.0 fixture
const v1 = fs.existsSync(`${F}backup-4.2.1.json`) ? `${F}backup-4.2.1.json` : new URL('../fixtures/backup-comp-loader-3.3.0.json', import.meta.url).pathname;
const C = await phone(DESK);
p = C.page;
await p.goto(`${BASE}#settings`, { waitUntil: 'load' });
await restoreInto(p, v1);
check(`a version 1 backup (${v1.split('/').pop()}) still restores`, /4410 Example Avenue NW/.test(await p.textContent('#view-deal')));
await openHistory(p);
const h1 = await p.$$eval('#history-list li .li-title', (xs) => xs.map((x) => x.textContent));
check('and the deal’s history starts with the restore', h1.length >= 1 && /^Restored from the backup of/.test(h1[h1.length - 1]), h1.join(' | '));
await p.click('#sheet-close');
await C.browser.close();

/* ------------------------------------------------------- D. the limits */
const D = await phone({ ...DESK });
// the browser's quota made small (6 MB), so the space allowed is half of it: 3 MB
await D.ctx.addInitScript(() => {
  const real = navigator.storage.estimate.bind(navigator.storage);
  navigator.storage.estimate = async () => ({ usage: (await real()).usage, quota: 6 * 1024 * 1024 });
});
p = D.page;
await p.goto(`${BASE}#deal`, { waitUntil: 'load' });
await p.setInputFiles('#om-file', `${F}om-retail.pdf`);
await p.waitForSelector('#deal-tiles .tile');
await settle(p);
const dealId = await p.evaluate(() => localStorage.getItem('zlatura.deal.current') || null);
const per = await p.evaluate(async (id) => {
  const store = await import('/app/store.js');
  const deals = await store.listDeals();
  const d = deals.find((x) => x.id === id) || deals[0];
  for (let i = 0; i < 1010; i++) { d.figures.noi = 400000 + i; d.updatedAt = Date.now(); await store.saveDeal(d); }
  const h = await store.historyOf(d.id);
  const info = await store.historyInfo(d.id);
  // 2 MB: a second deal whose every change is about 30 KB
  const big = { id: 'big-deal', name: 'Big', figures: {}, visit: { photos: [], audio: [] }, updatedAt: 1 };
  await store.saveDeal(big);
  for (let i = 0; i < 90; i++) { big.notes = `${i} ${'x'.repeat(30000)}`; big.updatedAt = Date.now(); await store.saveDeal(big); }
  const hb = await store.historyOf('big-deal');
  const ib = await store.historyInfo('big-deal');
  await store.deleteDeal('big-deal');
  return { n: h.length, first: h[0] && h[0].label, info, nb: hb.length, bytes: ib.bytes, pruned: ib.pruned };
}, dealId);
check('a deal keeps its last 1,000 changes', per.n === 1000 && per.info.count === 1000 && per.info.pruned === true && /^NOI: 400,0(09|10) → /.test(per.first), JSON.stringify({ n: per.n, first: per.first, count: per.info.count }));
check('a deal’s history stays within 2 MB', per.bytes <= 2 * 1024 * 1024 && per.nb < 90 && per.nb > 20 && per.pruned, JSON.stringify({ entries: per.nb, bytes: per.bytes }));
await p.reload({ waitUntil: 'load' });
await p.waitForSelector('#deal-tiles .tile');
await openHistory(p);
check('History says since when it runs', /^History kept since .*older changes were removed to stay within 1,000 changes or 2 MB/.test(await p.textContent('#history-since').catch(() => '')), await p.textContent('#history-since').catch(() => ''));
await p.click('#history-list ~ *, #sheet-body button:has-text("Clear this deal’s history")').catch(() => p.click('#sheet-body button:has-text("Clear this deal’s history")'));
await p.waitForSelector('dialog.action-sheet .action-item:has-text("Yes, clear the history")');
await p.locator('dialog.action-sheet .action-item', { hasText: 'Yes, clear the history' }).click();
await p.waitForSelector('#history-since');
await p.waitForFunction(() => document.querySelector('#deal-undo').disabled, null, { timeout: 5000 }).catch(() => {}); // the buttons refresh after the clear
check('clearing a deal’s history leaves the deal and its snapshots, and says so', /^History cleared on/.test(await p.textContent('#history-since')) && /No changes recorded yet/.test(await p.textContent('#sheet-body')) && (await p.isDisabled('#deal-undo')), await p.textContent('#history-since'));
await p.click('#sheet-close');

// a database from 4.3.0 has no record of the sizes: the next save counts them
const recount = await p.evaluate(async () => {
  const store = await import('/app/store.js');
  await new Promise((res) => { const r = indexedDB.open('zlatura'); r.onsuccess = () => { const t = r.result.transaction('meta', 'readwrite'); t.objectStore('meta').delete('usage'); t.oncomplete = () => { r.result.close(); res(); }; }; });
  const d = (await store.listDeals())[0];
  d.figures.noi = 512345; d.updatedAt = Date.now();
  await store.saveDeal(d);
  await new Promise((r) => setTimeout(r, 500));
  return store.historyInfo(d.id);
});
check('without the record of sizes (a 4.3.0 database), the next save counts them again', recount && recount.count === 1, JSON.stringify(recount));

// across deals: 3 MB allowed here; automatic snapshots of ~350 KB each overfill it
const over = await p.evaluate(async () => {
  const store = await import('/app/store.js');
  const data = (i) => ({ figures: { noi: i }, notes: 'y'.repeat(350000) });
  await store.saveSnapshot('deal-x', { name: 'Named one' }, data(0));
  await store.saveSnapshot('deal-x', { name: 'Named two' }, data(1));
  for (let i = 0; i < 10; i++) await store.saveSnapshot(`deal-${i % 3}`, { name: `auto ${i}`, auto: true }, data(i), Date.now() + i);
  await store.keepWithinBudget();
  const r = await store.storageReport();
  const named = (await store.snapshotsOf('deal-x')).map((s) => s.name);
  const autos = [...(await store.snapshotsOf('deal-0')), ...(await store.snapshotsOf('deal-1')), ...(await store.snapshotsOf('deal-2'))].map((s) => s.name);
  return { budget: r.budget, total: r.total, share: r.share, warn: r.warn, named, autos };
});
check('the space allowed is half the browser’s quota when that is under 50 MB', over.budget === 3 * 1024 * 1024, String(over.budget));
check('over it, the oldest automatic snapshots go first; named ones stay', over.total <= over.budget && over.named.length === 2 && over.autos.length < 10 && !over.autos.includes('auto 0') && over.autos.includes('auto 9'), JSON.stringify({ total: over.total, autos: over.autos }));
await p.click('.sidebar .tab[data-view="settings"]');
await p.waitForSelector('#history-usage');
check('Settings shows what history and snapshots take, against what they may', /Deal history and snapshots: .* of the 3\.0 MB kept for them/.test(await p.textContent('#history-usage')), await p.textContent('#history-usage'));
check(`Settings warns at 80% (now ${Math.round(over.share * 100)}%)`, over.share >= 0.8 ? /using \d+% of the space kept for them/.test(await p.textContent('#storage-warning').catch(() => '')) : (await p.$('#storage-warning')) === null, await p.textContent('#storage-warning').catch(() => 'no warning'));
await D.browser.close();

for (const [s, n, x] of R) console.log(s, '|', n, x ? `| ${x}` : '');
console.log('PASS', R.filter((x) => x[0] === 'PASS').length, 'FAIL', R.filter((x) => x[0] === 'FAIL').length, 'errors', [A, B, C, D].flatMap((x) => x.errors));
