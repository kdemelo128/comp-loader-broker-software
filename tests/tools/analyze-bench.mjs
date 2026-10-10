/* tests/tools/analyze-bench.mjs -- not a test: how long analyze() takes on the
 * 500-lease deal (the perf-flow rent roll), for app/ directories side by side.
 * Runs alternate between them in rounds, so a busy machine slows both alike.
 *   node tests/tools/analyze-bench.mjs <app-dir> [<app-dir> ...] */
import fs from 'node:fs';

const dirs = process.argv.slice(2);
const mods = [];
for (const d of dirs) {
  const base = new URL(`file://${fs.realpathSync(d)}/`);
  mods.push({ d, D: await import(new URL('deal.js', base).href), L: await import(new URL('lease.js', base).href), R: await import(new URL('rentroll.js', base).href) });
}
const rows = [];
for (let i = 0; i < 500; i++) rows.push({ suite: String(1000 + i), tenant: `Tenant ${i}`, sf: 1000 + (i % 7) * 250, start: `2022-0${1 + (i % 9)}-01`, end: `20${28 + (i % 8)}-12-31`, annual: 30000 + i * 37 });
const fig = { price: 120000000, noi: 8000000, cap: 6.5, bsf: 800000, units: 500, lot_sf: 900000, gross: 12000000, opex: 4000000, occ: 95, gpr: 12500000, year: 1985, taxes: 900000, noi_pf: 9e6, lease_exp: 'January 31, 2036' };
const loan = { ltv: 65, rate: 6.5, amort: 30, io: false, closing: 2, minDscr: 1.25, minDy: 8 };
for (const x of mods) {
  const rr = x.L.fromOmRows(rows, { asOf: '2026-10-01' });
  x.deal = { ...fig, rentRoll: x.R.legacyRows(rr), loan, rentRollAsOf: '2026-10-01' };
  x.comps = x.D.compBasis([{ price: 4e6, bsf: 8000, cap: 6.5 }, { price: 6e6, bsf: 10000, cap: 6.0 }, { price: 3e6, bsf: 6000 }]);
  x.times = [];
  for (let i = 0; i < 300; i++) x.D.analyze(x.deal, x.comps); // warm up
}
const ROUNDS = 40; const N = 100;
for (let r = 0; r < ROUNDS; r++) {
  for (const x of (r % 2 ? [...mods].reverse() : mods)) {
    const a = performance.now();
    for (let i = 0; i < N; i++) x.D.analyze(x.deal, x.comps);
    x.times.push((performance.now() - a) / N);
  }
}
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
for (const x of mods) console.log(`${x.d}: median ${med(x.times).toFixed(3)} ms per analyze() over ${ROUNDS} rounds of ${N} (min ${Math.min(...x.times).toFixed(3)}, max ${Math.max(...x.times).toFixed(3)})`);
if (mods.length === 2) console.log(`second vs first: ${((med(mods[1].times) / med(mods[0].times) - 1) * 100).toFixed(1)}%`);
