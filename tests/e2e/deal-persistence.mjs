import { phone, BASE, SHOTS } from './lib.mjs';
const F = new URL('./files/', import.meta.url).pathname;
const { browser, page, errors } = await phone();
const fin = () => page.$$eval('#deal-fin-out li', (t) => t.map((x) => x.innerText.replace(/\n/g, ' ')));
await page.goto(BASE + '#deal', { waitUntil: 'load' });
await page.setInputFiles('#om-file', F + 'om-retail.pdf');
await page.waitForSelector('#deal-tiles .tile');
// BUG 1: closing costs typed as 0.5 (half a percent)
await page.fill('#loan-closing', '0.5'); await page.press('#loan-closing', 'Tab');
await page.waitForTimeout(300);
console.log('closing field now:', await page.inputValue('#loan-closing'));
console.log('equity line:', (await fin()).find((l) => l.startsWith('Equity')));
await page.fill('#loan-closing', '2'); await page.press('#loan-closing', 'Tab');
// BUG 2: edit then leave within the save debounce
await page.fill('#fig-noi', '400,000'); await page.press('#fig-noi', 'Tab');
await page.evaluate(() => [...document.querySelectorAll('#deal-root button')].find((b) => b.textContent.includes('All deals')).click());
await page.waitForTimeout(1000);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(800);
const list = await page.$$eval('#deal-root .list .li', (x) => x.map((b) => b.innerText.replace(/\n/g, ' | ')));
console.log('saved deals:', list);
await page.locator('#deal-root .list .li').first().click();
await page.waitForSelector('#fig-noi');
console.log('NOI after quick leave + reload (expected $400,000):', await page.inputValue('#fig-noi'));
// BUG 3: edit then reload immediately (app closed within debounce)
await page.fill('#fig-noi', '410,000'); await page.press('#fig-noi', 'Tab');
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('#fig-noi');
console.log('NOI after immediate reload (expected $410,000):', await page.inputValue('#fig-noi'));
// BUG 4: photos added, then switch deal while they are processing
await page.setInputFiles('#photo-file', [F + 'photo0.jpg', F + 'photo2.jpg', F + 'photo0.jpg', F + 'photo2.jpg']);
await page.evaluate(() => [...document.querySelectorAll('#deal-root button')].find((b) => b.textContent.includes('All deals')).click());
await page.waitForTimeout(100);
await page.evaluate(() => [...document.querySelectorAll('#deal-root button')].find((b) => b.textContent.includes('Enter figures by hand')).click());
await page.waitForTimeout(3000);
console.log('photos on the NEW blank deal (expected 0):', await page.locator('#deal-photos .photo').count());
await page.fill('#fig-address', '99 Second Property Rd'); await page.press('#fig-address', 'Tab');
await page.waitForTimeout(800);
await page.evaluate(() => [...document.querySelectorAll('#deal-root button')].find((b) => b.textContent.includes('All deals')).click());
await page.waitForTimeout(800);
console.log('saved deals:', await page.$$eval('#deal-root .list .li', (x) => x.map((b) => b.innerText.replace(/\n/g, ' | '))));
const counts = await page.evaluate(async () => {
  const db = await new Promise((r) => { const q = indexedDB.open('comp-loader'); q.onsuccess = () => r(q.result); });
  const all = await new Promise((r) => { const q = db.transaction('deals').objectStore('deals').getAll(); q.onsuccess = () => r(q.result); });
  return all.map((d) => [d.name, d.figures.noi, d.visit.photos.length]);
});
console.log('IndexedDB deals [name, noi, photos]:', counts);
console.log('errors', errors);
await browser.close();
