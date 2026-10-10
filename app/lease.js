/* lease.js -- the lease engine: a rent roll as dated rent periods, projected
 * month by month.
 *
 * Pure functions, no page. A lease is not "a rent and an escalation": it is a
 * list of dated periods, each with its own rent, so step rents, fixed-dollar
 * bumps, mid-month starts, free months and a renewal at market all sit in the
 * same structure, every one visible and editable. A schedule generator turns
 * "start at $X, 3% a year" into those periods; the engine itself only reads
 * periods.
 *
 * Conventions
 *   dates     ISO strings 'YYYY-MM-DD', read as UTC calendar days; an end date
 *             is the last day the rent covers (inclusive)
 *   money     dollars; rates as percent numbers (3 means 3%)
 *   accrual   rent is earned day by day: a month holds monthly rent x the
 *             share of its days the period covers, so a lease starting on the
 *             16th of a 30-day month earns half that month
 *   source    'documented' (read from a lease, rent roll or OM) or 'projected'
 *             (an assumption: a renewal, a lease-up, a market reset). The two
 *             are never merged, and every output says which it rests on.
 *
 * Property projection, per month and per analysis year (ARGUS-style lines):
 *   base rent (contract, before concessions)
 *   + absorption and turnover vacancy at market rent = potential gross rent
 *   - absorption and turnover vacancy
 *   - free rent and abatements
 *   + expense recoveries + percentage rent + other income + one-time items
 *   - general vacancy and credit loss (only the part not already modelled as
 *     physical vacancy, so vacancy is never counted twice)
 *   = effective gross income
 *   - operating expenses = NOI
 *   - tenant improvements, leasing commissions, capital reserves
 *   = cash flow before debt service
 */

import { walt } from './engine/walt.js';

const DAY = 86400000;
const ok = (x) => typeof x === 'number' && Number.isFinite(x);
const pos = (x) => ok(x) && x > 0;

/* ----------------------------------------------------------------- dates */

/** A UTC day number from 'YYYY-MM-DD' (or a Date); null when it isn't a real date. */
export function dayOf(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : Math.floor(v.getTime() / DAY);
  if (typeof v !== 'string') return parseDay(String(v));
  // the projection asks for the same few hundred dates hundreds of thousands of times
  let d = DAYS.get(v);
  if (d === undefined) { d = parseDay(v); if (DAYS.size >= CACHE_MAX) DAYS.clear(); DAYS.set(v, d); }
  return d;
}
const CACHE_MAX = 50000;
const DAYS = new Map();
const ISOS = new Map();
function parseDay(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if (!m) return null;
  const y = +m[1]; const mo = +m[2]; const d = +m[3];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return t / DAY;
}
/** 'YYYY-MM-DD' for a UTC day number. */
export function isoOf(day) {
  let s = ISOS.get(day);
  if (s === undefined) { s = new Date(day * DAY).toISOString().slice(0, 10); if (ISOS.size >= CACHE_MAX) ISOS.clear(); ISOS.set(day, s); }
  return s;
}
/** The date `months` calendar months after `iso`, clamped to the month's end (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(iso, months) {
  const d = dayOf(iso);
  if (d === null) return null;
  const t = new Date(d * DAY);
  const y = t.getUTCFullYear(); const m = t.getUTCMonth() + months; const day = t.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return isoOf(Date.UTC(y, m, Math.min(day, last)) / DAY);
}
export const addDays = (iso, n) => { const d = dayOf(iso); return d === null ? null : isoOf(d + n); };
const monthStart = (y, m) => Date.UTC(y, m, 1) / DAY;
const daysIn = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** Overlap in days between [a0, a1] and [b0, b1], all inclusive day numbers. */
const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0) + 1);

/* --------------------------------------------------------------- amounts */

/** Rent units a period can be written in. */
export const UNITS = {
  month: 'per month',
  year: 'per year',
  psf_year: 'per SF per year',
  psf_month: 'per SF per month',
};

/** Monthly dollars from a period's rate, unit and the space's SF; null when SF is needed and missing. */
export function monthlyAmount(rate, unit, sf) {
  if (!ok(rate)) return null;
  switch (unit) {
    case 'month': return rate;
    case 'year': return rate / 12;
    case 'psf_year': return pos(sf) ? (rate * sf) / 12 : null;
    case 'psf_month': return pos(sf) ? rate * sf : null;
    default: return null;
  }
}

/**
 * Dated periods from a starting rent and an escalation rule: what a broker
 * says out loud ("$42 a foot, 3% bumps every year") written as the periods
 * the engine reads. `escalation.type` is 'pct' (compounding percent) or
 * 'fixed' (dollars added to the rate, in the rate's own unit). Each step lasts
 * `every` months; the last runs to `end`.
 */
export function generateSteps({ start, end, rate, unit = 'year', escalation = null, every = 12, source = 'documented' }) {
  const s = dayOf(start); const e = dayOf(end);
  if (s === null || e === null || e < s || !ok(rate)) return [];
  const out = [];
  let from = start; let r = rate; let k = 0;
  const step = Math.max(1, Math.round(every || 12));
  while (dayOf(from) <= e && k < 600) {
    const next = addMonths(start, step * (k + 1));
    const to = next === null || dayOf(next) - 1 >= e ? end : addDays(next, -1);
    out.push({ start: from, end: to, rate: r, unit, source });
    if (dayOf(to) >= e) break;
    from = next;
    k += 1;
    if (escalation && ok(escalation.value)) r = escalation.type === 'fixed' ? r + escalation.value : r * (1 + escalation.value / 100);
  }
  return out;
}

/* ------------------------------------------------------------ validation */

/**
 * What is wrong with a lease, as messages a broker can act on. `level` is
 * 'error' (the numbers can't be trusted) or 'warn' (worth a look).
 */
export function validateLease(L) {
  const out = [];
  const add = (level, text) => out.push({ level, text, lease: L.id });
  if (L.vacant) return out;
  const ls = dayOf(L.leaseStart); const le = dayOf(L.leaseEnd); const rs = dayOf(L.rentStart || L.leaseStart);
  if (L.leaseStart && ls === null) add('error', `Lease start "${L.leaseStart}" is not a real date.`);
  if (L.leaseEnd && le === null) add('error', `Lease end "${L.leaseEnd}" is not a real date.`);
  if (ls !== null && le !== null && le < ls) add('error', 'The lease ends before it starts.');
  if (rs !== null && ls !== null && rs < ls) add('warn', 'Rent starts before the lease does.');
  const periods = (L.periods || []).map((p, i) => ({ ...p, i, s: dayOf(p.start), e: dayOf(p.end) })).sort((a, b) => (a.s ?? 0) - (b.s ?? 0));
  if (!periods.length && !L.mtm) add('warn', 'No rent periods: this lease earns nothing in the projection.');
  for (const p of periods) {
    if (p.s === null || p.e === null) { add('error', `Rent period ${p.i + 1} has a missing or invalid date.`); continue; }
    if (p.e < p.s) add('error', `Rent period ${p.i + 1} ends before it starts (${p.start} to ${p.end}).`);
    if (!ok(p.rate)) add('error', `Rent period ${p.i + 1} has no rent.`);
    else if (p.rate < 0) add('error', `Rent period ${p.i + 1} has a negative rent; use an abatement or a credit instead.`);
    if ((p.unit === 'psf_year' || p.unit === 'psf_month') && !pos(L.sf)) add('error', `Rent period ${p.i + 1} is per SF but the space has no SF.`);
    if (!UNITS[p.unit]) add('error', `Rent period ${p.i + 1} has an unknown unit "${p.unit}".`);
    if (le !== null && p.e > le && p.source !== 'projected') add('warn', `Rent period ${p.i + 1} runs past the lease end (${L.leaseEnd}).`);
    if (rs !== null && p.s < rs && p.source !== 'projected') add('warn', `Rent period ${p.i + 1} starts before rent commences (${L.rentStart || L.leaseStart}).`);
  }
  for (let i = 1; i < periods.length; i++) {
    const a = periods[i - 1]; const b = periods[i];
    if (a.e === null || b.s === null) continue;
    if (b.s <= a.e) add('error', `Rent periods ${a.i + 1} and ${b.i + 1} overlap (${b.start} is on or before ${a.end}).`);
    else if (b.s > a.e + 1) add('warn', `No rent from ${isoOf(a.e + 1)} to ${isoOf(b.s - 1)} between periods ${a.i + 1} and ${b.i + 1}.`);
  }
  const docEnd = Math.max(...periods.filter((p) => p.source !== 'projected' && p.e !== null).map((p) => p.e), -Infinity);
  if (le !== null && periods.length && Number.isFinite(docEnd) && docEnd < le) add('warn', `The rent periods stop on ${isoOf(docEnd)}, before the lease ends on ${L.leaseEnd}.`);
  for (const [i, a] of (L.abatements || []).entries()) {
    const s = dayOf(a.start); const e = dayOf(a.end);
    if (s === null || e === null || e < s) add('error', `Free-rent or abatement ${i + 1} has invalid dates.`);
    if (!ok(a.pct) || a.pct <= 0 || a.pct > 100) add('error', `Abatement ${i + 1} should abate between 1% and 100% of rent.`);
  }
  if (L.recovery && L.recovery.method === 'prorata' && ok(L.recovery.share) && (L.recovery.share < 0 || L.recovery.share > 100)) add('error', 'The pro-rata share is outside 0-100%.');
  if (L.percentRent && pos(L.percentRent.rate) && !ok(L.percentRent.sales)) add('warn', 'Percentage rent has a rate but no sales figure, so it earns nothing.');
  return out;
}

/** Problems across the whole rent roll, including ones no single lease shows. */
export function validateRentRoll(rr) {
  const out = [];
  for (const L of rr.leases || []) out.push(...validateLease(L).map((x) => ({ ...x, unit: L.unit, tenant: L.tenant })));
  const seen = new Map();
  for (const L of rr.leases || []) {
    if (!L.unit) continue;
    const k = String(L.unit).trim().toLowerCase();
    if (seen.has(k)) out.push({ level: 'warn', text: `Unit ${L.unit} appears more than once.`, unit: L.unit, lease: L.id });
    seen.set(k, true);
  }
  const s = rr.settings || {};
  const sf = (rr.leases || []).reduce((a, L) => a + (pos(L.sf) ? L.sf : 0), 0);
  if (pos(s.buildingSf) && sf && Math.abs(sf / s.buildingSf - 1) > 0.03) {
    out.push({ level: 'warn', text: `The rent roll adds to ${Math.round(sf).toLocaleString('en-US')} SF; the building is ${Math.round(s.buildingSf).toLocaleString('en-US')} SF.` });
  }
  return out;
}

/* ---------------------------------------------------------- one lease */

/** Contract monthly rent (before abatement) in force on a day, and the period it comes from. */
function rentOn(L, day) {
  for (const p of L.periods || []) {
    const s = dayOf(p.start); const e = dayOf(p.end);
    if (s !== null && e !== null && day >= s && day <= e) return { monthly: monthlyAmount(p.rate, p.unit, L.sf), period: p };
  }
  return { monthly: null, period: null };
}

/** The lease's in-place rent on `asOf`: contract and after abatement, monthly. */
export function inPlace(L, asOf) {
  const d = dayOf(asOf);
  if (L.vacant || d === null) return { monthly: 0, net: 0, period: null };
  const { monthly, period } = rentOn(L, d);
  if (monthly === null) return { monthly: 0, net: 0, period: null };
  let abated = 0;
  for (const a of L.abatements || []) if (d >= dayOf(a.start) && d <= dayOf(a.end)) abated = Math.max(abated, (a.pct || 0) / 100);
  return { monthly, net: monthly * (1 - abated), period };
}

/**
 * The months of one lease, from `from` (an ISO date, first of a month) for `n`
 * months. Each month: contract rent earned, free rent and abatement, the rent
 * after them, and the share of the month the space is leased. Projected
 * periods (renewals, lease-up) are counted separately from documented ones.
 */
export function leaseMonths(L, from, n) {
  const f = new Date(dayOf(from) * DAY);
  const y0 = f.getUTCFullYear(); const m0 = f.getUTCMonth();
  // each period's and abatement's days, worked out once rather than every month
  const periods = [];
  if (!L.vacant) {
    for (const p of L.periods || []) {
      const s = dayOf(p.start); const e = dayOf(p.end);
      if (s === null || e === null) continue;
      periods.push({ s, e, mo: monthlyAmount(p.rate, p.unit, L.sf), projected: p.source === 'projected' });
    }
  }
  const abates = [];
  for (const a of L.abatements || []) {
    const as = dayOf(a.start); const ae = dayOf(a.end);
    if (as === null || ae === null) continue;
    abates.push({ as, ae, share: Math.min(1, Math.max(0, (a.pct || 0) / 100)) });
  }
  const out = [];
  for (let k = 0; k < n; k++) {
    const ms = monthStart(y0, m0 + k);
    const dim = daysIn(y0 + Math.floor((m0 + k) / 12), (m0 + k) % 12);
    const me = ms + dim - 1;
    let contract = 0; let projected = 0; let leasedDays = 0; let abate = 0;
    for (const p of periods) {
      const days = overlap(ms, me, p.s, p.e);
      if (!days) continue;
      const mo = p.mo;
      if (mo === null) continue;
      const earned = mo * (days / dim);
      if (p.projected) projected += earned; else contract += earned;
      leasedDays = Math.max(leasedDays, days);
      // abatements cover a share of each day's rent
      for (const a of abates) {
        const ad = overlap(Math.max(ms, p.s), Math.min(me, p.e), a.as, a.ae);
        if (ad) abate += mo * (ad / dim) * a.share;
      }
    }
    out.push({ month: isoOf(ms), contract, projected, rent: contract + projected, abatement: abate, net: contract + projected - abate, occupied: leasedDays / dim });
  }
  return out;
}

/* ------------------------------------------------- renewal and lease-up */

/**
 * The projected periods that follow a lease's documented ones: a renewal or a
 * new tenant at market rent after downtime, blended by the renewal
 * probability the way an appraiser does (expected downtime and expected free
 * rent), repeated until the horizon. Returns new periods, abatements and the
 * leasing costs they bring, all marked 'projected'.
 */
export function rollover(L, s, horizonEnd) {
  const R = { ...(s.renewal || {}), ...(L.renewal || {}) };
  if (L.vacant || R.assume === false) return { periods: [], abatements: [], costs: [] };
  const endDoc = Math.max(...(L.periods || []).filter((p) => p.source !== 'projected').map((p) => dayOf(p.end)).filter((x) => x !== null), dayOf(L.leaseEnd) ?? -Infinity);
  if (!Number.isFinite(endDoc)) return { periods: [], abatements: [], costs: [] };
  return reLease(L, s, isoOf(endDoc + 1), horizonEnd, R);
}

/** Vacant space let up: after `leaseUpMonths` it leases at market, then rolls like any other. */
export function leaseUp(L, s, asOf, horizonEnd) {
  if (!L.vacant) return { periods: [], abatements: [], costs: [] };
  const R = { ...(s.renewal || {}), ...(L.renewal || {}) };
  if (R.assume === false) return { periods: [], abatements: [], costs: [] };
  const months = ok(L.leaseUpMonths) ? L.leaseUpMonths : ok(s.leaseUpMonths) ? s.leaseUpMonths : 6;
  const start = addMonths(asOf, months);
  return reLease(L, s, start, horizonEnd, { ...R, probability: 0, downtime: 0 }, true);
}

function marketMonthlyAt(L, s, iso) {
  const base = ok(L.marketRent) ? L.marketRent : s.marketRent;
  const unit = L.marketUnit || s.marketUnit || 'psf_year';
  const mo = monthlyAmount(base, unit, L.sf);
  const g = ok(s.marketGrowth) ? s.marketGrowth / 100 : 0;
  if (mo !== null) return mo * (1 + g) ** Math.max(0, (dayOf(iso) - dayOf(s.asOf)) / 365.25);
  // no market rent for this space: the rent it last paid under a documented
  // period, grown from that period's end, stands in -- an assumption, and
  // project() says which units rest on it
  const last = lastDocumented(L);
  if (!last) return null;
  const lm = monthlyAmount(last.rate, last.unit, L.sf);
  if (lm === null) return null;
  return lm * (1 + g) ** Math.max(0, (dayOf(iso) - dayOf(last.end)) / 365.25);
}
function lastDocumented(L) {
  return (L.periods || []).filter((p) => p.source !== 'projected' && dayOf(p.end) !== null).sort((a, b) => dayOf(b.end) - dayOf(a.end))[0] || null;
}
const hasMarket = (L, s) => monthlyAmount(ok(L.marketRent) ? L.marketRent : s.marketRent, L.marketUnit || s.marketUnit || 'psf_year', L.sf) !== null;

function reLease(L, s, startIso, horizonEnd, R, isLeaseUp = false) {
  const periods = []; const abatements = []; const costs = [];
  const p = Math.min(100, Math.max(0, ok(R.probability) ? R.probability : 65)) / 100;
  const term = Math.max(12, Math.round(ok(R.termMonths) ? R.termMonths : 60));
  const esc = ok(R.escalation) ? R.escalation : 3;
  let start = startIso;
  let first = true;
  for (let guard = 0; guard < 20 && dayOf(start) !== null && dayOf(start) <= dayOf(horizonEnd); guard++) {
    // expected downtime: none if the tenant renews, the full downtime if it leaves
    const down = isLeaseUp && first ? 0 : Math.round((1 - p) * (ok(R.downtime) ? R.downtime : 6));
    const rentStart = addMonths(start, down);
    const mkt = marketMonthlyAt(L, s, rentStart);
    if (mkt === null) break;
    const end = addDays(addMonths(rentStart, term), -1);
    const steps = generateSteps({ start: rentStart, end, rate: mkt, unit: 'month', escalation: { type: 'pct', value: esc }, every: 12, source: 'projected' });
    periods.push(...steps);
    const pp = isLeaseUp && first ? 0 : p;
    const freeM = pp * (ok(R.renewFree) ? R.renewFree : 0) + (1 - pp) * (ok(R.newFree) ? R.newFree : 3);
    if (freeM > 0) {
      const whole = Math.floor(freeM);
      const freeEnd = whole ? addDays(addMonths(rentStart, whole), -1) : null;
      if (freeEnd) abatements.push({ start: rentStart, end: freeEnd, pct: 100, source: 'projected', note: 'expected free rent' });
      const frac = freeM - whole;
      if (frac > 0.001) {
        const fs = addMonths(rentStart, whole);
        abatements.push({ start: fs, end: addDays(addMonths(fs, 1), -1), pct: Math.round(frac * 1000) / 10, source: 'projected', note: 'expected free rent' });
      }
    }
    // leasing costs, paid when the new term starts
    const ti = pp * (ok(R.renewTi) ? R.renewTi : 0) + (1 - pp) * (ok(R.newTi) ? R.newTi : 0);
    const lcPct = pp * (ok(R.renewLc) ? R.renewLc : 0) + (1 - pp) * (ok(R.newLc) ? R.newLc : 0);
    const termRent = steps.reduce((a, st) => a + monthlyAmount(st.rate, st.unit, L.sf) * monthsBetween(st.start, st.end), 0);
    if (ti > 0 && pos(L.sf)) costs.push({ date: rentStart, kind: 'ti', amount: ti * L.sf });
    if (lcPct > 0) costs.push({ date: rentStart, kind: 'lc', amount: termRent * lcPct / 100 });
    start = addDays(end, 1);
    first = false;
  }
  return { periods, abatements, costs };
}

/** Calendar months from `a` to the day after `b` (inclusive end): whole months, plus a share of a part month. */
function monthsBetween(a, b) {
  const x = new Date(dayOf(a) * DAY); const y = new Date((dayOf(b) + 1) * DAY);
  let m = (y.getUTCFullYear() - x.getUTCFullYear()) * 12 + (y.getUTCMonth() - x.getUTCMonth());
  let d = y.getUTCDate() - x.getUTCDate();
  if (d < 0) { m -= 1; d += daysIn(y.getUTCFullYear(), y.getUTCMonth() - 1); }
  return m + d / daysIn(y.getUTCFullYear(), y.getUTCMonth());
}

/* --------------------------------------------------- property projection */

/** Settings every projection starts from; a rent roll's own settings override them. */
export const DEFAULT_SETTINGS = {
  asOf: null, years: 10, marketRent: null, marketUnit: 'psf_year', marketGrowth: 3,
  opex: null, expenseGrowth: 3, recoverable: null, generalVacancy: 0, reservesPsf: 0,
  otherIncome: [], leaseUpMonths: 6, buildingSf: null,
  renewal: { assume: true, probability: 65, termMonths: 60, downtime: 6, renewFree: 0, newFree: 3, renewTi: 0, newTi: 0, renewLc: 0, newLc: 0, escalation: 3 },
};

/**
 * A rent roll projected month by month and rolled up by analysis year.
 * `rr` is { settings, leases }. Nothing in `rr` is changed.
 */
export function project(rr, { asOf: asOfArg, years: yearsArg } = {}) {
  const s = { ...DEFAULT_SETTINGS, ...(rr.settings || {}) };
  s.renewal = { ...DEFAULT_SETTINGS.renewal, ...((rr.settings || {}).renewal || {}) };
  const asOf = asOfArg || s.asOf || isoOf(Math.floor(Date.now() / DAY));
  s.asOf = asOf;
  const a = new Date(dayOf(asOf) * DAY);
  const from = isoOf(monthStart(a.getUTCFullYear(), a.getUTCMonth()));
  const years = Math.max(1, Math.min(30, Math.round(yearsArg || s.years || 10)));
  const n = years * 12;
  const horizonEnd = addDays(addMonths(from, n), -1);
  const leases = rr.leases || [];
  const totalSf = leases.reduce((x, L) => x + (pos(L.sf) ? L.sf : 0), 0) || s.buildingSf || null;

  const rows = Array.from({ length: n }, (_, k) => ({
    month: addMonths(from, k), base: 0, projected: 0, vacancy: 0, free: 0, recoveries: 0, pctRent: 0, other: 0, oneTime: 0,
    opex: 0, ti: 0, lc: 0, reserves: 0, occupiedSf: 0,
  }));
  const perLease = [];
  const notes = [];
  const fromContract = []; const noMarket = [];
  for (const L of leases) {
    if (!hasMarket(L, s)) (L.vacant ? noMarket : fromContract).push(L.unit || L.tenant || '?');
    const roll = L.vacant ? leaseUp(L, s, from, horizonEnd) : rollover(L, s, horizonEnd);
    const full = { ...L, periods: [...(L.periods || []), ...roll.periods], abatements: [...(L.abatements || []), ...roll.abatements], vacant: L.vacant && !roll.periods.length };
    if (L.vacant && roll.periods.length) full.vacant = false;
    const months = leaseMonths(full, from, n);
    const lr = { id: L.id, unit: L.unit, tenant: L.tenant, months, costs: roll.costs, projectedPeriods: roll.periods };
    perLease.push(lr);
    months.forEach((m, k) => {
      const R = rows[k];
      R.base += m.contract;
      R.projected += m.projected;
      R.free += m.abatement;
      R.occupiedSf += (pos(L.sf) ? L.sf : 0) * m.occupied;
      // physical vacancy at market rent: the potential this space didn't earn
      const mkt = marketMonthlyAt(L, s, m.month);
      if (mkt !== null && m.occupied < 1) R.vacancy += mkt * (1 - m.occupied);
    });
    for (const c of roll.costs) {
      const k = monthIndex(from, c.date);
      if (k >= 0 && k < n) rows[k][c.kind] += c.amount;
    }
    // percentage rent: the part of annual sales above the breakpoint, earned monthly while occupied
    const P = L.percentRent;
    if (P && pos(P.rate) && ok(P.sales)) {
      const firstRent = (L.periods || []).find((p) => p.source !== 'projected');
      const bp = P.natural && firstRent ? (monthlyAmount(firstRent.rate, firstRent.unit, L.sf) * 12) / (P.rate / 100) : P.breakpoint;
      months.forEach((m, k) => {
        if (!m.occupied || !ok(bp)) return;
        const sales = P.sales * (1 + (P.growth || 0) / 100) ** Math.floor(k / 12);
        rows[k].pctRent += (Math.max(0, sales - bp) * (P.rate / 100) / 12) * m.occupied;
      });
    }
    // expense recoveries
    const Rc = L.recovery;
    if (Rc && Rc.method && Rc.method !== 'none') {
      const share = ok(Rc.share) ? Rc.share / 100 : (totalSf && pos(L.sf) ? L.sf / totalSf : 0);
      months.forEach((m, k) => {
        if (!m.occupied) return;
        const g = (1 + (s.expenseGrowth || 0) / 100) ** Math.floor(k / 12);
        const pool = (ok(s.recoverable) ? s.recoverable : ok(s.opex) ? s.opex : 0) * g;
        let annual = 0;
        if (Rc.method === 'prorata') annual = pool * share;
        else if (Rc.method === 'base_year') annual = Math.max(0, pool - (Rc.baseAmount || 0)) * share;
        else if (Rc.method === 'stop' && pos(L.sf)) annual = Math.max(0, pool / (totalSf || L.sf) - (Rc.stopPsf || 0)) * L.sf;
        else if (Rc.method === 'fixed') annual = (Rc.amount || 0) * (1 + (Rc.growth || 0) / 100) ** Math.floor(k / 12);
        rows[k].recoveries += (annual / 12) * m.occupied;
      });
    }
    for (const o of L.oneTime || []) {
      const k = monthIndex(from, o.date);
      if (k >= 0 && k < n && ok(o.amount)) rows[k].oneTime += o.amount;
    }
  }
  for (const o of s.otherIncome || []) {
    if (!ok(o.annual)) continue;
    rows.forEach((R, k) => { R.other += (o.annual / 12) * (1 + (o.growth || 0) / 100) ** Math.floor(k / 12); });
  }
  rows.forEach((R, k) => {
    const g = (1 + (s.expenseGrowth || 0) / 100) ** Math.floor(k / 12);
    if (ok(s.opex)) R.opex = (s.opex / 12) * g;
    if (pos(s.reservesPsf) && totalSf) R.reserves = (s.reservesPsf * totalSf / 12) * g;
    R.rent = R.base + R.projected;
    R.gpr = R.rent + R.vacancy;
  });
  // general vacancy and credit loss: a share of the year's potential income,
  // less the physical vacancy already modelled that year, spread over its months
  for (let y = 0; y < years; y++) {
    const part = rows.slice(y * 12, y * 12 + 12);
    const potential = part.reduce((x, R) => x + R.gpr + R.recoveries + R.pctRent + R.other, 0);
    const modelled = part.reduce((x, R) => x + R.vacancy, 0);
    const gv = Math.max(0, potential * (s.generalVacancy || 0) / 100 - modelled);
    for (const R of part) R.generalVacancy = gv / part.length;
  }
  rows.forEach((R) => {
    R.egi = R.gpr - R.vacancy - R.free + R.recoveries + R.pctRent + R.other + R.oneTime - R.generalVacancy;
    R.noi = R.egi - R.opex;
    R.cashFlow = R.noi - R.ti - R.lc - R.reserves;
    R.occupancy = totalSf ? (R.occupiedSf / totalSf) * 100 : null;
  });
  const keys = ['base', 'projected', 'rent', 'vacancy', 'gpr', 'free', 'recoveries', 'pctRent', 'other', 'oneTime', 'generalVacancy', 'egi', 'opex', 'noi', 'ti', 'lc', 'reserves', 'cashFlow'];
  const annual = [];
  for (let y = 0; y < years; y++) {
    const part = rows.slice(y * 12, y * 12 + 12);
    const A = { year: y + 1, from: part[0].month, to: addDays(addMonths(part[0].month, 12), -1) };
    for (const k of keys) A[k] = part.reduce((x, r) => x + r[k], 0);
    A.occupancy = part[0].occupancy === null ? null : part.reduce((x, r) => x + r.occupancy, 0) / part.length;
    annual.push(A);
  }
  if (fromContract.length && s.renewal.assume !== false) notes.push(`No market rent is set for ${fromContract.length === leases.length ? 'any unit' : `unit${fromContract.length === 1 ? '' : 's'} ${fromContract.join(', ')}`}: renewals and re-leasing there assume the last documented rent, grown ${s.marketGrowth}% a year. Set market rents under Assumptions.`);
  if (noMarket.length) notes.push(`Vacant unit${noMarket.length === 1 ? '' : 's'} ${noMarket.join(', ')} ${noMarket.length === 1 ? 'has' : 'have'} no market rent, so ${noMarket.length === 1 ? 'its' : 'their'} potential rent, vacancy and lease-up are left out.`);
  return { settings: s, asOf, from, months: rows, annual, leases: perLease, totalSf, notes };
}

/** What the screens read from a projection: the years, where they start, and the notes (not the month-by-month detail). */
export function projectionSummary(P) {
  return { asOf: P.asOf, from: P.from, annual: P.annual, notes: P.notes, totalSf: P.totalSf, settings: P.settings };
}

function monthIndex(from, iso) {
  const a = new Date(dayOf(from) * DAY); const b = new Date(dayOf(iso) * DAY);
  if (Number.isNaN(b.getTime())) return -1;
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

/* ------------------------------------------------------- rent roll reads */

/**
 * The rent roll as of a date: in-place rent, WALT, expirations, concentration
 * and loss to lease. Documented terms only: projected renewals don't count
 * as leased term.
 */
export function rentRollSummary(rr, asOf) {
  const s = { ...DEFAULT_SETTINGS, ...(rr.settings || {}) };
  const d = dayOf(asOf || s.asOf);
  const leases = rr.leases || [];
  const totalSf = leases.reduce((x, L) => x + (pos(L.sf) ? L.sf : 0), 0);
  let leasedSf = 0; let annual = 0; let annualNet = 0; let market = 0; let marketOcc = 0;
  const rows = [];
  for (const L of leases) {
    const ip = inPlace(L, asOf || s.asOf);
    const end = dayOf(L.leaseEnd);
    const occupied = !L.vacant && ip.monthly > 0;
    const yrs = occupied && end !== null ? Math.max(0, (end - d) / 365.25) : null;
    const mkt = marketMonthlyAt(L, { ...s, asOf: asOf || s.asOf, marketGrowth: 0 }, asOf || s.asOf);
    if (occupied) {
      if (pos(L.sf)) leasedSf += L.sf;
      annual += ip.monthly * 12;
      annualNet += ip.net * 12;
      if (mkt !== null) { market += mkt * 12; marketOcc += ip.monthly * 12; }
    }
    rows.push({
      id: L.id, unit: L.unit, tenant: L.vacant ? 'Vacant' : L.tenant, sf: L.sf, occupied, mtm: !!L.mtm, monthly: ip.monthly, annual: ip.monthly * 12,
      annualNet: ip.net * 12, psf: pos(L.sf) && occupied ? (ip.monthly * 12) / L.sf : null, end: L.leaseEnd || null, yearsLeft: yrs,
      market: mkt !== null ? mkt * 12 : null, lossToLease: mkt !== null && occupied ? mkt * 12 - ip.monthly * 12 : null,
    });
  }
  // expirations by calendar year of the lease end
  const exp = new Map();
  for (const r of rows) {
    if (!r.occupied) continue;
    const y = r.end ? Number(r.end.slice(0, 4)) : 'No date';
    const e = exp.get(y) || { year: y, count: 0, sf: 0, rent: 0 };
    e.count += 1; e.sf += pos(r.sf) ? r.sf : 0; e.rent += r.annual;
    exp.set(y, e);
  }
  const expirations = [...exp.values()].sort((a, b) => (a.year === 'No date') - (b.year === 'No date') || a.year - b.year)
    .map((e) => ({ ...e, sfPct: totalSf ? (e.sf / totalSf) * 100 : null, rentPct: annual ? (e.rent / annual) * 100 : null }));
  const byTenant = rows.filter((r) => r.occupied).sort((a, b) => b.annual - a.annual)
    .map((r) => ({ tenant: r.tenant, unit: r.unit, annual: r.annual, share: annual ? (r.annual / annual) * 100 : null }));
  const hhi = byTenant.reduce((x, t) => x + (t.share || 0) ** 2, 0);
  const w = walt(rows.map((r) => ({ annual: r.occupied ? r.annual : null, sf: r.sf, end: r.end, mtm: r.mtm, vacant: !r.occupied })), { asOf: asOf || s.asOf });
  return {
    rows, totalSf: totalSf || null, leasedSf, occupancy: totalSf ? (leasedSf / totalSf) * 100 : null,
    units: leases.length, occupiedUnits: rows.filter((r) => r.occupied).length,
    annualRent: annual, annualNet, monthlyRent: annual / 12,
    avgRentPsf: leasedSf ? annual / leasedSf : null,
    // WALT: the engine's one definition (engine/walt.js), from the as-of date
    waltIncome: w.income,
    waltSf: w.sf,
    walt: w.headline,
    waltWeight: w.weight,
    waltMtm: w.mtm,
    marketRentOccupied: market || null,
    lossToLease: market ? market - marketOcc : null,
    lossToLeasePct: market ? ((market - marketOcc) / market) * 100 : null,
    expirations, concentration: byTenant, top: byTenant[0] || null, hhi: byTenant.length ? hhi : null,
  };
}

/* ------------------------------------------------- from the OM's table */

let seq = 0;
export const leaseId = () => `l${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/**
 * A rent roll from the rows the OM reader found: one documented period per
 * lease at the rent the OM prints, from its start (or the as-of date) to its
 * expiration. A row with no dates gets no period end and is flagged.
 */
export function fromOmRows(rows, { asOf, page = null, buildingSf = null } = {}) {
  const leases = (rows || []).map((r) => {
    const start = r.start ? String(r.start).slice(0, 10) : null;
    const end = r.end ? String(r.end).slice(0, 10) : null;
    const L = {
      id: leaseId(), unit: r.suite || '', tenant: r.vacant ? '' : (r.tenant || ''), sf: pos(r.sf) ? r.sf : null,
      vacant: !!r.vacant, mtm: !!r.mtm, leaseStart: start, rentStart: null, leaseEnd: end, periods: [], abatements: [],
      source: { kind: 'om', page }, custom: {},
    };
    if (!r.vacant && pos(r.annual)) {
      const pStart = start || asOf;
      const pEnd = end || (r.mtm ? addDays(addMonths(asOf, 1), -1) : null);
      if (pStart && pEnd) L.periods.push({ start: pStart, end: pEnd, rate: r.annual, unit: 'year', source: 'documented', note: page ? `OM rent roll, page ${page}` : 'OM rent roll' });
      else L.periods.push({ start: pStart, end: pStart, rate: r.annual, unit: 'year', source: 'documented', note: 'no expiration date in the OM' });
    }
    return L;
  });
  return { settings: { ...DEFAULT_SETTINGS, asOf, buildingSf }, leases, columns: null };
}
