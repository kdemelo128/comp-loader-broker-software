/* home.js -- the Home screen: what needs attention, the pipeline by stage,
 * tasks, contacts, recent activity and what was produced, and a pipeline
 * report to export or print. Everything here is kept on the device. */

import * as crm from './crm.js';
import { kvGet } from './store.js';
import { STAGES, STAGE_LABEL, stageOf, pipelineSummary, taskBuckets, attention, findContacts, isoDay } from './pipeline.js';
import { listAllDeals, updateDeal, showDeal, currentDealId } from './dealui.js';
import { taskRow, contactLinks, editContact } from './dealcrm.js';
import { renderDataCard } from './backupui.js';
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

async function render() {
  const root = $('home-root');
  if (!root) return;
  const [deals, tasks, contacts, activity] = await Promise.all([listAllDeals(), crm.listTasks(), crm.listContacts(), crm.listActivity()]);
  const scrollY = window.scrollY;
  root.textContent = '';
  const nameOf = Object.fromEntries(deals.map((d) => [d.id, d.name || d.figures.address || 'Untitled deal']));
  const head = el('div', 'view-head');
  head.appendChild(el('h1', null, 'Home'));
  head.appendChild(el('p', null, `${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}. Deals, next steps and contacts, kept on this device.`));
  root.appendChild(head);

  const p = pipelineSummary(deals);
  const b = taskBuckets(tasks);
  const weekAgo = Date.now() - 7 * 86400000;
  const made = activity.filter((a) => a.type === 'deliverable');
  const tiles = el('div', 'tiles home-tiles');
  const tile = (k, v, s, cls) => { const x = el('div', `tile${cls ? ` ${cls}` : ''}`); x.append(el('div', 'k', k), el('div', 'v', v)); if (s) x.appendChild(el('div', 's', s)); tiles.appendChild(x); };
  tile('Active deals', String(p.activeCount), p.activeValue ? `${short(p.activeValue)} asking${p.activeUnpriced ? `, ${p.activeUnpriced} unpriced` : ''}` : null);
  tile('Due today', String(b.today.length), b.overdue.length ? `${b.overdue.length} overdue` : 'none overdue', b.overdue.length ? 'warn' : '');
  tile('This week', String(b.week.length), 'tasks due');
  tile('Produced', String(made.filter((a) => a.at >= weekAgo).length), 'files and prints this week');
  root.appendChild(tiles);

  const att = attention(deals, tasks);
  const lastBackup = await kvGet('backup.last');
  if (deals.length && (!lastBackup || Date.now() - lastBackup > 30 * 86400000)) att.push({ kind: 'backup', text: lastBackup ? `No backup for ${Math.floor((Date.now() - lastBackup) / 86400000)} days: Your data, below.` : 'No backup yet: everything is on this device only (Your data, below).' });
  if (att.length) {
    const [c] = section('Needs attention', 'home-attention');
    const ul = el('ul', 'attn');
    for (const a of att.slice(0, 8)) {
      const li = el('li', a.kind === 'overdue' ? 'warn-text' : null);
      if (a.dealId) { const bt = el('button', 'btn-plain linkish', a.text); bt.type = 'button'; bt.addEventListener('click', () => showDeal(a.dealId)); li.appendChild(bt); } else li.textContent = a.text;
      ul.appendChild(li);
    }
    if (att.length > 8) ul.appendChild(el('li', 'hint-sm', `and ${att.length - 8} more`));
    c.appendChild(ul);
    root.appendChild(c);
  }

  root.appendChild(pipelineCard(p));
  root.appendChild(tasksCard(tasks, deals, nameOf));
  root.appendChild(contactsCard(contacts, deals, nameOf));
  root.appendChild(activityCard(activity, nameOf));
  const data = el('section', 'card home-sec');
  data.id = 'home-data';
  root.appendChild(data);
  await renderDataCard(data, api);
  window.scrollTo({ top: scrollY });
}

/* -------------------------------------------------------------- pipeline */

function pipelineCard(p) {
  const [c, h] = section('Pipeline', 'home-pipeline');
  const rep = el('button', 'btn btn-sm btn-gray', 'Report');
  rep.type = 'button';
  rep.id = 'pipeline-report';
  rep.addEventListener('click', report);
  h.appendChild(rep);
  if (!p.stages.some((s) => s.count)) {
    const e = el('p', 'hint');
    e.style.padding = '0 16px 16px';
    e.textContent = 'No deals yet. Read an OM on the Deal tab, or enter one by hand; it appears here by stage.';
    c.appendChild(e);
    return c;
  }
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
      for (const [k, label] of STAGES) { const o = el('option', null, label); o.value = k; sel.appendChild(o); }
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
  if (!any) { const e = el('p', 'hint-sm', 'Nothing to do yet.'); e.style.padding = '0 16px 14px'; c.appendChild(e); }
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
  q.style.margin = '0 16px 8px';
  q.style.width = 'calc(100% - 32px)';
  c.appendChild(q);
  const list = el('div', 'contact-list');
  const draw = () => {
    list.textContent = '';
    const found = findContacts(contacts, contactQuery);
    for (const ct of found) {
      const row = el('div', 'contact-row');
      const m = el('button', 'contact-main btn-plain');
      m.type = 'button';
      m.appendChild(el('b', null, ct.name));
      m.appendChild(el('span', null, [ct.role, ct.company, ...(ct.dealIds || []).map((x) => nameOf[x]).filter(Boolean)].filter(Boolean).join(' · ')));
      m.addEventListener('click', () => editContact(api, ct, dealList));
      row.append(m, contactLinks(ct));
      list.appendChild(row);
    }
    if (!found.length) list.appendChild(el('p', 'hint-sm', contacts.length ? 'No contact matches.' : 'No contacts yet.'));
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
