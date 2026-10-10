/* home.js -- the Home screen: what needs attention, the pipeline by stage,
 * tasks, contacts, recent activity and what was produced, and a pipeline
 * report to export or print. Everything here is kept on the device. */

import * as crm from './crm.js';
import { kvGet } from './store.js';
import { STAGES, STAGE_LABEL, DEFAULT_STAGES, HIDDEN, stageChoices, stageOf, pipelineSummary, taskBuckets, attention, findContacts, upcomingDates, isoDay } from './pipeline.js';
import { listAllDeals, updateDeal, showDeal, currentDealId } from './dealui.js';
import { taskRow, contactLinks, editContact } from './dealcrm.js';
import { $, el, toast, actionSheet, getXlsx, deliver, printed, XLSX, short, money0, money2, pct, int, niceDate, localDate } from './kit.js';

let api = null;
let visible = false;
let contactQuery = '';
let showDone = false;

const ok = (x) => typeof x === 'number' && Number.isFinite(x);
const capOf = (d) => (ok(d.figures.noi) && ok(d.figures.price) && d.figures.price > 0 ? (d.figures.noi / d.figures.price) * 100 : (ok(d.figures.cap) ? d.figures.cap : null));
const ago = (t) => {
  const s = (Date.now() - t) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 14) return `${Math.round(s / 86400)} days ago`;
  return niceDate(t);
};
const section = (title, id) => {
  const c = el('section', 'card home-sec');
  if (id) c.id = id;
  const h = el('div', 'card-head');
  h.appendChild(el('h2', null, title));
  c.appendChild(h);
  return [c, h];
};

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

async function render() {
  const root = $('home-root');
  if (!root) return;
  const [deals, tasks, contacts, activity] = await Promise.all([listAllDeals(), crm.listTasks(), crm.listContacts(), crm.listActivity(), crm.loadStages()]);
  const lastBackup = await kvGet('backup.last');
  const scrollY = window.scrollY;
  root.textContent = '';
  const nameOf = Object.fromEntries(deals.map((d) => [d.id, d.name || d.figures.address || 'Untitled deal']));
  const p = pipelineSummary(deals);
  const b = taskBuckets(tasks);

  // the header: the day, a greeting, and what is waiting, in real numbers
  const head = el('div', 'home-head');
  const hl = el('div');
  hl.appendChild(el('div', 'date', new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })));
  hl.appendChild(el('h1', null, greeting()));
  const due = b.overdue.length + b.today.length;
  hl.appendChild(el('p', 'lede', deals.length
    ? `${plural(p.activeCount, 'active deal')}${p.activeValue ? `, ${short(p.activeValue)} asking` : ''}. ${due ? `${plural(due, 'task')} due today or overdue.` : 'Nothing due today.'}`
    : 'Start with an offering memorandum or a set of comps. Everything you add stays on this device.'));
  head.appendChild(hl);
  const quick = el('div', 'view-actions quick');
  const om = el('label', 'btn btn-primary', 'Read an OM');
  om.htmlFor = 'om-file';
  om.addEventListener('click', () => api.showView('deal'));
  const cp = el('button', 'btn', 'Add comps');
  cp.type = 'button';
  cp.addEventListener('click', () => { api.showView('comps'); $('file').click(); });
  const nt = el('button', 'btn', 'New task');
  nt.type = 'button';
  nt.addEventListener('click', () => { const i = $('task-title'); if (i) { i.scrollIntoView({ block: 'center', behavior: 'smooth' }); i.focus({ preventScroll: true }); } });
  quick.append(om, cp, nt);
  head.appendChild(quick);
  root.appendChild(head);

  // the four figures that summarize the day
  const weekAgo = Date.now() - 7 * 86400000;
  const made = activity.filter((a) => a.type === 'deliverable');
  const sum = el('section', 'card home-summary');
  sum.setAttribute('aria-label', 'Summary');
  const tiles = el('div', 'tiles home-tiles');
  const tile = (k, v, s2, cls) => { const x = el('div', `tile${cls ? ` ${cls}` : ''}`); x.append(el('div', 'k', k), el('div', 'v', v)); if (s2) x.appendChild(el('div', 's', s2)); tiles.appendChild(x); };
  tile('Active deals', String(p.activeCount), p.activeValue ? `${short(p.activeValue)} asking${p.activeUnpriced ? `, ${p.activeUnpriced} unpriced` : ''}` : (p.activeCount ? 'none priced yet' : 'none yet'));
  tile('Due today', String(b.today.length), b.overdue.length ? `${b.overdue.length} overdue` : 'none overdue', b.overdue.length ? 'warn' : '');
  tile('This week', String(b.week.length), 'tasks due');
  tile('Produced', String(made.filter((a) => a.at >= weekAgo).length), 'files and prints this week');
  sum.appendChild(tiles);
  root.appendChild(sum);

  // what needs attention, most urgent first
  const att = attention(deals, tasks);
  const dates = upcomingDates(deals, { days: 30 });
  for (const k of dates.filter((x) => x.daysLeft <= 7)) att.unshift({ kind: 'date', dealId: k.dealId, text: `${k.name}: ${k.label} ${k.daysLeft < 0 ? `was ${-k.daysLeft} day${k.daysLeft === -1 ? '' : 's'} ago` : k.daysLeft === 0 ? 'is today' : `in ${k.daysLeft} day${k.daysLeft === 1 ? '' : 's'}`}.` });
  if (deals.length && (!lastBackup || Date.now() - lastBackup > 30 * 86400000)) att.push({ kind: 'backup', view: 'settings', text: lastBackup ? `No backup for ${Math.floor((Date.now() - lastBackup) / 86400000)} days: back up in Settings.` : 'No backup yet: everything is on this device only. Back up in Settings.' });

  const grid = el('div', 'bento');
  grid.appendChild(continueCard(deals, tasks));
  const side = el('div', 'span-4 ws-main');
  side.appendChild(attentionCard(att));
  if (dates.length) side.appendChild(datesCard(dates));
  grid.appendChild(side);
  const pipe = pipelineCard(p);
  pipe.classList.add('span-12');
  grid.appendChild(pipe);
  const tk = tasksCard(tasks, deals, nameOf);
  tk.classList.add('span-7');
  grid.appendChild(tk);
  const ac = activityCard(activity, nameOf);
  ac.classList.add('span-5');
  grid.appendChild(ac);
  const ct = contactsCard(contacts, deals, nameOf);
  ct.classList.add('span-12');
  grid.appendChild(ct);
  root.appendChild(grid);
  window.scrollTo({ top: scrollY });
}

/** The deals touched most recently, with their figures and next step: one tap back into each. */
function continueCard(deals, tasks) {
  const [c, h] = section('Continue working', 'home-continue');
  c.classList.add('span-8');
  const recent = deals.slice().sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0)).slice(0, 5);
  if (deals.length > 5) {
    const all = el('button', 'btn btn-sm btn-gray', `All ${deals.length} deals`);
    all.type = 'button';
    all.addEventListener('click', () => api.showView('deal'));
    h.appendChild(all);
  }
  if (!recent.length) {
    const e = el('div', 'all-clear');
    e.textContent = 'Deals you open appear here, newest first, with their figures and next step. ';
    const ex = el('button', 'linkish', 'Open the fictional example deal');
    ex.type = 'button';
    ex.addEventListener('click', () => { api.showView('deal'); setTimeout(() => [...document.querySelectorAll('#deal-root button')].find((x) => /fictional example/.test(x.textContent))?.click(), 50); });
    e.appendChild(ex);
    c.appendChild(e);
    return c;
  }
  const today = isoDay();
  const ul = el('ul', 'cont');
  for (const d of recent) {
    const f = d.figures || {};
    const li = el('li');
    const bt = el('button', 'cont-row');
    bt.type = 'button';
    const left = el('div');
    left.style.minWidth = '0';
    left.appendChild(el('div', 'cont-name', dealTitle(d)));
    const meta = el('div', 'cont-meta');
    meta.appendChild(el('span', 'stage-pill', STAGE_LABEL[stageOf(d)]));
    const where = [f.ptype, [f.city, f.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
    if (where) meta.appendChild(el('span', null, where));
    meta.appendChild(el('span', null, `updated ${ago(d.updatedAt || d.createdAt)}`));
    left.appendChild(meta);
    bt.appendChild(left);
    const figs = el('div', 'cont-figs');
    const fig = (label, v) => { const x = el('div'); x.append(el('b', null, v), el('span', null, label)); figs.appendChild(x); };
    fig('Asking', ok(f.price) ? short(f.price) : '—');
    const cap = capOf(d);
    fig('Cap', ok(cap) ? pct(cap, 2) : '—');
    fig('NOI', ok(f.noi) ? short(f.noi) : '—');
    bt.appendChild(figs);
    const open = tasks.filter((t) => t.dealId === d.id && !t.done).sort((x, y) => String(x.due || '9999').localeCompare(String(y.due || '9999')));
    const nx = open[0];
    const late = nx && nx.due && nx.due < today;
    bt.appendChild(el('div', `cont-next${late ? ' late' : ''}`, nx ? `Next: ${nx.title}${nx.due ? ` · ${late ? 'was due' : 'due'} ${nx.due === today ? 'today' : niceDate(`${nx.due}T12:00:00`)}` : ''}` : 'No next step set'));
    bt.addEventListener('click', () => showDeal(d.id));
    li.appendChild(bt);
    ul.appendChild(li);
  }
  c.appendChild(ul);
  return c;
}
const dealTitle = (d) => d.name || (d.figures && d.figures.address) || 'Untitled deal';

function attentionCard(att) {
  const [c] = section('Needs attention', 'home-attention');
  if (!att.length) { c.appendChild(el('p', 'all-clear', 'All clear: nothing overdue, and every active deal has a next step.')); return c; }
  const ul = el('ul', 'attn');
  for (const a of att.slice(0, 8)) {
    const li = el('li', `k-${a.kind}${a.kind === 'overdue' ? ' warn-text' : ''}`);
    if (a.dealId || a.view) {
      const bt = el('button', 'linkish', a.text);
      bt.type = 'button';
      bt.addEventListener('click', () => (a.dealId ? showDeal(a.dealId) : api.showView(a.view)));
      li.appendChild(bt);
    } else li.textContent = a.text;
    ul.appendChild(li);
  }
  if (att.length > 8) ul.appendChild(el('li', 'hint-sm', `and ${att.length - 8} more`));
  c.appendChild(ul);
  return c;
}

/* -------------------------------------------------------------- pipeline */

function pipelineCard(p) {
  const [c, h] = section('Pipeline', 'home-pipeline');
  const st = el('button', 'btn btn-sm btn-gray', 'Stages');
  st.type = 'button';
  st.id = 'pipeline-stages';
  st.addEventListener('click', editStages);
  h.appendChild(st);
  const rep = el('button', 'btn btn-sm btn-gray', 'Report');
  rep.type = 'button';
  rep.id = 'pipeline-report';
  rep.addEventListener('click', report);
  h.appendChild(rep);
  if (!p.stages.some((s) => s.count)) {
    const e = el('p', 'all-clear');
    e.textContent = 'No deals yet. Read an OM, or start a deal by hand, and it appears here by stage.';
    c.appendChild(e);
    return c;
  }
  // the shape of the pipeline at a glance: one segment per deal stage, sized by count
  const bar = el('div', 'pipe-bar');
  bar.setAttribute('aria-hidden', 'true');
  for (const s2 of p.stages.filter((x) => x.count)) {
    const i = el('i', s2.key === 'closed' ? 'closed' : s2.key === 'dead' ? 'dead' : null);
    i.style.flex = String(s2.count);
    i.title = `${s2.label}: ${s2.count}`;
    bar.appendChild(i);
  }
  c.appendChild(bar);
  const board = el('div', 'pipe');
  board.setAttribute('role', 'list');
  // empty stages take no room on a phone: they are named in one line instead
  const empty = p.stages.filter((s) => !s.count).map((s) => s.label);
  for (const s of p.stages.filter((x) => x.count)) {
    const col = el('div', `pipe-col${s.key === 'dead' || s.key === 'closed' ? ' muted' : ''}`);
    col.setAttribute('role', 'listitem');
    col.dataset.stage = s.key;
    const ch = el('div', 'pipe-head');
    ch.append(el('b', null, s.label), el('span', null, `${s.count}${s.value ? ` · ${short(s.value)}` : ''}`));
    col.appendChild(ch);
    for (const d of s.deals) {
      const card = el('div', 'pipe-card');
      const open = el('button', 'pipe-open');
      open.type = 'button';
      open.appendChild(el('b', null, d.name || d.figures.address || 'Untitled deal'));
      const cap = capOf(d);
      open.appendChild(el('span', null, [ok(d.figures.price) ? short(d.figures.price) : 'unpriced', ok(cap) ? `${pct(cap, 2)} cap` : null, d.figures.ptype || null].filter(Boolean).join(' · ')));
      open.appendChild(el('span', 'pipe-when', `updated ${ago(d.updatedAt || d.createdAt)}`));
      open.addEventListener('click', () => showDeal(d.id));
      const sel = el('select');
      sel.setAttribute('aria-label', `Stage of ${d.name || 'deal'}`);
      for (const [k, label] of stageChoices(stageOf(d))) { const o = el('option', null, label); o.value = k; sel.appendChild(o); }
      sel.value = stageOf(d);
      sel.addEventListener('change', async () => {
        const was = stageOf(d);
        await updateDeal(d.id, (x) => { x.stage = sel.value; (x.stageHistory ||= []).push({ at: Date.now(), from: was, to: sel.value }); });
        await crm.log('stage', `${d.name || 'Untitled deal'}: ${STAGE_LABEL[was]} → ${STAGE_LABEL[sel.value]}`, d.id);
      });
      card.append(open, sel);
      col.appendChild(card);
    }
    board.appendChild(col);
  }
  c.appendChild(board);
  if (empty.length) { const e = el('p', 'hint-sm pipe-empty', `No deals in ${empty.join(', ')}.`); c.appendChild(e); }
  return c;
}

function datesCard(dates) {
  const [c] = section('Key dates', 'home-dates');
  c.querySelector('.card-head').appendChild(el('span', 'count', 'next 30 days'));
  const ul = el('div', 'task-group');
  for (const k of dates) {
    const row = el('div', `task-row date-row${k.daysLeft < 0 ? ' overdue' : ''}`);
    const when = el('span', 'date-when', k.daysLeft < 0 ? `${-k.daysLeft}d ago` : k.daysLeft === 0 ? 'today' : `in ${k.daysLeft}d`);
    const main = el('div', 'task-main');
    main.appendChild(el('span', 'task-title', k.label));
    const a = el('button', 'btn-plain linkish', k.name);
    a.type = 'button';
    a.addEventListener('click', () => showDeal(k.dealId));
    const meta = el('span', 'task-meta', `${niceDate(`${k.date}T12:00:00`)} · `);
    meta.appendChild(a);
    main.appendChild(meta);
    row.append(when, main);
    ul.appendChild(row);
  }
  c.appendChild(ul);
  return c;
}

/** Rename stages or hide those the firm does not use. Keys never change, so deals keep their stage. */
export async function editStages() {
  await crm.loadStages();
  const save = el('button', 'btn', 'Save');
  save.type = 'button';
  save.id = 'stages-save';
  const reset = el('button', 'btn btn-gray', 'Defaults');
  reset.type = 'button';
  const body = api.sheetOpen({ eyebrow: 'Pipeline', title: 'Stages', sub: 'Rename stages to your firm’s words, or hide the ones you do not use. A deal in a hidden stage stays there.', foot: [reset, save] });
  const rows = [];
  for (const [k, def] of DEFAULT_STAGES) {
    const r = el('div', 'stage-row');
    const i = el('input');
    i.id = `stage-${k}`;
    i.value = STAGE_LABEL[k];
    i.placeholder = def;
    i.setAttribute('aria-label', `Name for the ${def} stage`);
    const l = el('label', 'chk');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = !HIDDEN.has(k);
    cb.id = `stage-show-${k}`;
    l.append(cb, document.createTextNode(' Show'));
    r.append(i, l);
    body.appendChild(r);
    rows.push([k, def, i, cb]);
  }
  reset.addEventListener('click', () => { for (const [, def, i, cb] of rows) { i.value = def; cb.checked = true; } });
  save.addEventListener('click', async () => {
    const next = {};
    for (const [k, def, i, cb] of rows) { const label = i.value.trim(); if ((label && label !== def) || !cb.checked) next[k] = { label: label && label !== def ? label : '', hidden: !cb.checked }; }
    await crm.saveStages(next);
    api.sheetClose();
    toast('Stages saved.');
  });
}

/* ----------------------------------------------------------------- tasks */

function tasksCard(tasks, deals, nameOf) {
  const [c, h] = section('Tasks', 'home-tasks');
  const tog = el('button', 'btn btn-sm btn-gray', showDone ? 'Hide done' : 'Show done');
  tog.type = 'button';
  tog.addEventListener('click', () => { showDone = !showDone; render(); });
  h.appendChild(tog);
  const add = el('form', 'task-add home-task-add');
  const ti = el('input');
  ti.id = 'task-title'; ti.placeholder = 'New task'; ti.setAttribute('aria-label', 'New task'); ti.autocomplete = 'off';
  const due = el('input');
  due.type = 'date'; due.id = 'task-due'; due.setAttribute('aria-label', 'Due date');
  const ds = el('select');
  ds.id = 'task-deal';
  ds.setAttribute('aria-label', 'Deal for the task');
  ds.appendChild(Object.assign(el('option', null, 'No deal'), { value: '' }));
  for (const d of deals.filter((x) => !['dead', 'closed'].includes(stageOf(x)))) { const o = el('option', null, nameOf[d.id]); o.value = d.id; ds.appendChild(o); }
  const go = el('button', 'btn btn-sm', 'Add');
  go.type = 'submit';
  add.append(ti, due, ds, go);
  add.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!ti.value.trim()) { ti.focus(); return; }
    try { await crm.addTask({ title: ti.value, due: due.value || null, dealId: ds.value || null }); } catch (err) { toast(err.message); }
  });
  c.appendChild(add);
  const b = taskBuckets(tasks);
  const groups = [['Overdue', b.overdue, true], ['Today', b.today], ['Next 7 days', b.week], ['Later', b.later], ['No date', b.undated], ...(showDone ? [['Done', b.done.slice(0, 30)]] : [])];
  let any = false;
  for (const [title, list, late] of groups) {
    if (!list.length) continue;
    any = true;
    const g = el('div', 'task-group');
    g.appendChild(el('h3', late ? 'warn-text' : null, `${title} (${list.length})`));
    for (const t of list) g.appendChild(taskRow(t, { overdue: !!late, dealName: t.dealId ? nameOf[t.dealId] || 'a deleted deal' : null, onDeal: t.dealId && nameOf[t.dealId] ? () => showDeal(t.dealId) : null }));
    c.appendChild(g);
  }
  if (!any) c.appendChild(el('p', 'all-clear', 'Nothing to do yet. Add a task above, or a next step on any deal.'));
  return c;
}

/* -------------------------------------------------------------- contacts */

function contactsCard(contacts, deals, nameOf) {
  const [c, h] = section('Contacts', 'home-contacts');
  const dealList = deals.map((d) => ({ id: d.id, name: nameOf[d.id] }));
  const add = el('button', 'btn btn-sm btn-gray', '+ Contact');
  add.type = 'button';
  add.id = 'contact-add';
  add.addEventListener('click', () => editContact(api, {}, dealList));
  h.appendChild(add);
  const q = el('input', 'tool-search');
  q.type = 'search'; q.id = 'contact-search'; q.placeholder = 'Search name, company, role'; q.setAttribute('aria-label', 'Search contacts'); q.value = contactQuery;
  const list = el('div', 'contact-list');
  list.appendChild(q);
  const rows = el('div');
  list.appendChild(rows);
  const draw = () => {
    rows.textContent = '';
    const found = findContacts(contacts, contactQuery);
    for (const ct of found) {
      const row = el('div', 'contact-row');
      row.dataset.initials = ct.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
      const m = el('button', 'contact-main btn-plain');
      m.type = 'button';
      m.appendChild(el('b', null, ct.name));
      m.appendChild(el('span', null, [ct.role, ct.company, ...(ct.dealIds || []).map((x) => nameOf[x]).filter(Boolean)].filter(Boolean).join(' · ')));
      m.addEventListener('click', () => editContact(api, ct, dealList));
      row.append(m, contactLinks(ct));
      rows.appendChild(row);
    }
    if (!found.length) rows.appendChild(el('p', 'hint-sm', contacts.length ? 'No contact matches.' : 'No contacts yet: owners, brokers, lenders and tenants you add are kept here, linked to their deals.'));
  };
  q.addEventListener('input', () => { contactQuery = q.value; draw(); });
  draw();
  c.appendChild(list);
  return c;
}

/* --------------------------------------------------------------- activity */

function activityCard(activity, nameOf) {
  const [c] = section('Recent activity', 'home-activity');
  const ul = el('ul', 'activity');
  const recent = activity.slice(-25).reverse();
  for (const a of recent) {
    const li = el('li', `act-${a.type}`);
    li.appendChild(el('span', 'act-when', ago(a.at)));
    li.appendChild(el('span', null, `${a.type === 'deliverable' ? (a.kind === 'print' ? 'Printed: ' : 'Saved: ') : ''}${a.text}${a.dealId && nameOf[a.dealId] && a.type === 'deliverable' && !a.text.includes(nameOf[a.dealId]) ? ` (${nameOf[a.dealId]})` : ''}`));
    ul.appendChild(li);
  }
  if (!recent.length) ul.appendChild(el('li', 'hint-sm', 'Nothing yet: stage changes, tasks, contacts and the files you produce are listed here.'));
  c.appendChild(ul);
  return c;
}

/* ----------------------------------------------------------------- report */

async function reportData() {
  const [deals, tasks, contacts] = await Promise.all([listAllDeals(), crm.listTasks(), crm.listContacts()]);
  const today = isoDay();
  const order = Object.fromEntries(STAGES.map(([k], i) => [k, i]));
  const rows = deals.slice().sort((a, b) => order[stageOf(a)] - order[stageOf(b)] || (b.updatedAt || 0) - (a.updatedAt || 0)).map((d) => {
    const open = tasks.filter((t) => t.dealId === d.id && !t.done);
    const next = open.filter((t) => t.due).sort((a, b) => a.due.localeCompare(b.due))[0];
    const f = d.figures;
    return {
      id: d.id, name: d.name || f.address || 'Untitled deal', stage: STAGE_LABEL[stageOf(d)], type: f.ptype || '', city: [f.city, f.state].filter(Boolean).join(', '),
      price: ok(f.price) ? f.price : null, noi: ok(f.noi) ? f.noi : null, cap: capOf(d), sf: ok(f.bsf) ? f.bsf : null, ppsf: ok(f.price) && ok(f.bsf) && f.bsf > 0 ? f.price / f.bsf : null,
      openTasks: open.length, next: next ? `${next.title} (${next.due}${next.due < today ? ', overdue' : ''})` : (open[0] ? open[0].title : ''),
      people: contacts.filter((c) => (c.dealIds || []).includes(d.id)).map((c) => `${c.name}${c.role ? ` (${c.role})` : ''}`).join('; '),
      updated: new Date(d.updatedAt || d.createdAt || Date.now()),
    };
  });
  return { rows, tasks, contacts, deals };
}

async function report() {
  const v = await actionSheet('Pipeline report', [
    { label: 'Excel workbook', sub: 'Pipeline, tasks and contacts, one sheet each', value: 'xlsx', primary: true },
    { label: 'Print or save as PDF', sub: 'The pipeline by stage, with next steps', value: 'print' },
  ]);
  if (v === 'xlsx') reportXlsx().catch((e) => { console.error(e); toast('The report could not be built here.'); });
  else if (v === 'print') reportPrint();
}

async function reportXlsx() {
  const { rows, tasks, contacts, deals } = await reportData();
  const nameOf = Object.fromEntries(deals.map((d) => [d.id, d.name || d.figures.address || 'Untitled deal']));
  const { ExcelJS } = await getXlsx();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Comp Loader';
  const sheet = (name, cols, data) => {
    const ws = wb.addWorksheet(name);
    ws.columns = cols.map(([header, key, width, numFmt]) => ({ header, key, width, style: numFmt ? { numFmt } : {} }));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    for (const r of data) ws.addRow(r);
    return ws;
  };
  sheet('Pipeline', [['Deal', 'name', 32], ['Stage', 'stage', 16], ['Type', 'type', 14], ['City', 'city', 18], ['Asking price', 'price', 15, '$#,##0'], ['NOI', 'noi', 13, '$#,##0'],
    ['Cap rate', 'capFrac', 10, '0.00%'], ['Building SF', 'sf', 12, '#,##0'], ['Price / SF', 'ppsf', 11, '$#,##0.00'], ['Open tasks', 'openTasks', 10], ['Next step', 'next', 40], ['People', 'people', 36], ['Updated', 'updated', 12, 'yyyy-mm-dd']],
  rows.map((r) => ({ ...r, capFrac: ok(r.cap) ? r.cap / 100 : null })));
  sheet('Tasks', [['Task', 'title', 44], ['Due', 'due', 12], ['Deal', 'deal', 30], ['Done', 'done', 8], ['From', 'source', 22]],
    tasks.map((t) => ({ title: t.title, due: t.due || '', deal: t.dealId ? nameOf[t.dealId] || '(deleted deal)' : '', done: t.done ? 'Yes' : '', source: t.source || '' })));
  sheet('Contacts', [['Name', 'name', 24], ['Company', 'company', 24], ['Role', 'role', 16], ['Phone', 'phone', 16], ['Email', 'email', 28], ['Deals', 'deals', 36], ['Notes', 'notes', 40]],
    contacts.map((c) => ({ ...c, deals: (c.dealIds || []).map((x) => nameOf[x]).filter(Boolean).join('; ') })));
  const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
  await deliver(`Pipeline ${localDate()}.xlsx`, bytes, XLSX);
}

async function reportPrint() {
  const { rows } = await reportData();
  const box = $('print-sheet');
  box.textContent = '';
  box.className = 'print-sheet';
  const head = el('div', 'ps-head');
  const left = el('div');
  left.append(el('div', 'ps-eyebrow', 'Pipeline'), el('div', 'ps-title', 'Deals by stage'), el('div', 'ps-sub', `${rows.length} deal${rows.length === 1 ? '' : 's'}`));
  head.append(left, el('div', 'ps-meta', niceDate(new Date())));
  box.appendChild(head);
  for (const [, label] of STAGES) {
    const rs = rows.filter((r) => r.stage === label);
    if (!rs.length) continue;
    box.appendChild(el('div', 'ps-h2', `${label} (${rs.length})`));
    const t = el('table', 'ps-table');
    const hr = el('tr');
    for (const x of ['Deal', 'Type', 'Asking', 'NOI', 'Cap', 'SF', '$/SF', 'Next step', 'People']) hr.appendChild(el('th', null, x));
    t.appendChild(hr);
    for (const r of rs) {
      const tr = el('tr');
      tr.append(el('td', 'ps-name', r.name), el('td', null, r.type), el('td', 'r', ok(r.price) ? money0(r.price) : '—'), el('td', 'r', ok(r.noi) ? money0(r.noi) : '—'),
        el('td', 'r', ok(r.cap) ? pct(r.cap) : '—'), el('td', 'r', ok(r.sf) ? int(r.sf) : '—'), el('td', 'r', ok(r.ppsf) ? money2(r.ppsf) : '—'), el('td', 'ps-small', r.next), el('td', 'ps-small', r.people));
      t.appendChild(tr);
    }
    box.appendChild(t);
  }
  box.appendChild(el('p', 'ps-foot', 'Cap rate is NOI over asking price where both are known, else the stated cap rate. Figures as entered in Comp Loader on this device.'));
  printed('Pipeline report');
  window.print();
}

/* ------------------------------------------------------------------- init */

export function initHome(compsApi) {
  api = compsApi;
  let view = null;
  const refresh = () => { if (visible) render(); };
  document.addEventListener('viewchange', (e) => { view = e.detail; visible = e.detail === 'home'; refresh(); });
  document.addEventListener('crmchange', refresh);
  document.addEventListener('dealchange', refresh);
  // every file saved or printed is listed, with the deal it was for when made from the Deal tab
  document.addEventListener('deliverable', (e) => { crm.log('deliverable', e.detail.name, view === 'deal' ? currentDealId() : null, { kind: e.detail.kind }); });
}
