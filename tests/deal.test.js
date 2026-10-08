import { test } from 'node:test';
import assert from 'node:assert/strict';
import { debtService, loanConstant, sizeLoan, balanceAfter, leaseStats, analyze, compBasis, yearsLeft } from '../app/deal.js';
import { readOm } from '../app/om.js';
import { retail } from './om-fixtures.js';

const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

test('debt service matches the standard payment formula', () => {
  // $1,000,000 at 6.5% over 30 years: $6,320.68 a month (Excel PMT)
  near(debtService(1e6, 6.5, 30) / 12, 6320.68, 0.01);
  assert.equal(debtService(1e6, 6.5, 30, true), 65000, 'interest only');
  assert.equal(debtService(1.2e6, 0, 25), 48000, 'zero rate is straight-line');
  assert.equal(debtService(null, 6.5, 30), null);
  near(loanConstant(6.5, 30), 0.07585, 0.00001);
  // after 10 years of a 30-year, 6.5% loan, 84.78% of the principal is left (120 payments iterated)
  near(balanceAfter(1e6, 6.5, 30, 10) / 1e6, 0.847761, 0.000001);
});

test('loan sizing takes the tightest test', () => {
  const s = sizeLoan({ price: 10e6, noi: 600000, ltv: 65, dscr: 1.25, dy: 9, rate: 6.5, amort: 30 });
  near(s.tests.LTV, 6.5e6, 1);
  near(s.tests.DSCR, 600000 / 1.25 / loanConstant(6.5, 30), 1);
  near(s.tests['Debt yield'], 600000 / 0.09, 1);
  assert.equal(s.binding, 'DSCR');
  assert.equal(s.loan, Math.min(...Object.values(s.tests)));
});

test('WALT, occupancy and rollover from a rent roll', () => {
  const today = new Date(Date.UTC(2026, 0, 1));
  const rows = [
    { tenant: 'A', sf: 1000, annual: 100000, end: new Date(Date.UTC(2031, 0, 1)) },   // 5 years
    { tenant: 'B', sf: 3000, annual: 100000, end: new Date(Date.UTC(2027, 0, 1)) },   // 1 year
    { tenant: 'Vacant', sf: 1000, vacant: true },
  ];
  const s = leaseStats(rows, today);
  near(s.waltIncome, 3, 0.01);
  near(s.waltSf, 2, 0.01);
  assert.equal(s.occupancy, 80);
  assert.equal(s.vacantSf, 1000);
  near(s.roll12Pct, 50, 0.1);
  near(s.avgRentPsf, 50, 0.01);
});

test('years left from text or a date', () => {
  assert.equal(yearsLeft('9.3 Years'), 9.3);
  near(yearsLeft('January 31, 2036', new Date(Date.UTC(2026, 0, 31))), 10, 0.01);
  assert.equal(yearsLeft('soon'), null);
});

test('any two of price, NOI and cap give the third, marked as derived', () => {
  const a = analyze({ price: 5e6, cap: 6 });
  assert.equal(a.noi, 300000);
  assert.ok(a.derived.noi);
  const b = analyze({ noi: 300000, cap: 6 });
  near(b.price, 5e6, 0.01);
  assert.ok(b.derived.price);
});

test('the retail OM, analysed', () => {
  const om = readOm(retail);
  const f = Object.fromEntries(Object.entries(om.fields).map(([k, v]) => [k, v.value]));
  const d = { ...f, lot_sf: f.lot, rentRoll: om.rentRoll.rows, loan: { ltv: 65, rate: 6.5, amort: 30, closing: 2, minDscr: 1.25, minDy: 8 } };
  const comps = compBasis([
    { price: 4e6, bsf: 8000, cap: 6.5 }, { price: 6e6, bsf: 10000, cap: 6.0 }, { price: 3e6, bsf: 6000, cap: 5.5 },
  ]);
  const m = analyze(d, comps, new Date(Date.UTC(2026, 9, 1)));
  near(m.capCalc, 393450 / 6450000 * 100, 1e-9);
  near(m.ppsf, 537.5, 1e-9);
  assert.equal(m.loan, 6450000 * 0.65);
  near(m.dscr, 393450 / debtService(4192500, 6.5, 30), 1e-9);
  assert.ok(m.dscr < 1.25 && m.checks.some((c) => /coverage/.test(c.text)), 'a thin DSCR is called out');
  near(m.leases.occupancy, 11000 / 12000 * 100, 1e-9);
  assert.equal(m.leases.vacantSf, 1000);
  assert.ok(m.questions.some((q) => /vacant/.test(q)), 'vacant space prompts a question');
  assert.ok(m.questions.some((q) => /Built 1948/.test(q)), 'an old building prompts a systems question');
  near(comps.weighted, 13e6 / 24000, 1e-9);
  near(m.vsWeighted, (537.5 / (13e6 / 24000) - 1) * 100, 1e-9);
  assert.equal(m.ladder.length, 9);
  assert.equal(m.ladder[4].cap, 6, 'the ladder is centred on the cap rate, rounded to a quarter point');
});

test('the OM contradicting itself is flagged', () => {
  const m = analyze({ price: 5e6, noi: 280000, cap: 6.25, bsf: 10000, price_psf: 520 });
  assert.ok(m.checks.some((c) => /states a 6.25% cap rate/.test(c.text)));
  assert.ok(m.checks.some((c) => /\$520.00\/SF/.test(c.text)));
});
