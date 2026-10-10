/* engine/figures.js -- every figure the deal analysis works out, registered
 * with what it reads (engine/graph.js), and the checks and questions it raises.
 * analyze() in deal.js evaluates them in this order. The arithmetic is the
 * same as before it was split up (4.3.1): tests/analyze-golden.test.js holds
 * every result on 600-odd deals to the last digit.
 *
 * Reads: `d.<key>` is a deal figure as entered, `loan.<key>` a loan term,
 * `comps.<key>` the sale comps' basis (compBasis), `today` the date the
 * analysis is for; a bare id is another figure. Conventions as deal.js:
 * money in dollars, rates as percent numbers, areas in SF, terms in years. */

import { registry } from './graph.js';
import { debtService, sizeLoan } from './debt.js';
import { walt } from './walt.js';
import { breakEvenOccupancy } from './breakeven.js';

const ok = (x) => typeof x === 'number' && Number.isFinite(x);
const pos = (x) => ok(x) && x > 0;
const div = (a, b) => (ok(a) && pos(b) ? a / b : null);

/* ---------------------------------------------------------------- leases */

const YEAR = 365.25 * 86400000;

/**
 * WALT, expiries and occupancy from a rent roll, as of `asOf` (the rent
 * roll's as-of date; a Date, ISO text or day). WALT is the engine's one
 * definition (engine/walt.js): month-to-month and undated leases left out
 * unless the convention says otherwise.
 */
export function leaseStats(rows, asOf = new Date()) {
  if (!rows || !rows.length) return null;
  const at = asOf instanceof Date ? asOf : new Date(String(asOf).length === 10 ? `${asOf}T00:00:00Z` : asOf);
  const t = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  let rent = 0; let leasedSf = 0; let totalSf = 0;
  let roll12 = 0; let roll24 = 0; let undated = 0; let vacantSf = 0;
  for (const r of rows) {
    if (pos(r.sf)) totalSf += r.sf;
    if (r.vacant) { if (pos(r.sf)) vacantSf += r.sf; continue; }
    if (pos(r.sf)) leasedSf += r.sf;
    const a = pos(r.annual) ? r.annual : 0;
    rent += a;
    if (r.mtm) { roll12 += a; roll24 += a; continue; }
    if (!r.end) { undated += a; continue; }
    const yrs = Math.max(0, (new Date(r.end).getTime() - t) / YEAR);
    if (yrs <= 1) roll12 += a;
    if (yrs <= 2) roll24 += a;
  }
  const w = walt(rows, { asOf: new Date(t) });
  return {
    tenants: rows.filter((r) => !r.vacant).length,
    rent,
    totalSf: totalSf || null,
    leasedSf: leasedSf || null,
    vacantSf,
    occupancy: totalSf ? (leasedSf / totalSf) * 100 : null,
    waltIncome: w.income,
    waltSf: w.sf,
    walt: w.headline,
    waltWeight: w.weight,
    waltMtm: w.mtm,
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

/* ----------------------------------------------------------- the figures */

export const FIGURES = registry('Deal figures');
const fig = FIGURES.add;

// price, NOI and cap rate: any two give the third, and a derived one is marked
// a price is worked out from the cap rate only from a positive NOI; from zero or a loss it would be meaningless (or negative)
fig('price', { label: 'Price', unit: '$', reads: ['d.price', { path: 'd.noi', when: 'only when no price is entered' }, { path: 'd.cap', when: 'only when no price is entered' }] }, (m, { d }) => {
  if (pos(d.price)) return d.price;
  const noi = ok(d.noi) ? d.noi : null;
  const capStated = pos(d.cap) ? d.cap : null;
  return noi !== null && capStated && noi > 0 ? noi / (capStated / 100) : null;
});
fig('noi', { label: 'NOI', unit: '$', reads: ['d.noi', { path: 'price', when: 'only when no NOI is entered' }, { path: 'd.cap', when: 'only when no NOI is entered' }] }, (m, { d }) => {
  if (ok(d.noi)) return d.noi;
  const capStated = pos(d.cap) ? d.cap : null;
  return m.price !== null && capStated ? m.price * capStated / 100 : null;
});
fig('capCalc', { label: 'Cap rate (NOI ÷ price)', unit: '%', reads: ['price', 'noi'] }, (m) => (m.price && m.noi !== null ? (m.noi / m.price) * 100 : null));
fig('cap', { label: 'Cap rate', unit: '%', reads: ['capCalc', { path: 'd.cap', when: 'only when NOI ÷ price can’t be worked out' }] }, (m, { d }) => m.capCalc ?? (pos(d.cap) ? d.cap : null));

fig('ppsf', { label: 'Price per SF', unit: '$/SF', reads: ['price', 'd.bsf'] }, (m, { d }) => div(m.price, d.bsf));
fig('perUnit', { label: 'Price per unit', unit: '$/unit', reads: ['price', 'd.units'] }, (m, { d }) => div(m.price, d.units));
fig('perLandSf', { label: 'Price per land SF', unit: '$/SF', reads: ['price', 'd.lot_sf'] }, (m, { d }) => div(m.price, d.lot_sf));
fig('noiPsf', { label: 'NOI per SF', unit: '$/SF', reads: ['noi', 'd.bsf'] }, (m, { d }) => div(m.noi, d.bsf));
fig('grossMultiple', { label: 'Gross income multiple', unit: 'x', reads: ['price', 'd.gross'] }, (m, { d }) => div(m.price, d.gross));
fig('expenseRatio', { label: 'Expense ratio', unit: '%', reads: ['d.opex', 'd.gross'] }, (m, { d }) => (pos(d.opex) && pos(d.gross) ? (d.opex / d.gross) * 100 : null));
fig('opexPsf', { label: 'Expenses per SF', unit: '$/SF', reads: ['d.opex', 'd.bsf'] }, (m, { d }) => div(d.opex, d.bsf));
fig('taxPsf', { label: 'Taxes per SF', unit: '$/SF', reads: ['d.taxes', 'd.bsf'] }, (m, { d }) => div(d.taxes, d.bsf));
fig('age', { label: 'Age', unit: 'years', reads: ['d.year', 'today'] }, (m, { d, today }) => (pos(d.year) ? today.getFullYear() - d.year : null));
// measured from the rent roll's own as-of date when it has one, as the Rent roll tab is
fig('leases', { label: 'Rent roll figures', unit: 'record', reads: ['d.rentRoll', 'd.rentRollAsOf', { path: 'today', when: 'only when the rent roll has no as-of date' }] }, (m, { d, today }) => leaseStats(d.rentRoll, d.rentRollAsOf || today));
// a lease expiration date counts down from today; "9.3 years remaining" was true when the OM was printed
fig('termLeft', { label: 'Years left on the lease', unit: 'years', reads: ['d.lease_exp', { path: 'd.term_left', when: 'only when the lease expiration gives no answer' }, 'today'] }, (m, { d, today }) => yearsLeft(d.lease_exp, today) ?? yearsLeft(d.term_left, today));
// occupancy as the OM states it, else as the rent roll adds up
const omOcc = (d) => ok(d.occ) && d.occ >= 0 && d.occ <= 100;
fig('occ', { label: 'Occupancy', unit: '%', reads: ['d.occ', { path: 'leases', when: 'only when the OM gives no occupancy' }] }, (m, { d }) => (omOcc(d) ? d.occ : m.leases && ok(m.leases.occupancy) ? m.leases.occupancy : null));
fig('occSource', { label: 'Where occupancy comes from', unit: 'text', reads: ['d.occ', 'leases'] }, (m, { d }) => (omOcc(d) ? 'om' : m.leases && ok(m.leases.occupancy) ? 'rent roll' : null));

// financing as entered
fig('loan', { label: 'Loan amount', unit: '$', reads: ['price', 'loan.ltv'] }, (m, { loan: L }) => (pos(m.price) && pos(L.ltv) ? m.price * L.ltv / 100 : null));
fig('debtService', { label: 'Annual debt service', unit: '$', reads: ['loan', 'loan.rate', 'loan.amort', 'loan.io'] }, (m, { loan: L }) => (m.loan ? debtService(m.loan, L.rate, L.amort, L.io) : null));
fig('dscr', { label: 'DSCR', unit: 'x', reads: ['noi', 'debtService'] }, (m) => div(m.noi, m.debtService));
fig('debtYield', { label: 'Debt yield', unit: '%', reads: ['loan', 'noi'] }, (m) => (m.loan && m.noi !== null ? (m.noi / m.loan) * 100 : null));
fig('cashFlow', { label: 'Cash flow after debt service', unit: '$', reads: ['noi', 'debtService'] }, (m) => (m.noi !== null && m.debtService !== null ? m.noi - m.debtService : null));
fig('closing', { label: 'Closing costs', unit: '$', reads: ['price', 'loan.closing'] }, (m, { loan: L }) => (pos(m.price) && ok(L.closing) ? m.price * L.closing / 100 : 0));
fig('equity', { label: 'Equity needed', unit: '$', reads: ['price', 'loan', 'closing'] }, (m) => (pos(m.price) ? m.price - (m.loan || 0) + m.closing : null));
fig('cashOnCash', { label: 'Cash-on-cash', unit: '%', reads: ['cashFlow', 'equity'] }, (m) => (m.cashFlow !== null && pos(m.equity) ? (m.cashFlow / m.equity) * 100 : null));
// Break-even occupancy is expenses plus debt service over the income the
// property would earn fully let. With the OM's gross potential rent that is
// exact; with only effective income it is estimated by scaling EGI up from
// the occupancy it was earned at; with neither occupancy nor GPR it can only
// be stated as a share of current income, and is labelled so.
const breakEven = (m, d) => (m.debtService !== null ? breakEvenOccupancy({ gpr: d.gpr, gross: d.gross, occ: m.occ, opex: d.opex, debtService: m.debtService }) : null);
const BE_READS = ['debtService', 'd.gpr', 'd.gross', 'occ', 'd.opex'];
fig('breakEven', { label: 'Break-even occupancy', unit: '%', reads: BE_READS }, (m, { d }) => { const be = breakEven(m, d); return be ? be.value : null; });
fig('breakEvenBasis', { label: 'How break-even occupancy was worked out', unit: 'text', reads: BE_READS }, (m, { d }) => { const be = breakEven(m, d); return be ? be.basis : null; });
fig('maxLoan', { label: 'Largest loan it supports', unit: 'record', reads: ['price', 'noi', 'loan.ltv', 'loan.minDscr', 'loan.minDy', 'loan.rate', 'loan.amort', 'loan.io'] },
  (m, { loan: L }) => sizeLoan({ price: m.price, noi: m.noi, ltv: L.ltv, dscr: L.minDscr, dy: L.minDy, rate: L.rate, amort: L.amort, io: L.io }));

// a ladder of cap rates around the one in hand
fig('ladder', { label: 'Value across cap rates', unit: 'table', reads: ['cap', 'noi', 'd.bsf', 'price'] }, (m, { d }) => {
  const mid = m.cap ? Math.round(m.cap * 4) / 4 : null;
  const noi = m.noi;
  return noi !== null && noi > 0 && mid ? [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1].map((s) => {
    const c = mid + s;
    if (c <= 0) return null;
    const v = noi / (c / 100);
    return { cap: c, value: v, ppsf: div(v, d.bsf), vsAsk: m.price ? (v / m.price - 1) * 100 : null };
  }).filter(Boolean) : [];
});

// against the comps: only when there are sale comps
const withComps = ({ comps }) => !!(comps && comps.n);
fig('vsWeighted', { label: 'Price per SF against the comps (weighted)', unit: '%', only: withComps, reads: ['ppsf', 'comps.weighted'] }, (m, { comps }) => (m.ppsf && comps.weighted ? (m.ppsf / comps.weighted - 1) * 100 : null));
fig('vsMedian', { label: 'Price per SF against the comps (median)', unit: '%', only: withComps, reads: ['ppsf', 'comps.median'] }, (m, { comps }) => (m.ppsf && comps.median ? (m.ppsf / comps.median - 1) * 100 : null));
fig('percentile', { label: 'Price per SF percentile among the comps', unit: '%', only: withComps, reads: ['ppsf', 'comps.ppsfs'] }, (m, { comps }) => (m.ppsf ? (comps.ppsfs.filter((x) => x <= m.ppsf).length / comps.ppsfs.length) * 100 : null));
fig('valueAtWeighted', { label: 'Value at the comps’ weighted $/SF', unit: '$', only: withComps, reads: ['d.bsf', 'comps.weighted'] }, (m, { d, comps }) => (pos(d.bsf) && comps.weighted ? d.bsf * comps.weighted : null));
fig('valueAtMedianCap', { label: 'Value at the comps’ median cap rate', unit: '$', only: withComps, reads: ['noi', 'comps.medianCap'] }, (m, { comps }) => (m.noi !== null && m.noi > 0 && comps.medianCap ? m.noi / (comps.medianCap / 100) : null));
fig('thinCaps', { label: 'Few comps report a cap rate', unit: 'flag', only: withComps, reads: ['comps.capN'] }, (m, { comps }) => comps.capN > 0 && comps.capN < 3);

// which of price and NOI were worked out from the other figures, not entered
fig('derived', { label: 'Figures worked out from the others', unit: 'record', reads: ['d.price', 'price', 'd.noi', 'noi'] }, (m, { d }) => {
  const o = {};
  if (!pos(d.price) && m.price !== null) o.price = true;
  if (!ok(d.noi) && m.noi !== null) o.noi = true;
  return o;
});

/* ------------------------------------------- what doesn't add up, and asks */

const pct1 = (x) => `${x.toFixed(1)}%`;
const pct2 = (x) => `${x.toFixed(2)}%`;
const usd = (x) => `$${Math.round(x).toLocaleString('en-US')}`;

/* The OM's own figures checked against each other, and the questions they raise.
 * Each check names the two numbers that disagree; each question says why it is asked.
 * A rule is called with (m, inputs, C, Q) and pushes onto the checks C and questions Q. */
export const RULES = registry('Checks and questions', { after: FIGURES });
const rule = (id, label, reads, calc) => RULES.add(id, { label, unit: 'check', reads }, calc);

rule('noPriceFromLoss', 'No price from a zero or negative NOI', ['d.price', 'd.noi', 'd.cap'], (m, { d }, C) => {
  if (pos(d.price)) return;
  const noi = ok(d.noi) ? d.noi : null;
  const capStated = pos(d.cap) ? d.cap : null;
  if (!pos(d.price) && noi !== null && capStated && noi <= 0) {
    C.push({ level: 'warn', text: `The NOI is ${noi === 0 ? 'zero' : 'negative'} (${noi < 0 ? '-' : ''}$${Math.round(Math.abs(noi)).toLocaleString('en-US')}), so no price is worked out from the stated ${pct2(capStated)} cap rate.` });
  }
});
rule('statedCap', 'Stated cap rate against NOI ÷ price', ['capCalc', 'd.cap'], (m, { d }, C, Q) => {
  if (m.capCalc !== null && pos(d.cap) && Math.abs(m.capCalc - d.cap) >= 0.1) {
    C.push({ level: 'warn', text: `The OM states a ${pct2(d.cap)} cap rate, but its NOI over its price is ${pct2(m.capCalc)}: ${Math.abs(m.capCalc - d.cap).toFixed(2)} points apart. Neither figure has been changed.` });
    Q.push('Which NOI is the stated cap rate on: in-place, Year 1 or pro forma? And is it before or after reserves?');
  }
});
rule('priceSf', 'The OM’s $/SF against price ÷ SF', ['d.price_psf', 'ppsf', 'price', 'd.bsf'], (m, { d }, C, Q) => {
  if (pos(d.price_psf) && m.ppsf && Math.abs(d.price_psf / m.ppsf - 1) > 0.02) {
    C.push({ level: 'info', text: `The OM's $${d.price_psf.toFixed(2)}/SF implies ${usd(m.price / d.price_psf).slice(1)} SF, not the ${usd(d.bsf).slice(1)} SF used here.` });
    Q.push('Which square footage is the $/SF on: rentable, gross or the building\'s above-grade area?');
  }
});
rule('priceUnit', 'The OM’s price per unit against price ÷ units', ['d.price_unit', 'perUnit', 'd.units'], (m, { d }, C) => {
  if (pos(d.price_unit) && m.perUnit && Math.abs(d.price_unit / m.perUnit - 1) > 0.02) {
    C.push({ level: 'info', text: `The OM's ${usd(d.price_unit)} per unit doesn't match price over ${d.units} units (${usd(m.perUnit)}).` });
  }
});
rule('rentRollOcc', 'Rent roll occupancy against the OM’s', ['leases', 'd.occ'], (m, { d }, C) => {
  if (m.leases && ok(m.leases.occupancy) && pos(d.occ) && Math.abs(m.leases.occupancy - d.occ) > 2) {
    C.push({ level: 'info', text: `The rent roll is ${pct1(m.leases.occupancy)} leased by SF; the OM says ${pct1(d.occ)}.` });
  }
});
rule('rentRollSf', 'Rent roll SF against the building’s', ['leases', 'd.bsf'], (m, { d }, C) => {
  if (m.leases && m.leases.totalSf && pos(d.bsf) && Math.abs(m.leases.totalSf / d.bsf - 1) > 0.03) {
    C.push({ level: 'info', text: `The rent roll adds to ${usd(m.leases.totalSf).slice(1)} SF; the building is ${usd(d.bsf).slice(1)} SF.` });
  }
});
rule('noiOverGross', 'NOI larger than gross income', ['noi', 'd.gross'], (m, { d }, C) => {
  if (m.noi !== null && pos(d.gross) && m.noi > d.gross) {
    C.push({ level: 'error', text: 'NOI is larger than gross income, so one of the two was read wrong. Check both.' });
  }
});
rule('proForma', 'Pro forma NOI well above in-place', ['d.noi_pf', 'noi'], (m, { d }, C, Q) => {
  if (pos(d.noi_pf) && pos(m.noi) && d.noi_pf / m.noi > 1.1) {
    C.push({ level: 'info', text: `Pro forma NOI is ${pct1((d.noi_pf / m.noi - 1) * 100)} above in-place.` });
    Q.push('What supports the pro forma: signed leases, or market rents on vacant space and rollover? How long to get there?');
  }
});
rule('lightExpenses', 'Light expenses on a lease that isn’t net', ['expenseRatio', 'd.lease_type'], (m, { d }, C, Q) => {
  if (m.expenseRatio !== null && m.expenseRatio < 12 && !/nnn|net/i.test(d.lease_type || '')) {
    C.push({ level: 'info', text: `Expenses are ${pct1(m.expenseRatio)} of gross income, which is light unless tenants pay them.` });
    Q.push('Are the tenants on net leases? If not, what is missing from the expenses: management, reserves, insurance?');
  }
});
rule('noPrice', 'No price', ['d.price'], (m, { d }, C, Q) => {
  if (!pos(d.price)) Q.push('Is there a price expectation or a call-for-offers date, and has the seller had offers?');
});
rule('noOpex', 'No operating expenses', ['d.opex', 'd.lease_type'], (m, { d }, C, Q) => {
  if (!pos(d.opex) && !/nnn|absolute/i.test(d.lease_type || '')) Q.push('Can we have the trailing-12 operating statement and this year\'s budget?');
});
rule('rollover', 'Rent expiring within two years', ['leases'], (m, i, C, Q) => {
  if (m.leases && m.leases.roll24Pct >= 25) {
    Q.push(`${pct1(m.leases.roll24Pct)} of rent expires within two years: where are renewal talks, and what are the options?`);
  }
});
rule('vacantSpace', 'Vacant space', ['leases'], (m, i, C, Q) => {
  if (m.leases && m.leases.vacantSf > 0) Q.push(`${usd(m.leases.vacantSf).slice(1)} SF is vacant: how long, at what asking rent, and with what TI and commission budget?`);
});
rule('undatedLeases', 'Leases with no expiration date', ['leases'], (m, i, C, Q) => {
  if (m.leases && m.leases.undatedRent > 0) Q.push('Some leases show no expiration date: are they month-to-month?');
});
rule('shortTerm', 'Under five years left on the lease', ['termLeft'], (m, i, C, Q) => {
  if (m.termLeft !== null && m.termLeft < 5) {
    Q.push(`About ${m.termLeft.toFixed(1)} years remain on the lease: has the tenant said anything about renewing, and what would re-tenanting cost?`);
  }
});
rule('guarantor', 'A guarantor that isn’t a corporate parent', ['d.guarantor'], (m, { d }, C, Q) => {
  if (d.guarantor && !/corporate|parent|investment grade/i.test(d.guarantor)) {
    Q.push(`The guarantor is "${d.guarantor}": what are its financials?`);
  }
});
rule('oldBuilding', 'A building 40 years old or more', ['age', 'd.year'], (m, { d }, C, Q) => {
  if (m.age !== null && m.age >= 40) {
    Q.push(`Built ${d.year}: roof, HVAC, electrical and plumbing ages, and any capital work done since?${d.year < 1978 ? ' Any asbestos or lead-paint surveys?' : ''}`);
  }
});
rule('assessment', 'The tax assessment on a sale', ['d.taxes', 'd.price'], (m, { d }, C, Q) => {
  if (pos(d.taxes) || pos(d.price)) Q.push('What is the current assessment, and does a sale at this price trigger a reassessment?');
});
rule('premium', 'Priced well above the comps', ['comps.n', 'vsWeighted'], (m, { comps }, C, Q) => {
  if (comps && comps.n && m.vsWeighted !== null && m.vsWeighted > 10) {
    Q.push(`Priced ${pct1(m.vsWeighted)} above the sold comps by $/SF: what justifies the premium?`);
  }
});
rule('fewCompCaps', 'Value at the comps’ cap rate rests on one or two sales', ['thinCaps', 'valueAtMedianCap', 'comps.capN'], (m, { comps }, C) => {
  if (m.thinCaps && m.valueAtMedianCap) {
    C.push({ level: 'info', text: `Only ${comps.capN} sale comp${comps.capN === 1 ? ' reports' : 's report'} a cap rate, so the value at the comps' cap rate rests on ${comps.capN === 1 ? 'that one sale' : 'those two sales'}.` });
  }
});
rule('egiAboveGpr', 'Effective gross income well above potential rent', ['d.gpr', 'd.gross'], (m, { d }, C) => {
  if (pos(d.gpr) && pos(d.gross) && d.gross > d.gpr * 1.15) {
    C.push({ level: 'info', text: `Effective gross income (${usd(d.gross)}) is well above gross potential rent (${usd(d.gpr)}): expense reimbursements and other income, or a misread. Check both.` });
  }
});
rule('noNoi', 'NOI zero or negative', ['noi'], (m, i, C) => {
  if (m.noi !== null && m.noi <= 0) {
    C.push({ level: 'warn', text: 'NOI is zero or negative, so there is no cap rate, debt coverage or value at a cap rate to work out.' });
  }
});
rule('thinDscr', 'Debt-service coverage below 1.25x', ['dscr'], (m, i, C) => {
  if (m.dscr !== null && m.dscr < 1.25) {
    C.push({ level: 'warn', text: `At these loan terms the debt-service coverage is ${m.dscr.toFixed(2)}x, below the 1.25x most lenders want.` });
  }
});

/* ------------------------------------------------------------ evaluation */

/**
 * Everything worked out from a deal's inputs: every registered figure, in
 * order, then every check and question. `d` holds the deal's figures (see
 * Deal screen), `comps` is compBasis() of the sale comps or null.
 */
export function evaluate(d, comps, today) {
  const m = { derived: {}, checks: [], questions: [] };
  const x = { d, loan: d.loan || {}, comps, today };
  for (const F of FIGURES.list) if (!F.only || F.only(x)) m[F.id] = F.calc(m, x);
  for (const R of RULES.list) R.calc(m, x, m.checks, m.questions);
  return m;
}
