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

const DB = 'comp-loader';
const STORE = 'session';
const KEY = 'current';
export const FORMAT = 'comp-loader-project';
export const VERSION = 1;

/* Version 2 adds two stores beside the session: `deals` (one record per OM
 * analysed, with its site-visit photos as Blobs) and `kv` (the custom Excel
 * template and small settings). An existing session survives the upgrade.
 *
 * One connection is kept open and reused. Opening a database is asynchronous,
 * and a save made as the app leaves the screen (pagehide) has to start its
 * transaction straight away, before the page is frozen, or it is lost. */
let dbP = null;
function open() {
  if (dbP) return dbP;
  dbP = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) { reject(new Error('no IndexedDB')); return; }
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of [STORE, 'deals', 'kv']) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    };
    req.onsuccess = () => {
      const db = req.result;
      // another tab upgrading the database, or the browser closing it: start afresh next time
      db.onversionchange = () => { db.close(); dbP = null; };
      db.onclose = () => { dbP = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('storage is busy in another tab'));
  });
  dbP.catch(() => { dbP = null; });
  return dbP;
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

export async function saveDeal(deal) {
  try { await tx('readwrite', (s) => s.put(deal, deal.id), 'deals'); return true; } catch { return false; }
}
export async function loadDeal(id) {
  try { return (await tx('readonly', (s) => s.get(id), 'deals')) || null; } catch { return null; }
}
export async function deleteDeal(id) {
  try { await tx('readwrite', (s) => s.delete(id), 'deals'); return true; } catch { return false; }
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
  if (!obj || obj.format !== FORMAT) throw new Error('That file is not a Comp Loader project.');
  if (typeof obj.version !== 'number' || obj.version > VERSION) {
    throw new Error('That project was saved by a newer version of Comp Loader. Reload the page to update, then open it again.');
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
