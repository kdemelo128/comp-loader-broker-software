/* "What this affects" (checkpoint e), as a person meets it:
 *   - a figure's Affects button lists what moves on this deal as it stands, and
 *     folds away what could only move in other circumstances, with why;
 *   - a tried value shows before → after, and nothing is saved;
 *   - a tile says how its figure is worked out;
 *   - the command menu finds it ("what does … affect");
 *   - on the 500-lease rent roll: one lease's list, a column's, and History's
 *     "What it changed" for an edited rent, with a tried rent (the projection
 *     in the worker), timed;
 *   - axe finds nothing on the sheet, phone and desktop. */
import fs from 'fs';
import { createRequire } from 'module';
import { phone, BASE } from './lib.mjs';

const F = new URL('./files/', import.meta.url).pathname;
const R = []; const check = (n, c, d = '') => R.push([c ? 'PASS' : 'FAIL', n, d]);
const { browser, page, errors } = await phone({ viewport: { width: 1360, height: 900 }, isMobile: false, hasTouch: false, userAgent: undefined, deviceScaleFactor: 1 });
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const settle = () => page.waitForTimeout(700);
const texts = (sel) => page.$$eval(sel, (xs) => xs.map((x) => x.textContent.replace(/\s+/g, ' ').trim())).catch(() => []);
const close = async () => { await page.click('#sheet-close'); await page.waitForTimeout(250); };
const histCount = () => page.evaluate(() => new Promise((res) => { const r = indexedDB.open('zlatura'); r.onsuccess = () => { const g = r.result.transaction('history').objectStore('history').count(); g.onsuccess = () => { res(g.result); r.result.close(); }; }; }));

await page.goto(`${BASE}#deal`, { waitUntil: 'load' });
await page.setInputFiles('#om-file', `${F}om-retail.pdf`);
await page.waitForSelector('#deal-tiles .tile');
await settle();

// a firm template mapping price and NOI (the uw-model fixture: Inputs!B5 and B6; B7 = B6/B5, B14 = B5*B13, Summary B1 and B3 read B5)
const model = [...fs.readFileSync(`${F}uw-model.xlsx`)];
await page.evaluate((bytes) => new Promise((res, rej) => {
  const r = indexedDB.open('zlatura');
  r.onsuccess = () => {
    const tx = r.result.transaction('kv', 'readwrite');
    const now = Date.now();
    tx.objectStore('kv').put([{ id: 'tacme', name: 'Acme model', category: 'Underwriting', description: '', archived: false, createdAt: now, updatedAt: now,
      versions: [{ at: now, fileName: 'uw-model.xlsx', bytes: new Uint8Array(bytes), size: bytes.length, note: 'uploaded' }], current: 0,
      mapping: { cells: [{ sheet: 'Inputs', cell: 'B5', field: 'price' }, { sheet: 'Inputs', cell: 'B6', field: 'noi' }], tables: [] }, features: {}, warnings: [] }], 'tpl.library');
    tx.oncomplete = () => { r.result.close(); res(); };
    tx.onerror = () => rej(tx.error);
  };
}), model);

// the stated cap rate: with a price and an NOI entered, it moves neither the price nor the cap rate
await page.click('button[aria-label="What changing Cap rate stated affects"]');
await page.waitForSelector('#impact-out');
const title = await page.textContent('#sheet-title');
check('the sheet names the input', /What changing cap rate stated affects/.test(title), title);
const figs = await texts('#impact-figures .li-title');
check('the stated cap rate moves neither the price nor the cap rate on this deal', !figs.some((t) => /^(Price|Cap rate)$/.test(t)), figs.join(' | '));
const checks = await texts('#impact-checks .li-title');
check('it is in the check that compares it with NOI ÷ price', checks.includes('Stated cap rate against NOI ÷ price'), checks.join(' | '));
const exportsTxt = (await texts('#impact-exports .li')).join(' | ');
check('the deal workbook’s row for it is listed', /Deal workbook › Deal Analysis.*Cap rate stated in the OM \(B7\)/.test(exportsTxt), exportsTxt);
check('the firm template’s cell for NOI is not listed: the stated cap rate doesn’t move NOI here', !/Acme model/.test(exportsTxt), exportsTxt);
const could = await page.$$eval('#impact-could li', (xs) => xs.map((x) => `${x.querySelector('.li-title').textContent}: ${x.querySelector('.li-sub').textContent}`));
check('what it could move folds away, each with its condition', could.includes('Price: only when no price is entered'), could.slice(0, 4).join(' | '));
await close();

// the loan rate: try 8%, see DSCR before → after, and nothing saved
const h0 = await histCount();
await page.click('button[aria-label="What changing interest rate affects"]');
await page.waitForSelector('#impact-figures');
const lf = await texts('#impact-figures .li-title');
check('the loan rate moves debt service and DSCR', lf.includes('Annual debt service') && lf.includes('DSCR'), lf.join(' | '));
await close();
// NOI: its template cell, and how many of the template's own formulas read it
await page.click('button[aria-label="What changing NOI, in place affects"]');
await page.waitForSelector('#impact-exports');
await page.waitForFunction(() => /formula/.test(document.querySelector('#impact-exports li[data-template="tacme"]')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
const tpl = await page.textContent('#impact-exports li[data-template="tacme"]').catch(() => '');
check('NOI lists the firm template’s NOI cell (not its price cell), with the template’s own formulas that read it', /^Acme model \(firm template\)Inputs!B6 · 1 formula in the workbook reads? it$/.test(tpl.replace(/\s+/g, ' ').trim()), tpl);
await close();
await page.click('button[aria-label="What changing interest rate affects"]');
await page.waitForSelector('#impact-figures');
const sc = await texts('#impact-scenarios .li');
check('and the What-if', sc.some((t) => /^What-if/.test(t)), sc.join(' | '));
await page.fill('#impact-trial', '8');
await page.click('#impact-try');
await page.waitForFunction(() => /→/.test(document.querySelector('#impact-figures')?.textContent || ''));
const dscr = (await texts('#impact-figures li')).find((t) => /^DSCR/.test(t)) || '';
check('a tried 8% shows DSCR before → after', /^DSCR\s*[\d.]+x → [\d.]+x$/.test(dscr), dscr);
await close();
await settle();
check('nothing was saved: the rate is as it was', (await page.inputValue('#loan-rate')) === '6.75', await page.inputValue('#loan-rate'));
check('and History has no new entry', (await histCount()) === h0, `${h0} → ${await histCount()}`);

// a tile: how its figure is worked out
await page.click('#deal-tiles .tile[data-fig="fig.dscr"]');
await page.waitForSelector('#impact-from');
const from = await texts('#impact-from .li-title');
check('the DSCR tile says it is NOI over debt service', from.includes('NOI') && from.includes('Annual debt service'), from.join(' | '));
check('and down to the inputs typed', /Interest rate/.test(await page.textContent('#impact-from')));
await close();

// the command menu
await page.keyboard.press(`${MOD}+k`);
await page.waitForSelector('.cmdk input');
await page.keyboard.type('what does building sf affect');
await page.waitForTimeout(250);
await page.keyboard.press('Enter');
await page.waitForSelector('#impact-out');
check('the command menu opens “what does building SF affect”', /What changing building SF affects/.test(await page.textContent('#sheet-title')), await page.textContent('#sheet-title'));
const bsf = await texts('#impact-figures .li-title');
check('building SF moves price per SF', bsf.includes('Price per SF'), bsf.join(' | '));
await close();
await page.keyboard.press(`${MOD}+k`);
await page.waitForSelector('.cmdk input');
await page.keyboard.type('lender');
await page.waitForTimeout(250);
check('a plain search (“lender”) isn’t crowded by “what does … affect” commands', !/What does/.test(await page.textContent('#cmdk-list')), (await page.textContent('#cmdk-list')).slice(0, 120));
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// the 500-lease rent roll
let csv = 'Suite,Tenant,Square Feet,Lease Start,Lease Expiration,Annual Base Rent\n';
for (let i = 0; i < 500; i++) csv += `${1000 + i},Tenant ${i},${1000 + (i % 7) * 250},2022-0${1 + (i % 9)}-01,20${28 + (i % 8)}-12-31,${30000 + i * 37}\n`;
fs.writeFileSync(`${F}rr500-impact.csv`, csv);
await page.click('#tab-rentroll');
await page.locator('#deal-rentroll button[aria-label="More rent roll actions"]').click();
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.action-sheet .action-item', { hasText: 'Import from Excel or CSV' }).click()]);
await chooser.setFiles(`${F}rr500-impact.csv`);
await page.waitForSelector('#sheet-body .map-row');
await page.click('#sheet-foot .btn-primary');
await page.waitForFunction(() => Number(document.querySelector('#deal-rentroll .rr-grid')?.getAttribute('aria-rowcount') || 0) >= 502, null, { timeout: 120000 });
await page.waitForTimeout(1500);

// one lease: timed from the tap on "What this lease affects" to the list on screen
await page.click('#deal-rentroll button[aria-label="More for unit 1000"]');
await page.waitForSelector('.action-sheet .action-item');
const leaseMs = await page.evaluate(() => new Promise((res) => {
  const item = [...document.querySelectorAll('.action-sheet .action-item')].find((x) => /What this lease affects/.test(x.textContent));
  const t0 = performance.now();
  item.click();
  const wait = () => (document.querySelector('#impact-figures') ? requestAnimationFrame(() => res(performance.now() - t0)) : requestAnimationFrame(wait));
  wait();
}));
const lfig = await texts('#impact-figures .li-title');
check('one lease moves the rent roll’s occupancy, rent and WALT, and the projected NOI', ['Occupancy by SF (rent roll)', 'In-place rent, a year', 'WALT', 'NOI (projected)'].every((x) => lfig.includes(x)), lfig.slice(0, 12).join(' | '));
check(`its list opens in under a second on 500 leases (${Math.round(leaseMs)} ms)`, leaseMs < 1000, `${Math.round(leaseMs)} ms`);
const lex = (await texts('#impact-exports .li')).join(' | ');
check('and the rent roll workbook and CSV', /Rent Roll/.test(lex) && /Rent roll CSV/.test(lex), lex.slice(0, 200));
await close();

// a column
await page.locator('#deal-rentroll button[aria-label="More rent roll actions"]').click();
await page.locator('.action-sheet .action-item', { hasText: 'What a column affects' }).click();
await page.locator('.action-sheet .action-item', { hasText: /^SF$/ }).first().click();
await page.waitForSelector('#impact-figures');
const colF = await texts('#impact-figures .li-title');
check('the SF column moves total SF and occupancy, and not in-place rent (these rents are a year, not per SF)', colF.includes('Total SF (rent roll)') && colF.includes('Occupancy by SF (rent roll)') && !colF.includes('In-place rent, a year'), colF.slice(0, 12).join(' | '));
const colC = await page.$$eval('#impact-could li', (xs) => xs.map((x) => `${x.querySelector('.li-title').textContent}: ${x.querySelector('.li-sub').textContent}`));
check('in-place rent is folded away, “only for a rent quoted per SF”', colC.includes('In-place rent, a year: only for a rent quoted per SF'), colC.slice(0, 6).join(' | '));
await close();

// a deal figure on the 500-lease deal, timed: the list, with every value on it worked out
await page.click('#tab-overview');
await page.waitForSelector('button[aria-label="What changing NOI, in place affects"]');
const noiMs = await page.evaluate(() => new Promise((res) => {
  const t0 = performance.now();
  document.querySelector('button[aria-label="What changing NOI, in place affects"]').click();
  const wait = () => (document.querySelector('#impact-figures') ? requestAnimationFrame(() => res(performance.now() - t0)) : requestAnimationFrame(wait));
  wait();
}));
check(`NOI’s list on the 500-lease deal opens in ${Math.round(noiMs)} ms`, noiMs < 1000, `${Math.round(noiMs)} ms`);
await close();
await page.click('#tab-rentroll');
await page.waitForSelector('#deal-rentroll input[aria-label="Annual rent, unit 1001"]');

// an edited rent, then History's "What it changed", with a rent tried there (the projection runs in the worker)
const rentIn = page.locator('#deal-rentroll input[aria-label="Annual rent, unit 1001"]');
await rentIn.fill('45000');
await rentIn.press('Tab');
await settle();
await page.click('button[aria-label="More deal actions"]');
await page.locator('.action-sheet .action-item', { hasText: 'History' }).click();
await page.waitForSelector('#history-list');
await page.locator('#history-list li').first().locator('button', { hasText: 'What it changed' }).click();
await page.waitForSelector('#impact-out');
check('History’s “What it changed” opens the list for that edit', /^What this change affects: .*unit 1001/.test(await page.textContent('#sheet-title')), await page.textContent('#sheet-title'));
await page.fill('#impact-trial', '90000');
const tryMs = await page.evaluate(() => new Promise((res) => {
  const t0 = performance.now();
  document.querySelector('#impact-try').click();
  const wait = () => (/→/.test(document.querySelector('#impact-figures')?.textContent || '') ? requestAnimationFrame(() => res(performance.now() - t0)) : requestAnimationFrame(wait));
  wait();
}));
const rentRow = (await texts('#impact-figures li')).find((t) => /^In-place rent, a year/.test(t)) || '';
check('a tried rent shows the rent roll’s in-place rent before → after', /→/.test(rentRow), rentRow);
check(`trying a rent on 500 leases, projection included, takes ${Math.round(tryMs)} ms`, tryMs < 3000, `${Math.round(tryMs)} ms`);

// axe on the sheet, desktop then phone
await page.addScriptTag({ path: createRequire(import.meta.url).resolve('axe-core/axe.min.js') });
const axe = () => page.evaluate(async () => (await window.axe.run(document.querySelector('#sheet'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] })).violations.map((v) => `${v.id}: ${v.nodes.length}`));
const a1 = await axe();
check('axe: the sheet has no violations (desktop)', a1.length === 0, a1.join('; '));
await close();
await page.setViewportSize({ width: 390, height: 844 });
await page.click('#tab-overview');
await page.click('button[aria-label="What changing NOI, in place affects"]');
await page.waitForSelector('#impact-out');
const a2 = await axe();
check('axe: the sheet has no violations (phone)', a2.length === 0, a2.join('; '));
const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
check('the phone page doesn’t scroll sideways', fits);

await browser.close();
for (const [s, n, x] of R) console.log(s, '|', n, x ? `| ${x}` : '');
console.log('PASS', R.filter((x) => x[0] === 'PASS').length, 'FAIL', R.filter((x) => x[0] === 'FAIL').length, 'errors', errors);
