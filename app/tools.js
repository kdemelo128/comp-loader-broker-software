/* tools.js -- the calculators on the Tools screen, as plain functions.
 *
 * Each takes the figures a broker would type and returns every result the
 * screen shows, with null wherever an input is missing. toolsui.js draws
 * them; the tests check the arithmetic. */

import { debtService, sizeLoan, leaseStats } from './deal.js';
import { netEffectiveRent } from './engine/leasing.js';

export { netEffectiveRent };

const ok = (x) => typeof x === 'number' && Number.isFinite(x);
const pos = (x) => ok(x) && x > 0;

/** Any two of price, NOI and cap rate give the third. */
export function quickValue({ price, noi, cap, bsf, units }) {
  let p = pos(price) ? price : null;
  let n = ok(noi) ? noi : null;
  let c = pos(cap) ? cap : null;
  let solved = null;
  const warnings = [];
  // no price from a zero or negative NOI (the same rule as the deal)
  if (p === null && n !== null && c && n <= 0) warnings.push(`The NOI is ${n === 0 ? 'zero' : 'negative'}, so no price is worked out from the cap rate.`);
  if (p === null && n !== null && n > 0 && c) { p = n / (c / 100); solved = 'price'; } else if (n === null && p && c) { n = p * c / 100; solved = 'noi'; } else if (c === null && p && n !== null) { c = (n / p) * 100; solved = 'cap'; }
  // all three typed: nothing is solved, and a cap rate that isn't NOI over price is said so, not overwritten
  const capCalc = p && n !== null ? (n / p) * 100 : null;
  const mismatch = solved === null && c !== null && capCalc !== null && Math.abs(capCalc - c) >= 0.01 ? capCalc - c : null;
  return {
    price: p, noi: n, cap: c, solved, capCalc, mismatch, warnings,
    ppsf: p && pos(bsf) ? p / bsf : null,
    perUnit: p && pos(units) ? p / units : null,
    noiPsf: n !== null && pos(bsf) ? n / bsf : null,
  };
}

/** The largest loan, by each lender test, and what it costs. */
export function loanTool({ price, noi, ltv, rate, amort, io, minDscr, minDy }) {
  const s = sizeLoan({ price, noi, ltv, dscr: minDscr, dy: minDy, rate, amort, io });
  if (!s) return { sized: null };
  const ds = debtService(s.loan, rate, amort, io);
  return {
    sized: s,
    loan: s.loan,
    debtService: ds,
    monthly: ok(ds) ? ds / 12 : null,
    dscr: ok(ds) && ok(noi) ? noi / ds : null,
    ltvAtMax: pos(price) ? (s.loan / price) * 100 : null,
    equity: pos(price) ? price - s.loan : null,
    debtYield: ok(noi) ? (noi / s.loan) * 100 : null,
  };
}

/** What to offer, and what the seller walks away with. */
export function offerTool({ ask, noi, targetCap, bsf, targetPpsf, price, commission, transfer, other, payoff }) {
  const atCap = pos(noi) && pos(targetCap) ? noi / (targetCap / 100) : null;
  const atPpsf = pos(bsf) && pos(targetPpsf) ? bsf * targetPpsf : null;
  const p = pos(price) ? price : (atCap ?? atPpsf);
  const comm = pos(p) && ok(commission) ? p * commission / 100 : 0;
  const tax = pos(p) && ok(transfer) ? p * transfer / 100 : 0;
  const costs = comm + tax + (ok(other) ? other : 0);
  return {
    atCap, atPpsf,
    atCapVsAsk: atCap && pos(ask) ? (atCap / ask - 1) * 100 : null,
    atPpsfVsAsk: atPpsf && pos(ask) ? (atPpsf / ask - 1) * 100 : null,
    price: p,
    capAtPrice: pos(p) && ok(noi) ? (noi / p) * 100 : null,
    ppsfAtPrice: pos(p) && pos(bsf) ? p / bsf : null,
    commission: comm, transfer: tax, costs,
    net: pos(p) ? p - costs - (ok(payoff) ? payoff : 0) : null,
    netPct: pos(p) ? ((p - costs - (ok(payoff) ? payoff : 0)) / p) * 100 : null,
  };
}

/**
 * Net effective rent on a lease: base rent in $/SF a year, escalating each
 * lease year, less free rent, tenant improvements and leasing commissions.
 * The simple figure spreads the net over the term; the discounted one is the
 * level rent with the same present value (rent paid monthly in advance).
 */
const DAY = 86400000;

/** 1031 exchange deadlines from the day the relinquished property closed. */
export function exchangeDates(closing, today = new Date()) {
  if (!closing) return null;
  const c = new Date(closing);
  if (Number.isNaN(c.getTime())) return null;
  const start = Date.UTC(c.getUTCFullYear(), c.getUTCMonth(), c.getUTCDate());
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const identify = new Date(start + 45 * DAY);
  const close = new Date(start + 180 * DAY);
  return {
    identify, close,
    identifyLeft: Math.round((identify.getTime() - t) / DAY),
    closeLeft: Math.round((close.getTime() - t) / DAY),
  };
}

/** WALT and rollover from rows typed by hand. */
export function waltTool(rows, today = new Date()) {
  const clean = rows.filter((r) => pos(r.sf) || pos(r.annual)).map((r) => ({
    tenant: r.tenant, sf: pos(r.sf) ? r.sf : null, annual: pos(r.annual) ? r.annual : null,
    end: r.end ? new Date(r.end) : null, vacant: !pos(r.annual) && /vacant/i.test(r.tenant || ''),
  }));
  // the engine's WALT, measured from today (whole days)
  return leaseStats(clean, today);
}
