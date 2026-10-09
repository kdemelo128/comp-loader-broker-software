import { phone, BASE, SHOTS } from './lib.mjs';
import fs from 'fs';
const F = new URL('./files/', import.meta.url).pathname;
const { browser, page, errors } = await phone();
const R = []; const check = (n, c, d = '') => R.push([c ? 'PASS' : 'FAIL', n, d]);
page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'Firm office layout' : undefined));
const tile = async (k) => (await page.$$eval('#deal-rentroll .tiles .tile', (t) => t.map((x) => [x.querySelector('.k').textContent, x.querySelector('.v').textContent]))).find((x) => x[0] === k)?.[1];
await page.goto(BASE + '#deal', { waitUntil: 'load' });
await page.setInputFiles('#om-file', F + 'om-retail.pdf');
await page.waitForSelector('#deal-tiles .tile');
check('overview rent roll summary shows in-place rent', /\$468K/.test(await page.textContent('#deal-rr')), await page.textContent('#deal-rr'));
await page.click('#tab-rentroll');
await page.waitForSelector('#deal-rentroll .rr-grid tbody tr');
check('5 units from the OM', (await page.locator('#deal-rentroll .rr-grid tbody tr').count()) === 5);
check('in-place rent $468K', (await tile('In-place rent')) === '$468K', await tile('In-place rent'));
check('occupancy 91.7%', (await tile('Occupancy')) === '91.7%');
// edit annual rent of the first unit
const first = page.locator('#deal-rentroll .rr-grid tbody tr').first();
const annual = first.locator('input[aria-label^="Annual rent"]');
await annual.fill('130,000'); await annual.press('Enter');
await page.waitForTimeout(300);
check('typed annual rent updates the total', (await tile('In-place rent')) === '$473K', await tile('In-place rent'));
check('rent/SF follows the typed rent (130,000 / 2,400)', (await first.locator('input[aria-label^="Rent / SF"]').inputValue()) === '$54.17', await first.locator('input[aria-label^="Rent / SF"]').inputValue());
// keyboard: Enter moved focus down one row in the same column
check('Enter moves to the next row, same column', await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-label')?.startsWith('Annual rent') && document.activeElement.dataset.r === '1'));
await page.keyboard.press('ArrowUp');
check('ArrowUp moves back', await page.evaluate(() => document.activeElement.dataset.r === '0'));
// schedule: generate 3% steps, add free rent
await first.locator('button[aria-label^="Lease schedule"]').click();
await page.waitForSelector('#sheet-body .timeline svg');
check('timeline drawn', (await page.locator('#sheet-body .timeline rect').count()) >= 1);
await page.click('#sheet-body .rr-gen summary');
await page.fill('#gen-rate', '52');
await page.selectOption('#gen-unit', 'psf_year');
await page.fill('#gen-value', '3');
await page.fill('#gen-every', '12');
await page.dispatchEvent('#gen-rate', 'change'); await page.dispatchEvent('#gen-value', 'change'); await page.dispatchEvent('#gen-every', 'change');
await page.locator('#sheet-body button', { hasText: 'Replace the periods' }).click();
await page.waitForTimeout(300);
const nPer = await page.locator('#sheet-body table.sched tr').count() - 1;
check('3% steps generated from lease start to end (2019-03 to 2029-02: 10 periods)', nPer === 10, String(nPer));
await page.locator('#sheet-body button', { hasText: '+ Free rent or abatement' }).click();
await page.waitForTimeout(200);
// duplicate a period to create an overlap -> validation error shown
await page.locator('#sheet-body button[aria-label="Duplicate period 1"]').click();
await page.waitForTimeout(200);
check('overlap is flagged', /overlap/.test(await page.textContent('#sheet-body .checks')), await page.textContent('#sheet-body .checks'));
await page.locator('#sheet-body button[aria-label="Delete period 2"]').click();
await page.waitForTimeout(200);
check('overlap cleared after deleting the duplicate', !/overlap/.test((await page.locator('#sheet-body .checks').allTextContents()).join(' ')));
await page.screenshot({ path: `${SHOTS}rr-schedule.png`, fullPage: false });
await page.click('#sheet-foot .btn-primary');
await page.waitForTimeout(300);
const inPlaceAfter = await tile('In-place rent');
check('in-place rent now from the stepped schedule (2026 step: $52 x 1.03^7 x 2,400)', inPlaceAfter === `$${Math.round((468000 - 124800 + 52 * 1.03 ** 7 * 2400) / 1000)}K`, inPlaceAfter);
// columns: hide Options, add a custom field
await page.locator('#deal-rentroll button', { hasText: 'Columns' }).click();
await page.waitForSelector('#sheet-body .col-row');
await page.fill('#sheet-body .add-q input', 'Tenant contact');
await page.locator('#sheet-body .add-q button').click();
await page.waitForTimeout(200);
await page.locator('#sheet-body button', { hasText: 'Save this layout' }).click();
await page.waitForTimeout(500);
await page.click('#sheet-close');
const custom = page.locator('#deal-rentroll .rr-grid tbody tr').first().locator('input[aria-label^="Tenant contact"]');
check('custom column added', (await custom.count()) === 1);
await custom.fill('Jo at 555-0100'); await custom.press('Tab');
// assumptions: opex -> NOI
await page.click('#deal-rentroll .rr-settings summary');
const opexIn = page.locator('#deal-rentroll .rr-settings label', { hasText: 'Operating expenses' }).locator('xpath=following-sibling::input');
if (!(await opexIn.inputValue())) { await opexIn.fill('135,750'); await opexIn.press('Tab'); }
await page.waitForTimeout(300);
const noiRow = await page.$$eval('#deal-rentroll table.proj tr', (rows) => rows.map((r) => [...r.children].map((c) => c.textContent)).find((r) => r[0] === 'Net operating income'));
check('projection reaches NOI', !!noiRow && /\$/.test(noiRow[1]), noiRow && noiRow.slice(0, 3).join(' | '));
// what-if on rent roll NOI
await page.click('#tab-whatif');
await page.selectOption('#scn-noiBasis', 'rentroll');
await page.waitForTimeout(300);
const scnNotes = await page.textContent('#scn-out');
check('what-if returns from the rent roll projection', /from the rent roll projection/.test(scnNotes) && !/NaN/.test(scnNotes));
// export rent roll workbook
await page.click('#tab-rentroll');
await page.locator('#deal-rentroll button[aria-label="More rent roll actions"]').click();
const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.action-sheet .action-item', { hasText: 'Export rent roll and cash flow' }).click()]);
await dl.saveAs(F + 'out-rentroll.xlsx');
check('rent roll workbook downloaded', true, dl.suggestedFilename());
// import CSV
fs.writeFileSync(F + 'import-rr.csv', 'Suite,Tenant,Square Feet,Lease Start,Lease Expiration,Annual Base Rent\n101,"Acme, Inc.",1500,2024-01-01,2029-12-31,"$45,000"\n102,Vacant,800,,,\n103,Beta LLC,1200,03/01/2025,02/28/2030,38400\nTotal,,3500,,,"$83,400"\n');
await page.locator('#deal-rentroll button[aria-label="More rent roll actions"]').click();
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.action-sheet .action-item', { hasText: 'Import from Excel or CSV' }).click()]);
await chooser.setFiles(F + 'import-rr.csv');
await page.waitForSelector('#sheet-body .map-row');
const mapped = await page.$$eval('#sheet-body .map-row', (rs) => rs.map((r) => `${r.querySelector('.h').firstChild.textContent}->${r.querySelector('select').value}`));
check('CSV headings mapped', mapped.join(',') === 'Suite->unit,Tenant->tenant,Square Feet->sf,Lease Start->leaseStart,Lease Expiration->leaseEnd,Annual Base Rent->annual', mapped.join(','));
await page.locator('#sheet-body label.chk input').uncheck();
await page.click('#sheet-foot .btn-primary');
await page.waitForTimeout(400);
check('imported rows added (total line skipped)', (await page.locator('#deal-rentroll .rr-grid tbody tr').count()) === 8);
// reload: persisted
await page.waitForTimeout(600);
await page.reload({ waitUntil: 'load' });
await page.click('#tab-rentroll');
await page.waitForSelector('#deal-rentroll .rr-grid tbody tr');
check('rent roll persists after reload (8 units, custom value)', (await page.locator('#deal-rentroll .rr-grid tbody tr').count()) === 8 && (await page.locator('input[aria-label^="Tenant contact"]').first().inputValue()) === 'Jo at 555-0100');
// a second deal starts with its own rent roll
await page.evaluate(() => [...document.querySelectorAll('#deal-root button')].find((b) => b.textContent.includes('All deals')).click());
await page.waitForTimeout(300);
await page.evaluate(() => [...document.querySelectorAll('#deal-root button')].find((b) => b.textContent.includes('Enter figures by hand')).click());
await page.click('#tab-rentroll');
await page.waitForTimeout(300);
check('a new deal has an empty rent roll, with the saved layout offered', (await page.locator('#deal-rentroll .rr-grid tbody tr').count()) === 1 && /No units yet/.test(await page.textContent('#deal-rentroll')));
const txt = await page.locator('#app').innerText();
check('no NaN/undefined/Infinity', !/\b(NaN|undefined|Infinity)\b/.test(txt));
console.log('scroll', await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]));
for (const [s, n, d] of R) console.log(s, '|', n, d ? `| ${d}` : '');
console.log('PASS', R.filter((x) => x[0] === 'PASS').length, 'FAIL', R.filter((x) => x[0] === 'FAIL').length, 'errors', errors);
await browser.close();
