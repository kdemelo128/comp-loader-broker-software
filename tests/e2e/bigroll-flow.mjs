/* A 500-lease rent roll (checkpoint c): the grid draws only the rows near the
 * screen, and the projection is worked out in a worker. Checks that nothing a
 * person does is lost to either:
 *   - the grid knows every row (aria-rowcount) while drawing a few dozen;
 *   - arrow keys move past the drawn rows; a typed cell scrolled away is saved;
 *   - search, + Unit and the totals see every row, drawn or not;
 *   - the projection comes from the worker, still arrives if the worker can't
 *     load (worked out on the page instead), and offline;
 *   - axe finds nothing on the windowed grid. */
import fs from 'fs';
import { createRequire } from 'module';
import { phone, BASE } from './lib.mjs';

const F = new URL('./files/', import.meta.url).pathname;
const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const R = []; const check = (n, c, d = '') => R.push([c ? 'PASS' : 'FAIL', n, d]);

let csv = 'Suite,Tenant,Square Feet,Lease Start,Lease Expiration,Annual Base Rent\n';
for (let i = 0; i < 500; i++) csv += `${1000 + i},Tenant ${i},${1000 + (i % 7) * 250},2022-0${1 + (i % 9)}-01,20${28 + (i % 8)}-12-31,${30000 + i * 37}\n`;
fs.writeFileSync(`${F}rr500.csv`, csv);
const DESK = { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, userAgent: undefined, deviceScaleFactor: 1 };
const PROJ = () => [...document.querySelectorAll('#deal-rentroll .rr-out .proj tr.strong td')].some((td) => /\$/.test(td.textContent));
const drawn = (page) => page.evaluate(() => document.querySelectorAll('#deal-rentroll .rr-grid tbody tr[data-id]').length);
const count = (page) => page.evaluate(() => Number(document.querySelector('#deal-rentroll .rr-grid').getAttribute('aria-rowcount')) - 2);

async function importRoll(page) {
  await page.goto(`${BASE}#deal`, { waitUntil: 'load' });
  await page.setInputFiles('#om-file', `${F}om-retail.pdf`);
  await page.waitForSelector('#deal-tiles .tile');
  await page.click('#tab-rentroll');
  await page.locator('#deal-rentroll button[aria-label="More rent roll actions"]').click();
  const [ch] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.action-sheet .action-item', { hasText: 'Import from Excel or CSV' }).click()]);
  await ch.setFiles(`${F}rr500.csv`);
  await page.waitForSelector('#sheet-body .map-row');
  await page.click('#sheet-foot .btn-primary');
  await page.waitForFunction(() => Number(document.querySelector('#deal-rentroll .rr-grid')?.getAttribute('aria-rowcount')) >= 500, null, { timeout: 60000 });
  await page.waitForTimeout(1200);
}

/* ------------------------------------------------ the grid, with a worker */
const { browser, ctx, page, errors } = await phone(DESK);
const workers = [];
page.on('worker', (w) => workers.push(w.url()));
await importRoll(page);
check('the grid counts every row: 505 units (the OM’s 5 and the 500 imported)', (await count(page)) === 505, String(await count(page)));
const n0 = await drawn(page);
check('it draws only the rows near the screen', n0 > 20 && n0 <= 120, `${n0} rows drawn`);
check('the totals row adds up every unit, drawn or not', /Total · 505/.test(await page.textContent('#deal-rentroll .rr-grid tfoot')));
await page.waitForFunction(PROJ, null, { timeout: 30000 });
check('the projection is worked out in a worker', workers.some((u) => /projector-worker\.js$/.test(u)), workers.join(', '));

// arrow keys past the last drawn row
const lastIdx = await page.evaluate(() => Math.max(...[...document.querySelectorAll('#deal-rentroll .rr-grid tbody tr[data-id]')].map((tr) => Number(tr.getAttribute('aria-rowindex')))));
const lastUnit = await page.evaluate((i) => document.querySelector(`#deal-rentroll .rr-grid tr[aria-rowindex="${i}"] input`).getAttribute('aria-label'), lastIdx);
await page.focus(`#deal-rentroll .rr-grid tr[aria-rowindex="${lastIdx}"] input`);
for (let k = 0; k < 3; k++) await page.keyboard.press('ArrowDown');
await page.waitForTimeout(200);
const focused = await page.evaluate(() => ({ label: document.activeElement.getAttribute('aria-label'), row: Number(document.activeElement.closest('tr')?.getAttribute('aria-rowindex')) }));
check('arrow down from the last drawn row reaches the rows below it', focused.row === lastIdx + 3 && focused.label !== lastUnit, `${lastUnit} → ${focused.label}, row ${focused.row}`);

// a typed cell scrolled out of view is saved, not dropped
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(200);
const rentBefore = await page.textContent('#deal-rentroll .tile .v');
const cell = page.locator('#deal-rentroll input[aria-label="Annual rent, unit 1002"]');
await cell.fill('900000');
await page.evaluate(() => document.querySelector('#deal-rentroll .rr-grid tfoot').scrollIntoView({ block: 'end' }));
await page.waitForTimeout(500);
check('the bottom rows are drawn when scrolled to', await page.evaluate(() => !!document.querySelector('#deal-rentroll .rr-grid tr[aria-rowindex="506"][data-id]')));
check('the cell typed before scrolling away was saved', (await page.textContent('#deal-rentroll .tile .v')) !== rentBefore, `${rentBefore} → ${await page.textContent('#deal-rentroll .tile .v')}`);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(300);
check('and shows when scrolled back', (await page.inputValue('#deal-rentroll input[aria-label="Annual rent, unit 1002"]')).replace(/\D/g, '') === '900000');

// search finds a unit that isn't drawn
await page.fill('#deal-rentroll input[type="search"]', '1450');
await page.waitForTimeout(400);
check('search finds a unit far down the list', (await page.locator('#deal-rentroll input[aria-label="Annual rent, unit 1450"]').count()) === 1 && (await page.textContent('#deal-rentroll .rr-grid tfoot td')).trim() === 'Total · 1');
await page.fill('#deal-rentroll input[type="search"]', '');
await page.waitForTimeout(400);

// + Unit on a long rent roll: the new unit is drawn and focused
await page.click('#deal-rentroll .rr-bar button:has-text("+ Unit")');
await page.waitForTimeout(400);
const added = await page.evaluate(() => ({ row: Number(document.activeElement.closest('tr')?.getAttribute('aria-rowindex')), count: Number(document.querySelector('#deal-rentroll .rr-grid').getAttribute('aria-rowcount')) - 2, inGrid: !!document.activeElement.closest('#deal-rentroll .rr-grid tbody') }));
check('+ Unit adds the 506th unit, drawn and focused for typing', added.count === 506 && added.inGrid && added.row === 507, JSON.stringify(added));

// accessibility of the windowed grid
await page.evaluate(() => window.scrollTo(0, 0));
await page.addScriptTag({ path: AXE });
const axe = await page.evaluate(async () => (await window.axe.run(document.querySelector('#deal-rentroll'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] })).violations.map((v) => `${v.id}: ${v.nodes.length}`));
check('axe: the windowed rent roll has no violations', axe.length === 0, axe.join('; '));

// offline: the worker comes from the offline cache
await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => {});
if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(800);
await ctx.setOffline(true);
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('#deal-tiles .tile', { timeout: 30000 });
await page.click('#tab-rentroll');
const offlineOk = await page.waitForFunction(PROJ, null, { timeout: 30000 }).then(() => true, () => false);
check('offline, the projection is still worked out', offlineOk);
await ctx.setOffline(false);
await browser.close();

/* ---------------------------------- no worker: worked out on the page */
const B = await phone(DESK);
await B.ctx.route('**/projector-worker.js', (r) => r.abort());
await importRoll(B.page);
await B.page.reload({ waitUntil: 'load' });
await B.page.waitForSelector('#deal-tiles .tile');
await B.page.click('#tab-rentroll');
const fallbackOk = await B.page.waitForFunction(PROJ, null, { timeout: 30000 }).then(() => true, () => false);
check('if the worker can’t load, the projection is worked out on the page', fallbackOk);
const otherErrors = B.errors.filter((e) => !/projector-worker\.js/.test(e));
check('and nothing else goes wrong', otherErrors.length === 0, otherErrors.join(' | '));
await B.browser.close();

for (const [s, nm, x] of R) console.log(s, '|', nm, x ? `| ${x}` : '');
console.log('PASS', R.filter((x) => x[0] === 'PASS').length, 'FAIL', R.filter((x) => x[0] === 'FAIL').length, 'errors', errors);
