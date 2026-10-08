/* Known-answer tests for the deal arithmetic. Every expected figure here was
 * worked out independently (a standard mortgage-payment formula and a
 * month-by-month loop in Python), not by running the code under test. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  debtService, loanConstant, balanceAfter, compBasis, leaseStats, yearsLeft, analyze,
  irr, holdReturns, solvePrice, runScenario, scenarioAnswers,
} from '../app/deal.js';
import { quickValue, loanTool, offerTool, netEffectiveRent, exchangeDates } from '../app/tools.js';

const close = (a, b, tol = 0.01, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b}, got ${a}`);
const LOAN = { ltv: 65, rate: 6.75, amort: 30, io: false, closing: 2, minDscr: 1.25, minDy: 8 };
const TODAY = new Date(Date.UTC(2026, 9, 8));

test('the textbook ratios', () => {
  const m = analyze({ price: 12500000, noi: 875000, bsf: 50000, units: 100, loan: LOAN }, null, TODAY);
  close(m.capCalc, 7.0, 1e-9, 'cap rate = NOI / price');
  close(m.ppsf, 250, 1e-9, 'price / SF');
  close(m.perUnit, 125000, 1e-9, 'price / unit');
  close(m.noiPsf, 17.5, 1e-9, 'NOI / SF');
  const v = quickValue({ noi: 875000, cap: 7 });
  close(v.price, 12500000, 1e-6, 'implied value = NOI / cap');
  assert.equal(v.solved, 'price');
});

test('debt service, loan constant and balance', () => {
  close(debtService(1e6, 6, 30) / 12, 5995.51, 0.005, 'monthly payment on $1M at 6%, 30 years');
  close(debtService(1e6, 6, 30), 71946.06, 0.01);
  assert.equal(debtService(1e6, 6, 30, true), 60000, 'interest only');
  close(debtService(1e6, 0, 30), 33333.33, 0.01, 'zero rate: straight-line');
  close(loanConstant(6, 30), 0.07194606, 1e-8);
  close(balanceAfter(1e6, 6, 30, 10), 836857.25, 0.01, 'balance after 10 years');
  close(balanceAfter(1e6, 6, 30, 30), 0, 0.01, 'paid off at term');
  assert.equal(balanceAfter(1e6, 6, 30, 5, true), 1e6, 'interest only: no amortization');
  // incomplete terms are null, never 0 or NaN
  assert.equal(debtService(1e6, 6, null), null);
  assert.equal(debtService(0, 6, 30), null);
  assert.equal(debtService(1e6, -1, 30), null);
  assert.equal(loanConstant(null, 30), null);
  assert.equal(balanceAfter(1e6, 6, null, 5), null);
});

test('a full deal at 65% LTV, 6.75%, 30 years, 2% closing', () => {
  const m = analyze({ price: 12500000, noi: 875000, loan: LOAN }, null, TODAY);
  assert.equal(m.loan, 8125000);
  close(m.debtService, 632383.14, 0.01);
  close(m.dscr, 1.383655, 1e-6, 'DSCR = NOI / debt service');
  close(m.debtYield, 10.769231, 1e-6, 'debt yield = NOI / loan');
  assert.equal(m.equity, 4625000, 'equity = price - loan + closing');
  close(m.cashFlow, 242616.86, 0.01);
  close(m.cashOnCash, 5.24577, 1e-5, 'cash-on-cash = cash flow / equity');
  close(m.maxLoan.tests.DSCR, 8993756.48, 0.01);
  assert.equal(m.maxLoan.tests['Debt yield'], 10937500);
  assert.equal(m.maxLoan.tests.LTV, 8125000);
  assert.equal(m.maxLoan.binding, 'LTV');
});

test('closing costs under 1% are half a percent, not half the price', async () => {
  globalThis.window = globalThis.window || {};
  const { parsePct, parseNum } = await import('../app/kit.js');
  assert.equal(parsePct('0.5', { fraction: false }), 0.5);
  assert.equal(parsePct('0.5%'), 0.5, 'a % sign is taken as printed');
  assert.equal(parsePct('0.065'), 6.5, 'a fraction is a rate where fractions are allowed');
  assert.equal(parsePct('6.25'), 6.25);
  assert.equal(parsePct(''), null);
  assert.equal(parseNum('5.2MM'), 5200000);
  assert.equal(parseNum('$12.5m'), 12500000);
  assert.equal(parseNum('(12,000)'), -12000);
  assert.equal(parseNum('abc'), null);
  const m = analyze({ price: 6450000, noi: 393450, loan: { ...LOAN, closing: 0.5 } }, null, TODAY);
  assert.equal(m.equity, 6450000 - 4192500 + 32250);
});

test('break-even occupancy: over gross potential rent, else scaled from EGI', () => {
  const ds = 632383.14;
  const gpr = analyze({ price: 12500000, noi: 875000, gpr: 1400000, gross: 1330000, opex: 400000, occ: 95, loan: LOAN }, null, TODAY);
  assert.equal(gpr.breakEvenBasis, 'gpr');
  close(gpr.breakEven, 73.741653, 1e-5);
  const est = analyze({ price: 12500000, noi: 875000, gross: 1330000, opex: 400000, occ: 95, loan: LOAN }, null, TODAY);
  assert.equal(est.breakEvenBasis, 'egi-occ');
  close(est.breakEven, ((400000 + ds) / 1330000) * 95, 1e-4, 'EGI earned at 95% occupancy scaled to full');
  const bare = analyze({ price: 12500000, noi: 875000, gross: 1330000, opex: 400000, loan: LOAN }, null, TODAY);
  assert.equal(bare.breakEvenBasis, 'egi');
  close(bare.breakEven, 77.622793, 1e-5);
});

test('the stated cap rate is reconciled, never overwritten', () => {
  const m = analyze({ price: 12500000, noi: 875000, cap: 6.85, loan: LOAN }, null, TODAY);
  close(m.capCalc, 7.0, 1e-9);
  const c = m.checks.find((x) => /states a 6\.85% cap rate/.test(x.text));
  assert.ok(c, 'a discrepancy is reported');
  assert.match(c.text, /7\.00%/);
  assert.match(c.text, /0\.15 points apart/);
  const q = quickValue({ price: 12500000, noi: 875000, cap: 6.85 });
  assert.equal(q.cap, 6.85, 'the typed cap stays');
  close(q.capCalc, 7.0, 1e-9);
  close(q.mismatch, 0.15, 1e-9);
});

test('missing, zero, negative and junk inputs give null, never NaN or Infinity', () => {
  const junk = [undefined, null, 0, -5, NaN, Infinity, -Infinity, '12', '', {}];
  const fields = ['price', 'noi', 'cap', 'bsf', 'units', 'lot_sf', 'gross', 'opex', 'taxes', 'occ', 'gpr', 'year'];
  for (const j of junk) {
    for (const k of fields) {
      const m = analyze({ price: 5e6, noi: 3e5, bsf: 10000, [k]: j, loan: LOAN }, { n: 0 }, TODAY);
      for (const [name, val] of Object.entries(m)) {
        if (typeof val === 'number') assert.ok(Number.isFinite(val), `${k}=${String(j)} made ${name} ${val}`);
      }
      for (const row of m.ladder) for (const val of Object.values(row)) if (typeof val === 'number') assert.ok(Number.isFinite(val));
    }
  }
  const empty = analyze({}, null, TODAY);
  assert.equal(empty.capCalc, null);
  assert.equal(empty.dscr, null);
  assert.equal(empty.breakEven, null);
  assert.deepEqual(empty.ladder, []);
  // a negative NOI is reported, and gets no value at a cap rate
  const neg = analyze({ price: 5e6, noi: -20000, loan: LOAN }, { n: 2, weighted: 500, median: 500, ppsfs: [400, 600], capN: 2, medianCap: 6 }, TODAY);
  assert.deepEqual(neg.ladder, []);
  assert.equal(neg.valueAtMedianCap, null);
  assert.ok(neg.checks.some((c) => /zero or negative/.test(c.text)));
});

test('the comp basis: weighted $/SF is total price over total SF', () => {
  const b = compBasis([{ price: 4e6, bsf: 5000, cap: 6 }, { price: 2.4e6, bsf: 3000 }, { price: 6.625e6, bsf: 8855, cap: 5.25 }, { price: null, bsf: 4000 }]);
  close(b.weighted, 13025000 / 16855, 1e-9);
  assert.equal(b.n, 3, 'an unpriced comp is not counted');
  assert.equal(b.median, 800);
  close(b.medianCap, 5.625, 1e-9);
  const m = analyze({ price: 6450000, noi: 393450, bsf: 12000, loan: LOAN }, b, TODAY);
  close(m.vsWeighted, (537.5 / (13025000 / 16855) - 1) * 100, 1e-9);
  close(m.valueAtWeighted, 12000 * 13025000 / 16855, 1e-6);
  assert.ok(m.checks.some((c) => /Only 2 sale comps report a cap rate/.test(c.text)), 'thin cap-rate evidence is said so');
});

test('WALT and rollover from a rent roll', () => {
  const rows = [
    { tenant: 'A', sf: 2400, annual: 124800, end: '2029-02-28' },
    { tenant: 'B', sf: 1800, annual: 93600, end: '2031-06-30' },
    { tenant: 'Vacant', sf: 1000, vacant: true },
    { tenant: 'C', sf: 4200, annual: 151200, end: '2027-12-31' },
    { tenant: 'D', sf: 2600, annual: 98400, end: '2032-08-31' },
  ];
  const s = leaseStats(rows, TODAY);
  const Y = 365.25 * 86400000;
  const yrs = (d) => (Date.parse(d) - TODAY.getTime()) / Y;
  const walt = (124800 * yrs('2029-02-28') + 93600 * yrs('2031-06-30') + 151200 * yrs('2027-12-31') + 98400 * yrs('2032-08-31')) / 468000;
  close(s.waltIncome, walt, 1e-9);
  close(s.occupancy, 11000 / 12000 * 100, 1e-9);
  close(s.roll24Pct, 151200 / 468000 * 100, 1e-9);
  assert.equal(s.roll12Pct, 0);
  close(s.avgRentPsf, 468000 / 11000, 1e-9);
});

test('the lease clock runs from the expiration date, not the OM\'s printed term', () => {
  const m = analyze({ price: 3280000, noi: 172200, lease_exp: 'January 31, 2036', term_left: '12.0 Years', loan: LOAN }, null, TODAY);
  close(m.termLeft, (Date.parse('January 31, 2036') - TODAY.getTime()) / (365.25 * 86400000), 1e-9);
  assert.equal(yearsLeft('9.3 Years'), 9.3);
});

test('the Tools calculators', () => {
  const l = loanTool({ price: 12500000, noi: 875000, ltv: 65, rate: 6.75, amort: 30, minDscr: 1.25, minDy: 8 });
  assert.equal(l.loan, 8125000);
  assert.equal(l.equity, 12500000 - 8125000);
  const o = offerTool({ ask: 13000000, noi: 875000, targetCap: 7, price: 12500000, commission: 4, transfer: 0.5, other: 25000, payoff: 6000000 });
  close(o.atCap, 12500000, 1e-6);
  close(o.atCapVsAsk, (12500000 / 13000000 - 1) * 100, 1e-9);
  assert.equal(o.commission, 500000);
  assert.equal(o.transfer, 62500, '0.5% transfer tax');
  assert.equal(o.net, 12500000 - 500000 - 62500 - 25000 - 6000000);
  assert.equal(offerTool({ noi: -10000, targetCap: 7 }).atCap, null, 'a negative NOI has no value at a cap rate');
  const n = netEffectiveRent({ rent: 42, sf: 2500, months: 120, esc: 3, free: 4, ti: 40, lc: 6, discount: 8 });
  close(n.gross, 1203707.33, 0.01);
  close(n.cash, 1168707.33, 0.01);
  close(n.net, 996484.89, 0.01);
  close(n.nerSimple, 39.859396, 1e-5);
  close(n.nerDiscounted, 35.25867, 1e-4);
  const x = exchangeDates('2026-01-15', new Date(2026, 0, 15));
  assert.equal(x.identify.toISOString().slice(0, 10), '2026-03-01', '45 calendar days');
  assert.equal(x.close.toISOString().slice(0, 10), '2026-07-14', '180 calendar days');
  assert.equal(x.identifyLeft, 45);
});

test('formatting: negatives, missing values and large numbers', async () => {
  globalThis.window = globalThis.window || {};
  const { money0, money2, short, pct, times } = await import('../app/kit.js');
  assert.equal(money0(-1234.4), '-$1,234');
  assert.equal(money2(-12.5), '-$12.50');
  assert.equal(short(-1200000), '-$1.20M');
  assert.equal(short(12500000), '$12.50M');
  assert.equal(short(2.4e9), '$2.40B');
  for (const f of [money0, money2, short, pct, times]) for (const bad of [null, undefined, NaN, Infinity]) assert.equal(f(bad), '—');
});

test('IRR', () => {
  close(irr([-100, 10, 10, 110]), 10, 1e-6, 'a par bond at 10%');
  close(irr([-1000, 0, 0, 0, 0, 1610.51]), 10, 1e-4, '1.61051 = 1.1^5');
  assert.equal(irr([100, 10, 10]), null, 'no outlay: no IRR');
  assert.equal(irr([-100, -10]), null, 'nothing back: no IRR');
  assert.equal(irr([-100, NaN]), null);
});

test('buy, hold five years and sell: worked independently', () => {
  const r = holdReturns({ price: 12500000, noi: 875000, growth: 2, hold: 5, exitCap: 7.25, saleCost: 2, loan: LOAN });
  close(r.balance, 7627401.40, 0.01, 'loan balance after five years');
  close(r.exitValue, 13325113.14, 0.01, 'year-6 NOI at a 7.25% cap');
  close(r.saleCosts, 266502.26, 0.01);
  assert.equal(r.equity, 4625000);
  close(r.leveredIrr, 8.871906, 1e-5);
  close(r.unleveredIrr, 7.538699, 1e-5);
  close(r.leveredMultiple, 1.475206, 1e-6);
  close(r.unleveredMultiple, 1.381345, 1e-6);
  assert.equal(holdReturns({ price: 12500000, noi: 875000, hold: 5 }), null, 'no exit cap: no returns');
  const allCash = holdReturns({ price: 1e6, noi: 70000, growth: 0, hold: 1, exitCap: 7, saleCost: 0, loan: {} });
  close(allCash.leveredIrr, 7, 1e-6, 'all cash, flat NOI, sold at the going-in cap: IRR = cap');
});

test('the price for a target IRR, checked by putting it back in', () => {
  const d = { price: 12500000, noi: 875000, loan: LOAN };
  const m = analyze(d, null, TODAY);
  for (const [target, expected] of [[12, 11882900.448], [15, 11303643.231], [2, 13880311.888]]) {
    const a = scenarioAnswers(d, m, { exitCap: 7.25 }, { targetIrr: target });
    close(a.priceForIrr, expected, 1, `price for ${target}%`);
    const back = holdReturns({ price: a.priceForIrr, noi: 875000, growth: 2, hold: 5, exitCap: 7.25, saleCost: 2, loan: LOAN });
    close(back.leveredIrr, target, 1e-6);
  }
  const a = scenarioAnswers(d, m, {}, { targetCap: 7.5, capForValue: 6.5 });
  close(a.priceForCap, 875000 / 0.075, 1e-6, 'price for a 7.5% cap');
  close(a.valueAtCap, 875000 / 0.065, 1e-6, 'value at a 6.5% cap');
  assert.equal(solvePrice(() => null, 5, 1e6), null);
});

test('a scenario never changes the deal it is run on', () => {
  const d = { price: 14000000, noi: 980000, gross: 1600000, opex: 620000, occ: 94, loan: { ...LOAN } };
  const frozen = JSON.stringify(d);
  const m = analyze(d, null, TODAY);
  const s = runScenario(d, m, { price: 13500000 });
  assert.equal(s.inputs.price, 13500000);
  close(s.m.capCalc, 980000 / 13500000 * 100, 1e-9, 'cap rate moves with the scenario price');
  assert.equal(s.m.noi, 980000, 'a price change does not touch NOI');
  assert.equal(JSON.stringify(d), frozen, 'the deal is untouched');
  assert.equal(m.price, 14000000);
  // occupancy and rent build NOI up from gross income and expenses
  const o = runScenario(d, m, { occ: 85 });
  close(o.m.noi, 1600000 * (85 / 94) - 620000, 1e-6, 'occupancy to 85% scales gross income');
  const r = runScenario(d, m, { rentChange: 5 });
  close(r.m.noi, 1600000 * 1.05 - 620000, 1e-6, 'rents up 5%');
  const x = runScenario(d, m, { expenseChange: 10, noi: 900000 });
  assert.equal(x.m.noi, 900000, 'a NOI typed straight in wins');
  // the exit cap changes the returns, not the going-in cap rate
  const e1 = runScenario(d, m, { exitCap: 7 });
  const e2 = runScenario(d, m, { exitCap: 8 });
  assert.equal(e1.m.capCalc, e2.m.capCalc);
  assert.ok(e1.returns.leveredIrr > e2.returns.leveredIrr);
  // LTV moves debt and equity, not NOI
  const l = runScenario(d, m, { ltv: 50 });
  assert.equal(l.m.noi, 980000);
  assert.equal(l.m.loan, 7000000);
  // without gross income and expenses a rent change is explained, not faked
  const bare = { price: 5e6, noi: 3e5, loan: LOAN };
  const n = runScenario(bare, analyze(bare, null, TODAY), { rentChange: 5 });
  assert.equal(n.m.noi, 3e5);
  assert.ok(n.notes.length);
});
