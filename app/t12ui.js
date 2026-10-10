/* t12ui.js -- the T-12 on the deal screen: import an operating statement,
 * see it by category, the NOI three ways, every line with its category (and
 * change it), and "Use the T-12's figures". The statement itself is worked
 * out in t12.js; dealui.js keeps the deal, its history and its saves, and
 * hands this module what it needs (`h`). */

import { el, toast, actionSheet, money0, niceDate, getXlsx } from './kit.js';
import { readGrids, unreadable } from './sheetread.js';
import {
  CATEGORIES, CATEGORY, SIDES, bestSheet, statementTotals, openLines, openChecks, fileLine, periodText, rematch,
} from './t12.js';
import { corrections, rememberLabel } from './t12labels.js';
import { NOI_GAP } from './engine/conventions.js';

const ok = (x) => typeof x === 'number' && Number.isFinite(x);
const usd = (x) => (ok(x) ? (x < 0 ? `−${money0(-x)}` : money0(x)) : '—');

/**
 * Draw the card into `box`. h: { deal, touch(meta), snapshot(reason), redraw(), rerender() (the whole deal screen),
 * sheetOpen, openReview(), rrNoi1() → number | null | undefined (undefined: still being worked out) }.
 */
export function renderT12Card(box, h) {
  const d = h.deal;
  box.textContent = '';
  const head = el('div', 'card-head');
  head.appendChild(el('h2', null, 'Operating statement (T-12)'));
  box.appendChild(head);
  const t = d.t12;
  if (!t) {
    box.appendChild(el('p', 'hint', 'Import a trailing-12 operating statement (.xlsx or .csv). Each line goes in a standard category; lines it can’t place go to Review; its NOI is set beside the OM’s and the rent roll’s.'));
    box.appendChild(importButton(h, 'Import a T-12…', 'btn btn-primary'));
    return;
  }
  const T = statementTotals(t);
  const lines = openLines(t);
  const checks = openChecks(t);
  box.appendChild(el('p', 'sub', `${t.file || 'Statement'}${t.sheet && t.sheet !== 'CSV' ? ` · ${t.sheet}` : ''} · ${periodText(t)} · imported ${niceDate(t.importedAt)}`));
  if (lines.length || checks.length) {
    const p = el('p', 'warn-text t12-open');
    p.append(`${[lines.length ? `${lines.length} line${lines.length === 1 ? '' : 's'} to file` : '', checks.length ? `${checks.length} thing${checks.length === 1 ? '' : 's'} to check` : ''].filter(Boolean).join(' and ')}. `);
    const go = el('button', 'btn btn-sm btn-gray', 'Open Review');
    go.type = 'button';
    go.id = 't12-review';
    go.addEventListener('click', () => h.openReview());
    p.appendChild(go);
    box.appendChild(p);
  }

  // by category: income, operating expenses, NOI; below the line apart
  const tbl = el('table', 'mini t12-table');
  tbl.id = 't12-summary';
  const cap = el('caption', 'sr-only', 'The T-12 by category');
  tbl.appendChild(cap);
  const tb = el('tbody');
  const row = (label, v, cls = '') => { const tr = el('tr', cls); tr.append(el('th', null, label), el('td', 'num', usd(v))); tr.firstChild.setAttribute('scope', 'row'); tb.appendChild(tr); };
  for (const side of ['income', 'expense']) {
    for (const c of CATEGORIES.filter((x) => x.side === side)) if (T.by[c.id]) row(c.label, T.by[c.id]);
    row(side === 'income' ? 'Effective gross income' : 'Operating expenses', side === 'income' ? T.egi : T.opex, 'total');
  }
  row(T.unassigned ? 'NOI (lines still to file are left out)' : 'NOI', T.noi, 'total grand');
  const below = CATEGORIES.filter((c) => c.side === 'below' && T.by[c.id]);
  if (below.length) {
    const tr = el('tr', 'sep'); const th = el('th', null, SIDES.below); th.colSpan = 2; tr.appendChild(th); tb.appendChild(tr);
    for (const c of below) row(c.label, T.by[c.id], 'muted');
  }
  if (T.unassigned) row('Not yet filed', T.unassigned, 'warn-text');
  tbl.appendChild(tb);
  const wrap = el('div', 'scroll');
  wrap.appendChild(tbl);
  box.appendChild(wrap);

  box.appendChild(noiThreeWays(d, T, h));

  const acts = el('div', 'row-actions');
  const all = el('button', 'btn btn-sm btn-gray', 'Every line');
  all.type = 'button';
  all.id = 't12-lines';
  all.addEventListener('click', () => openLinesSheet(h));
  const use = el('button', 'btn btn-sm', d.t12.applied ? 'Use the T-12’s figures again' : 'Use the T-12’s figures');
  use.type = 'button';
  use.id = 't12-use';
  use.addEventListener('click', () => useFigures(h));
  const remove = el('button', 'btn btn-sm btn-gray', 'Remove');
  remove.type = 'button';
  remove.id = 't12-remove';
  remove.addEventListener('click', async () => {
    const v = await actionSheet('Remove the T-12 from this deal?', [{ label: 'Remove it', sub: 'Figures already taken from it stay as they are. You can undo this.', value: 'yes', danger: true }]);
    if (v !== 'yes') return;
    const snap = h.snapshot('Before removing the T-12');
    delete d.t12;
    h.touch({ kind: 'edit', label: 'T-12 removed', snapshot: snap });
    h.redraw();
  });
  acts.append(all, use, importButton(h, 'Replace…', 'btn btn-sm btn-gray'), remove);
  box.appendChild(acts);
}

/** The NOI three ways: the OM's, the T-12's and the rent roll's forward-looking year 1, with the gaps. */
function noiThreeWays(d, T, h) {
  const sec = el('div', 't12-noi');
  sec.appendChild(el('h3', 'sec-label', 'NOI three ways'));
  const om = d.t12.applied ? d.t12.applied.before.noi : d.figures.noi;
  const rr = h.rrNoi1();
  const partial = d.t12.months.length && d.t12.months.length < 12;
  const rows = [
    ['OM', 'as read or typed', om],
    ['T-12', partial ? `${periodText(d.t12)}: not a full year, so not compared` : periodText(d.t12), T.unassigned ? null : T.noi],
    ['Rent roll, forward-looking year 1', 'a projection, not an actual', rr],
  ];
  const tbl = el('table', 'mini t12-noi-table');
  tbl.id = 't12-noi';
  const cap = el('caption', 'sr-only', 'NOI three ways, and the gap from the T-12’s');
  tbl.appendChild(cap);
  const th = el('thead'); const hr = el('tr');
  for (const x of ['', 'NOI', 'Gap from the T-12’s']) { const c = el('th', null, x); c.setAttribute('scope', 'col'); if (!x) c.appendChild(el('span', 'sr-only', 'Source')); hr.appendChild(c); }
  th.appendChild(hr); tbl.appendChild(th);
  const tb = el('tbody');
  for (const [who, what, v] of rows) {
    const tr = el('tr');
    const name = el('th', null, who); name.setAttribute('scope', 'row');
    name.appendChild(el('div', 'sub', what));
    const val = el('td', 'num', v === undefined ? 'working out…' : usd(v));
    let g = '';
    let cls = '';
    if (who !== 'T-12' && ok(v) && ok(T.noi) && !T.unassigned && !partial) {
      const base = Math.max(Math.abs(v), Math.abs(T.noi));
      const pc = base ? (Math.abs(v - T.noi) / base) * 100 : 0;
      g = `${v >= T.noi ? '+' : '−'}${money0(Math.abs(v - T.noi))} (${pc.toFixed(1)}%)`;
      cls = pc > NOI_GAP.warn ? 'warn-text' : pc >= NOI_GAP.agree ? 'info-text' : 'good-text';
      g += pc < NOI_GAP.agree ? ' · agrees' : pc > NOI_GAP.warn ? ' · warning' : ' · noted';
    }
    tr.append(name, val, el('td', `num ${cls}`, g));
    tb.appendChild(tr);
  }
  tbl.appendChild(tb);
  const wrap = el('div', 'scroll');
  wrap.appendChild(tbl);
  sec.appendChild(wrap);
  sec.appendChild(el('p', 'hint', `Within ${NOI_GAP.agree}% they agree; ${NOI_GAP.agree}% to ${NOI_GAP.warn}% is noted; above ${NOI_GAP.warn}% is a warning in “What doesn’t add up”.`));
  return sec;
}

function importButton(h, label, cls) {
  const b = el('button', cls, label);
  b.type = 'button';
  b.id = h.deal.t12 ? 't12-replace' : 't12-import';
  b.addEventListener('click', () => {
    const inp = el('input');
    inp.type = 'file';
    inp.accept = '.xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    inp.id = 't12-file';
    inp.hidden = true;
    inp.addEventListener('change', () => { const f = inp.files[0]; inp.remove(); if (f) importFile(h, f); });
    document.body.appendChild(inp);
    inp.click();
  });
  return b;
}

/** Read a file as a T-12 and keep it on the deal: one history entry, a snapshot first when one is replaced. */
export async function importFile(h, file) {
  const d = h.deal;
  const no = unreadable(file, 'T-12');
  if (no) { toast(no, null, 8000); return; }
  let t;
  try {
    const grids = await readGrids(file, getXlsx, { maxRows: 1500 });
    t = bestSheet(grids, { file: file.name, corrections: await corrections() });
  } catch (e) { toast(e.message || String(e), null, 9000); return; }
  if (h.deal !== d) return; // another deal was opened meanwhile
  const snap = d.t12 ? h.snapshot('Before replacing the T-12') : null;
  d.t12 = t;
  const open = openLines(t).length;
  const n = t.lines.length;
  h.touch({ kind: 'import', label: `T-12 imported: ${n} line${n === 1 ? '' : 's'}${open ? `, ${open} to file` : ''}`, snapshot: snap });
  h.redraw();
  toast(`T-12 read: ${n} line${n === 1 ? '' : 's'}, ${periodText(t)}.${open ? ` ${open} line${open === 1 ? '' : 's'} to file in Review.` : ''}`, open ? { label: 'Review', run: () => h.openReview() } : null, 7000);
}

/** File a line (and the others with its label), remembering the label when asked. Shared with the Review Queue. */
export async function fileT12Line(d, lineId, category, { sameLabel = true, remember = true } = {}) {
  const line = d.t12.lines.find((l) => l.id === lineId);
  const changed = fileLine(d.t12, lineId, category, { sameLabel });
  if (remember && line) {
    await rememberLabel(line.key, category);
    // other lines of this statement still waiting take the remembered choice too
    d.t12 = rematch(d.t12, await corrections());
  }
  return { line, changed };
}

/** Every line, with its category: a choice per line. */
function openLinesSheet(h) {
  const d = h.deal;
  const body = h.sheetOpen({ eyebrow: 'T-12', title: 'Every line', sub: `${d.t12.lines.length} lines · ${periodText(d.t12)}. Change a category here; “Remember” files the same label the same way next time.` });
  const list = el('div', 't12-lines');
  for (const l of d.t12.lines) {
    const r = el('div', `t12-line${l.category ? '' : ' open'}`);
    const lab = el('div', 't12-line-label');
    lab.append(el('b', null, l.label), el('span', 'sub', ` ${usd(l.total)}${l.account ? ` · ${l.account}` : ''} · ${l.how === 'yours' ? 'your earlier choice' : l.how === 'you' ? 'chosen here' : l.how === 'rule' ? 'by its wording' : `to file: ${l.why}`}`));
    const sel = categorySelect(l);
    sel.setAttribute('aria-label', `Category for ${l.label}`);
    sel.addEventListener('change', async () => {
      if (!sel.value) return;
      const { changed } = await fileT12Line(d, l.id, sel.value, { sameLabel: true, remember: true });
      h.touch({ kind: 'edit', label: `T-12: “${l.label}” filed under ${CATEGORY[sel.value].label.toLowerCase()}${changed.length > 1 ? ` (and ${changed.length - 1} more with that label)` : ''}` });
      h.redraw();
      openLinesSheet(h);
    });
    r.append(lab, sel);
    list.appendChild(r);
  }
  body.appendChild(list);
}

/** A category picker, its likely categories first. */
export function categorySelect(l) {
  const sel = el('select', 'select');
  const none = el('option', null, l.category ? '' : 'Choose a category…');
  none.value = '';
  if (!l.category) sel.appendChild(none);
  const first = (l.candidates || []).filter((c) => CATEGORY[c] && c !== l.category);
  const add = (parent, c) => { const o = el('option', null, c.label); o.value = c.id; if (c.id === l.category) o.selected = true; parent.appendChild(o); };
  if (first.length && !l.category) {
    const g = el('optgroup'); g.label = 'Likely';
    for (const id of first) add(g, CATEGORY[id]);
    sel.appendChild(g);
  }
  for (const side of ['income', 'expense', 'below']) {
    const g = el('optgroup'); g.label = SIDES[side];
    for (const c of CATEGORIES.filter((x) => x.side === side)) add(g, c);
    sel.appendChild(g);
  }
  return sel;
}

/** "Use the T-12's figures": EGI, operating expenses, taxes and NOI onto the deal (and the rent roll's expenses, if asked), one undoable step. */
async function useFigures(h) {
  const d = h.deal;
  const t = d.t12;
  const T = statementTotals(t);
  if (T.unassigned) { toast(`File the ${openLines(t).length} line${openLines(t).length === 1 ? '' : 's'} still waiting in Review first: the totals aren’t complete.`, { label: 'Review', run: () => h.openReview() }, 7000); return; }
  const partial = t.months.length && t.months.length < 12;
  const sets = [['gross', 'Gross income (EGI)', T.egi], ['opex', 'Operating expenses', T.opex], ['taxes', 'Real estate taxes', T.taxes], ['noi', 'NOI, in place', T.noi]];
  const what = sets.map(([k, label, v]) => `${label}: ${usd(d.figures[k])} → ${usd(v)}`).join(' · ');
  /** @type {any[]} */
  const opts = [{ label: 'Use them', sub: `${what}.${partial ? ` These are ${t.months.length} months, not scaled up to a year.` : ''}`, value: 'deal', primary: true }];
  if (d.rr && d.rr.leases && d.rr.leases.length) opts.push({ label: 'Use them, and the rent roll’s operating expenses too', sub: `The rent roll’s operating expenses: ${usd(d.rr.settings.opex)} → ${usd(T.opex)}.`, value: 'both' });
  const v = await actionSheet('Use the T-12’s figures?', opts);
  if (!v) return;
  const snap = h.snapshot('Before using the T-12’s figures');
  const before = t.applied ? t.applied.before : { noi: d.figures.noi ?? null, gross: d.figures.gross ?? null, opex: d.figures.opex ?? null, taxes: d.figures.taxes ?? null };
  t.applied = { at: Date.now(), before, rrOpex: v === 'both' };
  const months = periodText(t);
  for (const [k, , val] of sets) {
    d.figures[k] = val;
    d.sources[k] = { t12: true, hand: false, file: t.file, line: `T-12, ${months}`, orig: val };
  }
  if (v === 'both') d.rr.settings.opex = T.opex;
  h.touch({ kind: 'import', label: `Used the T-12’s figures (EGI, expenses, taxes, NOI${v === 'both' ? ', and the rent roll’s expenses' : ''})`, snapshot: snap });
  h.rerender();
  toast('The T-12’s figures are in the deal. Undo puts the earlier ones back.');
}
