/* Accessibility: axe-core (WCAG 2.0/2.1/2.2 A and AA rules) on every screen
 * and the main sheets, in light and dark, plus checks axe cannot make:
 * keyboard focus is visible, targets are at least 24 px (WCAG 2.2 2.5.8),
 * and the page reflows at 320 px. Automated checks find only part of what a
 * screen-reader user meets; they are a floor, not an audit. */
import { createRequire } from 'module';
import { phone, BASE } from './lib.mjs';
const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const F = new URL('./files/', import.meta.url).pathname;
const { browser, page, errors } = await phone();
const R = []; const check = (n, c, d = '') => R.push([c ? 'PASS' : 'FAIL', n, d]);
const go = async (v) => { await page.evaluate((x) => { location.hash = x; }, `#${v}`); await page.waitForTimeout(400); };
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const found = new Map();
async function audit(name, scope = null) {
  // let a sheet finish sliding in: half-transparent text mid-animation is not what people read
  await page.waitForTimeout(450);
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ path: AXE });
  const res = await page.evaluate(async ({ tags, scope: sc }) => {
    // meta-viewport: iOS alone gets maximum-scale=1 (it stops Safari zooming on a focused field and
    // leaving it zoomed; iOS still lets people pinch-zoom). Checked apart below for other browsers.
    const r = await window.axe.run(sc ? document.querySelector(sc) : document, { runOnly: { type: 'tag', values: tags }, rules: { 'meta-viewport': { enabled: false } }, resultTypes: ['violations'] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 4).map((n) => n.target.join(' ')) }));
  }, { tags: TAGS, scope });
  for (const v of res) { const k = `${v.id}`; if (!found.has(k)) found.set(k, { ...v, where: new Set() }); found.get(k).where.add(name); }
  check(`axe: ${name}`, res.length === 0, res.map((v) => `${v.id} (${v.impact}): ${v.help} -> ${v.nodes.join(' | ')}`).join('\n    '));
}
async function smallTargets(name) {
  const small = await page.evaluate(() => {
    const out = [];
    for (const e of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], summary')) {
      const r = e.getBoundingClientRect();
      const st = getComputedStyle(e);
      if (!r.width || !r.height || st.visibility === 'hidden' || e.closest('[hidden]')) continue;
      // inline links in a sentence are exempt (2.5.8); so are inputs inside a larger label
      if (e.tagName === 'A' && st.display === 'inline') continue;
      // a visually hidden file input is worked through its visible label or button
      if (e.type === 'file' && r.width <= 1 && r.height <= 1) continue;
      if ((e.type === 'checkbox' || e.type === 'radio') && e.closest('label') && e.closest('label').getBoundingClientRect().height >= 24) continue;
      if (r.width < 24 || r.height < 24) out.push(`${e.tagName.toLowerCase()}.${[...e.classList].join('.')}[${(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 24)}] ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  });
  check(`targets ≥ 24 px: ${name}`, small.length === 0, small.slice(0, 8).join(', '));
}

await page.goto(BASE + '#comps', { waitUntil: 'load' });
await page.setInputFiles('#file', F + 'costar-comps.pdf');
await page.waitForFunction(() => document.querySelectorAll('#sales-table tbody tr').length > 0, null, { timeout: 20000 });
await page.waitForTimeout(500);
await audit('Comps with a comp set');
await smallTargets('Comps');
await go('deal');
await page.setInputFiles('#om-file', F + 'om-retail.pdf');
await page.waitForSelector('#deal-crm #deal-stage');
await page.fill('#deal-task-title', 'Call the listing broker');
await page.press('#deal-task-title', 'Enter');
await page.waitForTimeout(400);
await audit('Deal overview');
await smallTargets('Deal overview');
for (const p of ['rentroll', 'whatif', 'visit']) { await page.click(`#tab-${p}`); await page.waitForTimeout(400); await audit(`Deal ${p}`); }
await page.click('#tab-rentroll');
await page.locator('#deal-rentroll button[aria-label^="Lease schedule"]').first().click();
await page.waitForSelector('#sheet-body .timeline');
await audit('Lease schedule sheet', '#sheet');
await page.click('#sheet-close');
await page.click('#tab-overview');
await go('tools');
await audit('Tools');
await page.click('#tools-root button.tool[data-tool="dcf"]');
await page.waitForSelector('#sheet-body .results li');
await page.fill('#tool-dcf-noi', '1,000,000'); await page.fill('#tool-dcf-discount', '8'); await page.fill('#tool-dcf-exitCap', '7');
await page.waitForTimeout(200);
await audit('A tool sheet (DCF)', '#sheet');
await page.click('#sheet-close');
await go('home');
await page.waitForSelector('#home-pipeline');
await audit('Home');
await smallTargets('Home');
await page.click('#contact-add');
await page.waitForSelector('#contact-name');
await audit('Contact sheet', '#sheet');
await page.click('#sheet-close');
await go('deal');
await page.click('#deal-root button[aria-label="More deal actions"] >> visible=true');
await page.waitForSelector('dialog.action-sheet');
await audit('Deal action sheet', 'dialog.action-sheet');
await page.locator('dialog.action-sheet .action-item', { hasText: 'AI settings' }).click();
await page.waitForSelector('#ai-url');
await audit('AI settings sheet', '#sheet');
await page.click('#sheet-close');
await go('settings');
await page.waitForSelector('#settings-data #backup-make');
await audit('Settings');
await smallTargets('Settings');
await page.keyboard.press('Control+k');
await page.waitForSelector('dialog.cmdk[open] .cmdk-item');
await audit('Command menu', 'dialog.cmdk');
await page.keyboard.press('Escape');

// dark mode
await page.emulateMedia({ colorScheme: 'dark' });
await page.waitForTimeout(300);
await audit('Deal overview, dark');
await go('home');
await audit('Home, dark');
await go('tools');
await audit('Tools, dark');
await go('settings');
await page.waitForSelector('#settings-data #backup-make');
await audit('Settings, dark');
await go('comps');
await audit('Comps, dark');
await go('deal');
for (const p of ['rentroll', 'whatif']) { await page.click(`#tab-${p}`); await audit(`Deal ${p}, dark`); }
await page.click('#tab-overview');
await page.keyboard.press('Control+k');
await page.waitForSelector('dialog.cmdk[open] .cmdk-item');
await audit('Command menu, dark', 'dialog.cmdk');
await page.keyboard.press('Escape');
await page.emulateMedia({ colorScheme: 'light' });

// keyboard: every control Tab reaches on Home shows a focus ring
await go('home');
await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); });
const noRing = [];
let reached = 0;
for (let i = 0; i < 40; i++) {
  await page.keyboard.press('Tab');
  const r = await page.evaluate(() => {
    const e = document.activeElement;
    if (!e || e === document.body) return null;
    const s = getComputedStyle(e);
    const ring = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== 'none');
    return { ring, what: `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}[${(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 20)}]` };
  });
  if (!r) continue;
  reached += 1;
  if (!r.ring) noRing.push(r.what);
}
check('keyboard: Tab reaches Home’s controls and each shows a focus ring', reached > 10 && noRing.length === 0, `${reached} reached; no ring: ${noRing.slice(0, 6).join(', ')}`);

// reflow at 320 px (WCAG 1.4.10) on each view
await page.setViewportSize({ width: 320, height: 640 });
for (const v of ['home', 'comps', 'deal', 'tools', 'settings']) {
  await go(v);
  check(`reflows at 320 px: ${v}`, await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), String(await page.evaluate(() => document.documentElement.scrollWidth)));
}
// browsers other than iOS Safari get no zoom limit at all (WCAG 1.4.4)
const other = await browser.newContext({ viewport: { width: 412, height: 900 }, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36' });
const op = await other.newPage();
await op.goto(BASE, { waitUntil: 'load' });
const vp = await op.getAttribute('meta[name=viewport]', 'content');
check('Android and desktop: the page can be zoomed (no maximum-scale)', !/maximum-scale|user-scalable=no/.test(vp), vp);
await other.close();
for (const [s, n, d] of R) console.log(s, '|', n, d ? `\n    ${d}` : '');
console.log('\nRules violated:', [...found.values()].map((v) => `${v.id} (${v.impact}) on ${[...v.where].join(', ')}`).join('\n  ') || 'none');
console.log('PASS', R.filter((x) => x[0] === 'PASS').length, 'FAIL', R.filter((x) => x[0] === 'FAIL').length, 'errors', errors);
await browser.close();
