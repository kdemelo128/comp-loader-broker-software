/* The rename from Comp Loader to Zlatura: files and settings made under the
 * old name keep working. The backup fixture was made by the real 3.3.0 app
 * (tests/e2e/rename-flow.mjs records how), not written by hand. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readBackup, planRestore, LOCAL_KEYS, BACKUP_FORMAT } from '../app/backup.js';
import { readPackage, PACKAGE_FORMAT } from '../app/library.js';
import { readProject, FORMAT } from '../app/store.js';
import { migrateLocalKeys, removeOldLocalKeys, renameKey, RENAMED_FLAG, FORMATS } from '../app/brand.js';

const OLD = fs.readFileSync(new URL('./fixtures/backup-comp-loader-3.3.0.json', import.meta.url), 'utf8');

test('a backup made by Comp Loader 3.3.0 reads and restores', async () => {
  const b = readBackup(OLD);
  assert.equal(b.format, 'comp-loader-backup');
  assert.equal(b.app, '3.3.0');
  assert.equal(b.deals.length, 1);
  assert.equal(b.deals[0].name, '4410 Example Avenue NW');
  assert.equal(b.deals[0].figures.price, 6450000);
  const photo = b.deals[0].visit.photos[0].blob;
  assert.ok(photo instanceof Blob && photo.size > 1000 && photo.type === 'image/jpeg');
  assert.equal(b.kv['crm.tasks'][0].title, 'Call the listing broker');
  assert.equal(b.kv['crm.contacts'][0].name, 'Dana Whitlock');
  assert.ok(Array.isArray(b.session.docs) && b.session.docs.length === 1);
  // its settings come back under the new key names
  assert.deepEqual(Object.keys(b.local), ['zlatura.loan.v1']);
  assert.equal(JSON.parse(b.local['zlatura.loan.v1']).ltv, 60);
  // restoring it onto an empty device puts everything back
  const p = planRestore(b, { deals: [], kv: {}, session: null, local: {} });
  assert.equal(p.deals.put.length, 1);
  assert.equal(p.kv['crm.tasks'].length, 1);
  assert.equal(p.kv['crm.contacts'].length, 1);
  assert.ok(p.session && p.session.docs.length === 1);
  assert.deepEqual(Object.keys(p.local), ['zlatura.loan.v1']);
  assert.ok(LOCAL_KEYS.includes('zlatura.loan.v1'));
});

test('new files are written in the new formats; old format ids are still read', () => {
  assert.equal(BACKUP_FORMAT, 'zlatura-backup');
  assert.equal(FORMAT, 'zlatura-project');
  assert.equal(PACKAGE_FORMAT, 'zlatura-template');
  for (const f of ['comp-loader-project', 'zlatura-project']) {
    assert.equal(readProject({ format: f, version: 1, docs: [], edits: {}, manual: [] }).docs.length, 0, f);
  }
  for (const f of ['comp-loader-template', 'zlatura-template']) {
    assert.equal(readPackage(JSON.stringify({ format: f, workbook: 'UEsDBA==', name: 'T' })).name, 'T', f);
  }
  assert.throws(() => readProject({ format: 'something-else', version: 1 }), /not a Zlatura project/);
  assert.throws(() => readBackup('{"format":"zlatura-project"}'), /comp project file/);
  assert.deepEqual(FORMATS.backup.read, ['zlatura-backup', 'comp-loader-backup']);
});

const fakeStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    dump: () => Object.fromEntries(m),
  };
};

test('settings keys are copied to the new names once, and never overwrite a new value', () => {
  const ls = fakeStorage({ 'comp-loader.theme': 'dark', 'comp-loader.loan.v1': '{"ltv":60}', 'zlatura.tools.v1': 'new', 'comp-loader.tools.v1': 'old', 'other': 'x' });
  assert.equal(migrateLocalKeys(ls), 2);
  const d = ls.dump();
  assert.equal(d['zlatura.theme'], 'dark');
  assert.equal(d['zlatura.loan.v1'], '{"ltv":60}');
  assert.equal(d['zlatura.tools.v1'], 'new', 'an existing new key wins');
  assert.equal(d['comp-loader.theme'], 'dark', 'old keys are kept until the move is finished');
  assert.ok(d[RENAMED_FLAG]);
  // the app later deletes a key on purpose (the recovery copy of an unsaved deal); it must not come back
  ls.setItem('comp-loader.deal.unsaved', '{"stale":true}');
  ls.removeItem('zlatura.deal.unsaved');
  assert.equal(migrateLocalKeys(ls), 0);
  assert.equal(ls.getItem('zlatura.deal.unsaved'), null);
  assert.equal(removeOldLocalKeys(ls), 4);
  assert.ok(!Object.keys(ls.dump()).some((k) => k.startsWith('comp-loader.')));
  assert.equal(renameKey('comp-loader.subject.v1'), 'zlatura.subject.v1');
  assert.equal(renameKey('unrelated'), 'unrelated');
  assert.equal(migrateLocalKeys(null), 0);
});
