import { phone, BASE, SHOTS } from './lib.mjs';
const F = new URL('./files/', import.meta.url).pathname;
const { browser, page, errors } = await phone();
await page.goto(BASE + '#comps', { waitUntil: 'load' });
await page.setInputFiles('#file', F + 'costar-comps.pdf');
await page.waitForFunction(() => document.querySelectorAll('#sales-table tbody tr').length > 0);
await page.click('.tab[data-view="deal"] >> visible=true');
await page.setInputFiles('#om-file', F + (process.argv[2] || 'om-retail.pdf'));
await page.waitForSelector('#deal-tiles .tile');
await page.waitForTimeout(800);
console.log('vs comps', await page.$$eval('#deal-comps .tile', (t) => t.map((x) => x.innerText.replace(/\n/g, ' | '))));
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#deal-root .view-head .btn-primary')]);
await dl.saveAs(F + 'out-deal.xlsx'); console.log('deal xlsx', dl.suggestedFilename());
// summary text via copy
await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
// brief
await page.evaluate(() => { window.print = () => { window.__printed = true; }; });
await page.evaluate(() => [...document.querySelectorAll('#deal-root button')].find((b) => b.textContent.includes('One-page brief')).click());
await page.waitForTimeout(800);
console.log('printed', await page.evaluate(() => window.__printed));
console.log('BRIEF:\n' + (await page.locator('#print-sheet').innerText()).slice(0, 3000));
await page.emulateMedia({ media: 'print' });
await page.pdf({ path: F + 'out-brief.pdf', format: 'Letter' }).catch((e) => console.log('pdf', e.message));
// the comp workbook carrying the deal tab
await page.emulateMedia({ media: 'screen' });
await page.click('.tab[data-view="comps"] >> visible=true');
const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#download')]);
await dl2.saveAs(F + 'out-comps-deal.xlsx');
console.log('errors', errors);
await browser.close();
