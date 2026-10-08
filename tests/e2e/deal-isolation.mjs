import { phone, BASE } from './lib.mjs';
const F = new URL('./files/', import.meta.url).pathname;
const { browser, page, errors } = await phone();
const clickText = (t) => page.evaluate((t) => [...document.querySelectorAll('#deal-root button')].find((b) => b.textContent.includes(t)).click(), t);
await page.goto(BASE + '#deal', { waitUntil: 'load' });
await page.setInputFiles('#om-file', F + 'om-retail.pdf');
await page.waitForSelector('#deal-tiles .tile');
await page.waitForTimeout(1000);  // let the first save land
await page.fill('#fig-noi', '410,000'); await page.press('#fig-noi', 'Tab');
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('#fig-noi');
console.log('NOI after immediate reload (expected $410,000):', await page.inputValue('#fig-noi'));
// photos then switch deal mid-processing
await page.setInputFiles('#photo-file', [F + 'photo0.jpg', F + 'photo2.jpg', F + 'photo0.jpg', F + 'photo2.jpg', F + 'photo0.jpg', F + 'photo2.jpg']);
await clickText('All deals');
await page.waitForTimeout(150);
await clickText('Enter figures by hand');
await page.waitForTimeout(4000);
await page.fill('#fig-address', '99 Second Property Rd'); await page.press('#fig-address', 'Tab');
await page.waitForTimeout(1200);
const counts = await page.evaluate(async () => {
  const db = await new Promise((r) => { const q = indexedDB.open('comp-loader'); q.onsuccess = () => r(q.result); });
  const all = await new Promise((r) => { const q = db.transaction('deals').objectStore('deals').getAll(); q.onsuccess = () => r(q.result); });
  return all.map((d) => [d.name, d.figures.noi, d.visit.photos.length]);
});
console.log('photos visible on 2nd deal (expected 0):', await page.locator('#deal-photos .photo').count());
console.log('IndexedDB deals [name, noi, photos]:', JSON.stringify(counts));
console.log('errors', errors);
await browser.close();
