/* library.js -- the firm's Excel templates, kept on this device.
 *
 * A template is a workbook plus how a deal fills it: which cell takes the
 * price, which table takes the rent roll. Each upload of a new file is a
 * version; the mapping carries over, and an older version can be restored.
 * Templates can be exported as a single file and imported on a colleague's
 * device: there is no shared server, so that is how a firm-wide template
 * travels. */

import { kvGet, kvSet } from './store.js';
import { FORMATS, PRODUCT } from './brand.js';

const KEY = 'tpl.library';
export const CATEGORIES = ['Underwriting', 'Rent roll', 'Comps', 'Valuation', 'IC report', 'Other'];
export const PACKAGE_FORMAT = FORMATS.template.write;

export async function listTemplates() { return (await kvGet(KEY)) || []; }
async function saveAll(list) { return kvSet(KEY, list); }

export async function putTemplate(t) {
  const list = await listTemplates();
  const i = list.findIndex((x) => x.id === t.id);
  t.updatedAt = Date.now();
  if (i >= 0) list[i] = t; else list.push(t);
  if (!(await saveAll(list))) throw new Error('The template could not be saved on this device (storage is full or blocked).');
  return t;
}
export async function deleteTemplate(id) {
  const list = (await listTemplates()).filter((x) => x.id !== id);
  return saveAll(list);
}

export function newTemplate({ name, bytes, fileName, info, mapping, category = 'Underwriting' }) {
  const now = Date.now();
  return {
    id: `t${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, category, description: '', archived: false,
    createdAt: now, updatedAt: now,
    versions: [{ at: now, fileName, bytes, size: bytes.length, note: 'uploaded' }], current: 0,
    mapping, features: info.features, warnings: info.warnings,
  };
}
export const currentBytes = (t) => t.versions[t.current ?? t.versions.length - 1].bytes;
export const currentFile = (t) => t.versions[t.current ?? t.versions.length - 1].fileName;

/** A new file for the same template: the mapping stays; cells that moved are caught at preview. */
export function addVersion(t, { bytes, fileName, info, note = 'replaced' }) {
  t.versions.push({ at: Date.now(), fileName, bytes, size: bytes.length, note });
  t.current = t.versions.length - 1;
  t.features = info.features;
  t.warnings = info.warnings;
  // keep the last ten files; the mapping is not versioned
  while (t.versions.length > 10) { t.versions.shift(); t.current -= 1; }
  return t;
}

export function duplicateTemplate(t) {
  const c = JSON.parse(JSON.stringify({ ...t, versions: [] }));
  c.id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  c.name = `${t.name} (copy)`;
  c.versions = [{ ...t.versions[t.current ?? t.versions.length - 1], at: Date.now(), note: `copied from ${t.name}` }];
  c.current = 0;
  c.createdAt = Date.now();
  return c;
}

/* --------------------------------------------- sharing with a colleague */

const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

/** One file holding the workbook and its mapping, to send to someone else. */
export function exportPackage(t) {
  return JSON.stringify({
    format: PACKAGE_FORMAT, version: 1, exportedAt: new Date().toISOString(),
    name: t.name, category: t.category, description: t.description, fileName: currentFile(t), mapping: t.mapping, workbook: b64(currentBytes(t)),
  });
}
export function readPackage(text) {
  let o;
  try { o = JSON.parse(text); } catch { throw new Error(`That file is not a ${PRODUCT} template.`); }
  // packages exported before the rename carry the old format id and open the same
  if (!o || !FORMATS.template.read.includes(o.format) || typeof o.workbook !== 'string') throw new Error(`That file is not a ${PRODUCT} template.`);
  return { name: o.name || 'Imported template', category: o.category || 'Other', description: o.description || '', fileName: o.fileName || 'template.xlsx', mapping: o.mapping || { cells: [], tables: [] }, bytes: unb64(o.workbook) };
}
