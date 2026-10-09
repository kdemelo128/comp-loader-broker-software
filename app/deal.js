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
const div = (a, b) => (ok(a) && pos(b) ? a / b : null);

/** Annual debt service: amortizing, or interest only. */
export function debtService(loan, ratePct, amortYears, io = false) {
  if (!pos(loan) || !ok(ratePct) || ratePct < 0) return null;
  const r = ratePct / 100;
  if (io) return loan * r;
  if (!pos(amortYears)) return null;
  const n = amortYears * 12;
  const i = r / 12;
  if (i === 0) return loan / amortYears;
  return 12 * (loan * i) / (1 - (1 + i) ** -n);
}

/** Debt service per dollar of loan, a year: the loan constant. Null when the terms are incomplete. */
export const loanConstant = (ratePct, amortYears, io = false) => {
  const ds = debtService(1e6, ratePct, amortYears, io);
  return ds === null ? null : ds / 1e6;
};

/** Balance left after `years` of payments on an amortizing loan. */
export function balanceAfter(loan, ratePct, amortYears, years, io = false) {
  if (!pos(loan) || !ok(ratePct) || ratePct < 0 || !ok(years) || years < 0) return null;
  if (io) return loan;
  if (!pos(amortYears)) return null;
  const i = ratePct / 100 / 12;
  const n = amortYears * 12;
  const k = Math.min(n, Math.round(years * 12));
  if (i === 0) return loan * (1 - k / n);
  const pmt = (loan * i) / (1 - (1 + i) ** -n);
  return loan * (1 + i) ** k - pmt * (((1 + i) ** k - 1) / i);
}

/** The largest loan the property supports: the least of LTV, DSCR and debt-yield sizing. */
export function sizeLoan({ price, noi, ltv, dscr, dy, rate, amort, io }) {
  const out = [];
  if (pos(price) && pos(ltv)) out.push(['LTV', price * ltv / 100]);
  const k = loanConstant(rate, amort, io);
  if (pos(noi) && pos(dscr) && pos(k)) out.push(['DSCR', noi / dscr / k]);
  if (pos(noi) && pos(dy)) out.push(['Debt yield', noi / (dy / 100)]);
  if (!out.length) return null;
  out.sort((a, b) => a[1] - b[1]);
  return { loan: out[0][1], binding: out[0][0], tests: Object.fromEntries(out) };
}

const median = (xs) => {
  const v = xs.filter(ok).sort((a, b) => a - b);
  if (!v.length) return null;
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};

/** What the comp set says, in the form the deal screen needs. `sales` are included sale comps. */
export function compBasis(sales) {
  const priced = sales.filter((c) => pos(c.price) && pos(c.bsf));
  const sf = priced.reduce((s, c) => s + c.bsf, 0);
  const ppsfs = priced.map((c) => c.price / c.bsf);
  const caps = sales.map((c) => c.cap).filter((x) => pos(x));
  return {
    n: priced.length,
    weighted: sf ? priced.reduce((s, c) => s + c.price, 0) / sf : null,
    median: median(ppsfs),
    lo: ppsfs.length ? Math.min(...ppsfs) : null,
    hi: ppsfs.length ? Math.max(...ppsfs) : null,
    ppsfs,
    capN: caps.length,
    medianCap: median(caps),
  };
}

/* ---------------------------------------------------------------- leases */

const YEAR = 365.25 * 86400000;

/** WALT, expiries and occupancy from a rent roll, as of `today`. */
export function leaseStats(rows, today = new Date()) {
  if (!rows || !rows.length) return null;
  const t = today.getTime();
  let rent = 0; let rentYears = 0; let sfYears = 0; let leasedSf = 0; let totalSf = 0; let mtmRent = 0;
  let roll12 = 0; let roll24 = 0; let undated = 0; let vacantSf = 0;
  for (const r of rows) {
    if (pos(r.sf)) totalSf += r.sf;
    if (r.vacant) { if (pos(r.sf)) vacantSf += r.sf; continue; }
    if (pos(r.sf)) leasedSf += r.sf;
    const a = pos(r.annual) ? r.annual : 0;
    rent += a;
    if (r.mtm) { mtmRent += a; roll12 += a; roll24 += a; continue; }
    if (!r.end) { undated += a; continue; }
    const yrs = Math.max(0, (new Date(r.end).getTime() - t) / YEAR);
    rentYears += a * yrs;
    if (pos(r.sf)) sfYears += r.sf * yrs;
    if (yrs <= 1) roll12 += a;
    if (yrs <= 2) roll24 += a;
  }
  const datedRent = rent - undated - mtmRent;
  return {
    tenants: rows.filter((r) => !r.vacant).length,
    rent,
    totalSf: totalSf || null,
    leasedSf: leasedSf || null,
    vacantSf,
    occupancy: totalSf ? (leasedSf / totalSf) * 100 : null,
    waltIncome: datedRent + mtmRent > 0 ? rentYears / (datedRent + mtmRent) : null,
    waltSf: leasedSf ? sfYears / leasedSf : null,
    avgRentPsf: leasedSf && rent ? rent / leasedSf : null,
    roll12Pct: rent ? (roll12 / rent) * 100 : null,
    roll24Pct: rent ? (roll24 / rent) * 100 : null,
    undatedRent: undated,
  };
}

/** Years remaining on a single lease, from text like "9.3 Years" or a date like "January 31, 2036". */
export function yearsLeft(text, today = new Date()) {
  if (!text) return null;
  const s = String(text);
  const y = /(\d+(?:\.\d+)?)\s*(?:years?|yrs?)/i.exec(s);
  if (y) return Number(y[1]);
  const d = Date.parse(s.replace(/(\d)(st|nd|rd|th)\b/, '$1'));
  if (Number.isFinite(d)) return Math.max(0, (d - today.getTime()) / YEAR);
  return null;
}

/* ------------------------------------------------------------- the deal */

/**
 * Everything worked out from a deal's inputs.
 * `d` holds the deal's figures (see Deal screen), `comps` is compBasis() of the sale comps or null.
 */
export function analyze(d, comps = null, today = new Date()) {
  const m = { derived: {}, checks: [], questions: [] };

  // price, NOI and cap rate: any two give the third, and a derived one is marked
  let price = pos(d.price) ? d.price : null;
  let noi = ok(d.noi) ? d.noi : null;
  const capStated = pos(d.cap) ? d.cap : null;
  if (price === null && noi !== null && capStated) { price = noi / (capStated / 100); m.derived.price = true; }
  if (noi === null && price !== null && capStated) { noi = price * capStated / 100; m.derived.noi = true; }
  m.price = price;
  m.noi = noi;
  m.capCalc = price && noi !== null ? (noi / price) * 100 : null;
  m.cap = m.capCalc ?? capStated;

  m.ppsf = div(price, d.bsf);
  m.perUnit = div(price, d.units);
  m.perLandSf = div(price, d.lot_sf);
  m.noiPsf = div(noi, d.bsf);
  m.grossMultiple = div(price, d.gross);
  m.expenseRatio = pos(d.opex) && pos(d.gross) ? (d.opex / d.gross) * 100 : null;
  m.opexPsf = div(d.opex, d.bsf);
  m.taxPsf = div(d.taxes, d.bsf);
  m.age = pos(d.year) ? today.getFullYear() - d.year : null;
  m.leases = leaseStats(d.rentRoll, today);
  // a lease expiration date counts down from today; "9.3 years remaining" was true when the OM was printed
  m.termLeft = yearsLeft(d.lease_exp, today) ?? yearsLeft(d.term_left, today);
  // occupancy as the OM states it, else as the rent roll adds up
  if (ok(d.occ) && d.occ >= 0 && d.occ <= 100) { m.occ = d.occ; m.occSource = 'om'; } else if (m.leases && ok(m.leases.occupancy)) { m.occ = m.leases.occupancy; m.occSource = 'rent roll'; } else { m.occ = null; m.occSource = null; }

  // financing as entered
  const L = d.loan || {};
  m.loan = pos(price) && pos(L.ltv) ? price * L.ltv / 100 : null;
  m.debtService = m.loan ? debtService(m.loan, L.rate, L.amort, L.io) : null;
  m.dscr = div(noi, m.debtService);
  m.debtYield = m.loan && noi !== null ? (noi / m.loan) * 100 : null;
  m.cashFlow = noi !== null && m.debtService !== null ? noi - m.debtService : null;
  m.closing = pos(price) && ok(L.closing) ? price * L.closing / 100 : 0;
  m.equity = pos(price) ? price - (m.loan || 0) + m.closing : null;
  m.cashOnCash = m.cashFlow !== null && pos(m.equity) ? (m.cashFlow / m.equity) * 100 : null;
  // Break-even occupancy is expenses plus debt service over the income the
  // property would earn fully let. With the OM's gross potential rent that is
  // exact; with only effective income it is estimated by scaling EGI up from
  // the occupancy it was earned at; with neither occupancy nor GPR it can only
  // be stated as a share of current income, and is labelled so.
  const cost = ok(d.opex) && m.debtService !== null ? d.opex + m.debtService : null;
  m.breakEven = null;
  m.breakEvenBasis = null;
  if (cost !== null && pos(d.gpr)) { m.breakEven = (cost / d.gpr) * 100; m.breakEvenBasis = 'gpr'; } else if (cost !== null && pos(d.gross)) {
    const ratio = (cost / d.gross) * 100;
    if (pos(m.occ)) { m.breakEven = ratio * (m.occ / 100); m.breakEvenBasis = 'egi-occ'; } else { m.breakEven = ratio; m.breakEvenBasis = 'egi'; }
  }
  m.maxLoan = sizeLoan({ price, noi, ltv: L.ltv, dscr: L.minDscr, dy: L.minDy, rate: L.rate, amort: L.amort, io: L.io });

  // a ladder of cap rates around the one in hand
  const mid = m.cap ? Math.round(m.cap * 4) / 4 : null;
  m.ladder = noi !== null && noi > 0 && mid ? [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1].map((s) => {
    const c = mid + s;
    if (c <= 0) return null;
    const v = noi / (c / 100);
    return { cap: c, value: v, ppsf: div(v, d.bsf), vsAsk: price ? (v / price - 1) * 100 : null };
  }).filter(Boolean) : [];

  // against the comps
  if (comps && comps.n) {
    m.vsWeighted = m.ppsf && comps.weighted ? (m.ppsf / comps.weighted - 1) * 100 : null;
    m.vsMedian = m.ppsf && comps.median ? (m.ppsf / comps.median - 1) * 100 : null;
    m.percentile = m.ppsf ? (comps.ppsfs.filter((x) => x <= m.ppsf).length / comps.ppsfs.length) * 100 : null;
    m.valueAtWeighted = pos(d.bsf) && comps.weighted ? d.bsf * comps.weighted : null;
    m.valueAtMedianCap = noi !== null && noi > 0 && comps.medianCap ? noi / (comps.medianCap / 100) : null;
    m.thinCaps = comps.capN > 0 && comps.capN < 3;
  }

  checksAndQuestions(d, m, comps);
  return m;
}

const pct1 = (x) => `${x.toFixed(1)}%`;
const pct2 = (x) => `${x.toFixed(2)}%`;
const usd = (x) => `$${Math.round(x).toLocaleString('en-US')}`;

/* The OM's own figures checked against each other, and the questions they raise.
 * Each check names the two numbers that disagree; each question says why it is asked. */
function checksAndQuestions(d, m, comps) {
  const C = m.checks;
  const Q = m.questions;

  if (m.capCalc !== null && pos(d.cap) && Math.abs(m.capCalc - d.cap) >= 0.1) {
    C.push({ level: 'warn', text: `The OM states a ${pct2(d.cap)} cap rate, but its NOI over its price is ${pct2(m.capCalc)}: ${Math.abs(m.capCalc - d.cap).toFixed(2)} points apart. Neither figure has been changed.` });
    Q.push('Which NOI is the stated cap rate on: in-place, Year 1 or pro forma? And is it before or after reserves?');
  }
  if (pos(d.price_psf) && m.ppsf && Math.abs(d.price_psf / m.ppsf - 1) > 0.02) {
    C.push({ level: 'info', text: `The OM's $${d.price_psf.toFixed(2)}/SF implies ${usd(m.price / d.price_psf).slice(1)} SF, not the ${usd(d.bsf).slice(1)} SF used here.` });
    Q.push('Which square footage is the $/SF on: rentable, gross or the building\'s above-grade area?');
  }
  if (pos(d.price_unit) && m.perUnit && Math.abs(d.price_unit / m.perUnit - 1) > 0.02) {
    C.push({ level: 'info', text: `The OM's ${usd(d.price_unit)} per unit doesn't match price over ${d.units} units (${usd(m.perUnit)}).` });
  }
  if (m.leases && ok(m.leases.occupancy) && pos(d.occ) && Math.abs(m.leases.occupancy - d.occ) > 2) {
    C.push({ level: 'info', text: `The rent roll is ${pct1(m.leases.occupancy)} leased by SF; the OM says ${pct1(d.occ)}.` });
  }
  if (m.leases && m.leases.totalSf && pos(d.bsf) && Math.abs(m.leases.totalSf / d.bsf - 1) > 0.03) {
    C.push({ level: 'info', text: `The rent roll adds to ${usd(m.leases.totalSf).slice(1)} SF; the building is ${usd(d.bsf).slice(1)} SF.` });
  }
  if (m.noi !== null && pos(d.gross) && m.noi > d.gross) {
    C.push({ level: 'error', text: 'NOI is larger than gross income, so one of the two was read wrong. Check both.' });
  }
  if (pos(d.noi_pf) && pos(m.noi) && d.noi_pf / m.noi > 1.1) {
    C.push({ level: 'info', text: `Pro forma NOI is ${pct1((d.noi_pf / m.noi - 1) * 100)} above in-place.` });
    Q.push('What supports the pro forma: signed leases, or market rents on vacant space and rollover? How long to get there?');
  }
  if (m.expenseRatio !== null && m.expenseRatio < 12 && !/nnn|net/i.test(d.lease_type || '')) {
    C.push({ level: 'info', text: `Expenses are ${pct1(m.expenseRatio)} of gross income, which is light unless tenants pay them.` });
    Q.push('Are the tenants on net leases? If not, what is missing from the expenses: management, reserves, insurance?');
  }

  if (!pos(d.price)) Q.push('Is there a price expectation or a call-for-offers date, and has the seller had offers?');
  if (!pos(d.opex) && !/nnn|absolute/i.test(d.lease_type || '')) Q.push('Can we have the trailing-12 operating statement and this year\'s budget?');
  if (m.leases) {
    if (m.leases.roll24Pct >= 25) {
      Q.push(`${pct1(m.leases.roll24Pct)} of rent expires within two years: where are renewal talks, and what are the options?`);
    }
    if (m.leases.vacantSf > 0) Q.push(`${usd(m.leases.vacantSf).slice(1)} SF is vacant: how long, at what asking rent, and with what TI and commission budget?`);
    if (m.leases.undatedRent > 0) Q.push('Some leases show no expiration date: are they month-to-month?');
  }
  if (m.termLeft !== null && m.termLeft < 5) {
    Q.push(`About ${m.termLeft.toFixed(1)} years remain on the lease: has the tenant said anything about renewing, and what would re-tenanting cost?`);
  }
  if (d.guarantor && !/corporate|parent|investment grade/i.test(d.guarantor)) {
    Q.push(`The guarantor is "${d.guarantor}": what are its financials?`);
  }
  if (m.age !== null && m.age >= 40) {
    Q.push(`Built ${d.year}: roof, HVAC, electrical and plumbing ages, and any capital work done since?${d.year < 1978 ? ' Any asbestos or lead-paint surveys?' : ''}`);
  }
  if (pos(d.taxes) || pos(d.price)) Q.push('What is the current assessment, and does a sale at this price trigger a reassessment?');
  if (comps && comps.n && m.vsWeighted !== null && m.vsWeighted > 10) {
    Q.push(`Priced ${pct1(m.vsWeighted)} above the sold comps by $/SF: what justifies the premium?`);
  }
  if (m.thinCaps && m.valueAtMedianCap) {
    C.push({ level: 'info', text: `Only ${comps.capN} sale comp${comps.capN === 1 ? ' reports' : 's report'} a cap rate, so the value at the comps' cap rate rests on ${comps.capN === 1 ? 'that one sale' : 'those two sales'}.` });
  }
  if (pos(d.gpr) && pos(d.gross) && d.gross > d.gpr * 1.15) {
    C.push({ level: 'info', text: `Effective gross income (${usd(d.gross)}) is well above gross potential rent (${usd(d.gpr)}): expense reimbursements and other income, or a misread. Check both.` });
  }
  if (m.noi !== null && m.noi <= 0) {
    C.push({ level: 'warn', text: 'NOI is zero or negative, so there is no cap rate, debt coverage or value at a cap rate to work out.' });
  }
  if (m.dscr !== null && m.dscr < 1.25) {
    C.push({ level: 'warn', text: `At these loan terms the debt-service coverage is ${m.dscr.toFixed(2)}x, below the 1.25x most lenders want.` });
  }
}

/* ------------------------------------------------- hold-period returns */

/**
 * Internal rate of return of yearly cash flows (flows[0] at time zero), as a
 * percent. Null when there is no sign change, so no rate can exist, or when
 * no rate between -99% and +1,000% balances them. Bisection on the NPV: slow
 * next to Newton's method, but it cannot wander off on an odd cash flow.
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

/** The assumptions a scenario starts from: the deal as it stands, plus hold-period defaults. */
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
 */
export function runScenario(d, m, over = {}, { noiSeries = null } = {}) {
  const base = scenarioBase(d, m);
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

/** Deterministic answers to the questions a buyer asks of a scenario. */
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
