/* The T-12 and the Review Queue in the browser (docs/proposals/t12-review-queue.md),
 * on the invented statements of tests/t12-layouts.js (written by make_t12.mjs):
 *   1. a retail T-12 read onto a deal with a rent roll: by category, a line it
 *      can't place sent to Review, the tab and its count;
 *   2. the line filed in Review (and remembered), the queue empty, the tab gone;
 *   3. NOI three ways: the table, the rent roll's labelled forward-looking, the
 *      warning in "What doesn't add up";
 *   4. "Use the T-12's figures" and Undo;
 *   5. after a reload: the statement kept, the label in Settings;
 *   6. a bare "Management Fees" is not guessed; a nine-month statement says so,
 *      and "Seen" clears it; an AI reading and a template cell in the queue;
 *   7. an .xls refused; nothing overflows on a phone. */
import fs from 'fs';
import { phone, BASE, SHOTS } from './lib.mjs';
const F = new URL('./files/', import.meta.url).pathname;
const R = []; const check = (n, c, d = '') => R.push([c ? 'PASS' : 'FAIL', n, d]);
const finish = async (browser, errors) => {
  for (const r of R) console.log(r.join(' | '));
  console.log(`PASS ${R.filter((r) => r[0] === 'PASS').length} FAIL ${R.filter((r) => r[0] === 'FAIL').length} errors`, errors);
  await browser.close();
  process.exit(R.some((r) => r[0] === 'FAIL') ? 1 : 0);
};

const { browser, page, errors } = await phone({ viewport: { width: 1360, height: 900 }, isMobile: false, hasTouch: false, userAgent: undefined, deviceScaleFactor: 1 });
const text = async (sel) => ((await page.locator(sel).count()) ? (await page.textContent(sel)).replace(/\s+/g, ' ').trim() : '');
const sheetAction = (label) => page.locator('dialog.action-sheet .action-item', { hasText: label }).first().click();
const tab = '.sidebar .tab[data-view="review"]';
const dealIdb = (id) => page.evaluate((x) => new Promise((res) => { const r = indexedDB.open('zlatura'); r.onsuccess = () => { const g = r.result.transaction('deals').objectStore('deals').get(x); g.onsuccess = () => res(g.result); }; }), id);
async function importT12(file) {
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#t12-import, #t12-replace')]);
  await fc.setFiles(F + file);
  await page.waitForFunction((f) => (document.querySelector('#deal-t12')?.textContent || '').includes(f), file, { timeout: 15000 });
  await page.waitForTimeout(500);
}

// ---- 1. a retail T-12 onto a deal read from an OM (it has a rent roll)
await page.goto(BASE + '#deal', { waitUntil: 'load' });
await page.setInputFiles('#om-file', F + 'om-retail.pdf');
await page.waitForSelector('#deal-tiles .tile');
const hasCard = await page.waitForSelector('#deal-t12 #t12-import', { timeout: 5000 }).then(() => true, () => false);
check('the deal’s overview has a T-12 card with an import button', hasCard);
if (!hasCard) await finish(browser, errors);
check('no Review tab while nothing is waiting', await page.evaluate((s) => document.querySelector(s).hidden, tab));
await importT12('invented-square.xlsx');
const card = await text('#deal-t12');
check('the statement read: file, sheet and months', /invented-square\.xlsx · P&L · Jan 2025 to Dec 2025 \(12 months\)/.test(card), card.slice(0, 160));
check('by category: rent, recoveries, EGI, taxes, insurance, repairs', ['Base rent$300,000', 'Expense recoveries$69,600', 'Effective gross income$369,600', 'Real estate taxes$33,600', 'Insurance$7,200', 'Repairs and maintenance$28,800'].every((x) => card.includes(x)), card.slice(0, 500));
check('below the line kept apart: the asset management fee is an owner cost', /Below the line \(not in NOI\)TI and leasing commissions\$9,000Owner and partnership costs\$13,800/.test(card));
check('the line no rule knows waits to be filed', /1 line to file\./.test(card) && /Not yet filed\$1,200/.test(card));
check('the analysis says the T-12 isn’t compared yet', /Some T-12 lines are still to review/.test(await text('#deal-checks')));
await page.waitForTimeout(400);
check('the Review tab appears, with a count of 1', await page.evaluate((s) => !document.querySelector(s).hidden && document.querySelector(`${s} .badge`).textContent === '1', tab));

// ---- 2. filed in Review, remembered
await page.click('#t12-review');
await page.waitForSelector('#review-root .review-item');
const item = await text('#review-root .review-item');
check('Review shows the line, its amount and why it is there', /T-12 line: Pylon Sign Lease \$1,200 · no category fits its wording/.test(item), item.slice(0, 120));
await page.screenshot({ path: `${SHOTS}t12-review.png` });
await page.locator('#review-root .review-item select').selectOption('otherOpex');
await page.locator('#review-root .review-item button', { hasText: 'File it' }).click();
await page.waitForFunction(() => !document.querySelector('#review-root .review-item'), null, { timeout: 5000 }).catch(() => {});
check('filed: the queue is empty', /Nothing is waiting/.test(await text('#review-root')));
await page.click('.sidebar .tab[data-view="deal"]');
await page.waitForTimeout(500);
check('and the tab is gone again', await page.evaluate((s) => document.querySelector(s).hidden, tab));
const card2 = await text('#deal-t12');
check('the card: nothing left to file, the line under other operating, the full NOI', !/to file/.test(card2) && /Other operating\$1,200/.test(card2) && /NOI\$298,800/.test(card2), card2.slice(0, 400));

// ---- 3. NOI three ways
await page.waitForFunction(() => /\$\d/.test(document.querySelector('#t12-noi tbody tr:last-child td')?.textContent || ''), null, { timeout: 10000 }).catch(() => {});
const noi = await page.$$eval('#t12-noi tbody tr', (xs) => xs.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
check('three rows: the OM’s, the T-12’s, the rent roll’s', noi.length === 3 && /^OM as read or typed \$393,450/.test(noi[0]) && /^T-12 Jan 2025 to Dec 2025 \(12 months\) \$298,800/.test(noi[1]), noi.join(' / '));
check('the rent roll’s is labelled forward-looking year 1, a projection', /^Rent roll, forward-looking year 1 a projection, not an actual \$/.test(noi[2]), noi[2]);
check('the gaps from the T-12’s, with what they amount to', /\+\$94,650 \(24\.1%\) · warning/.test(noi[0]), noi[0]);
const checks = await text('#deal-checks');
check('a warning in “What doesn’t add up”, naming where the gap comes from', /The T-12’s NOI \(\$298,800, Jan 2025 to Dec 2025\) is 24\.1% below the OM’s \(\$393,450\)\. Most of the gap: /.test(checks) && /The OM’s NOI may be pro forma, or leave out expenses\./.test(checks), checks.slice(0, 700));

// ---- 4. use the T-12's figures, and undo
const dealId = await page.evaluate(() => localStorage.getItem('zlatura.deal.current'));
await page.click('#t12-use');
await page.waitForSelector('dialog.action-sheet');
const sheet = await text('dialog.action-sheet');
check('the sheet says what each figure becomes', /NOI, in place: \$393,450 → \$298,800/.test(sheet) && /rent roll’s operating expenses too/.test(sheet), sheet.slice(0, 300));
await sheetAction('Use them');
await page.waitForTimeout(900);
let d = await dealIdb(dealId);
check('the deal’s NOI, EGI, expenses and taxes are the T-12’s, each sourced to it', d.figures.noi === 298800 && d.figures.gross === 369600 && d.figures.opex === 70800 && d.figures.taxes === 33600 && d.sources.noi.t12 === true, JSON.stringify([d.figures.noi, d.figures.gross, d.figures.opex, d.figures.taxes]));
check('the figure shows a T-12 tag', (await page.locator('#deal-figs .src.t12, .src.t12').count()) >= 4);
const noiAfter = await page.$$eval('#t12-noi tbody tr', (xs) => xs[0].innerText.replace(/\s+/g, ' '));
check('the OM’s own NOI stays in the comparison', /\$393,450/.test(noiAfter), noiAfter);
await page.keyboard.press('Control+z');
await page.waitForTimeout(900);
d = await dealIdb(dealId);
check('Undo puts the OM’s figures back', d.figures.noi === 393450 && !d.t12.applied, JSON.stringify([d.figures.noi, !!d.t12.applied]));

// ---- 5. after a reload; the label in Settings
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('#deal-t12 #t12-summary', { timeout: 10000 }).catch(() => {});
check('after a reload the T-12 is still on the deal', /NOI\$298,800/.test(await text('#deal-t12')));
await page.click('.sidebar .tab[data-view="settings"]');
await page.waitForSelector('#settings-t12');
check('Settings lists the label filed, with its category', /“pylon sign lease”Other operating · filed/.test(await text('#settings-t12')), (await text('#settings-t12')).slice(0, 200));

// ---- 6. a bare management fee, nine months, an AI reading, a template cell
await page.click('.sidebar .tab[data-view="deal"]');
await page.evaluate(async () => { const m = await import('./app/dealui.js'); m.startDealByHand(); });
await page.waitForSelector('#deal-t12 #t12-import');
await importT12('invented-ridge.csv');
await page.click('#t12-review');
await page.waitForSelector('#review-root .review-item');
const mf = await page.locator('#review-root .review-item', { hasText: 'Management Fees' }).innerText();
check('a bare “Management Fees” is not guessed: it waits, asking which', /the property manager’s \(operating\) or the owner’s \(below the line\)\?/.test(mf), mf.slice(0, 200));
const likely = await page.locator('#review-root .review-item', { hasText: 'Management Fees' }).locator('optgroup[label="Likely"] option').allTextContents();
check('the likely choices offered first: property management fee, owner costs', likely.join('|') === 'Management fee (property)|Owner and partnership costs', likely.join('|'));
await page.locator('#review-root .review-item', { hasText: 'Management Fees' }).locator('select').selectOption('management');
await page.locator('#review-root .review-item', { hasText: 'Management Fees' }).locator('button', { hasText: 'File it' }).click();
await page.waitForTimeout(600);
await page.click('.sidebar .tab[data-view="deal"]');
await page.waitForSelector('#t12-replace');
await importT12('invented-lofts.xlsx');
check('nine months: said on the card, and not compared', /Jan 2025 to Sep 2025 \(9 months\)/.test(await text('#deal-t12')) && /The T-12 has only 9 months, so its NOI isn’t compared/.test(await text('#deal-checks')));
// an AI reading never applied, and a template cell mapped with low confidence
const id2 = await page.evaluate(() => localStorage.getItem('zlatura.deal.current'));
await page.evaluate(async (id) => {
  const m = await import('./app/dealui.js');
  await m.updateDeal(id, (x) => { x.ai = { extractions: [{ at: Date.now(), model: 'test', files: ['invented-om.pdf'], fields: [{ key: 'price', value: 4500000, doc: 'invented-om.pdf', page: 2, status: 'verified', applied: false }] }] }; });
  const s = await import('./app/store.js');
  await s.kvSet('tpl.library', [{ id: 'tinv', name: 'Invented model', archived: false, versions: [], mapping: { cells: [{ sheet: 'Inputs', cell: 'B9', field: 'bsf', confidence: 'low', why: 'beside “Area”' }], tables: [] } }]);
  document.dispatchEvent(new CustomEvent('reviewchange'));
}, id2);
await page.waitForTimeout(500);
await page.click(tab);
await page.waitForSelector('#review-root .review-t12check');
const all = await text('#review-root');
check('the queue holds the nine-month note, the AI reading and the template cell', /Only 9 months \(Jan 2025 to Sep 2025\)/.test(all) && /AI reading not applied: [^$]+ \$4,500,000 invented-om\.pdf, page 2/.test(all) && /Template cell Inputs!B9 → [^:]+ mapped with low confidence: beside “Area”/.test(all), all.slice(0, 600));
check('the count matches what is listed', await page.evaluate((s) => document.querySelector(`${s} .badge`).textContent === String(document.querySelectorAll('#review-root .review-item').length), tab));
for (const [kind, label] of [['t12check', 'Seen'], ['ai', 'Dismiss'], ['tpl', 'It’s right']]) {
  await page.locator(`#review-root .review-${kind} button`, { hasText: label }).first().click();
  await page.waitForTimeout(700);
}
check('“Seen”, “Dismiss” and “It’s right” each clear their item', /Nothing is waiting/.test(await text('#review-root')), (await text('#review-root')).slice(0, 300));
const lib = await page.evaluate(async () => (await import('./app/store.js')).kvGet('tpl.library'));
check('the template cell is recorded as confirmed', lib[0].mapping.cells[0].confidence === 'high' && /confirmed by you/.test(lib[0].mapping.cells[0].why));
d = await dealIdb(id2);
check('the AI reading is recorded as dismissed, and the check as seen, on the deal', d.ai.extractions[0].fields[0].dismissed === true && d.t12.seen.months === true);
await page.screenshot({ path: `${SHOTS}t12-empty-review.png` });

// ---- 7. an .xls refused; a phone
await page.click('.sidebar .tab[data-view="deal"]');
await page.waitForSelector('#t12-replace');
const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#t12-replace')]);
await fc.setFiles(F + 'legacy.xls');
await page.waitForTimeout(400);
check('an old .xls is refused, saying what to do', /old \.xls file\. Open it in Excel and save it as \.xlsx \(or CSV\)/.test(await page.evaluate(() => document.querySelector('.toast')?.textContent || '')));
await browser.close();

const P = await phone();
await P.page.goto(BASE + '#deal', { waitUntil: 'load' });
await P.page.setInputFiles('#om-file', F + 'om-retail.pdf');
await P.page.waitForSelector('#deal-t12 #t12-import');
const [pf] = await Promise.all([P.page.waitForEvent('filechooser'), P.page.click('#t12-import')]);
await pf.setFiles(F + 'invented-square.xlsx');
await P.page.waitForSelector('#t12-summary');
await P.page.waitForTimeout(600);
check('phone: the T-12 card fits the screen', await P.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
await P.page.locator('#deal-t12').screenshot({ path: `${SHOTS}t12-phone.png` });
await P.page.click('.tabbar .tab[data-view="review"]');
await P.page.waitForSelector('#review-root .review-item');
check('phone: the Review tab is in the tab bar, and Review fits', await P.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
// six tabs in one row: each tab's top the same
check('phone: the tab bar keeps every tab on one row', await P.page.evaluate(() => new Set([...document.querySelectorAll('.tabbar .tab:not([hidden])')].map((t) => Math.round(t.getBoundingClientRect().top))).size === 1));
await P.page.screenshot({ path: `${SHOTS}t12-phone-review.png` });
errors.push(...P.errors);
fs.writeFileSync(`${SHOTS}t12-flow.json`, JSON.stringify(R, null, 1));
await finish(P.browser, errors);
