/* brand.js -- the product's name, and the move from the old one.
 *
 * Zlatura was called Comp Loader until 4.0. Everything it kept on a device
 * under the old name still works:
 *   - localStorage keys `comp-loader.*` are copied to `zlatura.*` once, the
 *     first time 4.0 starts (below, before any other module reads a key);
 *   - the IndexedDB database `comp-loader` is copied to `zlatura` (store.js);
 *   - backup, project and template files with the old format ids are read
 *     for good, so a file made years ago still opens.
 * The old keys and database are left untouched until the move is safe to
 * finish (store.js `finishRename`): after a backup made since the move, or 30
 * days. Until then going back to the old copy loses nothing.
 *
 * This module is imported first by ui.js. It has no imports of its own, so it
 * runs before anything else reads localStorage. */

export const PRODUCT = 'Zlatura';
export const TAGLINE = 'Every source. Every assumption. Every number.';
export const ABOUT_NAME = 'Zlatura joins two words for wealth: zlato, gold in Serbian and Croatian, and fartura, abundance in Brazilian Portuguese.';

export const OLD_PRODUCT = 'Comp Loader';
export const KEY_PREFIX = 'zlatura.';
export const OLD_KEY_PREFIX = 'comp-loader.';
/** Set once the localStorage keys have been copied; the copy never runs again. */
export const RENAMED_FLAG = 'zlatura.renamed';

/** File format ids: what is written now, and every id still read. */
export const FORMATS = {
  backup: { write: 'zlatura-backup', read: ['zlatura-backup', 'comp-loader-backup'] },
  project: { write: 'zlatura-project', read: ['zlatura-project', 'comp-loader-project'] },
  template: { write: 'zlatura-template', read: ['zlatura-template', 'comp-loader-template'] },
};

/** An old localStorage key under its new name (other keys unchanged). */
export const renameKey = (k) => (typeof k === 'string' && k.startsWith(OLD_KEY_PREFIX) ? KEY_PREFIX + k.slice(OLD_KEY_PREFIX.length) : k);

/**
 * Copy every `comp-loader.*` key to its `zlatura.*` name, once. A new key that
 * already exists is never overwritten. Old keys are kept (see finishRename).
 * Copying only once matters: the app deletes some keys on purpose (the
 * recovery copy of an unsaved deal, the open deal), and a later copy would
 * bring a stale one back. Returns how many keys were copied.
 */
export function migrateLocalKeys(ls) {
  if (!ls) return 0;
  try {
    if (ls.getItem(RENAMED_FLAG)) return 0;
    const old = [];
    for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k && k.startsWith(OLD_KEY_PREFIX)) old.push(k); }
    let n = 0;
    for (const k of old) {
      const nk = renameKey(k);
      if (ls.getItem(nk) === null) { ls.setItem(nk, ls.getItem(k)); n += 1; }
    }
    ls.setItem(RENAMED_FLAG, String(Date.now()));
    return n;
  } catch { return 0; } // storage blocked or full: the app works without it
}

/** Remove the old keys once the move is finished. */
export function removeOldLocalKeys(ls) {
  if (!ls) return 0;
  try {
    const old = [];
    for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k && k.startsWith(OLD_KEY_PREFIX)) old.push(k); }
    for (const k of old) ls.removeItem(k);
    return old.length;
  } catch { return 0; }
}

if (typeof localStorage !== 'undefined') {
  try { migrateLocalKeys(localStorage); } catch { /* blocked: nothing to move */ }
}
