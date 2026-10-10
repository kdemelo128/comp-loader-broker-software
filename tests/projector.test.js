/* The projection service (checkpoint c). Node has no Worker, so these run the
 * path a browser takes when the worker can't start: the same answers, on the
 * page. The browser flow bigroll-flow checks the worker itself. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project, projectionSummary, DEFAULT_SETTINGS } from '../app/lease.js';
import { projectionNow, projectionLater, projectionSync } from '../app/projector.js';

const roll = (rent = 120000) => ({
  settings: { ...DEFAULT_SETTINGS, asOf: '2026-06-30', years: 10, marketRent: 40, opex: 50000 },
  leases: [
    { id: 'a', unit: '100', tenant: 'A', sf: 3000, leaseStart: '2024-01-01', leaseEnd: '2029-12-31', periods: [{ start: '2024-01-01', end: '2029-12-31', rate: rent, unit: 'year', source: 'documented' }], abatements: [], custom: {} },
    { id: 'b', unit: '200', tenant: '', sf: 1500, vacant: true, periods: [], abatements: [], custom: {} },
  ],
});

test('the worker’s answer (here, worked out on the page) is the projection’s summary', async () => {
  const rr = roll();
  const got = await projectionLater(rr);
  assert.deepEqual(got, projectionSummary(project(rr)));
  assert.deepEqual(await projectionLater(rr, { years: 1 }), projectionSummary(project(rr, { years: 1 })));
  assert.deepEqual(projectionSync(rr, { years: 6 }), projectionSummary(project(rr, { years: 6 })));
});

test('a result is reused only for exactly the same rent roll', async () => {
  const rr = roll(130000);
  assert.equal(projectionNow(rr), null, 'nothing worked out yet');
  const P = await projectionLater(rr);
  assert.equal(projectionNow(rr), P, 'the same rent roll: the same result, at once');
  rr.leases[0].periods[0].rate = 131000;
  assert.equal(projectionNow(rr), null, 'one rent changed: no stale answer');
  rr.leases[0].periods[0].rate = 130000;
  assert.equal(projectionNow(rr), P, 'changed back: the earlier result again');
  assert.equal(projectionNow(rr, { years: 2 }), null, 'other options are another question');
});

test('asking twice while it works shares one job; an edit after asking doesn’t reach it', async () => {
  const rr = roll(140000);
  const a = projectionLater(rr);
  const b = projectionLater(rr);
  assert.equal(a, b);
  rr.leases[0].periods[0].rate = 999999; // edited after the job was sent
  const P = await a;
  assert.deepEqual(P, projectionSummary(project(roll(140000))));
});

test('the date caches give the same answers as working each date out', async () => {
  const { dayOf, isoOf } = await import('../app/lease.js');
  for (let k = 0; k < 2; k++) { // the second pass reads the caches
    assert.equal(dayOf('2026-02-30'), null);
    assert.equal(dayOf('not a date'), null);
    assert.equal(dayOf('2024-02-29'), Date.UTC(2024, 1, 29) / 86400000);
    assert.equal(isoOf(Date.UTC(2031, 11, 31) / 86400000), '2031-12-31');
  }
});

test('a projection that fails says why, and is tried again only once the rent roll changes', async () => {
  const { projectionError } = await import('../app/projector.js');
  const bad = roll(150000);
  bad.leases.push(null); // a lease the projection can't read
  assert.equal(projectionError(bad), null, 'not tried yet');
  await assert.rejects(projectionLater(bad));
  const why = projectionError(bad);
  assert.ok(typeof why === 'string' && why.length > 0, 'the reason is kept');
  await assert.rejects(projectionLater(bad), (e) => e.message === why); // the same rent roll: the same answer, not run again
  assert.equal(projectionNow(bad), null);
  bad.leases.pop(); // fixed
  assert.equal(projectionError(bad), null, 'a changed rent roll has no failure against it');
  assert.deepEqual(await projectionLater(bad), projectionSummary(project(roll(150000))));
});
