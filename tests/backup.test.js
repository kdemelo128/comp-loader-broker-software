/* The backup: everything survives a round trip (photos, template bytes,
 * dates), the AI token never goes in, and a restore merges without losing
 * newer work on the device. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBackup, readBackup, planRestore, encodeValue, decodeValue } from '../app/backup.js';

const deal = (id, updatedAt, extra = {}) => ({ id, name: id, updatedAt, figures: { price: 1e6 }, visit: { photos: [], audio: [] }, ...extra });

test('round trip: blobs, bytes and dates come back as they went in', async () => {
  const photo = new Blob([new Uint8Array([1, 2, 3, 250])], { type: 'image/jpeg' });
  const tpl = new Uint8Array([80, 75, 3, 4, 0, 255]);
  const when = new Date('2026-03-01T12:00:00Z');
  const b = await buildBackup({
    deals: [deal('d1', 5, { visit: { photos: [{ id: 'p', blob: photo }], audio: [] } })],
    kv: { 'tpl.library': [{ id: 't1', versions: [{ bytes: tpl }] }], 'ai.settings': { url: 'https://ai.example', token: 'SECRET-TOKEN', enabled: true } },
    session: { comps: [{ date: when }] }, local: { 'comp-loader.loan.v1': '{"ltv":60}' }, appVersion: '3.2.0',
  });
  const text = JSON.stringify(b);
  assert.ok(!text.includes('SECRET-TOKEN'), 'the AI token is never written to a backup');
  assert.equal(b.counts.deals, 1);
  const r = readBackup(text);
  const back = r.deals[0].visit.photos[0].blob;
  assert.ok(back instanceof Blob);
  assert.equal(back.type, 'image/jpeg');
  assert.deepEqual([...new Uint8Array(await back.arrayBuffer())], [1, 2, 3, 250]);
  assert.deepEqual([...r.kv['tpl.library'][0].versions[0].bytes], [...tpl]);
  assert.equal(r.session.comps[0].date.toISOString(), when.toISOString());
  assert.equal(r.kv['ai.settings'].url, 'https://ai.example');
  assert.deepEqual(decodeValue(await encodeValue({ a: [1, 'x', null, { b: true }] })), { a: [1, 'x', null, { b: true }] });
});

test('reading the wrong file says what it is', () => {
  assert.throws(() => readBackup('not json'), /not valid JSON/);
  assert.throws(() => readBackup('{"format":"comp-loader-project"}'), /comp project file/);
  assert.throws(() => readBackup('{"format":"comp-loader-backup","version":99}'), /newer version/);
});

test('merge: newer wins, nothing on the device is lost', () => {
  const current = {
    deals: [deal('a', 100), deal('b', 300)],
    kv: { 'crm.tasks': [{ id: 't1', title: 'here' }], 'crm.contacts': [{ id: 'c1', name: 'Old', updatedAt: 1 }], 'ai.settings': { url: 'u', token: 'T' } },
    session: { comps: [] }, local: { 'comp-loader.loan.v1': 'here' },
  };
  const backup = {
    deals: [deal('a', 200), deal('b', 100), deal('c', 50)],
    kv: { 'crm.tasks': [{ id: 't1', title: 'there' }, { id: 't2', title: 'new' }], 'crm.contacts': [{ id: 'c1', name: 'New', updatedAt: 9 }], 'rr.layouts': [{ id: 'L' }], 'ai.settings': { url: 'other' } },
    session: { comps: [1] }, local: { 'comp-loader.loan.v1': 'there', 'comp-loader.tools.v1': 'tools' },
  };
  const p = planRestore(backup, current);
  assert.deepEqual(p.deals.put.map((d) => d.id), ['a', 'c'], 'a newer copy of a, and c which is new; b is newer here');
  assert.equal(p.deals.added, 1);
  assert.equal(p.deals.updated, 1);
  assert.deepEqual(p.removeDeals, []);
  assert.deepEqual(p.kv['crm.tasks'].map((t) => t.title), ['here', 'new'], 'a task on both sides is kept as it is here');
  assert.equal(p.kv['crm.contacts'][0].name, 'New', 'a newer contact replaces the older');
  assert.deepEqual(p.kv['rr.layouts'], [{ id: 'L' }], 'a setting the device lacks is added');
  assert.ok(!('ai.settings' in p.kv), 'the device’s own AI settings are left alone');
  assert.equal(p.session, null, 'the comp set on the device is not overwritten');
  assert.deepEqual(p.local, { 'comp-loader.tools.v1': 'tools' });
});

test('replace: the backup wins, and the device’s AI token is kept', () => {
  const current = { deals: [deal('a', 1), deal('z', 1)], kv: { 'ai.settings': { url: 'u', token: 'T' }, 'crm.tasks': [{ id: 1 }] }, session: null, local: {} };
  const backup = { deals: [deal('a', 0)], kv: { 'ai.settings': { url: 'b' } }, session: { s: 1 }, local: {} };
  const p = planRestore(backup, current, 'replace');
  assert.deepEqual(p.removeDeals, ['z']);
  assert.deepEqual(p.deals.put.map((d) => d.id), ['a'], 'even an older copy, when replacing');
  assert.deepEqual(p.kv['ai.settings'], { url: 'b', token: 'T' });
  assert.deepEqual(p.removeKv, ['crm.tasks']);
});
