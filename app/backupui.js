/* backupui.js -- "Your data" on Home: how much is kept and how safe it is,
 * a backup of everything in one file, and restoring one. */

import * as store from './store.js';
import { buildBackup, readBackup, planRestore, LOCAL_KEYS } from './backup.js';
import { prepareForRestore, listAllDeals } from './dealui.js';
import { VERSION } from './exporters.js';
import { PRODUCT, OLD_PRODUCT } from './brand.js';
import { el, toast, actionSheet, deliver, localDate, niceDate } from './kit.js';

const LAST = 'backup.last';
const mb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** The card, drawn into `box`. */
export async function renderDataCard(box, api) {
  const [info, last, deals, moved, rounding] = await Promise.all([store.storageInfo(), store.kvGet(LAST), listAllDeals(), store.renameInfo(), store.roundingLog()]);
  box.textContent = '';
  const h = el('div', 'card-head');
  h.appendChild(el('h2', null, 'Your data'));
  box.appendChild(h);
  const p = el('p', 'hint data-hint');
  const parts = [
    `${deals.length} deal${deals.length === 1 ? '' : 's'}, kept in this browser on this device only${info.usage ? ` (${mb(info.usage)} used)` : ''}.`,
    info.persisted === true ? 'The browser has agreed not to clear it under storage pressure.' : 'The browser may clear it if the device runs short of space, or (Safari) after seven days without a visit unless the app is on the home screen.',
    last ? `Last backup: ${niceDate(last)}.` : 'No backup made from this device yet.',
  ];
  // the move from the old name, while its copy is still kept
  if (moved && moved.copied && !moved.finishedAt) parts.push(`Your data moved here from ${OLD_PRODUCT} on ${niceDate(moved.at)}; the old copy is kept on this device until you make a backup, or for 30 days.`);
  p.textContent = parts.join(' ');
  box.appendChild(p);
  // every stored value the money rounding changed (4.1: totals to cents, rates to four decimals), with old and new
  if (rounding.length) {
    const r = el('p', 'hint-sm data-hint');
    r.id = 'rounding-note';
    r.append(`${rounding.length} stored value${rounding.length === 1 ? ' was' : 's were'} rounded when money began to be kept to whole cents (rates per SF or unit to four decimals). `);
    const show = el('button', 'linkish', 'See each one, old and new');
    show.type = 'button';
    show.id = 'rounding-show';
    show.addEventListener('click', () => showRounding(api, rounding));
    r.appendChild(show);
    box.appendChild(r);
  }
  const acts = el('div', 'crm-acts data-acts');
  const bk = el('button', 'btn btn-sm', 'Back up everything');
  bk.type = 'button';
  bk.id = 'backup-make';
  bk.addEventListener('click', () => makeBackup().then(() => renderDataCard(box, api)).catch((e) => { console.error(e); toast(`The backup could not be made: ${e.message}`); }));
  const rs = el('label', 'btn btn-sm btn-gray', 'Restore from a backup…');
  const fi = el('input');
  fi.type = 'file';
  fi.accept = '.json,application/json';
  fi.id = 'backup-file';
  fi.hidden = true;
  rs.htmlFor = fi.id;
  fi.addEventListener('change', () => { const f = fi.files[0]; fi.value = ''; if (f) restore(f, api); });
  acts.append(bk, rs, fi);
  box.appendChild(acts);
  box.appendChild(el('p', 'hint-sm data-hint', 'The backup is one file with every deal (photos and recordings included), the comp set, templates, tasks, contacts and settings. It holds confidential deal information: keep it somewhere safe. Your AI access token is not included.'));
}

/** The rounding log, every value with where it is, its old and its new value. */
function showRounding(api, entries) {
  const body = api.sheetOpen({ eyebrow: 'Your data', title: 'Values rounded', sub: 'Money is kept to whole cents, and rates per SF or per unit to four decimals. These stored values had more decimals than that and were rounded once.' });
  const t = el('table', 'mini');
  t.id = 'rounding-table';
  const head = el('tr');
  for (const x of ['Where', 'Field', 'Was', 'Now']) head.appendChild(el('th', null, x));
  t.appendChild(head);
  for (const e of entries) {
    const tr = el('tr');
    tr.append(el('td', null, e.where), el('td', null, e.path), el('td', 'n', String(e.old)), el('td', 'n', String(e.new)));
    t.appendChild(tr);
  }
  const wrap = el('div', 'scroll');
  wrap.appendChild(t);
  body.appendChild(wrap);
}

async function current() {
  const [deals, kv, session] = await Promise.all([store.listDeals(), store.kvAll(), store.loadSession()]);
  const local = {};
  try { for (const k of LOCAL_KEYS) { const v = localStorage.getItem(k); if (v !== null) local[k] = v; } } catch { /* fine */ }
  return { deals, kv, session: session || null, local };
}

export async function makeBackup() {
  const c = await current();
  const b = await buildBackup({ ...c, appVersion: VERSION });
  const bytes = new TextEncoder().encode(JSON.stringify(b));
  const r = await deliver(`${PRODUCT} backup ${localDate()}.json`, bytes, 'application/json');
  if (r === 'done') {
    await store.kvSet(LAST, Date.now());
    toast(`Backup saved: ${b.counts.deals} deals, ${mb(bytes.length)}.`);
    // a backup made since the move from the old name makes the old copy safe to delete
    store.finishRename().catch(() => {});
  }
}

async function restore(file, api) {
  let backup;
  try { backup = readBackup(await file.text()); } catch (e) { toast(e.message, null, 7000); return; }
  const c = await current();
  const merge = planRestore(backup, c, 'merge');
  const made = backup.createdAt ? niceDate(backup.createdAt) : 'an unknown date';
  const v = await actionSheet(`Restore the backup of ${made}?`, [
    { label: 'Merge into this device', sub: merge.summary.join(' '), value: 'merge', primary: true },
    { label: 'Replace everything on this device', sub: 'Deals, comps, templates, tasks and contacts here that are not in the backup are deleted.', value: 'replace', danger: true },
  ]);
  if (!v) return;
  let plan = merge;
  if (v === 'replace') {
    plan = planRestore(backup, c, 'replace');
    const sure = await actionSheet('Replace everything?', [{ label: 'Yes, replace everything', sub: `${plan.summary.join(' ')} This cannot be undone: make a backup of this device first if unsure.`, value: 'yes', danger: true }]);
    if (sure !== 'yes') return;
  }
  try {
    if (api.flushComps) api.flushComps();
    await prepareForRestore();
    for (const id of plan.removeDeals) await store.deleteDeal(id);
    for (const d of plan.deals.put) if (!(await store.saveDeal(d))) throw new Error('storage is full or blocked');
    for (const k of plan.removeKv) await store.kvSet(k, null);
    for (const [k, val] of Object.entries(plan.kv)) if (!(await store.kvSet(k, val))) throw new Error('storage is full or blocked');
    if (v === 'replace' && !plan.session) await store.clearSession();
    else if (plan.session) await store.saveSession(plan.session);
    // what the backup brought in is rounded as stored money is (whole cents, rates to four decimals), and logged
    await store.migrateMoney();
    try { for (const [k, val] of Object.entries(plan.local)) localStorage.setItem(k, val); } catch { /* fine */ }
  } catch (e) {
    toast(`The restore stopped part way: ${e.message}. Reload and check; the backup file is unchanged.`, null, 10000);
    return;
  }
  toast('Restored. Reloading…');
  setTimeout(() => location.reload(), 600);
}
