/* crm.js -- tasks, contacts, the activity log and the list of deliverables,
 * kept on this device next to the deals (IndexedDB, through store.js). A
 * deal's stage lives on the deal itself. */

import { kvGet, kvSet } from './store.js';

const K = { tasks: 'crm.tasks', contacts: 'crm.contacts', activity: 'crm.activity' };
const MAX_ACTIVITY = 500;
const id = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function list(key) { return (await kvGet(key)) || []; }
async function put(key, items) {
  if (!(await kvSet(key, items))) throw new Error('This device would not save that (storage is full or blocked).');
  document.dispatchEvent(new CustomEvent('crmchange', { detail: key }));
  return items;
}

/* ------------------------------------------------------------------ tasks */

export const listTasks = () => list(K.tasks);
export async function addTask({ title, due = null, dealId = null, contactId = null, source = 'typed', note = '' }) {
  const t = { id: id('t'), title: String(title || '').trim(), due: due || null, dealId, contactId, source, note, done: false, doneAt: null, createdAt: Date.now() };
  if (!t.title) throw new Error('A task needs a title.');
  await put(K.tasks, [...(await listTasks()), t]);
  await log('task', `Task added: ${t.title}`, dealId);
  return t;
}
export async function updateTask(tid, change) {
  const all = await listTasks();
  const t = all.find((x) => x.id === tid);
  if (!t) return null;
  const wasDone = t.done;
  Object.assign(t, change);
  if (change.done === true && !wasDone) t.doneAt = Date.now();
  if (change.done === false) t.doneAt = null;
  await put(K.tasks, all);
  if (change.done === true && !wasDone) await log('task', `Done: ${t.title}`, t.dealId);
  return t;
}
export async function deleteTask(tid) {
  const all = await listTasks();
  const t = all.find((x) => x.id === tid);
  await put(K.tasks, all.filter((x) => x.id !== tid));
  return t;
}
export async function restoreTask(t) { await put(K.tasks, [...(await listTasks()).filter((x) => x.id !== t.id), t]); }

/* --------------------------------------------------------------- contacts */

export const listContacts = () => list(K.contacts);
export async function saveContact(c) {
  const all = await listContacts();
  const now = Date.now();
  const rec = { id: c.id || id('c'), name: String(c.name || '').trim(), company: c.company || '', role: c.role || 'Other', phone: c.phone || '', email: c.email || '', notes: c.notes || '', dealIds: [...new Set(c.dealIds || [])], createdAt: c.createdAt || now, updatedAt: now };
  if (!rec.name) throw new Error('A contact needs a name.');
  const i = all.findIndex((x) => x.id === rec.id);
  if (i >= 0) all[i] = rec; else all.push(rec);
  await put(K.contacts, all);
  if (i < 0) await log('contact', `Contact added: ${rec.name}${rec.company ? `, ${rec.company}` : ''}`, rec.dealIds[0] || null);
  return rec;
}
export async function deleteContact(cid) {
  const all = await listContacts();
  const c = all.find((x) => x.id === cid);
  await put(K.contacts, all.filter((x) => x.id !== cid));
  return c;
}
export async function restoreContact(c) { await put(K.contacts, [...(await listContacts()).filter((x) => x.id !== c.id), c]); }
export async function linkContact(cid, dealId, on = true) {
  const all = await listContacts();
  const c = all.find((x) => x.id === cid);
  if (!c) return null;
  c.dealIds = on ? [...new Set([...(c.dealIds || []), dealId])] : (c.dealIds || []).filter((x) => x !== dealId);
  await put(K.contacts, all);
  return c;
}

/* --------------------------------------------------- activity, deliverables */

export const listActivity = () => list(K.activity);
/** type: stage | task | contact | deliverable | ai | deal */
export async function log(type, text, dealId = null, extra = {}) {
  const all = await listActivity();
  all.push({ id: id('a'), at: Date.now(), type, text, dealId, ...extra });
  if (all.length > MAX_ACTIVITY) all.splice(0, all.length - MAX_ACTIVITY);
  return put(K.activity, all);
}

/** Everything CRM, for the backup. */
export async function exportCrm() { return { tasks: await listTasks(), contacts: await listContacts(), activity: await listActivity() }; }
export async function importCrm({ tasks = [], contacts = [], activity = [] }) {
  await put(K.tasks, tasks);
  await put(K.contacts, contacts);
  await put(K.activity, activity);
}
