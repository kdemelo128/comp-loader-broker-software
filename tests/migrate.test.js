/* The migration registry (app/migrate.js), on real backups made by old
 * versions (tests/fixtures):
 *   backup-3.1.0-before-rent-roll.json  deals read by the version before the
 *     rent roll, backed up by 3.1.0 without being opened (tests/tools/make-old-backup.mjs);
 *   backup-comp-loader-3.3.0.json       a 3.3.0 deal, before the money rounding.
 * Every step must have a backup that needs it: adding a step without one fails here. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { MIGRATIONS, SCHEMA, MONEY_VERSION, LATEST, pending, tooNew, migrateDeal, applyStep } from '../app/migrate.js';
import { readBackup, planRestore } from '../app/backup.js';
import { MONEY_VERSION as STORE_MONEY } from '../app/store.js';
import { quantizeDeal } from '../app/engine/money.js';
import { monthlyAmount } from '../app/lease.js';

const FIX = new URL('./fixtures/', import.meta.url).pathname;
const BACKUPS = {
  '3.1.0': 'backup-3.1.0-before-rent-roll.json',
  '3.3.0': 'backup-comp-loader-3.3.0.json',
};
/** The old backup each step is tested on: a new step needs a backup from the version before it. */
const COVERS = { money: ['3.1.0', '3.3.0'], 'rent-roll': ['3.1.0'] };
const load = (v) => readBackup(fs.readFileSync(FIX + BACKUPS[v], 'utf8'));
const TODAY = '2026-10-10';
const empty = { deals: [], kv: {}, session: null, local: {} };

test('the registry: ids unique, each field only goes up, and the latest versions are what the app writes', () => {
  assert.equal(new Set(MIGRATIONS.map((s) => s.id)).size, MIGRATIONS.length);
  const last = {};
  for (const s of MIGRATIONS) {
    assert.ok(['schema', 'moneyVersion'].includes(s.field), s.id);
    assert.ok(s.to > (last[s.field] || 0), `${s.id}: ${s.field} must go up`);
    last[s.field] = s.to;
    for (const k of ['since', 'does', 'brief', 'kind']) assert.equal(typeof s[k], 'string', `${s.id}.${k}`);
    assert.equal(typeof s.label([]), 'string');
  }
  assert.deepEqual(LATEST, last);
  assert.equal(SCHEMA, 2);
  assert.equal(MONEY_VERSION, 1);
  assert.equal(STORE_MONEY, MONEY_VERSION, 'the store writes the registry’s money version');
});

test('every step is tested on a real old backup that needs it', () => {
  for (const s of MIGRATIONS) {
    const vs = COVERS[s.id];
    assert.ok(vs && vs.length, `step "${s.id}" has no old backup in tests/fixtures: add one from the version before it`);
    for (const v of vs) assert.ok(load(v).deals.some((d) => s.needed(d)), `${BACKUPS[v]} has no deal that needs "${s.id}"`);
  }
});

test('3.1.0 backup: deals from before the rent roll get one, from the OM’s rows, and their money rounded', () => {
  const b = load('3.1.0');
  assert.equal(b.deals.length, 3);
  for (const d of b.deals) {
    assert.equal(d.rr, undefined, 'saved without a rent roll');
    assert.deepEqual(pending(d).map((s) => s.id), ['money', 'rent-roll']);
    const rows = (d.rentRoll || []).map((r) => ({ ...r }));
    const applied = migrateDeal(d, { today: TODAY });
    assert.deepEqual(applied.map((x) => x.id), ['money', 'rent-roll']);
    assert.equal(d.schema, SCHEMA);
    assert.equal(d.moneyVersion, MONEY_VERSION);
    assert.ok(d.rr && Array.isArray(d.rr.leases));
    assert.equal(d.rr.settings.asOf, TODAY);
    // one lease per OM row, each at the row's rent
    assert.equal(d.rr.leases.length, rows.length, d.name);
    d.rr.leases.forEach((l, i) => {
      assert.equal(l.sf, rows[i].sf);
      if (rows[i].vacant) { assert.equal(l.periods.length, 0, 'a vacant suite has no rent'); return; }
      assert.equal(l.tenant, rows[i].tenant);
      const p = l.periods[0];
      assert.equal(p.source, 'documented');
      if (rows[i].annual) assert.ok(Math.abs(monthlyAmount(p.rate, p.unit, l.sf) * 12 - rows[i].annual) < 0.01, `${l.tenant}: ${monthlyAmount(p.rate, p.unit, l.sf) * 12} vs ${rows[i].annual}`);
    });
    if (d.figures && Number.isFinite(d.figures.opex)) assert.equal(d.rr.settings.opex, d.figures.opex);
    // everything stored as money is rounded once it has been brought up to date
    assert.equal(quantizeDeal(d).changes.length, 0, `${d.name}: left unrounded`);
    // and a second run does nothing
    assert.deepEqual(migrateDeal(d, { today: TODAY }), []);
  }
  const om = b.deals.find((d) => (d.rentRoll || []).length);
  assert.equal(om.rr.leases.length, 5, 'the retail OM’s five tenants');
});

test('3.3.0 backup: only the rounding is due, and it is recorded value by value', () => {
  const [d] = load('3.3.0').deals;
  assert.deepEqual(pending(d).map((s) => s.id), ['money']);
  const rr = JSON.stringify(d.rr);
  const [a] = migrateDeal(d, { today: TODAY });
  assert.ok(a.rounded.length >= 1);
  for (const c of a.rounded) assert.ok('path' in c && 'old' in c && 'new' in c);
  assert.equal(d.moneyVersion, 1);
  assert.notEqual(JSON.stringify(d.rr), undefined);
  assert.equal(d.rr.leases.length, JSON.parse(rr).leases.length, 'the rent roll it had is kept');
});

test('the steps run in order, and one at a time gives the same deal as all at once', () => {
  const [a] = load('3.1.0').deals.filter((d) => d.rentRoll && d.rentRoll.length);
  const [b] = load('3.1.0').deals.filter((d) => d.rentRoll && d.rentRoll.length);
  migrateDeal(a, { today: TODAY });
  for (const s of pending(b)) applyStep(b, s, { today: TODAY });
  // lease ids are made new each time
  const noIds = (d) => ({ ...d, rr: { ...d.rr, leases: d.rr.leases.map(({ id, ...l }) => l) } });
  assert.deepEqual(noIds(a), noIds(b));
});

test('a deal saved by a newer version is left alone, and a backup holding one is refused', () => {
  const b = load('3.1.0');
  const d = { ...b.deals[0], schema: SCHEMA + 1 };
  assert.ok(tooNew(d));
  assert.deepEqual(pending(d), []);
  assert.deepEqual(migrateDeal(d), []);
  assert.ok(tooNew({ moneyVersion: MONEY_VERSION + 1 }));
  assert.ok(!tooNew({}) && !tooNew({ schema: SCHEMA, moneyVersion: MONEY_VERSION }));
  const raw = JSON.parse(fs.readFileSync(FIX + BACKUPS['3.1.0'], 'utf8'));
  raw.deals[2].schema = SCHEMA + 1;
  assert.throws(() => readBackup(raw), /a deal saved by a newer version.*4410 Example Avenue NW.*Nothing was restored/);
});

test('the restore says which deals an older version saved, and what bringing them up to date changes', () => {
  assert.match(planRestore(load('3.1.0'), empty).summary.join(' '), /3 deals saved by an older version are brought up to date as they are restored: money rounded to whole cents \(1\), rent roll set up \(3\)\./);
  assert.match(planRestore(load('3.3.0'), empty).summary.join(' '), /1 deal saved by an older version is brought up to date as it is restored: money rounded to whole cents \(1\)\./);
  // working it out changes nothing in the backup
  const b = load('3.1.0');
  planRestore(b, empty);
  assert.ok(b.deals.every((d) => d.rr === undefined && d.moneyVersion === undefined));
  // a deal already up to date isn't mentioned
  const cur = load('3.1.0');
  for (const d of cur.deals) migrateDeal(d);
  assert.ok(!/older version/.test(planRestore(cur, empty).summary.join(' ')));
});
