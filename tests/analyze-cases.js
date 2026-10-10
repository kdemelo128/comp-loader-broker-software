/* tests/analyze-cases.js -- the deals the analysis is checked on, and an exact
 * record of what analyze() and runScenario() return for each. Used by
 * analyze-golden.test.js against tests/fixtures/analyze-golden.json, which was
 * written by 4.3.1 (before analyze() was split into registered formulas):
 *
 *   node tests/analyze-cases.js > tests/fixtures/analyze-golden.json
 *
 * Not a test file itself. The cases are fixed: the three OM fixtures with and
 * without comps, the edge cases the deal tests use, and 600 random deals from
 * a seeded generator, with inputs missing, zero, negative, as text, or odd. */
import { createHash } from 'node:crypto';
import { readOm } from '../app/om.js';
import { analyze, runScenario, compBasis } from '../app/deal.js';
import { retail, netlease, multifamily } from './om-fixtures.js';

const TODAY = new Date(Date.UTC(2026, 9, 10, 12));

// runScenario() analyses with today's date (a building's age, years left on a
// lease), so the clock is held at TODAY wherever these cases run
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(TODAY.getTime()); }
  static now() { return TODAY.getTime(); }
};
const LOAN = { ltv: 65, rate: 6.75, amort: 30, io: false, closing: 2, minDscr: 1.25, minDy: 8 };
const COMPS = [
  { price: 4e6, bsf: 8000, cap: 6.5 }, { price: 6e6, bsf: 10000, cap: 6.0 }, { price: 3e6, bsf: 6000, cap: 5.5 },
  { price: 2.5e6, bsf: 5200 }, { price: 0, bsf: 4000 },
];

/** A number as text that keeps everything JSON loses: -0, NaN, infinities, and every digit. */
function exact(v) {
  return JSON.stringify(v, (k, x) => {
    if (typeof x === 'number') return Object.is(x, -0) ? '#-0' : Number.isFinite(x) ? x : `#${x}`;
    if (x === undefined) return '#undefined';
    if (x instanceof Date) return `#date ${x.toISOString()}`;
    return x;
  });
}

// a small seeded generator (mulberry32), so the random deals are the same every run
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function fromOm(pages) {
  const om = readOm(pages);
  const f = Object.fromEntries(Object.entries(om.fields).map(([k, v]) => [k === 'lot' ? 'lot_sf' : k, v.value]));
  return { ...f, rentRoll: om.rentRoll ? om.rentRoll.rows : undefined };
}

function randomDeal(r) {
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  // a value of each kind, or missing / zero / negative / text now and then
  const num = (lo, hi, { neg = false, dp = 2 } = {}) => {
    const u = r();
    if (u < 0.18) return undefined;
    if (u < 0.22) return 0;
    if (u < 0.24) return null;
    if (neg && u < 0.28) return -Math.round((lo + r() * (hi - lo)) * 10 ** dp) / 10 ** dp;
    if (u < 0.29) return String(Math.round(lo + r() * (hi - lo)));
    return Math.round((lo + r() * (hi - lo)) * 10 ** dp) / 10 ** dp;
  };
  const d = {
    price: num(5e5, 4e7), noi: num(2e4, 3e6, { neg: true }), cap: num(3, 11), bsf: num(800, 400000, { dp: 0 }),
    units: num(1, 400, { dp: 0 }), lot_sf: num(2000, 900000, { dp: 0 }), gross: num(3e4, 5e6), opex: num(0, 2e6, { neg: true }),
    taxes: num(1000, 6e5), year: pick([undefined, 1890, 1948, 1977, 1986, 2001, 2019, 2024]), occ: num(0, 120, { dp: 1 }),
    gpr: num(3e4, 6e6), noi_pf: num(2e4, 4e6), price_psf: num(50, 1200), price_unit: num(3e4, 9e5),
    lease_type: pick([undefined, '', 'NNN', 'Absolute net', 'Gross', 'Modified gross', 'net']),
    guarantor: pick([undefined, '', 'Corporate', 'Parent company', 'Franchisee LLC', 'Investment grade']),
    lease_exp: pick([undefined, '', 'January 31, 2036', 'March 1st, 2029', 'not stated', '2027-06-30']),
    term_left: pick([undefined, '', '9.3 Years', '2 yrs', '0.5 years', 'soon']),
  };
  for (const k of Object.keys(d)) if (d[k] === undefined) delete d[k];
  if (r() < 0.7) {
    d.loan = { ltv: num(0, 90, { dp: 1 }), rate: num(0, 12, { neg: true }), amort: pick([undefined, 0, 20, 25, 27.4, 30, 35]), io: r() < 0.2, closing: num(0, 5), minDscr: num(1, 1.6), minDy: num(5, 12) };
    for (const k of Object.keys(d.loan)) if (d.loan[k] === undefined) delete d.loan[k];
  }
  if (r() < 0.5) {
    const n = 1 + Math.floor(r() * 9);
    d.rentRoll = [];
    for (let i = 0; i < n; i++) {
      const vacant = r() < 0.15; const mtm = !vacant && r() < 0.12;
      const end = vacant || mtm || r() < 0.1 ? null : `20${String(24 + Math.floor(r() * 14)).padStart(2, '0')}-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-28T00:00:00.000Z`;
      d.rentRoll.push({ suite: String(100 + i), tenant: vacant ? 'Vacant' : `T${i}`, sf: r() < 0.1 ? null : 500 + Math.floor(r() * 9000), annual: vacant ? null : (r() < 0.1 ? null : Math.round(r() * 4e5)), end, mtm, vacant });
    }
    if (r() < 0.6) d.rentRollAsOf = pick(['2026-06-30', '2026-10-01', '2025-12-31']);
  }
  const comps = r() < 0.35 ? compBasis(COMPS.slice(0, 1 + Math.floor(r() * COMPS.length))) : null;
  const over = r() < 0.5 ? {} : { rentChange: pick([undefined, -5, 3]), occ: pick([undefined, 88, 100]), noi: pick([undefined, 420000]), exitCap: pick([undefined, 7.25]), hold: pick([undefined, 3, 7]), noiBasis: pick([undefined, 'rentroll']) };
  for (const k of Object.keys(over)) if (over[k] === undefined) delete over[k];
  return { d, comps, over };
}

/** Every case: { name, d, comps, over, noiSeries }. */
export function cases() {
  const out = [];
  for (const [nm, pages] of [['retail', retail], ['netlease', netlease], ['multifamily', multifamily]]) {
    const f = fromOm(pages);
    out.push({ name: `${nm} OM`, d: f });
    out.push({ name: `${nm} OM, loan and comps`, d: { ...f, loan: { ...LOAN } }, comps: compBasis(COMPS) });
    out.push({ name: `${nm} OM, rent roll as of 2026-06-30, two comps with caps`, d: { ...f, loan: { ...LOAN, io: true }, rentRollAsOf: '2026-06-30' }, comps: compBasis(COMPS.slice(0, 2)) });
  }
  out.push({ name: 'price and cap only', d: { price: 5e6, cap: 6 } });
  out.push({ name: 'NOI and cap only', d: { noi: 300000, cap: 6 } });
  out.push({ name: 'negative NOI with a cap', d: { noi: -50000, cap: 6, bsf: 10000, loan: { ...LOAN } } });
  out.push({ name: 'zero NOI with a cap', d: { noi: 0, cap: 6, bsf: 10000 } });
  out.push({ name: 'self-contradicting OM', d: { price: 5e6, noi: 280000, cap: 6.25, bsf: 10000, price_psf: 520, units: 12, price_unit: 300000 } });
  out.push({ name: 'nothing at all', d: {} });
  out.push({ name: '27.4-year amortization', d: { price: 6450000, noi: 393450, bsf: 12000, loan: { ...LOAN, amort: 27.4 } } });
  out.push({ name: 'NOI above gross, light expenses', d: { price: 2e6, noi: 200000, gross: 150000, opex: 10000, gpr: 100000 } });
  out.push({ name: 'rent-roll NOI series', d: { price: 6e6, noi: 400000, gross: 600000, opex: 200000, occ: 92, loan: { ...LOAN } }, over: { noiBasis: 'rentroll', hold: 5 }, noiSeries: [410000, 420000, 431000, 440000, 452000, 460000] });
  const r = rng(20261010);
  for (let i = 0; i < 600; i++) out.push({ name: `random ${i}`, ...randomDeal(r) });
  return out;
}

/** What the analysis gives for one case, as exact text: analyze() and, where asked, a scenario on top. */
export function record(c) {
  const m = analyze(structuredClone(c.d), c.comps || null, TODAY);
  const run = c.over ? runScenario(structuredClone(c.d), m, c.over, { noiSeries: c.noiSeries || null }) : null;
  return exact({ m, run });
}

/** As kept in the fixture: the named cases in full, the random ones by a hash of the same text (the file stays small). */
export const kept = (c, text) => (c.name.startsWith('random ') ? `sha256:${createHash('sha256').update(text).digest('hex')}` : text);

if (import.meta.url === `file://${process.argv[1]}`) {
  const all = {};
  for (const c of cases()) all[c.name] = kept(c, record(c));
  process.stdout.write(`${JSON.stringify(all, null, 0).replace(/","/g, '",\n"')}\n`);
}
