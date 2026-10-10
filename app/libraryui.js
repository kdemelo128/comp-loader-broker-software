/* libraryui.js -- the template library: upload a firm's workbook, map the
 * deal into it once, and fill it for any deal afterwards, seeing every
 * change before it is written. */

import { inspectWorkbook, suggestCellMap, previewCells, fillCells } from './template.js';
import { DEAL_FIELDS, DEAL_FIELD, dealValues, RR_TABLE_FIELDS, rrFieldForHeader } from './dealfields.js';
import { COLUMNS, gridContext } from './rentroll.js';
import {
  listTemplates, putTemplate, deleteTemplate, newTemplate, currentBytes, currentFile, addVersion, duplicateTemplate,
  exportPackage, readPackage, CATEGORIES,
} from './library.js';
import { el, svg, toast, actionSheet, getFflate, deliver, localDate, niceDate, money0, int, dec } from './kit.js';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLSM_TYPE = 'application/vnd.ms-excel.sheet.macroEnabled.12';
const xmlApi = () => ({ DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer });
let api = null;
let host = null;   // { getDeal(), ctxFor(deal) }

const btn = (cls, text, fn) => { const b = el('button', `btn ${cls}`, text); b.type = 'button'; b.addEventListener('click', fn); return b; };

/** Open the library. `opts.getDeal()` is the open deal or null; `opts.ctxFor(deal)` gives field values. */
export async function openLibrary(compsApi, opts) {
  api = compsApi;
  host = opts;
  const deal = host.getDeal();
  const up = btn('btn-primary', 'Upload a template', () => upload());
  const body = api.sheetOpen({ eyebrow: 'Excel', title: 'Template library', sub: 'Your firm’s workbooks, mapped once and filled for any deal. Kept on this device.', foot: [up] });
  const list = await listTemplates();
  body.textContent = '';
  const live = list.filter((t) => !t.archived);
  const archived = list.filter((t) => t.archived);
  if (!list.length) {
    body.appendChild(el('p', 'hint', 'No templates yet. Upload the .xlsx your firm uses for underwriting, a rent roll or an IC report. Zlatura finds the labelled input cells and any rent roll table, and you check the mapping once.'));
  }
  const draw = (items, title) => {
    if (!items.length) return;
    if (title) body.appendChild(el('h3', null, title));
    const ul = el('div', 'list');
    ul.style.cssText = 'background:var(--surface-2);border-radius:13px';
    for (const t of items) {
      const row = el('div', 'li');
      const main = el('div', 'li-main');
      main.appendChild(el('div', 'li-title', t.name));
      const cells = (t.mapping.cells || []).length;
      const tables = (t.mapping.tables || []).filter((x) => x.use !== false).length;
      main.appendChild(el('div', 'li-sub', [t.category, `${cells} cell${cells === 1 ? '' : 's'}${tables ? ` · ${tables} table${tables === 1 ? '' : 's'}` : ''}`, `v${(t.current ?? 0) + 1} · ${currentFile(t)}`, niceDate(t.updatedAt)].join(' · ')));
      row.appendChild(main);
      if (deal && !t.archived) row.appendChild(btn('btn-sm btn-primary', 'Fill', () => fillSheet(t, deal)));
      const more = el('button', 'iconbtn');
      more.type = 'button';
      more.innerHTML = svg('<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>', 16);
      more.setAttribute('aria-label', `More for ${t.name}`);
      more.addEventListener('click', () => templateMenu(t));
      row.appendChild(more);
      ul.appendChild(row);
    }
    body.appendChild(ul);
  };
  draw(live, null);
  draw(archived, 'Archived');
  const imp = btn('btn-plain btn-sm', 'Import a template a colleague sent…', () => importPackage());
  imp.style.justifySelf = 'start';
  body.appendChild(imp);
  if (!deal) body.appendChild(el('p', 'hint-sm', 'Open a deal on the Deal tab to fill a template with it.'));
}

const reopen = () => openLibrary(api, host);

async function templateMenu(t) {
  const deal = host.getDeal();
  const v = await actionSheet(t.name, [
    ...(deal && !t.archived ? [{ label: 'Fill with this deal…', value: 'fill' }] : []),
    { label: 'Map cells and tables', value: 'map' },
    { label: 'Rename, category, description', value: 'edit' },
    { label: 'Replace the file (new version)…', value: 'replace' },
    ...(t.versions.length > 1 ? [{ label: `Versions (${t.versions.length})`, value: 'versions' }] : []),
    { label: 'Duplicate', value: 'dup' },
    { label: 'Download the blank template', value: 'download' },
    { label: 'Export for a colleague', sub: 'the workbook and its mapping, in one file', value: 'export' },
    '-',
    { label: t.archived ? 'Restore from archive' : 'Archive', value: 'archive' },
    { label: 'Delete', value: 'delete', danger: true },
  ]);
  if (v === 'fill') fillSheet(t, deal);
  else if (v === 'map') mapSheet(t);
  else if (v === 'edit') editSheet(t);
  else if (v === 'replace') upload(t);
  else if (v === 'versions') versionsSheet(t);
  else if (v === 'dup') { await putTemplate(duplicateTemplate(t)); toast('Duplicated.'); reopen(); }
  else if (v === 'download') deliver(currentFile(t), currentBytes(t), /\.xlsm$/i.test(currentFile(t)) ? XLSM_TYPE : XLSX_TYPE, { map: 'none: the firm’s template as uploaded, unfilled' }).catch(() => {});
  else if (v === 'export') {
    await deliver(`${t.name.replace(/[^\w\s-]+/g, ' ').trim()}.template.json`, new TextEncoder().encode(exportPackage(t)), 'application/json', { map: 'none: a template and its mapping, for a colleague' });
    toast('Exported. On the other device: Template library → Import a template a colleague sent.');
  } else if (v === 'archive') { t.archived = !t.archived; await putTemplate(t); reopen(); } else if (v === 'delete') {
    await deleteTemplate(t.id);
    toast(`${t.name} deleted.`, { label: 'Undo', run: async () => { await putTemplate(t); reopen(); } });
    reopen();
  }
}

/* ----------------------------------------------------------------- upload */

function pickFile(accept) {
  return new Promise((resolve) => {
    const i = el('input');
    i.type = 'file';
    i.accept = accept;
    i.addEventListener('change', () => resolve(i.files[0] || null));
    i.click();
  });
}

/** Read a workbook and find what it takes: cells beside labels, and a rent roll table if it has one. */
async function readWorkbook(file) {
  if (/\.xls$/i.test(file.name)) throw new Error('That is an old .xls workbook. Open it in Excel and save it as .xlsx (or .xlsm if it has macros), then upload that.');
  if (/\.xlsb$/i.test(file.name)) throw new Error('That is a binary .xlsb workbook. Save it as .xlsx in Excel, then upload that.');
  if (!/\.xls[xm]$/i.test(file.name)) throw new Error('Choose an Excel workbook (.xlsx, or .xlsm with macros).');
  if (!file.size) throw new Error('That file is empty.');
  const fflate = await getFflate();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const info = inspectWorkbook(fflate, bytes, xmlApi());
  return { bytes, info };
}

export function suggestMapping(info) {
  const cells = suggestCellMap(info, DEAL_FIELDS).map((s) => ({ sheet: s.sheet, cell: s.cell, field: s.field, confidence: s.confidence, why: s.why }));
  const tables = [];
  for (const s of info.sheets) {
    if (s.hidden) continue;
    const byRow = new Map();
    for (const c of s.cells) {
      if (c.formula || c.row > 40) continue;
      const f = rrFieldForHeader(c.text);
      if (!f) continue;
      (byRow.get(c.row) || byRow.set(c.row, []).get(c.row)).push({ col: c.col, header: c.text.trim(), field: f });
    }
    let best = null;
    for (const [row, cols] of byRow) if (cols.length >= 3 && (!best || cols.length > best.cols.length)) best = { row, cols };
    if (best) {
      const seen = new Set();
      const columns = best.cols.sort((a, b) => a.col - b.col).map((c) => ({ ...c, field: seen.has(c.field) ? null : (seen.add(c.field), c.field) }));
      tables.push({ sheet: s.name, headerRow: best.row, kind: 'rentroll', columns, use: true });
    }
  }
  return { cells, tables };
}

async function upload(existing = null) {
  const file = await pickFile('.xlsx,.xlsm,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  if (!file) return;
  let read;
  try { read = await readWorkbook(file); } catch (err) { toast(err.message || String(err), null, 9000); return; }
  if (existing) {
    addVersion(existing, { bytes: read.bytes, fileName: file.name, info: read.info });
    await putTemplate(existing);
    toast(`New version of ${existing.name}. The mapping is kept; check it, because cells may have moved.`);
    mapSheet(existing);
    return;
  }
  const t = newTemplate({ name: file.name.replace(/\.xls[xm]$/i, ''), bytes: read.bytes, fileName: file.name, info: read.info, mapping: suggestMapping(read.info),
    category: /rent ?roll/i.test(file.name) ? 'Rent roll' : /comp/i.test(file.name) ? 'Comps' : /\bic\b|committee|memo/i.test(file.name) ? 'IC report' : 'Underwriting' });
  try { await putTemplate(t); } catch (err) { toast(err.message, null, 8000); return; }
  mapSheet(t, { first: true });
}

async function importPackage() {
  const file = await pickFile('.json,application/json');
  if (!file) return;
  try {
    const p = readPackage(await file.text());
    const fflate = await getFflate();
    const info = inspectWorkbook(fflate, p.bytes, xmlApi());
    const t = newTemplate({ name: p.name, bytes: p.bytes, fileName: p.fileName, info, mapping: p.mapping, category: p.category });
    t.description = p.description;
    await putTemplate(t);
    toast(`Imported ${t.name}, with its mapping.`);
    reopen();
  } catch (err) { toast(err.message || String(err), null, 8000); }
}

/* ---------------------------------------------------------------- mapping */

const FIELD_GROUPS = [...new Set(DEAL_FIELDS.map((f) => f.group))];

async function mapSheet(t, { first = false } = {}) {
  const fflate = await getFflate();
  let info;
  try { info = inspectWorkbook(fflate, currentBytes(t), xmlApi()); } catch (err) { toast(err.message || String(err)); return; }
  const done = btn('btn-primary', 'Save mapping', async () => { await putTemplate(t); toast('Mapping saved. It is used every time you fill this template.'); api.sheetClose(); });
  const body = api.sheetOpen({ eyebrow: t.name, title: 'Map the deal into the workbook', sub: first ? 'Suggested from the labels and named ranges in the file. Check each one; tap any cell to change it.' : 'Tap a cell to choose what goes in it.', foot: [done] });
  let sheetName = (t.mapping.cells[0] && t.mapping.cells[0].sheet) || (info.sheets.find((s) => !s.hidden) || info.sheets[0]).name;

  const draw = () => {
    const keep = body.scrollTop;
    body.textContent = '';
    for (const w of info.warnings) { const p = el('p', w.level === 'warn' ? 'hint-sm warn-text' : 'hint-sm', w.text); body.appendChild(p); }
    // the mappings as a list, with their confidence
    const list = el('div');
    list.appendChild(el('h3', null, `Cells (${t.mapping.cells.length})`));
    if (!t.mapping.cells.length) list.appendChild(el('p', 'hint-sm', 'No cells mapped yet. Tap a cell in the sheet below.'));
    for (const m of t.mapping.cells) {
      const r = el('div', 'map-row');
      const h = el('div', 'h', DEAL_FIELD[m.field] ? DEAL_FIELD[m.field].label : m.field);
      h.appendChild(el('small', null, `${m.sheet}!${m.cell}${m.why ? ` · ${m.why}` : ''}`));
      r.appendChild(h);
      if (m.confidence) r.appendChild(el('span', `chip ${m.confidence === 'high' ? 'chip-good' : m.confidence === 'medium' ? 'chip-accent' : 'chip-warn'}`, m.confidence === 'high' ? 'sure' : m.confidence === 'medium' ? 'likely' : 'check'));
      const x = el('button', 'iconbtn');
      x.type = 'button';
      x.innerHTML = svg('<path d="M6 6l12 12M18 6L6 18"/>', 14);
      x.setAttribute('aria-label', `Unmap ${m.sheet}!${m.cell}`);
      x.addEventListener('click', () => { t.mapping.cells = t.mapping.cells.filter((y) => y !== m); draw(); });
      r.appendChild(x);
      list.appendChild(r);
    }
    body.appendChild(list);

    // rent roll tables
    if (t.mapping.tables && t.mapping.tables.length) {
      body.appendChild(el('h3', null, 'Rent roll table'));
      for (const tb of t.mapping.tables) {
        const box = el('div');
        const use = el('label', 'chk');
        const cb = el('input'); cb.type = 'checkbox'; cb.checked = tb.use !== false;
        cb.addEventListener('change', () => { tb.use = cb.checked; });
        use.append(cb, document.createTextNode(` Fill the rent roll under the headings on ${tb.sheet}, row ${tb.headerRow}`));
        box.appendChild(use);
        for (const c of tb.columns) {
          const r = el('div', 'map-row');
          const h = el('div', 'h', c.header);
          h.appendChild(el('small', null, `Column ${String.fromCharCode(64 + c.col)}`));
          r.appendChild(h);
          const sel = el('select', 'compact');
          sel.setAttribute('aria-label', `Rent roll field for ${c.header}`);
          for (const [v, l] of [['', '— leave alone —'], ...RR_TABLE_FIELDS.map((f) => [f.key, f.label])]) { const o = el('option', null, l); o.value = v; sel.appendChild(o); }
          sel.value = c.field || '';
          sel.addEventListener('change', () => { c.field = sel.value || null; });
          r.appendChild(sel);
          box.appendChild(r);
        }
        body.appendChild(box);
      }
    }

    // the sheet itself
    body.appendChild(el('h3', null, 'The workbook'));
    const tabs = el('div', 'chips');
    for (const s of info.sheets) {
      const b = btn(`btn-sm ${s.name === sheetName ? 'btn-primary' : 'btn-gray'}`, `${s.name}${s.hidden ? ' (hidden)' : ''}`, () => { sheetName = s.name; draw(); });
      b.setAttribute('aria-pressed', String(s.name === sheetName));
      tabs.appendChild(b);
    }
    body.appendChild(tabs);
    body.appendChild(sheetGrid(info.sheets.find((s) => s.name === sheetName), t, draw));
    const again = btn('btn-plain btn-sm', 'Suggest again from the labels', () => {
      const sug = suggestMapping(info);
      const have = new Set(t.mapping.cells.map((m) => m.field));
      const add = sug.cells.filter((m) => !have.has(m.field));
      t.mapping.cells.push(...add);
      if (!t.mapping.tables || !t.mapping.tables.length) t.mapping.tables = sug.tables;
      draw();
      toast(add.length ? `${add.length} more suggested.` : 'Nothing new to suggest.');
    });
    again.style.justifySelf = 'start';
    body.appendChild(again);
    body.scrollTop = keep;
  };
  draw();
}

/** The sheet as a small spreadsheet: mapped cells marked, formulas in grey, tap to map. */
function sheetGrid(s, t, redraw) {
  const wrap = el('div', 'scroll tpl-grid-wrap');
  const tbl = el('table', 'tpl-grid');
  tbl.setAttribute('aria-label', `${s.name}: tap a cell to map it`);
  const maxRow = Math.max(12, Math.min(80, s.maxRow + 2));
  const maxCol = Math.max(6, Math.min(20, s.maxCol + 1));
  const at = new Map(s.cells.map((c) => [c.ref, c]));
  const mapped = new Map(t.mapping.cells.filter((m) => m.sheet === s.name).map((m) => [m.cell, m]));
  const letter = (n) => { let x = ''; for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) x = String.fromCharCode(65 + ((k - 1) % 26)) + x; return x; };
  const head = el('tr');
  head.appendChild(el('th', null, ''));
  for (let c = 1; c <= maxCol; c++) head.appendChild(el('th', null, letter(c)));
  tbl.appendChild(head);
  for (let r = 1; r <= maxRow; r++) {
    const tr = el('tr');
    tr.appendChild(el('th', null, String(r)));
    for (let c = 1; c <= maxCol; c++) {
      const ref = `${letter(c)}${r}`;
      const cell = at.get(ref);
      const m = mapped.get(ref);
      const td = el('td');
      const b = el('button', `tpl-cell${cell && cell.formula ? ' f' : ''}${m ? ' mapped' : ''}`);
      b.type = 'button';
      const shown = m ? (DEAL_FIELD[m.field] ? DEAL_FIELD[m.field].label : m.field) : cell ? (cell.text || (cell.formula ? 'ƒ' : '')) : '';
      b.textContent = shown.length > 18 ? `${shown.slice(0, 17)}…` : shown;
      b.title = `${ref}${cell && cell.formula ? `: =${cell.formula}` : cell && cell.text ? `: ${cell.text}` : ''}`;
      b.setAttribute('aria-label', `${ref}${m ? `, mapped to ${shown}` : cell && cell.formula ? ', formula' : cell && cell.text ? `, ${cell.text}` : ', empty'}`);
      b.addEventListener('click', async () => {
        if (cell && cell.formula && !m) { toast(`${ref} holds a formula (=${cell.formula}). Formulas are never overwritten; map the input cell it reads instead.`, null, 7000); return; }
        const items = [];
        if (m) items.push({ label: 'Leave this cell alone', value: '__none', danger: true }, '-');
        for (const g of FIELD_GROUPS) {
          for (const F of DEAL_FIELDS.filter((f) => f.group === g)) items.push({ label: F.label, sub: g, value: F.key });
        }
        const v = await actionSheet(`${s.name}!${ref}${cell && cell.text ? ` · now “${cell.text}”` : ''}`, items);
        if (!v) return;
        t.mapping.cells = t.mapping.cells.filter((x) => !(x.sheet === s.name && x.cell === ref) && (v === '__none' || x.field !== v));
        if (v !== '__none') t.mapping.cells.push({ sheet: s.name, cell: ref, field: v, confidence: null, why: 'chosen by hand' });
        redraw();
      });
      td.appendChild(b);
      tr.appendChild(td);
    }
    tbl.appendChild(tr);
  }
  wrap.appendChild(tbl);
  return wrap;
}

/* ----------------------------------------------------------------- editing */

function editSheet(t) {
  const save = btn('btn-primary', 'Save', async () => {
    t.name = name.value.trim() || t.name;
    t.category = cat.value;
    t.description = desc.value.trim();
    await putTemplate(t);
    reopen();
  });
  const body = api.sheetOpen({ eyebrow: 'Template', title: t.name, sub: '', foot: [save] });
  const f = (label, node) => { const d = el('div', 'field'); const l = el('label', null, label); d.append(l, node); body.appendChild(d); return node; };
  const name = f('Name', el('input', 'input')); name.value = t.name;
  const cat = f('Category', el('select'));
  for (const c of CATEGORIES) { const o = el('option', null, c); o.value = c; cat.appendChild(o); }
  cat.value = t.category;
  const desc = f('Description', el('textarea')); desc.rows = 3; desc.value = t.description || '';
}

function versionsSheet(t) {
  const body = api.sheetOpen({ eyebrow: t.name, title: 'Versions', sub: 'Each file you uploaded for this template. The mapping is shared by all of them.' });
  const ul = el('div', 'list');
  t.versions.forEach((v, i) => {
    const row = el('div', 'li');
    const main = el('div', 'li-main');
    main.appendChild(el('div', 'li-title', `v${i + 1}${i === (t.current ?? 0) ? ' · in use' : ''} · ${v.fileName}`));
    main.appendChild(el('div', 'li-sub', `${niceDate(v.at)} · ${int(v.size / 1024)} KB · ${v.note || ''}`));
    row.appendChild(main);
    if (i !== (t.current ?? 0)) row.appendChild(btn('btn-sm', 'Use this one', async () => { t.current = i; await putTemplate(t); toast(`v${i + 1} restored.`); versionsSheet(t); }));
    ul.appendChild(row);
  });
  body.appendChild(ul);
}

/* -------------------------------------------------------------------- fill */

/** The rent roll's rows in the shape a template table takes. */
function rentRollRows(deal) {
  const rr = deal.rr;
  if (!rr || !rr.leases.length) return [];
  const c = gridContext(rr);
  const typeOf = Object.fromEntries(RR_TABLE_FIELDS.map((f) => [f.key, f.type]));
  return rr.leases.map((L) => {
    const row = {};
    for (const f of RR_TABLE_FIELDS) {
      const def = COLUMNS[f.key];
      let v = def ? def.get(L, c) : null;
      if (f.type === 'date' && v) v = new Date(`${v}T00:00:00Z`);
      if (f.key === 'tenant' && L.vacant) v = 'Vacant';
      row[f.key] = { value: v === '' ? null : v, type: typeOf[f.key] };
    }
    return row;
  });
}

async function fillSheet(t, deal) {
  const fflate = await getFflate();
  const values = dealValues(host.ctxFor(deal));
  for (const m of t.mapping.cells) if (values[m.field]) values[m.field].label = DEAL_FIELD[m.field] ? DEAL_FIELD[m.field].label : m.field;
  let preview;
  try { preview = previewCells(fflate, currentBytes(t), t.mapping.cells, values, xmlApi()); } catch (err) { toast(err.message || String(err)); return; }
  const rows = rentRollRows(deal);
  const tables = (t.mapping.tables || []).filter((x) => x.use !== false && x.columns.some((c) => c.field));
  const audit = el('input'); audit.type = 'checkbox'; audit.checked = true;
  const go = btn('btn-primary', 'Fill and download', async () => {
    try {
      const { bytes, report } = fillCells(fflate, currentBytes(t), {
        cellMap: t.mapping.cells.map((m) => ({ ...m, label: DEAL_FIELD[m.field] ? DEAL_FIELD[m.field].label : m.field })), values,
        tables: tables.map((x) => ({ sheet: x.sheet, headerRow: x.headerRow, columns: x.columns, rows, source: `rent roll as of ${deal.rr ? deal.rr.settings.asOf : ''}` })),
        audit: audit.checked, auditTitle: deal.name || deal.figures.address || '',
      }, xmlApi());
      const ext = /\.xlsm$/i.test(currentFile(t)) ? 'xlsm' : 'xlsx';
      const name = `${t.name} - ${(deal.name || deal.figures.address || 'Deal').replace(/[^\w\s-]+/g, ' ').replace(/\s+/g, ' ').trim()} (${localDate()}).${ext}`;
      const done = await deliver(name, bytes, ext === 'xlsm' ? XLSM_TYPE : XLSX_TYPE, { map: 'template-fill' });
      if (done === 'done') toast(`${report.written} cell${report.written === 1 ? '' : 's'} filled${report.tables.length ? `, ${report.tables.map((x) => `${x.rows} rent roll rows on ${x.sheet}`).join(', ')}` : ''}. Formulas recalculate when Excel opens the file.`, null, 8000);
      api.sheetClose();
    } catch (err) { toast(`The workbook could not be filled: ${err.message || err}`, null, 8000); }
  });
  const body = api.sheetOpen({ eyebrow: t.name, title: 'Check before filling', sub: `${deal.name || deal.figures.address || 'This deal'} into ${currentFile(t)}. Nothing is written until you tap Fill.`, foot: [go] });
  for (const w of t.warnings || []) body.appendChild(el('p', w.level === 'warn' ? 'hint-sm warn-text' : 'hint-sm', w.text));
  const writes = preview.filter((p) => p.action === 'write');
  const skips = preview.filter((p) => p.action !== 'write');
  body.appendChild(el('h3', null, `Will write ${writes.length} cell${writes.length === 1 ? '' : 's'}`));
  const tbl = el('table', 'mini tpl-preview');
  const h = el('tr');
  for (const x of ['Cell', 'Field', 'Now', 'Will be', 'Source', 'Read by']) h.appendChild(el('th', null, x));
  tbl.appendChild(h);
  const fmt = (p) => {
    const v = p.next;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'number') return p.type === 'pct' ? `${dec(v, 2)}%` : p.type === 'money' || p.type === 'money2' ? money0(v) : String(Math.round(v * 100) / 100);
    return v === null || v === undefined ? '' : String(v);
  };
  for (const p of writes) {
    const tr = el('tr');
    tr.appendChild(el('td', null, `${p.sheet}!${p.cell}`));
    tr.appendChild(el('td', null, DEAL_FIELD[p.field] ? DEAL_FIELD[p.field].label : p.field));
    tr.appendChild(el('td', 'muted', p.current || '(empty)'));
    tr.appendChild(el('td', 'strong', fmt(p)));
    tr.appendChild(el('td', 'muted', p.source || ''));
    tr.appendChild(el('td', null, p.feeds ? `${p.feeds} formula${p.feeds === 1 ? '' : 's'}${p.names.length ? `, ${p.names.join(', ')}` : ''}` : p.names.length ? p.names.join(', ') : '—'));
    tbl.appendChild(tr);
  }
  const w = el('div', 'scroll'); w.appendChild(tbl); body.appendChild(w);
  if (skips.length) {
    body.appendChild(el('h3', null, `Left alone (${skips.length})`));
    const ul = el('ul', 'checks');
    for (const p of skips) { const li = el('li', 'info'); li.appendChild(el('span', null, `${p.sheet}!${p.cell} (${DEAL_FIELD[p.field] ? DEAL_FIELD[p.field].label : p.field}): ${p.reason}`)); ul.appendChild(li); }
    body.appendChild(ul);
  }
  if (tables.length) {
    body.appendChild(el('h3', null, 'Rent roll'));
    body.appendChild(el('p', 'hint-sm', rows.length
      ? `${rows.length} unit${rows.length === 1 ? '' : 's'} go under the headings on ${tables.map((x) => `${x.sheet} (row ${x.headerRow})`).join(' and ')}. Old values under those headings are cleared; formula columns are kept.`
      : 'This deal has no rent roll yet, so the rent roll table is left as it is.'));
  }
  const a = el('label', 'chk');
  a.append(audit, document.createTextNode(' Add a “Zlatura Audit” sheet listing every cell written and its source'));
  body.appendChild(a);
  body.appendChild(el('p', 'hint-sm', 'Formulas are not calculated here: Excel works them out when it opens the file. Cells that hold formulas, and the inside of merged cells, are never written.'));
}
