/* backup.js -- one file holding everything the app keeps on this device:
 * deals (with their photos and recordings), the comp set, the template
 * library, tasks, contacts, activity, saved Tools scenarios, rent roll
 * layouts and settings. Restoring merges it in: whatever is newer wins, and
 * nothing on the device is lost unless the broker chooses to replace it all.
 *
 * The AI access token is left out: a backup is a file that gets copied and
 * sent, and the token is a credential.
 *
 * The encoding and the restore plan are pure (tests/backup.test.js). */

export const BACKUP_FORMAT = 'comp-loader-backup';
export const BACKUP_VERSION = 1;
/** localStorage keys worth keeping (the rest are recovery mirrors, rebuilt on their own). */
export const LOCAL_KEYS = ['comp-loader.tools.v1', 'comp-loader.subject.v1', 'comp-loader.loan.v1'];
const SECRET = { 'ai.settings': ['token'] };

const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Blobs, byte arrays and dates into JSON-safe tagged objects. */
export async function encodeValue(v) {
  if (v === null || v === undefined || typeof v !== 'object') return v;
  if (typeof Blob !== 'undefined' && v instanceof Blob) return { $blob: b64(new Uint8Array(await v.arrayBuffer())), type: v.type };
  if (v instanceof Uint8Array) return { $u8: b64(v) };
  if (v instanceof ArrayBuffer) return { $ab: b64(new Uint8Array(v)) };
  if (v instanceof Date) return { $date: Number.isNaN(v.getTime()) ? null : v.toISOString() };
  if (Array.isArray(v)) return Promise.all(v.map(encodeValue));
  const out = {};
  for (const [k, x] of Object.entries(v)) if (x !== undefined && typeof x !== 'function') out[k] = await encodeValue(x);
  return out;
}
export function decodeValue(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(decodeValue);
  if (typeof v.$blob === 'string') return new Blob([unb64(v.$blob)], { type: v.type || '' });
  if (typeof v.$u8 === 'string') return unb64(v.$u8);
  if (typeof v.$ab === 'string') return unb64(v.$ab).buffer;
  if ('$date' in v && Object.keys(v).length === 1) return v.$date ? new Date(v.$date) : new Date(NaN);
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = decodeValue(x);
  return out;
}

/** Everything as one JSON-safe object. kv: { key: value }; local: { key: string }. */
export async function buildBackup({ deals = [], kv = {}, session = null, local = {}, appVersion = '' }) {
  const keptKv = {};
  for (const [k, v] of Object.entries(kv)) {
    if (SECRET[k] && v && typeof v === 'object') { const c = { ...v }; for (const f of SECRET[k]) delete c[f]; keptKv[k] = c; } else keptKv[k] = v;
  }
  return {
    format: BACKUP_FORMAT, version: BACKUP_VERSION, app: appVersion, createdAt: new Date().toISOString(),
    counts: { deals: deals.length, templates: (kv['tpl.library'] || []).length, tasks: (kv['crm.tasks'] || []).length, contacts: (kv['crm.contacts'] || []).length },
    deals: await encodeValue(deals), kv: await encodeValue(keptKv), session: await encodeValue(session), local: { ...local },
  };
}

export function readBackup(text) {
  let o;
  try { o = typeof text === 'string' ? JSON.parse(text) : text; } catch { throw new Error('That file is not a Comp Loader backup (it is not valid JSON).'); }
  if (!o || o.format !== BACKUP_FORMAT) throw new Error(o && o.format === 'comp-loader-project' ? 'That is a comp project file: open it from the Comps tab (⋯ → Open project).' : 'That file is not a Comp Loader backup.');
  if (o.version > BACKUP_VERSION) throw new Error('This backup was made by a newer version of Comp Loader: update the app first.');
  return { ...o, deals: decodeValue(o.deals || []), kv: decodeValue(o.kv || {}), session: decodeValue(o.session ?? null), local: o.local || {} };
}

const newer = (a, b) => (a.updatedAt || a.createdAt || 0) > (b.updatedAt || b.createdAt || 0);
/** Lists of records with ids, merged: records only in one side kept; on both, the newer (else the device's). */
function mergeById(here = [], there = [], { stamp = true } = {}) {
  const byId = new Map(here.map((x) => [x.id, x]));
  let added = 0; let updated = 0;
  for (const x of there) {
    if (!x || x.id === undefined) continue;
    const h = byId.get(x.id);
    if (!h) { byId.set(x.id, x); added += 1; } else if (stamp && newer(x, h)) { byId.set(x.id, x); updated += 1; }
  }
  return { list: [...byId.values()], added, updated };
}

/**
 * What a restore would do, without doing it. current: the device's
 * { deals, kv, session, local }. mode 'merge' (default) or 'replace'.
 * Returns { deals: { put: [], added, updated, kept }, kv: { key: value },
 * session, local, removeDeals: [], summary: [lines] }.
 */
export function planRestore(backup, current, mode = 'merge') {
  const summary = [];
  if (mode === 'replace') {
    const kv = { ...backup.kv };
    // the access token on this device is kept: the backup never carries one
    if (current.kv['ai.settings'] && current.kv['ai.settings'].token) kv['ai.settings'] = { ...(kv['ai.settings'] || {}), token: current.kv['ai.settings'].token };
    const keepIds = new Set(backup.deals.map((d) => d.id));
    const removeDeals = current.deals.filter((d) => !keepIds.has(d.id)).map((d) => d.id);
    summary.push(`${backup.deals.length} deal${backup.deals.length === 1 ? '' : 's'} restored; ${removeDeals.length} deal${removeDeals.length === 1 ? '' : 's'} on this device not in the backup will be deleted.`);
    return { deals: { put: backup.deals, added: backup.deals.length, updated: 0, kept: 0 }, removeDeals, kv, removeKv: Object.keys(current.kv).filter((k) => !(k in kv)), session: backup.session, local: backup.local, summary };
  }
  const d = mergeById(current.deals, backup.deals);
  const put = backup.deals.filter((x) => { const h = current.deals.find((c) => c.id === x.id); return !h || newer(x, h); });
  summary.push(`Deals: ${d.added} added, ${d.updated} updated with a newer copy, ${current.deals.length - d.updated} kept as they are here.`);
  const kv = {};
  const merge = (key, label, opts) => {
    if (!(key in backup.kv)) return;
    const m = mergeById(current.kv[key] || [], backup.kv[key] || [], opts);
    if (m.added || m.updated) { kv[key] = m.list; summary.push(`${label}: ${m.added} added${m.updated ? `, ${m.updated} updated` : ''}.`); }
  };
  merge('tpl.library', 'Templates');
  merge('crm.tasks', 'Tasks', { stamp: false });
  merge('crm.contacts', 'Contacts');
  merge('crm.activity', 'Activity entries', { stamp: false });
  if (kv['crm.activity']) kv['crm.activity'].sort((a, b) => a.at - b.at);
  if (backup.kv['tools.scenarios']) {
    const here = current.kv['tools.scenarios'] || {};
    const out = { ...here };
    let n = 0;
    for (const [tool, list] of Object.entries(backup.kv['tools.scenarios'])) { const m = mergeById(here[tool] || [], list, { stamp: false }); out[tool] = m.list; n += m.added; }
    if (n) { kv['tools.scenarios'] = out; summary.push(`Saved Tools scenarios: ${n} added.`); }
  }
  // anything else (settings, layouts) only where the device has none
  for (const [k, v] of Object.entries(backup.kv)) {
    if (k in kv || ['tpl.library', 'crm.tasks', 'crm.contacts', 'crm.activity', 'tools.scenarios'].includes(k)) continue;
    if (!(k in current.kv) || current.kv[k] === null) kv[k] = v;
  }
  const session = current.session ? null : backup.session;
  if (backup.session && !current.session) summary.push('The comp set from the backup is restored (this device had none).');
  else if (backup.session) summary.push('The comp set on this device is kept (the backup’s is not loaded over it).');
  const local = Object.fromEntries(Object.entries(backup.local || {}).filter(([k]) => LOCAL_KEYS.includes(k) && !(current.local || {})[k]));
  return { deals: { put, added: d.added, updated: d.updated, kept: current.deals.length - d.updated }, removeDeals: [], kv, removeKv: [], session, local, summary };
}
