/* t12labels.js -- the T-12 labels the broker has filed, remembered on this
 * device (kv `t12.labels`): { entries: { normalised label: { category, at } } }.
 * Only the label and the category are kept, never an amount. Backups carry
 * them; a merge restore combines them label by label, the newer winning
 * (backup.js). Matching reads them first (t12.js matchLabel). */

import * as store from './store.js';
import { CATEGORY } from './t12.js';

export const LABELS_KEY = 't12.labels';

async function read() {
  const v = await store.kvGet(LABELS_KEY);
  return v && v.entries && typeof v.entries === 'object' ? v : { entries: {} };
}
/** { normalised label: category id }, for matchLabel. */
export async function corrections() {
  const { entries } = await read();
  return Object.fromEntries(Object.entries(entries).filter(([, e]) => e && CATEGORY[e.category]).map(([k, e]) => [k, e.category]));
}
/** Every remembered label, newest first: [{ key, category, at }]. */
export async function listLabels() {
  const { entries } = await read();
  return Object.entries(entries).map(([key, e]) => ({ key, ...e })).sort((a, b) => (b.at || 0) - (a.at || 0));
}
export async function rememberLabel(key, category) {
  if (!key || !CATEGORY[category]) return false;
  const v = await read();
  v.entries[key] = { category, at: Date.now() };
  return store.kvSet(LABELS_KEY, v);
}
export async function forgetLabel(key) {
  const v = await read();
  delete v.entries[key];
  return store.kvSet(LABELS_KEY, v);
}
