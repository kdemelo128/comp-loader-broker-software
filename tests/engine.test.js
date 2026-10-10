/* Known answers for the definitions approved for checkpoint (b), the shared
 * calculation engine. Every expected value was worked out independently (by
 * hand or in Python, as noted), not with the module under test. These tests
 * call the app's existing public functions, so they also run against the code
 * as it was before the change (the PR lists which failed there). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import * as fflate from 'fflate';
import { analyze, debtService, balanceAfter, leaseStats, compBasis } from '../app/deal.js';
import { amortization, breakEven, compSetCheck } from '../app/calc.js';
import { quickValue, loanTool, netEffectiveRent, waltTool } from '../app/tools.js';
import { weightedPpsf } from '../app/stats.js';
import { buildWorkbook } from '../app/workbook.js';
import { rentRollSummary } from '../app/lease.js';

const near = (a, b, tol, msg) => assert.ok(typeof a === 'number' && Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

/* ------------------------------------------------------------------ WALT */
// As of 2026-06-30: A $100,000/yr on 2,000 SF to 2031-06-30 (1,826 days = 4.999316 yrs);
// B month to month, $50,000/yr on 1,000 SF; C $60,000/yr on 1,500 SF to 2028-06-30
// (731 days = 2.001369 yrs); D vacant, 800 SF. Python:
//   by income (100,000 × 4.999316 + 60,000 × 2.001369) ÷ 160,000 = 3.875086
//   by SF     (2,000 × 4.999316 + 1,500 × 2.001369) ÷ 3,500    = 3.714481
// The old Overview measured from today and put B's rent in the denominator at 0 years.
const ROWS = [
  { tenant: 'A', sf: 2000, annual: 100000, end: '2031-06-30T00:00:00.000Z', mtm: false },
  { tenant: 'B', sf: 1000, annual: 50000, end: null, mtm: true },
  { tenant: 'C', sf: 1500, annual: 60000, end: '2028-06-30T00:00:00.000Z', mtm: false },
  { tenant: '', sf: 800, annual: null, end: null, vacant: true },
];
const TODAY = new Date('2026-10-10T12:00:00Z');

test('WALT: measured from the rent roll’s as-of date, month-to-month leases left out (Overview)', () => {
  const s = leaseStats(ROWS, new Date('2026-06-30T00:00:00Z'));
  near(s.waltIncome, 3.875086, 1e-5, 'by income');
  near(s.waltSf, 3.714481, 1e-5, 'by SF');
  // the deal passes its rent roll's as-of date, not today
  const m = analyze({ rentRoll: ROWS, rentRollAsOf: '2026-06-30', loan: {} }, null, TODAY);
  near(m.leases.waltIncome, 3.875086, 1e-5, 'analyze, by income');
});

test('WALT: the Overview and the Rent roll tab give the same figure', () => {
  const rr = {
    settings: { asOf: '2026-06-30' },
    leases: [
      { id: 'a', unit: '1', tenant: 'A', sf: 2000, leaseStart: '2021-07-01', leaseEnd: '2031-06-30', periods: [{ start: '2021-07-01', end: '2031-06-30', rate: 100000, unit: 'year' }] },
      { id: 'b', unit: '2', tenant: 'B', sf: 1000, mtm: true, leaseStart: '2020-01-01', leaseEnd: null, periods: [{ start: '2020-01-01', end: '2026-07-31', rate: 50000, unit: 'year' }] },
      { id: 'c', unit: '3', tenant: 'C', sf: 1500, leaseStart: '2023-07-01', leaseEnd: '2028-06-30', periods: [{ start: '2023-07-01', end: '2028-06-30', rate: 60000, unit: 'year' }] },
      { id: 'd', unit: '4', tenant: '', sf: 800, vacant: true, periods: [] },
    ],
  };
  const sum = rentRollSummary(rr, '2026-06-30');
  near(sum.waltIncome, 3.875086, 1e-5, 'rent roll tab');
  near(sum.waltSf, 3.714481, 1e-5, 'rent roll tab by SF');
});

test('WALT tool: the same definition, measured from today', () => {
  const rows = [{ tenant: 'A', sf: 2000, annual: 100000, end: '2031-06-30' }, { tenant: 'C', sf: 1500, annual: 60000, end: '2028-06-30' }];
  // from 2026-10-10: 1,724 and 629 days → 4.720055 and 1.722108 yrs; (100,000 × 4.720055 + 60,000 × 1.722108) ÷ 160,000 = 3.595825, counting whole days from the as-of date
  near(waltTool(rows, TODAY).waltIncome, 3.595825, 1e-5, 'WALT tool');
});

/* ---------------------------------------------------- debt: whole months */
// $4,192,500 at 6.75% amortizing over 27.4 years = 328.8 months → 329 whole months.
// Python: 12 × L·i ÷ (1 − (1+i)^−329) = $336,079.48 (328.8 months would give $336,150.26)
test('debt service amortizes over whole months', () => {
  near(debtService(4192500, 6.75, 27.4), 336079.48, 0.005, 'deal debt service');
  near(amortization({ loan: 4192500, rate: 6.75, amortYears: 27.4, termYears: 10 }).monthlyAmortizing * 12, 336079.48, 0.005, 'schedule');
  // balance after 120 payments on 329 months: L(1+i)^120 − pmt((1+i)^120 − 1)/i = $3,437,249.88 (Python)
  near(balanceAfter(4192500, 6.75, 27.4, 10), 3437249.88, 0.01, 'balance');
  // a whole number of years is unchanged: 30 years = $326,309.70 (Excel PMT)
  near(debtService(4192500, 6.75, 30), 326309.70, 0.005, '30 years');
});

/* --------------------------------------------- no price from a negative NOI */
test('no price is derived from a zero or negative NOI', () => {
  const m = analyze({ noi: -50000, cap: 6, loan: {} }, null, TODAY);
  assert.equal(m.price, null);
  assert.ok(m.checks.some((c) => /NOI is (zero|negative)/i.test(c.text || c)), JSON.stringify(m.checks));
  const q = quickValue({ noi: -50000, cap: 6 });
  assert.equal(q.price, null);
  assert.ok((q.warnings || []).some((w) => /NOI is (zero|negative)/i.test(w)));
});

/* ------------------------------------------------------ break-even occupancy */
// (135,750 + 326,310) = 462,060. Over GPR 588,000 = 78.581633%. Without GPR: over EGI 529,200
// scaled by 91.7% occupancy = 80.065952% (estimated); with no occupancy either, 87.312925% of current income.
test('break-even occupancy: one definition, its basis named', () => {
  const a = breakEven({ gpr: 588000, opex: 135750, debtService: 326310 });
  near(a.occupancy, 78.581633, 1e-5, 'over GPR');
  assert.equal(a.basis, 'gpr');
  const b = breakEven({ gpr: null, gross: 529200, occ: 91.7, opex: 135750, debtService: 326310 });
  near(b.occupancy, 80.065952, 1e-5, 'estimated from EGI');
  assert.equal(b.basis, 'egi-occ');
  const c = breakEven({ gross: 529200, opex: 135750, debtService: 326310 });
  near(c.occupancy, 87.312925, 1e-5, 'share of income');
  assert.equal(c.basis, 'egi');
  // the deal's figure is the same function's
  const m = analyze({ price: 6450000, noi: 393450, gpr: 588000, gross: 529200, opex: 135750, occ: 91.7, loan: { ltv: 65, rate: 6.75, amort: 30 } }, null, TODAY);
  const t = breakEven({ gpr: 588000, opex: 135750, debtService: m.debtService });
  near(m.breakEven, t.occupancy, 1e-9, 'deal = tool');
});

/* ---------------------------------------------------------- net effective rent */
// $75/SF, 3% a year compounding at each anniversary, 120 months, 3 months free at the starting rent,
// $25/SF TI. Python, month by month: total rent 859.790889, free 18.75 → (859.790889 − 18.75 − 25) ÷ 10 = 81.604089.
test('net effective rent: the tool and the comp workbook use one definition', async () => {
  near(netEffectiveRent({ rent: 75, sf: 1, months: 120, esc: 3, free: 3, ti: 25 }).nerSimple, 81.604089, 1e-5, 'tool');
  const bytes = await buildWorkbook(ExcelJS, fflate, { sales: [], market: [], subject: {}, label: 'test', sources: [] });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  const p4 = wb.getWorksheet('Lease Comps').getCell('P4');
  near(p4.value && typeof p4.value === 'object' ? p4.value.result : p4.value, 81.604089, 1e-5, 'Lease Comps example row');
});

// $36.50/SF, 3.5% a year, 87 months, 2.5 months free, $12.25/SF TI. Python, month by month, forgoing half of the
// third month: (total 295.557922 − forgone 7.604167 − 12.25) ÷ 7.25 = 38.028104 (LibreOffice gives the same from the Excel formula).
test('net effective rent: a part month of free rent forgoes that part of the month', () => {
  near(netEffectiveRent({ rent: 36.5, sf: 1, months: 87, esc: 3.5, free: 2.5, ti: 12.25 }).nerSimple, 38.028104, 1e-5, 'part month');
});

/* ----------------------------------------------------------------- comps */
test('a comp counts toward $/SF only with a price and SF above zero', () => {
  // $1,000,000 on 10,000 SF, and a $0 price on 5,000 SF: weighted $/SF is 100.00, not 66.67
  assert.equal(weightedPpsf([1000000, 0], [10000, 5000]), 100);
  assert.equal(weightedPpsf([1000000, 500000], [10000, 0]), 100);
  assert.equal(compBasis([{ price: 1000000, bsf: 10000 }, { price: 0, bsf: 5000 }]).weighted, 100);
});

test('median comp age is the true median', () => {
  // sold 2026-04-10 and 2025-12-10, seen from 2026-10-10: 6.0123 and 9.9877 months; median 8.0000
  const sales = [{ price: 1e6, bsf: 1e4, date: new Date('2026-04-10T00:00:00Z') }, { price: 2e6, bsf: 2e4, date: new Date('2025-12-10T00:00:00Z') }];
  near(compSetCheck(sales, { today: new Date('2026-10-10T00:00:00Z') }).medianAgeMonths, 8.0, 1e-6, 'median age');
});

/* --------------------------------------------------------- the loan tool */
// The loan tool's "Equity needed" is shown on screen, labelled "before closing costs": price − maximum loan.
// $6,450,000 − $4,044,106.84 (the DSCR-bound loan: $393,450 ÷ 1.25 ÷ the 6.75%, 30-year loan constant; Python) = $2,405,893.16.
test('the loan tool’s equity is what its label says: price less the loan, before closing costs', () => {
  const r = loanTool({ price: 6450000, noi: 393450, ltv: 65, rate: 6.75, amort: 30, minDscr: 1.25, minDy: 8 });
  near(r.loan, 4044106.84, 0.01, 'loan');
  near(r.equity, 6450000 - r.loan, 1e-6, 'equity');
});
