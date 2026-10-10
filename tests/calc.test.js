/* The Tools calculators against figures worked out independently (Python
 * loops written from the textbook definitions, or by hand where noted). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  amortization, refinance, floating, maturityRisk, loanFees, dcf, noiBridge, breakEven, sensitivity, around,
  holdWithFees, waterfall, commission, renewalVsReplacement, percentageRent, recovery, absorption,
  residualLand, yieldOnCost, drawSchedule, compSetCheck, escalationSchedule, compareLeases,
} from '../app/calc.js';
import { holdReturns } from '../app/deal.js';

const close = (a, b, tol = 0.01, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b}, got ${a}`);

test('amortization: two years interest-only, then 30-year amortization, ten-year term', () => {
  const a = amortization({ loan: 10e6, rate: 6.5, amortYears: 30, termYears: 10, ioYears: 2 });
  close(a.balloon, 8865667.75, 0.01, 'balloon at year 10');
  close(a.years[0].interest, 650000, 0.01, 'year 1 is all interest');
  close(a.years[0].principal, 0, 1e-6);
  close(a.years[2].principal, 111772.55, 0.01, 'year 3 principal');
  close(a.monthlyAmortizing, 63206.8, 0.01);
  assert.equal(a.years.length, 10);
  assert.equal(amortization({ loan: 10e6, rate: 6.5, amortYears: null, termYears: 10 }), null, 'amortizing with no amortization period is unknown');
});

test('refinance, floating rate, maturity, loan fees', () => {
  const r = refinance({ noi: 1e6, capRate: 6.5, balance: 9e6, maxLtv: 65, minDscr: 1.25, minDy: 9, rate: 6.5, amort: 30, costsPct: 1 });
  close(r.value, 1e6 / 0.065, 1e-6);
  // value $15.38M: 65% LTV gives $10.0M, below the 9% debt yield ($11.1M) and 1.25x DSCR ($10.5M)
  assert.equal(r.sized.binding, 'LTV');
  close(r.loan, 1e6 / 0.065 * 0.65, 1e-6);
  close(r.cashOut, 1e6 / 0.065 * 0.65 * 0.99 - 9e6, 1e-6);
  const f = floating({ loan: 20e6, index: 4.3, spread: 3, capStrike: 5, noi: 1.8e6, shocks: [0, 100] });
  close(f[0].rate, 7.3, 1e-9);
  close(f[1].rate, 8, 1e-9, 'the cap holds the index at 5%');
  close(f[1].dscr, 1.8e6 / (20e6 * 0.08), 1e-9);
  const m = maturityRisk({ loan: 10e6, rate: 6, amort: 30, termYears: 10, noi: 800000, growth: 0, refiCap: 8, refiLtv: 65, refiDscr: 1.25, refiRate: 7, refiAmort: 30 });
  close(m.balance, 8368572.5, 0.1, 'balance after 10 years on $10M at 6%');
  close(m.value, 10e6, 1e-6);
  assert.ok(m.gap < 0, 'proceeds fall short of the balance');
  const fee = loanFees({ loan: 10e6, points: 1, lenderLegal: 25000, thirdParty: 15000, reserves: 100000 });
  assert.equal(fee.total, 240000);
});

test('DCF: worked independently, and the perpetuity check', () => {
  const v = dcf({ noi: 1e6, growth: 3, years: 10, discount: 8, exitCap: 7, saleCost: 2 });
  close(v.value, 16265040.11, 0.01);
  close(v.pvCashFlows, 7550133.69, 0.01);
  close(v.reversion, 18814829.31, 0.01);
  // flat NOI, sold at the discount rate as the cap, no costs: worth NOI / rate
  close(dcf({ noi: 100, growth: 0, years: 5, discount: 8, exitCap: 8 }).value, 1250, 1e-9);
});

test('NOI bridge and break-even occupancy (by hand)', () => {
  const b = noiBridge({ gpr: 1e6, vacancyPct: 5, creditPct: 1, otherIncome: 20000, taxes: 120000, insurance: 30000, repairs: 50000, mgmtPct: 3, bsf: 40000 });
  close(b.egi, 1e6 - 50000 - 10000 + 20000, 1e-9);
  close(b.mgmt, 960000 * 0.03, 1e-9);
  close(b.noi, 960000 - 200000 - 28800, 1e-9);
  const be = breakEven({ gpr: 1e6, opex: 400000, debtService: 350000 });
  close(be.occupancy, 75, 1e-9);
});

test('sensitivity grid', () => {
  const g = sensitivity((noi, cap) => noi / (cap / 100), [900000, 1000000], around(7, 0.5, 1));
  assert.deepEqual(around(7, 0.5, 1), [6.5, 7, 7.5]);
  close(g[1][1], 1e6 / 0.07, 1e-6);
  close(g[0][2], 900000 / 0.075, 1e-6);
});

test('hold returns with fees: the fees lower the IRR, and are counted', () => {
  const args = { price: 12500000, noi: 875000, growth: 2, hold: 5, exitCap: 7.25, saleCost: 2, loan: { ltv: 65, rate: 6.75, amort: 30, closing: 2 } };
  const base = holdReturns(args);
  const f = holdWithFees(args, { acqFeePct: 1, amFeePct: 1.5, dispFeePct: 0.5 });
  close(f.fees.acq, 125000, 1e-6);
  close(f.fees.am, base.equity * 0.015, 1e-6);
  close(f.fees.disp, base.exitValue * 0.005, 1e-6);
  assert.ok(f.irrAfterFees < base.leveredIrr);
  close(f.leveredIrr, base.leveredIrr, 1e-12, 'before fees unchanged');
});

test('waterfall: hand-worked bands (90/10 equity, 8/12/15% hurdles, 20/30/40% promotes)', () => {
  // exactly the 8% preferred return: all pro rata
  const a = waterfall({ flows: [-100, 108], lpShare: 90, hurdles: [8, 12, 15], promotes: [20, 30, 40] });
  close(a.lpFlows[1], 97.2, 1e-9);
  close(a.gpFlows[1], 10.8, 1e-9);
  close(a.lpIrr, 8, 1e-6);
  close(a.promote, 0, 1e-9);
  // 120 back: 108 at pro rata, 5 to reach 12%, 4.2857 to reach 15%, the rest at 40% promote
  const b = waterfall({ flows: [-100, 120], lpShare: 90, hurdles: [8, 12, 15], promotes: [20, 30, 40] });
  close(b.lpFlows[1], 97.2 + 3.6 + 2.7 + (120 - 108 - 5 - 2.7 / 0.63) * 0.54, 1e-9);
  close(b.lpFlows[1] + b.gpFlows[1], 120, 1e-9, 'every dollar distributed');
  close(b.bands[1].lp, 3.6, 1e-9, 'band 2 brings the investors to 12%');
  close(b.bands[2].lp, 2.7, 1e-9, 'band 3 brings them to 15%');
  assert.ok(b.lpIrr > 15 && b.lpIrr < 20);
  // over several years, the LP reaches its hurdles on compounded balances
  const c = waterfall({ flows: [-1000, 80, 80, 1080], lpShare: 100, hurdles: [8], promotes: [20] });
  close(c.lpIrr, 8, 1e-6, '100% LP, exactly 8%: no promote');
  assert.equal(waterfall({ flows: [100, 5] }), null, 'no contribution, no waterfall');
});

test('commission: tiers, co-broker, house split and referral (by hand)', () => {
  const c = commission({ price: 7e6, tiers: [{ upTo: 1e6, pct: 6 }, { upTo: 5e6, pct: 4 }, { pct: 2 }], coBrokerPct: 50, referralPct: 10, housePct: 40 });
  assert.equal(c.total, 60000 + 160000 + 40000);
  assert.equal(c.coBroker, 130000);
  assert.equal(c.referral, 13000);
  assert.equal(c.house, (130000 - 13000) * 0.4);
  assert.equal(c.agent, 130000 - 13000 - 46800);
  assert.equal(commission({ price: 2e6, flatPct: 3 }).total, 60000);
});

test('leasing: renewal versus replacement (independent), percentage rent, recoveries, absorption', () => {
  const rv = renewalVsReplacement({ sf: 5000, renew: { rent: 30, esc: 3, free: 2, ti: 10, lc: 4, months: 60 }, replace: { downtime: 6, rent: 32, esc: 3, free: 4, ti: 40, lc: 6, months: 60 }, discount: 8 });
  close(rv.renewPv, 549093.69, 0.01);
  close(rv.replacePv, 380346.83, 0.01);
  assert.equal(rv.better, 'renew');
  const pr = percentageRent({ sales: 2e6, rate: 6, baseRent: 90000, natural: true });
  close(pr.breakpoint, 1.5e6, 1e-6);
  close(pr.overage, 30000, 1e-6);
  close(recovery({ expenses: 200000, tenantSf: 2500, buildingSf: 10000 }).annual, 50000, 1e-9);
  close(recovery({ expenses: 200000, tenantSf: 2500, buildingSf: 10000, method: 'base_year', baseYear: 180000 }).annual, 5000, 1e-9);
  close(recovery({ expenses: 200000, tenantSf: 2500, buildingSf: 10000, method: 'stop', stopPsf: 15 }).annual, 12500, 1e-9);
  const ab = absorption({ vacantSf: 10000, sfPerMonth: 2500, rentPsf: 24 });
  assert.equal(ab.months, 4);
  close(ab.lostRent, (10000 + 7500 + 5000 + 2500) * 2, 1e-9, 'unleased SF each month at $2/SF/month');
});

test('escalation schedule', () => {
  const e = escalationSchedule({ start: '2026-01-01', months: 36, rate: 30, unit: 'psf_year', sf: 1000, type: 'pct', value: 3 });
  assert.equal(e.rows.length, 3);
  close(e.total, 30000 + 30900 + 31827, 0.5);
});

test('development: residual land (independent), yield on cost, draws (independent)', () => {
  const r = residualLand({ noi: 2e6, exitCap: 6, saleCostPct: 2, hardCost: 20e6, softPct: 20, contingencyPct: 5, financePct: 6, profitPct: 15 });
  close(r.costs, 26712000, 0.01);
  close(r.land, 1693797.1, 0.01);
  close(r.profit, (r.costs + r.land) * 0.15, 1e-6);
  const y = yieldOnCost({ noi: 2e6, land: 3e6, hardCost: 20e6, softCost: 4e6, financeCost: 1.5e6, exitCap: 6 });
  close(y.yoc, 2e6 / 28.5e6 * 100, 1e-9);
  close(y.spreadBps, (2e6 / 28.5e6 * 100 - 6) * 100, 1e-6);
  const d = drawSchedule({ totalCost: 10e6, months: 12, curve: 'straight', loanToCost: 60, rate: 9 });
  close(d.interest, 141852.34, 0.01);
  close(d.loanAtCompletion, 6141852.34, 0.01);
  close(d.equity, 4e6, 1e-6, 'equity goes in first');
  const s = drawSchedule({ totalCost: 10e6, months: 18, curve: 's', loanToCost: 60, rate: 9 });
  close(s.rows.reduce((t, x) => t + x.cost, 0), 10e6, 1e-6, 'an S-curve still spends the whole budget');
});

test('comp set check: quartiles, dispersion and plain warnings', () => {
  const today = new Date(Date.UTC(2026, 9, 1));
  const sales = [500, 600, 700, 800, 900].map((p, i) => ({ price: p * 1000, bsf: 1000, cap: i < 2 ? 6 : null, date: new Date(Date.UTC(2025, i, 1)) }));
  const c = compSetCheck(sales, { subjectSf: 2000, today });
  assert.equal(c.n, 5);
  assert.equal(c.median, 700);
  assert.equal(c.p25, 600);
  assert.equal(c.value.median, 1400000);
  close(c.cv, (Math.sqrt(25000) / 700) * 100, 1e-9);
  assert.ok(c.warnings.some((w) => /2 comps report a cap rate/.test(w)));
  assert.ok(compSetCheck(sales.slice(0, 2)).warnings.some((w) => /Only 2 priced/.test(w)));
});

test('lease comparison: landlord PV is a present value, not a sum of payments', () => {
  // $12/SF on 1,000 SF for 12 months is $1,000 a month; at 12% (1% a month, paid in advance)
  // PV = 1,000 × (1 − 1.01^−12) / 0.01 × 1.01 = 11,367.63 (worked independently, not with the module)
  const [a] = compareLeases([{ k: 'A', rent: 12, sf: 1000, months: 12 }], 12);
  assert.ok(Math.abs(a.landlordPv - 11367.63) < 0.01, String(a.landlordPv));
  // 1,500 SF at $30/SF, 3% a year, 24 months, 2 months free, TI $5/SF, commission 4% of gross, at 8%:
  // PV of rent received 77,194.26 less TI 7,500 and commission 0.04 × 91,350 = 3,654 → 66,040.26 (Python, by month)
  const [b] = compareLeases([{ k: 'B', rent: 30, sf: 1500, months: 24, esc: 3, free: 2, ti: 5, lc: 4 }], 8);
  assert.ok(Math.abs(b.landlordPv - 66040.26) < 0.01, String(b.landlordPv));
  // with no discount rate the "PV" is the undiscounted net
  const [c] = compareLeases([{ k: 'C', rent: 12, sf: 1000, months: 12 }], 0);
  assert.equal(c.landlordPv, 12000);
});
