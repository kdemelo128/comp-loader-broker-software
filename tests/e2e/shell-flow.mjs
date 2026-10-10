/* The shell: every navigation item goes where it says, the theme control
 * persists across a reload (before first paint), the command menu finds real
 * deals, contacts and tools from the keyboard and runs real actions, and the
 * Settings screen's controls work. */
import { phone, BASE, SHOTS } from './lib.mjs';
const F = new URL('./files/', import.meta.url).pathname;
const R = []; const check = (n, c, d = '') => R.push([c ? 'PASS' : 'FAIL', n, d]);

// ------------------------------------------------------------- desktop
const { browser, page, errors } = await phone({ viewport: { width: 1360, height: 900 }, isMobile: false, hasTouch: false, userAgent: undefined, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'load' });
check('the app opens on Home', await page.isVisible('#view-home') && (await page.title()) === 'Home · Comp Loader', await page.title());
for (const [v, title] of [['deal', 'Deals'], ['comps', 'Comps'], ['tools', 'Tools'], ['settings', 'Settings'], ['home', 'Home']]) {
  await page.click(`.sidebar .tab[data-view="${v}"]`);
  await page.waitForTimeout(150);
  check(`sidebar: ${title} opens its screen and is marked current`, await page.isVisible(`#view-${v}`) && (await page.getAttribute(`.sidebar .tab[data-view="${v}"]`, 'aria-current')) === 'page' && (await page.title()).startsWith(title));
}

// theme: dark chosen, kept across a reload, applied before scripts run
await page.click('.sidebar [data-theme-set="dark"]');
check('choosing Dark applies it', (await page.getAttribute('html', 'data-theme')) === 'dark' && (await page.getAttribute('.sidebar [data-theme-set="dark"]', 'aria-checked')) === 'true');
const bgDark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
await page.reload({ waitUntil: 'domcontentloaded' });
check('dark is still set after a reload, from the first paint', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark' && (await page.evaluate(() => getComputedStyle(document.body).backgroundColor)) === bgDark, bgDark);
await page.waitForLoadState('load');
await page.click('.sidebar [data-theme-set="light"]');
check('Light overrides a dark system preference', (await page.getAttribute('html', 'data-theme')) === 'light');
await page.click('.sidebar [data-theme-set="system"]');
check('System removes the override', (await page.getAttribute('html', 'data-theme')) === null && (await page.evaluate(() => localStorage.getItem('comp-loader.theme'))) === null);
await page.focus('.sidebar [data-theme-set="system"]');
await page.keyboard.press('ArrowRight');
check('arrow keys move the appearance choice', (await page.getAttribute('html', 'data-theme')) === 'light');
await page.click('.sidebar [data-theme-set="system"]');

// a deal and a contact to find
await page.click('.sidebar .tab[data-view="deal"]');
await page.setInputFiles('#om-file', F + 'om-retail.pdf');
await page.waitForSelector('#deal-tiles .tile');
check('the deal is the page’s heading', /4410 Example Avenue NW/.test(await page.textContent('#deal-root h1')));
check('the header shows the stage', (await page.textContent('#deal-stage-pill')) === 'Underwriting');
const stuck = () => page.evaluate(() => document.querySelector('#deal-root .seg[role=tablist]').classList.contains('stuck'));
check('the section tabs do not carry the deal name while the header is in view', !(await stuck()));
await page.evaluate(() => window.scrollTo(0, 1200));
await page.waitForTimeout(300);
const stuckDown = await stuck();
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(300);
check('they do once it scrolls away, and stop on the way back', stuckDown && !(await stuck()));
await page.selectOption('#deal-stage', 'offer');
check('changing the stage updates the header', (await page.textContent('#deal-stage-pill')) === 'Offer / LOI');
// a field chosen straight away keeps the focus: the sheet's own first-field focus must not take it back
const kept = await page.evaluate(async () => {
  [...document.querySelectorAll('#deal-crm button')].find((b) => b.textContent.includes('+ New contact')).click();
  let ph = null;
  for (let i = 0; i < 100 && !(ph = document.getElementById('contact-phone')); i++) await new Promise((r) => setTimeout(r, 0));
  ph.focus();
  await new Promise((r) => setTimeout(r, 200));
  return document.activeElement.id;
});
check('a field chosen as the contact sheet opens keeps the focus', kept === 'contact-phone', kept);
await page.fill('#contact-name', 'Morgan Ellery');
await page.fill('#contact-company', 'First Capital Bank');
await page.selectOption('#contact-role', 'Lender');
await page.click('#contact-save');
await page.waitForTimeout(300);
await page.click('.sidebar .tab[data-view="home"]');
await page.waitForSelector('#home-continue .cont-row');
check('Home: continue working lists the deal with its figures and stage', /4410 Example Avenue NW/.test(await page.textContent('#home-continue')) && /\$6\.45M/.test(await page.textContent('#home-continue')) && /Offer \/ LOI/.test(await page.textContent('#home-continue')));

// the command menu
await page.keyboard.press('Control+k');
await page.waitForSelector('dialog.cmdk[open] #cmdk-input');
check('Ctrl+K opens the command menu with focus in the search', await page.evaluate(() => document.activeElement.id === 'cmdk-input'));
await page.keyboard.type('4410');
await page.waitForTimeout(100);
check('it finds the deal by address', /4410 Example Avenue NW/.test(await page.textContent('#cmdk-list .cmdk-item[aria-selected="true"]')));
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
check('Enter opens the deal', await page.isVisible('#view-deal') && /4410/.test(await page.textContent('#deal-root h1')) && !(await page.$('dialog.cmdk')));
await page.click('.sidebar .tab[data-view="home"]');
await page.keyboard.press('Control+k');
await page.keyboard.type('lender');
await page.waitForTimeout(100);
check('it finds a contact by role', /Morgan Ellery/.test(await page.textContent('#cmdk-list')));
await page.keyboard.press('Enter');
await page.waitForSelector('#contact-name');
check('Enter opens the contact', (await page.inputValue('#contact-name')) === 'Morgan Ellery');
await page.click('#sheet-close');
await page.waitForTimeout(200);
await page.keyboard.press('/');
await page.waitForSelector('dialog.cmdk[open]');
await page.keyboard.type('amortiz');
await page.waitForTimeout(100);
await page.keyboard.press('Enter');
await page.waitForSelector('#tool-amort-loan');
check('"/" then a tool name opens that tool', await page.isVisible('#view-tools'));
await page.click('#sheet-close');
await page.keyboard.press('Control+k');
await page.keyboard.type('zzqx no such thing');
await page.waitForTimeout(100);
check('no match says so', /Nothing matches/.test(await page.textContent('#cmdk-list')));
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
check('Escape closes it', !(await page.$('dialog.cmdk')));
await page.keyboard.press('Control+k');
await page.keyboard.type('theme dark');
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
check('a theme action from the menu works', (await page.getAttribute('html', 'data-theme')) === 'dark');
await page.keyboard.press('Control+k');
await page.keyboard.type('settings');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowUp');
await page.keyboard.press('Enter');
await page.waitForTimeout(250);
check('arrow keys and Enter go to Settings', await page.isVisible('#view-settings'));

// settings
const ids = await page.$$eval('#settings-root section.card', (x) => x.map((e) => e.id));
check('Settings shows appearance, templates, pipeline, AI, data and about', JSON.stringify(ids) === JSON.stringify(['settings-look', 'settings-templates', 'settings-pipeline', 'settings-ai', 'settings-data', 'settings-about']), ids.join(','));
check('the Settings theme control reflects the choice', (await page.getAttribute('#settings-look [data-theme-set="dark"]', 'aria-checked')) === 'true');
await page.click('#settings-look [data-theme-set="system"]');
check('and changes it', (await page.getAttribute('html', 'data-theme')) === null && (await page.getAttribute('.sidebar [data-theme-set="system"]', 'aria-checked')) === 'true');
await page.locator('#settings-pipeline button', { hasText: 'Edit stages' }).click();
check('Edit stages opens the stage editor', await page.waitForSelector('#stage-listing', { timeout: 3000 }).then(() => true, () => false));
await page.click('#sheet-close');
await page.locator('#settings-templates button', { hasText: 'Open library' }).click();
await page.waitForTimeout(400);
check('Open library opens the template library', /Template/i.test(await page.textContent('#sheet-title')), await page.textContent('#sheet-title'));
await page.click('#sheet-close');
await page.locator('#settings-ai button', { hasText: 'AI settings' }).click();
check('AI settings opens the AI sheet', await page.waitForSelector('#ai-url', { timeout: 3000 }).then(() => true, () => false));
await page.click('#sheet-close');
check('no horizontal overflow on Settings', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
await page.screenshot({ path: `${SHOTS}settings.png`, fullPage: true });
await browser.close();

// ---------------------------------------------------------------- phone
const P = await phone();
await P.page.goto(BASE, { waitUntil: 'load' });
for (const v of ['deal', 'comps', 'tools', 'settings', 'home']) {
  await P.page.click(`.tabbar .tab[data-view="${v}"]`);
  await P.page.waitForTimeout(150);
  check(`phone tab bar: ${v}`, await P.page.isVisible(`#view-${v}`) && (await P.page.getAttribute(`.tabbar .tab[data-view="${v}"]`, 'aria-current')) === 'page');
}
await P.page.click('.appbar [data-cmd]');
check('phone: the search button opens the command menu', await P.page.waitForSelector('dialog.cmdk[open]', { timeout: 3000 }).then(() => true, () => false));
await P.page.keyboard.press('Escape');
check('phone: no horizontal overflow on Home', await P.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
await P.browser.close();

for (const [s, n, d] of R) console.log(s, '|', n, d ? `| ${d}` : '');
console.log('PASS', R.filter((x) => x[0] === 'PASS').length, 'FAIL', R.filter((x) => x[0] === 'FAIL').length, 'errors', [...errors, ...P.errors]);
