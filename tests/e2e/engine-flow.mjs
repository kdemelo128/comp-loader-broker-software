/* Checkpoint (b), the shared engine, as a person meets it:
 *   - a backup holding money with more decimals than kept (and a month-to-month
 *     lease, and a rent roll as of an earlier date) restores, the values are
 *     rounded, and Settings lists each one, old and new;
 *   - WALT carries its method on the Overview and the Rent roll tab, both show
 *     the same figure, and the Settings convention changes which WALT is shown;
 *   - the NER tool says what its figure is net of, and the Break-even tool
 *     estimates from gross income when there is no GPR, and says so. */
import fs from 'fs';
import { phone, BASE } from './lib.mjs';

const F = new URL('./files/', import.meta.url).pathname;
const R = []; const check = (n, c, d = '') => R.push([c ? 'PASS' : 'FAIL', n, d]);

// a backup made by 3.3.0 (tests/fixtures), given sub-cent money, a month-to-month tenant and an earlier as-of date
const b = JSON.parse(fs.readFileSync(new URL('../fixtures/backup-comp-loader-3.3.0.json', import.meta.url), 'utf8'));
const d = b.deals[0];
d.figures.price = 6450000.004999;
d.figures.noi = 393450.0049;
d.rr.settings.asOf = '2026-06-30';
d.rr.leases[1].mtm = true;
d.rr.leases[1].leaseEnd = null;
d.rr.leases[0].periods[0] = { ...d.rr.leases[0].periods[0], unit: 'psf_year', rate: 52.000049 };
const file = `${F}engine-backup.json`;
fs.writeFileSync(file, JSON.stringify(b));

const { browser, page, errors } = await phone({ viewport: { width: 1360, height: 900 }, isMobile: false, hasTouch: false, userAgent: undefined, deviceScaleFactor: 1 });
await page.goto(`${BASE}#settings`, { waitUntil: 'load' });
await page.waitForSelector('#settings-data #backup-file', { state: 'attached' });
await page.setInputFiles('#backup-file', file);
await page.waitForSelector('dialog.action-sheet');
await Promise.all([page.waitForEvent('load', { timeout: 30000 }), page.locator('dialog.action-sheet .action-item', { hasText: 'Merge into this device' }).click()]);
await page.click('.sidebar .tab[data-view="settings"]');
await page.waitForSelector('#rounding-note', { timeout: 10000 });
check('Settings says stored values were rounded', /4 stored values were rounded/.test(await page.textContent('#rounding-note')), await page.textContent('#rounding-note'));
await page.click('#rounding-show');
await page.waitForSelector('#rounding-table');
const rows = await page.$$eval('#rounding-table tr', (trs) => trs.slice(1).map((tr) => [...tr.children].map((td) => td.textContent)));
check('the price, old and new', rows.some((r) => r[1] === 'figures.price' && r[2] === '6450000.004999' && r[3] === '6450000'), JSON.stringify(rows));
check('the NOI, old and new', rows.some((r) => r[1] === 'figures.noi' && r[2] === '393450.0049' && r[3] === '393450'));
check('a rate per SF to four decimals, old and new', rows.some((r) => /periods\[0\]\.rate$/.test(r[1]) && r[2] === '52.000049' && r[3] === '52'));
check('a $/SF the OM reader stored with many decimals, old and new', rows.some((r) => /^rentRoll\[\d\] \(210\)\.psf$/.test(r[1]) && r[2] === '37.84615384615385' && r[3] === '37.8462'));
check('each row names the deal', rows.every((r) => /^Deal: 4410 Example Avenue NW$/.test(r[0])));
await page.click('#sheet-close');

// the deal: WALT with its method, the same on the Overview and the Rent roll tab
await page.click('.sidebar .tab[data-view="home"]');
await page.waitForSelector('#home-continue .cont-row');
await page.locator('#home-continue .cont-row').first().click();
await page.waitForSelector('#deal-tiles .tile');
const occSub = await page.locator('#deal-tiles .tile', { hasText: 'Occupancy' }).locator('.s').textContent();
check('the Overview’s WALT says how it is measured', /^WALT [\d.]+ yrs by income$/.test(occSub), occSub);
const title = await page.locator('#deal-tiles .tile', { hasText: 'Occupancy' }).locator('.s').getAttribute('title');
check('and in full, with the as-of date and month-to-month leases', /by income, as of Jun 30, 2026; month-to-month leases left out/.test(title || ''), title);
check('the restored price is the rounded one', /\$6\.45M/.test(await page.textContent('#deal-tiles')));
await page.click('#tab-rentroll');
await page.waitForSelector('#deal-rentroll .tile');
const rrWalt = await page.locator('#deal-rentroll .tile', { hasText: 'WALT' }).first().innerText();
check('the Rent roll tab shows the same WALT, with its method', rrWalt.includes(occSub.match(/[\d.]+ yrs/)[0]) && /by income/.test(rrWalt), `${rrWalt.replace(/\n/g, ' | ')} vs ${occSub}`);

// the convention: WALT by area
await page.click('.sidebar .tab[data-view="settings"]');
await page.waitForSelector('#conv-walt-weight');
check('Settings lists the calculation conventions', /Loan payments/.test(await page.textContent('#settings-conventions')) && /Net effective rent/.test(await page.textContent('#settings-conventions')));
await page.selectOption('#conv-walt-weight', 'sf');
await page.click('.sidebar .tab[data-view="deal"]');
await page.click('#tab-overview');
await page.waitForTimeout(300);
const occSub2 = await page.locator('#deal-tiles .tile', { hasText: 'Occupancy' }).locator('.s').textContent();
check('choosing WALT by area changes the Overview’s WALT and its label', /^WALT [\d.]+ yrs by area$/.test(occSub2), occSub2);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);
check('the choice is kept', (await page.inputValue('#conv-walt-weight').catch(async () => { await page.click('.sidebar .tab[data-view="settings"]'); await page.waitForSelector('#conv-walt-weight'); return page.inputValue('#conv-walt-weight'); })) === 'sf');

// tools
await page.click('.sidebar .tab[data-view="tools"]');
await page.click('#tools-root button.tool[data-tool="ner"]');
for (const [k, v] of [['rent', '75'], ['sf', '1000'], ['months', '120'], ['esc', '3'], ['free', '3'], ['ti', '25'], ['lc', '0'], ['discount', '8']]) await page.fill(`#tool-ner-${k}`, v);
await page.waitForTimeout(200);
const ner = await page.textContent('#sheet-body .results');
check('NER tool: $81.60/SF, net of free rent and TI', /\$81\.60\/SF/.test(ner) && /net of free rent and TI, spread evenly/.test(ner), ner.replace(/\s+/g, ' ').slice(0, 200));
check('NER tool: the discounted figure, labelled', /Net effective rent, discounted\$78\.02\/SF/.test(ner.replace(/\s+/g, '')) || /\$78\.02\/SF/.test(ner));
await page.click('#sheet-close');
await page.click('#tools-root button.tool[data-tool="breakeven"]');
for (const [k, v] of [['opex', '135,750'], ['debtService', '326,310'], ['gross', '529,200'], ['occ', '91.7']]) await page.fill(`#tool-breakeven-${k}`, v);
await page.waitForTimeout(200);
const be = await page.textContent('#sheet-body');
check('Break-even tool without GPR: an estimate from gross income, labelled', /Break-even occupancy \(est\.\)/.test(be) && /80\.1%/.test(be) && /Estimated: no gross potential rent/.test(be), be.replace(/\s+/g, ' ').slice(0, 240));
await page.click('#sheet-close');
await browser.close();

for (const [s, n, x] of R) console.log(s, '|', n, x ? `| ${x}` : '');
console.log('PASS', R.filter((x) => x[0] === 'PASS').length, 'FAIL', R.filter((x) => x[0] === 'FAIL').length, 'errors', errors);
