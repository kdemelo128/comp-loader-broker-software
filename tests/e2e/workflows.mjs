import { phone, BASE, SHOTS } from './lib.mjs';
import fs from 'fs';
const F = new URL('./files/', import.meta.url).pathname;
const { browser, page, errors } = await phone();
const R = [];
const check = (name, cond, detail = '') => { R.push([cond ? 'PASS' : 'FAIL', name, detail]); };
const sheetAction = async (label) => { await page.locator('.action-sheet .action-item', { hasText: label }).first().click(); };
page.on('dialog', (d) => d.accept('cracked tiles at entry'));

await page.goto(BASE, { waitUntil: 'load' });
// ---- comps: manual comp add / edit / delete / undo
await page.click('#example');
await page.waitForTimeout(400);
const nSales = await page.locator('#sales-table tbody tr').count();
check('example set loads', nSales > 0, `${nSales} sales`);
await page.locator('[data-add="sale"]').first().click();
await page.waitForTimeout(300);
const row = page.locator('#sales-table tbody tr[data-key^="manual::"]');
await row.locator('input[aria-label="Property name"]').fill('Hand Comp One'); await row.locator('input[aria-label="Property name"]').press('Tab');
const hr = page.locator('#sales-table tbody tr[data-key^="manual::"]');
await hr.locator('input[aria-label="Sale price"]').fill('3.3m'); await hr.locator('input[aria-label="Sale price"]').press('Tab');
await hr.locator('input[aria-label="Building SF"]').fill('6,000'); await hr.locator('input[aria-label="Building SF"]').press('Tab');
await hr.locator('input[aria-label="Cap rate, percent"]').fill('0.0625'); await hr.locator('input[aria-label="Cap rate, percent"]').press('Tab');
await page.waitForTimeout(300);
check('hand comp $/SF = price / SF', (await hr.locator('.calc').textContent()) === '$550.00', await hr.locator('.calc').textContent());
check('hand comp cap typed as fraction reads 6.25', (await hr.locator('input[aria-label="Cap rate, percent"]').inputValue()) === '6.25');
// search
await page.fill('#sale-search', 'Hand Comp');
await page.waitForTimeout(400);
check('search filters', (await page.locator('#sales-table tbody tr').count()) === 1);
await page.fill('#sale-search', '');
await page.waitForTimeout(400);
// sort by price
await page.selectOption('#sale-sort', 'price');
const prices = await page.$$eval('#sales-table tbody tr input[aria-label="Sale price"]', (x) => x.map((i) => Number(i.value.replace(/,/g, '')) || 0));
check('sort by price is descending', prices.every((p, i) => i === 0 || prices[i - 1] >= p), prices.join(','));
// delete + undo
await hr.locator('button[aria-label^="Remove this comp"]').click();
await page.waitForTimeout(300);
check('hand comp removed', (await page.locator('#sales-table tbody tr[data-key^="manual::"]').count()) === 0);
await page.locator('.toast button').click();
await page.waitForTimeout(300);
check('undo restores the hand comp', (await page.locator('#sales-table tbody tr[data-key^="manual::"]').count()) === 1);
// move to market and back
const before = await page.locator('#market-table tbody tr').count();
await page.locator('#sales-table tbody tr[data-key^="manual::"]').locator('button[aria-label^="Move to On Market"]').click();
await page.waitForTimeout(300);
check('move to On Market', (await page.locator('#market-table tbody tr').count()) === before + 1);
await page.locator('.toast button').click();
await page.waitForTimeout(300);
check('undo move', (await page.locator('#market-table tbody tr').count()) === before);
// bulk toggle
await page.locator('[data-bulk="sale"]').first().click();
await page.waitForTimeout(300);
check('set all sales aside', (await page.$$eval('#sales-table tbody tr input.tog', (x) => x.filter((i) => i.checked).length)) === 0);
await page.locator('.toast button').click();
await page.waitForTimeout(300);
// detail sheet
await page.locator('#sales-table tbody tr').first().locator('button[aria-label^="Everything on this comp"]').click();
await page.waitForTimeout(300);
check('comp detail sheet opens', await page.evaluate(() => document.getElementById('sheet').open));
await page.screenshot({ path: `${SHOTS}detail.png` });
await page.click('#sheet-close');
// CSV
await page.click('#comps-more');
const [csv] = await Promise.all([page.waitForEvent('download'), sheetAction('CSV')]);
await csv.saveAs(F + 'out.csv');
const csvText = fs.readFileSync(F + 'out.csv', 'utf8');
check('CSV exported with header and rows', csvText.split('\n').length > 5 && /Hand Comp One/.test(csvText), `${csvText.split('\n').length} lines`);
check('CSV cells cannot run as formulas', !/(^|,)[=+@]/m.test(csvText));
// project save / clear / reopen
await page.click('#comps-more');
const [proj] = await Promise.all([page.waitForEvent('download'), sheetAction('Save project file')]);
await proj.saveAs(F + 'project.json');
await page.click('#comps-more');
await sheetAction('Clear all comps');
await page.waitForTimeout(300);
check('clear all', (await page.locator('#sales-table tbody tr').count()) === 0);
await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1200);
check('cleared set stays cleared after reload', (await page.locator('#sales-table tbody tr').count()) === 0);
await page.setInputFiles('#file', F + 'project.json');
await page.waitForTimeout(800);
check('project reopens with the hand comp', (await page.locator('#sales-table tbody tr[data-key^="manual::"]').count()) === 1);

// ---- deal: two deals, questions, checklist, notes, delete + undo
await page.click('.tab[data-view="deal"] >> visible=true');
await page.setInputFiles('#om-file', F + 'om-retail.pdf');
await page.waitForSelector('#deal-tiles .tile');
await page.fill('#deal-q .add-q input', 'Any environmental reports?');
await page.press('#deal-q .add-q input', 'Enter');
await page.locator('#deal-q li', { hasText: '32.3% of rent' }).locator('input').check();
await page.click('#tab-visit');
await page.locator('button[aria-label="Roof: Issue"]').click();
await page.fill('#visit-notes', 'Met the owner. Roof replaced 2019 per owner (reported).');
await page.waitForTimeout(600);
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('#deal-tiles .tile');
check('own question persists', (await page.locator('#deal-q li', { hasText: 'Any environmental reports?' }).count()) === 1);
check('ticked question persists', await page.locator('#deal-q li', { hasText: '32.3% of rent' }).locator('input').isChecked());
check('checklist issue + note persists', (await page.getAttribute('button[aria-label="Roof: Issue"]', 'aria-pressed')) === 'true');
check('visit notes persist', (await page.inputValue('#visit-notes')).includes('Roof replaced'));
// summary text contains the visit note
const summary = await page.evaluate(async () => { const m = await import('./app/brief.js'); return typeof m.dealSummaryText; });
check('brief module loads', summary === 'function');
// second deal and isolation
await page.click('#deal-root .view-head button[aria-label="More deal actions"]');
await sheetAction('Scan another OM');
await page.waitForTimeout(200);
await page.setInputFiles('#om-file', F + 'om-netlease.pdf');
await page.waitForFunction(() => document.querySelector('#deal-root h2')?.textContent.includes('8820'));
check('second deal has no first-deal notes', (await page.inputValue('#visit-notes')) === '');
check('second deal has no first-deal question', (await page.locator('#deal-q li', { hasText: 'Any environmental reports?' }).count()) === 0);
// delete second deal, undo, delete again
await page.click('#deal-root .view-head button[aria-label="More deal actions"]');
await sheetAction('Delete this deal');
await page.waitForTimeout(500);
let list = await page.$$eval('#deal-root .list .li .li-title', (x) => x.map((e) => e.textContent));
check('delete removes only that deal', list.length === 1 && list[0].includes('4410'), list.join(' / '));
await page.locator('.toast button').click();
await page.waitForTimeout(800);
check('undo delete reopens it', (await page.locator('#deal-root h2').first().textContent()).includes('8820'));
await page.click('#deal-root .view-head button[aria-label="More deal actions"]');
await sheetAction('Delete this deal');
await page.waitForTimeout(1200);
await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1000);
list = await page.$$eval('#deal-root .list .li .li-title', (x) => x.map((e) => e.textContent));
check('a deleted deal stays deleted after reload', list.length === 1 && list[0].includes('4410'), list.join(' / '));

// ---- tools
await page.click('.tab[data-view="tools"] >> visible=true');
// a tool by the start of its title (a description can name another tool)
const toolCard = (title) => page.locator('#tools-root .tool', { has: page.locator('h3', { hasText: new RegExp(`^${title}`) }) });
const tool = async (title, vals) => {
  await toolCard(title).click();
  for (const [id, v] of Object.entries(vals)) { const i = page.locator(`#sheet-body [id$="-${id}"]`); await i.fill(v); await i.press('Tab'); }
  await page.waitForTimeout(200);
  const out = await page.$$eval('#sheet-body .results li', (x) => x.map((l) => l.innerText.replace(/\n/g, ' ')));
  await page.click('#sheet-close');
  return out;
};
let o = await tool('Quick value', { price: '12.5m', noi: '875k', cap: '' });
check('quick value cap', o.some((l) => /Cap rate.*7\.00%/.test(l)), o.join(' | '));
o = await tool('Offer and seller net', { ask: '13m', noi: '875k', targetCap: '7', price: '12.5m', commission: '4', transfer: '0.5', other: '25k', payoff: '6m' });
check('seller net with 0.5% transfer', o.some((l) => /Transfer taxes.*\$62,500/.test(l)) && o.some((l) => /net proceeds.*\$5,912,500/.test(l)), o.join(' | '));
o = await tool('Net effective rent', { rent: '42', sf: '2500', months: '120', esc: '3', free: '4', ti: '40', lc: '6', discount: '8' });
check('NER simple $39.86', o.some((l) => /\$39\.86\/SF/.test(l)), o.join(' | '));
o = await tool('Loan sizing', { price: '12.5m', noi: '875k', ltv: '65', rate: '6.75', amort: '30', minDscr: '1.25', minDy: '8' });
check('loan sizing max $8,125,000', o.some((l) => /Maximum loan.*\$8,125,000/.test(l)), o.join(' | '));
o = await tool('1031 exchange clock', { closing: '2026-01-15' });
check('1031 dates', o.some((l) => /Mar 1, 2026/.test(l)) && o.some((l) => /Jul 14, 2026/.test(l)), o.join(' | '));
await page.reload({ waitUntil: 'load' });
await page.click('.tab[data-view="tools"] >> visible=true');
await toolCard('Loan sizing').click();
check('tool inputs remembered', (await page.inputValue('#sheet-body [id$="-price"]')).replace(/,/g, '') === '12500000');
await page.click('#sheet-close');

for (const [s, n, d] of R) console.log(s, '|', n, d ? `| ${d}` : '');
console.log('PASS', R.filter((r) => r[0] === 'PASS').length, 'FAIL', R.filter((r) => r[0] === 'FAIL').length);
console.log('errors', errors);
await browser.close();
