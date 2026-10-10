/* Backup and restore: everything on the device into one file, a wiped
 * browser brought back from it, a merge that keeps newer work, and a replace. */
import fs from 'fs';
import { phone, BASE, SHOTS } from './lib.mjs';
const F = new URL('./files/', import.meta.url).pathname;
const { browser, page, errors } = await phone();
const R = []; const check = (n, c, d = '') => R.push([c ? 'PASS' : 'FAIL', n, d]);
const go = async (v) => { await page.evaluate((x) => { location.hash = x; }, `#${v}`); await page.waitForTimeout(400); };
const kvGet = (k) => page.evaluate((key) => new Promise((res) => { const r = indexedDB.open('comp-loader'); r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get(key); g.onsuccess = () => res(g.result ?? null); }; }), k);
const dealCount = () => page.evaluate(() => new Promise((res) => { const r = indexedDB.open('comp-loader'); r.onsuccess = () => { const g = r.result.transaction('deals').objectStore('deals').getAll(); g.onsuccess = () => res(g.result.map((d) => ({ name: d.name, photos: (d.visit.photos || []).length, photoBytes: (d.visit.photos || [])[0]?.blob?.size || 0, stage: d.stage }))); }; }));

await page.goto(BASE + '#deal', { waitUntil: 'load' });
await page.setInputFiles('#om-file', F + 'om-retail.pdf');
await page.waitForSelector('#deal-crm #deal-stage');
await page.selectOption('#deal-stage', 'offer');
await page.click('#tab-visit');
await page.setInputFiles('#photo-file', F + 'photo0.jpg');
await page.waitForSelector('.photo img');
await page.click('#tab-overview');
await page.fill('#deal-task-title', 'Order the appraisal');
await page.press('#deal-task-title', 'Enter');
await page.waitForTimeout(400);
// an AI token on the device, which must not go into the backup
await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('comp-loader'); r.onsuccess = () => { const t = r.result.transaction('kv', 'readwrite'); t.objectStore('kv').put({ url: 'https://ai.example', token: 'DEVICE-SECRET-TOKEN', enabled: true }, 'ai.settings'); t.oncomplete = res; }; }));
await go('home');
await page.waitForSelector('#home-attention');
check('Home nudges for a first backup, pointing to Settings', /No backup yet/.test(await page.textContent('#home-attention')));
await page.locator('#home-attention button', { hasText: 'No backup yet' }).click();
await page.waitForSelector('#settings-data #backup-make');
check('the nudge opens Settings, where the backup lives', await page.isVisible('#view-settings'));
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#backup-make')]);
const file = `${SHOTS}backup.json`;
await dl.saveAs(file);
const text = fs.readFileSync(file, 'utf8');
const j = JSON.parse(text);
check('the backup holds the deal, its photo, the task', j.format === 'comp-loader-backup' && j.deals.length === 1 && j.deals[0].visit.photos[0].blob.$blob.length > 1000 && j.kv['crm.tasks'].length === 1, JSON.stringify(j.counts));
check('the AI token is not in the backup', !text.includes('DEVICE-SECRET-TOKEN') && j.kv['ai.settings'].url === 'https://ai.example');
await page.waitForTimeout(300);
await page.waitForFunction(() => /Last backup:/.test(document.querySelector('#settings-data').textContent));
await go('home');
check('the last backup date is shown and the nudge is gone', !/No backup yet/.test(await page.textContent('#home-attention')));
const before = await dealCount();

// wipe the browser's storage entirely, as a lost or reset phone would
await page.evaluate(() => new Promise((res) => { localStorage.clear(); const r = indexedDB.deleteDatabase('comp-loader'); r.onsuccess = res; r.onerror = res; r.onblocked = res; }));
await page.goto(BASE + '#settings', { waitUntil: 'load' });
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('#settings-data #backup-file', { state: 'attached' });
check('after the wipe, nothing is left', /0 deals/.test(await page.textContent('#settings-data')));
await page.setInputFiles('#backup-file', file);
await page.waitForSelector('dialog.action-sheet');
check('the restore offers merge, with what it will do', /Deals: 1 added/.test(await page.textContent('dialog.action-sheet')));
await Promise.all([page.waitForEvent('load', { timeout: 30000 }), page.locator('dialog.action-sheet .action-item', { hasText: 'Merge into this device' }).click()]);
await go('home');
await page.waitForSelector('#home-pipeline .pipe');
const after = await dealCount();
check('the deal is back, in its stage, with its photo byte for byte', JSON.stringify(after) === JSON.stringify(before), `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
check('the task is back', /Order the appraisal/.test(await page.textContent('#home-tasks')));
check('the AI token was not restored (it was never in the file)', (await kvGet('ai.settings')).token === undefined);
await go('deal');
await page.waitForSelector('#deal-root');
const opened = await page.locator('#deal-root .list .li').count();
if (opened) { await page.locator('#deal-root .list .li').first().click(); }
await page.waitForSelector('#deal-tiles .tile');
check('the restored deal opens with its figures', /\$6\.45M/.test(await page.textContent('#deal-tiles')));
await page.click('#tab-visit');
await page.waitForSelector('.photo img');
check('the restored photo displays', await page.evaluate(() => { const i = document.querySelector('.photo img'); return i.complete && i.naturalWidth > 0; }));

// merge keeps newer work: change the stage here, then restore the older backup
await page.click('#tab-overview');
await page.selectOption('#deal-stage', 'contract');
await page.waitForTimeout(800);
await go('settings');
await page.waitForSelector('#settings-data #backup-file', { state: 'attached' });
await page.setInputFiles('#backup-file', file);
await page.waitForSelector('dialog.action-sheet');
check('merging the older backup changes nothing', /0 added, 0 updated/.test(await page.textContent('dialog.action-sheet')), (await page.textContent('dialog.action-sheet')).slice(0, 200));
await page.locator('dialog.action-sheet .action-cancel').click();
await page.waitForTimeout(300);

// replace: a deal not in the backup goes; the older stage comes back
await go('deal');
await page.locator('#deal-root button[aria-label="More deal actions"] >> visible=true').click();
await page.locator('dialog.action-sheet .action-item', { hasText: 'All deals' }).click();
await page.waitForTimeout(300);
await page.evaluate(() => [...document.querySelectorAll('#deal-root button')].find((b) => b.textContent.includes('Enter figures by hand')).click());
await page.waitForTimeout(500);
check('two deals before replacing', (await dealCount()).length === 2);
await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('comp-loader'); r.onsuccess = () => { const t = r.result.transaction('kv', 'readwrite'); t.objectStore('kv').put({ url: 'https://ai.example', token: 'NEW-DEVICE-TOKEN', enabled: true }, 'ai.settings'); t.oncomplete = res; }; }));
await go('settings');
await page.waitForSelector('#settings-data #backup-file', { state: 'attached' });
await page.setInputFiles('#backup-file', file);
await page.locator('dialog.action-sheet .action-item', { hasText: 'Replace everything' }).click();
await page.waitForTimeout(400);
check('replacing asks a second time', /cannot be undone/.test(await page.textContent('dialog.action-sheet')));
await Promise.all([page.waitForEvent('load', { timeout: 30000 }), page.locator('dialog.action-sheet .action-item', { hasText: 'Yes, replace everything' }).click()]);
await page.waitForTimeout(800);
const rep = await dealCount();
check('after replace: only the backup’s deal, in the backup’s stage', rep.length === 1 && rep[0].stage === 'offer', JSON.stringify(rep));
check('the token on this device survived the replace', (await kvGet('ai.settings')).token === 'NEW-DEVICE-TOKEN');
for (const [s, n, d] of R) console.log(s, '|', n, d ? `| ${d}` : '');
console.log('PASS', R.filter((x) => x[0] === 'PASS').length, 'FAIL', R.filter((x) => x[0] === 'FAIL').length, 'errors', errors);
await browser.close();
