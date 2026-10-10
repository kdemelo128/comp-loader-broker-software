/* dealcrm.js -- the deal's place in the pipeline, on its Overview: stage,
 * next steps (tasks) and the people involved (contacts). */

import * as crm from './crm.js';
import { STAGE_LABEL, stageChoices, stageOf, taskBuckets, CONTACT_ROLES, KEY_DATE_LABELS, isoDay } from './pipeline.js';
import { el, svg, toast, niceDate } from './kit.js';

/**
 * box: the card; d: the open deal; touch(): save it. Draws, then redraws
 * itself when tasks or contacts change.
 */
export async function renderDealCrm(box, d, { touch, api }) {
  const [tasks, contacts] = await Promise.all([crm.listTasks(), crm.listContacts(), crm.loadStages()]);
  box.textContent = '';
  const h = el('div', 'card-head');
  h.appendChild(el('h2', null, 'Pipeline'));
  const sel = el('select', 'stage-select');
  sel.id = 'deal-stage';
  sel.setAttribute('aria-label', 'Deal stage');
  for (const [k, label] of stageChoices(stageOf(d))) { const o = el('option', null, label); o.value = k; sel.appendChild(o); }
  sel.value = stageOf(d);
  sel.addEventListener('change', () => {
    const was = stageOf(d);
    d.stage = sel.value;
    (d.stageHistory ||= []).push({ at: Date.now(), from: was, to: sel.value });
    touch();
    crm.log('stage', `${d.name || 'Untitled deal'}: ${STAGE_LABEL[was]} → ${STAGE_LABEL[sel.value]}`, d.id);
    const pill = document.getElementById('deal-stage-pill');
    if (pill) pill.textContent = STAGE_LABEL[sel.value];
    toast(`Stage: ${STAGE_LABEL[sel.value]}.`);
  });
  h.appendChild(sel);
  box.appendChild(h);

  // next steps
  const mine = tasks.filter((t) => t.dealId === d.id);
  const b = taskBuckets(mine);
  const open = [...b.overdue, ...b.today, ...b.week, ...b.later, ...b.undated];
  const sec = el('div', 'crm-sec');
  sec.appendChild(el('h3', null, `Next steps${open.length ? ` (${open.length})` : ''}`));
  const ul = el('div', 'task-list');
  for (const t of open) ul.appendChild(taskRow(t, { overdue: b.overdue.includes(t) }));
  if (!open.length) ul.appendChild(el('p', 'hint-sm', 'No next step set.'));
  sec.appendChild(ul);
  const add = el('form', 'task-add');
  const ti = el('input');
  ti.id = 'deal-task-title'; ti.placeholder = 'Add a next step'; ti.setAttribute('aria-label', 'New task for this deal'); ti.autocomplete = 'off';
  const due = el('input');
  due.type = 'date'; due.id = 'deal-task-due'; due.setAttribute('aria-label', 'Due date');
  const go = el('button', 'btn btn-sm', 'Add');
  go.type = 'submit';
  add.append(ti, due, go);
  add.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!ti.value.trim()) return;
    try { await crm.addTask({ title: ti.value, due: due.value || null, dealId: d.id }); } catch (err) { toast(err.message); }
  });
  sec.appendChild(add);
  box.appendChild(sec);

  // key dates: the deal's own milestones and deadlines
  const kd = el('div', 'crm-sec');
  const dates = (d.keyDates || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  kd.appendChild(el('h3', null, `Key dates${dates.length ? ` (${dates.length})` : ''}`));
  const today = isoDay();
  for (const k of dates) {
    const row = el('div', `task-row${k.done ? ' done' : ''}${!k.done && k.date < today ? ' overdue' : ''}`);
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = !!k.done;
    cb.setAttribute('aria-label', `${k.done ? 'Not passed' : 'Passed'}: ${k.label}`);
    cb.addEventListener('change', () => { k.done = cb.checked; touch(); renderDealCrm(box, d, { touch, api }); });
    const main = el('div', 'task-main');
    main.appendChild(el('span', 'task-title', k.label));
    main.appendChild(el('span', 'task-meta', `${niceDate(`${k.date}T12:00:00`)}${!k.done && k.date < today ? ' · past' : ''}`));
    const x = el('button', 'iconbtn');
    x.type = 'button';
    x.innerHTML = svg('<path d="M6 6l12 12M18 6L6 18"/>', 14);
    x.setAttribute('aria-label', `Delete key date: ${k.label}`);
    x.addEventListener('click', () => {
      const keep = d.keyDates;
      d.keyDates = keep.filter((q) => q !== k);
      touch();
      renderDealCrm(box, d, { touch, api });
      toast('Key date deleted.', { label: 'Undo', run: () => { d.keyDates = keep; touch(); renderDealCrm(box, d, { touch, api }); } });
    });
    row.append(cb, main, x);
    kd.appendChild(row);
  }
  const kf = el('form', 'task-add');
  const kl = el('select');
  kl.id = 'deal-date-label';
  kl.setAttribute('aria-label', 'Which date');
  for (const l of KEY_DATE_LABELS) { const o = el('option', null, l); o.value = l; kl.appendChild(o); }
  const kdt = el('input');
  kdt.type = 'date'; kdt.id = 'deal-date'; kdt.setAttribute('aria-label', 'Date');
  const kb = el('button', 'btn btn-sm', 'Add');
  kb.type = 'submit';
  kf.append(kl, kdt, kb);
  kf.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!kdt.value) { kdt.focus(); return; }
    (d.keyDates ||= []).push({ id: `k${Date.now().toString(36)}`, label: kl.value, date: kdt.value, done: false });
    touch();
    crm.log('deal', `${d.name || 'Untitled deal'}: ${kl.value} set for ${kdt.value}`, d.id);
    renderDealCrm(box, d, { touch, api });
  });
  kd.appendChild(kf);
  box.appendChild(kd);

  // people
  const people = contacts.filter((c) => (c.dealIds || []).includes(d.id));
  const ps = el('div', 'crm-sec');
  ps.appendChild(el('h3', null, `People${people.length ? ` (${people.length})` : ''}`));
  for (const c of people) {
    const row = el('div', 'contact-row');
    const m = el('div', 'contact-main');
    m.appendChild(el('b', null, c.name));
    m.appendChild(el('span', null, [c.role, c.company].filter(Boolean).join(' · ')));
    row.appendChild(m);
    row.appendChild(contactLinks(c));
    const x = el('button', 'iconbtn');
    x.type = 'button';
    x.innerHTML = svg('<path d="M6 6l12 12M18 6L6 18"/>', 14);
    x.setAttribute('aria-label', `Remove ${c.name} from this deal`);
    x.addEventListener('click', () => crm.linkContact(c.id, d.id, false));
    row.appendChild(x);
    ps.appendChild(row);
  }
  const acts = el('div', 'crm-acts');
  const others = contacts.filter((c) => !(c.dealIds || []).includes(d.id));
  if (others.length) {
    const pick = el('select');
    pick.setAttribute('aria-label', 'Add a saved contact to this deal');
    pick.appendChild(Object.assign(el('option', null, 'Add a saved contact…'), { value: '' }));
    for (const c of others.sort((a, b2) => a.name.localeCompare(b2.name))) { const o = el('option', null, `${c.name}${c.company ? `, ${c.company}` : ''}`); o.value = c.id; pick.appendChild(o); }
    pick.addEventListener('change', () => { if (pick.value) crm.linkContact(pick.value, d.id, true); });
    acts.appendChild(pick);
  }
  const nc = el('button', 'btn btn-sm btn-gray', '+ New contact');
  nc.type = 'button';
  nc.addEventListener('click', () => editContact(api, { dealIds: [d.id] }, [{ id: d.id, name: d.name || 'This deal' }]));
  acts.appendChild(nc);
  ps.appendChild(acts);
  box.appendChild(ps);
}

const relDue = (t) => {
  if (!t.due) return null;
  const today = isoDay();
  if (t.due === today) return 'today';
  return niceDate(`${t.due}T12:00:00`);
};

/** One task: tick it done (with undo), see when it is due, delete it (with undo). */
export function taskRow(t, { overdue = false, dealName = null, onDeal = null } = {}) {
  const row = el('div', `task-row${t.done ? ' done' : ''}${overdue ? ' overdue' : ''}`);
  const cb = el('input');
  cb.type = 'checkbox';
  cb.checked = !!t.done;
  cb.setAttribute('aria-label', `${t.done ? 'Not done' : 'Done'}: ${t.title}`);
  cb.addEventListener('change', async () => {
    await crm.updateTask(t.id, { done: cb.checked });
    if (cb.checked) toast(`Done: ${t.title}`, { label: 'Undo', run: () => crm.updateTask(t.id, { done: false }) });
  });
  const main = el('div', 'task-main');
  main.appendChild(el('span', 'task-title', t.title));
  const meta = [relDue(t) ? `${overdue ? 'was due' : 'due'} ${relDue(t)}` : null, t.source && t.source !== 'typed' ? `from ${t.source}` : null].filter(Boolean).join(' · ');
  const sub = el('span', 'task-meta', meta);
  if (dealName) {
    const a = el('button', 'btn-plain linkish', dealName);
    a.type = 'button';
    if (onDeal) a.addEventListener('click', onDeal);
    sub.append(meta ? ' · ' : '', a);
  }
  if (meta || dealName) main.appendChild(sub);
  const x = el('button', 'iconbtn');
  x.type = 'button';
  x.innerHTML = svg('<path d="M6 6l12 12M18 6L6 18"/>', 14);
  x.setAttribute('aria-label', `Delete task: ${t.title}`);
  x.addEventListener('click', async () => {
    const gone = await crm.deleteTask(t.id);
    toast('Task deleted.', { label: 'Undo', run: () => crm.restoreTask(gone) });
  });
  row.append(cb, main, x);
  return row;
}

export function contactLinks(c) {
  const box = el('div', 'contact-links');
  if (c.phone) { const a = el('a', 'chip chip-plain', 'Call'); a.href = `tel:${c.phone.replace(/[^\d+]/g, '')}`; a.setAttribute('aria-label', `Call ${c.name}`); box.appendChild(a); }
  if (c.email) { const a = el('a', 'chip chip-plain', 'Email'); a.href = `mailto:${c.email}`; a.setAttribute('aria-label', `Email ${c.name}`); box.appendChild(a); }
  return box;
}

/** Add or edit a contact in a sheet. deals: [{ id, name }] it may be linked to. */
export function editContact(api, c = {}, deals = []) {
  const save = el('button', 'btn', 'Save');
  save.type = 'button';
  save.id = 'contact-save';
  const foot = [save];
  if (c.id) {
    const del = el('button', 'btn btn-gray', 'Delete');
    del.type = 'button';
    del.addEventListener('click', async () => {
      const gone = await crm.deleteContact(c.id);
      api.sheetClose();
      toast(`${gone.name} deleted.`, { label: 'Undo', run: () => crm.restoreContact(gone) });
    });
    foot.unshift(del);
  }
  const body = api.sheetOpen({ eyebrow: 'Contact', title: c.id ? c.name : 'New contact', sub: 'Kept on this device.', foot });
  const form = el('div', 'grid-form');
  form.style.padding = '0';
  const field = (key, label, type = 'text', wide = false) => {
    const f = el('div', `field${wide ? ' wide' : ''}`);
    const l = el('label', null, label);
    const i = type === 'textarea' ? el('textarea') : el('input');
    if (type !== 'textarea') i.type = type;
    i.id = `contact-${key}`;
    i.value = c[key] || '';
    i.autocomplete = 'off';
    l.htmlFor = i.id;
    f.append(l, i);
    form.appendChild(f);
    return i;
  };
  const name = field('name', 'Name', 'text', true);
  const company = field('company', 'Company');
  const rf = el('div', 'field');
  const rl = el('label', null, 'Role');
  const role = el('select');
  role.id = 'contact-role';
  rl.htmlFor = role.id;
  for (const r of CONTACT_ROLES) { const o = el('option', null, r); o.value = r; role.appendChild(o); }
  role.value = c.role || 'Other';
  rf.append(rl, role);
  form.appendChild(rf);
  const phone = field('phone', 'Phone', 'tel');
  const email = field('email', 'Email', 'email');
  const notes = field('notes', 'Notes', 'textarea', true);
  body.appendChild(form);
  const linked = new Set(c.dealIds || []);
  if (deals.length) {
    const sec = el('section');
    sec.appendChild(el('h3', null, 'Deals'));
    for (const d of deals) {
      const l = el('label', 'chk');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = linked.has(d.id);
      cb.addEventListener('change', () => { if (cb.checked) linked.add(d.id); else linked.delete(d.id); });
      l.append(cb, document.createTextNode(` ${d.name}`));
      sec.appendChild(l);
    }
    body.appendChild(sec);
  }
  save.addEventListener('click', async () => {
    try {
      const rec = await crm.saveContact({ ...c, name: name.value, company: company.value, role: role.value, phone: phone.value.trim(), email: email.value.trim(), notes: notes.value, dealIds: [...linked] });
      api.sheetClose();
      toast(`${rec.name} saved.`);
    } catch (e) { toast(e.message); }
  });
  // only if nothing else has focus yet: on a slow device the timer can fire after the first tap into another field
  if (!c.id) setTimeout(() => { if (!document.activeElement?.matches('#sheet input, #sheet select, #sheet textarea')) name.focus(); }, 50);
}
