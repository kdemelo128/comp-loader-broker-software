/* A deal's history, undo and redo (checkpoint d, part A), as a person meets them:
 *   - the Undo and Redo buttons say what they would undo or redo;
 *   - Ctrl/Cmd Z and Shift Ctrl/Cmd Z work on the deal, but not over typing
 *     a field hasn't committed yet;
 *   - undo survives a reload; a unit deleted from the rent roll comes back in
 *     its place; a photo deleted comes back with its bytes (from the trash);
 *   - the History sheet lists every change, and Undo to here goes back several
 *     steps as one, itself recorded. */
import { phone, BASE } from './lib.mjs';

const F = new URL('./files/', import.meta.url).pathname;
const R = []; const check = (n, c, d = '') => R.push([c ? 'PASS' : 'FAIL', n, d]);
const { browser, page, errors } = await phone({ viewport: { width: 1360, height: 900 }, isMobile: false, hasTouch: false, userAgent: undefined, deviceScaleFactor: 1 });
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const undoLabel = () => page.getAttribute('#deal-undo', 'aria-label');
const redoLabel = () => page.getAttribute('#deal-redo', 'aria-label');
const settle = () => page.waitForTimeout(700); // the save (400 ms) and the button refresh
const noi = () => page.inputValue('#fig-noi').then((v) => v.replace(/[^\d.]/g, ''));
const db = (fn) => page.evaluate(`new Promise((res) => { const r = indexedDB.open('zlatura'); r.onsuccess = () => (${fn})(r.result, res); })`);

// an edit straight after reading an OM is its own step, not folded into the deal's creation
await page.goto(`${BASE}#deal`, { waitUntil: 'load' });
await page.setInputFiles('#om-file', `${F}om-retail.pdf`);
await page.waitForSelector('#deal-tiles .tile');
await page.fill('#loan-closing', '3.25');
await page.press('#loan-closing', 'Tab');
await settle();
check('an edit made right after reading an OM can be undone', /^Undo: Loan: Closing: 2 → 3\.25/.test(await undoLabel()), await undoLabel());
await page.click('#deal-undo');
await settle();
check('a deal just read has nothing to undo', (await page.isDisabled('#deal-undo')) && (await undoLabel()) === 'Nothing to undo', await undoLabel());
check('the database is at version 2', (await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('zlatura'); r.onsuccess = () => { res(r.result.version); r.result.close(); }; }))) === 2);

// an edit, named on the Undo button
const noi0 = await noi();
await page.fill('#fig-noi', '400,000');
await page.press('#fig-noi', 'Tab');
await settle();
check('the Undo button names the edit', /^Undo: NOI: 393,450 → 400,000/.test(await undoLabel()), await undoLabel());

// the keyboard, from a field that hasn't been typed in (the cursor moved on with Tab)
await page.keyboard.press(`${MOD}+z`);
await settle();
check('Ctrl/Cmd Z undoes it', (await noi()) === noi0, `${await noi()} vs ${noi0}`);
check('and Redo is offered, named', /^Redo: NOI: 393,450 → 400,000/.test(await redoLabel()), await redoLabel());
await page.click('#deal-redo');
await settle();
check('the Redo button puts it back', (await noi()) === '400000', await noi());

// typing not yet committed: Ctrl/Cmd Z is the field's own undo, not the deal's
await page.click('#fig-noi');
await page.keyboard.press('End');
await page.keyboard.type('9');
await page.keyboard.press(`${MOD}+z`);
await settle();
check('typing not yet committed: the shortcut leaves the deal alone', /^Undo: NOI: 393,450 → 400,000/.test(await undoLabel()) && (await noi()) !== noi0, `${await undoLabel()} | field ${await noi()}`);
await page.fill('#fig-noi', '400,000');
await page.press('#fig-noi', 'Tab');
await settle();

// a reload keeps the history, and so the undo
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('#deal-tiles .tile');
await settle();
check('after a reload, Undo still knows the last change', /^Undo: NOI: 393,450 → 400,000/.test(await undoLabel()), await undoLabel());

// the rent roll: a unit deleted comes back in its place
await page.click('#tab-rentroll');
await page.waitForSelector('#deal-rentroll .rr-grid tbody tr[data-id]');
const units = () => page.$$eval('#deal-rentroll .rr-grid tbody tr[data-id] td:first-child input', (xs) => xs.map((x) => x.value));
const before = await units();
await page.click(`#deal-rentroll button[aria-label="More for unit ${before[1]}"]`);
await page.locator('.action-sheet .action-item', { hasText: 'Delete unit' }).click();
await settle();
check('a unit deleted', (await units()).length === before.length - 1);
check('Undo names it', (await undoLabel()).startsWith(`Undo: Deleted unit ${before[1]}`), await undoLabel());
await page.click('#deal-undo');
await settle();
await page.click('#tab-rentroll');
await page.waitForSelector('#deal-rentroll .rr-grid tbody tr[data-id]');
check('Undo brings the unit back, in its place', JSON.stringify(await units()) === JSON.stringify(before), `${await units()} vs ${before}`);

// a photo: deleted, the toast gone, then undone from the trash
await page.click('#tab-visit');
await page.setInputFiles('#photo-file', `${F}photo0.jpg`);
await page.waitForSelector('#deal-photos .photo img');
await settle();
const bytes = () => db(`(d, res) => { const g = d.transaction('deals').objectStore('deals').getAll(); g.onsuccess = async () => { const p = (g.result[0].visit.photos || [])[0]; res(p ? [p.blob.size, Array.from(new Uint8Array(await p.blob.arrayBuffer()).slice(0, 64)).join(',')] : null); d.close(); }; }`);
const photo = await bytes();
await page.click('#deal-photos button[aria-label="Delete this photo"]');
await page.waitForTimeout(8000); // the toast's own Undo is gone
await settle();
const trashed = await db(`(d, res) => { const g = d.transaction('trash').objectStore('trash').getAll(); g.onsuccess = () => { res(g.result.filter((x) => x.kind === 'media').length); d.close(); }; }`);
check('a deleted photo is kept in the trash', trashed === 1, String(trashed));
check('Undo names the photo’s deletion', /^Undo: Deleted a photo/.test(await undoLabel()), await undoLabel());
await page.click('#deal-undo');
await settle();
await page.click('#tab-visit');
const back = await bytes();
check('Undo brings the photo back, the same bytes', !!back && back[0] === photo[0] && back[1] === photo[1], `${back && back[0]} vs ${photo[0]}`);

// one more change, so Undo to here has two steps to go back
await page.click('#tab-overview');
await page.fill('#loan-closing', '3.5');
await page.press('#loan-closing', 'Tab');
await settle();

// the History sheet, and Undo to here
await page.click('button[aria-label="More deal actions"]');
await page.locator('.action-sheet .action-item', { hasText: 'History' }).click();
await page.waitForSelector('#history-list');
const items = await page.$$eval('#history-list li', (xs) => xs.map((x) => `${x.querySelector('.li-title').textContent} · ${x.querySelector('.li-sub').textContent.split(' · ').pop()}`));
check('History lists the changes, newest first, back to the deal’s creation', /^Loan: Closing/.test(items[0]) && /^Undid: Deleted a photo/.test(items[1]) && items.some((t) => /^NOI: 393,450 → 400,000 · edit$/.test(t)) && / · created$/.test(items[items.length - 1]), items.join(' | '));
// the edit itself (not the “Redid: …” entry that names it)
const target = page.locator('#history-list li').filter({ has: page.locator('.li-title', { hasText: /^NOI: 393,450 → 400,000/ }) }).first();
await target.locator('button', { hasText: 'Undo to here' }).click();
await settle();
await page.click('#tab-overview');
await page.waitForSelector('#fig-noi');
check('Undo to here goes back to just after that step: NOI kept, the later changes undone', (await noi()) === '400000' && (await page.inputValue('#loan-closing')) !== '3.5' && (await page.$$eval('#deal-photos .photo', (x) => x.length).catch(() => 0)) === 0, `${await noi()} | closing ${await page.inputValue('#loan-closing')}`);
const last = await db(`(d, res) => { const g = d.transaction('history').objectStore('history').getAll(); g.onsuccess = () => { res(g.result[g.result.length - 1]); d.close(); }; }`);
check('and that is recorded as one step, undoing two', last && last.kind === 'undo' && last.undoes.length === 2 && /^Undid 2 changes, back to just after “NOI: 393,450 → 400,000”/.test(last.label), last && last.label);
check('Redo is offered for the steps undone', /^Redo:/.test(await redoLabel()), await redoLabel());

await browser.close();
for (const [s, n, x] of R) console.log(s, '|', n, x ? `| ${x}` : '');
console.log('PASS', R.filter((x) => x[0] === 'PASS').length, 'FAIL', R.filter((x) => x[0] === 'FAIL').length, 'errors', errors);
