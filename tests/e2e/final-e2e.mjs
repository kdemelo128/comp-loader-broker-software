import { phone, BASE, SHOTS } from './lib.mjs';
const F = new URL('./files/', import.meta.url).pathname;
const { browser, ctx, page, errors } = await phone();
await ctx.grantPermissions(['microphone']);
const R = []; const check = (n, c, d = '') => { R.push([c ? 'PASS' : 'FAIL', n, d]); };
const sheetAction = (label) => page.locator('.action-sheet .action-item', { hasText: label }).first().click();
const btn = (t) => page.evaluate((t) => [...document.querySelectorAll('#deal-root button')].find((b) => b.textContent.includes(t)).click(), t);
let promptAnswer = 'Offer at $6.1M';
page.on('dialog', (d) => (d.type() === 'prompt' ? d.accept(d.message().includes('Name this scenario') ? promptAnswer : 'roof membrane blistering at NE corner') : d.accept()));
const scn = async (label) => (await page.$$eval('#scn-out table tr', (t) => t.map((r) => [...r.children].map((c) => c.textContent)))).find((r) => r[0].startsWith(label));

// 1. comps
await page.goto(BASE, { waitUntil: 'load' });
await page.setInputFiles('#file', F + 'costar-comps.pdf');
await page.waitForFunction(() => document.querySelectorAll('#sales-table tbody tr').length === 3);
check('1. comp set loaded (3 sales, 3 listings)', (await page.locator('#market-table tbody tr').count()) === 3);
// 2-3. OM, sources
await page.click('.tab[data-view="deal"] >> visible=true');
await page.setInputFiles('#om-file', F + 'om-retail.pdf');
await page.waitForSelector('#deal-tiles .tile');
await page.locator('#fig-price').locator('xpath=..').locator('button.src').click();
await page.waitForTimeout(300);
const snip = await page.textContent('#sheet-body .snippet');
check('3. asking price traced to its OM line and page', /6,450,000/.test(snip) && /Page 2/.test(await page.textContent('#sheet-body h3')), snip);
await page.click('#sheet-close');
// 4. calculations
const tiles = await page.$$eval('#deal-tiles .tile', (t) => t.map((x) => x.innerText.replace(/\n/g, ' | ')));
check('4. cap rate on ask 6.10% (393,450 / 6,450,000)', tiles.some((t) => /Cap rate on ask \| 6\.10%/.test(t)), tiles.join(' || '));
check('4. pro forma NOI read from its column', (await page.inputValue('#fig-noi_pf')) === '$448,200');
// 5. comps comparison
const vs = await page.$$eval('#deal-comps .tile', (t) => t.map((x) => x.innerText.replace(/\n/g, ' | ')));
check('5. asking vs comps -30.4%', vs.some((t) => /-30\.4%/.test(t)), vs.join(' || '));
// 6-7. live deal
await page.click('#tab-whatif');
await page.fill('#scn-price', '6.1m'); await page.press('#scn-price', 'Tab');
await page.fill('#scn-rate', '7'); await page.press('#scn-rate', 'Tab');
await page.waitForTimeout(200);
let r = await scn('Price'); check('6. scenario price $6.1M beside deal $6.45M', r[1] === '$6,450,000' && r[2] === '$6,100,000', r.join(' | '));
r = await scn('Cap rate'); check('6. scenario cap 6.45% (393,450 / 6,100,000)', r[2] === '6.45%', r.join(' | '));
check('6. the deal itself unchanged', (await page.inputValue('#fig-price')) === '$6,450,000' && (await page.inputValue('#loan-rate')) === '6.75');
await page.locator('#deal-live button', { hasText: 'Save scenario' }).click();
await page.waitForTimeout(300);
check('7. scenario saved by name', (await page.locator('#scn-saved .li-title').first().textContent()) === 'Offer at $6.1M');
const irrAns = await page.locator('#scn-answers li', { hasText: 'levered IRR' }).innerText();
check('9. price for a 15% levered IRR answered', /\$\d/.test(irrAns), irrAns.replace(/\n/g, ' '));
// 8. site visit
await page.click('#tab-visit');
await page.locator('#deal-root button', { hasText: 'Start visit' }).click();
await page.waitForTimeout(200);
await page.locator('button[aria-label="Roof: Issue"]').click();
await page.locator('button[aria-label="HVAC: OK"]').click();
await page.fill('#visit-notes', 'Owner says roof was patched in 2023 (reported, not verified).');
await page.setInputFiles('#photo-file', [F + 'photo0.jpg', F + 'photo2.jpg']);
await page.waitForFunction(() => document.querySelectorAll('#deal-photos .photo').length === 2, null, { timeout: 10000 });
await page.click('#rec-btn'); await page.waitForTimeout(1500); await page.click('#rec-btn'); await page.waitForTimeout(800);
check('8. notes, 2 photos and a voice note on the deal', (await page.locator('#deal-audio .voice-row').count()) === 1 && (await page.locator('#deal-photos .photo').count()) === 2);
// 10. brief
await page.evaluate(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
await btn('Deal brief');
await page.waitForTimeout(1000);
const brief = await page.locator('#print-sheet').innerText();
check('10. brief: asking price, scenario, observations, voice', /\$6,450,000/.test(brief) && /Offer at \$6\.1M/.test(brief) && /Working scenario, unsaved/.test(brief)
  && /Observed, roof: needs attention \(roof membrane blistering/.test(brief) && /Note, as written: Owner says roof/.test(brief) && /1 voice note/.test(brief));
check('10. brief carries the 2 photos', (await page.locator('#print-sheet img').count()) === 2);
check('10. brief labels scenarios as assumptions', /Scenarios: assumptions, not the OM’s figures/i.test(brief));
await page.emulateMedia({ media: 'print' });
await page.pdf({ path: F + 'final-brief.pdf', format: 'Letter' });
await page.emulateMedia({ media: 'screen' });
// 11. excel
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#deal-root .view-head .btn-primary')]);
await dl.saveAs(F + 'final-deal.xlsx');
check('11. deal workbook downloaded', true, dl.suggestedFilename());
// 12. subject
await btn('Use as the comps subject');
await page.waitForTimeout(400);
check('12. deal became the comps subject', (await page.inputValue('#s-price')) === '6,450,000' && (await page.inputValue('#s-address')).includes('4410'));
const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
await dl2.saveAs(F + 'final-comps.xlsx');
// 14. reload
await page.waitForTimeout(700);
await page.reload({ waitUntil: 'load' });
await page.click('.tab[data-view="deal"] >> visible=true');
await page.click('#tab-visit');
await page.waitForSelector('#deal-audio .voice-row');
check('14. after reload: notes, photos, voice, scenario, live price', (await page.inputValue('#visit-notes')).includes('patched in 2023')
  && (await page.locator('#deal-photos .photo').count()) === 2 && (await page.locator('#deal-audio .voice-row').count()) === 1
  && (await page.locator('#scn-saved .li-title').count()) === 1 && (await page.inputValue('#scn-price')) === '$6,100,000');
// 15. second property
await page.click('#deal-root .view-head button[aria-label="More deal actions"]');
await sheetAction('Scan another OM');
await page.setInputFiles('#om-file', F + 'om-netlease.pdf');
await page.waitForFunction(() => document.querySelector('#deal-root h2')?.textContent.includes('8820'));
check('15. second property: nothing from the first', (await page.inputValue('#visit-notes')) === '' && (await page.locator('#deal-photos .photo').count()) === 0
  && (await page.locator('#deal-audio .voice-row').count()) === 0 && (await page.locator('#scn-saved .li-title').count()) === 0 && (await page.inputValue('#scn-price')) === '');
check('15. second property: its own figures', (await page.inputValue('#fig-price')) === '$3,280,000' && (await page.inputValue('#fig-tenant')) === 'Northstar Pharmacy, Inc.');
await page.fill('#visit-notes', 'Second property note.');
await page.waitForTimeout(600);
// 16. back to the first
await btn('All deals');
await page.waitForTimeout(400);
await page.locator('#deal-root .list .li', { hasText: '4410' }).click();
await page.waitForSelector('#visit-notes');
check('16. first property intact after visiting the second', (await page.inputValue('#visit-notes')).includes('patched in 2023') && !(await page.inputValue('#visit-notes')).includes('Second property')
  && (await page.locator('#deal-photos .photo').count()) === 2);
const txt = await page.locator('#app').innerText();
check('no NaN / undefined / Infinity anywhere on screen', !/\b(NaN|undefined|Infinity)\b/.test(txt));
for (const [s, n, d] of R) console.log(s, '|', n, d ? `| ${d}` : '');
console.log('PASS', R.filter((x) => x[0] === 'PASS').length, 'FAIL', R.filter((x) => x[0] === 'FAIL').length, 'console errors', errors);
await browser.close();
