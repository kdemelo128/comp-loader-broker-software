/* The lease engine against figures worked out by hand: days in a month times
 * a monthly rent, not the engine's own arithmetic. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dayOf, addMonths, monthlyAmount, generateSteps, leaseMonths, validateLease, validateRentRoll,
  project, rentRollSummary, inPlace, fromOmRows,
} from '../app/lease.js';

const close = (a, b, tol = 0.01, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b}, got ${a}`);
const sumYear = (months, key) => months.slice(0, 12).reduce((s, m) => s + m[key], 0);
const NO_ROLL = { renewal: { assume: false } };

test('dates: real calendar days, month ends clamp', () => {
  assert.equal(dayOf('2026-02-30'), null, 'no 30 February');
  assert.equal(dayOf('nonsense'), null);
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29', 'leap year');
  assert.equal(addMonths('2026-03-15', 12), '2027-03-15');
});

test('rent units convert to monthly dollars', () => {
  assert.equal(monthlyAmount(3000, 'month'), 3000);
  assert.equal(monthlyAmount(36000, 'year'), 3000);
  assert.equal(monthlyAmount(36, 'psf_year', 1000), 3000);
  assert.equal(monthlyAmount(3, 'psf_month', 1000), 3000);
  assert.equal(monthlyAmount(36, 'psf_year', null), null, 'per-SF rent with no SF is unknown, not zero');
});

test('a mid-month start earns the days it covers', () => {
  const L = { sf: 1000, periods: [{ start: '2026-01-16', end: '2026-12-31', rate: 3000, unit: 'month' }] };
  const m = leaseMonths(L, '2026-01-01', 12);
  close(m[0].rent, 3000 * 16 / 31, 1e-9, 'January: 16 of 31 days');
  close(m[1].rent, 3000, 1e-9);
  close(sumYear(m, 'rent'), 3000 * 16 / 31 + 11 * 3000, 1e-6);
  close(m[0].occupied, 16 / 31, 1e-12);
});

test('step rents: 3% compounding and $1 fixed bumps', () => {
  const pct = generateSteps({ start: '2026-01-01', end: '2028-12-31', rate: 36, unit: 'psf_year', escalation: { type: 'pct', value: 3 }, every: 12 });
  assert.deepEqual(pct.map((p) => [p.start, p.end]), [['2026-01-01', '2026-12-31'], ['2027-01-01', '2027-12-31'], ['2028-01-01', '2028-12-31']]);
  close(pct[1].rate, 37.08, 1e-9);
  close(pct[2].rate, 38.1924, 1e-9);
  const L = { sf: 1000, periods: pct };
  const m = leaseMonths(L, '2026-01-01', 36);
  close(m.slice(0, 12).reduce((s, x) => s + x.rent, 0), 36000, 1e-6);
  close(m.slice(12, 24).reduce((s, x) => s + x.rent, 0), 37080, 1e-6);
  close(m.slice(24, 36).reduce((s, x) => s + x.rent, 0), 38192.4, 1e-6);
  const fixed = generateSteps({ start: '2026-01-01', end: '2028-12-31', rate: 36, unit: 'psf_year', escalation: { type: 'fixed', value: 1 }, every: 12 });
  assert.deepEqual(fixed.map((p) => p.rate), [36, 37, 38]);
  // a step that doesn't land on a year: 18-month steps over 3 years
  const odd = generateSteps({ start: '2026-01-01', end: '2028-12-31', rate: 3000, unit: 'month', escalation: { type: 'fixed', value: 100 }, every: 18 });
  assert.deepEqual(odd.map((p) => [p.start, p.end, p.rate]), [['2026-01-01', '2027-06-30', 3000], ['2027-07-01', '2028-12-31', 3100]]);
});

test('free rent and a partial abatement over part of a month', () => {
  const L = {
    sf: 1000,
    periods: [{ start: '2026-01-01', end: '2026-12-31', rate: 36, unit: 'psf_year' }],
    abatements: [{ start: '2026-01-01', end: '2026-03-31', pct: 100 }],
  };
  const m = leaseMonths(L, '2026-01-01', 12);
  close(sumYear(m, 'net'), 36000 - 9000, 1e-6, 'three months free');
  const H = { sf: 1000, periods: L.periods, abatements: [{ start: '2026-02-15', end: '2026-03-14', pct: 50 }] };
  const h = leaseMonths(H, '2026-01-01', 12);
  close(h[1].abatement, 3000 * 14 / 28 * 0.5, 1e-9, '14 of February\'s 28 days at half rent');
  close(h[2].abatement, 3000 * 14 / 31 * 0.5, 1e-9, '14 of March\'s 31 days at half rent');
});

test('rent commencing after the lease does, with in-place rent as of a date', () => {
  const L = { sf: 2000, leaseStart: '2026-01-01', rentStart: '2026-04-01', leaseEnd: '2030-12-31', periods: [{ start: '2026-04-01', end: '2030-12-31', rate: 30, unit: 'psf_year' }] };
  assert.equal(inPlace(L, '2026-02-01').monthly, 0, 'no rent before it commences');
  assert.equal(inPlace(L, '2026-05-01').monthly, 5000);
  assert.deepEqual(validateLease(L).filter((x) => x.level === 'error'), []);
});

test('percentage rent above the breakpoint, and the natural breakpoint', () => {
  const rr = { settings: { asOf: '2026-01-01', years: 1, ...NO_ROLL },
    leases: [{ id: 'a', sf: 1000, leaseEnd: '2030-12-31', periods: [{ start: '2026-01-01', end: '2030-12-31', rate: 36000, unit: 'year' }], percentRent: { rate: 6, sales: 1000000, breakpoint: 500000 } }] };
  close(project(rr).annual[0].pctRent, 30000, 1e-6, '6% of the $500,000 above the breakpoint');
  rr.leases[0].percentRent = { rate: 6, sales: 1000000, natural: true };
  close(project(rr).annual[0].pctRent, (1000000 - 36000 / 0.06) * 0.06, 1e-6, 'natural breakpoint = base rent / rate');
});

test('expense recoveries: pro rata, over a base year, fixed', () => {
  const lease = (id, sf, recovery) => ({ id, sf, leaseEnd: '2030-12-31', periods: [{ start: '2026-01-01', end: '2030-12-31', rate: 1, unit: 'month' }], recovery });
  const rr = { settings: { asOf: '2026-01-01', years: 2, opex: 120000, expenseGrowth: 5, ...NO_ROLL },
    leases: [lease('a', 2500, { method: 'prorata' }), lease('b', 7500, { method: 'base_year', baseAmount: 100000 }), { id: 'c', sf: 0, leaseEnd: '2030-12-31', periods: [{ start: '2026-01-01', end: '2030-12-31', rate: 1, unit: 'month' }], recovery: { method: 'fixed', amount: 1200 } }] };
  const p = project(rr);
  // year 1: a pays 25% of 120,000; b pays 75% of (120,000 - 100,000); c pays 1,200
  close(p.annual[0].recoveries, 30000 + 15000 + 1200, 1e-6);
  // year 2: the pool grows 5% to 126,000
  close(p.annual[1].recoveries, 31500 + 0.75 * 26000 + 1200, 1e-6);
  close(p.annual[0].opex, 120000, 1e-6);
});

test('rollover: a tenant leaves, the space sits empty, then re-lets at market with free rent', () => {
  const rr = { settings: { asOf: '2026-01-01', years: 1, marketRent: 40, marketUnit: 'psf_year', marketGrowth: 0,
    renewal: { assume: true, probability: 0, downtime: 3, newFree: 2, termMonths: 60, escalation: 0, newTi: 10, newLc: 6 } },
  leases: [{ id: 'a', unit: '100', sf: 1000, leaseEnd: '2026-06-30', periods: [{ start: '2026-01-01', end: '2026-06-30', rate: 36, unit: 'psf_year' }] }] };
  const y = project(rr).annual[0];
  const mkt = 40 * 1000 / 12;
  close(y.base, 6 * 3000, 1e-6, 'documented rent Jan-Jun');
  close(y.projected, 3 * mkt, 1e-6, 'new lease Oct-Dec at market');
  close(y.vacancy, 3 * mkt, 1e-6, 'Jul-Sep empty, at market');
  close(y.free, 2 * mkt, 1e-6, 'two months free');
  close(y.gpr, y.rent + y.vacancy, 1e-9);
  close(y.ti, 10 * 1000, 1e-6, 'TI of $10/SF');
  close(y.lc, 60 * mkt * 0.06, 1e-6, '6% of the new five-year term\'s rent');
  close(y.egi, y.gpr - y.vacancy - y.free, 1e-9);
});

test('rollover blended by renewal probability', () => {
  const rr = { settings: { asOf: '2026-01-01', years: 1, marketRent: 40, marketGrowth: 0,
    renewal: { assume: true, probability: 50, downtime: 6, newFree: 3, renewFree: 0, termMonths: 60, escalation: 0 } },
  leases: [{ id: 'a', sf: 1000, leaseEnd: '2026-06-30', periods: [{ start: '2026-01-01', end: '2026-06-30', rate: 36, unit: 'psf_year' }] }] };
  const y = project(rr).annual[0];
  const mkt = 40 * 1000 / 12;
  close(y.vacancy, 3 * mkt, 1e-6, 'expected downtime: half of six months');
  close(y.free, 1.5 * mkt, 1e-6, 'expected free rent: half of three months');
});

test('vacant space leases up at market after the lease-up period', () => {
  const rr = { settings: { asOf: '2026-01-01', years: 1, marketRent: 24, marketGrowth: 0, leaseUpMonths: 4, renewal: { newFree: 0, termMonths: 60, escalation: 0 } },
    leases: [{ id: 'v', unit: '300', sf: 1500, vacant: true }] };
  const y = project(rr).annual[0];
  const mkt = 24 * 1500 / 12;
  close(y.vacancy, 4 * mkt, 1e-6);
  close(y.projected, 8 * mkt, 1e-6);
  close(y.base, 0, 1e-9, 'nothing documented');
});

test('general vacancy is only the part not already modelled', () => {
  const rr = { settings: { asOf: '2026-01-01', years: 1, generalVacancy: 5, marketRent: 36, marketGrowth: 0, ...NO_ROLL },
    leases: [{ id: 'a', sf: 1000, leaseEnd: '2030-12-31', periods: [{ start: '2026-01-01', end: '2030-12-31', rate: 36, unit: 'psf_year' }] },
      { id: 'b', sf: 1000, leaseEnd: '2026-06-30', periods: [{ start: '2026-01-01', end: '2026-06-30', rate: 36, unit: 'psf_year' }] }] };
  const y = project(rr).annual[0];
  // potential 72,000; 5% is 3,600; b's empty half-year at market is 18,000 already, so no more
  close(y.vacancy, 18000, 1e-6);
  close(y.generalVacancy, 0, 1e-9, 'not counted twice');
  rr.leases[1].leaseEnd = '2030-12-31';
  rr.leases[1].periods[0].end = '2030-12-31';
  close(project(rr).annual[0].generalVacancy, 3600, 1e-6, 'fully let: the 5% applies in full');
});

test('NOI and cash flow bridge', () => {
  const rr = { settings: { asOf: '2026-01-01', years: 1, opex: 20000, reservesPsf: 0.25, otherIncome: [{ name: 'Parking', annual: 6000 }], ...NO_ROLL },
    leases: [{ id: 'a', sf: 4000, leaseEnd: '2030-12-31', periods: [{ start: '2026-01-01', end: '2030-12-31', rate: 30, unit: 'psf_year' }], oneTime: [{ date: '2026-03-15', amount: -2500, note: 'credit' }] }] };
  const y = project(rr).annual[0];
  close(y.egi, 120000 + 6000 - 2500, 1e-6);
  close(y.noi, 120000 + 6000 - 2500 - 20000, 1e-6);
  close(y.cashFlow, y.noi - 0.25 * 4000, 1e-6);
});

test('rent roll summary: in-place rent, WALT, expirations, concentration, loss to lease', () => {
  const rr = { settings: { asOf: '2026-01-01', marketRent: 40 },
    leases: [
      { id: 'a', unit: '100', tenant: 'A', sf: 3000, leaseEnd: '2028-12-31', periods: [{ start: '2025-01-01', end: '2028-12-31', rate: 30, unit: 'psf_year' }] },
      { id: 'b', unit: '200', tenant: 'B', sf: 1000, leaseEnd: '2031-12-31', periods: [{ start: '2025-01-01', end: '2031-12-31', rate: 36, unit: 'psf_year' }] },
      { id: 'v', unit: '300', sf: 1000, vacant: true },
    ] };
  const s = rentRollSummary(rr, '2026-01-01');
  assert.equal(s.annualRent, 90000 + 36000);
  close(s.occupancy, 80, 1e-9);
  const yA = (dayOf('2028-12-31') - dayOf('2026-01-01')) / 365.25;
  const yB = (dayOf('2031-12-31') - dayOf('2026-01-01')) / 365.25;
  close(s.waltIncome, (90000 * yA + 36000 * yB) / 126000, 1e-9);
  close(s.waltSf, (3000 * yA + 1000 * yB) / 4000, 1e-9);
  close(s.top.share, 90000 / 126000 * 100, 1e-9);
  close(s.lossToLease, 4000 * 40 - 126000, 1e-6, 'market on the leased SF less in-place');
  assert.deepEqual(s.expirations.map((e) => [e.year, e.count, e.sf]), [[2028, 1, 3000], [2031, 1, 1000]]);
});

test('validation finds overlaps, gaps, bad dates and missing SF', () => {
  const L = { id: 'x', sf: null, leaseStart: '2026-01-01', leaseEnd: '2027-12-31', periods: [
    { start: '2026-01-01', end: '2026-12-31', rate: 30, unit: 'psf_year' },
    { start: '2026-12-01', end: '2027-05-31', rate: 31, unit: 'year' },
    { start: '2027-07-01', end: '2027-12-31', rate: -5, unit: 'year' },
    { start: '2027-02-30', end: '2027-03-01', rate: 5, unit: 'year' },
  ] };
  const msgs = validateLease(L).map((x) => x.text).join('\n');
  assert.match(msgs, /per SF but the space has no SF/);
  assert.match(msgs, /overlap/);
  assert.match(msgs, /No rent from 2027-06-01 to 2027-06-30/);
  assert.match(msgs, /negative rent/);
  assert.match(msgs, /invalid date/);
  const dup = validateRentRoll({ settings: { buildingSf: 10000 }, leases: [{ id: 1, unit: '1', sf: 100, vacant: true }, { id: 2, unit: '1', sf: 100, vacant: true }] });
  assert.ok(dup.some((x) => /appears more than once/.test(x.text)));
  assert.ok(dup.some((x) => /adds to 200 SF/.test(x.text)));
});

test('a projection never changes the rent roll it reads', () => {
  const rr = { settings: { asOf: '2026-01-01', marketRent: 40 }, leases: [{ id: 'a', sf: 1000, leaseEnd: '2026-06-30', periods: [{ start: '2026-01-01', end: '2026-06-30', rate: 36, unit: 'psf_year' }] }] };
  const before = JSON.stringify(rr);
  const p = project(rr);
  assert.equal(JSON.stringify(rr), before);
  assert.ok(p.leases[0].projectedPeriods.every((x) => x.source === 'projected'), 'everything added is marked projected');
});

test('the OM\'s rent roll becomes documented periods', () => {
  const rr = fromOmRows([
    { suite: '100', tenant: 'Coffee', sf: 2400, annual: 124800, start: '2019-03-01T00:00:00.000Z', end: '2029-02-28T00:00:00.000Z' },
    { suite: '120', tenant: 'Vacant', sf: 1000, vacant: true },
  ], { asOf: '2026-10-01', page: 5 });
  assert.equal(rr.leases.length, 2);
  assert.deepEqual(rr.leases[0].periods[0], { start: '2019-03-01', end: '2029-02-28', rate: 124800, unit: 'year', source: 'documented', note: 'OM rent roll, page 5' });
  assert.ok(rr.leases[1].vacant);
  assert.equal(rentRollSummary(rr, '2026-10-01').annualRent, 124800);
});

test('no market rent: renewals re-let at the last documented rent, and the projection says so', () => {
  const rr = { settings: { asOf: '2026-01-01', years: 2, marketGrowth: 0, renewal: { probability: 100, termMonths: 60, escalation: 0, renewFree: 0 } },
    leases: [{ id: 'a', unit: '100', sf: 1000, leaseEnd: '2026-12-31', periods: [{ start: '2026-01-01', end: '2026-12-31', rate: 36, unit: 'psf_year' }] },
      { id: 'v', unit: '200', sf: 500, vacant: true }] };
  const p = project(rr);
  assert.equal(p.annual[1].projected, 36000, 'year 2 renews at the year-1 rent');
  assert.equal(p.annual[1].vacancy, 0, 'a certain renewal has no downtime');
  assert.ok(p.notes.some((n) => /unit 100/.test(n) && /last documented rent/.test(n)));
  assert.ok(p.notes.some((n) => /Vacant unit 200/.test(n)));
});
