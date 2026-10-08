import { phone, BASE, SHOTS } from './lib.mjs';
const F = new URL('./files/', import.meta.url).pathname;
const { browser, page, errors } = await phone();
const R = [];
const check = (n, c, d = '') => R.push([c ? 'PASS' : 'FAIL', n, d]);
let promptAnswer = 'Lower price';
page.on('dialog', (d) => (d.type() === 'prompt' ? d.accept(promptAnswer) : d.accept()));
const table = () => page.$$eval('#scn-out table tr', (t) => t.map((r) => [...r.children].map((c) => c.textContent)));
const row = async (label) => (await table()).find((r) => r[0].startsWith(label));
await page.goto(BASE + '#deal', { waitUntil: 'load' });
await page.setInputFiles('#om-file', F + 'om-multifamily.pdf');
await page.waitForSelector('#scn-out table');
let r = await row('Price');
check('deal and scenario start equal', r[1] === '$12,500,000' && r[2] === '$12,500,000', r.join(' | '));
// change price
await page.fill('#scn-price', '12m'); await page.press('#scn-price', 'Tab');
await page.waitForTimeout(200);
r = await row('Price'); check('scenario price changes', r[2] === '$12,000,000' && r[1] === '$12,500,000', r.join(' | '));
r = await row('Cap rate'); check('scenario cap = NOI / scenario price', r[2] === '5.99%', r.join(' | '));
r = await row('NOI'); check('price change leaves NOI alone', r[1] === r[2], r.join(' | '));
check('the deal\'s price field is untouched', (await page.inputValue('#fig-price')) === '$12,500,000');
check('changed field is marked scenario', await page.locator('[data-key="price"].changed').count() === 1);
// occupancy falls to 85%
await page.fill('#scn-occ', '85'); await page.press('#scn-occ', 'Tab');
await page.waitForTimeout(200);
r = await row('NOI'); const expect = Math.round(1071400 * 85 / 96 - 352650);
check('occupancy 85% rebuilds NOI from EGI and expenses', r[2] === `$${expect.toLocaleString('en-US')}`, `${r.join(' | ')} expected ${expect}`);
// exit cap only changes returns
const capBefore = (await row('Cap rate'))[2];
const irrBefore = (await row('Levered IRR'))[2];
await page.fill('#scn-exitCap', '7'); await page.press('#scn-exitCap', 'Tab');
await page.waitForTimeout(200);
check('exit cap does not move the going-in cap', (await row('Cap rate'))[2] === capBefore);
check('exit cap moves the IRR', (await row('Levered IRR'))[2] !== irrBefore, `${irrBefore} -> ${(await row('Levered IRR'))[2]}`);
const ans = await page.$$eval('#scn-answers li', (x) => x.map((l) => l.innerText.replace(/\n/g, ' ')));
check('answers shown', ans.length === 4 && ans.some((a) => /levered IRR/.test(a)), ans.join(' | '));
// save scenario, reload: scenario persists, deal untouched
await page.locator('#deal-live button', { hasText: 'Save scenario' }).click();
await page.waitForTimeout(600);
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('#scn-out table');
check('saved scenario persists', (await page.locator('#scn-saved .li-title', { hasText: 'Lower price' }).count()) === 1);
check('live changes persist', (await page.inputValue('#scn-price')) === '$12,000,000');
check('deal price still the OM figure after reload', (await page.inputValue('#fig-price')) === '$12,500,000');
await page.locator('#scn-out').screenshot({ path: `${SHOTS}scenario-table.png` });
await page.locator('#deal-live').screenshot({ path: `${SHOTS}scenario-card.png` });
// reset
await page.locator('#deal-live button', { hasText: 'Reset to the deal' }).click();
await page.waitForTimeout(300);
r = await row('Price'); check('reset restores the deal', r[1] === r[2], r.join(' | '));
// load saved, then save to deal
await page.locator('#scn-saved button', { hasText: 'Load' }).click();
await page.waitForTimeout(300);
check('load saved scenario', (await page.inputValue('#scn-price')) === '$12,000,000');
await page.locator('#deal-live button', { hasText: 'Save to deal' }).click();
await page.waitForTimeout(500);
check('save to deal writes price (after confirm)', (await page.inputValue('#fig-price')) === '$12,000,000');
check('saved figure is tagged edited', (await page.locator('#fig-price').locator('xpath=..').locator('.src').textContent()) === 'edited');
check('hold assumptions stay with the scenario', (await page.inputValue('#scn-exitCap')) === '7%' || (await page.inputValue('#scn-exitCap')) === '7.00%', await page.inputValue('#scn-exitCap'));
const txt = await page.locator('#deal-root').innerText();
check('no NaN/undefined/Infinity on screen', !/\b(NaN|undefined|Infinity|null)\b/.test(txt));
for (const [s, n, d] of R) console.log(s, '|', n, d ? `| ${d}` : '');
console.log('PASS', R.filter((x) => x[0] === 'PASS').length, 'FAIL', R.filter((x) => x[0] === 'FAIL').length, 'errors', errors);
await browser.close();
