/* backup.js -- one file holding everything the app keeps on this device:
 * deals (with their photos and recordings), the comp set, the template
 * library, tasks, contacts, activity, saved Tools scenarios, rent roll
 * layouts and settings. Restoring merges it in: whatever is newer wins, and
 * nothing on the device is lost unless the broker chooses to replace it all.
 *
 * The AI access token is left out: a backup is a file that gets copied and
 * sent, and the token is a credential.
 *
 * Backups made before the rename (format `comp-loader-backup`, local keys
 * `comp-loader.*`) are read the same as new ones, for good.
 *
 * Version 2 (4.3) can also carry each deal's history and snapshots (they are
 * included unless the broker leaves them out). Version 1 files have neither
 * and restore as before; a version 2 file is refused by 4.2 and older with
 * "made by a newer version". Photos and recordings removed from a deal (kept
 * 30 days for undo) are not part of a backup.
 *
 * The encoding and the restore plan are pure (tests/backup.test.js). */

import { FORMATS, PRODUCT, renameKey } from './brand.js';
import { MIGRATIONS, pending, tooNew, migrateDeal } from './migrate.js';

export const BACKUP_FORMAT = FORMATS.backup.write;
export const BACKUP_VERSION = 2;
/** localStorage keys worth keeping (the rest are recovery mirrors, rebuilt on their own). */
export const LOCAL_KEYS = ['zlatura.tools.v1', 'zlatura.subject.v1', 'zlatura.loan.v1'];
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

/**
 * Everything as one JSON-safe object. kv: { key: value }; local: { key: string };
 * history: { dealId: [entries] } and snapshots: { dealId: [snapshots] }, or null to leave them out.
 */
export async function buildBackup({ deals = [], kv = {}, session = null, local = {}, appVersion = '', history = null, snapshots = null }) {
  const keptKv = {};
  for (const [k, v] of Object.entries(kv)) {
    if (SECRET[k] && v && typeof v === 'object') { const c = { ...v }; for (const f of SECRET[k]) delete c[f]; keptKv[k] = c; } else keptKv[k] = v;
  }
  return {
    format: BACKUP_FORMAT, version: BACKUP_VERSION, app: appVersion, createdAt: new Date().toISOString(),
    counts: {
      deals: deals.length, templates: (kv['tpl.library'] || []).length, tasks: (kv['crm.tasks'] || []).length, contacts: (kv['crm.contacts'] || []).length,
      ...(history ? { historyEntries: Object.values(history).reduce((a, l) => a + l.length, 0) } : {}),
      ...(snapshots ? { snapshots: Object.values(snapshots).reduce((a, l) => a + l.length, 0) } : {}),
    },
    deals: await encodeValue(deals), kv: await encodeValue(keptKv), session: await encodeValue(session), local: { ...local },
    ...(history ? { history: await encodeValue(history) } : {}),
    ...(snapshots ? { snapshots: await encodeValue(snapshots) } : {}),
  };
}

export function readBackup(text) {
  let o;
  try { o = typeof text === 'string' ? JSON.parse(text) : text; } catch { throw new Error(`That file is not a ${PRODUCT} backup (it is not valid JSON).`); }
  if (!o || !FORMATS.backup.read.includes(o.format)) throw new Error(o && FORMATS.project.read.includes(o.format) ? 'That is a comp project file: open it from the Comps tab (⋯ → Open project).' : `That file is not a ${PRODUCT} backup.`);
  if (o.version > BACKUP_VERSION) throw new Error(`This backup was made by a newer version of ${PRODUCT}: update the app first.`);
  // a deal in a shape this code doesn't know yet would be read wrongly, and saved back without what it doesn't know
  const ahead = (o.deals || []).filter(tooNew);
  if (ahead.length) throw new Error(`This backup holds ${ahead.length === 1 ? 'a deal' : `${ahead.length} deals`} saved by a newer version of ${PRODUCT} (${ahead.slice(0, 3).map((d) => `“${d.name || (d.figures && d.figures.address) || 'Untitled deal'}”`).join(', ')}): update the app first. Nothing was restored.`);
  // settings saved under the old name come back under the new one
  const local = Object.fromEntries(Object.entries(o.local || {}).map(([k, v]) => [renameKey(k), v]));
  return {
    ...o, deals: decodeValue(o.deals || []), kv: decodeValue(o.kv || {}), session: decodeValue(o.session ?? null), local,
    history: o.history ? decodeValue(o.history) : null, snapshots: o.snapshots ? decodeValue(o.snapshots) : null,
  };
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

/** The line saying which restored deals an older version saved, and what bringing them up to date changes (app/migrate.js). */
function upgradeLine(deals) {
  const old = deals.filter((d) => pending(d).length);
  if (!old.length) return '';
  const n = old.length;
  const by = new Map(MIGRATIONS.map((s) => [s.brief, 0])); // in the registry's order
  // worked out on a copy (without the photos and recordings, which no step reads), so the counts are what will change
  for (const d of old) for (const x of changedSteps(migrateDeal(structuredClone({ ...d, visit: null })))) by.set(x.brief, (by.get(x.brief) || 0) + 1);
  return `${n} deal${n === 1 ? '' : 's'} saved by an older version ${n === 1 ? 'is' : 'are'} brought up to date as ${n === 1 ? 'it is' : 'they are'} restored${[...by.values()].some(Boolean) ? `: ${[...by].filter(([, k]) => k).map(([b, k]) => `${b} (${k})`).join(', ')}` : ''}.`;
}
/** The steps that changed something the broker would see: rounding that rounded nothing is only a mark. */
export const changedSteps = (steps) => steps.filter((x) => x.id !== 'money' || x.rounded.length);

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
    const hs = historyPlan(backup, keepIds);
    if (hs.line) summary.push(hs.line);
    const up = upgradeLine(backup.deals);
    if (up) summary.push(up);
    return { deals: { put: backup.deals, added: backup.deals.length, updated: 0, kept: 0 }, removeDeals, kv, removeKv: Object.keys(current.kv).filter((k) => !(k in kv)), session: backup.session, local: backup.local, summary, history: hs.history, snapshots: hs.snapshots };
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
  // the T-12 labels the broker has filed: combined label by label, the newer choice winning
  if (backup.kv['t12.labels'] && backup.kv['t12.labels'].entries) {
    const here = (current.kv['t12.labels'] && current.kv['t12.labels'].entries) || {};
    const there = backup.kv['t12.labels'].entries;
    const entries = { ...here };
    let n = 0;
    for (const [key, e] of Object.entries(there)) if (e && (!here[key] || (e.at || 0) > (here[key].at || 0))) { if (!here[key] || here[key].category !== e.category) n += 1; entries[key] = e; }
    if (n) { kv['t12.labels'] = { entries }; summary.push(`T-12 labels you filed: ${n} added or updated.`); }
  }
  // anything else (settings, layouts) only where the device has none
  for (const [k, v] of Object.entries(backup.kv)) {
    if (k in kv || ['tpl.library', 'crm.tasks', 'crm.contacts', 'crm.activity', 'tools.scenarios', 't12.labels'].includes(k)) continue;
    if (!(k in current.kv) || current.kv[k] === null) kv[k] = v;
  }
  const session = current.session ? null : backup.session;
  if (backup.session && !current.session) summary.push('The comp set from the backup is restored (this device had none).');
  else if (backup.session) summary.push('The comp set on this device is kept (the backup’s is not loaded over it).');
  const local = Object.fromEntries(Object.entries(backup.local || {}).filter(([k]) => LOCAL_KEYS.includes(k) && !(current.local || {})[k]));
  const hs = historyPlan(backup, new Set([...current.deals.map((x) => x.id), ...backup.deals.map((x) => x.id)]));
  if (hs.line) summary.push(hs.line);
  const up = upgradeLine(put);
  if (up) summary.push(up);
  return { deals: { put, added: d.added, updated: d.updated, kept: current.deals.length - d.updated }, removeDeals: [], kv, removeKv: [], session, local, summary, history: hs.history, snapshots: hs.snapshots };
}

/**
 * The history and snapshots a restore brings, for the deals it keeps. They
 * are combined with what the device has (store.mergeHistory, mergeSnapshots):
 * a history is a record, so nothing in it is overwritten or dropped.
 */
function historyPlan(backup, dealIds) {
  const pick = (m) => Object.fromEntries(Object.entries(m || {}).filter(([id, l]) => dealIds.has(id) && Array.isArray(l) && l.length));
  const history = pick(backup.history); const snapshots = pick(backup.snapshots);
  const nh = Object.values(history).reduce((a, l) => a + l.length, 0); const ns = Object.values(snapshots).reduce((a, l) => a + l.length, 0);
  const line = nh || ns ? `History: ${nh} entr${nh === 1 ? 'y' : 'ies'} and ${ns} snapshot${ns === 1 ? '' : 's'} combined with what this device has.` : '';
  return { history, snapshots, line };
}
