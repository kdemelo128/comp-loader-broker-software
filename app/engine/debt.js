/* engine/debt.js -- loan arithmetic, the one implementation every screen,
 * tool and workbook uses. Payments are monthly over a whole number of months
 * (amortization years × 12, rounded), as lenders amortize and as the
 * amortization schedule has always counted; amounts are shown a year at a
 * time. Rates are percent numbers (6.75 means 6.75%). */

const ok = (x) => typeof x === 'number' && Number.isFinite(x);
const pos = (x) => ok(x) && x > 0;

/**
 * The number of monthly payments in an amortization of `years`.
 * @type {(years: Years) => Months | null}
 */
export const amortMonths = (years) => (pos(years) ? Math.round(years * 12) : null);

/**
 * The level monthly payment on `loan` at `ratePct` over `months` payments.
 * @param {Usd} loan @param {Pct} ratePct @param {Months} months @returns {UsdPerMonth | null}
 */
export function monthlyPayment(loan, ratePct, months) {
  if (!pos(loan) || !ok(ratePct) || ratePct < 0 || !pos(months)) return null;
  const i = ratePct / 100 / 12;
  return i === 0 ? loan / months : (loan * i) / (1 - (1 + i) ** -months);
}

/**
 * Annual debt service: amortizing, or interest only.
 * @param {Usd} loan @param {Pct} ratePct @param {Years} amortYears @param {boolean} [io] @returns {UsdPerYear | null}
 */
export function debtService(loan, ratePct, amortYears, io = false) {
  if (!pos(loan) || !ok(ratePct) || ratePct < 0) return null;
  if (io) return loan * (ratePct / 100);
  const p = monthlyPayment(loan, ratePct, amortMonths(amortYears));
  return p === null ? null : p * 12;
}

/**
 * Debt service per dollar of loan, a year: the loan constant. Null when the terms are incomplete.
 * @type {(ratePct: Pct, amortYears: Years, io?: boolean) => Fraction | null}
 */
export const loanConstant = (ratePct, amortYears, io = false) => {
  const ds = debtService(1e6, ratePct, amortYears, io);
  return ds === null ? null : ds / 1e6;
};

/**
 * Balance left after `years` of payments on an amortizing loan (interest only: the whole loan).
 * @param {Usd} loan @param {Pct} ratePct @param {Years} amortYears @param {Years} years @param {boolean} [io] @returns {Usd | null}
 */
export function balanceAfter(loan, ratePct, amortYears, years, io = false) {
  if (!pos(loan) || !ok(ratePct) || ratePct < 0 || !ok(years) || years < 0) return null;
  if (io) return loan;
  const n = amortMonths(amortYears);
  if (!n) return null;
  const i = ratePct / 100 / 12;
  const k = Math.min(n, Math.round(years * 12));
  if (i === 0) return loan * (1 - k / n);
  const pmt = monthlyPayment(loan, ratePct, n);
  return loan * (1 + i) ** k - pmt * (((1 + i) ** k - 1) / i);
}

/**
 * The largest loan the property supports: the least of LTV, DSCR and debt-yield sizing.
 * @param {{ price: Usd, noi: UsdPerYear, ltv: Pct, dscr: Multiple, dy: Pct, rate: Pct, amort: Years, io?: boolean }} terms
 * @returns {{ loan: Usd, binding: string, tests: Record<string, Usd> } | null}
 */
export function sizeLoan({ price, noi, ltv, dscr, dy, rate, amort, io }) {
  /** @type {[string, Usd][]} */
  const out = [];
  if (pos(price) && pos(ltv)) out.push(['LTV', price * ltv / 100]);
  const k = loanConstant(rate, amort, io);
  if (pos(noi) && pos(dscr) && pos(k)) out.push(['DSCR', noi / dscr / k]);
  if (pos(noi) && pos(dy)) out.push(['Debt yield', noi / (dy / 100)]);
  if (!out.length) return null;
  out.sort((a, b) => a[1] - b[1]);
  return { loan: out[0][1], binding: out[0][0], tests: Object.fromEntries(out) };
}
