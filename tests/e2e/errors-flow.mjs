import { phone, BASE } from './lib.mjs';
const F = new URL('./files/', import.meta.url).pathname;
const { browser, page, errors } = await phone();
await page.goto(BASE + '#deal', { waitUntil: 'load' });
for (const f of ['corrupt.pdf', 'empty.pdf', 'om-encrypted.pdf', 'om-scanned.pdf', 'notes.txt', 'om-large.pdf']) {
  await page.goto(BASE + '#deal', { waitUntil: 'load' });
  await page.evaluate(() => localStorage.removeItem('comp-loader.deal.current'));
  await page.reload({ waitUntil: 'load' });
  const t0 = Date.now();
  await page.setInputFiles('#om-file', F + f);
  await page.waitForFunction(() => document.querySelector('.toast'), null, { timeout: 60000 }).catch(() => {});
  const ms = Date.now() - t0;
  console.log(f.padEnd(18), `${ms}ms`, JSON.stringify(await page.locator('.toast').allTextContents()), '| tiles:', await page.locator('#deal-tiles .tile').count());
}
// comps side
for (const f of ['corrupt.pdf', 'notes.txt', 'om-retail.pdf']) {
  await page.goto(BASE + '#comps', { waitUntil: 'load' });
  await page.setInputFiles('#file', F + f);
  await page.waitForTimeout(2500);
  console.log('COMPS', f.padEnd(14), JSON.stringify(await page.locator('.toast').allTextContents()), JSON.stringify(await page.locator('#queue li').allInnerTexts()));
}
console.log('errors', errors);
await browser.close();
