/* The Tools screen: search, the new calculators against independently worked
 * figures, saved scenarios, Excel export and print, loading from a deal and
 * writing back to it only after the confirmation. */
import { phone, BASE, SHOTS } from './lib.mjs';
import { execFileSync } from 'child_process';
const F = new URL('./files/', import.meta.url).pathname;
const { browser, page, errors } = await phone();
const R = []; const check = (n, c, d = '') => R.push([c ? 'PASS' : 'FAIL', n, d]);
let promptAnswer = 'Base case';
page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? promptAnswer : undefined));
const go = async (v) => { await page.evaluate((x) => { location.hash = x; }, `#${v}`); await page.waitForTimeout(250); };
const openTool = async (id) => { await page.click(`#tools-root button.tool[data-tool="${id}"]`); await page.waitForSelector('#sheet-body .results li'); };
const closeSheet = async () => { await page.click('#sheet-close'); await page.waitForTimeout(250); };
const fill = async (pairs) => { for (const [id, v] of pairs) { await page.fill(id, v); } await page.waitForTimeout(150); };
const result = async (label) => (await page.$$eval('#sheet-body .results li', (li) => li.map((x) => [x.querySelector('span').firstChild.textContent, x.querySelector('b').textContent]))).find((x) => x[0] === label)?.[1];
const pick = async (text) => { await page.locator('dialog.action-sheet .action-item', { hasText: text }).first().click(); await page.waitForTimeout(250); };

await page.goto(BASE, { waitUntil: 'load' });
// sale comps on the Comps tab, for the comp set check
await page.setInputFiles('#file', F + 'costar-comps.pdf');
await page.waitForFunction(() => document.querySelectorAll('#sales-table tbody tr').length > 0, null, { timeout: 20000 });
const nSales = await page.locator('#sales-table tbody tr').count();
await go('tools');
const cards = await page.locator('#tools-root button.tool').count();
check('30 tools listed in groups', cards === 30 && (await page.locator('#tools-root .tool-group').count()) === 7, `${cards}`);
await page.fill('#tool-search', 'waterfall');
check('search narrows the list', (await page.locator('#tools-root button.tool').count()) === 1);
await page.fill('#tool-search', '');

// DCF: $1M NOI, 3% growth, 10 years, 8% discount, 7% exit, 2% costs = $16,265,040 (tests/calc.test.js)
await openTool('dcf');
await fill([['#tool-dcf-noi', '1,000,000'], ['#tool-dcf-growth', '3'], ['#tool-dcf-years', '10'], ['#tool-dcf-discount', '8'], ['#tool-dcf-exitCap', '7'], ['#tool-dcf-saleCost', '2']]);
check('DCF value', (await result('Value')) === '$16,265,040', await result('Value'));
check('DCF table has 10 years', (await page.locator('#sheet-body .tool-table tbody tr').count()) === 10);
check('formula explanation present', /Σ/.test(await page.textContent('#sheet-body .tool-how')));
check('no horizontal overflow with the table open', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
await page.screenshot({ path: `${SHOTS}tools-dcf.png` });
// saved scenario: save, change, load back
await page.click('#tool-scenarios');
await pick('Save these inputs as');
await page.fill('#tool-dcf-noi', '2,000,000');
await page.waitForTimeout(150);
await page.click('#tool-scenarios');
await pick('Base case');
await pick('Load');
check('saved scenario loads its inputs back', (await page.inputValue('#tool-dcf-noi')) === '1,000,000' && (await result('Value')) === '$16,265,040', await page.inputValue('#tool-dcf-noi'));
promptAnswer = 'Base case renamed';
await page.click('#tool-scenarios'); await pick('Base case'); await pick('Rename');
await page.click('#tool-scenarios');
await page.waitForSelector('dialog.action-sheet .action-item');
check('scenario renamed', await page.locator('dialog.action-sheet .action-item', { hasText: 'Base case renamed' }).count() === 1);
await page.click('dialog.action-sheet .action-cancel'); await page.waitForTimeout(200);
// Excel export
await page.click('#tool-export');
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), pick('Excel workbook')]);
const xl = `${SHOTS}tools-dcf.xlsx`;
await dl.saveAs(xl);
const cells = JSON.parse(execFileSync('python3', ['-c', 'import openpyxl,json,sys; ws=openpyxl.load_workbook(sys.argv[1]).active; print(json.dumps([[c for c in r] for r in ws.iter_rows(values_only=True)], default=str))', xl]).toString());
check('Excel export holds the inputs (as numbers) and the result', cells.some((r) => r[0] === 'NOI, year 1' && r[1] === 1000000) && cells.some((r) => r[0] === 'Value' && r[1] === '$16,265,040'), JSON.stringify(cells.slice(0, 12)));
// print
await page.evaluate(() => { window.print = () => { window.__printed = true; }; });
await page.click('#tool-export'); await pick('Print');
check('print sheet built', await page.evaluate(() => window.__printed === true) && /Discounted cash flow/.test(await page.textContent('#print-sheet')) && /\$16,265,040/.test(await page.textContent('#print-sheet')));
await closeSheet();

// amortization: $10M at 6.5%, 2 years IO then 30-year, 10-year term: balloon $8,865,668
await openTool('amort');
await fill([['#tool-amort-loan', '10m'], ['#tool-amort-rate', '6.5'], ['#tool-amort-amortYears', '30'], ['#tool-amort-termYears', '10'], ['#tool-amort-ioYears', '2']]);
check('amortization balloon', (await result('Balance at maturity (balloon)')) === '$8,865,668', await result('Balance at maturity (balloon)'));
await closeSheet();

// waterfall: 100 in, 120 back, 90/10, hurdles 8/12/15, promotes 20/30/40: all 120 distributed
await openTool('waterfall');
await fill([['#tool-waterfall-equity', '100'], ['#tool-waterfall-flows', '120'], ['#tool-waterfall-lpShare', '90'], ['#tool-waterfall-h1', '8'], ['#tool-waterfall-p1', '20'], ['#tool-waterfall-h2', '12'], ['#tool-waterfall-p2', '30'], ['#tool-waterfall-h3', '15'], ['#tool-waterfall-p3', '40']]);
check('waterfall distributes every dollar', (await result('Total distributed')) === '$120', await result('Total distributed'));
await page.fill('#tool-waterfall-h2', '6');
await page.waitForTimeout(150);
check('hurdles out of order are flagged', /Hurdles should rise/.test(await page.textContent('#sheet-body .tool-warn')));
await closeSheet();

// comp set check uses the comps loaded on the Comps tab
await openTool('compset');
await fill([['#tool-compset-subjectSf', '10,000']]);
check('comp set check reads the sale comps', (await result('Priced sale comps')) === String(nSales) || Number(await result('Priced sale comps')) > 0, `${await result('Priced sale comps')} of ${nSales}`);
check('comp set gives a value range for the subject', /\$/.test(await result('Subject at the median') || ''));
await closeSheet();

// no deal open: load and send are disabled
await openTool('loan');
check('without a deal, Load from deal and Send to deal are disabled', await page.isDisabled('#tool-load-deal') && await page.isDisabled('#tool-send'));
await closeSheet();

// open a deal from an OM
await go('deal');
await page.setInputFiles('#om-file', F + 'om-retail.pdf');
await page.waitForSelector('#deal-tiles .tile');
await go('tools');
await openTool('loan');
await page.click('#tool-load-deal');
await page.waitForTimeout(200);
check('loan sizing loads the deal’s price', (await page.inputValue('#tool-loan-price')) === '6,450,000', await page.inputValue('#tool-loan-price'));
await page.fill('#tool-loan-ltv', '60');
await page.waitForTimeout(150);
await page.click('#tool-send');
await page.waitForSelector('dialog.action-sheet');
const sub = await page.textContent('dialog.action-sheet .action-item.primary');
check('confirmation lists the change', /LTV: 65\.00% → 60\.00%/.test(sub), sub);
await page.click('dialog.action-sheet .action-cancel');
await page.waitForTimeout(200);
await closeSheet();
await go('deal');
check('cancel leaves the deal unchanged', (await page.inputValue('#loan-ltv')) === '65', await page.inputValue('#loan-ltv'));
await go('tools');
await openTool('loan');
await page.click('#tool-load-deal'); await page.fill('#tool-loan-ltv', '60'); await page.waitForTimeout(150);
await page.click('#tool-send'); await page.click('dialog.action-sheet .action-item.primary'); await page.waitForTimeout(300);
await closeSheet();
await go('deal');
check('confirmed write sets the deal’s LTV', (await page.inputValue('#loan-ltv')) === '60', await page.inputValue('#loan-ltv'));

// hold returns: assumptions go to the What-if scenario, not the deal's figures
await go('tools');
await openTool('hold');
await page.click('#tool-load-deal');
await fill([['#tool-hold-hold', '7'], ['#tool-hold-exitCap', '7.5'], ['#tool-hold-acqFeePct', '1'], ['#tool-hold-amFeePct', '1.5']]);
const irr = await result('Levered IRR');
check('hold returns compute with fees', /%$/.test(irr || '') && /after fees/.test(await page.textContent('#sheet-body .results')), irr);
check('by-year table has 7 rows', (await page.locator('#sheet-body .tool-table tbody tr').count()) === 7);
await page.click('#tool-send'); await page.click('dialog.action-sheet .action-item.primary'); await page.waitForTimeout(300);
await closeSheet();
await go('deal');
await page.click('#tab-whatif');
await page.waitForSelector('#scn-hold');
check('hold and exit cap reach the What-if scenario', (await page.inputValue('#scn-hold')) === '7' && /^7\.5%?$/.test(await page.inputValue('#scn-exitCap')), `${await page.inputValue('#scn-hold')} ${await page.inputValue('#scn-exitCap')}`);

// NOI bridge writes income figures, marked as typed from the tool
await go('tools');
await openTool('bridge');
await fill([['#tool-bridge-gpr', '600,000'], ['#tool-bridge-vacancyPct', '5'], ['#tool-bridge-creditPct', '0'], ['#tool-bridge-taxes', '60,000'], ['#tool-bridge-insurance', '15,000'], ['#tool-bridge-mgmtPct', '3']]);
check('NOI bridge: 570,000 EGI less 92,100 expenses', (await result('Net operating income')) === '$477,900', await result('Net operating income'));
await page.click('#tool-send');
const sub2 = await page.textContent('dialog.action-sheet .action-item.primary');
check('bridge confirmation names the NOI change', /NOI: .* → \$477,900/.test(sub2), sub2);
await page.click('dialog.action-sheet .action-item.primary'); await page.waitForTimeout(300);
await closeSheet();
await go('deal');
await page.click('#tab-overview');
await page.waitForTimeout(300);
check('deal NOI is now the bridge’s', /\$478K|477,900/.test(await page.textContent('#deal-tiles')), (await page.textContent('#deal-tiles')).replace(/\s+/g, ' ').slice(0, 300));

// inputs are remembered across a reload
await page.reload({ waitUntil: 'load' });
await go('tools');
await openTool('amort');
check('inputs remembered after reload', (await page.inputValue('#tool-amort-loan')) === '10,000,000');
await closeSheet();
const txt = await page.locator('#app').innerText();
check('no NaN/undefined/Infinity', !/\b(NaN|undefined|Infinity)\b/.test(txt));
for (const [s, n, d] of R) console.log(s, '|', n, d ? `| ${d}` : '');
console.log('PASS', R.filter((x) => x[0] === 'PASS').length, 'FAIL', R.filter((x) => x[0] === 'FAIL').length, 'errors', errors);
await browser.close();
