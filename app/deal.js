/* deal.js -- the arithmetic a broker does on the back of an OM, done right.
 *
 * Pure functions, no page: the Deal screen, the site-visit brief and the
 * workbook's Deal Analysis tab all call these, so the three always agree.
 *
 * Conventions: money in dollars, rates and percentages as percent numbers
 * (6.25 means 6.25%), areas in SF, terms in years. A missing input is null
 * and every result that needs it is null too, never zero. */

const ok = (x) => typeof x === 'number' && Number.isFinite(x);
const pos = (x) => ok(x) && x > 0;

import { debtService, loanConstant, balanceAfter, sizeLoan } from './engine/debt.js';
import { compBasis } from './engine/comps.js';
import { evaluate, leaseStats, yearsLeft } from './engine/figures.js';

// the loan, comp and rent roll arithmetic lives in the engine; it is re-exported here for the modules that import it from deal.js
export { debtService, loanConstant, balanceAfter, sizeLoan, compBasis, leaseStats, yearsLeft };

/* ------------------------------------------------------------- the deal */

/**
 * Everything worked out from a deal's inputs: the figures, checks and
 * questions registered in engine/figures.js, each with what it reads.
 * `d` holds the deal's figures (see Deal screen), `comps` is compBasis() of the sale comps or null.
 * @param {AnalysisInput} d @param {object | null} [comps] @param {Date} [today] @returns {Analysis}
 */
export function analyze(d, comps = null, today = new Date()) {
  return evaluate(d, comps, today);
}

/* ------------------------------------------------- hold-period returns */

/**
 * Internal rate of return of yearly cash flows (flows[0] at time zero), as a
 * percent. Null when there is no sign change, so no rate can exist, or when
 * no rate between -99% and +1,000% balances them. Bisection on the NPV: slow
 * next to Newton's method, but it cannot wander off on an odd cash flow.
 * @param {number[]} flows @returns {Pct | null}
 */
export function irr(flows) {
  if (!Array.isArray(flows) || flows.length < 2 || !flows.every(ok)) return null;
  if (!flows.some((x) => x < 0) || !flows.some((x) => x > 0)) return null;
  const npv = (r) => flows.reduce((s, x, t) => s + x / (1 + r) ** t, 0);
  let lo = -0.99;
  let hi = 10;
  let fLo = npv(lo);
  const fHi = npv(hi);
  if (fLo * fHi > 0) return null;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    const f = npv(mid);
    if (Math.abs(f) < 1e-7 || hi - lo < 1e-12) return mid * 100;
    if (f * fLo < 0) hi = mid; else { lo = mid; fLo = f; }
  }
  return ((lo + hi) / 2) * 100;
}

/**
 * Buy, hold and sell, a year at a time.
 *
 *   price, noi       purchase price and year-1 NOI
 *   growth           NOI growth a year, %
 *   hold             years held (whole years, 1 to 30)
 *   exitCap          cap rate at sale, %, applied to the NOI of the year after
 *                    the sale (the buyer's first year), the usual convention
 *   saleCost         costs of the sale, % of the exit price
 *   loan             { ltv, rate, amort, io, closing } as on the Deal screen
 *
 * Returns the yearly flows, the exit, and unlevered and levered IRR and
 * equity multiple. Every figure is null when an input it needs is missing.
 * @param {{ price: Usd, noi: UsdPerYear, growth?: Pct, hold?: Years, exitCap: Pct, saleCost?: Pct, loan?: HoldLoan, noiSeries?: UsdPerYear[] | null }} a
 */
export function holdReturns({ price, noi, growth = 0, hold = 5, exitCap, saleCost = 0, loan = {}, noiSeries = null }) {
  const n = Math.round(hold);
  if (!pos(price) || !ok(noi) || !pos(exitCap) || !(n >= 1 && n <= 30)) return null;
  const g = ok(growth) ? growth / 100 : 0;
  const closing = ok(loan.closing) && loan.closing > 0 ? price * loan.closing / 100 : 0;
  const L = pos(loan.ltv) ? price * loan.ltv / 100 : 0;
  const ds = L ? debtService(L, loan.rate, loan.amort, loan.io) : 0;
  if (L && ds === null) return null;
  // years 1 .. n+1: a NOI for each year from a projection (the rent roll), or year 1 grown at one rate
  const series = Array.isArray(noiSeries) && noiSeries.length >= n + 1 && noiSeries.slice(0, n + 1).every(ok) ? noiSeries.slice(0, n + 1) : null;
  const nois = series || Array.from({ length: n + 1 }, (_, t) => noi * (1 + g) ** t);
  const exitValue = nois[n] / (exitCap / 100);
  const sell = ok(saleCost) && saleCost > 0 ? exitValue * saleCost / 100 : 0;
  const balance = L ? balanceAfter(L, loan.rate, loan.amort, n, loan.io) : 0;
  const equity = price - L + closing;
  const unlev = [-(price + closing)];
  const lev = [-equity];
  for (let t = 1; t <= n; t++) {
    const exit = t === n ? exitValue - sell : 0;
    unlev.push(nois[t - 1] + exit);
    lev.push(nois[t - 1] - ds + (t === n ? exitValue - sell - balance : 0));
  }
  const multiple = (flows) => (flows[0] < 0 ? flows.slice(1).reduce((s, x) => s + x, 0) / -flows[0] : null);
  return {
    hold: n, nois: nois.slice(0, n), exitNoi: nois[n], exitValue, saleCosts: sell, loan: L, debtService: ds,
    balance, equity, closing, unlevered: unlev, levered: lev,
    unleveredIrr: irr(unlev), leveredIrr: L ? irr(lev) : irr(unlev),
    unleveredMultiple: multiple(unlev), leveredMultiple: multiple(L ? lev : unlev),
    profit: lev.reduce((s, x) => s + x, 0),
    cashOnCash1: equity > 0 ? ((nois[0] - ds) / equity) * 100 : null,
  };
}

/**
 * The price at which `metric(price)` reaches `target`, for a metric that falls
 * as the price rises (cap rate, IRR, DSCR). Prices from a fifth of `around` to
 * five times it are scanned for a pair either side of the target (a price so
 * high that the IRR stops existing is simply skipped), then bisected.
 * Null when the target can't be reached in that range.
 */
export function solvePrice(metric, target, around) {
  if (!ok(target) || !pos(around)) return null;
  const f = (p) => { const v = metric(p); return ok(v) ? v - target : null; };
  const steps = 60;
  let prev = null;
  for (let k = 0; k <= steps; k++) {
    const p = around * 0.2 * 25 ** (k / steps);
    const fp = f(p);
    if (fp === null) { prev = null; continue; }
    if (fp === 0) return p;
    if (prev && prev.f * fp < 0) {
      let lo = prev.p; let hi = p; let fLo = prev.f;
      for (let i = 0; i < 200; i++) {
        const mid = (lo + hi) / 2;
        const fm = f(mid);
        if (fm === null) return null;
        if (Math.abs(fm) < 1e-9 || (hi - lo) / mid < 1e-11) return mid;
        if (fm * fLo > 0) { lo = mid; fLo = fm; } else hi = mid;
      }
      return (lo + hi) / 2;
    }
    prev = { p, f: fp };
  }
  return null;
}

/* ------------------------------------------------------------ scenarios */

/**
 * The assumptions a scenario starts from: the deal as it stands, plus hold-period defaults.
 * @param {AnalysisInput} d @param {Analysis} m @returns {ScenarioInputs}
 */
export function scenarioBase(d, m) {
  const L = d.loan || {};
  const cap = ok(m.cap) && m.cap > 0 ? m.cap : null;
  return {
    price: m.price, noi: m.noi, occ: m.occ, gross: pos(d.gross) ? d.gross : null, opex: ok(d.opex) ? d.opex : null,
    rentChange: 0, expenseChange: 0,
    ltv: L.ltv, rate: L.rate, amort: L.amort, io: !!L.io, closing: L.closing,
    hold: 5, growth: 2, saleCost: 2,
    // a sale cap a quarter point above going in: an assumption, and shown as one
    exitCap: cap ? Math.round((cap + 0.25) * 100) / 100 : null,
  };
}

/**
 * A scenario worked through. `over` holds only what the person changed; the
 * deal itself is never touched. NOI follows the rent, occupancy and expense
 * changes when the deal has gross income and expenses to apply them to; a
 * NOI typed straight in wins over all three.
 * @param {AnalysisInput} d @param {Analysis} m @param {ScenarioOver} [over] @param {{ noiSeries?: UsdPerYear[] | null }} [ctx]
 */
export function runScenario(d, m, over = {}, { noiSeries = null } = {}) {
  const base = scenarioBase(d, m);
  /** @type {ScenarioInputs} */
  const s = { ...base };
  for (const [k, v] of Object.entries(over)) if (v !== null && v !== undefined && v !== '') s[k] = v;
  const notes = [];
  let noi = base.noi;
  const canBuildUp = pos(base.gross) && ok(base.opex);
  const touchesOps = ['rentChange', 'expenseChange', 'occ'].some((k) => over[k] !== undefined && over[k] !== null && over[k] !== '');
  if (touchesOps && canBuildUp) {
    const occFactor = pos(base.occ) && pos(s.occ) ? s.occ / base.occ : 1;
    if (ok(s.occ) && !pos(base.occ)) notes.push('The deal has no occupancy to scale from, so the occupancy change is not applied.');
    const egi = base.gross * (1 + (s.rentChange || 0) / 100) * occFactor;
    const opex = base.opex * (1 + (s.expenseChange || 0) / 100);
    noi = egi - opex;
    s.grossNow = egi;
    s.opexNow = opex;
  } else if (touchesOps) {
    notes.push('Rent, occupancy and expense changes need the deal\'s gross income and operating expenses; enter them, or change NOI directly.');
  }
  // NOI year by year from the rent roll's projection, when asked for and available
  let series = null;
  if (s.noiBasis === 'rentroll') {
    if (Array.isArray(noiSeries) && noiSeries.length && noiSeries.every(ok)) {
      if (ok(over.noi)) notes.push('A NOI typed in replaces the rent roll\'s: returns use it, grown at the growth rate.');
      else if (touchesOps) notes.push('Rent, occupancy and expense changes apply to the OM\'s NOI, grown at the growth rate, not to the rent roll; to change the rent roll\'s projection, edit its leases.');
      else { series = noiSeries; noi = noiSeries[0]; }
    } else notes.push('The rent roll can\'t give a NOI yet: it needs leases and operating expenses (Rent roll, Assumptions).');
  }
  if (ok(over.noi)) noi = over.noi;
  s.noi = noi;
  const loan = { ltv: s.ltv, rate: s.rate, amort: s.amort, io: s.io, closing: s.closing, minDscr: (d.loan || {}).minDscr, minDy: (d.loan || {}).minDy };
  const sm = analyze({ ...d, price: s.price, noi, cap: null, gross: s.grossNow ?? d.gross, opex: s.opexNow ?? d.opex, occ: s.occ ?? d.occ, loan }, null);
  const ret = holdReturns({ price: s.price, noi, growth: s.growth, hold: s.hold, exitCap: s.exitCap, saleCost: s.saleCost, loan, noiSeries: series });
  return { inputs: s, base, m: sm, returns: ret, notes, series, changed: Object.keys(over).filter((k) => over[k] !== null && over[k] !== undefined && over[k] !== '') };
}

/**
 * Deterministic answers to the questions a buyer asks of a scenario.
 * @param {AnalysisInput} d @param {Analysis} m @param {ScenarioOver} [over] @param {ScenarioTargets} [targets] @param {{ noiSeries?: UsdPerYear[] | null }} [ctx]
 */
export function scenarioAnswers(d, m, over = {}, { targetCap, targetIrr, capForValue } = {}, ctx = {}) {
  const run = runScenario(d, m, over, ctx);
  const s = run.inputs;
  const loan = { ltv: s.ltv, rate: s.rate, amort: s.amort, io: s.io, closing: s.closing };
  const out = {};
  if (ok(s.noi) && s.noi > 0 && pos(targetCap)) out.priceForCap = s.noi / (targetCap / 100);
  if (ok(s.noi) && s.noi > 0 && pos(capForValue)) out.valueAtCap = s.noi / (capForValue / 100);
  if (ok(targetIrr) && pos(s.price) && run.returns) {
    out.priceForIrr = solvePrice((p) => {
      const r = holdReturns({ price: p, noi: s.noi, growth: s.growth, hold: s.hold, exitCap: s.exitCap, saleCost: s.saleCost, loan, noiSeries: run.series });
      return r ? r.leveredIrr : null;
    }, targetIrr, s.price);
  }
  out.equity = run.returns ? run.returns.equity : run.m.equity;
  return { ...out, run };
}
