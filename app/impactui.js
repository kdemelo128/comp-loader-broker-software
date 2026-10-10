/* impactui.js -- "What this affects": the dependency map (impact.js) for one
 * input on the open deal, as a sheet. It lists every figure, check,
 * scenario, export and document that moves with that input on this deal as
 * it stands, and, folded away, what could move in other circumstances. A
 * value can be tried without saving: each line then shows before → after.
 * For a figure, the same sheet says what it is worked out from. */

import { el, svg, toast, money0, money2, pct, times, yrs, int, dec, parseNum, parsePct, getFflate } from './kit.js';
import {
  affects, nodeOf, upstream, groupOf, valuesOf, withTrial, trialKind, sameValue, hasRentRoll, scenariosOf, downstream,
} from './impact.js';
import { projectionNow, projectionLater } from './projector.js';
import { listTemplates, currentBytes } from './library.js';
import { previewCells } from './template.js';

const ok = (x) => typeof x === 'number' && Number.isFinite(x);
const GROUPS = [['Figures', 'figures'], ['Checks and questions', 'checks'], ['Scenarios', 'scenarios'], ['Exports', 'exports'], ['Documents', 'documents']];
export const AFFECTS_ICON = '<circle cx="6" cy="6" r="2.2"/><circle cx="18" cy="12" r="2.2"/><circle cx="6" cy="18" r="2.2"/><path d="M8 6.8l7.8 4.2M8 17.2l7.8-4.2"/>';

/** A small button that opens the sheet: `label` names the input ("What changing NOI affects"). */
export function affectsButton(label, open) {
  const b = el('button', 'iconbtn affects-btn');
  b.type = 'button';
  b.innerHTML = svg(AFFECTS_ICON, 15);
  b.setAttribute('aria-label', label);
  b.title = label;
  b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); open(); });
  return b;
}

/* -------------------------------------------------------------- showing values */

function show(id, v) {
  const N = nodeOf(id);
  if (v === undefined) return '';
  if (v === null) return '—';
  if (id.startsWith('check.')) return v ? 'shown' : 'not shown';
  if (id.startsWith('scenario:')) return [ok(v.returns && v.returns.leveredIrr) ? `levered IRR ${pct(v.returns.leveredIrr, 1)}` : null, ok(v.m && v.m.dscr) ? `DSCR ${times(v.m.dscr)}` : null].filter(Boolean).join(' · ') || '—';
  if (id.startsWith('field.')) {
    const x = v.value;
    if (!ok(x)) return x === null || x === undefined ? '—' : String(x);
    return v.type === 'money' ? money0(x) : v.type === 'money2' ? money2(x) : v.type === 'pct' ? pct(x) : v.type === 'dec' ? dec(x, 2) : int(x);
  }
  if (id.startsWith('proj.')) return Array.isArray(v) && ok(v[0]) ? `${id === 'proj.occupancy' ? pct(v[0], 1) : money0(v[0])} in year 1` : '';
  if (id === 'fig.leases') return v && ok(v.occupancy) ? `occupancy ${pct(v.occupancy, 1)}${ok(v.walt) ? ` · WALT ${yrs(v.walt)}` : ''}` : '—';
  if (id === 'fig.maxLoan') return v ? `${money0(v.loan)} (${v.binding})` : '—';
  if (id === 'fig.ladder') return Array.isArray(v) && v.length ? `${v.length} cap rates` : '—';
  if (id === 'fig.derived') return Object.keys(v || {}).join(', ') || 'none';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'string') return v;
  if (!ok(v)) return Array.isArray(v) ? `${v.length} rows` : '';
  const u = N && N.unit;
  if (u === '$' || u === '$/yr') return money0(v);
  if (u === '$/SF' || u === '$/SF/yr' || u === '$/land SF') return money2(v);
  if (u === '$/unit') return money0(v);
  if (u === '%' || u === '% change') return pct(v);
  if (u === 'x') return times(v);
  if (u === 'years') return yrs(v);
  if (/Rent|rent|lossToLease$|marketRent/.test(id)) return money0(v);
  if (/occupancy|Pct$|share/.test(id)) return pct(v, 1);
  if (/walt/i.test(id)) return yrs(v);
  return int(v);
}

/* ------------------------------------------------------------------ the sheet */

/**
 * Open the sheet. `ids`: the inputs changed (map ids). opts: { title, leaseId,
 * figure (a map id: show what it is worked out from), comps, sheetOpen }.
 */
export async function openImpact(deal, ids, { title = '', heading = '', leaseId = null, figure = null, comps = null, sheetOpen, eyebrow = '' }) {
  const N0 = nodeOf(figure || ids[0]);
  const name = title || (N0 ? N0.label : ids[0]);
  const body = sheetOpen({
    eyebrow: eyebrow || deal.name || deal.figures.address || 'Deal',
    title: heading || (figure ? `${name}: how it’s worked out, and what it affects` : `What changing ${name.charAt(0).toLowerCase()}${name.slice(1)} affects`),
    sub: 'On this deal as it stands. Nothing here changes the deal.',
  });
  body.classList.add('impact');
  let templates = [];
  try { templates = (await listTemplates()).filter((t) => !t.archived); } catch { templates = []; }

  if (figure) body.appendChild(workedOutFrom(figure));

  const inputs = figure ? [figure] : ids;
  const a = affects(inputs, { deal, comps, templates });
  const cur = currentValues(deal, comps);

  const kind = ids.length === 1 && !figure ? trialKind(ids[0]) : null;
  let trialBox = null;
  if (kind && (!ids[0].startsWith('lease.') || leaseId)) {
    trialBox = el('form', 'impact-trial');
    trialBox.id = 'impact-trial-form';
    const lab = el('label', null, 'Try a value');
    const i = el('input', kind === 'date' ? null : 'n');
    i.id = 'impact-trial';
    lab.htmlFor = i.id;
    if (kind === 'date') i.type = 'date'; else i.inputMode = 'decimal';
    i.placeholder = kind === 'pct' ? 'e.g. 7.25' : kind === 'date' ? '' : 'a value';
    const go = el('button', 'btn btn-sm', 'Try');
    go.type = 'submit';
    go.id = 'impact-try';
    const note = el('span', 'hint-sm', 'before → after, not saved');
    trialBox.append(lab, i, go, note);
    trialBox.addEventListener('submit', async (e) => {
      e.preventDefault();
      const raw = i.value.trim();
      const v = kind === 'date' ? (raw || null) : kind === 'pct' ? parsePct(raw, { fraction: false }) : parseNum(raw);
      if (raw && v === null) { toast('That isn’t a value this field can take.'); return; }
      go.disabled = true;
      note.textContent = 'working it out…';
      try {
        const res = await tryValue(deal, ids[0], v, leaseId, comps);
        draw(res);
        note.textContent = `before → after, with ${raw || 'nothing'}: not saved`;
      } catch (err) {
        note.textContent = `couldn’t be worked out: ${err.message || err}`;
      } finally { go.disabled = false; }
    });
    body.appendChild(trialBox);
  }

  const out = el('div');
  out.id = 'impact-out';
  body.appendChild(out);

  function draw(trial = null) {
    out.textContent = '';
    const moved = trial ? trial.moved : null;
    const groups = { figures: [], checks: [], scenarios: [], exports: [], documents: [] };
    for (const id of a.now) {
      const g = groupOf(id);
      if (g === 'Figures') groups.figures.push(id);
      else if (g === 'Checks and questions') groups.checks.push(id);
      else if (g === 'Exports' && !id.startsWith('field.')) groups.exports.push(id);
      else if (g === 'Documents') groups.documents.push(id);
    }
    const total = groups.figures.length + groups.checks.length + a.scenarios.length + groups.exports.length + a.templates.length + groups.documents.length;
    if (!total) out.appendChild(el('p', 'hint', 'Nothing on this deal moves with it as the deal stands.'));
    for (const [label, key] of GROUPS) {
      const list = el('ul', 'list impact-list');
      list.id = `impact-${key}`;
      const item = (title, sub, cls = '') => {
        const li = el('li', `li${cls ? ` ${cls}` : ''}`);
        const main = el('div', 'li-main');
        main.appendChild(el('div', 'li-title', title));
        if (sub) main.appendChild(el('div', 'li-sub', sub));
        li.appendChild(main);
        list.appendChild(li);
        return li;
      };
      const val = (id) => {
        if (!trial) return show(id, cur.get(id));
        const b = trial.before.get(id); const f = trial.after.get(id);
        if (sameValue(b, f)) return `unchanged: ${show(id, b)}`;
        return `${show(id, b)} → ${show(id, f)}`;
      };
      const fileState = (id) => (trial ? (moved.has(id) ? 'changes' : 'unchanged') : '');
      if (key === 'figures') for (const id of groups.figures) item(nodeOf(id).label, val(id), trial && !moved.has(id) ? 'impact-same' : '');
      if (key === 'checks') for (const id of groups.checks) item(nodeOf(id).label, trial ? val(id) : (cur.get(id) ? 'shown now; may change' : 'not shown now; may appear'), trial && !moved.has(id) ? 'impact-same' : '');
      if (key === 'scenarios') for (const s of a.scenarios) item(s.name, val(`scenario:${s.id}`), trial && !moved.has(`scenario:${s.id}`) ? 'impact-same' : '');
      if (key === 'scenarios') {
        for (const s of scenariosOf(deal)) if (!a.scenarios.some((x) => x.id === s.id) && a.now.includes('scenario')) item(s.name, 'not affected: it sets its own value', 'impact-same');
      }
      if (key === 'exports') {
        const byFile = new Map();
        for (const id of groups.exports) { const N = nodeOf(id); const f = `${N.file}${N.sheet ? ` › ${N.sheet}` : ''}`; if (!byFile.has(f)) byFile.set(f, []); byFile.get(f).push(id); }
        for (const [f, xs] of byFile) item(f, xs.map((id) => `${nodeOf(id).label}${trial ? ` (${fileState(id)})` : ''}`).join(' · '));
        for (const t of a.templates) {
          const li = item(`${t.name} (firm template)`, t.cells.map((c) => `${c.sheet}!${c.cell}`).join(' · '));
          li.dataset.template = t.id;
          formulaCounts(t, templates.find((x) => x.id === t.id), li);
        }
      }
      if (key === 'documents') {
        const byFile = new Map();
        for (const id of groups.documents) { const N = nodeOf(id); if (!byFile.has(N.file)) byFile.set(N.file, []); byFile.get(N.file).push(id); }
        for (const [f, xs] of byFile) item(f, xs.map((id) => `${nodeOf(id).label}${trial ? ` (${fileState(id)})` : ''}`).join(' · '));
      }
      if (!list.children.length) continue;
      const h = el('h3', 'sec-label impact-head', `${label} `);
      h.appendChild(el('span', 'count', String(list.children.length)));
      out.append(h, list);
    }
    // what only could move: folded away, with the condition that leaves each out here
    const could = a.could.filter((c) => ['Figures', 'Checks and questions'].includes(groupOf(c.id)));
    const rest = a.could.length - could.length;
    if (could.length || rest) {
      const d = el('details', 'impact-could');
      d.id = 'impact-could';
      d.appendChild(el('summary', null, `Could also affect, in other circumstances (${could.length})`));
      const ul = el('ul', 'list impact-list');
      for (const c of could) {
        const li = el('li', 'li');
        const main = el('div', 'li-main');
        main.appendChild(el('div', 'li-title', nodeOf(c.id).label));
        main.appendChild(el('div', 'li-sub', c.why));
        li.appendChild(main);
        ul.appendChild(li);
      }
      d.appendChild(ul);
      if (rest) d.appendChild(el('p', 'hint-sm', `and ${rest} export${rest === 1 ? '' : 's'} or document part${rest === 1 ? '' : 's'} made from them.`));
      out.appendChild(d);
    }
  }
  draw();
}

/** The figure's direct inputs and, under them, the inputs a person types that it rests on. */
function workedOutFrom(id) {
  const N = nodeOf(id);
  const box = el('section', 'impact-from');
  box.id = 'impact-from';
  box.appendChild(el('h3', 'sec-label', 'Worked out from'));
  const ul = el('ul', 'list impact-list');
  for (const R of N.reads) {
    const S = nodeOf(R.path);
    const li = el('li', 'li');
    const main = el('div', 'li-main');
    main.appendChild(el('div', 'li-title', S ? S.label : R.path));
    if (R.when) main.appendChild(el('div', 'li-sub', R.when));
    li.appendChild(main);
    ul.appendChild(li);
  }
  box.appendChild(ul);
  const inputs = [...upstream(id)].map(nodeOf).filter((x) => x && x.group === 'input');
  if (inputs.length) box.appendChild(el('p', 'hint-sm', `Resting, in the end, on: ${inputs.map((x) => x.label).join(', ')}.`));
  return box;
}

/** Values now, without waiting for a projection the worker hasn't finished. */
function currentValues(deal, comps) {
  try {
    const { values } = valuesOf(deal, { comps, projectFn: hasRentRoll(deal) ? (rr, o) => projectionNow(rr, o || {}) || PENDING_PROJECTION : null });
    return values;
  } catch { return new Map(); }
}
const PENDING_PROJECTION = { annual: [], notes: [] };

/** Every projection a deal's values need (the default one, and each NOI-from-the-rent-roll scenario's), from the worker. */
async function projectionsFor(d) {
  if (!hasRentRoll(d)) return null;
  const years = new Set([undefined]);
  for (const s of scenariosOf(d)) if (s.over.noiBasis === 'rentroll') years.add(Math.max(2, Math.round(Number.isFinite(s.over.hold) ? s.over.hold : 5) + 1));
  const live = d.live || {};
  if (live.noiBasis === 'rentroll') years.add((Number.isFinite(live.hold) ? live.hold : 5) + 1);
  const got = new Map();
  await Promise.all([...years].map(async (y) => { got.set(y, await projectionLater(d.rr, y ? { years: y } : {})); }));
  return got;
}

/** Before and after a trial value, and what moved. */
async function tryValue(deal, id, v, leaseId, comps) {
  const after = withTrial(deal, id, v, leaseId);
  const [p0, p1] = await Promise.all([projectionsFor(deal), projectionsFor(after)]);
  const fn = (P) => (P ? (rr, o) => P.get(o && o.years ? o.years : undefined) || P.get(undefined) : null);
  const before = valuesOf(deal, { comps, projectFn: fn(p0) }).values;
  const afterV = valuesOf(after, { comps, projectFn: fn(p1) }).values;
  const changed = [...new Set([...before.keys(), ...afterV.keys()])].filter((k) => !sameValue(before.get(k), afterV.get(k)));
  // an export or document changes when something it is made of does
  const moved = new Set(changed);
  for (const k of downstream([id, ...changed.filter((x) => !x.startsWith('scenario:'))]).keys()) if (/^(xlsx|csv|brief|summary)/.test(k)) moved.add(k);
  if (changed.some((k) => k.startsWith('scenario:'))) for (const k of downstream(['scenario']).keys()) moved.add(k);
  return { before, after: afterV, moved };
}

/** How many of a template's own formulas read the cells it would fill, once the workbook has been read. */
async function formulaCounts(t, full, li) {
  if (!full) return;
  try {
    const fflate = await getFflate();
    const cells = t.cells.map((c) => ({ sheet: c.sheet, cell: c.cell, field: c.field }));
    const pv = previewCells(fflate, currentBytes(full), cells, {}, { DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer });
    const feeds = pv.reduce((s, x) => s + (x.feeds || 0), 0);
    if (li.isConnected) li.querySelector('.li-sub').textContent += ` · ${feeds} formula${feeds === 1 ? '' : 's'} in the workbook read${feeds === 1 ? 's' : ''} ${cells.length === 1 ? 'it' : 'them'}`;
  } catch { /* the count is extra; the cells are listed either way */ }
}
