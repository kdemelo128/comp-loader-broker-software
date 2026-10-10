/* store.js -- keeping work on this device.
 *
 * A session is the extracted text of every PDF read, plus the changes made to
 * the comps and any comps typed in by hand. That is enough to rebuild the
 * whole comp set exactly, so it is what gets saved: to IndexedDB after every
 * change (so closing the app loses nothing), and to a project file on request
 * (so a comp set can move to another device or another person).
 *
 * Storage can be missing, full or blocked (a private window, a cleared site,
 * Safari's seven-day rule for sites not added to the home screen). Every call
 * here fails quietly, and the app works without it. */

import { FORMATS, PRODUCT, removeOldLocalKeys } from './brand.js';
import { quantizeDeal, quantizeSession } from './engine/money.js';
import { historyEntry, copyDeal, roundedPlace, SNAPSHOTS } from './history.js';

const DB = 'zlatura';
/** The database's name before the product was renamed (copied across once; see moveFromOld). */
export const OLD_DB = 'comp-loader';
const STORE = 'session';
const KEY = 'current';
const DATA_STORES = [STORE, 'deals', 'kv'];
export const FORMAT = FORMATS.project.write;
export const VERSION = 1;
/** How long the old database is kept when no backup has been made since the move. */
export const KEEP_OLD_MS = 30 * 86400000;

/* Three stores hold the data: the comp `session`, `deals` (one record per OM
 * analysed, with its site-visit photos as Blobs) and `kv` (templates, tasks,
 * contacts and small settings). A fourth, `meta`, records the move from the
 * old database and is never part of a backup.
 *
 * Version 2 (4.3) adds three, and changes nothing in the others: `history`
 * (each deal's changes, keyed [dealId, seq]), `snapshots` (named copies of a
 * deal, keyed [dealId, snapshotId]) and `trash` (photos and recordings removed
 * from a deal, kept 30 days so an undo can bring them back).
 *
 * One connection is kept open and reused. Opening a database is asynchronous,
 * and a save made as the app leaves the screen (pagehide) has to start its
 * transaction straight away, before the page is frozen, or it is lost. */
let dbP = null;
export const DB_VERSION = 2;
const HISTORY_STORES = ['history', 'snapshots', 'trash'];

/* Another tab can hold the database at an older version (an upgrade waits for
 * it to let go), or open it at a newer one (this tab is then out of date).
 * Either way the page says so and asks for a reload, rather than failing
 * quietly: 'blocked', 'outdated', or 'ok' once a wait is over. Edits made
 * meanwhile stay in the recovery copy (dealui.js) until a save succeeds. */
let outdated = false;
let status = 'ok';
function setStatus(next) {
  status = next;
  try { globalThis.dispatchEvent(new CustomEvent('zlatura:storage', { detail: { state: next } })); } catch { /* no events here (tests) */ }
}
/** 'ok', 'blocked' (waiting for an older tab) or 'outdated' (a newer version has the database). */
export const storageStatus = () => status;

function open() {
  if (dbP) return dbP;
  if (outdated) return Promise.reject(new Error('a newer version of the app has the database: reload to finish updating'));
  dbP = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) { reject(new Error('no IndexedDB')); return; }
    const req = indexedDB.open(DB, DB_VERSION);
    req.onupgradeneeded = () => {
      // only adds what is missing: nothing already stored is touched
      const db = req.result;
      for (const name of [...DATA_STORES, 'meta', ...HISTORY_STORES]) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    };
    req.onsuccess = () => {
      const db = req.result;
      if (status === 'blocked') setStatus('ok');
      // a newer version upgrading the database in another tab: let it, and say this tab needs a reload
      db.onversionchange = () => { db.close(); dbP = null; outdated = true; setStatus('outdated'); };
      db.onclose = () => { dbP = null; };
      // nothing reads or writes until the old database's data is here (or known not to exist)
      moveFromOld(db).catch(() => { /* retried at the next start; the old data is untouched */ })
        // money kept to whole cents (rates to four decimals): stored data rounded once, every change logged
        .then(() => migrateMoneyIn(db, { once: true })).catch(() => { /* retried at the next start */ })
        .then(() => resolve(db));
    };
    req.onerror = () => {
      // the database is already at a newer version than this code knows
      if (req.error && req.error.name === 'VersionError') { outdated = true; setStatus('outdated'); }
      reject(req.error);
    };
    // an older tab still has the database open: wait for it (the request carries on once it lets go)
    req.onblocked = () => setStatus('blocked');
  });
  dbP.catch(() => { dbP = null; });
  return dbP;
}

/* --------------------------------------------- the move from the old name */

const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const doneP = (t) => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('aborted')); });

/** Open a database only if it already exists; never creates one. Null if it doesn't. */
async function openExisting(name) {
  try {
    if (indexedDB.databases) {
      const list = await indexedDB.databases();
      if (!list.some((d) => d.name === name)) return null;
    }
  } catch { /* not supported: fall through to opening it */ }
  return new Promise((resolve) => {
    const r = indexedDB.open(name);
    // a brand-new (version 0) database means there was none: abort so it isn't created
    r.onupgradeneeded = (e) => { if (e.oldVersion === 0) r.transaction.abort(); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = (e) => { e.preventDefault?.(); resolve(null); };
    r.onblocked = () => resolve(null);
  });
}

/**
 * Copy the old database into this one, once. Everything is written in one
 * transaction, so the copy happens completely or not at all. The new stores
 * must be empty: data already here is never overwritten. The old database is
 * only read; finishRename deletes it later.
 */
export async function moveFromOld(db) {
  const prior = await reqP(db.transaction('meta').objectStore('meta').get('rename'));
  if (prior) return prior;
  const old = await openExisting(OLD_DB);
  const record = { at: Date.now(), from: null, copied: false, counts: {} };
  if (old) {
    try {
      const names = DATA_STORES.filter((n) => old.objectStoreNames.contains(n));
      const data = {};
      if (names.length) {
        const t = old.transaction(names);
        for (const n of names) {
          const os = t.objectStore(n);
          data[n] = { keys: reqP(os.getAllKeys()), vals: reqP(os.getAll()) };
        }
        for (const n of names) data[n] = { keys: await data[n].keys, vals: await data[n].vals };
      }
      const t2 = db.transaction([...DATA_STORES, 'meta'], 'readwrite');
      const counts = await Promise.all(DATA_STORES.map((n) => reqP(t2.objectStore(n).count())));
      record.from = OLD_DB;
      if (counts.every((c) => c === 0)) {
        for (const n of names) {
          const os = t2.objectStore(n);
          data[n].keys.forEach((k, i) => os.put(data[n].vals[i], k));
          record.counts[n] = data[n].keys.length;
        }
        record.copied = true;
      }
      t2.objectStore('meta').put(record, 'rename');
      await doneP(t2);
      return record;
    } finally { old.close(); }
  }
  const t3 = db.transaction('meta', 'readwrite');
  t3.objectStore('meta').put(record, 'rename');
  await doneP(t3);
  return record;
}

/* ------------------------------------------- money to whole cents (4.1) */

/** The version of the money rounding a stored deal or comp set has had. */
export const MONEY_VERSION = 1;
const dealName = (d) => d.name || (d.figures && d.figures.address) || 'Untitled deal';

/**
 * Round every stored deal's and the comp set's money that hasn't been rounded
 * yet (totals to whole cents, rates per unit to four decimals: engine/money.js),
 * and add each value changed, old and new, to the rounding log. One
 * transaction: all of it or none. With `once`, only on the first start of a
 * version that rounds (a restore runs it again for what it brought in).
 */
async function migrateMoneyIn(db, { once = false } = {}) {
  if (once && await reqP(db.transaction('meta').objectStore('meta').get('money'))) return [];
  const t = db.transaction(['deals', STORE, 'meta', 'history'], 'readwrite');
  const deals = t.objectStore('deals'); const sess = t.objectStore(STORE); const meta = t.objectStore('meta'); const hist = t.objectStore('history');
  const at = Date.now();
  const entries = [];
  const [keys, all, session, log, hkeys] = await Promise.all([reqP(deals.getAllKeys()), reqP(deals.getAll()), reqP(sess.get(KEY)), reqP(meta.get('rounding')), reqP(hist.getAllKeys())]);
  const lastSeq = new Map();
  for (const k of hkeys) lastSeq.set(k[0], Math.max(lastSeq.get(k[0]) || 0, k[1]));
  all.forEach((d, i) => {
    if (!d || (d.moneyVersion || 0) >= MONEY_VERSION) return;
    const before = copyDeal(d);
    const { changes } = quantizeDeal(d);
    for (const c of changes) entries.push({ at, where: `Deal: ${dealName(d)}`, ...c });
    d.moneyVersion = MONEY_VERSION;
    deals.put(d, keys[i]);
    // the deal's own history says so too (rounding is a record, never undone)
    const made = changes.length ? historyEntry(before, d, { kind: 'rounding', label: `Stored money rounded to whole cents (rates to four decimals): ${changes.length} value${changes.length === 1 ? '' : 's'}`, rounded: changes, always: true }, at) : null;
    if (made) { const seq = (lastSeq.get(d.id) || 0) + 1; lastSeq.set(d.id, seq); hist.put({ ...made.entry, seq }, [d.id, seq]); }
  });
  if (session && (session.moneyVersion || 0) < MONEY_VERSION) {
    const { changes } = quantizeSession(session);
    for (const c of changes) entries.push({ at, where: 'Comp set', ...c });
    session.moneyVersion = MONEY_VERSION;
    sess.put(session, KEY);
  }
  meta.put({ version: MONEY_VERSION, at }, 'money');
  if (entries.length) meta.put({ entries: [...((log && log.entries) || []), ...entries] }, 'rounding');
  await doneP(t);
  return entries;
}

/** Round what a restore (or anything else) brought in without rounding. Returns the logged changes. */
export async function migrateMoney() {
  try { return await migrateMoneyIn(await open()); } catch { return []; }
}

/** Every stored value the rounding changed: [{ at, where, path, old, new }]. */
export async function roundingLog() {
  try { const db = await open(); return ((await reqP(db.transaction('meta').objectStore('meta').get('rounding'))) || {}).entries || []; } catch { return []; }
}

/** Add changes made elsewhere (a deal opened from its recovery copy, saved Tools inputs) to the log. */
export async function logRounding(changes, where) {
  if (!changes || !changes.length) return;
  try {
    const db = await open();
    const t = db.transaction('meta', 'readwrite');
    const meta = t.objectStore('meta');
    const log = await reqP(meta.get('rounding'));
    const at = Date.now();
    meta.put({ entries: [...((log && log.entries) || []), ...changes.map((c) => ({ at, where, ...c }))] }, 'rounding');
    await doneP(t);
  } catch { /* the values are rounded either way; only the log entry is lost */ }
}

/** What the move did, for Settings and the tests. */
export async function renameInfo() {
  try { const db = await open(); return (await reqP(db.transaction('meta').objectStore('meta').get('rename'))) || null; } catch { return null; }
}

/**
 * Delete the old database and keys once that is safe: a backup has been made
 * since the move, or KEEP_OLD_MS has passed. Returns what it did.
 */
export async function finishRename({ now = Date.now(), ls = globalThis.localStorage } = {}) {
  let db;
  try { db = await open(); } catch { return 'no storage'; }
  const m = await reqP(db.transaction('meta').objectStore('meta').get('rename'));
  if (!m || !m.from || m.finishedAt) return 'nothing to do';
  const lastBackup = await reqP(db.transaction('kv').objectStore('kv').get('backup.last'));
  if (!(Number(lastBackup) > m.at) && now - m.at < KEEP_OLD_MS) return 'kept';
  const deleted = await new Promise((res) => {
    const r = indexedDB.deleteDatabase(OLD_DB);
    r.onsuccess = () => res(true); r.onerror = () => res(false); r.onblocked = () => res(false);
  });
  if (!deleted) return 'busy';
  removeOldLocalKeys(ls);
  const t = db.transaction('meta', 'readwrite');
  t.objectStore('meta').put({ ...m, finishedAt: now }, 'rename');
  await doneP(t);
  return 'finished';
}

async function tx(mode, fn, store = STORE) {
  const db = await open();
  return new Promise((resolve, reject) => {
    let t;
    try { t = db.transaction(store, mode); } catch (err) { dbP = null; reject(err); return; }
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function saveSession(session) {
  try { await tx('readwrite', (s) => s.put(session, KEY)); return true; } catch { return false; }
}

export async function loadSession() {
  try { return (await tx('readonly', (s) => s.get(KEY))) || null; } catch { return null; }
}

export async function clearSession() {
  try { await tx('readwrite', (s) => s.delete(KEY)); } catch { /* nothing to clear */ }
}

/* ----------------------------------------------------------------- deals */

/**
 * Save a deal, and record what changed since the stored copy as one history
 * entry, in the same transaction: both are written or neither. The deal is
 * written first, so a save started as the page goes away isn't held up.
 * meta: { kind, label, undoes, redoes, rounded, snapshot, always } (history.js).
 */
export async function saveDeal(deal, meta = null) {
  try {
    const db = await open();
    const t = db.transaction(['deals', 'history', 'trash'], 'readwrite');
    const deals = t.objectStore('deals'); const hist = t.objectStore('history'); const trash = t.objectStore('trash');
    const beforeP = reqP(deals.get(deal.id));
    deals.put(deal, deal.id);
    trash.delete(`deal:${deal.id}`); // a deal deleted and brought back
    const lastP = reqP(hist.openKeyCursor(IDBKeyRange.bound([deal.id, 0], [deal.id, Infinity]), 'prev'));
    const [before, last] = await Promise.all([beforeP, lastP]);
    // values rounded as they were saved are their own entry, after the edit: a record, never undone
    const { rounded, ...rest } = meta || {};
    const made = historyEntry(before, deal, rest);
    let seq = last ? last.key[1] : 0;
    const at = Date.now();
    if (made) {
      seq += 1;
      hist.put({ ...made.entry, seq }, [deal.id, seq]);
      for (const m of made.removed) trash.put({ kind: 'media', dealId: deal.id, id: String(m.id), name: m.name || '', blob: m.blob, removedAt: at }, String(m.id));
    }
    if (before && rounded && rounded.length) {
      seq += 1;
      const one = rounded.length === 1 ? `${roundedPlace(rounded[0].path)}: ${rounded[0].old} → ${rounded[0].new}` : `${rounded.length} values`;
      hist.put({ id: `r${at.toString(36)}${seq}`, seq, at, kind: 'rounding', label: `Rounded as saved, to whole cents (rates to four decimals): ${one}`, changes: [], rounded }, [deal.id, seq]);
    }
    await doneP(t);
    return true;
  } catch { return false; }
}

/** A deal's history, oldest first: [{ id, seq, at, kind, label, changes, … }]. */
export async function historyOf(dealId) {
  try {
    const db = await open();
    return (await reqP(db.transaction('history').objectStore('history').getAll(IDBKeyRange.bound([dealId, 0], [dealId, Infinity])))) || [];
  } catch { return []; }
}

/** Removed photos and recordings by id: id -> Blob (what the trash still holds). */
export async function trashedMedia(ids) {
  const out = new Map();
  try {
    const db = await open();
    const os = db.transaction('trash').objectStore('trash');
    const got = await Promise.all([...ids].map((id) => reqP(os.get(String(id)))));
    got.forEach((x) => { if (x && x.blob) out.set(x.id, x.blob); });
  } catch { /* none */ }
  return out;
}

/* ------------------------------------------------------------ snapshots */

const snapRange = (dealId) => IDBKeyRange.bound([dealId, ''], [dealId, '\uffff']);

/** A deal's snapshots, oldest first: [{ id, dealId, name, auto, reason, at, data }]. */
export async function snapshotsOf(dealId) {
  try {
    const db = await open();
    return ((await reqP(db.transaction('snapshots').objectStore('snapshots').getAll(snapRange(dealId)))) || []).sort((a, b) => a.at - b.at);
  } catch { return []; }
}

/**
 * Keep a snapshot of a deal. `data` is history.js snapshotData(deal). A named
 * one is refused when the deal has SNAPSHOTS.manual already ('full'); an
 * automatic one replaces the oldest automatic one beyond SNAPSHOTS.auto.
 * Returns the snapshot, 'full', or null if storage refused it.
 */
export async function saveSnapshot(dealId, { id = null, name, auto = false, reason = '' }, data, now = Date.now()) {
  try {
    const db = await open();
    const t = db.transaction('snapshots', 'readwrite');
    const os = t.objectStore('snapshots');
    const all = ((await reqP(os.getAll(snapRange(dealId)))) || []).sort((a, b) => a.at - b.at);
    const same = all.filter((x) => !!x.auto === !!auto);
    if (!auto && same.length >= SNAPSHOTS.manual) { t.abort(); return 'full'; }
    if (auto) for (const x of same.slice(0, Math.max(0, same.length - SNAPSHOTS.auto + 1))) os.delete([dealId, x.id]);
    const snap = { id: id || `s${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, dealId, name: name || 'Snapshot', auto: !!auto, reason, at: now, data };
    os.put(snap, [dealId, snap.id]);
    await doneP(t);
    return snap;
  } catch { return null; }
}

export async function deleteSnapshot(dealId, id) {
  try { const db = await open(); const t = db.transaction('snapshots', 'readwrite'); t.objectStore('snapshots').delete([dealId, id]); await doneP(t); return true; } catch { return false; }
}

/** How long removed photos, recordings and deleted deals' history are kept. */
export const TRASH_DAYS = 30;

/**
 * Empty what has been in the trash longer than TRASH_DAYS: removed media, and
 * the history and snapshots of a deal deleted that long ago (and not brought back).
 */
export async function sweepTrash(now = Date.now()) {
  try {
    const db = await open();
    const t = db.transaction(['trash', 'deals', 'history', 'snapshots'], 'readwrite');
    const trash = t.objectStore('trash');
    const [keys, vals] = await Promise.all([reqP(trash.getAllKeys()), reqP(trash.getAll())]);
    let n = 0;
    for (let i = 0; i < keys.length; i++) {
      const v = vals[i];
      if (!v || now - (v.removedAt || 0) < TRASH_DAYS * 86400000) continue;
      if (v.kind === 'deal') {
        if (await reqP(t.objectStore('deals').get(v.dealId))) { trash.delete(keys[i]); continue; }
        t.objectStore('history').delete(IDBKeyRange.bound([v.dealId, 0], [v.dealId, Infinity]));
        t.objectStore('snapshots').delete(IDBKeyRange.bound([v.dealId, ''], [v.dealId, '\uffff']));
      }
      trash.delete(keys[i]);
      n += 1;
    }
    await doneP(t);
    return n;
  } catch { return 0; }
}
export async function loadDeal(id) {
  try { return (await tx('readonly', (s) => s.get(id), 'deals')) || null; } catch { return null; }
}
/** Delete a deal. Its history and snapshots are kept TRASH_DAYS, so bringing it back keeps them. */
export async function deleteDeal(id) {
  try {
    const db = await open();
    const t = db.transaction(['deals', 'trash'], 'readwrite');
    t.objectStore('deals').delete(id);
    t.objectStore('trash').put({ kind: 'deal', dealId: id, removedAt: Date.now() }, `deal:${id}`);
    await doneP(t);
    return true;
  } catch { return false; }
}
/** Every saved deal, newest first, without loading photos into the list's memory twice. */
export async function listDeals() {
  try {
    const all = (await tx('readonly', (s) => s.getAll(), 'deals')) || [];
    return all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } catch { return []; }
}

/* ----------------------------------------------------------- small values */

export async function kvGet(key) {
  try { return (await tx('readonly', (s) => s.get(key), 'kv')) ?? null; } catch { return null; }
}
export async function kvSet(key, value) {
  try {
    await tx('readwrite', (s) => (value === null || value === undefined ? s.delete(key) : s.put(value, key)), 'kv');
    return true;
  } catch { return false; }
}

/** Every small value, for the backup. */
export async function kvAll() {
  try {
    const keys = await tx('readonly', (s) => s.getAllKeys(), 'kv');
    const vals = await tx('readonly', (s) => s.getAll(), 'kv');
    return Object.fromEntries(keys.map((k, i) => [k, vals[i]]));
  } catch { return {}; }
}

/** How much the browser lets this site keep, and whether it may evict it. */
export async function storageInfo() {
  const out = { usage: null, quota: null, persisted: null };
  try { if (navigator.storage && navigator.storage.estimate) Object.assign(out, await navigator.storage.estimate()); } catch { /* fine */ }
  try { if (navigator.storage && navigator.storage.persisted) out.persisted = await navigator.storage.persisted(); } catch { /* fine */ }
  return out;
}

/** Ask the browser not to evict our data under storage pressure. A refusal is fine. */
export async function askToPersist() {
  try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch { return false; }
}

/* ------------------------------------------------- comps as plain data */

export function compToJSON(c) {
  const o = { ...c };
  o.date = c.date ? new Date(c.date).toISOString() : null;
  o.parcels = c.parcels ? [...c.parcels] : [];
  return o;
}

export function compFromJSON(o) {
  const c = { ...o };
  c.date = o.date ? new Date(o.date) : null;
  c.parcels = new Set(o.parcels || []);
  c.flags = Array.isArray(o.flags) ? o.flags : [];
  return c;
}

/** Check that a parsed project file is ours and usable; throws a plain message if not. */
export function readProject(obj) {
  if (!obj || !FORMATS.project.read.includes(obj.format)) throw new Error(`That file is not a ${PRODUCT} project.`);
  if (typeof obj.version !== 'number' || obj.version > VERSION) {
    throw new Error(`That project was saved by a newer version of ${PRODUCT}. Reload the page to update, then open it again.`);
  }
  const docs = Array.isArray(obj.docs) ? obj.docs.filter((d) => d && typeof d.name === 'string' && Array.isArray(d.pages)) : [];
  return {
    docs: docs.map((d) => ({ name: d.name, pages: d.pages.map(String) })),
    edits: obj.edits && typeof obj.edits === 'object' ? obj.edits : {},
    manual: Array.isArray(obj.manual) ? obj.manual.map(compFromJSON) : [],
    subject: obj.subject && typeof obj.subject === 'object' ? obj.subject : null,
    windowMonths: Number(obj.windowMonths) || 0,
  };
}
