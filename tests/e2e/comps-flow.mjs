import { phone, BASE, SHOTS } from './lib.mjs';
const F = new URL('./files/', import.meta.url).pathname;
const { browser, page, errors, ctx } = await phone();
await page.goto(BASE + '#comps', { waitUntil: 'load' });
await page.setInputFiles('#file', F + 'costar-comps.pdf');
await page.waitForFunction(() => document.querySelectorAll('#sales-table tbody tr, #market-table tbody tr').length > 0, null, { timeout: 20000 });
await page.waitForTimeout(500);
console.log('toast', await page.locator('.toast').allTextContents());
const rows = async () => page.$$eval('#sales-table tbody tr, #market-table tbody tr', (trs) => trs.map((tr) => [...tr.querySelectorAll('input')].map((i) => i.type === 'checkbox' ? (i.checked ? '[x]' : '[ ]') : i.value).concat(tr.querySelector('.calc')?.textContent).join(' | ')));
console.log((await rows()).join('\n'));
console.log('footers', await page.$$eval('tfoot', (t) => t.map((x) => x.innerText.replace(/\s+/g, ' '))));
console.log('kpis', await page.$eval('#kpis', (x) => x.innerText.replace(/\n/g, ' | ')));
// edit first sale price
const price = page.locator('#sales-table tbody tr').first().locator('input[aria-label="Sale price"]');
await price.fill('5.2m'); await price.press('Enter'); await price.blur();
await page.waitForTimeout(700);
console.log('after edit', (await rows())[0]);
await page.screenshot({ path: `${SHOTS}comps.png`, fullPage: true });
// export
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#download')]);
await dl.saveAs(F + 'out-comps.xlsx');
console.log('downloaded', dl.suggestedFilename());
// reload persistence
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1500);
console.log('after reload', (await rows())[0], await page.locator('.toast').allTextContents());
console.log('scroll', await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]));
console.log('errors', errors);
await browser.close();
