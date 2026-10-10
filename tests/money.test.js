/* How money is kept (checkpoint b, approved): totals to whole cents, rates per
 * SF or per unit to four decimals, and every stored value that rounding
 * changes recorded with its old and new value. Expected values are written
 * out by hand. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundTo, toCents, toRate, quantizeDeal, quantizeSession, quantizeToolInput, quantizeToolValues, isRateInput } from '../app/engine/money.js';

test('rounding is half away from zero and exact for decimal input', () => {
  assert.equal(toCents(1.005), 1.01); // 1.005 is 1.00499999… as a double; the rule reads it as typed
  assert.equal(toCents(-1.005), -1.01);
  assert.equal(toCents(2.675), 2.68);
  assert.equal(toCents(5573615.873421), 5573615.87);
  assert.equal(toCents(0.1 + 0.2), 0.3);
  assert.equal(toCents(1e-7), 0);
  assert.equal(toRate(37.846153846153846), 37.8462);
  assert.equal(toRate(41.26784), 41.2678);
  assert.equal(roundTo(123.456789, 3), 123.457);
  assert.equal(toCents(null), null);
  assert.equal(toCents(6450000), 6450000);
});

test('a deal: totals to cents, rates to four decimals, each change recorded', () => {
  const deal = {
    name: 'Test',
    figures: { price: 5573615.873421, noi: 393450, opex: 135750.004999, price_psf: 537.504999, price_unit: 245833.33333, bsf: 12000, cap: 6.123456 },
    live: { price: 6000000.123, noi: 400000.0049, occ: 91.23456 },
    scenarios: [{ id: 's', over: { price: 1.235, exitCap: 6.35 } }],
    rentRoll: [{ suite: '100', annual: 98400.004, psf: 37.846153846, sf: 2600 }],
    rr: {
      settings: { opex: 135750.004999, marketRent: 41.26784, otherIncome: [{ annual: 1200.005 }], renewal: { renewTi: 5.123456, newTi: 10 } },
      leases: [{
        unit: '100', sf: 2600,
        periods: [{ rate: 37.846153846, unit: 'psf_year' }, { rate: 8200.004, unit: 'month' }, { rate: 98400.009, unit: 'year' }],
        oneTime: [{ amount: 500.555 }], recovery: { method: 'fixed', amount: 1000.001, stopPsf: 7.123456 }, marketRent: 42.00004,
      }],
    },
  };
  const { changes } = quantizeDeal(deal);
  const f = deal.figures;
  assert.equal(f.price, 5573615.87);
  assert.equal(f.opex, 135750);
  assert.equal(f.price_psf, 537.505); // a rate: four decimals
  assert.equal(f.price_unit, 245833.3333);
  assert.equal(f.cap, 6.123456, 'percentages are not money');
  assert.equal(f.bsf, 12000);
  assert.equal(deal.live.price, 6000000.12);
  assert.equal(deal.live.noi, 400000);
  assert.equal(deal.live.occ, 91.23456);
  assert.equal(deal.scenarios[0].over.price, 1.24);
  assert.equal(deal.rentRoll[0].annual, 98400);
  assert.equal(deal.rentRoll[0].psf, 37.8462);
  const L = deal.rr.leases[0];
  assert.deepEqual(L.periods.map((p) => p.rate), [37.8462, 8200, 98400.01]);
  assert.equal(L.oneTime[0].amount, 500.56);
  assert.equal(L.recovery.amount, 1000);
  assert.equal(L.recovery.stopPsf, 7.1235);
  assert.equal(L.marketRent, 42);
  const s = deal.rr.settings;
  assert.equal(s.opex, 135750); assert.equal(s.marketRent, 41.2678); assert.equal(s.otherIncome[0].annual, 1200.01); assert.equal(s.renewal.renewTi, 5.1235);
  // every change, with where it was and both values
  assert.ok(changes.some((c) => c.path === 'figures.price' && c.old === 5573615.873421 && c.new === 5573615.87));
  assert.ok(changes.some((c) => c.path === 'rr.leases[0] (unit 100).periods[0].rate' && c.new === 37.8462));
  // by hand: figures 4 (price, opex, price_psf, price_unit), What if 2, saved scenario 1, legacy rent roll 2, settings 4
  // (opex, market rent, other income, renewal TI), lease 7 (three periods, one-time, recovery amount and stop, market rent)
  assert.equal(changes.length, 20);
  // a second pass finds nothing to change
  assert.equal(quantizeDeal(deal).changes.length, 0);
});

test('a deal already in whole cents is not changed', () => {
  const d = { figures: { price: 6450000, noi: 393450, price_psf: 537.5 }, rr: { settings: { opex: 135750 }, leases: [{ periods: [{ rate: 124800, unit: 'year' }] }] } };
  assert.deepEqual(quantizeDeal(d).changes, []);
});

test('comp prices typed by hand or edited are kept to cents', () => {
  const s = { manual: [{ address: '1 Main', price: 1500000.555 }], edits: { 'a::b': { price: 2000000.004, exclude: true } } };
  const { changes } = quantizeSession(s);
  assert.equal(s.manual[0].price, 1500000.56);
  assert.equal(s.edits['a::b'].price, 2000000);
  assert.equal(changes.length, 2);
});

test('tool inputs: totals to cents, rates per SF or unit to four decimals', () => {
  assert.ok(isRateInput('money', 'Starting rent $/SF/yr'));
  assert.ok(isRateInput('money', 'TI allowance $/SF'));
  assert.ok(isRateInput('money', 'Rent $/SF a month'));
  assert.ok(isRateInput('money2', 'Starting rent'));
  assert.ok(!isRateInput('money', 'Purchase price'));
  assert.ok(!isRateInput('money', 'Annual debt service'));
  assert.equal(quantizeToolInput('money', 'NOI', 875000.00499), 875000);
  assert.equal(quantizeToolInput('money', 'Starting rent $/SF/yr', 42.00499), 42.005);
  assert.equal(quantizeToolInput('pct', 'Cap rate %', 6.123456), 6.123456);
  const v = { noi: 875000.00499, rent: 36.123456, growth: 3.33333 };
  const ch = quantizeToolValues(v, [['noi', 'NOI', 'money'], ['rent', 'Rent $/SF a year', 'money'], ['growth', 'Growth %', 'pct']], 'DCF: ');
  assert.deepEqual(v, { noi: 875000, rent: 36.1235, growth: 3.33333 });
  assert.deepEqual(ch.map((c) => c.path), ['DCF: noi', 'DCF: rent']);
});
