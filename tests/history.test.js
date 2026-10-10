/* history.js: comparing two copies of a deal and applying the difference
 * forwards and backwards (checkpoint d). The property: for any pair of deals,
 * applying diff(a, b) to a gives b, and applying it backwards to b gives a. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffDeal, applyChanges, getPath, labelFor, deepSame, copyDeal } from '../app/history.js';

let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const lease = (i) => ({ id: `l${i}`, unit: String(100 + i), tenant: pick(['', 'A', 'B']), sf: Math.round(rnd() * 5000), vacant: rnd() < 0.1, periods: [{ start: '2025-01-01', end: '2030-12-31', rate: Math.round(rnd() * 1e5), unit: 'year' }], abatements: rnd() < 0.3 ? [{ start: '2025-01-01', end: '2025-03-31', pct: 100 }] : [], custom: {} });
const photo = (i) => ({ id: `p${i}`, at: i, name: `IMG_${i}.jpg`, blob: new Blob([`photo ${i}`], { type: 'image/jpeg' }) });
function deal() {
  return {
    id: 'd1', name: 'Test', updatedAt: 1, figures: { price: 6450000, noi: 393450, cap: 6.1 }, loan: { ltv: 65, rate: 6.75 },
    live: rnd() < 0.5 ? { exitCap: 7 } : {}, scenarios: [{ id: 's1', name: 'One', over: { hold: 5 } }],
    rr: { settings: { asOf: '2026-06-30', opex: 135750 }, leases: Array.from({ length: 8 }, (_, i) => lease(i)) },
    visit: { notes: '', photos: [photo(1), photo(2)], audio: [] }, myQuestions: ['Why?'], when: new Date('2026-01-01T00:00:00Z'),
  };
}
function mutate(d) {
  const n = 1 + Math.floor(rnd() * 6);
  for (let k = 0; k < n; k++) {
    const r = rnd();
    const L = d.rr.leases;
    if (r < 0.15 && L.length) L.splice(Math.floor(rnd() * L.length), 1);
    else if (r < 0.3) L.splice(Math.floor(rnd() * (L.length + 1)), 0, lease(100 + Math.floor(rnd() * 1e6)));
    else if (r < 0.5 && L.length) pick(L).periods[0].rate = Math.round(rnd() * 1e5);
    else if (r < 0.55 && L.length) pick(L).periods.push({ start: '2031-01-01', end: '2035-12-31', rate: 1, unit: 'year' });
    else if (r < 0.6) d.figures.price = rnd() < 0.2 ? undefined : Math.round(rnd() * 1e7);
    else if (r < 0.65) d.figures[`x${k}`] = 'new field';
    else if (r < 0.7) d.visit.photos.splice(0, 1);
    else if (r < 0.75) d.visit.photos.push(photo(Math.floor(rnd() * 1e6)));
    else if (r < 0.8) d.live = { ...d.live, hold: Math.round(rnd() * 10) };
    else if (r < 0.85) d.myQuestions = rnd() < 0.5 ? [] : ['Why?', 'When?'];
    else if (r < 0.9) d.when = new Date(Math.round(rnd() * 1e12));
    else if (r < 0.95 && L.length > 1) { const [x] = L.splice(0, 1); L.push(x); } // a reorder
    else d.name = `Test ${k}`;
  }
  d.updatedAt += 1;
  return d;
}
const cloneDeal = (d) => copyDeal(d); // Blobs are shared, as in the app
const bare = (d) => { const c = { ...d }; delete c.updatedAt; return c; };

test('applying the difference forwards and backwards gives back each copy exactly', () => {
  for (let k = 0; k < 400; k++) {
    const a = deal(); const b = mutate(cloneDeal(a));
    const ch = diffDeal(a, b);
    const fwd = cloneDeal(a);
    assert.deepEqual(applyChanges(fwd, ch), []);
    assert.ok(deepSame(bare(fwd), bare(b)), `forwards, case ${k}`);
    const back = cloneDeal(b);
    assert.deepEqual(applyChanges(back, ch, { backwards: true }), []);
    assert.ok(deepSame(bare(back), bare(a)), `backwards, case ${k}`);
    // and the order of leases comes back too
    assert.deepEqual(back.rr.leases.map((x) => x.id), a.rr.leases.map((x) => x.id), `order, case ${k}`);
  }
});

test('items with ids are found by id, so a path survives other items moving', () => {
  const a = deal(); const b = cloneDeal(a);
  b.rr.leases[5].periods[0].rate = 42;
  const ch = diffDeal(a, b);
  assert.equal(ch.length, 1);
  assert.deepEqual(ch[0].path, ['rr', 'leases', { id: 'l5' }, 'periods', 0, 'rate']);
  b.rr.leases.splice(0, 2); // two leases before it go
  assert.equal(getPath(b, ch[0].path), 42);
  assert.equal(labelFor(ch, b), `Rent, unit 105: ${a.rr.leases[5].periods[0].rate.toLocaleString('en-US')} → 42`);
});

test('the safety check refuses an undo when a value has changed since', () => {
  const a = deal(); const b = cloneDeal(a);
  b.figures.price = 7000000;
  const ch = diffDeal(a, b);
  b.figures.price = 7100000; // edited again, by something not recorded
  const stale = applyChanges(b, ch, { backwards: true });
  assert.deepEqual(stale, [['figures', 'price']]);
  assert.equal(b.figures.price, 7100000, 'nothing applied');
});

test('fields that change on every save are not recorded', () => {
  const a = deal(); const b = cloneDeal(a);
  b.updatedAt = 99; b.moneyVersion = 1;
  assert.deepEqual(diffDeal(a, b), []);
});

/* ------------------------------------------------ entries and undo order */
import { historyEntry, undoState, inverseOf, withoutBytes, mediaRefs, withBytes, removedMedia, recordable, ENTRY_MAX, UNDO_STEPS } from '../app/history.js';

const E = (id, kind = 'edit', extra = {}) => ({ id, kind, label: id, changes: [], ...extra });

test('undo and redo follow the history: last in, first out; a new action clears redo; rounding is never undone', () => {
  assert.deepEqual(undoState([E('c', 'create')]), { undo: null, redo: null, done: [] });
  let h = [E('c', 'create'), E('a'), E('r', 'rounding'), E('b')];
  assert.equal(undoState(h).undo.id, 'b');
  h = [...h, E('u1', 'undo', { undoes: ['b'] })];
  assert.equal(undoState(h).undo.id, 'a', 'the rounding entry between is skipped');
  assert.equal(undoState(h).redo.id, 'b');
  h = [...h, E('u2', 'undo', { undoes: ['a'] })];
  assert.equal(undoState(h).undo, null);
  assert.equal(undoState(h).redo.id, 'a', 'redo puts back the last undone first');
  h = [...h, E('r1', 'redo', { redoes: 'a' })];
  assert.equal(undoState(h).undo.id, 'a');
  assert.equal(undoState(h).redo.id, 'b');
  h = [...h, E('x')];
  assert.equal(undoState(h).redo, null, 'a new action clears redo');
  assert.equal(undoState(h).undo.id, 'x');
});

test('undo to here undoes several steps as one, and redo then brings them back one at a time, oldest first', () => {
  const h = [E('a'), E('b'), E('c'), E('u', 'undo', { undoes: ['c', 'b'] })];
  const st = undoState(h);
  assert.equal(st.undo.id, 'a');
  assert.equal(st.redo.id, 'b');
});

test(`undo goes back at most ${UNDO_STEPS} steps`, () => {
  const h = Array.from({ length: UNDO_STEPS + 20 }, (_, i) => E(`e${i}`));
  const st = undoState(h);
  assert.equal(st.done.length, UNDO_STEPS);
  assert.equal(st.done[0].id, 'e20');
});

test('an entry: what changed, labelled, with photo bytes kept out of it and removed photos listed for the trash', () => {
  const blob = new Blob(['jpeg bytes'], { type: 'image/jpeg' });
  const before = { id: 'd', figures: { noi: 393450 }, visit: { photos: [{ id: 'p1', name: 'front.jpg', blob }] }, updatedAt: 1 };
  const after = { id: 'd', figures: { noi: 400000 }, visit: { photos: [] }, updatedAt: 2 };
  const { entry, removed } = historyEntry(before, after, null, 5);
  assert.equal(entry.kind, 'edit');
  assert.equal(entry.at, 5);
  assert.equal(entry.changes.length, 2);
  assert.match(entry.label, /NOI|Photos/);
  const ref = entry.changes.find((c) => c.path[1] === 'photos');
  assert.deepEqual(ref.old.blob, { $media: 'p1' }, 'the bytes are a reference');
  assert.equal(removed.length, 1);
  assert.equal(removed[0].blob, blob, 'the removed photo goes to the trash with its bytes');
  // and back: the reference finds the bytes again
  assert.deepEqual([...mediaRefs(entry.changes)], ['p1']);
  const back = withBytes(entry.changes, new Map([['p1', blob]]));
  assert.equal(back.find((c) => c.path[1] === 'photos').old.blob, blob);
  assert.throws(() => withBytes(entry.changes, new Map()), /missing media/);
  assert.equal(historyEntry(before, { ...before, updatedAt: 9 }, null), null, 'nothing recorded changed: no entry');
});

test('the first save of a deal is its creation; an entry bigger than the limit keeps no change list', () => {
  assert.equal(historyEntry(null, { id: 'd' }).entry.kind, 'create');
  const big = { id: 'd', rr: { leases: Array.from({ length: 900 }, (_, i) => ({ id: `l${i}`, unit: String(i), note: 'x'.repeat(300) })) } };
  const { entry } = historyEntry({ id: 'd', rr: { leases: [] } }, big, { kind: 'import', snapshot: 's1' });
  assert.ok(JSON.stringify(withoutBytes(big)).length > ENTRY_MAX);
  assert.equal(entry.changes, null);
  assert.equal(entry.snapshot, 's1');
  assert.equal(entry.size, 900);
});

test('what is recorded leaves out bookkeeping and the flat rent roll the lease rent roll rebuilds', () => {
  const r = recordable({ id: 'd', updatedAt: 1, moneyVersion: 1, schema: 2, aiChat: [1], rentRoll: [1], rr: { leases: [] }, figures: {} });
  assert.deepEqual(Object.keys(r).sort(), ['figures', 'id', 'rr']);
  assert.deepEqual(Object.keys(recordable({ id: 'd', rentRoll: [1] })), ['id', 'rentRoll'], 'kept when there is no lease rent roll');
});

test('the inverse of a change list undoes it', () => {
  const a = deal(); const b = mutate(cloneDeal(a));
  const ch = diffDeal(a, b);
  const back = cloneDeal(b);
  assert.deepEqual(applyChanges(back, inverseOf(ch)), []);
  assert.ok(deepSame(bare(back), bare(a)));
  assert.deepEqual(removedMedia([{ path: ['x'], old: [{ id: 1, blob: new Blob(['a']) }], new: [] }]).length, 1);
});

/* ------------------------------------------------------------ snapshots */
import { snapshotData, restoreInto } from '../app/history.js';

test('restoring a snapshot puts every recorded field back, removes ones it didn’t have, and keeps the deal’s identity', () => {
  const blob = new Blob(['jpeg'], { type: 'image/jpeg' });
  const d = { id: 'd1', createdAt: 5, updatedAt: 9, figures: { noi: 393450 }, loan: { ltv: 65 }, visit: { photos: [{ id: 'p1', name: 'front.jpg', blob }] } };
  const data = snapshotData(d);
  assert.deepEqual(data.visit.photos[0].blob, { $media: 'p1' }, 'a snapshot holds a reference, not the bytes');
  d.figures.noi = 400000; d.extra = 'added later'; d.visit.photos = []; d.loan.ltv = 70;
  const missing = restoreInto(d, data, new Map([['p1', blob]]));
  assert.deepEqual(missing, []);
  assert.equal(d.figures.noi, 393450);
  assert.equal(d.loan.ltv, 65);
  assert.equal('extra' in d, false, 'a field the snapshot didn’t have is removed');
  assert.equal(d.visit.photos[0].blob, blob, 'the photo’s bytes come back');
  assert.equal(d.id, 'd1'); assert.equal(d.createdAt, 5); assert.equal(d.updatedAt, 9);
});

test('a photo whose bytes are no longer kept is left out of a restore, and named', () => {
  const d = { id: 'd', visit: { photos: [{ id: 'p1', name: 'front.jpg', blob: new Blob(['x']) }] } };
  const data = snapshotData(d);
  d.visit.photos = [];
  assert.deepEqual(restoreInto(d, data, new Map()), ['front.jpg']);
  assert.deepEqual(d.visit.photos, []);
});
