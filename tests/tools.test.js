import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quickValue, loanTool, offerTool, netEffectiveRent, exchangeDates, waltTool } from '../app/tools.js';

const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

test('quick value solves for whichever is missing', () => {
  assert.equal(quickValue({ noi: 300000, cap: 6 }).price, 5e6);
  assert.equal(quickValue({ price: 5e6, cap: 6 }).noi, 300000);
  near(quickValue({ price: 5e6, noi: 300000 }).cap, 6, 1e-12);
  assert.equal(quickValue({ price: 5e6, noi: 300000, bsf: 10000 }).ppsf, 500);
  assert.equal(quickValue({ price: 5e6 }).solved, null, 'one figure solves nothing');
});

test('loan sizing reports the binding test and the loan it gives', () => {
  const r = loanTool({ price: 5e6, noi: 330000, ltv: 65, rate: 6.5, amort: 30, minDscr: 1.25, minDy: 8 });
  assert.equal(r.loan, Math.min(...Object.values(r.sized.tests)));
  near(r.dscr, 330000 / r.debtService, 1e-9);
  assert.equal(r.equity, 5e6 - r.loan);
});

test('offer at a target cap and the seller\'s net', () => {
  const r = offerTool({ ask: 5e6, noi: 300000, targetCap: 6.5, commission: 4, transfer: 1.45, other: 25000, payoff: 1.8e6 });
  near(r.atCap, 300000 / 0.065, 1e-6);
  near(r.atCapVsAsk, (300000 / 0.065 / 5e6 - 1) * 100, 1e-9);
  near(r.net, r.atCap * (1 - 0.0545) - 25000 - 1.8e6, 1e-6);
});

test('net effective rent: free rent, TI and commissions come off the face rent', () => {
  // $40/SF on 1,000 SF for 5 years flat, 6 months free, $20/SF TI, 5% commissions, no discounting
  const r = netEffectiveRent({ rent: 40, sf: 1000, months: 60, free: 6, ti: 20, lc: 5 });
  near(r.gross, 200000, 1e-6);
  near(r.freeRent, 20000, 1e-6);
  assert.equal(r.ti, 20000);
  near(r.lc, 10000, 1e-6);
  near(r.nerSimple, (200000 - 20000 - 20000 - 10000) / 1000 / 5, 1e-9);
  const d = netEffectiveRent({ rent: 40, sf: 1000, months: 60, discount: 8 });
  near(d.nerDiscounted, 40, 1e-9, 'with no concessions the level rent is the face rent');
  const e = netEffectiveRent({ rent: 40, sf: 1000, months: 24, esc: 3 });
  near(e.gross, 40000 + 41200, 1e-6);
});

test('1031 deadlines are 45 and 180 calendar days after closing', () => {
  const r = exchangeDates('2026-03-01', new Date(2026, 2, 11));
  assert.equal(r.identify.toISOString().slice(0, 10), '2026-04-15');
  assert.equal(r.close.toISOString().slice(0, 10), '2026-08-28');
  assert.equal(r.identifyLeft, 35);
  assert.equal(exchangeDates('not a date'), null);
});

test('WALT from typed rows', () => {
  const s = waltTool([
    { tenant: 'A', sf: 1000, annual: 50000, end: '2031-01-01' },
    { tenant: 'B', sf: 1000, annual: 50000, end: '2027-01-01' },
    { tenant: 'Vacant', sf: 500 },
    {},
  ], new Date(Date.UTC(2026, 0, 1)));
  near(s.waltIncome, 3, 0.01);
  near(s.occupancy, 80, 1e-9);
});
