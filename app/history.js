/* history.js -- what changed in a deal, as data: the comparison, applying a
 * change forwards or backwards, and labels a person can read. Pure: the
 * storage and the screens are elsewhere (store.js, dealui.js).
 *
 * A change is { path, old, new } (plus `index` when a whole item with an id is
 * added or removed). A path is a list of steps: a property name, a position in
 * a list, or { id } for an item in a list of items that carry ids (leases,
 * scenarios, photos), so a path still points at the same lease after others
 * are added or removed. `undefined` on one side means the value wasn't there.
 *
 * Photo and recording bytes are never copied into a change: a Blob is kept as
 * the same Blob object (the browser shares it, it isn't duplicated), and the
 * history store replaces it with a reference before writing (mediaRefs). */

const isObj = (v) => v !== null && typeof v === 'object';
const isBlob = (v) => typeof Blob !== 'undefined' && v instanceof Blob;
const hasIds = (a) => a.length > 0 && a.every((x) => isObj(x) && (typeof x.id === 'string' || typeof x.id === 'number'));

function same(a, b) {
  if (Object.is(a, b)) return true;
  // a photo's bytes never change in place (a new photo gets a new id), so a Blob read back from storage is the same file
  if (isBlob(a) && isBlob(b)) return a.size === b.size && a.type === b.type;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime() || (Number.isNaN(a.getTime()) && Number.isNaN(b.getTime()));
  return false;
}

/** Fields that change on every save and say nothing about the deal itself. */
export const NOT_RECORDED = new Set(['updatedAt', 'moneyVersion']);

/** Every difference between two copies of a deal (a before, b after). */
export function diffDeal(a, b) {
  const out = [];
  walk(a, b, [], out, true);
  return out;
}

/** Nothing there: a field missing on one side and empty on the other is no change (a deal opened fills in empty defaults). */
const empty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) || (isObj(v) && !isBlob(v) && !(v instanceof Date) && !Array.isArray(v) && !Object.keys(v).length);

function walk(a, b, path, out, top = false) {
  if (same(a, b)) return;
  if (isBlob(a) || isBlob(b) || !isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b) || a instanceof Date || b instanceof Date) {
    out.push({ path, old: a, new: b });
    return;
  }
  if (Array.isArray(a)) { walkList(a, b, path, out); return; }
  for (const k of Object.keys(a)) {
    if (top && NOT_RECORDED.has(k)) continue;
    if (!(k in b) || b[k] === undefined) { if (!empty(a[k])) out.push({ path: [...path, k], old: a[k], new: undefined }); continue; }
    walk(a[k], b[k], [...path, k], out);
  }
  for (const k of Object.keys(b)) {
    if (top && NOT_RECORDED.has(k)) continue;
    if ((!(k in a) || a[k] === undefined) && !empty(b[k])) out.push({ path: [...path, k], old: undefined, new: b[k] });
  }
}

function walkList(a, b, path, out) {
  if ((hasIds(a) || !a.length) && (hasIds(b) || !b.length) && (a.length || b.length)) {
    const before = new Map(a.map((x, i) => [x.id, i]));
    const after = new Map(b.map((x, i) => [x.id, i]));
    // the order of the items both sides keep must be the same, or the list is one change
    const keptA = a.filter((x) => after.has(x.id)).map((x) => x.id);
    const keptB = b.filter((x) => before.has(x.id)).map((x) => x.id);
    if (keptA.length === keptB.length && keptA.every((id, i) => id === keptB[i]) && before.size === a.length && after.size === b.length) {
      // removals first (highest position first), so undoing them in reverse puts each back where it was
      for (let i = a.length - 1; i >= 0; i--) if (!after.has(a[i].id)) out.push({ path: [...path, { id: a[i].id }], old: a[i], new: undefined, index: i });
      for (const x of b) if (before.has(x.id)) walk(a[before.get(x.id)], x, [...path, { id: x.id }], out);
      b.forEach((x, i) => { if (!before.has(x.id)) out.push({ path: [...path, { id: x.id }], old: undefined, new: x, index: i }); });
      return;
    }
    out.push({ path, old: a, new: b });
    return;
  }
  if (a.length !== b.length) { out.push({ path, old: a, new: b }); return; }
  for (let i = 0; i < a.length; i++) walk(a[i], b[i], [...path, i], out);
}

/* ------------------------------------------------------------- applying */

function step(container, s) {
  if (container === null || container === undefined) return undefined;
  if (isObj(s)) return Array.isArray(container) ? container.find((x) => isObj(x) && x.id === s.id) : undefined;
  return container[s];
}

/** The value at `path` in `obj`, or undefined. */
export function getPath(obj, path) {
  let v = obj;
  for (const s of path) { v = step(v, s); if (v === undefined) return undefined; }
  return v;
}

/** Set (or, with undefined, remove) the value at `path`. Containers along the way are made if missing. */
function setPath(obj, path, value, index) {
  if (!path.length) throw new Error('A change needs a path.');
  let c = obj;
  for (let i = 0; i < path.length - 1; i++) {
    let next = step(c, path[i]);
    if (next === undefined || next === null) {
      if (isObj(path[i])) throw new Error('A changed item is missing.');
      next = typeof path[i + 1] === 'number' || isObj(path[i + 1]) ? [] : {};
      c[path[i]] = next;
    }
    c = next;
  }
  const last = path[path.length - 1];
  if (isObj(last)) {
    const at = c.findIndex((x) => isObj(x) && x.id === last.id);
    if (value === undefined) { if (at >= 0) c.splice(at, 1); return; }
    if (at >= 0) c[at] = value; else c.splice(Math.max(0, Math.min(index ?? c.length, c.length)), 0, value);
    return;
  }
  if (value === undefined) { if (Array.isArray(c)) c.splice(last, 1); else delete c[last]; return; }
  c[last] = value;
}

/** A deep copy that shares Blobs (photo and recording bytes are never duplicated). */
export function copyDeal(v) {
  if (!isObj(v) || isBlob(v)) return v;
  if (v instanceof Date) return new Date(v.getTime());
  if (Array.isArray(v)) return v.map(copyDeal);
  const out = {};
  for (const k of Object.keys(v)) out[k] = copyDeal(v[k]);
  return out;
}
const copy = copyDeal;

/**
 * Apply changes to `obj`: forwards (each path gets `new`) or backwards (each
 * gets `old`, in reverse order). Returns the paths whose current value isn't
 * what the change expects -- the safety check; nothing is applied then.
 */
export function applyChanges(obj, changes, { backwards = false } = {}) {
  const list = backwards ? [...changes].reverse() : changes;
  const stale = [];
  for (const c of list) {
    const expect = backwards ? c.new : c.old;
    if (!deepSame(getPath(obj, c.path), expect)) stale.push(c.path);
  }
  if (stale.length) return stale;
  for (const c of list) setPath(obj, c.path, copy(backwards ? c.old : c.new), c.index);
  return [];
}

/** Value equality for the safety check (Blobs by identity or by their media reference). */
export function deepSame(a, b) {
  if (same(a, b)) return true;
  if (isBlob(a) || isBlob(b)) return false;
  if (a instanceof Date || b instanceof Date) return false;
  if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) return a === undefined && b === undefined;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepSame(x, b[i]));
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k]; const y = b[k];
    if ((x === undefined && empty(y)) || (y === undefined && empty(x))) continue;
    if (!deepSame(x, y)) return false;
  }
  return true;
}

/* --------------------------------------------------------------- labels */

const FIELD = {
  price: 'Price', noi: 'NOI', cap: 'Cap rate', gpr: 'Gross potential rent', gross: 'Gross income', opex: 'Operating expenses', taxes: 'Taxes',
  occ: 'Occupancy', bsf: 'Building SF', lot_sf: 'Lot SF', units: 'Units', year: 'Year built', address: 'Address', name: 'Name', ptype: 'Property type',
  annual: 'Annual rent', monthly: 'Monthly rent', rate: 'Rent', sf: 'SF', tenant: 'Tenant', unit: 'Unit', leaseStart: 'Lease start', leaseEnd: 'Lease end',
  marketRent: 'Market rent', stage: 'Stage', notes: 'Notes', ltv: 'Loan-to-value', amort: 'Amortization', hold: 'Hold', exitCap: 'Exit cap', growth: 'NOI growth',
};
const short = (v) => {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { maximumFractionDigits: 4 });
  if (typeof v === 'string') return v.length > 40 ? `${v.slice(0, 39)}…` : v;
  if (isBlob(v)) return 'a file';
  return Array.isArray(v) ? `${v.length} item${v.length === 1 ? '' : 's'}` : 'details';
};

/** A rounding's place, from engine/money.js's path text ('figures.price', 'rr.leases[0] (unit 100).periods[0].rate'), in words. */
export function roundedPlace(text) {
  const leaf = String(text).split('.').pop().replace(/\[\d+\]/g, '');
  const name = FIELD[leaf] || leaf.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
  const unit = /\(unit ([^)]+)\)/.exec(text);
  return unit ? `${name}, unit ${unit[1]}` : name;
}

/** Where a path points, in words: "Annual rent, unit 1003", "Price", "Loan: Loan-to-value". */
export function placeOf(path, deal) {
  const keys = path.filter((s) => typeof s === 'string');
  const leaf = keys[keys.length - 1];
  const name = FIELD[leaf] || (leaf ? leaf.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()) : 'The deal');
  const li = path.findIndex((s, i) => isObj(s) && path[i - 1] === 'leases');
  if (li >= 0) {
    const lease = deal ? getPath(deal, path.slice(0, li + 1)) : null;
    const who = lease && (lease.unit || lease.tenant) ? `unit ${lease.unit || lease.tenant}` : 'a unit';
    return li === path.length - 1 ? `Unit ${lease && lease.unit ? lease.unit : ''}`.trim() : `${name}, ${who}`;
  }
  if (keys[0] === 'sources' && keys[1]) return `Where ${FIELD[keys[1]] || keys[1]} came from`;
  if (keys[0] === 'loan') return `Loan: ${name}`;
  if (keys[0] === 'live') return `What if: ${name}`;
  if (keys[0] === 'rr' && keys[1] === 'settings') return `Rent roll assumptions: ${name}`;
  return name;
}

/* Bookkeeping that follows another change (where a figure came from, the
 * stage's log, when the site was visited): named only if nothing else changed. */
const FOLLOWS = [['sources'], ['stageHistory'], ['visit', 'at']];
const follows = (c) => FOLLOWS.some((p) => p.every((s, i) => c.path[i] === s));

/** A label for a group of changes: the one change in words, or a count. */
export function labelFor(all, deal, given) {
  if (given) return given;
  const main = all.filter((c) => !follows(c));
  const changes = main.length ? main : all;
  if (!changes.length) return 'No change';
  if (changes.length === 1) {
    const c = changes[0];
    const where = placeOf(c.path, deal);
    if (c.old === undefined && isObj(c.new)) return `Added ${where.toLowerCase().startsWith('unit') ? where : `to ${where}`}`;
    if (c.new === undefined && isObj(c.old)) return `Removed ${where}`;
    return `${where}: ${short(c.old)} → ${short(c.new)}`;
  }
  const places = [...new Set(changes.map((c) => placeOf(c.path, deal)))];
  return places.length <= 2 ? places.join('; ') : `${changes.length} changes (${places.slice(0, 2).join('; ')}, …)`;
}

/* -------------------------------------------------- entries and undo */

/** Top-level fields that are not the deal's own data: bookkeeping, a copy the app rebuilds, the AI chat (its own log). */
const SKIP_TOP = ['updatedAt', 'moneyVersion', 'schema', 'aiChat'];

/** The part of a deal history records: without bookkeeping, and without the flat rent roll the lease rent roll rebuilds. */
export function recordable(d) {
  if (!d) return d;
  const out = { ...d };
  for (const k of SKIP_TOP) delete out[k];
  if (out.rr && Array.isArray(out.rr.leases)) delete out.rentRoll;
  return out;
}

/** The largest change list kept in one entry; a bigger one points at the snapshot taken before it (or can't be undone). */
export const ENTRY_MAX = 256 * 1024;

const isMedia = (v) => isObj(v) && isBlob(v.blob) && (typeof v.id === 'string' || typeof v.id === 'number');

/** Changes ready to store: photo and recording bytes replaced by { $media: id } (the bytes stay in the deal, or in the trash). */
export function withoutBytes(v) {
  if (isMedia(v)) return { ...withoutBytesObj(v), blob: { $media: String(v.id) } };
  if (isBlob(v)) return { $media: null };
  if (Array.isArray(v)) return v.map(withoutBytes);
  if (isObj(v) && !(v instanceof Date)) return withoutBytesObj(v);
  return v;
}
function withoutBytesObj(v) { const o = {}; for (const k of Object.keys(v)) o[k] = withoutBytes(v[k]); return o; }

/** Every media id a stored change refers to. */
export function mediaRefs(v, out = new Set()) {
  if (isObj(v) && '$media' in v && Object.keys(v).length === 1) { if (v.$media) out.add(v.$media); return out; }
  if (Array.isArray(v)) v.forEach((x) => mediaRefs(x, out));
  else if (isObj(v) && !isBlob(v) && !(v instanceof Date)) Object.values(v).forEach((x) => mediaRefs(x, out));
  return out;
}

/** A stored value with its media references swapped back for the bytes (`blobs`: id -> Blob). Throws if one is gone. */
export function withBytes(v, blobs) {
  if (isObj(v) && '$media' in v && Object.keys(v).length === 1) {
    if (!v.$media || !blobs.has(v.$media)) throw new Error('missing media');
    return blobs.get(v.$media);
  }
  if (Array.isArray(v)) return v.map((x) => withBytes(x, blobs));
  if (isObj(v) && !isBlob(v) && !(v instanceof Date)) { const o = {}; for (const k of Object.keys(v)) o[k] = withBytes(v[k], blobs); return o; }
  return v;
}

/** Photos and recordings a change list removes from the deal: they go to the trash, so an undo can bring them back. */
export function removedMedia(changes) {
  const out = [];
  const visit = (old, nw) => {
    if (isMedia(old) && !(isMedia(nw) && nw.id === old.id)) { out.push(old); return; }
    if (Array.isArray(old)) { const keep = new Set((Array.isArray(nw) ? nw : []).filter(isMedia).map((x) => x.id)); for (const x of old) if (isMedia(x) && !keep.has(x.id)) out.push(x); else if (isObj(x)) visit(x, undefined); return; }
    if (isObj(old) && !isBlob(old) && !(old instanceof Date)) for (const k of Object.keys(old)) visit(old[k], isObj(nw) ? nw[k] : undefined);
  };
  for (const c of changes) visit(c.old, c.new);
  return out;
}

const newId = () => `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/**
 * The history entry for one save: what changed from `before` (the stored
 * copy) to `after`, with its kind and label. Null when nothing recorded
 * changed. meta: { kind, label, undoes: [ids], redoes: id, rounded: [{ path,
 * old, new }], snapshot: id }. Also returns the media the change removed.
 */
export function historyEntry(before, after, meta = {}, now = Date.now()) {
  const m = meta || {};
  if (!before) return { entry: { id: newId(), at: now, kind: m.kind || 'create', label: m.label || 'Deal created', changes: [] }, removed: [] };
  const changes = diffDeal(recordable(before), recordable(after));
  if (!changes.length && !(m.rounded && m.rounded.length) && !m.always) return null;
  const stored = withoutBytes(changes);
  const big = changes.length && JSON.stringify(stored).length > ENTRY_MAX;
  const entry = { id: newId(), at: now, kind: m.kind || 'edit', label: labelFor(changes, after, m.label), changes: big ? null : stored };
  if (big) entry.size = changes.length;
  if (m.snapshot) entry.snapshot = m.snapshot; // the automatic snapshot taken just before
  if (m.undoes) entry.undoes = m.undoes;
  if (m.redoes) entry.redoes = m.redoes;
  if (m.rounded && m.rounded.length) entry.rounded = m.rounded;
  return { entry, removed: removedMedia(changes) };
}

/** Undo depth per deal. */
export const UNDO_STEPS = 100;

/**
 * What Undo and Redo would do now, from the deal's history (oldest first):
 * { undo: entry | null, redo: entry | null, done: [entries that can be undone, oldest first] }.
 * Entries that aren't actions (the deal's creation, rounding) are never undone;
 * a new action after an undo clears Redo.
 */
export function undoState(entries) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  let done = []; let redo = [];
  for (const e of entries) {
    if (e.kind === 'undo') {
      const ids = new Set(e.undoes || []);
      const gone = done.filter((x) => ids.has(x.id));
      done = done.filter((x) => !ids.has(x.id));
      redo.push(...gone.reverse()); // the most recently undone is redone first
    } else if (e.kind === 'redo') {
      const x = byId.get(e.redoes);
      redo = redo.filter((y) => y.id !== e.redoes);
      if (x) done.push(x);
    } else if (e.kind !== 'create' && e.kind !== 'rounding') {
      done.push(e);
      redo = [];
    }
  }
  done = done.slice(-UNDO_STEPS);
  const top = done[done.length - 1] || null;
  return { undo: top, redo: redo[redo.length - 1] || null, done };
}

/** The changes that undo `entries` (newest first) as one: each list backwards, in reverse order. */
export function inverseOf(changes) {
  return [...changes].reverse().map((c) => ({ path: c.path, old: c.new, new: c.old, ...(c.index !== undefined ? { index: c.index } : {}) }));
}

/* ------------------------------------------------------------ snapshots */

/** Snapshots kept per deal: named ones (a person deletes one to make room) and automatic ones (the oldest goes). */
export const SNAPSHOTS = { manual: 20, auto: 10 };

/** A snapshot's copy of a deal: what history records, with photo and recording bytes as references. */
export const snapshotData = (deal) => withoutBytes(recordable(deal));

/**
 * Put a snapshot's data back into `deal` (in place): every recorded field
 * becomes the snapshot's, and fields the snapshot didn't have are removed.
 * The deal's id, creation time and bookkeeping stay. `blobs` (id -> Blob)
 * supplies photo and recording bytes; a photo or recording whose bytes are no
 * longer kept is left out. Returns the names of what was left out.
 */
export function restoreInto(deal, data, blobs) {
  const missing = [];
  const fill = (v) => {
    if (isObj(v) && '$media' in v && Object.keys(v).length === 1) return blobs.get(v.$media);
    if (Array.isArray(v)) {
      return v.map(fill).filter((x, i) => {
        const was = v[i];
        if (isObj(was) && isObj(was.blob) && '$media' in was.blob && !(x && isBlob(x.blob))) { missing.push(was.name || 'a photo'); return false; }
        return true;
      });
    }
    if (isObj(v) && !isBlob(v) && !(v instanceof Date)) { const o = {}; for (const k of Object.keys(v)) o[k] = fill(v[k]); return o; }
    return v;
  };
  const keep = new Set(['id', 'createdAt', ...SKIP_TOP]);
  for (const k of Object.keys(recordable(deal))) if (!keep.has(k) && !(k in data)) delete deal[k];
  for (const [k, v] of Object.entries(data)) if (!keep.has(k)) deal[k] = fill(v);
  return missing;
}
