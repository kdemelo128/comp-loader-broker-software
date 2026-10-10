/* Performance budgets on a 500-lease rent roll (checkpoint c):
 *   - open the Rent roll tab and see the grid and its totals: under 1 s;
 *   - edit one rent and see the totals update: under 150 ms.
 * "The grid" is the table holding every row (aria-rowcount) with its first
 * rows drawn: from 4.2 a long rent roll draws only the rows near the screen,
 * so jumping to the last unit is timed too.
 * Times are taken inside the page, from the user's action (a capturing
 * listener sees the click or the change before the app does) to the frame
 * after the result is in the DOM, so they include layout and paint. The
 * longest main-thread task in each window is recorded too: that is what makes
 * a page feel stuck. Desktop-sized Chromium, no CPU throttling; RUNS=n repeats.
 *   node perf-flow.mjs            # needs a server on BASE (run.sh starts one)
 *   THROTTLE=4 node perf-flow.mjs # the same with the CPU slowed 4×, a mid-range phone */
import fs from 'fs';
import { phone, BASE } from './lib.mjs';

const F = new URL('./files/', import.meta.url).pathname;
const RUNS = Number(process.env.RUNS || 5);
const THROTTLE = Number(process.env.THROTTLE || 1);
const R = []; const check = (n, c, d = '') => R.push([c ? 'PASS' : 'FAIL', n, d]);

// 500 leases: units 1000–1499, one rent each, terms ending 2028–2035
let csv = 'Suite,Tenant,Square Feet,Lease Start,Lease Expiration,Annual Base Rent\n';
for (let i = 0; i < 500; i++) csv += `${1000 + i},Tenant ${i},${1000 + (i % 7) * 250},2022-0${1 + (i % 9)}-01,20${28 + (i % 8)}-12-31,${30000 + i * 37}\n`;
fs.writeFileSync(`${F}rr500.csv`, csv);

const { browser, page, errors } = await phone({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, userAgent: undefined, deviceScaleFactor: 1 });
const cdp = THROTTLE > 1 ? await page.context().newCDPSession(page) : null;
const throttle = async (on) => { if (cdp) await cdp.send('Emulation.setCPUThrottlingRate', { rate: on ? THROTTLE : 1 }); };

// in the page: a stopwatch started by the user's action, stopped by a condition, read after the next frame
await page.addInitScript(() => {
  const w = window;
  w.__perf = { longest: 0, armed: null, done: null };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (w.__perf.armed !== null) w.__perf.longest = Math.max(w.__perf.longest, e.duration); }).observe({ type: 'longtask', buffered: false }); } catch { /* no long-task timing */ }
  w.__arm = (eventType, test) => {
    w.__perf.armed = null; w.__perf.done = null; w.__perf.longest = 0; w.__perf.marks = {};
    const start = (e) => {
      if (w.__perf.armed !== null || !e.isTrusted) return;
      w.__perf.armed = performance.now();
      const finish = () => { if (w.__perf.done !== null) return; const r = test(); if (r) { mo.disconnect(); requestAnimationFrame(() => setTimeout(() => { w.__perf.done = performance.now() - w.__perf.armed; }, 0)); } };
      const mo = new MutationObserver(finish);
      mo.observe(document.body, { childList: true, subtree: true, characterData: true });
      finish();
    };
    document.addEventListener(eventType, start, { capture: true, once: true });
  };
});

await page.goto(`${BASE}#deal`, { waitUntil: 'load' });
await page.setInputFiles('#om-file', `${F}om-retail.pdf`);
await page.waitForSelector('#deal-tiles .tile');
await page.click('#tab-rentroll');
await page.locator('#deal-rentroll button[aria-label="More rent roll actions"]').click();
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.action-sheet .action-item', { hasText: 'Import from Excel or CSV' }).click()]);
await chooser.setFiles(`${F}rr500.csv`);
await page.waitForSelector('#sheet-body .map-row');
await page.click('#sheet-foot .btn-primary');
// rows in the grid: its aria-rowcount (4.2 on), or the rows drawn (4.1, which drew them all)
const COUNT = () => { const t = document.querySelector('#deal-rentroll .rr-grid'); if (!t) return 0; const n = t.getAttribute('aria-rowcount'); return n ? Number(n) - 2 : t.querySelectorAll('tbody tr[data-id]').length; };
await page.waitForFunction(`(${COUNT})() >= 500`, null, { timeout: 120000 });
const rows = await page.evaluate(`(${COUNT})()`);
check('the rent roll holds the 500 imported leases', rows >= 500, `${rows} rows`);
await page.waitForTimeout(1500); // the save settles

const ROWS = `(${COUNT})() >= 500 && document.querySelectorAll("#deal-rentroll .rr-grid tbody tr[data-id]").length >= 20`;
const TOTAL = '(document.querySelector("#deal-rentroll .rr-grid tfoot td")||{}).textContent';
const PROJ = '[...document.querySelectorAll("#deal-rentroll .rr-out .proj tr.strong td")].some((td) => /\\$/.test(td.textContent))';
const opens = []; const openLong = []; const projs = []; const edits = []; const editLong = []; const editProj = []; const jumps = []; const jumpLong = [];
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const waitDone = () => page.waitForFunction(() => window.__perf.done !== null, null, { timeout: 60000 }).then(() => page.evaluate(() => ({ ms: window.__perf.done, long: window.__perf.longest })));

for (let run = 0; run < RUNS; run++) {
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#deal-tiles .tile', { timeout: 60000 });
  await page.waitForTimeout(400);
  await throttle(true);
  // open: rows and the totals row on screen
  await page.evaluate(`window.__arm('click', () => ${ROWS} && /Total · 50\\d/.test(${TOTAL}))`);
  await page.click('#tab-rentroll');
  const o = await waitDone();
  opens.push(o.ms); openLong.push(o.long);
  // and the projection, wherever it is worked out
  const p0 = await page.evaluate(() => window.__perf.armed);
  await page.waitForFunction(PROJ, null, { timeout: 60000 });
  projs.push(await page.evaluate((a) => performance.now() - a, p0));
  await page.waitForTimeout(300);
  // edit: one rent; the In-place rent tile changes
  const unit = 1000 + run;
  const inp = page.locator(`#deal-rentroll input[aria-label="Annual rent, unit ${unit}"]`);
  const before = await page.locator('#deal-rentroll .tile .v').first().textContent();
  const projBefore = await page.evaluate('[...document.querySelectorAll("#deal-rentroll .rr-out .proj tr.strong td")].map((td) => td.textContent).join("|")');
  await inp.fill(String(500000 + run));
  await page.evaluate((b) => window.__arm('change', () => document.querySelector('#deal-rentroll .tile .v')?.textContent !== b), before);
  await inp.press('Tab');
  const e = await waitDone();
  edits.push(e.ms); editLong.push(e.long);
  const e0 = await page.evaluate(() => window.__perf.armed);
  await page.waitForFunction((pb) => { const now = [...document.querySelectorAll('#deal-rentroll .rr-out .proj tr.strong td')].map((td) => td.textContent).join('|'); return now && now !== pb && /\$/.test(now); }, projBefore, { timeout: 60000 });
  editProj.push(await page.evaluate((a) => performance.now() - a, e0));
  // jump to the last unit (the totals row brought into view) and see its row drawn
  await page.waitForTimeout(300);
  const last = await page.evaluate(`(${COUNT})() + 1`);
  await page.evaluate((idx) => window.__arm('scroll', () => !!document.querySelector(`#deal-rentroll .rr-grid tr[aria-rowindex="${idx}"][data-id]`) || (!document.querySelector('#deal-rentroll .rr-grid[aria-rowcount]') && document.querySelectorAll('#deal-rentroll .rr-grid tbody tr[data-id]').length >= idx - 1)), last);
  await page.evaluate(() => document.querySelector('#deal-rentroll .rr-grid tfoot').scrollIntoView({ block: 'end' }));
  const j = await waitDone();
  jumps.push(j.ms); jumpLong.push(j.long);
  await page.evaluate(() => window.scrollTo(0, 0));
  await throttle(false);
  await page.waitForTimeout(800); // the save settles before the reload
}

const fmt = (a) => `median ${Math.round(median(a))} ms (runs: ${a.map((x) => Math.round(x)).join(', ')})`;
console.log(`CPU throttle ${THROTTLE}×, ${RUNS} runs`);
console.log(`open rent roll (rows and totals painted): ${fmt(opens)}; longest task ${fmt(openLong)}`);
console.log(`open rent roll, projection shown:          ${fmt(projs)}`);
console.log(`edit a rent (totals painted):              ${fmt(edits)}; longest task ${fmt(editLong)}`);
console.log(`edit a rent, projection updated:           ${fmt(editProj)}`);
console.log(`jump to the last unit (its row drawn):     ${fmt(jumps)}; longest task ${fmt(jumpLong)}`);
console.log(`PERFJSON ${JSON.stringify({ throttle: THROTTLE, opens, openLong, projs, edits, editLong, editProj, jumps, jumpLong })}`);
if (THROTTLE === 1) {
  check('open a 500-lease rent roll in under 1 s (median)', median(opens) < 1000, `${Math.round(median(opens))} ms`);
  check('edit a rent and see the totals in under 150 ms (median)', median(edits) < 150, `${Math.round(median(edits))} ms`);
}
await browser.close();
for (const [s, n, x] of R) console.log(s, '|', n, x ? `| ${x}` : '');
console.log('PASS', R.filter((x) => x[0] === 'PASS').length, 'FAIL', R.filter((x) => x[0] === 'FAIL').length, 'errors', errors);
