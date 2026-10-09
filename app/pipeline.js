/* pipeline.js -- the arithmetic of the Home screen: deals by stage, tasks by
 * when they are due, what needs attention. Pure, no DOM (tests/pipeline.test.js). */

export const STAGES = [
  ['prospect', 'Prospect'], ['underwriting', 'Underwriting'], ['offer', 'Offer / LOI'],
  ['contract', 'Under contract'], ['closed', 'Closed'], ['dead', 'Passed'],
];
export const STAGE_LABEL = Object.fromEntries(STAGES);
export const ACTIVE = ['prospect', 'underwriting', 'offer', 'contract'];
/** A deal saved before stages existed was being underwritten. */
export const stageOf = (d) => (d && STAGE_LABEL[d.stage] ? d.stage : 'underwriting');

export const CONTACT_ROLES = ['Owner', 'Seller’s broker', 'Buyer', 'Lender', 'Tenant', 'Attorney', 'Property manager', 'Other'];

const ok = (x) => typeof x === 'number' && Number.isFinite(x) && x > 0;
const day = (s) => { if (!s) return null; const t = Date.parse(`${String(s).slice(0, 10)}T00:00:00Z`); return Number.isNaN(t) ? null : t / 86400000; };
export const isoDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Deals by stage: count and asking value, with the deals newest first. */
export function pipelineSummary(deals) {
  const out = Object.fromEntries(STAGES.map(([k, label]) => [k, { key: k, label, count: 0, value: 0, priced: 0, deals: [] }]));
  for (const d of deals) {
    const s = out[stageOf(d)];
    s.count += 1;
    s.deals.push(d);
    const p = d.figures && d.figures.price;
    if (ok(p)) { s.value += p; s.priced += 1; }
  }
  for (const s of Object.values(out)) s.deals.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const active = ACTIVE.map((k) => out[k]);
  return {
    stages: STAGES.map(([k]) => out[k]),
    activeCount: active.reduce((t, s) => t + s.count, 0),
    activeValue: active.reduce((t, s) => t + s.value, 0),
    activeUnpriced: active.reduce((t, s) => t + (s.count - s.priced), 0),
  };
}

/** Open tasks by when they are due, against `today` (YYYY-MM-DD); done ones last, newest first. */
export function taskBuckets(tasks, today = isoDay()) {
  const t0 = day(today);
  const b = { overdue: [], today: [], week: [], later: [], undated: [], done: [] };
  for (const t of tasks) {
    if (t.done) { b.done.push(t); continue; }
    const d = day(t.due);
    if (d === null) b.undated.push(t);
    else if (d < t0) b.overdue.push(t);
    else if (d === t0) b.today.push(t);
    else if (d <= t0 + 7) b.week.push(t);
    else b.later.push(t);
  }
  const byDue = (x, y) => (day(x.due) ?? Infinity) - (day(y.due) ?? Infinity) || (x.createdAt || 0) - (y.createdAt || 0);
  for (const k of ['overdue', 'today', 'week', 'later', 'undated']) b[k].sort(byDue);
  b.done.sort((x, y) => (y.doneAt || 0) - (x.doneAt || 0));
  return b;
}

/**
 * What to look at first, one line each: overdue tasks, active deals with no
 * open task, and active deals untouched for `staleDays`.
 */
export function attention(deals, tasks, { today = isoDay(), staleDays = 21 } = {}) {
  const out = [];
  const b = taskBuckets(tasks, today);
  if (b.overdue.length) out.push({ kind: 'overdue', text: `${b.overdue.length} task${b.overdue.length === 1 ? ' is' : 's are'} overdue.` });
  const open = new Set(tasks.filter((t) => !t.done && t.dealId).map((t) => t.dealId));
  const t0 = day(today) * 86400000;
  for (const d of deals) {
    if (!ACTIVE.includes(stageOf(d))) continue;
    const name = d.name || 'Untitled deal';
    if (!open.has(d.id)) out.push({ kind: 'no-task', dealId: d.id, text: `${name}: no next step set.` });
    if (d.updatedAt && t0 - d.updatedAt > staleDays * 86400000) out.push({ kind: 'stale', dealId: d.id, text: `${name}: untouched for ${Math.floor((t0 - d.updatedAt) / 86400000)} days.` });
  }
  return out;
}

/** Contacts matching a search, by name, company, role, email or phone. */
export function findContacts(contacts, q) {
  const s = String(q || '').trim().toLowerCase();
  const list = s ? contacts.filter((c) => [c.name, c.company, c.role, c.email, c.phone].some((x) => String(x || '').toLowerCase().includes(s))) : contacts.slice();
  return list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}
