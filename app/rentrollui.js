/* rentrollui.js -- the rent roll workspace on the Deal screen.
 *
 * A grid a broker can shape (columns added, hidden, renamed, reordered,
 * resized, saved as layouts), edited by keyboard like a spreadsheet; a lease
 * schedule for each tenant as dated periods on a timeline; and what follows
 * from them: in-place rent, expirations, concentration, and the projection
 * through NOI. Every change goes through `onChange`, which saves the deal. */

import { waltMethod } from './engine/walt.js';
import {
  project, rentRollSummary, validateRentRoll, validateLease, generateSteps, monthlyAmount, inPlace, rollover,
  dayOf, isoOf, addDays, addMonths, UNITS, DEFAULT_SETTINGS,
} from './lease.js';
import {
  COLUMNS, PRESETS, MARKET_UNIT, layoutFromPreset, visibleColumns, customColumn, newLease, duplicateLease,
  gridContext, viewRows,
} from './rentroll.js';
import { kvGet, kvSet } from './store.js';
import { projectionNow, projectionLater } from './projector.js';
import { LEASE_FIELDS } from './impact.js';
import { affectsButton } from './impactui.js';
import {
  el, svg, parseNum, parsePct, int, dec, money0, money2, pct, short, yrs, toast, actionSheet, getXlsx, deliver, XLSX,
} from './kit.js';

const ok = (x) => typeof x === 'number' && Number.isFinite(x);
const pos = (x) => ok(x) && x > 0;

let api = null;
let state = { query: '', status: 'all', sort: null, dir: 1 };

/* ------------------------------------------------------------- formatting */

function show(kind, v) {
  if (v === null || v === undefined || v === '') return '';
  if (kind === 'money') return ok(v) ? money0(v) : String(v);
  if (kind === 'money2') return ok(v) ? money2(v) : String(v);
  if (kind === 'int') return ok(v) ? int(v) : String(v);
  if (kind === 'pct') return ok(v) ? `${dec(v, 2)}%` : String(v);
  if (kind === 'dec') return ok(v) ? dec(v, 1) : String(v);
  return String(v);
}
function read(kind, raw) {
  if (kind === 'text' || kind === 'select') return String(raw).trim();
  if (kind === 'date') return raw && dayOf(raw) !== null ? raw : null;
  if (kind === 'pct') return parsePct(raw, { fraction: false });
  const v = parseNum(raw);
  return v === null ? null : v;
}

/* ------------------------------------------------------------------ main */

/* Row windowing: rent rolls longer than this draw only the rows near the screen. */
const WINDOW_FROM = 100;
const WINDOW_FIRST = 60; // rows drawn before the first scroll check
const WINDOW_MARGIN = 20; // rows kept beyond each edge of the screen
const WINDOW_STEP = 20; // the drawn range moves in steps of this many rows
const ROW_H = 41; // a row's height in px until one is measured

/**
 * Draw the workspace into `box` for `deal`. `onChange()` is called after any
 * edit (it saves and refreshes the deal analysis); `rr` lives on deal.rr.
 */
export function renderRentRollWorkspace(box, deal, compsApi, onChange, hooks = {}) {
  api = compsApi;
  box.textContent = '';
  const rr = deal.rr;
  const changed = (redraw = true, meta = null) => { onChange(meta); if (redraw) refresh(); };
  // an automatic snapshot of the deal before a bulk change (the deal's history keeps it); its id, or null
  changed.snapshot = (reason) => (hooks.snapshot ? hooks.snapshot(reason) : null);
  // "what this affects" (the dependency map), opened by the deal screen
  changed.affects = (ids, opts) => (hooks.affects ? hooks.affects(ids, opts) : null);

  const head = el('div', 'card-head');
  head.appendChild(el('h2', null, 'Rent roll'));
  const sub = el('span', 'count');
  head.appendChild(sub);
  box.appendChild(head);

  const tiles = el('div', 'tiles');
  box.appendChild(tiles);

  // toolbar
  const bar = el('div', 'rr-bar');
  const search = el('input', 'input');
  search.type = 'search';
  search.placeholder = 'Search units, tenants, notes';
  search.setAttribute('aria-label', 'Search the rent roll');
  search.value = state.query;
  let t = null;
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { state.query = search.value; drawGrid(); }, 120); });
  const filter = el('select', 'compact');
  filter.setAttribute('aria-label', 'Show');
  for (const [v, l] of [['all', 'All units'], ['occupied', 'Occupied'], ['vacant', 'Vacant'], ['expiring', 'Expiring in 24 months']]) {
    const o = el('option', null, l); o.value = v; filter.appendChild(o);
  }
  filter.value = state.status;
  filter.addEventListener('change', () => { state.status = filter.value; drawGrid(); });
  const add = btn('btn-sm', '+ Unit', () => {
    const L = newLease(rr, { leaseStart: rr.settings.asOf, leaseEnd: addDays(addMonths(rr.settings.asOf, 60), -1) });
    rr.leases.push(L);
    changed();
    if (!box.querySelector(`tr[data-id="${L.id}"]`)) grid.revealId(L.id);
    const first = box.querySelector(`tr[data-id="${L.id}"] input`);
    if (first) first.focus();
  });
  const cols = btn('btn-sm btn-gray', 'Columns', () => columnsSheet(rr, () => changed()));
  const more = btn('btn-sm btn-gray', 'More', () => moreMenu(deal, rr, changed));
  more.setAttribute('aria-label', 'More rent roll actions');
  bar.append(search, filter, add, cols, more);
  box.appendChild(bar);

  const issues = el('div', 'rr-issues');
  box.appendChild(issues);

  const gridWrap = el('div', 'rr-wrap');
  box.appendChild(gridWrap);

  const outputs = el('div', 'rr-out');
  box.appendChild(outputs);

  /** @type {{ n: number, reveal: (i?: number) => void, revealId?: (id: string) => void }} */
  let grid = { n: 0, reveal: () => {}, revealId: () => {} };
  let gridStop = null;

  function refresh() {
    const sum = rentRollSummary(rr, rr.settings.asOf);
    sub.textContent = `${sum.units} unit${sum.units === 1 ? '' : 's'} · as of ${rr.settings.asOf}`;
    tiles.textContent = '';
    const tile = (k, v, s, cls) => { const x = el('div', `tile${cls ? ` ${cls}` : ''}`); x.appendChild(el('div', 'k', k)); x.appendChild(el('div', 'v', v)); if (s) x.appendChild(el('div', 's', s)); tiles.appendChild(x); };
    tile('In-place rent', sum.annualRent ? short(sum.annualRent) : '—', sum.annualRent ? `${money0(sum.monthlyRent)} a month` : 'add rents to the units');
    tile('Occupancy', pct(sum.occupancy, 1), sum.totalSf ? `${int(sum.leasedSf)} of ${int(sum.totalSf)} SF` : 'needs SF', ok(sum.occupancy) && sum.occupancy < 85 ? 'warn' : '');
    // the headline WALT is the one Settings picks; the other basis is shown beside it
    const other = sum.waltWeight === 'sf' ? (ok(sum.waltIncome) ? ` · ${yrs(sum.waltIncome)} by income` : '') : (ok(sum.waltSf) ? ` · ${yrs(sum.waltSf)} by area` : '');
    tile('WALT', yrs(sum.walt), `${waltMethod()}${other}`);
    tile('Loss to lease', ok(sum.lossToLease) ? short(sum.lossToLease) : '—', ok(sum.lossToLeasePct) ? `${pct(sum.lossToLeasePct, 1)} below market` : 'set market rents');
    if (sum.top) tile('Largest tenant', pct(sum.top.share, 1), `${sum.top.tenant || sum.top.unit} of rent`, sum.top.share > 40 ? 'warn' : '');
    drawIssues();
    drawGrid();
    drawOutputs(outputs, deal, rr, changed);
  }

  function drawIssues() {
    const list = validateRentRoll(rr);
    issues.textContent = '';
    if (!list.length) return;
    const d = el('details', 'rr-issue-box');
    const errs = list.filter((x) => x.level === 'error').length;
    d.appendChild(el('summary', null, `${list.length} thing${list.length === 1 ? '' : 's'} to check${errs ? ` · ${errs} error${errs === 1 ? '' : 's'}` : ''}`));
    const ul = el('ul', 'checks');
    for (const x of list.slice(0, 50)) {
      const li = el('li', x.level === 'error' ? 'error' : 'warn');
      li.appendChild(el('span', null, `${x.unit ? `Unit ${x.unit}${x.tenant ? ` (${x.tenant})` : ''}: ` : ''}${x.text}`));
      if (x.lease) {
        const b = btn('btn-plain btn-sm', 'Open', () => { const L = rr.leases.find((y) => y.id === x.lease); if (L) scheduleSheet(rr, L, changed); });
        li.appendChild(b);
      }
      ul.appendChild(li);
    }
    d.appendChild(ul);
    if (errs) d.open = true;
    issues.appendChild(d);
  }

  function drawGrid() {
    gridWrap.textContent = '';
    const c = gridContext(rr);
    const colsV = visibleColumns(rr.columns);
    const rows = viewRows(rr, state);
    const tbl = el('table', 'rr-grid');
    tbl.setAttribute('role', 'grid');
    tbl.setAttribute('aria-label', 'Rent roll. Arrow keys move between cells; Enter saves and moves down; Escape undoes the cell.');
    const thead = el('thead');
    const htr = el('tr');
    for (const col of colsV) {
      const th = el('th');
      th.style.minWidth = `${col.width || 100}px`;
      const b = el('button', 'rr-sort', col.label);
      b.type = 'button';
      const sorted = state.sort === col.key;
      th.setAttribute('aria-sort', sorted ? (state.dir > 0 ? 'ascending' : 'descending') : 'none');
      if (sorted) b.appendChild(el('span', 'rr-dir', state.dir > 0 ? ' ▲' : ' ▼'));
      b.addEventListener('click', () => { if (state.sort === col.key) state.dir = -state.dir; else { state.sort = col.key; state.dir = 1; } drawGrid(); });
      th.appendChild(b);
      if (!col.set) th.title = 'Worked out from the lease schedule';
      htr.appendChild(th);
    }
    htr.appendChild(el('th', 'rr-act', ''));
    thead.appendChild(htr);
    tbl.appendChild(thead);
    const tbody = el('tbody');
    const makeRow = (L, ri) => {
      const tr = el('tr', L.vacant ? 'vacant' : null);
      tr.dataset.id = L.id;
      tr.setAttribute('aria-rowindex', String(ri + 2));
      colsV.forEach((col, ci) => {
        const td = el('td', col.set ? null : 'calc');
        const v = col.get(L, c);
        if (!col.set) {
          td.textContent = show(col.kind, v) || '—';
          td.tabIndex = -1;
          td.dataset.r = ri; td.dataset.c = ci;
          td.addEventListener('keydown', (e) => nav(e, td));
        } else if (col.kind === 'select') {
          const s = el('select');
          for (const o of col.options) { const op = el('option', null, o); op.value = o; s.appendChild(op); }
          s.value = v || col.options[0];
          s.setAttribute('aria-label', `${col.label}, unit ${L.unit || ri + 1}`);
          s.dataset.r = ri; s.dataset.c = ci;
          s.addEventListener('change', () => { col.set(L, s.value, c); changed(); });
          s.addEventListener('keydown', (e) => nav(e, s));
          td.appendChild(s);
        } else {
          const i = el('input', ['money', 'money2', 'int', 'pct', 'dec'].includes(col.kind) ? 'n' : null);
          if (col.kind === 'date') i.type = 'date';
          else if (col.kind !== 'text') i.inputMode = 'decimal';
          i.value = col.kind === 'date' ? (v || '') : show(col.kind, v);
          i.dataset.orig = i.value;
          i.dataset.r = ri; i.dataset.c = ci;
          i.setAttribute('aria-label', `${col.label}, unit ${L.unit || ri + 1}`);
          i.autocomplete = 'off';
          i.addEventListener('change', () => {
            const nv = read(col.kind, i.value);
            if ((col.kind !== 'text' && col.kind !== 'date') && i.value.trim() && nv === null) { toast(`“${i.value}” isn’t a number.`); i.value = i.dataset.orig; return; }
            col.set(L, nv, c);
            changed(false);
            const again = col.get(L, gridContext(rr));
            i.value = col.kind === 'date' ? (again || '') : show(col.kind, again);
            i.dataset.orig = i.value;
            // the rest of the row may follow (rent per SF from rent, and so on)
            refreshRow(tr, L);
            refreshTotals();
          });
          i.addEventListener('keydown', (e) => nav(e, i));
          td.appendChild(i);
        }
        tr.appendChild(td);
      });
      const act = el('td', 'rr-act');
      const sched = el('button', 'iconbtn');
      sched.type = 'button';
      sched.innerHTML = svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M7 14h4M7 17h7"/>', 16);
      sched.setAttribute('aria-label', `Lease schedule: unit ${L.unit || ri + 1}`);
      sched.title = 'Lease schedule';
      sched.addEventListener('click', () => scheduleSheet(rr, L, changed));
      const menu = el('button', 'iconbtn');
      menu.type = 'button';
      menu.innerHTML = svg('<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>', 16);
      menu.setAttribute('aria-label', `More for unit ${L.unit || ri + 1}`);
      menu.addEventListener('click', async () => {
        const v = await actionSheet(`Unit ${L.unit || ''} ${L.tenant ? `· ${L.tenant}` : ''}`, [
          { label: 'Lease schedule', value: 'sched' }, { label: 'What this lease affects', value: 'affects' }, { label: 'Duplicate', value: 'dup' },
          { label: L.vacant ? 'Mark occupied' : 'Mark vacant', value: 'vac' }, '-', { label: 'Delete unit', value: 'del', danger: true },
        ]);
        if (v === 'sched') scheduleSheet(rr, L, changed);
        else if (v === 'affects') changed.affects(LEASE_INPUTS, { leaseId: L.id, title: `Unit ${L.unit || ri + 1}${L.tenant && !L.vacant ? ` (${L.tenant})` : ''}` });
        else if (v === 'dup') { rr.leases.splice(rr.leases.indexOf(L) + 1, 0, duplicateLease(L)); changed(); }
        else if (v === 'vac') { L.vacant = !L.vacant; L.status = L.vacant ? 'Vacant' : 'Occupied'; changed(); }
        else if (v === 'del') {
          const at = rr.leases.indexOf(L);
          rr.leases.splice(at, 1);
          changed(true, { label: `Deleted unit ${L.unit || L.tenant || ''}`.trim() });
          toast(`Unit ${L.unit || ''} deleted.`, { label: 'Undo', run: () => { rr.leases.splice(at, 0, L); changed(); } });
        }
      });
      act.append(sched, menu);
      tr.appendChild(act);
      return tr;
    };
    // a long rent roll draws only the rows near the screen (spacer rows keep the
    // table its full height), and draws more as they scroll into view: a browser
    // styles, lays out and paints every row it holds, so 500 rows of inputs take
    // most of a second however fast the arithmetic is
    const n = rows.length;
    tbl.setAttribute('aria-rowcount', String(n + 2));
    if (gridStop) gridStop.abort();
    gridStop = null;
    grid = { n, reveal: () => {} };
    if (n <= WINDOW_FROM) {
      rows.forEach((L, ri) => tbody.appendChild(makeRow(L, ri)));
    } else {
      const stop = new AbortController();
      gridStop = stop;
      const pad = () => { const tr = el('tr', 'rr-pad'); tr.setAttribute('aria-hidden', 'true'); const td = el('td'); td.colSpan = colsV.length + 1; tr.appendChild(td); return tr; };
      const topPad = pad(); const bottomPad = pad();
      tbody.append(topPad, bottomPad);
      const drawn = new Map(); // row index -> tr
      let lo = 0; let hi = 0; let rowH = ROW_H;
      const place = (from, to) => {
        from = Math.max(0, from); to = Math.min(n, Math.max(from, to));
        if (from === lo && to === hi) return;
        // a cell being edited in a row about to go is saved first (a removed input fires no change)
        const a = document.activeElement;
        if (a && tbody.contains(a) && a.dataset.r !== undefined && (Number(a.dataset.r) < from || Number(a.dataset.r) >= to)) a.blur();
        for (const [i, tr] of drawn) if (i < from || i >= to) { tr.remove(); drawn.delete(i); }
        const keepFrom = Math.max(lo, from); const keepTo = Math.min(hi, to);
        const kept = keepFrom < keepTo;
        const make = (i) => { const tr = makeRow(rows[i], i); drawn.set(i, tr); return tr; };
        const before = document.createDocumentFragment();
        for (let i = from; i < (kept ? keepFrom : to); i++) before.appendChild(make(i));
        tbody.insertBefore(before, kept ? drawn.get(keepFrom) : bottomPad);
        if (kept) { const after = document.createDocumentFragment(); for (let i = keepTo; i < to; i++) after.appendChild(make(i)); tbody.insertBefore(after, bottomPad); }
        lo = from; hi = to;
        topPad.firstChild.style.height = `${lo * rowH}px`;
        bottomPad.firstChild.style.height = `${(n - hi) * rowH}px`;
      };
      // the rows that cover the screen, with a margin, in steps so small scrolls redraw nothing
      const around = (first, count) => [Math.floor((first - WINDOW_MARGIN) / WINDOW_STEP) * WINDOW_STEP, Math.ceil((first + count + WINDOW_MARGIN) / WINDOW_STEP) * WINDOW_STEP];
      const update = () => {
        if (!tbl.isConnected) { stop.abort(); return; }
        const box2 = tbody.getBoundingClientRect();
        if (!box2.height) return; // the tab is hidden
        const one = drawn.size ? drawn.values().next().value.getBoundingClientRect().height : 0;
        if (one && Math.abs(one - rowH) > 0.5) rowH = one;
        const first = Math.floor(Math.max(0, -box2.top) / rowH);
        place(...around(first, Math.ceil(window.innerHeight / rowH)));
      };
      let queued = false;
      const onScroll = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; update(); }); };
      window.addEventListener('scroll', onScroll, { capture: true, passive: true, signal: stop.signal });
      window.addEventListener('resize', onScroll, { passive: true, signal: stop.signal });
      place(0, WINDOW_FIRST);
      onScroll(); // the page may already be scrolled down
      grid = {
        n,
        // draw row `i` and bring it on screen (keyboard moves, a new unit)
        reveal: (i) => {
          if (i < 0 || i >= n) return;
          if (i < lo || i >= hi) place(...around(i, Math.ceil(window.innerHeight / rowH)));
          const tr = drawn.get(i);
          if (tr) tr.scrollIntoView({ block: 'nearest' });
        },
      };
    }
    grid.revealId = (id) => grid.reveal(rows.findIndex((L) => L.id === id));
    if (!rows.length) {
      const tr = el('tr');
      const td = el('td', 'no-match', rr.leases.length ? 'No units match.' : 'No units yet. Add one, or import a rent roll from Excel or CSV under More.');
      td.colSpan = colsV.length + 1;
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
    tbl.appendChild(tbody);
    tbl.appendChild(totalsRow(colsV, c));
    gridWrap.appendChild(tbl);

    function refreshRow(tr, L) {
      const cc = gridContext(rr);
      [...tr.children].forEach((td, ci) => {
        const col = colsV[ci];
        if (!col) return;
        const v = col.get(L, cc);
        const inp = td.querySelector('input');
        if (!col.set) td.textContent = show(col.kind, v) || '—';
        else if (inp && document.activeElement !== inp) { inp.value = col.kind === 'date' ? (v || '') : show(col.kind, v); inp.dataset.orig = inp.value; }
      });
    }
    function refreshTotals() {
      const old = tbl.querySelector('tfoot');
      if (old) old.replaceWith(totalsRow(colsV, gridContext(rr)));
      const sum = rentRollSummary(rr, rr.settings.asOf);
      tiles.querySelector('.tile .v').textContent = sum.annualRent ? short(sum.annualRent) : '—';
      drawIssues();
      drawOutputs(outputs, deal, rr, changed);
    }
    function totalsRow(colsV2, cc) {
      const tf = el('tfoot');
      const tr = el('tr');
      const leases = viewRows(rr, state);
      tr.setAttribute('aria-rowindex', String(leases.length + 2));
      colsV2.forEach((col, i) => {
        let v = '';
        if (i === 0) v = `Total · ${leases.length}`;
        else if (['sf', 'monthly', 'annual', 'netNow', 'deposit', 'arrears', 'lossToLease'].includes(col.key)) {
          const tot = leases.reduce((x, L) => x + (ok(col.get(L, cc)) ? col.get(L, cc) : 0), 0);
          v = show(col.kind, tot);
        } else if (col.key === 'psf') {
          const sf = leases.filter((L) => !L.vacant).reduce((x, L) => x + (pos(L.sf) ? L.sf : 0), 0);
          const rent = leases.reduce((x, L) => x + (L.vacant ? 0 : inPlace(L, cc.asOf).monthly * 12), 0);
          v = sf ? `${money2(rent / sf)} avg` : '';
        }
        tr.appendChild(el('td', null, v));
      });
      tr.appendChild(el('td'));
      tf.appendChild(tr);
      return tf;
    }
  }

  // spreadsheet keys: arrows between cells, Enter down, Escape back
  function nav(e, cell) {
    const r = Number(cell.dataset.r); const ci = Number(cell.dataset.c);
    const go = (dr, dc) => {
      let target = gridWrap.querySelector(`[data-r="${r + dr}"][data-c="${ci + dc}"]`);
      if (!target && dr) { grid.reveal(r + dr); target = gridWrap.querySelector(`[data-r="${r + dr}"][data-c="${ci + dc}"]`); }
      if (!target) return false;
      e.preventDefault();
      target.focus();
      if (target.select && target.type !== 'date') target.select();
      return true;
    };
    const atStart = cell.selectionStart === 0 || cell.selectionStart === null || cell.selectionStart === undefined;
    const atEnd = cell.selectionEnd === undefined || cell.selectionEnd === null || cell.selectionEnd === (cell.value || '').length;
    if (e.key === 'Escape' && cell.dataset.orig !== undefined) { cell.value = cell.dataset.orig; cell.blur(); cell.focus(); e.preventDefault(); return; }
    if (e.key === 'Enter' && cell.tagName === 'INPUT') { cell.dispatchEvent(new Event('change')); go(1, 0); return; }
    if (e.key === 'ArrowDown' && cell.tagName !== 'SELECT') go(1, 0);
    else if (e.key === 'ArrowUp' && cell.tagName !== 'SELECT') go(-1, 0);
    else if (e.key === 'ArrowRight' && (atEnd || cell.tagName !== 'INPUT' || cell.type === 'date')) go(0, 1);
    else if (e.key === 'ArrowLeft' && (atStart || cell.tagName !== 'INPUT' || cell.type === 'date')) go(0, -1);
  }

  refresh();
}

function btn(cls, text, fn) {
  const b = el('button', `btn ${cls}`, text);
  b.type = 'button';
  b.addEventListener('click', fn);
  return b;
}

/* ---------------------------------------------------------------- outputs */

function drawOutputs(box, deal, rr, changed) {
  box.textContent = '';
  const s = { ...DEFAULT_SETTINGS, ...rr.settings };
  const sum = rentRollSummary(rr, s.asOf);

  // expirations
  if (sum.expirations.length) {
    const sec = el('section', 'rr-sec');
    sec.appendChild(el('h3', 'sec-label', 'Lease expirations'));
    const maxPct = Math.max(...sum.expirations.map((e) => e.rentPct || 0), 1);
    const t = el('table', 'mini');
    const h = el('tr');
    for (const x of ['Year', 'Leases', 'SF', '% of SF', 'Rent', '% of rent', '']) h.appendChild(el('th', null, x));
    t.appendChild(h);
    let cum = 0;
    for (const e of sum.expirations) {
      cum += e.rentPct || 0;
      const tr = el('tr', (e.rentPct || 0) >= 25 ? 'hl-warn' : null);
      tr.appendChild(el('td', null, String(e.year)));
      tr.appendChild(el('td', null, String(e.count)));
      tr.appendChild(el('td', null, int(e.sf)));
      tr.appendChild(el('td', null, pct(e.sfPct, 1)));
      tr.appendChild(el('td', null, money0(e.rent)));
      tr.appendChild(el('td', null, pct(e.rentPct, 1)));
      const bar = el('td', 'bar-cell');
      const b = el('span', 'bar');
      b.style.width = `${Math.round(((e.rentPct || 0) / maxPct) * 100)}%`;
      b.setAttribute('aria-hidden', 'true');
      bar.appendChild(b);
      bar.title = `${pct(cum, 1)} of rent expired by the end of ${e.year}`;
      tr.appendChild(bar);
      t.appendChild(tr);
    }
    const w = el('div', 'scroll'); w.appendChild(t); sec.appendChild(w);
    box.appendChild(sec);
  }

  // concentration
  if (sum.concentration.length) {
    const sec = el('section', 'rr-sec');
    sec.appendChild(el('h3', 'sec-label', 'Tenant concentration'));
    const ul = el('ul', 'results');
    for (const c of sum.concentration.slice(0, 5)) {
      const li = el('li');
      li.appendChild(el('span', null, `${c.tenant || '(no name)'}${c.unit ? ` · ${c.unit}` : ''}`));
      li.appendChild(el('b', null, `${money0(c.annual)} · ${pct(c.share, 1)}`));
      ul.appendChild(li);
    }
    if (ok(sum.hhi)) { const li = el('li'); li.appendChild(el('span', null, 'Concentration index (HHI, 0 to 10,000)')); li.appendChild(el('b', null, int(sum.hhi))); ul.appendChild(li); }
    sec.appendChild(ul);
    box.appendChild(sec);
  }

  // projection: worked out in a worker, so the rest is on screen at once and the
  // table fills in when it arrives; a redraw in the meantime drops the old answer
  const sec = el('section', 'rr-sec rr-projection');
  box.appendChild(sec);
  box.appendChild(settingsForm(deal, rr, changed));
  const ready = projectionNow(rr);
  if (ready) { drawProjection(sec, ready, s); return; }
  sec.setAttribute('aria-busy', 'true');
  sec.appendChild(el('h3', 'sec-label', 'Projection'));
  const wait = el('p', 'hint-sm', 'Working out the projection, month by month…');
  sec.appendChild(wait);
  projectionLater(rr).then((P) => { if (sec.isConnected) drawProjection(sec, P, s); }, (e) => {
    if (!sec.isConnected) return;
    sec.removeAttribute('aria-busy');
    wait.textContent = `The projection couldn’t be worked out: ${e.message}`;
    wait.classList.add('warn-text');
  });
}

/** The projection table, its notes and what it assumes, into `sec`. */
function drawProjection(sec, P, s) {
  sec.textContent = '';
  sec.removeAttribute('aria-busy');
  sec.appendChild(el('h3', 'sec-label', `Projection · ${P.annual.length} years from ${P.from}`));
  const t = el('table', 'mini proj');
  const head = el('tr');
  head.appendChild(el('th', null, ''));
  for (const y of P.annual) head.appendChild(el('th', null, `Yr ${y.year}`));
  t.appendChild(head);
  const line = (label, key, opts = {}) => {
    if (!opts.always && P.annual.every((y) => !y[key])) return;
    const tr = el('tr', opts.strong ? 'strong' : null);
    const th = el('td', null, label);
    if (opts.why) th.title = opts.why;
    tr.appendChild(th);
    for (const y of P.annual) tr.appendChild(el('td', null, money0((opts.neg ? -1 : 1) * y[key])));
    t.appendChild(tr);
  };
  line('Contract rent (documented)', 'base', { always: true, why: 'Rent in the documented lease periods, before concessions' });
  line('Projected rent (renewals, lease-up)', 'projected', { why: 'Rent in projected periods: assumptions, not lease terms' });
  line('Vacancy at market (absorption and turnover)', 'vacancy', { why: 'Market rent on space that is empty' });
  line('Potential gross rent', 'gpr', { strong: true, always: true });
  line('Less vacancy', 'vacancy', { neg: true });
  line('Less free rent and abatements', 'free', { neg: true });
  line('Expense recoveries', 'recoveries');
  line('Percentage rent', 'pctRent');
  line('Other income', 'other');
  line('One-time items', 'oneTime');
  line('Less general vacancy and credit loss', 'generalVacancy', { neg: true, why: 'Beyond the vacancy already modelled' });
  line('Effective gross income', 'egi', { strong: true, always: true });
  line('Less operating expenses', 'opex', { neg: true });
  line('Net operating income', 'noi', { strong: true, always: true });
  line('Less tenant improvements', 'ti', { neg: true });
  line('Less leasing commissions', 'lc', { neg: true });
  line('Less capital reserves', 'reserves', { neg: true });
  line('Cash flow before debt service', 'cashFlow', { strong: true, always: true });
  const occ = el('tr');
  occ.appendChild(el('td', null, 'Average occupancy'));
  for (const y of P.annual) occ.appendChild(el('td', null, pct(y.occupancy, 1)));
  t.appendChild(occ);
  const w = el('div', 'scroll'); w.appendChild(t); sec.appendChild(w);
  for (const n of P.notes || []) { const p = el('p', 'hint-sm warn-text', n); sec.appendChild(p); }
  sec.appendChild(el('p', 'hint-sm', `Documented periods are the leases as entered; renewals and lease-up are projected at ${ok(s.marketRent) ? `${money2(s.marketRent)} ${s.marketUnit === 'month' ? 'a month' : 'per SF a year'}` : 'each unit’s market rent'}, growing ${dec(s.marketGrowth, 2)}% a year, with a ${dec(s.renewal.probability, 0)}% renewal probability. ${ok(s.opex) ? '' : 'Enter operating expenses below to reach NOI. '}Change any of it under Assumptions.`));
}

function settingsForm(deal, rr, changed) {
  const s = rr.settings;
  s.renewal = { ...DEFAULT_SETTINGS.renewal, ...(s.renewal || {}) };
  const d = el('details', 'rr-sec rr-settings');
  d.appendChild(el('summary', 'sec-label', 'Assumptions: market, expenses, renewals'));
  const g = el('div', 'grid-form');
  g.style.padding = '8px 0 0';
  const field = (obj, key, label, kind, hint) => {
    const f = el('div', 'field');
    const id = `rrs-${key}-${Math.random().toString(36).slice(2, 6)}`;
    const lab = el('label', null, label);
    lab.htmlFor = id;
    const i = el('input', kind === 'date' ? null : 'n');
    i.id = id;
    if (kind === 'date') i.type = 'date'; else i.inputMode = 'decimal';
    i.value = obj[key] === null || obj[key] === undefined ? '' : kind === 'money' ? int(obj[key]) : kind === 'money2' ? dec(obj[key], 2) : String(obj[key]);
    if (hint) i.placeholder = hint;
    i.addEventListener('change', () => {
      const v = kind === 'date' ? (dayOf(i.value) !== null ? i.value : null) : kind === 'pct' ? parsePct(i.value, { fraction: false }) : parseNum(i.value);
      if (kind === 'date' && v === null) { toast('That date isn’t valid.'); return; }
      obj[key] = v;
      changed();
    });
    const id2 = obj === s ? `rr.settings.${key}` : 'rr.settings.renewal';
    f.append(lab, i, affectsButton(`What changing ${label.replace(/[,%].*$/, '').trim().toLowerCase()} affects`, () => changed.affects([id2])));
    f.classList.add('has-affects');
    g.appendChild(f);
  };
  field(s, 'asOf', 'As of', 'date');
  field(s, 'years', 'Projection, years', 'int', '10');
  field(s, 'marketRent', s.marketUnit === 'month' ? 'Market rent, $ per unit a month' : 'Market rent, $/SF a year', 'money2', 'per unit, if blank');
  field(s, 'marketGrowth', 'Market rent growth %', 'pct', '3');
  field(s, 'opex', 'Operating expenses, $ a year', 'money', 'needed for NOI');
  field(s, 'recoverable', 'Recoverable expenses, $ a year', 'money', 'defaults to all');
  field(s, 'expenseGrowth', 'Expense growth %', 'pct', '3');
  field(s, 'generalVacancy', 'General vacancy and credit loss %', 'pct', '0');
  field(s, 'reservesPsf', 'Capital reserves, $/SF a year', 'money2', '0');
  field(s, 'leaseUpMonths', 'Vacant space leases up in, months', 'int', '6');
  const R = s.renewal;
  field(R, 'probability', 'Renewal probability %', 'pct', '65');
  field(R, 'termMonths', 'New lease term, months', 'int', '60');
  field(R, 'downtime', 'Downtime if the tenant leaves, months', 'int', '6');
  field(R, 'newFree', 'Free rent, new tenant, months', 'dec', '3');
  field(R, 'renewFree', 'Free rent, renewal, months', 'dec', '0');
  field(R, 'newTi', 'TI, new tenant, $/SF', 'money2', '0');
  field(R, 'renewTi', 'TI, renewal, $/SF', 'money2', '0');
  field(R, 'newLc', 'Commission, new tenant, % of term rent', 'pct', '0');
  field(R, 'renewLc', 'Commission, renewal, % of term rent', 'pct', '0');
  field(R, 'escalation', 'Escalation on new leases %', 'pct', '3');
  d.appendChild(g);
  const unitRow = el('div', 'view-actions');
  unitRow.style.marginTop = '10px';
  const mu = el('select', 'compact');
  mu.setAttribute('aria-label', 'Market rent is quoted');
  for (const [v, l] of [['psf_year', 'Market rent per SF a year'], ['month', 'Market rent per unit a month'], ['year', 'Market rent per unit a year']]) { const o = el('option', null, l); o.value = v; mu.appendChild(o); }
  mu.value = s.marketUnit || 'psf_year';
  mu.addEventListener('change', () => { s.marketUnit = mu.value; changed(); });
  const assume = el('label', 'chk');
  const cb = el('input'); cb.type = 'checkbox'; cb.checked = R.assume !== false;
  cb.addEventListener('change', () => { R.assume = cb.checked; changed(); });
  assume.append(cb, document.createTextNode(' Project renewals and lease-up'));
  unitRow.append(mu, assume);
  d.appendChild(unitRow);
  // other income lines
  const oi = el('div');
  oi.appendChild(el('div', 'hint-sm', 'Other income (parking, storage, laundry), $ a year:'));
  (s.otherIncome ||= []).forEach((o, i) => {
    const row = el('div', 'rr-oi');
    const n = el('input', 'input'); n.value = o.name || ''; n.setAttribute('aria-label', 'Other income name');
    n.addEventListener('change', () => { o.name = n.value; changed(false); });
    const a = el('input', 'input n'); a.inputMode = 'decimal'; a.value = ok(o.annual) ? int(o.annual) : ''; a.setAttribute('aria-label', `${o.name || 'Other income'}, a year`);
    a.addEventListener('change', () => { o.annual = parseNum(a.value); changed(); });
    const x = el('button', 'iconbtn'); x.type = 'button'; x.innerHTML = svg('<path d="M6 6l12 12M18 6L6 18"/>', 14); x.setAttribute('aria-label', 'Remove');
    x.addEventListener('click', () => { s.otherIncome.splice(i, 1); changed(); });
    row.append(n, a, x);
    oi.appendChild(row);
  });
  oi.appendChild(btn('btn-plain btn-sm', '+ Other income', () => { s.otherIncome.push({ name: 'Parking', annual: null }); changed(); }));
  d.appendChild(oi);
  if (deal.figures && ok(deal.figures.opex) && !ok(s.opex)) {
    d.appendChild(btn('btn-sm', `Use the OM’s operating expenses (${money0(deal.figures.opex)})`, () => { s.opex = deal.figures.opex; changed(); }));
  }
  return d;
}

/* --------------------------------------------------------------- columns */

function columnsSheet(rr, changed) {
  const body = api.sheetOpen({ eyebrow: 'Rent roll', title: 'Columns', sub: 'Show, hide, rename, reorder and size the columns. Your own fields go in too.' });
  const draw = () => {
    body.textContent = '';
    const list = el('div', 'list');
    list.style.cssText = 'background:var(--surface-2);border-radius:13px';
    rr.columns.forEach((c, i) => {
      const row = el('div', 'li col-row');
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = !c.hidden; cb.setAttribute('aria-label', `Show ${c.label}`);
      cb.addEventListener('change', () => { c.hidden = !cb.checked; changed(); });
      const name = el('input', 'input'); name.value = c.label; name.setAttribute('aria-label', 'Column name');
      name.addEventListener('change', () => { c.label = name.value.trim() || (COLUMNS[c.key] || {}).label || c.label; changed(); });
      const w = el('select', 'compact');
      w.setAttribute('aria-label', `Width of ${c.label}`);
      for (const [v, l] of [[80, 'S'], [120, 'M'], [180, 'L'], [260, 'XL']]) { const o = el('option', null, l); o.value = String(v); w.appendChild(o); }
      w.value = String([80, 120, 180, 260].reduce((a, b) => (Math.abs(b - (c.width || 120)) < Math.abs(a - (c.width || 120)) ? b : a)));
      w.addEventListener('change', () => { c.width = Number(w.value); changed(); });
      const up = el('button', 'iconbtn'); up.type = 'button'; up.innerHTML = svg('<path d="M6 15l6-6 6 6"/>', 15); up.setAttribute('aria-label', `Move ${c.label} up`); up.disabled = i === 0;
      up.addEventListener('click', () => { rr.columns.splice(i - 1, 0, rr.columns.splice(i, 1)[0]); changed(); draw(); });
      const dn = el('button', 'iconbtn'); dn.type = 'button'; dn.innerHTML = svg('<path d="M6 9l6 6 6-6"/>', 15); dn.setAttribute('aria-label', `Move ${c.label} down`); dn.disabled = i === rr.columns.length - 1;
      dn.addEventListener('click', () => { rr.columns.splice(i + 1, 0, rr.columns.splice(i, 1)[0]); changed(); draw(); });
      row.append(cb, name, w, up, dn);
      if (c.custom) {
        const x = el('button', 'iconbtn'); x.type = 'button'; x.innerHTML = svg('<path d="M6 6l12 12M18 6L6 18"/>', 14); x.setAttribute('aria-label', `Delete the ${c.label} field`);
        x.addEventListener('click', () => { rr.columns.splice(i, 1); changed(); draw(); toast(`${c.label} removed from the grid. Values typed in it stay with each lease.`); });
        row.appendChild(x);
      }
      list.appendChild(row);
    });
    body.appendChild(list);
    // built-in columns not in the layout
    const missing = Object.keys(COLUMNS).filter((k) => !rr.columns.some((c) => c.key === k));
    if (missing.length) {
      body.appendChild(el('h3', null, 'Add a column'));
      const box = el('div', 'chips');
      for (const k of missing) box.appendChild(Object.assign(btn('btn-sm btn-gray', COLUMNS[k].label, () => { rr.columns.push({ key: k, label: COLUMNS[k].label, width: COLUMNS[k].width, hidden: false }); changed(); draw(); })));
      body.appendChild(box);
    }
    body.appendChild(el('h3', null, 'Your own field'));
    const f = el('form', 'add-q');
    const n = el('input', 'input'); n.placeholder = 'Field name, e.g. Tenant contact'; n.setAttribute('aria-label', 'New field name');
    const k = el('select', 'compact'); k.setAttribute('aria-label', 'Field type');
    for (const [v, l] of [['text', 'Text'], ['money', 'Dollars'], ['int', 'Number'], ['pct', 'Percent'], ['date', 'Date']]) { const o = el('option', null, l); o.value = v; k.appendChild(o); }
    f.append(n, k, btn('btn-sm', 'Add', () => f.requestSubmit()));
    f.addEventListener('submit', (e) => { e.preventDefault(); if (!n.value.trim()) return; rr.columns.push(customColumn(n.value, k.value)); changed(); draw(); });
    body.appendChild(f);
    body.appendChild(el('h3', null, 'Layouts'));
    const lay = el('div', 'chips');
    for (const p of Object.keys(PRESETS)) lay.appendChild(btn('btn-sm btn-gray', `${p} columns`, () => { applyLayout(rr, layoutFromPreset(p)); rr.preset = p; rr.settings.marketUnit = MARKET_UNIT[p] || rr.settings.marketUnit; changed(); draw(); }));
    body.appendChild(lay);
    const saved = el('div', 'chips');
    saved.style.marginTop = '8px';
    kvGet('rr.layouts').then((list2) => {
      for (const L of list2 || []) saved.appendChild(btn('btn-sm', L.name, () => { applyLayout(rr, L.columns); changed(); draw(); toast(`Layout “${L.name}” applied.`); }));
      saved.appendChild(btn('btn-sm', 'Save this layout…', async () => {
        const name = (window.prompt('Name this column layout', 'My rent roll') || '').trim();
        if (!name) return;
        const all = ((await kvGet('rr.layouts')) || []).filter((x) => x.name !== name);
        all.push({ name, columns: JSON.parse(JSON.stringify(rr.columns)) });
        await kvSet('rr.layouts', all);
        toast(`Saved. “${name}” is offered on every deal’s rent roll.`);
        draw();
      }));
    });
    body.appendChild(saved);
  };
  draw();
}

/** A layout applied over the current one keeps custom fields the layout doesn't mention, hidden. */
function applyLayout(rr, cols) {
  const keep = rr.columns.filter((c) => c.custom && !cols.some((x) => x.key === c.key)).map((c) => ({ ...c, hidden: true }));
  rr.columns = [...JSON.parse(JSON.stringify(cols)), ...keep];
}

/** The lease field a grid column sets, as the dependency map names it. */
const COLUMN_INPUT = (c) => (c.custom ? 'lease.custom' : { monthly: 'lease.rent', annual: 'lease.rent', psf: 'lease.rent', share: 'lease.recovery', recovery: 'lease.recovery' }[c.key]
  || (LEASE_INPUTS.includes(`lease.${c.key}`) ? `lease.${c.key}` : null));
const LEASE_INPUTS = LEASE_FIELDS.map(([k]) => `lease.${k}`);

/* ------------------------------------------------------------- more menu */

async function moreMenu(deal, rr, changed) {
  const v = await actionSheet('Rent roll', [
    { label: 'Import from Excel or CSV…', sub: 'a rent roll sheet with a header row', value: 'import' },
    { label: 'Export rent roll and cash flow (Excel)', value: 'xlsx' },
    { label: 'Export CSV', sub: 'the grid as shown', value: 'csv' },
    { label: 'What a column affects…', sub: 'every figure, scenario and export that moves with it', value: 'affects' },
    '-',
    { label: 'Clear the rent roll', value: 'clear', danger: true, disabled: !rr.leases.length },
  ]);
  if (v === 'import') importDialog(rr, changed);
  else if (v === 'xlsx') exportWorkbook(deal, rr);
  else if (v === 'csv') exportCsv(deal, rr);
  else if (v === 'affects') {
    // the columns a person types into, each to the lease field it sets
    const cols = visibleColumns(rr.columns).filter((c) => c.set && COLUMN_INPUT(c));
    const k = await actionSheet('What does a column affect?', cols.map((c) => ({ label: c.label, value: c.key })));
    const col = cols.find((c) => c.key === k);
    if (col) changed.affects([COLUMN_INPUT(col)], { title: `the ${col.label.charAt(0).toLowerCase()}${col.label.slice(1)} column` });
  }
  else if (v === 'clear') {
    const old = rr.leases;
    rr.leases = [];
    changed(true, { label: 'Cleared the rent roll' });
    toast('Rent roll cleared.', { label: 'Undo', run: () => { rr.leases = old; changed(); } });
  }
}

function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
async function exportCsv(deal, rr) {
  const c = gridContext(rr);
  const cols = visibleColumns(rr.columns);
  const lines = [cols.map((x) => csvCell(x.label)).join(',')];
  for (const L of rr.leases) lines.push(cols.map((x) => { const v = x.get(L, c); return csvCell(ok(v) ? Math.round(v * 100) / 100 : v); }).join(','));
  await deliver(`Rent roll - ${fileName(deal)}.csv`, new TextEncoder().encode(`${lines.join('\r\n')}\r\n`), 'text/csv', { map: 'rr-csv' });
}
const fileName = (deal) => (deal.name || deal.figures?.address || 'Deal').replace(/[^\w\s-]+/g, ' ').replace(/\s+/g, ' ').trim();

async function exportWorkbook(deal, rr) {
  try {
    const libs = await getXlsx();
    const { buildRentRollWorkbook } = await import('./rrbook.js');
    const bytes = await buildRentRollWorkbook(libs.ExcelJS, libs.fflate, { deal, rr });
    if (await deliver(`Rent roll - ${fileName(deal)}.xlsx`, bytes, XLSX, { map: 'rr-workbook' }) === 'done') toast('Rent roll workbook ready: the rent roll, every lease period, and the cash flow by year.');
  } catch (err) {
    toast(`The workbook could not be built: ${err.message || err}`);
  }
}

/* --------------------------------------------------------------- import */

/**
 * Which field a rent-roll column heading names.
 * @type {[string, RegExp][]}
 */
export const IMPORT_FIELDS = [
  ['unit', /^(unit|suite|ste|space|apt|apartment|unit\s*#|suite\s*#)\b/i],
  ['tenant', /tenant|lessee|occupant|resident|name/i],
  ['unitType', /unit type|bed|br\/ba|floor ?plan/i],
  ['sf', /\b(sf|rsf|nra|gla|sq\.?\s?ft\.?|size|area)\b|square\s*f(?:ee|oo)?t/i],
  ['leaseStart', /(lease )?(start|commence|from|move[- ]?in)/i],
  ['leaseEnd', /(lease )?(end|expir|exp\b|to\b|move[- ]?out|lxd)/i],
  ['psf', /(rent|rate).*(psf|\/\s?sf|per sf)|^psf$|\$\/sf/i],
  // annual before monthly: "Annual Base Rent" is annual; a bare "Rent" column is taken as monthly last
  ['annual', /annual|yearly|\/yr|per year|base rent/i],
  ['monthly', /monthly|month|\/mo|per month|contract rent|current rent|rent$/i],
  ['marketRent', /market/i],
  ['deposit', /deposit/i],
  ['status', /status|occupied|vacan/i],
];
export function guessField(header) {
  const h = String(header || '').trim();
  if (!h) return null;
  for (const [k, re] of IMPORT_FIELDS) if (re.test(h)) return k;
  return null;
}

async function importDialog(rr, changed) {
  const inp = el('input');
  inp.type = 'file';
  inp.accept = '.xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  inp.addEventListener('change', async () => {
    const f = inp.files[0];
    if (!f) return;
    let table;
    try { table = await readTable(f); } catch (err) { toast(err.message || String(err), null, 8000); return; }
    mapImport(rr, table, f.name, changed);
  });
  inp.click();
}

/** The rows of the first sheet that looks like a rent roll: [{ headers, rows, sheet }]. */
async function readTable(file) {
  if (/\.xls$/i.test(file.name)) throw new Error('That is an old .xls file. Open it in Excel and save it as .xlsx (or CSV), then import it.');
  if (/\.xlsm$/i.test(file.name)) throw new Error('That workbook has macros. Save a copy as .xlsx or CSV to import its rent roll.');
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') return parseCsv(await file.text());
  const { ExcelJS } = await getXlsx();
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(await file.arrayBuffer()); } catch { throw new Error('That file could not be opened as an Excel workbook. It may be damaged, password protected or not really .xlsx.'); }
  let best = null;
  wb.eachSheet((ws) => {
    if (ws.state && ws.state !== 'visible') return;
    const grid = [];
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      if (r > 400) return;
      const vals = [];
      row.eachCell({ includeEmpty: true }, (cell, c) => { vals[c - 1] = cellValue(cell.value); });
      grid.push(vals);
    });
    const t = headerAndRows(grid, ws.name);
    if (t && (!best || t.score > best.score)) best = t;
  });
  if (!best) throw new Error('No rent roll was found: it needs a row of headings such as Unit, Tenant, SF and Rent.');
  return best;
}
function cellValue(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return cellValue(v.result);
    if ('richText' in v) return v.richText.map((x) => x.text).join('');
    if ('text' in v) return v.text;
  }
  return v;
}
function parseCsv(text) {
  const rows = [];
  let row = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; } else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const t = headerAndRows(rows.filter((r) => r.some((x) => String(x).trim())), 'CSV');
  if (!t) throw new Error('No rent roll was found: it needs a row of headings such as Unit, Tenant, SF and Rent.');
  return t;
}
/** The header row is the first row in the top twenty with at least three recognisable headings. */
export function headerAndRows(grid, sheet) {
  for (let r = 0; r < Math.min(20, grid.length); r++) {
    const hs = (grid[r] || []).map((x) => (x === null || x === undefined ? '' : String(x)));
    const hits = hs.filter((h) => guessField(h)).length;
    if (hits >= 3) {
      const rows = grid.slice(r + 1).filter((x) => x && x.some((v) => v !== null && v !== '' && v !== undefined))
        .filter((x) => !/^(total|totals|grand total|subtotal)/i.test(String(x.find((v) => v !== null && v !== '') ?? '')));
      return { sheet, headers: hs, rows, score: hits * 100 + rows.length };
    }
  }
  return null;
}

/** Show how each column will be read, let the broker change it, then add the rows. */
function mapImport(rr, table, fileLabel, changed) {
  const guess = table.headers.map(guessField);
  const done = el('button', 'btn btn-primary', 'Import');
  done.type = 'button';
  const body = api.sheetOpen({ eyebrow: 'Import rent roll', title: fileLabel, sub: `${table.sheet} · ${table.rows.length} rows. Check how each column is read.`, foot: [done] });
  const fields = [['', '— skip —'], ['unit', 'Unit / suite'], ['tenant', 'Tenant'], ['unitType', 'Unit type'], ['sf', 'SF'], ['status', 'Status'], ['leaseStart', 'Lease start'], ['leaseEnd', 'Lease end'], ['monthly', 'Monthly rent'], ['annual', 'Annual rent'], ['psf', 'Rent / SF / yr'], ['marketRent', 'Market rent'], ['deposit', 'Security deposit']];
  table.headers.forEach((h, i) => {
    if (!h) return;
    const r = el('div', 'map-row');
    const hh = el('div', 'h', h);
    const sample = table.rows.slice(0, 2).map((x) => x[i]).filter((x) => x !== null && x !== undefined && x !== '').join(', ');
    hh.appendChild(el('small', null, sample ? `e.g. ${sample}` : 'empty'));
    r.appendChild(hh);
    const sel = el('select', 'compact');
    sel.setAttribute('aria-label', `Read column ${h} as`);
    for (const [v, l] of fields) { const o = el('option', null, l); o.value = v; sel.appendChild(o); }
    sel.value = guess[i] || '';
    sel.addEventListener('change', () => { guess[i] = sel.value || null; });
    r.appendChild(sel);
    body.appendChild(r);
  });
  const mode = el('label', 'chk');
  const rep = el('input'); rep.type = 'checkbox'; rep.checked = !rr.leases.length;
  mode.append(rep, document.createTextNode(' Replace the current rent roll (otherwise the rows are added)'));
  body.appendChild(mode);
  done.addEventListener('click', () => {
    const { leases, skipped } = rowsToLeases(rr, table, guess);
    const snap = changed.snapshot('Before importing a rent roll');
    const old = rr.leases;
    rr.leases = rep.checked ? leases : [...rr.leases, ...leases];
    api.sheetClose();
    changed(true, { kind: 'import', label: `Imported ${leases.length} unit${leases.length === 1 ? '' : 's'} from a spreadsheet${rep.checked ? ', replacing the rent roll' : ''}`, snapshot: snap });
    toast(`${leases.length} unit${leases.length === 1 ? '' : 's'} imported${skipped ? `; ${skipped} row${skipped === 1 ? '' : 's'} skipped (no unit, tenant or rent)` : ''}. Each rent is one documented period from the lease start to the lease end.`,
      { label: 'Undo', run: () => { rr.leases = old; changed(); } }, 9000);
  });
}

/** Imported rows as leases: the rent in force becomes one documented period over the lease dates. */
export function rowsToLeases(rr, table, mapping) {
  const asOf = rr.settings.asOf;
  const at = (row, k) => { const i = mapping.indexOf(k); return i < 0 ? null : row[i]; };
  const num = (x) => (typeof x === 'number' ? x : parseNum(x));
  const date = (x) => {
    if (x === null || x === undefined || x === '') return null;
    if (typeof x === 'number' && x > 20000 && x < 80000) return isoOf(Math.round(x) - 25569);   // an Excel serial
    const s = String(x).trim();
    if (dayOf(s) !== null) return s.slice(0, 10);
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
    if (m) { const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); const iso = `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; return dayOf(iso) !== null ? iso : null; }
    const t = Date.parse(s);
    return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
  };
  const leases = []; let skipped = 0;
  for (const row of table.rows) {
    const unit = at(row, 'unit'); const tenant = at(row, 'tenant');
    const sf = num(at(row, 'sf'));
    const status = String(at(row, 'status') || '');
    const vacant = /vacan/i.test(String(tenant || '')) || /vacan/i.test(status);
    const monthly = num(at(row, 'monthly')); const annual = num(at(row, 'annual')); const psf = num(at(row, 'psf'));
    if (!unit && !tenant && !ok(monthly) && !ok(annual)) { skipped += 1; continue; }
    const L = newLease(rr, {
      unit: unit === null ? '' : String(unit), tenant: vacant ? '' : (tenant ? String(tenant) : ''), sf: pos(sf) ? sf : null, vacant,
      unitType: at(row, 'unitType') ? String(at(row, 'unitType')) : '', leaseStart: date(at(row, 'leaseStart')), leaseEnd: date(at(row, 'leaseEnd')),
      marketRent: num(at(row, 'marketRent')), deposit: num(at(row, 'deposit')), source: { kind: 'import', file: table.sheet },
    });
    if (!vacant) {
      /** @type {[RentInUnit, RentUnit] | null} */
      const rate = ok(annual) ? [annual, 'year'] : ok(monthly) ? [monthly, 'month'] : ok(psf) && pos(L.sf) ? [psf, 'psf_year'] : null;
      if (rate) {
        const start = L.leaseStart || asOf;
        const end = L.leaseEnd || addDays(addMonths(asOf, 1), -1);
        if (!L.leaseEnd) L.mtm = true;
        L.periods.push({ start, end, rate: rate[0], unit: rate[1], source: 'documented', note: `imported from ${table.sheet}` });
      }
    }
    leases.push(L);
  }
  return { leases, skipped };
}

/* ------------------------------------------------------- lease schedule */

/**
 * One lease's schedule: dates, rent periods on a timeline, free rent, one-time
 * items, recoveries, percentage rent and the renewal assumption. Edits apply
 * as they're made; "Revert" puts the lease back as it was when the sheet opened.
 */
function scheduleSheet(rr, L, changed) {
  const snapshot = JSON.parse(JSON.stringify(L));
  const revert = el('button', 'btn btn-gray', 'Revert changes');
  revert.type = 'button';
  const doneB = el('button', 'btn btn-primary', 'Done');
  doneB.type = 'button';
  const body = api.sheetOpen({ eyebrow: `Unit ${L.unit || ''}`, title: L.vacant ? 'Vacant space' : (L.tenant || 'Lease schedule'), sub: 'Rent as dated periods. Documented terms come from the lease; projected ones are assumptions.', foot: [revert, doneB] });
  revert.addEventListener('click', () => { for (const k of Object.keys(L)) delete L[k]; Object.assign(L, JSON.parse(JSON.stringify(snapshot))); changed(); draw(); toast('Lease put back as it was.'); });
  doneB.addEventListener('click', () => api.sheetClose());
  const edit = () => { changed(); draw(); };

  function draw() {
    const keepScroll = body.scrollTop;
    body.textContent = '';
    // the lease
    const g = el('div', 'grid-form');
    g.style.padding = '0';
    const f = (key, label, kind) => {
      const fd = el('div', 'field');
      const id = `ls-${key}`;
      const lab = el('label', null, label); lab.htmlFor = id;
      const i = el('input', kind === 'text' || kind === 'date' ? null : 'n'); i.id = id;
      if (kind === 'date') i.type = 'date'; else if (kind !== 'text') i.inputMode = 'decimal';
      i.value = L[key] === null || L[key] === undefined ? '' : kind === 'int' ? int(L[key]) : String(L[key]);
      i.addEventListener('change', () => { L[key] = kind === 'text' ? i.value.trim() : kind === 'date' ? (dayOf(i.value) !== null ? i.value : null) : parseNum(i.value); edit(); });
      fd.append(lab, i); g.appendChild(fd);
    };
    f('tenant', 'Tenant', 'text'); f('unit', 'Unit / suite', 'text'); f('sf', 'SF', 'int');
    f('leaseStart', 'Lease start', 'date'); f('rentStart', 'Rent start', 'date'); f('leaseEnd', 'Lease end', 'date');
    body.appendChild(g);
    const vac = el('label', 'chk');
    const vcb = el('input'); vcb.type = 'checkbox'; vcb.checked = !!L.vacant;
    vcb.addEventListener('change', () => { L.vacant = vcb.checked; L.status = L.vacant ? 'Vacant' : 'Occupied'; edit(); });
    vac.append(vcb, document.createTextNode(' Vacant (projected to lease up at market)'));
    body.appendChild(vac);

    // problems
    const issues = validateLease(L);
    if (issues.length) {
      const ul = el('ul', 'checks');
      for (const x of issues) { const li = el('li', x.level === 'error' ? 'error' : 'warn'); li.appendChild(el('span', null, x.text)); ul.appendChild(li); }
      body.appendChild(ul);
    }

    // timeline
    body.appendChild(el('h3', null, 'Timeline'));
    body.appendChild(timeline(rr, L));

    // periods
    body.appendChild(el('h3', null, 'Rent periods'));
    const pt = el('table', 'mini sched');
    const ph = el('tr');
    for (const x of ['From', 'To', 'Rent', 'Unit', 'Monthly', 'Kind', '']) ph.appendChild(el('th', null, x));
    pt.appendChild(ph);
    const periods = (L.periods ||= []);
    periods.sort((a, b) => (dayOf(a.start) ?? 0) - (dayOf(b.start) ?? 0));
    periods.forEach((p, i) => {
      const tr = el('tr', p.source === 'projected' ? 'projected' : null);
      const dateIn = (k) => { const td = el('td'); td.dataset.label = k === 'start' ? 'From' : 'To'; const i2 = el('input'); i2.type = 'date'; i2.value = p[k] || ''; i2.setAttribute('aria-label', `Period ${i + 1} ${k === 'start' ? 'from' : 'to'}`); i2.addEventListener('change', () => { p[k] = dayOf(i2.value) !== null ? i2.value : p[k]; p.edited = true; edit(); }); td.appendChild(i2); return td; };
      tr.appendChild(dateIn('start'));
      tr.appendChild(dateIn('end'));
      const tdR = el('td'); tdR.dataset.label = 'Rent'; const r = el('input', 'n'); r.inputMode = 'decimal'; r.value = ok(p.rate) ? dec(p.rate, 2) : ''; r.setAttribute('aria-label', `Period ${i + 1} rent`);
      r.addEventListener('change', () => { const v = parseNum(r.value); if (v === null) { toast('Enter the rent as a number.'); r.value = dec(p.rate, 2); return; } p.rate = v; p.edited = true; edit(); });
      tdR.appendChild(r); tr.appendChild(tdR);
      const tdU = el('td'); tdU.dataset.label = 'Unit'; const u = el('select', 'compact'); u.setAttribute('aria-label', `Period ${i + 1} rent unit`);
      for (const [k, l] of Object.entries(UNITS)) { const o = el('option', null, l); o.value = k; u.appendChild(o); }
      u.value = p.unit; u.addEventListener('change', () => { p.unit = u.value; p.edited = true; edit(); });
      tdU.appendChild(u); tr.appendChild(tdU);
      const mo = monthlyAmount(p.rate, p.unit, L.sf);
      const tdM = el('td', 'mo', mo === null ? '—' : money0(mo)); tdM.dataset.label = 'Monthly'; tr.appendChild(tdM);
      const tdK = el('td'); tdK.dataset.label = 'Kind'; const k = el('select', 'compact'); k.setAttribute('aria-label', `Period ${i + 1} documented or projected`);
      for (const [v, l] of [['documented', 'Documented'], ['projected', 'Projected']]) { const o = el('option', null, l); o.value = v; k.appendChild(o); }
      k.value = p.source || 'documented'; k.addEventListener('change', () => { p.source = k.value; edit(); });
      tdK.appendChild(k); tr.appendChild(tdK);
      const tdA = el('td', 'acts');
      const ins = el('button', 'iconbtn'); ins.type = 'button'; ins.innerHTML = svg('<path d="M12 5v14M5 12h14"/>', 14); ins.setAttribute('aria-label', `Insert a period after period ${i + 1}`);
      ins.addEventListener('click', () => {
        const start = addDays(p.end, 1);
        periods.splice(i + 1, 0, { start, end: addDays(addMonths(start, 12), -1), rate: p.rate, unit: p.unit, source: p.source || 'documented' });
        edit();
      });
      const dup = el('button', 'iconbtn'); dup.type = 'button'; dup.innerHTML = svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>', 14); dup.setAttribute('aria-label', `Duplicate period ${i + 1}`);
      dup.addEventListener('click', () => { periods.splice(i + 1, 0, { ...p }); edit(); toast('Duplicated: change its dates so the two don’t overlap.'); });
      const del = el('button', 'iconbtn'); del.type = 'button'; del.innerHTML = svg('<path d="M6 6l12 12M18 6L6 18"/>', 14); del.setAttribute('aria-label', `Delete period ${i + 1}`);
      del.addEventListener('click', () => { periods.splice(i, 1); edit(); });
      tdA.append(ins, dup, del); tr.appendChild(tdA);
      pt.appendChild(tr);
    });
    const pw = el('div', 'scroll'); pw.appendChild(pt); body.appendChild(pw);
    const pa = el('div', 'view-actions');
    pa.appendChild(btn('btn-sm', '+ Period', () => {
      const last = periods[periods.length - 1];
      const start = last ? addDays(last.end, 1) : (L.rentStart || L.leaseStart || rr.settings.asOf);
      periods.push({ start, end: addDays(addMonths(start, 12), -1), rate: last ? last.rate : 0, unit: last ? last.unit : 'year', source: 'documented' });
      edit();
    }));
    body.appendChild(pa);

    // generator
    const gen = el('details', 'rr-gen');
    gen.appendChild(el('summary', null, 'Build periods from a starting rent and bumps'));
    const gg = el('div', 'grid-form'); gg.style.padding = '8px 0 0';
    const gv = { start: L.rentStart || L.leaseStart || rr.settings.asOf, end: L.leaseEnd || '', rate: '', unit: 'psf_year', type: 'pct', value: 3, every: 12 };
    const gf = (key, label, kind, opts) => {
      const fd = el('div', 'field'); const id = `gen-${key}`;
      const lab = el('label', null, label); lab.htmlFor = id;
      let i;
      if (opts) { i = el('select'); for (const [v, l] of opts) { const o = el('option', null, l); o.value = v; i.appendChild(o); } } else { i = el('input', kind === 'date' ? null : 'n'); if (kind === 'date') i.type = 'date'; else i.inputMode = 'decimal'; }
      i.id = id; i.value = gv[key] ?? '';
      i.addEventListener('change', () => { gv[key] = i.value; });
      fd.append(lab, i); gg.appendChild(fd);
    };
    gf('start', 'From', 'date'); gf('end', 'To', 'date'); gf('rate', 'Starting rent', 'n');
    gf('unit', 'Unit', null, Object.entries(UNITS)); gf('type', 'Bumps', null, [['pct', '% increase'], ['fixed', '$ increase']]);
    gf('value', 'Bump size', 'n'); gf('every', 'Every, months', 'n');
    gen.appendChild(gg);
    const ga = el('div', 'view-actions'); ga.style.marginTop = '8px';
    const build = (replace) => {
      const steps = generateSteps({ start: gv.start, end: gv.end, rate: parseNum(gv.rate), unit: /** @type {RentUnit} */ (gv.unit), escalation: { type: /** @type {'pct' | 'fixed'} */ (gv.type), value: parseNum(gv.value) }, every: parseNum(gv.every) || 12 });
      if (!steps.length) { toast('Enter a start, an end after it, and a starting rent.'); return; }
      if (replace) L.periods = steps; else L.periods.push(...steps);
      edit();
      toast(`${steps.length} period${steps.length === 1 ? '' : 's'} ${replace ? 'replace the schedule' : 'added'}.`);
    };
    ga.append(btn('btn-sm', 'Replace the periods', () => build(true)), btn('btn-sm btn-gray', 'Add to them', () => build(false)));
    gen.appendChild(ga);
    body.appendChild(gen);

    // abatements
    body.appendChild(el('h3', null, 'Free rent and abatements'));
    const ab = (L.abatements ||= []);
    ab.forEach((a, i) => {
      const row = el('div', 'rr-line');
      const s1 = el('input'); s1.type = 'date'; s1.value = a.start || ''; s1.setAttribute('aria-label', `Abatement ${i + 1} from`);
      s1.addEventListener('change', () => { a.start = s1.value; edit(); });
      const e1 = el('input'); e1.type = 'date'; e1.value = a.end || ''; e1.setAttribute('aria-label', `Abatement ${i + 1} to`);
      e1.addEventListener('change', () => { a.end = e1.value; edit(); });
      const p1 = el('input', 'n'); p1.inputMode = 'decimal'; p1.value = ok(a.pct) ? String(a.pct) : '100'; p1.setAttribute('aria-label', `Abatement ${i + 1} percent of rent`);
      p1.addEventListener('change', () => { a.pct = parsePct(p1.value, { fraction: false }); edit(); });
      const x = el('button', 'iconbtn'); x.type = 'button'; x.innerHTML = svg('<path d="M6 6l12 12M18 6L6 18"/>', 14); x.setAttribute('aria-label', `Remove abatement ${i + 1}`);
      x.addEventListener('click', () => { ab.splice(i, 1); edit(); });
      row.append(s1, el('span', null, 'to'), e1, p1, el('span', null, '% off'), x);
      body.appendChild(row);
    });
    body.appendChild(btn('btn-plain btn-sm', '+ Free rent or abatement', () => {
      const s0 = L.rentStart || L.leaseStart || rr.settings.asOf;
      ab.push({ start: s0, end: addDays(addMonths(s0, 3), -1), pct: 100 });
      edit();
    }));

    // one-time items
    body.appendChild(el('h3', null, 'One-time charges and credits'));
    const ot = (L.oneTime ||= []);
    ot.forEach((o, i) => {
      const row = el('div', 'rr-line');
      const d1 = el('input'); d1.type = 'date'; d1.value = o.date || ''; d1.setAttribute('aria-label', `Item ${i + 1} date`);
      d1.addEventListener('change', () => { o.date = d1.value; edit(); });
      const a1 = el('input', 'n'); a1.inputMode = 'decimal'; a1.value = ok(o.amount) ? String(o.amount) : ''; a1.setAttribute('aria-label', `Item ${i + 1} amount, negative for a credit`);
      a1.addEventListener('change', () => { o.amount = parseNum(a1.value); edit(); });
      const n1 = el('input', 'input'); n1.value = o.note || ''; n1.placeholder = 'what it is'; n1.setAttribute('aria-label', `Item ${i + 1} note`);
      n1.addEventListener('change', () => { o.note = n1.value; changed(); });
      const x = el('button', 'iconbtn'); x.type = 'button'; x.innerHTML = svg('<path d="M6 6l12 12M18 6L6 18"/>', 14); x.setAttribute('aria-label', `Remove item ${i + 1}`);
      x.addEventListener('click', () => { ot.splice(i, 1); edit(); });
      row.append(d1, a1, n1, x);
      body.appendChild(row);
    });
    body.appendChild(btn('btn-plain btn-sm', '+ Charge or credit (negative)', () => { ot.push({ date: rr.settings.asOf, amount: null, note: '' }); edit(); }));

    // recoveries and percentage rent
    body.appendChild(el('h3', null, 'Recoveries and percentage rent'));
    const rg = el('div', 'grid-form'); rg.style.padding = '0';
    const Rc = (L.recovery ||= { method: 'none' });
    const sel = (label, value, opts, set) => { const fd = el('div', 'field'); const lab = el('label', null, label); const s = el('select'); for (const [v, l] of opts) { const o = el('option', null, l); o.value = v; s.appendChild(o); } s.value = value; s.setAttribute('aria-label', label); s.addEventListener('change', () => { set(s.value); edit(); }); fd.append(lab, s); rg.appendChild(fd); };
    const nf = (label, obj, key, kind = 'n') => { const fd = el('div', 'field'); const lab = el('label', null, label); const i = el('input', 'n'); i.inputMode = 'decimal'; i.value = ok(obj[key]) ? String(obj[key]) : ''; i.setAttribute('aria-label', label); i.addEventListener('change', () => { obj[key] = kind === 'pct' ? parsePct(i.value, { fraction: false }) : parseNum(i.value); edit(); }); fd.append(lab, i); rg.appendChild(fd); };
    sel('Recovery method', Rc.method || 'none', [['none', 'None (gross)'], ['prorata', 'Pro rata share (NNN)'], ['base_year', 'Over a base-year amount'], ['stop', 'Over an expense stop ($/SF)'], ['fixed', 'Fixed amount a year']], (v) => { Rc.method = v; });
    if (Rc.method === 'prorata' || Rc.method === 'base_year') nf('Pro-rata share % (blank = SF share)', Rc, 'share', 'pct');
    if (Rc.method === 'base_year') nf('Base-year expenses, $', Rc, 'baseAmount');
    if (Rc.method === 'stop') nf('Expense stop, $/SF', Rc, 'stopPsf');
    if (Rc.method === 'fixed') { nf('Fixed recovery, $ a year', Rc, 'amount'); nf('Growth % a year', Rc, 'growth', 'pct'); }
    const Pr = (L.percentRent ||= {});
    nf('Percentage rent rate %', Pr, 'rate', 'pct');
    nf('Annual sales, $', Pr, 'sales');
    nf('Breakpoint, $ (blank with natural)', Pr, 'breakpoint');
    nf('Sales growth % a year', Pr, 'growth', 'pct');
    body.appendChild(rg);
    const nat = el('label', 'chk'); const ncb = el('input'); ncb.type = 'checkbox'; ncb.checked = !!Pr.natural;
    ncb.addEventListener('change', () => { Pr.natural = ncb.checked; edit(); });
    nat.append(ncb, document.createTextNode(' Natural breakpoint (base rent ÷ rate)'));
    body.appendChild(nat);

    // renewal
    body.appendChild(el('h3', null, 'When this lease ends'));
    const Rn = (L.renewal ||= {});
    const rg2 = el('div', 'grid-form'); rg2.style.padding = '0';
    const nf2 = (label, key, kind = 'n', ph = '') => { const fd = el('div', 'field'); const lab = el('label', null, label); const i = el('input', 'n'); i.inputMode = 'decimal'; i.value = ok(Rn[key]) ? String(Rn[key]) : ''; i.placeholder = ph; i.setAttribute('aria-label', label); i.addEventListener('change', () => { const v = kind === 'pct' ? parsePct(i.value, { fraction: false }) : parseNum(i.value); if (v === null) delete Rn[key]; else Rn[key] = v; edit(); }); fd.append(lab, i); rg2.appendChild(fd); };
    const S = { ...DEFAULT_SETTINGS.renewal, ...(rr.settings.renewal || {}) };
    nf2('Renewal probability %', 'probability', 'pct', `${S.probability} (property)`);
    nf2('Downtime if it leaves, months', 'downtime', 'n', `${S.downtime}`);
    nf2('New term, months', 'termMonths', 'n', `${S.termMonths}`);
    const mk = el('div', 'field'); const ml = el('label', null, 'Market rent for this space'); const mi = el('input', 'n'); mi.inputMode = 'decimal'; mi.value = ok(L.marketRent) ? String(L.marketRent) : ''; mi.placeholder = ok(rr.settings.marketRent) ? `${rr.settings.marketRent} (property)` : 'set it';
    mi.setAttribute('aria-label', 'Market rent for this space'); mi.addEventListener('change', () => { L.marketRent = parseNum(mi.value); edit(); }); mk.append(ml, mi); rg2.appendChild(mk);
    body.appendChild(rg2);
    const asm = el('label', 'chk'); const acb = el('input'); acb.type = 'checkbox'; acb.checked = Rn.assume !== false;
    acb.addEventListener('change', () => { Rn.assume = acb.checked ? undefined : false; edit(); });
    asm.append(acb, document.createTextNode(' Project a renewal or re-lease at market when it ends'));
    body.appendChild(asm);

    // this lease's cash flow
    body.appendChild(el('h3', null, 'This lease by year'));
    const one = project({ settings: rr.settings, leases: [L] });
    const ct = el('table', 'mini');
    const ch = el('tr');
    for (const x of ['Year', 'Documented rent', 'Projected rent', 'Free rent', 'Recoveries', 'Net']) ch.appendChild(el('th', null, x));
    ct.appendChild(ch);
    for (const y of one.annual.slice(0, 10)) {
      const tr = el('tr');
      tr.appendChild(el('td', null, `${y.year} (${y.from.slice(0, 7)})`));
      tr.appendChild(el('td', null, money0(y.base)));
      tr.appendChild(el('td', null, money0(y.projected)));
      tr.appendChild(el('td', null, money0(-y.free)));
      tr.appendChild(el('td', null, money0(y.recoveries + y.pctRent)));
      tr.appendChild(el('td', null, money0(y.rent - y.free + y.recoveries + y.pctRent + y.oneTime)));
      ct.appendChild(tr);
    }
    const cw = el('div', 'scroll'); cw.appendChild(ct); body.appendChild(cw);
    body.scrollTop = keepScroll;
  }
  draw();
}

/** Documented periods, projected periods and free rent on one line across the years. */
function timeline(rr, L) {
  const roll = L.vacant ? { periods: [], abatements: [] } : rollover(L, { ...DEFAULT_SETTINGS, ...rr.settings, renewal: { ...DEFAULT_SETTINGS.renewal, ...(rr.settings.renewal || {}), ...(L.renewal || {}) } }, addMonths(rr.settings.asOf, 12 * (rr.settings.years || 10)));
  const all = [...(L.periods || []).map((p) => ({ ...p, kind: p.source === 'projected' ? 'projected' : 'documented' })), ...roll.periods.map((p) => ({ ...p, kind: 'projected' }))]
    .filter((p) => dayOf(p.start) !== null && dayOf(p.end) !== null);
  const abs = [...(L.abatements || []), ...roll.abatements].filter((a) => dayOf(a.start) !== null && dayOf(a.end) !== null);
  const wrap = el('div', 'timeline');
  if (!all.length) { wrap.appendChild(el('p', 'hint-sm', 'No dated rent periods yet.')); return wrap; }
  const lo = Math.min(...all.map((p) => dayOf(p.start)), dayOf(rr.settings.asOf));
  const hi = Math.max(...all.map((p) => dayOf(p.end)));
  const span = Math.max(1, hi - lo);
  const W = 640; const H = 74;
  const x = (d) => 6 + ((d - lo) / span) * (W - 12);
  const NS = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', `0 0 ${W} ${H}`);
  s.setAttribute('role', 'img');
  s.setAttribute('aria-label', `Lease timeline: ${all.length} rent periods from ${isoOf(lo)} to ${isoOf(hi)}`);
  const mk = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); s.appendChild(n); return n; };
  const maxMo = Math.max(...all.map((p) => monthlyAmount(p.rate, p.unit, L.sf) || 0), 1);
  for (const p of all) {
    const mo = monthlyAmount(p.rate, p.unit, L.sf) || 0;
    const h = 10 + (mo / maxMo) * 30;
    const r = mk('rect', { x: x(dayOf(p.start)), y: 48 - h, width: Math.max(1.5, x(dayOf(p.end) + 1) - x(dayOf(p.start)) - 1), height: h, rx: 2, class: `tl-${p.kind}` });
    const tt = document.createElementNS(NS, 'title');
    tt.textContent = `${p.start} to ${p.end}: ${money0(mo)} a month (${p.kind})`;
    r.appendChild(tt);
  }
  for (const a of abs) mk('rect', { x: x(dayOf(a.start)), y: 50, width: Math.max(1.5, x(dayOf(a.end) + 1) - x(dayOf(a.start))), height: 5, class: 'tl-free' });
  const asOf = dayOf(rr.settings.asOf);
  mk('line', { x1: x(asOf), x2: x(asOf), y1: 2, y2: 58, class: 'tl-now' });
  const y0 = new Date(lo * 86400000).getUTCFullYear(); const y1 = new Date(hi * 86400000).getUTCFullYear();
  const stepY = Math.max(1, Math.ceil((y1 - y0 + 1) / 8));
  for (let y = y0 + (y0 * 0 === 0 ? 1 : 0); y <= y1; y += stepY) {
    const d = Date.UTC(y, 0, 1) / 86400000;
    if (d < lo || d > hi) continue;
    mk('line', { x1: x(d), x2: x(d), y1: 56, y2: 60, class: 'tl-tick' });
    const t = mk('text', { x: x(d), y: 71, 'text-anchor': 'middle', class: 'tl-label' });
    t.textContent = String(y);
  }
  wrap.appendChild(s);
  const lg = el('div', 'tl-legend');
  lg.innerHTML = '<span><i class="k-doc"></i>documented</span><span><i class="k-proj"></i>projected</span><span><i class="k-free"></i>free rent</span><span><i class="k-now"></i>as of</span>';
  wrap.appendChild(lg);
  return wrap;
}
