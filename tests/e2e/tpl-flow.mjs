import { phone, BASE, SHOTS } from './lib.mjs';
const F = new URL('./files/', import.meta.url).pathname;
const { browser, page, errors } = await phone();
await page.goto(BASE + '#comps', { waitUntil: 'load' });
await page.setInputFiles('#file', F + 'costar-comps.pdf');
await page.waitForFunction(() => document.querySelectorAll('#sales-table tbody tr').length > 0);
await page.evaluate(() => document.getElementById('out-template').click());
await page.setInputFiles('#tpl-file', F + (process.argv[2] || 'acme-template.xlsx'));
await page.waitForTimeout(1200);
console.log('toast', await page.locator('.toast').allTextContents());
const open = await page.evaluate(() => document.getElementById('sheet').open);
console.log('mapping sheet open', open);
if (open) {
  console.log(await page.$$eval('#sheet-body section', (s) => s.map((x) => x.innerText.replace(/\n+/g, ' | '))));
  const maps = await page.$$eval('#sheet-body .map-row', (rs) => rs.map((r) => `${r.querySelector('.h').firstChild.textContent} -> ${r.querySelector('select').selectedOptions[0].textContent}`));
  console.log(maps);
  await page.screenshot({ path: `${SHOTS}tpl-map.png` });
  await page.click('#sheet-foot .btn-primary');
}
await page.waitForTimeout(300);
console.log('desc', await page.textContent('#tpl-desc'));
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#download')]);
await dl.saveAs(F + 'out-template.xlsx');
console.log('downloaded', dl.suggestedFilename());
// persists across reload?
await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1500);
console.log('after reload desc', await page.textContent('#tpl-desc'), 'output', await page.getAttribute('#out-template', 'aria-pressed'));
console.log('errors', errors);
await browser.close();
