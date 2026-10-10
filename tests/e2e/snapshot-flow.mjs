/* Snapshots (checkpoint d, part B), as a person meets them:
 *   - take a named snapshot, change the deal, compare (each difference, then
 *     and now), restore it (a photo deleted since comes back from the trash),
 *     and undo the restore;
 *   - automatic snapshots before a rent roll import and a backup restore that
 *     overwrites the deal; an import too large to undo step by step is undone
 *     from its snapshot;
 *   - the limits: 20 named (the 21st is refused), 10 automatic (oldest goes). */
import { phone, BASE } from './lib.mjs';

const F = new URL('./files/', import.meta.url).pathname;
const R = []; const check = (n, c, d = '') => R.push([c ? 'PASS' : 'FAIL', n, d]);
const { browser, page, errors } = await phone({ viewport: { width: 1360, height: 900 }, isMobile: false, hasTouch: false, userAgent: undefined, deviceScaleFactor: 1 });
const settle = () => page.waitForTimeout(800);
const noi = () => page.inputValue('#fig-noi').then((v) => v.replace(/[^\d.]/g, ''));
const undoLabel = () => page.getAttribute('#deal-undo', 'aria-label');
const openHistory = async () => {
  await page.click('button[aria-label="More deal actions"]');
  await page.locator('.action-sheet .action-item', { hasText: 'History' }).click();
  await page.waitForSelector('#snapshots');
};
const snaps = () => page.$$eval('#snapshots li', (xs) => xs.map((x) => `${x.querySelector('.li-title').textContent} · ${x.querySelector('.li-sub').textContent.split(' · ').pop()}`));
const closeSheet = () => page.click('#sheet-close');

await page.goto(`${BASE}#deal`, { waitUntil: 'load' });
await page.setInputFiles('#om-file', `${F}om-retail.pdf`);
await page.waitForSelector('#deal-tiles .tile');
await page.click('#tab-visit');
await page.setInputFiles('#photo-file', `${F}photo0.jpg`);
await page.waitForSelector('#deal-photos .photo img');
await page.click('#tab-overview');
await settle();

// a named snapshot
await openHistory();
page.once('dialog', (d) => d.accept('Before the seller call'));
await page.click('#snapshots button:has-text("Take a snapshot")');
await page.waitForSelector('#snapshots li');
check('a named snapshot is taken and listed', (await snaps())[0] === 'Before the seller call · named', (await snaps()).join(' | '));
const { createRequire } = await import('module');
await page.addScriptTag({ path: createRequire(import.meta.url).resolve('axe-core/axe.min.js') });
const axe = await page.evaluate(async () => (await window.axe.run(document.querySelector('#sheet'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] })).violations.map((v) => `${v.id}: ${v.nodes.length}`));
check('axe: the History sheet, with its snapshots and changes, has no violations', axe.length === 0, axe.join('; '));
await closeSheet();

// changes after it: NOI, a unit, the photo
await page.fill('#fig-noi', '400,000');
await page.press('#fig-noi', 'Tab');
await settle();
await page.click('#tab-rentroll');
await page.waitForSelector('#deal-rentroll .rr-grid tbody tr[data-id]');
const units0 = await page.$$eval('#deal-rentroll .rr-grid tbody tr[data-id]', (x) => x.length);
await page.click('#deal-rentroll button[aria-label^="More for unit"]');
await page.locator('.action-sheet .action-item', { hasText: 'Delete unit' }).click();
await settle();
await page.click('#tab-visit');
await page.click('#deal-photos button[aria-label="Delete this photo"]');
await settle();
await page.click('#tab-overview');

// compare
await openHistory();
await page.locator('#snapshots li', { hasText: 'Before the seller call' }).locator('button', { hasText: 'Compare' }).click();
await page.waitForSelector('#snapshot-compare');
const rows = await page.$$eval('#snapshot-compare tr', (trs) => trs.slice(1).map((tr) => [...tr.children].map((td) => td.textContent).join(' | ')));
check('compare lists each difference, then and now', rows.some((r) => /^NOI \| 393,450 \| 400,000$/.test(r)) && rows.some((r) => /^Where NOI came from/.test(r)) && rows.some((r) => /^Unit/.test(r)) && rows.some((r) => /Photos/.test(r)), rows.join(' / '));

// restore, from the compare sheet
await page.click('#sheet-body button:has-text("Restore this snapshot")');
await settle();
await page.waitForSelector('#fig-noi');
check('restoring puts the NOI back', (await noi()) === '393450', await noi());
await page.click('#tab-rentroll');
await page.waitForSelector('#deal-rentroll .rr-grid tbody tr[data-id]');
check('and the deleted unit', (await page.$$eval('#deal-rentroll .rr-grid tbody tr[data-id]', (x) => x.length)) === units0);
await page.click('#tab-visit');
check('and the photo deleted since (its bytes from the trash)', (await page.$$eval('#deal-photos .photo img', (x) => x.length)) === 1);
check('the restore is one undoable step', /^Undo: Restored snapshot “Before the seller call”/.test(await undoLabel()), await undoLabel());
await page.click('#deal-undo');
await settle();
await page.click('#tab-overview');
await page.waitForSelector('#fig-noi');
check('undoing the restore puts the later changes back', (await noi()) === '400000', await noi());
await openHistory();
check('an automatic snapshot was taken before the restore', (await snaps()).some((s) => s === 'Before restoring “Before the seller call” · automatic'), (await snaps()).join(' | '));
await closeSheet();

// rent roll imports: an automatic snapshot first; one that fits in an entry undoes step by step,
// one too large for an entry undoes from its snapshot
const fs = await import('fs');
const count = () => page.evaluate(() => Number(document.querySelector('#deal-rentroll .rr-grid').getAttribute('aria-rowcount')) - 2);
const lastImport = () => page.evaluate(() => new Promise((res) => { const r = indexedDB.open('zlatura'); r.onsuccess = () => { const g = r.result.transaction('history').objectStore('history').getAll(); g.onsuccess = () => { const e = g.result.filter((x) => x.kind === 'import').pop(); res(e && { stepwise: Array.isArray(e.changes), snapshot: e.snapshot || null, size: e.size || 0 }); r.result.close(); }; }; }));
async function importRows(n, name) {
  let csv = 'Suite,Tenant,Square Feet,Lease Start,Lease Expiration,Annual Base Rent\n';
  for (let i = 0; i < n; i++) csv += `${1000 + i},${name} ${i},${1000 + (i % 7) * 250},2022-0${1 + (i % 9)}-01,20${28 + (i % 8)}-12-31,${30000 + i * 37}\n`;
  fs.writeFileSync(`${F}rr-snap.csv`, csv);
  await page.click('#tab-rentroll');
  await page.locator('#deal-rentroll button[aria-label="More rent roll actions"]').click();
  const [ch] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.action-sheet .action-item', { hasText: 'Import from Excel or CSV' }).click()]);
  await ch.setFiles(`${F}rr-snap.csv`);
  await page.waitForSelector('#sheet-body .map-row');
  await page.check('#sheet-body input[type="checkbox"]');
  await page.click('#sheet-foot .btn-primary');
  await page.waitForTimeout(2500);
}
await page.click('#tab-rentroll');
await page.waitForSelector('#deal-rentroll .rr-grid');
const before = await count();
await importRows(500, 'Tenant');
check('an import of 500 units replaced the rent roll', (await count()) === 500, String(await count()));
const small = await lastImport();
check('it fits in one entry, so it undoes step by step (with a snapshot taken first all the same)', small && small.stepwise && !!small.snapshot, JSON.stringify(small));
await page.click('#deal-undo');
await page.waitForTimeout(2000);
await page.click('#tab-rentroll');
check('Undo puts the rent roll back', (await count()) === before, `${await count()} vs ${before}`);
await importRows(1000, 'A tenant with a long trading name, suite and floor noted in full,');
check('an import of 1,000 units replaced the rent roll', (await count()) === 1000, String(await count()));
const big = await lastImport();
check('too large for one entry: it points at the snapshot taken before it', big && !big.stepwise && !!big.snapshot && big.size > 0, JSON.stringify(big));
check('Undo names the import', /^Undo: Imported 1000 units from a spreadsheet, replacing the rent roll/.test(await undoLabel()), await undoLabel());
await page.click('#deal-undo');
await page.waitForTimeout(2500);
await page.click('#tab-rentroll');
await page.waitForSelector('#deal-rentroll .rr-grid');
check('Undo restores the rent roll from that snapshot', (await count()) === before, `${await count()} vs ${before}`);
check('and is recorded as the import’s undo', /^Redo: Imported 1000 units/.test(await page.getAttribute('#deal-redo', 'aria-label')), await page.getAttribute('#deal-redo', 'aria-label'));
await page.click('#deal-redo');
await page.waitForTimeout(800);
check('Redo of an import that large says to import again', /too large to redo step by step/.test(await page.textContent('.toast').catch(() => '')));

// a backup restore that overwrites this deal: an automatic snapshot of the deal first
await page.click('.sidebar .tab[data-view="settings"]');
await page.waitForSelector('#settings-data #backup-make');
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#backup-make')]);
const file = `${F}snap-backup.json`;
await dl.saveAs(file);
await page.click('.sidebar .tab[data-view="deal"]');
await page.click('#tab-overview');
await page.waitForSelector('#fig-noi');
await page.fill('#fig-noi', '455,000');
await page.press('#fig-noi', 'Tab');
await settle();
await page.click('.sidebar .tab[data-view="settings"]');
await page.setInputFiles('#backup-file', file);
await page.waitForSelector('dialog.action-sheet');
await page.locator('dialog.action-sheet .action-item', { hasText: 'Replace everything on this device' }).click();
await page.waitForSelector('dialog.action-sheet .action-item:has-text("Yes, replace everything")');
await Promise.all([page.waitForEvent('load', { timeout: 30000 }), page.locator('dialog.action-sheet .action-item', { hasText: 'Yes, replace everything' }).click()]);
await page.waitForTimeout(1500);
// after a restore the app reloads with no deal open: open it from Home
await page.click('.sidebar .tab[data-view="home"]');
await page.waitForSelector('#home-continue .cont-row');
await page.locator('#home-continue .cont-row').first().click();
await page.waitForSelector('#tab-overview');
await page.click('#tab-overview');
await page.waitForSelector('#fig-noi');
check('the backup restored the deal', (await noi()) === '400000', await noi());
await openHistory();
check('an automatic snapshot of the deal was taken before the restore overwrote it', (await snaps()).some((s) => /^Before restoring the backup of .* · automatic$/.test(s)), (await snaps()).join(' | '));
await closeSheet();
await page.waitForTimeout(300);
check('the restore is in the history, and undoable', /^Undo: Restored from the backup of/.test(await undoLabel()), await undoLabel());
await page.click('#deal-undo');
await settle();
check('undoing it brings back the edit the restore overwrote', (await noi()) === '455000', await noi());

// the limits, straight against storage
const lim = await page.evaluate(async () => {
  const store = await import('/app/store.js');
  const out = [];
  for (let i = 0; i < 21; i++) { const r = await store.saveSnapshot('limits', { name: `n${i}` }, { figures: {} }); out.push(r === 'full' ? 'full' : 'ok'); }
  for (let i = 0; i < 12; i++) await store.saveSnapshot('limits', { name: `a${i}`, auto: true }, { figures: {} }, Date.now() + i);
  const all = await store.snapshotsOf('limits');
  return { refused: out.filter((x) => x === 'full').length, named: all.filter((x) => !x.auto).length, auto: all.filter((x) => x.auto).map((x) => x.name) };
});
check('20 named snapshots are kept; the 21st is refused', lim.refused === 1 && lim.named === 20, JSON.stringify(lim));
check('10 automatic ones are kept: the oldest go', lim.auto.length === 10 && lim.auto[0] === 'a2' && lim.auto[9] === 'a11', lim.auto.join(','));

await browser.close();
for (const [s, n, x] of R) console.log(s, '|', n, x ? `| ${x}` : '');
console.log('PASS', R.filter((x) => x[0] === 'PASS').length, 'FAIL', R.filter((x) => x[0] === 'FAIL').length, 'errors', errors);
