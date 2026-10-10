/* ui.js -- the app shell and the Comps screen.
 *
 * Everything runs in the browser: pdf.js reads the PDFs, costar.js parses them,
 * workbook.js writes the .xlsx, template.js fills a firm's own template. No
 * network call carries any of it anywhere.
 *
 * Comps state is kept as its sources, not its results: the text of every PDF
 * read, the changes made to each comp (keyed by the report and comp they came
 * from), and the comps typed in by hand. The comp set is rebuilt from those
 * whenever a report is added, so the parser's rules (duplicates, portfolios,
 * the fifteen-comp cut) always see the whole set, and no edit is ever lost to a
 * second drop.
 *
 * The Deal and Tools screens live in dealui.js and toolsui.js; this module
 * starts them and lends them the comp set. */

// first: moves settings kept under the old name before any module reads them
import { PRODUCT } from './brand.js';
import { pdfPages } from './pdftext.js';
import { loadComps, ppsf, mdy, MAX_COMPS } from './costar.js';
import { buildWorkbook, byPpsf } from './workbook.js';
import { zoningLookup, zoningInfo } from './zoning.js';
import { sampleSet } from './sample.js';
import * as store from './store.js';
import { renderKpis, renderRank, renderTime } from './glance.js';
import { VERSION, compsCsv, renderCompSheet, fullAddress } from './exporters.js';
import { compBasis } from './deal.js';
import {
  $, el, svg, IN_ARTIFACT, XLSX, parseNum, parsePct, int, dec, money2, pct, localDate, toast,
  openSheet, closeSheet, backdropCloses, actionSheet, getPdfjs, getXlsx, getFflate, idle,
  isIOS, isStandalone, canShareFiles, deliver, deliveryError, printed, copyText, pdfProblem,
} from './kit.js';
import { initDeal, dealForWorkbook, currentDealName, openTemplates } from './dealui.js';
import { initTools } from './toolsui.js';
import { initHome } from './home.js';
import { initSettings } from './settings.js';
import { initCommand } from './command.js';
import { initTheme } from './theme.js';

window.__zlaturaReady = true;

const state = {
  docs: [],          // [{ name, pages }] every report read, in the order added
  edits: {},         // comp key -> { field: value } changes to parsed comps
  manual: [],        // comps entered by hand, and the example set
  windowMonths: 0,   // sales older than this are set aside; 0 = keep all
  sales: [],
  market: [],
  report: null,
  busy: false,
  sort: { sale: 'ppsf', market: 'ppsf' },
  query: { sale: '', market: '' },
  output: 'builtin', // or 'template'
  template: null,    // { name, bytes, plan, savedAt }
};

const monthsAgo = (c) => (c.date ? (Date.now() - new Date(c.date).getTime()) / 86400000 / 30.44 : null);

/* ------------------------------------------------------------- the shell */

const VIEWS = ['home', 'comps', 'deal', 'tools', 'settings'];
let currentView = 'home';
function showView(name, { push = true } = {}) {
  if (!VIEWS.includes(name)) name = 'home';
  currentView = name;
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== name;
  document.querySelectorAll('.tab[data-view]').forEach((t) => {
    if (t.dataset.view === name) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
  $('view-name').textContent = $(`view-${name}`).dataset.title;
  document.title = `${$(`view-${name}`).dataset.title} · ${PRODUCT}`;
  // a sandboxed preview can refuse history changes; the tab still switches
  if (push && location.hash !== `#${name}`) { try { history.replaceState(null, '', `#${name}`); } catch { /* fine */ } }
  window.scrollTo({ top: 0 });
  document.dispatchEvent(new CustomEvent('viewchange', { detail: name }));
}
document.querySelectorAll('.tab[data-view]').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));
document.querySelectorAll('a.brand').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); showView('home'); }));
window.addEventListener('hashchange', () => showView(location.hash.slice(1), { push: false }));

/* --------------------------------------------------------------- the sheet */

const sheet = $('sheet');
backdropCloses(sheet);
$('sheet-close').addEventListener('click', () => closeSheet(sheet));
sheet.addEventListener('close', () => { $('sheet-body').textContent = ''; $('sheet-foot').textContent = ''; });

/** Fill the shared sheet and open it. Returns its body for the caller to fill. */
export function sheetOpen({ eyebrow = '', title = '', sub = '', foot = null }) {
  $('sheet-eyebrow').textContent = eyebrow;
  $('sheet-title').textContent = title;
  $('sheet-sub').textContent = sub;
  const body = $('sheet-body');
  body.textContent = '';
  const f = $('sheet-foot');
  f.textContent = '';
  f.hidden = !foot;
  if (foot) foot.forEach((b) => f.appendChild(b));
  openSheet(sheet);
  return body;
}
export const sheetClose = () => closeSheet(sheet);

/* ------------------------------------------------------------ the subject */

const SUBJECT_FIELDS = [
  ['address', 's-address', 'text'], ['city', 's-city', 'text'], ['state', 's-state', 'text'],
  ['ptype', 's-ptype', 'text'], ['bsf', 's-bsf', 'num'], ['lotSf', 's-lot', 'num'],
  ['zoning', 's-zoning', 'text'], ['year', 's-year', 'year'], ['noi', 's-noi', 'num'],
  ['price', 's-price', 'num'], ['preparedBy', 's-by', 'text'],
];

function readSubject() {
  const out = {};
  for (const [key, id, kind] of SUBJECT_FIELDS) {
    const raw = $(id).value.trim();
    out[key] = kind === 'text' ? (raw || null) : parseNum(raw);
  }
  if (out.year !== null && (out.year < 1600 || out.year > 2100)) out.year = null;
  return out;
}

function writeSubject(saved) {
  for (const [key, id, kind] of SUBJECT_FIELDS) {
    const v = saved ? saved[key] : null;
    $(id).value = v === null || v === undefined || v === '' ? '' : (kind === 'num' ? int(v) : String(v));
  }
  subjectSummary();
}

function subjectSummary() {
  const s = readSubject();
  const bits = [s.address, s.bsf ? `${int(s.bsf)} SF` : null, s.price ? `$${int(s.price)}` : null].filter(Boolean);
  $('subject-sum').textContent = bits.length ? bits.join(' · ') : 'optional · drives the value conclusions and pricing matrix';
}

/* The subject panel is a per-device convenience, so it lives in this browser
 * and nowhere else. Storage can be unavailable or throw; the page works either way. */
const SKEY = 'zlatura.subject.v1';
function saveSubject() {
  try { localStorage.setItem(SKEY, JSON.stringify(readSubject())); } catch { /* no storage */ }
}
function restoreSubject() {
  try { writeSubject(JSON.parse(localStorage.getItem(SKEY) || 'null')); } catch { /* nothing saved */ }
}

/** Called from the Deal screen: the OM's figures become the subject. */
function setSubjectFromDeal(f) {
  const cur = readSubject();
  writeSubject({
    address: f.address || null, city: f.city || null, state: f.state || null, ptype: f.ptype || null,
    bsf: f.bsf ?? null, lotSf: f.lot_sf ?? null, zoning: f.zoning || null, year: f.year ?? null,
    noi: f.noi ?? null, price: f.price ?? null, preparedBy: cur.preparedBy,
  });
  saveSubject();
  refreshGlance();
  $('subject-fold').open = true;
}

/* ------------------------------------------------------ building the set */

const included = (c) => !c.exclude && !outsideWindow(c);
function outsideWindow(c) {
  if (c.kind !== 'sale' || !state.windowMonths) return false;
  const m = monthsAgo(c);
  return m !== null && m > state.windowMonths;   // an undated sale can't be judged, so it stays
}

const FIELD_NAMES = {
  name: 'name', date: 'sale date', dom: 'days on market', price: 'price', bsf: 'building SF',
  cap: 'cap rate', occ: 'occupancy', zoning: 'zoning', lot_sf: 'lot SF',
};

/** Rebuild the comp set from its sources: every report, every edit, every hand-entered comp. */
function recompute() {
  const loaded = state.docs.length
    ? loadComps(state.docs, { zoningCodes: zoningLookup, cap: false })
    : { sales: [], market: [], report: { excluded: [], notes: [], parse: [] } };
  const parsed = [...loaded.sales, ...loaded.market];
  const seen = {};
  for (const c of parsed) {
    // a key names the report and the comp; a repeated name gets a counter
    const base = `${c.source}::${c.name}`;
    seen[base] = (seen[base] || 0) + 1;
    c.key = seen[base] > 1 ? `${base}#${seen[base]}` : base;
    c.origKind = c.kind;
    c.exclude = !!c.cut;                      // past the fifteenth, set aside but kept
    c.edited = new Set();
    const e = state.edits[c.key];
    if (!e) continue;
    for (const [field, value] of Object.entries(e)) {
      if (field === 'exclude') { c.exclude = !!value; continue; }
      if (field === 'kind') { c.kind = value; continue; }
      c[field] = field === 'date' ? (value ? new Date(value) : null) : value;
      c.edited.add(field);
    }
  }
  const all = [...parsed, ...state.manual];
  state.sales = all.filter((c) => c.kind === 'sale').sort(byPpsf);
  state.market = all.filter((c) => c.kind === 'market').sort(byPpsf);
  state.report = loaded.report;
}

/** Record a change to one comp, so a rebuild reapplies it. */
function setField(c, field, value) {
  c[field] = value;
  if (c.manual) return;
  const e = (state.edits[c.key] ||= {});
  e[field] = field === 'date' ? (value ? new Date(value).toISOString() : null) : value;
  if (!['exclude', 'kind'].includes(field)) c.edited.add(field);
}

/** The comp as the workbook should see it: its own flags plus a note of every hand change.
 *  Flags that depend on a value the reviewer can change (zoning, an undisclosed
 *  price) are worked out again from the current value, so a fix clears its flag. */
function exportComp(c) {
  const flags = (c.flags || []).filter((f) => !/^zoning .*Zoning Catalogue/.test(f)
    && !f.startsWith('asking price not disclosed') && !f.startsWith('max FAR '));
  let maxFar = null;
  if (c.zoning) {
    const info = zoningInfo(c.zoning);
    if (!info) flags.push(`zoning ${c.zoning} is not in the Zoning Catalogue -> FAR/buildable SF left blank`);
    else if (info.far === null) flags.push(`zoning ${c.zoning} has no max FAR in the Zoning Catalogue -> buildable SF blank`);
    else {
      maxFar = info.far;
      if (info.source === 'moco') flags.push(`max FAR ${info.far} read from the Montgomery County zone name ${c.zoning}`);
    }
  }
  if (c.kind === 'market' && !c.price) flags.push('asking price not disclosed (kept; excluded from Survey Average)');
  if (c.origKind && c.kind !== c.origKind) {
    flags.push(`moved by hand from ${c.origKind === 'sale' ? 'Sales' : 'On Market'} to ${c.kind === 'sale' ? 'Sales' : 'On Market'}`);
  }
  if (c.edited && c.edited.size) {
    flags.push(`edited by hand in the loader: ${[...c.edited].map((f) => FIELD_NAMES[f] || f).join(', ')}`);
  }
  return { ...c, flags, max_far: maxFar };
}

/* --------------------------------------------------------------- the grid */

const SALE_HEAD = [
  ['', ''], ['Comp', ''], ['Sale date', ''], ['Price', 'r'], ['Building SF', 'r'],
  ['$/SF', 'r'], ['Cap %', 'r'], ['Occ %', 'r'], ['Zoning', ''], ['Lot SF', 'r'], ['', 'r'],
];
const MKT_HEAD = [
  ['', ''], ['Comp', ''], ['Days on mkt', 'r'], ['Asking', 'r'], ['Building SF', 'r'],
  ['$/SF', 'r'], ['Cap %', 'r'], ['Occ %', 'r'], ['Zoning', ''], ['Lot SF', 'r'], ['', 'r'],
];

const ICON_MOVE = svg('<path d="M7 7h11l-3-3M17 17H6l3 3"/>', 17);
const ICON_INFO = svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>', 17);
const ICON_DEL = svg('<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>', 17);

function textInput(c, field, label, onEdit) {
  const i = el('input');
  i.value = c[field] || '';
  i.setAttribute('aria-label', label);
  i.addEventListener('change', () => {
    const v = i.value.trim();
    if (field === 'name' && !v) { i.value = c.name; return; }
    setField(c, field, v || null);
    if (field === 'name' && c.manual) c.address = v;
    onEdit();
  });
  return i;
}

function numInput(c, field, kind, label, onEdit) {
  const i = el('input', 'n');
  i.inputMode = 'decimal';
  i.autocomplete = 'off';
  const show = (v) => (kind === 'int' ? int(v) : dec(v));
  i.value = show(c[field]);
  i.setAttribute('aria-label', label);
  i.addEventListener('change', () => {
    let v = kind === 'pct' ? parsePct(i.value) : parseNum(i.value);
    if (v !== null && v < 0) v = null;
    setField(c, field, v);
    i.value = show(v);
    onEdit();
  });
  return i;
}

function chips(c) {
  const box = el('span', 'chips');
  if (c.example) box.appendChild(el('span', 'chip chip-plain', 'example'));
  else if (c.manual) box.appendChild(el('span', 'chip chip-plain', 'by hand'));
  if (c.cut && c.exclude) {
    const ch = el('span', 'chip chip-plain', `past ${MAX_COMPS}`);
    ch.title = `${c.cut}. Tick the box to include it; the workbook grows to fit.`;
    box.appendChild(ch);
  }
  if (outsideWindow(c)) box.appendChild(el('span', 'chip chip-plain', 'outside window'));
  // an owner-user sale often carries a premium an investor would not pay
  if (c.sale_type === 'Owner User') {
    const ch = el('span', 'chip chip-good', c.kind === 'sale' ? 'owner-user' : 'to owner-user');
    ch.title = c.kind === 'sale'
      ? 'CoStar records this as an owner-user sale: the buyer occupies it, which can lift the price above an investment sale.'
      : 'Marketed to owner-users.';
    box.appendChild(ch);
  }
  const flags = exportComp(c).flags;
  if (flags.length) {
    const b = el('button', 'chip chip-warn', `${flags.length} flag${flags.length > 1 ? 's' : ''}`);
    b.type = 'button';
    b.title = flags.join('\n\n');
    b.setAttribute('aria-label', `${flags.length} flags on ${c.name}. Show them`);
    b.addEventListener('click', () => openDetail(c));
    box.appendChild(b);
  }
  return box;
}

function fieldCell(cls, labelText, node) {
  const td = el('td', `f ${cls || ''}`.trim());
  td.dataset.label = labelText;
  td.appendChild(node);
  return td;
}

function row(c, kind) {
  const tr = el('tr');
  tr.dataset.key = c.key;
  const ppsfCell = el('span', 'calc', money2(ppsf(c)));
  const actCell = el('td', 'act');

  // an edit changes this row's figures and the totals, nothing else: no
  // re-render, so focus stays where the keyboard put it
  const onEdit = () => {
    ppsfCell.textContent = money2(ppsf(c));
    tr.classList.toggle('off', !included(c));
    actCell.replaceChildren(chips(c), actions(c, kind));
    afterEdit(kind);
  };

  if (!included(c)) tr.classList.add('off');
  const tdTog = el('td', 'tg');
  const tog = el('input', 'tog');
  tog.type = 'checkbox';
  tog.checked = !c.exclude;
  tog.setAttribute('aria-label', `Include ${c.name} in the workbook`);
  tog.addEventListener('change', () => { setField(c, 'exclude', !tog.checked); onEdit(); });
  tdTog.appendChild(tog);
  tr.appendChild(tdTog);

  const tdName = el('td', 'name-cell');
  tdName.appendChild(textInput(c, 'name', 'Property name', onEdit));
  tdName.appendChild(el('div', 'sub', [c.city, c.state].filter(Boolean).join(', ') || c.source || ''));
  tr.appendChild(tdName);

  if (kind === 'sale') {
    const d = el('input');
    d.type = 'date';
    d.value = c.date ? new Date(c.date).toISOString().slice(0, 10) : '';
    d.setAttribute('aria-label', 'Sale date');
    d.addEventListener('change', () => {
      setField(c, 'date', d.value ? new Date(`${d.value}T00:00:00Z`) : null);
      onEdit();
    });
    tr.appendChild(fieldCell('', 'Sold', d));
  } else {
    tr.appendChild(fieldCell('r', 'Days on market', numInput(c, 'dom', 'int', 'Days on market', onEdit)));
  }
  tr.appendChild(fieldCell('r', kind === 'sale' ? 'Price' : 'Asking', numInput(c, 'price', 'int', kind === 'sale' ? 'Sale price' : 'Asking price', onEdit)));
  tr.appendChild(fieldCell('r', 'Building SF', numInput(c, 'bsf', 'int', 'Building SF', onEdit)));
  const tdP = el('td', 'r ppsf');
  tdP.appendChild(ppsfCell);
  tr.appendChild(tdP);
  tr.appendChild(fieldCell('r', 'Cap %', numInput(c, 'cap', 'pct', 'Cap rate, percent', onEdit)));
  tr.appendChild(fieldCell('r', 'Occ %', numInput(c, 'occ', 'pct', 'Occupancy, percent', onEdit)));
  tr.appendChild(fieldCell('', 'Zoning', textInput(c, 'zoning', 'Zoning', onEdit)));
  tr.appendChild(fieldCell('r', 'Lot SF', numInput(c, 'lot_sf', 'int', 'Lot SF', onEdit)));

  actCell.append(chips(c), actions(c, kind));
  tr.appendChild(actCell);
  return tr;
}

function actions(c, kind) {
  const box = el('span');
  const btn = (icon, title, fn) => {
    const b = el('button', 'iconbtn');
    b.type = 'button';
    b.innerHTML = icon;
    b.title = title;
    b.setAttribute('aria-label', `${title}: ${c.name}`);
    b.addEventListener('click', fn);
    box.appendChild(b);
  };
  btn(ICON_INFO, 'Everything on this comp', () => openDetail(c));
  btn(ICON_MOVE, `Move to ${kind === 'sale' ? 'On Market' : 'Sales'}`, () => moveComp(c));
  if (c.manual) btn(ICON_DEL, 'Remove this comp', () => removeManual(c));
  return box;
}

function footer(comps, kind) {
  const live = comps.filter(included);
  const priced = live.filter((c) => c.price && c.bsf);
  const totalP = priced.reduce((s, c) => s + c.price, 0);
  const totalSf = priced.reduce((s, c) => s + c.bsf, 0);
  const vals = priced.map((c) => c.price / c.bsf).sort((a, b) => a - b);
  const med = vals.length
    ? (vals.length % 2 ? vals[(vals.length - 1) / 2] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2)
    : null;
  // cap rate weighted by price, as the workbook weights it
  const capd = live.filter((c) => typeof c.cap === 'number' && c.price);
  const capW = capd.reduce((s, c) => s + c.price, 0);
  const cap = capW ? capd.reduce((s, c) => s + c.cap * c.price, 0) / capW : null;

  const tf = el('tfoot');
  const tr = el('tr');
  const td = (cls, text, lab) => {
    const x = el('td', cls, text);
    if (lab) x.dataset.label = lab;
    tr.appendChild(x);
  };
  td(null, '');
  td('lbl', `Weighted · ${priced.length} priced of ${live.length}`);
  td(kind === 'sale' ? '' : 'r', '');
  td('r', totalP ? `$${int(totalP)}` : '', 'Total');
  td('r', totalSf ? int(totalSf) : '', 'SF');
  td('r', totalSf ? money2(totalP / totalSf) : '', '$/SF');
  td('r', cap !== null ? pct(cap) : '', 'Cap');
  td(null, '');
  td('lbl', med ? `median ${money2(med)}` : '');
  td(null, '');
  td(null, '');
  tf.appendChild(tr);
  return tf;
}

const SORTS = {
  ppsf: byPpsf,
  date: (a, b) => (b.date ? new Date(b.date).getTime() : -Infinity) - (a.date ? new Date(a.date).getTime() : -Infinity),
  dom: (a, b) => (a.dom ?? Infinity) - (b.dom ?? Infinity),
  price: (a, b) => (b.price ?? -1) - (a.price ?? -1),
  bsf: (a, b) => (b.bsf ?? -1) - (a.bsf ?? -1),
  cap: (a, b) => (b.cap ?? -1) - (a.cap ?? -1),
  name: (a, b) => String(a.name).localeCompare(String(b.name)),
};
const matches = (c, q) => !q || [c.name, c.address, c.city, c.state, c.zoning, c.submarket, c.buyer, c.seller, c.ptype]
  .some((x) => x && String(x).toLowerCase().includes(q));

function renderTable(kind) {
  const all = kind === 'sale' ? state.sales : state.market;
  const comps = [...all].sort(SORTS[state.sort[kind]] || byPpsf);
  const q = state.query[kind].trim().toLowerCase();
  const shown = comps.filter((c) => matches(c, q));
  const table = $(kind === 'sale' ? 'sales-table' : 'market-table');
  table.textContent = '';
  const thead = el('thead');
  const htr = el('tr');
  for (const [t, cls] of kind === 'sale' ? SALE_HEAD : MKT_HEAD) {
    const th = el('th', cls, t);
    if (!t) th.setAttribute('aria-label', 'controls');
    htr.appendChild(th);
  }
  thead.appendChild(htr);
  table.appendChild(thead);
  const tbody = el('tbody');
  for (const c of shown) tbody.appendChild(row(c, kind));
  if (!shown.length && q) {
    const tr = el('tr');
    const td = el('td', 'no-match', `No ${kind === 'sale' ? 'sales' : 'listings'} match “${state.query[kind].trim()}”.`);
    td.colSpan = 11;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  table.appendChild(footer(all, kind));
}

function refreshFooter(kind) {
  const table = $(kind === 'sale' ? 'sales-table' : 'market-table');
  const old = table.querySelector('tfoot');
  if (old) old.replaceWith(footer(kind === 'sale' ? state.sales : state.market, kind));
}

function refreshCounts() {
  const count = (list) => {
    const n = list.filter(included).length;
    const aside = list.length - n;
    return `${n} included${aside ? ` · ${aside} set aside` : ''}`;
  };
  $('sales-count').textContent = count(state.sales);
  $('market-count').textContent = count(state.market);
  const total = state.sales.length + state.market.length;
  const n = state.sales.filter(included).length + state.market.filter(included).length;
  const tplReady = state.output !== 'template' || !!state.template;
  $('download').disabled = !n || state.busy || !tplReady;
  $('glance-count').textContent = n ? `${n} comp${n === 1 ? '' : 's'} in the workbook` : '';
  // the big drop target gives way to a slim bar once there is a comp set
  const has = total > 0 || state.docs.length > 0;
  $('drop').hidden = has;
  $('addbar').hidden = !has;
  $('addbar-text').textContent = has
    ? `${state.docs.length ? `${state.docs.length} report${state.docs.length === 1 ? '' : 's'} read` : 'Example and hand-entered comps'} · ${state.sales.length} sales · ${state.market.length} listings`
    : '';
}

function refreshGlance() {
  const sales = state.sales.filter(included);
  const market = state.market.filter(included);
  $('glance-sec').hidden = !(sales.length || market.length);
  if ($('glance-sec').hidden) return;
  renderKpis($('kpis'), sales, market, readSubject());
  renderRank($('rank-chart'), $('rank-legend'), sales, market);
  renderTime($('time-chart'), $('time-legend'), sales);
}

function refreshNotes() {
  const flags = [];
  for (const c of [...state.sales, ...state.market]) for (const f of exportComp(c).flags) flags.push([c.name, f]);
  const list = $('flags-list');
  list.textContent = '';
  for (const [name, text] of flags) {
    const li = el('li');
    li.appendChild(el('b', null, `${name}: `));
    li.appendChild(document.createTextNode(text));
    list.appendChild(li);
  }
  const parse = state.report?.parse || [];
  for (const text of parse) {
    const li = el('li');
    li.appendChild(el('b', null, 'Could not read: '));
    li.appendChild(document.createTextNode(text));
    list.appendChild(li);
  }
  $('flags-n').textContent = flags.length + parse.length ? `${flags.length + parse.length}` : 'none';
  const ex = state.report?.excluded || [];
  const exl = $('excl-list');
  exl.textContent = '';
  for (const text of ex) exl.appendChild(el('li', null, text));
  $('excl-n').textContent = ex.length ? `${ex.length}` : 'none';
  $('notes-sec').hidden = !(flags.length || parse.length || ex.length);
}

function renderAll() {
  $('sales-sec').hidden = !state.sales.length;
  $('market-sec').hidden = !state.market.length;
  renderTable('sale');
  renderTable('market');
  $('sales-window').value = String(state.windowMonths);
  refreshNotes();
  refreshGlance();
  refreshCounts();
  document.dispatchEvent(new CustomEvent('compschange'));
}

let glanceTimer = null;
function afterEdit(kind) {
  refreshFooter(kind);
  refreshCounts();
  clearTimeout(glanceTimer);
  glanceTimer = setTimeout(() => { refreshGlance(); refreshNotes(); document.dispatchEvent(new CustomEvent('compschange')); }, 250);
  scheduleSave();
}

/* --------------------------------------------------------- set operations */

function moveComp(c) {
  const from = c.kind;
  const to = from === 'sale' ? 'market' : 'sale';
  setField(c, 'kind', to);
  const all = [...state.sales, ...state.market];
  state.sales = all.filter((x) => x.kind === 'sale');
  state.market = all.filter((x) => x.kind === 'market');
  renderAll();
  scheduleSave();
  toast(`${c.name} moved to ${to === 'sale' ? 'Sales' : 'On Market'}.`, { label: 'Undo', run: () => moveComp(c) });
}

/** Include every comp, or set every one aside: a tap rather than fifteen. */
function bulkToggle(kind) {
  const list = kind === 'sale' ? state.sales : state.market;
  const q = state.query[kind].trim().toLowerCase();
  const target = list.filter((c) => matches(c, q));
  const allIn = target.every((c) => !c.exclude);
  const snap = snapshot();
  for (const c of target) setField(c, 'exclude', allIn);
  renderAll();
  scheduleSave();
  toast(allIn ? `${target.length} set aside.` : `${target.length} included.`, { label: 'Undo', run: () => restoreSnapshot(snap) });
}

let manualSeq = 0;
function addManual(kind) {
  manualSeq += 1;
  const id = `${Date.now().toString(36)}${manualSeq}`;
  const c = {
    key: `manual::${id}`, manual: true, kind, origKind: kind, edited: new Set(),
    name: kind === 'sale' ? 'New sale comp' : 'New listing', address: '', city: null, state: null, zip: null,
    submarket: null, zoning: null, date: null, dom: null, price: null, bsf: null, cap: null, occ: null,
    lot_sf: null, lot_ac: null, far: null, year: null, bclass: null, ptype: null, comp_id: null,
    buyer_broker: null, listing_broker: null, notes: null, costar_notes: null, costar_ppsf: null,
    partial: false, occ_basis: 'explicit', parcels: new Set(), portfolio: 0,
    source: 'entered by hand', flags: ['entered by hand -- not from a CoStar report'], exclude: false,
  };
  state.manual.push(c);
  (kind === 'sale' ? state.sales : state.market).push(c);
  state.query[kind] = '';
  $(kind === 'sale' ? 'sale-search' : 'market-search').value = '';
  renderAll();
  scheduleSave();
  const input = document.querySelector(`tr[data-key="${CSS.escape(c.key)}"] .name-cell input`);
  if (input) { input.focus(); input.select(); }
}

function removeManual(c) {
  const snap = snapshot();
  state.manual = state.manual.filter((x) => x !== c);
  state.sales = state.sales.filter((x) => x !== c);
  state.market = state.market.filter((x) => x !== c);
  renderAll();
  scheduleSave();
  toast(`${c.name} removed.`, { label: 'Undo', run: () => restoreSnapshot(snap) });
}

function snapshot() {
  return {
    docs: state.docs.slice(),
    edits: JSON.parse(JSON.stringify(state.edits)),
    manual: state.manual.map(store.compToJSON),
    windowMonths: state.windowMonths,
    subject: readSubject(),
  };
}
function restoreSnapshot(s) {
  state.docs = s.docs;
  state.edits = s.edits;
  state.manual = s.manual.map((o) => ({ ...store.compFromJSON(o), edited: new Set() }));
  state.windowMonths = s.windowMonths;
  if (s.subject) { writeSubject(s.subject); saveSubject(); }
  recompute();
  renderAll();
  scheduleSave();
}

/* ------------------------------------------------------------- the import */

function queueItem(name) {
  const li = el('li');
  const icon = el('span', 'chev');
  icon.innerHTML = svg('<path d="M14 3H7a2.5 2.5 0 0 0-2.5 2.5v13A2.5 2.5 0 0 0 7 21h10a2.5 2.5 0 0 0 2.5-2.5V8.5z"/><path d="M14 3v5.5h5.5"/>', 16);
  li.appendChild(icon);
  li.appendChild(el('span', 'name', name));
  const st = el('span', 'state', 'waiting…');
  li.appendChild(st);
  $('queue').appendChild(li);
  $('queue-card').hidden = false;
  return st;
}

async function handleFiles(fileList) {
  const files = [...fileList];
  const projects = files.filter((f) => /\.json$/i.test(f.name) || f.type === 'application/json');
  const pdfs = files.filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
  touched = true;
  if (projects.length) { await openProject(projects[0]); if (!pdfs.length) return; }
  if (!pdfs.length) {
    toast('Those are not PDFs. Export the comp report from CoStar as a PDF.');
    return;
  }
  if (state.busy) { toast('Still reading the last batch. Add these when it finishes.'); return; }
  state.busy = true;
  refreshCounts();

  // the example set gives way to real reports
  if (state.manual.some((c) => c.example)) state.manual = state.manual.filter((c) => !c.example);

  let pdfjs;
  try {
    pdfjs = await getPdfjs();
  } catch (err) {
    state.busy = false;
    refreshCounts();
    toast(/too old/.test(err.message) ? `The PDF reader can't run here: ${err.message}.`
      : `The PDF reader could not start: ${err.message}. Reload the page and try again.`);
    return;
  }

  // all files are read off disk at once, and parsed two at a time: pdf.js
  // has one worker, so more than two in flight only queues inside it
  const items = pdfs.map((file) => ({ file, st: queueItem(file.name) }));
  let added = 0;
  const failed = [];
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      const { file, st } = items[i];
      st.textContent = 'reading…';
      try {
        const pages = await pdfPages(pdfjs, new Uint8Array(await file.arrayBuffer()), {
          onPage: (k, n) => { if (n > 3) st.textContent = `page ${k} of ${n}`; },
        });
        results[i] = { name: file.name, pages };
        st.textContent = `${pages.length} page${pages.length === 1 ? '' : 's'}`;
        st.classList.add('ok');
      } catch (err) {
        const pw = err && err.name === 'PasswordException';
        st.textContent = pw ? 'password protected' : 'could not be read';
        st.classList.add('err');
        st.title = pdfProblem(err, file);
        failed.push(`${file.name} can’t be read: ${pdfProblem(err, file)}`);
      }
    }
  };
  await Promise.all([worker(), worker()]);
  // added in the order dropped, whatever order they finished in
  for (const r of results) {
    if (!r) continue;
    // the same file dropped twice replaces itself rather than doubling up
    state.docs = state.docs.filter((d) => d.name !== r.name);
    state.docs.push(r);
    added += 1;
  }

  if (added) {
    const before = state.sales.length + state.market.length;
    try {
      recompute();
      renderAll();
      const now = state.sales.length + state.market.length;
      const n = now - before;
      if (now) {
        toast(n > 0 ? `${n} comp${n === 1 ? '' : 's'} added. ${state.sales.length} sales and ${state.market.length} listings in the set.`
          : 'Those reports added no new comps: they were already in the set.');
        $('glance-sec').scrollIntoView({ behavior: 'smooth', block: 'start' });
        idle(() => getXlsx().catch(() => {}));      // the Excel button will be next
      } else {
        toast('No CoStar comp pages were recognized in those files. An offering memorandum goes on the Deal tab.',
          { label: 'Deal tab', run: () => showView('deal') });
      }
      store.askToPersist();
    } catch (err) {
      toast(`Those files could not be parsed: ${err.message}`);
    }
  }
  if (failed.length && !added) toast(failed.length === 1 ? failed[0] : `None of the ${failed.length} files could be read. ${failed[0]}`, null, 9000);
  else if (failed.length) toast(`${added} report${added === 1 ? '' : 's'} read; ${failed.length} not: ${failed[0]}`, null, 9000);
  setTimeout(() => {
    if (state.busy) return;
    $('queue').textContent = '';
    $('queue-card').hidden = true;
  }, 6000);
  state.busy = false;
  refreshCounts();
  scheduleSave();
}

/* ------------------------------------------------------------ saving work */

let saveTimer = null;
let savePending = false;
let changedAt = 0;
/* The report text can run to megabytes and lives in IndexedDB only; the edits,
 * hand-entered comps and window are small, and are also mirrored to
 * localStorage synchronously, because a page torn down mid-save (a reload, a
 * phone closing the app) abandons an IndexedDB write still in flight. */
const REC_KEY = 'zlatura.session.unsaved';
function scheduleSave() {
  touched = true;
  savePending = true;
  changedAt = Date.now();
  try {
    localStorage.setItem(REC_KEY, JSON.stringify({
      savedAt: changedAt, docNames: state.docs.map((d) => d.name), edits: state.edits,
      manual: state.manual.map(store.compToJSON), windowMonths: state.windowMonths,
    }));
  } catch { /* full or blocked: IndexedDB still gets it */ }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSession, 400);
}
function flushSession() {
  clearTimeout(saveTimer);
  if (!savePending) return;
  savePending = false;
  const at = changedAt;
  store.saveSession({
    version: store.VERSION,
    savedAt: at,
    docs: state.docs,
    edits: state.edits,
    manual: state.manual.map(store.compToJSON),
    windowMonths: state.windowMonths,
  }).then((ok) => {
    if (!ok) return;
    try {
      const r = JSON.parse(localStorage.getItem(REC_KEY) || 'null');
      if (r && r.savedAt <= at) localStorage.removeItem(REC_KEY);
    } catch { /* fine */ }
  });
}
// leaving the app (switching away on a phone, closing the tab) writes the last change now
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSession(); });
window.addEventListener('pagehide', flushSession);

let touched = false;     // set by any change made before the saved session comes back

async function restoreSession() {
  let s = await store.loadSession();
  // replay edits that never reached IndexedDB, when they belong to the same reports
  try {
    const r = JSON.parse(localStorage.getItem(REC_KEY) || 'null');
    const names = (x) => JSON.stringify((x || []).map((d) => d.name));
    if (r && (!s || (r.savedAt || 0) > (s.savedAt || 0)) && JSON.stringify(r.docNames || []) === names(s && s.docs)) {
      s = { ...(s || { docs: [] }), edits: r.edits || {}, manual: r.manual || [], windowMonths: r.windowMonths, savedAt: r.savedAt };
      store.saveSession(s);
    }
  } catch { /* nothing to replay */ }
  if (!s || (!(s.docs || []).length && !(s.manual || []).length)) return;
  // reading storage is asynchronous: if a report was dropped or the example
  // loaded in the meantime, that work wins and the old session is left alone
  if (touched || state.docs.length || state.manual.length) return;
  state.docs = s.docs || [];
  state.edits = s.edits || {};
  state.manual = (s.manual || []).map((o) => ({ ...store.compFromJSON(o), edited: new Set() }));
  state.windowMonths = Number(s.windowMonths) || 0;
  recompute();
  renderAll();
  const n = state.sales.length + state.market.length;
  if (n) toast(`Picked up where you left off: ${n} comp${n === 1 ? '' : 's'}.`);
}

function projectName() {
  const safe = setLabel().replace(/[^\w\s-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Comp set';
  return `Comps - ${safe} (${localDate()})`;
}

async function saveProject() {
  const body = JSON.stringify({
    format: store.FORMAT,
    version: store.VERSION,
    savedAt: new Date().toISOString(),
    docs: state.docs,
    edits: state.edits,
    manual: state.manual.map(store.compToJSON),
    subject: readSubject(),
    windowMonths: state.windowMonths,
  });
  try {
    const done = await deliver(`${projectName()}.json`, new TextEncoder().encode(body), 'application/json');
    // the project holds the text of every report, which is licensed CoStar material
    if (done === 'done') toast('Project saved. It contains the text of your CoStar reports, so share it only with people covered by your CoStar licence.');
  } catch (err) {
    deliveryError(err);
  }
}

async function openProject(file) {
  let p;
  try {
    p = store.readProject(JSON.parse(await file.text()));
  } catch (err) {
    toast(err instanceof SyntaxError ? `That file is not a ${PRODUCT} project.` : err.message);
    return;
  }
  const snap = snapshot();
  state.docs = p.docs;
  state.edits = p.edits;
  state.manual = p.manual.map((c) => ({ ...c, edited: new Set() }));
  state.windowMonths = p.windowMonths;
  if (p.subject) { writeSubject(p.subject); saveSubject(); }
  $('queue').textContent = '';
  $('queue-card').hidden = true;
  recompute();
  renderAll();
  scheduleSave();
  const n = state.sales.length + state.market.length;
  toast(`Opened ${file.name}: ${n} comp${n === 1 ? '' : 's'}.`, { label: 'Undo', run: () => restoreSnapshot(snap) });
}

/* ----------------------------------------------------------- comp detail */

const money0 = (n) => (typeof n === 'number' && Number.isFinite(n) ? `$${Math.round(n).toLocaleString('en-US')}` : null);

function openDetail(c) {
  const x = exportComp(c);
  const sale = x.kind === 'sale';
  const status = sale ? 'Sold' : ((x.flags || []).find((f) => f.startsWith('status is '))?.match(/^status is ([A-Za-z ]+?),/)?.[1] || 'Active');
  const body = sheetOpen({
    eyebrow: `${sale ? 'Sale comp' : 'On market'} · ${status}`,
    title: x.name,
    sub: [fullAddress(x), x.submarket ? `${x.submarket} submarket` : null].filter(Boolean).join(' · '),
  });
  const section = (title, node) => {
    const sec = el('section');
    sec.appendChild(el('h3', null, title));
    sec.appendChild(node);
    body.appendChild(sec);
  };
  const facts = (rows) => {
    const dl = el('dl', 'facts');
    for (const [k, v, text] of rows) {
      if (v === null || v === undefined || v === '') continue;
      const d = el('div');
      d.appendChild(el('dt', null, k));
      d.appendChild(el('dd', text ? 't' : null, String(v)));
      dl.appendChild(d);
    }
    return dl.children.length ? dl : null;
  };

  const far = typeof x.max_far === 'number' ? x.max_far : null;
  const bldbl = far && x.lot_sf ? x.lot_sf * far : null;
  const figures = facts([
    [sale ? 'Sale date' : 'Days on market', sale ? (x.date ? mdy(x.date) : null) : (x.dom ? int(x.dom) : null)],
    [sale ? 'Sale price' : 'Asking price', x.price ? money0(x.price) : (sale ? null : 'not disclosed')],
    ['Building SF', x.bsf ? int(x.bsf) : null],
    ['$/SF', ppsf(x) ? money2(ppsf(x)) : null],
    ['Cap rate', typeof x.cap === 'number' ? pct(x.cap) : null],
    ['Occupancy', typeof x.occ === 'number' ? pct(x.occ, 1) : null],
    ['Lot SF', x.lot_sf ? int(x.lot_sf) : null],
    ['$/land SF', x.price && x.lot_sf ? money2(x.price / x.lot_sf) : null],
    ['Zoning', x.zoning, true],
    ['Max FAR', far !== null ? String(far) : null],
    ['Buildable SF', bldbl ? int(bldbl) : null],
    ['$/buildable SF', bldbl && x.price ? money2(x.price / bldbl) : null],
    ['Existing FAR', typeof x.far === 'number' ? String(x.far) : null],
    ['Year built', x.year ? String(x.year) : null],
    ['Class', x.bclass, true],
    ['Property type', x.ptype, true],
  ]);
  if (figures) section('Figures', figures);
  const terms = facts([
    [sale ? 'Sale type' : 'Marketed to', x.sale_type, true],
    ['True buyer', x.buyer, true],
    ['True seller', x.seller, true],
    ['Sale conditions', x.conditions, true],
    ['Hold period', x.hold, true],
    ['Buyer broker', x.buyer_broker, true],
    ['Listing broker', x.listing_broker, true],
    ['CoStar ID', x.comp_id ? String(x.comp_id) : null],
    ['Source', x.source, true],
  ]);
  if (terms) section(sale ? 'Parties and terms' : 'Listing', terms);
  if (x.flags.length) {
    const ul = el('ul', 'detail-flags');
    for (const f of x.flags) ul.appendChild(el('li', null, f));
    section(`Flags (${x.flags.length})`, ul);
  }
  if (x.costar_notes) section('CoStar notes', el('p', 'detail-notes', x.costar_notes));
  if (x.address || x.name) {
    const links = el('div', 'detail-links');
    const a = el('a', 'btn btn-sm', 'Open in Maps');
    a.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress(x))}`;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    links.appendChild(a);
    section('Location', links);
  }
}

/* --------------------------------------------- CSV and the printable sheet */

function includedSorted() {
  return {
    sales: state.sales.filter(included).map(exportComp).sort(byPpsf),
    market: state.market.filter(included).map(exportComp).sort(byPpsf),
  };
}

async function exportCsv() {
  const { sales, market } = includedSorted();
  // a byte-order mark tells Excel the file is UTF-8, so names like "Pastore’s" survive
  const bytes = new TextEncoder().encode(`﻿${compsCsv(sales, market)}`);
  try {
    const done = await deliver(`${projectName()}.csv`, bytes, 'text/csv');
    if (done === 'done') {
      toast('CSV ready. In Google My Maps, choose Import and pick the Full Address column to place every comp on a map.');
    }
  } catch (err) {
    deliveryError(err);
  }
}

function printSheet() {
  const { sales, market } = includedSorted();
  const subject = readSubject();
  renderCompSheet($('print-sheet'), { sales, market, subject, label: setLabel(), preparedBy: subject.preparedBy || '' });
  printed(`Comp sheet: ${setLabel() || 'comps'}`);
  window.print();
}

/* ----------------------------------------------------------- the download */

function setLabel() {
  const tally = {};
  for (const c of [...state.sales, ...state.market]) {
    if (!included(c) || !c.submarket) continue;
    tally[c.submarket] = (tally[c.submarket] || 0) + 1;
  }
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : ($('s-address').value.trim() || 'Comp set');
}

async function buildFile() {
  const { sales, market } = includedSorted();
  if (state.output === 'template' && state.template) {
    const fflate = await getFflate();
    const { fillTemplate } = await import('./template.js');
    const { bytes, report } = fillTemplate(fflate, state.template.bytes, state.template.plan, { sales, market },
      { DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer });
    const base = state.template.name.replace(/\.xlsx?m?$/i, '');
    return { bytes, name: `${base} - ${setLabel().replace(/[^\w\s-]+/g, ' ').trim()} (${localDate()}).xlsx`, report };
  }
  const libs = await getXlsx();
  const subject = readSubject();
  const manual = [...state.sales, ...state.market]
    .filter((c) => included(c) && (c.manual || (c.edited && c.edited.size) || (c.origKind && c.kind !== c.origKind))).length;
  const deal = $('with-deal').checked ? dealForWorkbook(compBasis(sales)) : null;
  const bytes = await buildWorkbook(libs.ExcelJS, libs.fflate, {
    sales, market, subject,
    label: setLabel(),
    sources: [...state.docs.map((d) => d.name), ...(state.manual.length ? ['entered by hand'] : [])],
    app: PRODUCT,
    preparedBy: subject.preparedBy || '',
    manual,
    deal,
  });
  return { bytes, name: `${projectName()}.xlsx` };
}

async function exportWorkbook({ share = false } = {}) {
  if (state.busy) return;
  state.busy = true;
  const btn = $('download');
  btn.classList.add('btn-busy');
  btn.setAttribute('aria-busy', 'true');
  refreshCounts();
  try {
    const { bytes, name, report } = await buildFile();
    const done = await deliver(name, bytes, XLSX, { share });
    if (done === 'done') {
      if (report) {
        const where = report.sheets.map((s) => `${s.rows} on ${s.name}`).join(', ');
        toast(`Template filled: ${where || 'nothing to write'}.${report.formulasKept ? ` ${report.formulasKept} formula cells left as they were.` : ''}`);
      } else toast('Workbook ready. Open the Summary tab first.');
    }
  } catch (err) {
    deliveryError(err);
  } finally {
    btn.classList.remove('btn-busy');
    btn.removeAttribute('aria-busy');
    state.busy = false;
    refreshCounts();
  }
}

/** A plain-text table, for pasting the comp set straight into an email or a sheet. */
function copyTable() {
  // a cell that starts with = + - or @ would run as a formula when pasted into a spreadsheet
  const safe = (v) => {
    const s = String(v ?? '');
    return /^[=+\-@]/.test(s) ? `'${s}` : s;
  };
  const lines = [];
  const block = (title, comps, kind) => {
    const live = comps.filter(included);
    if (!live.length) return;
    lines.push(title.toUpperCase());
    lines.push(['#', 'Property', kind === 'sale' ? 'Sale date' : 'DOM', 'Price', 'Building SF', '$/SF', 'Cap'].join('\t'));
    live.forEach((c, i) => {
      lines.push([
        i + 1, safe(c.name),
        kind === 'sale' ? mdy(c.date) : (c.dom ?? ''),
        c.price ? `$${int(c.price)}` : 'undisclosed',
        int(c.bsf), ppsf(c) ? money2(ppsf(c)) : '', c.cap ? pct(c.cap) : '',
      ].join('\t'));
    });
    const priced = live.filter((c) => c.price && c.bsf);
    if (priced.length) {
      const tp = priced.reduce((s, c) => s + c.price, 0);
      const ts = priced.reduce((s, c) => s + c.bsf, 0);
      lines.push(['', 'SF-weighted', '', `$${int(tp)}`, int(ts), money2(tp / ts), ''].join('\t'));
    }
    lines.push('');
  };
  block('Sale comps', [...state.sales].sort(byPpsf), 'sale');
  block('On market', [...state.market].sort(byPpsf), 'market');
  const text = lines.join('\n').trim();
  if (!text) return;
  copyText(text).then((ok) => toast(ok ? 'Comp table copied. Paste it into an email or a sheet.' : 'The browser blocked copying here.'));
}

/* ------------------------------------------------------ your own template */

const TKEY = 'template';

function refreshOutput() {
  const tpl = state.output === 'template';
  $('out-builtin').setAttribute('aria-pressed', String(!tpl));
  $('out-template').setAttribute('aria-pressed', String(tpl));
  $('out-builtin-info').hidden = tpl;
  $('out-template-info').hidden = !tpl;
  $('tpl-none').hidden = !!state.template;
  $('tpl-some').hidden = !state.template;
  if (state.template) {
    const t = state.template;
    $('tpl-name').textContent = t.name;
    const used = t.plan.sheets.filter((s) => s.role !== 'skip');
    $('tpl-desc').textContent = used.length
      ? used.map((s) => `${s.role === 'sale' ? 'Sales' : 'Listings'} → ${s.name} (${s.columns.filter((c) => c.field).length} columns)`).join(' · ')
      : 'No sheet chosen yet: tap Columns';
  }
  // the deal's tab only belongs in the built-in workbook
  const dealName = currentDealName();
  $('with-deal-row').hidden = tpl || !dealName;
  $('with-deal-sub').textContent = dealName ? `${dealName}: a Deal Analysis tab after the Summary` : '';
  refreshCounts();
}

async function loadTemplate(file) {
  if (!/\.xlsx$|\.xlsm$/i.test(file.name)) {
    toast(/\.xls$/i.test(file.name) ? 'That is an old .xls file. Open it in Excel and save it as .xlsx first.' : 'Choose an Excel .xlsx file.');
    return;
  }
  try {
    const fflate = await getFflate();
    const { inspectTemplate } = await import('./template.js');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const plan = inspectTemplate(fflate, bytes, { DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer });
    if (!plan.sheets.length) {
      toast('No comp table was found in that workbook: it needs a row of column headings such as Property Name, Sale Price and Building SF.');
      return;
    }
    state.template = { name: file.name, bytes, plan, savedAt: Date.now() };
    state.output = 'template';
    await store.kvSet(TKEY, state.template);
    await store.kvSet('output', state.output);
    refreshOutput();
    mapTemplate(true);
  } catch (err) {
    toast(err.message || 'That workbook could not be read.');
  }
}

/** Review and change which sheet takes what, and which column takes which figure. */
async function mapTemplate(first = false) {
  const t = state.template;
  if (!t) return;
  const { TEMPLATE_FIELDS } = await import('./template.js');
  const done = el('button', 'btn btn-primary', 'Save');
  done.type = 'button';
  const body = sheetOpen({
    eyebrow: 'Your template',
    title: t.name,
    sub: first ? 'Here is how the comps will go in. Change anything that is wrong; this is remembered.' : 'Which sheet takes the comps, and which column takes which figure.',
    foot: [done],
  });
  const draft = JSON.parse(JSON.stringify(t.plan));
  for (const sh of draft.sheets) {
    const sec = el('section', 'card card-pad');
    sec.style.boxShadow = 'none';
    sec.style.background = 'var(--surface-2)';
    const head = el('div');
    head.style.cssText = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px';
    const h = el('div', null);
    h.style.marginRight = 'auto';
    h.appendChild(el('div', 'li-title', sh.name));
    h.appendChild(el('div', 'hint-sm', `Headings on row ${sh.headerRow}; comps from row ${sh.headerRow + 1}${sh.formulaCols ? ` · ${sh.formulaCols} formula columns kept` : ''}`));
    head.appendChild(h);
    const role = el('select', 'compact');
    role.setAttribute('aria-label', `What ${sh.name} takes`);
    for (const [v, l] of [['sale', 'Sale comps'], ['market', 'On-market comps'], ['skip', 'Not used']]) {
      const o = el('option', null, l);
      o.value = v;
      role.appendChild(o);
    }
    role.value = sh.role;
    role.addEventListener('change', () => {
      // one sheet per set: choosing a sheet for sales takes it from any other
      if (role.value !== 'skip') {
        for (const other of draft.sheets) if (other !== sh && other.role === role.value) other.role = 'skip';
        body.querySelectorAll('select[data-role]').forEach((s) => { const o = draft.sheets[Number(s.dataset.role)]; s.value = o.role; });
      }
      sh.role = role.value;
      cols.hidden = sh.role === 'skip';
    });
    role.dataset.role = String(draft.sheets.indexOf(sh));
    head.appendChild(role);
    sec.appendChild(head);
    const cols = el('div');
    cols.hidden = sh.role === 'skip';
    for (const c of sh.columns) {
      const r = el('div', 'map-row');
      const h2 = el('div', 'h', c.header);
      h2.appendChild(el('small', null, `Column ${c.letter}`));
      r.appendChild(h2);
      const sel = el('select', 'compact');
      sel.setAttribute('aria-label', `Figure for column ${c.letter}, ${c.header}`);
      const none = el('option', null, '— leave blank —');
      none.value = '';
      sel.appendChild(none);
      for (const f of TEMPLATE_FIELDS) {
        const o = el('option', null, f.label);
        o.value = f.key;
        sel.appendChild(o);
      }
      sel.value = c.field || '';
      sel.addEventListener('change', () => { c.field = sel.value || null; });
      r.appendChild(sel);
      cols.appendChild(r);
    }
    sec.appendChild(cols);
    body.appendChild(sec);
  }
  body.appendChild(el('p', 'hint-sm', 'Old values under the headings are cleared before the comps go in; formulas, formatting, charts and every other sheet are left exactly as they are. Excel recalculates when the file opens.'));
  done.addEventListener('click', async () => {
    t.plan = draft;
    await store.kvSet(TKEY, t);
    refreshOutput();
    sheetClose();
    toast('Template saved.');
  });
}

async function templateMenu() {
  const v = await actionSheet(state.template.name, [
    { label: 'Change columns', value: 'map', icon: '<path d="M4 6h16M4 12h16M4 18h10"/>' },
    { label: 'Replace template…', value: 'replace', icon: '<path d="M12 16V4m0 0L8 8m4-4l4 4M5 20h14"/>' },
    { label: 'Download blank template', value: 'download', icon: '<path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 20h14"/>' },
    '-',
    { label: 'Remove template', value: 'remove', danger: true, icon: '<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>' },
  ]);
  if (v === 'map') mapTemplate();
  else if (v === 'replace') $('tpl-file').click();
  else if (v === 'download') deliver(state.template.name, state.template.bytes, XLSX).catch(deliveryError);
  else if (v === 'remove') {
    const old = state.template;
    state.template = null;
    state.output = 'builtin';
    await store.kvSet(TKEY, null);
    await store.kvSet('output', 'builtin');
    refreshOutput();
    toast('Template removed.', { label: 'Undo', run: async () => { state.template = old; state.output = 'template'; await store.kvSet(TKEY, old); await store.kvSet('output', 'template'); refreshOutput(); } });
  }
}

/* ------------------------------------------------------------------ wiring */

$('file').addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });
// the PDF reader starts loading the moment a finger goes down on the button
document.querySelectorAll('label[for="file"]').forEach((l) => l.addEventListener('pointerdown', () => getPdfjs().catch(() => {}), { once: true }));

// a file can be dropped anywhere on the page, not only on the drop target
let dragDepth = 0;
document.addEventListener('dragenter', (e) => {
  if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
  dragDepth += 1;
  document.body.classList.add('dragging');
});
document.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) document.body.classList.remove('dragging');
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  const files = e.dataTransfer?.files;
  if (!files?.length) return;
  // on the Deal screen a dropped PDF is an OM; a dropped .xlsx is a template
  if ([...files].some((f) => /\.xlsx$|\.xlsm$/i.test(f.name))) { loadTemplate([...files].find((f) => /\.xlsx$|\.xlsm$/i.test(f.name))); return; }
  if (currentView === 'deal') { document.dispatchEvent(new CustomEvent('omdrop', { detail: files[0] })); return; }
  if (currentView !== 'comps') showView('comps');
  handleFiles(files);
});

$('example').addEventListener('click', () => {
  if (state.busy) return;
  const snap = snapshot();
  const set = sampleSet(zoningLookup);
  for (const c of [...set.sales, ...set.market]) {
    Object.assign(c, { key: `example::${c.name}`, manual: true, example: true, origKind: c.kind, edited: new Set(), exclude: false });
  }
  state.docs = [];
  state.edits = {};
  state.manual = [...set.sales, ...set.market];
  $('queue').textContent = '';
  $('queue-card').hidden = true;
  recompute();
  renderAll();
  scheduleSave();
  toast('Example comps loaded. They are invented, not real transactions.', { label: 'Undo', run: () => restoreSnapshot(snap) });
  idle(() => getXlsx().catch(() => {}));
});

$('download').addEventListener('click', () => exportWorkbook());

$('comps-more').addEventListener('click', async () => {
  const n = state.sales.filter(included).length + state.market.filter(included).length;
  const any = state.sales.length + state.market.length > 0 || state.docs.length > 0;
  const v = await actionSheet(null, [
    ...(canShareFiles() ? [{ label: 'Share workbook…', sub: 'Mail, Messages, Files, Teams', value: 'share', disabled: !n, icon: '<path d="M12 15V3m0 0L8 7m4-4l4 4M6 11H5a1 1 0 00-1 1v8a1 1 0 001 1h14a1 1 0 001-1v-8a1 1 0 00-1-1h-1"/>' }] : []),
    ...(IN_ARTIFACT ? [] : [{ label: 'Comp sheet', sub: 'one page to print or save as PDF', value: 'print', disabled: !n, icon: '<path d="M7 9V3h10v6M7 17H5a2 2 0 01-2-2v-4a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2h-2M7 14h10v7H7z"/>' }]),
    { label: 'CSV', sub: 'for a CRM or Google My Maps', value: 'csv', disabled: !n, icon: '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5M8 13h8M8 17h5"/>' },
    { label: 'Copy comp table', sub: 'to paste into an email', value: 'copy', disabled: !n, icon: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>' },
    '-',
    { label: 'Template library…', sub: 'your firm’s workbooks, mapped and filled for a deal', value: 'library', icon: '<path d="M4 5h16v14H4zM4 10h16M10 10v9"/>' },
    { label: 'Save project file', sub: 'the whole comp set, to reopen anywhere', value: 'save', disabled: !any, icon: '<path d="M5 3h11l3 3v13a2 2 0 01-2 2H7a2 2 0 01-2-2z"/><path d="M8 3v5h7M8 21v-6h8v6"/>' },
    { label: 'Open project file…', value: 'open', icon: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>' },
    '-',
    { label: 'Clear all comps', value: 'reset', danger: true, disabled: !any, icon: '<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>' },
  ]);
  if (v === 'share') exportWorkbook({ share: true });
  else if (v === 'print') printSheet();
  else if (v === 'csv') exportCsv();
  else if (v === 'copy') copyTable();
  else if (v === 'save') saveProject();
  else if (v === 'library') openTemplates();
  else if (v === 'open') $('file').click();
  else if (v === 'reset') {
    const snap = snapshot();
    state.docs = [];
    state.edits = {};
    state.manual = [];
    state.windowMonths = 0;
    $('queue').textContent = '';
    $('queue-card').hidden = true;
    recompute();
    renderAll();
    // nothing pending may write the old set back, from IndexedDB or the localStorage mirror
    clearTimeout(saveTimer);
    savePending = false;
    try { localStorage.removeItem(REC_KEY); } catch { /* fine */ }
    store.clearSession();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast('All comps cleared.', { label: 'Undo', run: () => restoreSnapshot(snap) });
  }
});

for (const kind of ['sale', 'market']) {
  const sortSel = $(`${kind}-sort`);
  sortSel.addEventListener('change', () => { state.sort[kind] = sortSel.value; renderTable(kind); });
  let t = null;
  $(`${kind}-search`).addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => { state.query[kind] = e.target.value; renderTable(kind); }, 120);
  });
}
document.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => addManual(b.dataset.add)));
document.querySelectorAll('[data-bulk]').forEach((b) => b.addEventListener('click', () => bulkToggle(b.dataset.bulk)));
$('sales-window').addEventListener('change', () => {
  state.windowMonths = Number($('sales-window').value) || 0;
  renderAll();
  scheduleSave();
});

$('subject').addEventListener('change', (e) => {
  const t = e.target;
  // a year is a label, not a quantity: no thousands separator
  if (t.classList.contains('n') && t.id !== 's-year') {
    const v = parseNum(t.value);
    t.value = v === null ? '' : int(v);
  }
  if (t.id === 's-zoning' && t.value.trim() && !zoningInfo(t.value)) {
    toast(`${t.value.trim()} is not in the zoning catalogue, so the subject's buildable SF will be left blank.`);
  }
  saveSubject();
  subjectSummary();
  refreshGlance();
});

$('out-builtin').addEventListener('click', () => { state.output = 'builtin'; store.kvSet('output', 'builtin'); refreshOutput(); });
$('out-template').addEventListener('click', () => { state.output = 'template'; store.kvSet('output', 'template'); refreshOutput(); });
$('tpl-file').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) loadTemplate(f); });
$('tpl-map').addEventListener('click', () => mapTemplate());
$('tpl-more').addEventListener('click', () => templateMenu());
document.addEventListener('dealchange', refreshOutput);

/* --------------------------------------------------------- install & offline */

let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  $('install').hidden = false;
});
$('install').addEventListener('click', async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice.catch(() => null);
  installEvent = null;
  $('install').hidden = true;
});
window.addEventListener('appinstalled', () => { $('install').hidden = true; });

const HINT = 'zlatura.ios-hint-dismissed';
let hintDismissed = false;
try { hintDismissed = localStorage.getItem(HINT) === '1'; } catch { hintDismissed = false; }
if (!IN_ARTIFACT && isIOS() && !isStandalone() && !hintDismissed) $('ios-hint').hidden = false;
$('ios-hint-close').addEventListener('click', () => {
  $('ios-hint').hidden = true;
  try { localStorage.setItem(HINT, '1'); } catch { /* fine */ }
});

// opened from the desktop by double-clicking a PDF, when installed as an app
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (params) => {
    if (!params.files || !params.files.length) return;
    const files = await Promise.all(params.files.map((h) => h.getFile()));
    handleFiles(files);
  });
}

/* Offline support, where the host serves a service worker. A published
 * artifact has none, and the page is fully usable without it. */
function registerWorker() {
  // the first install takes control of a page that had none: that is not an update
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    // an app left open on a phone for days still hears about a new release:
    // check when it comes back to the screen, at most once an hour
    let checked = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || Date.now() - checked < 3600e3) return;
      checked = Date.now();
      reg.update().catch(() => {});
    });
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'activated' && hadController) {
          toast(`A new version of ${PRODUCT} is ready.`, { label: 'Reload', run: () => location.reload() });
        }
      });
    });
  }).catch(() => { /* not served here */ });
}
if (!IN_ARTIFACT && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  // registering after load keeps it off the critical path; if the page has
  // already loaded by the time this module runs, register now
  if (document.readyState === 'complete') registerWorker();
  else window.addEventListener('load', registerWorker);
}

/* -------------------------------------------------------------------- start */

document.querySelectorAll('.app-version').forEach((n) => { n.textContent = `${PRODUCT} ${VERSION}`; });

const compsApi = {
  basis: () => compBasis(state.sales.filter(included)),
  count: () => state.sales.filter(included).length,
  // the included sale comps, for the Tools screen's comp set check
  sales: () => state.sales.filter(included).map((c) => ({ price: c.price, bsf: c.bsf, cap: c.cap, date: c.date })),
  setSubject: setSubjectFromDeal,
  showView,
  sheetOpen,
  sheetClose,
  pdfPages,
  // a restore writes straight to storage: any comp edit still pending goes first
  flushComps: flushSession,
};
initDeal(compsApi);
initTools(compsApi);
initHome(compsApi);
initSettings(compsApi);
initCommand(compsApi);
initTheme();

restoreSubject();
renderAll();
restoreSession();
(async () => {
  const [tpl, out] = await Promise.all([store.kvGet(TKEY), store.kvGet('output')]);
  if (tpl && tpl.bytes && tpl.plan) state.template = tpl;
  if (out === 'template' && state.template) state.output = 'template';
  refreshOutput();
})();
// the old database from before the rename: deleted once a backup has been made since the move, or after 30 days
setTimeout(() => { store.finishRename().catch(() => {}); }, 4000);
showView(VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home', { push: false });
