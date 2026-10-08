/* dealui.js -- the Deal screen: an offering memorandum, read and worked through
 * on the spot.
 *
 * Built for a site visit with an owner, a seller or a manager standing there:
 * drop or pick the OM, and in a few seconds the key figures are on screen with
 * the page each came from, checked against each other, priced against the
 * comps already loaded, run through a loan, and turned into the questions
 * worth asking before leaving the building. Notes and photos from the visit
 * are kept with the deal, and the whole thing goes out as an Excel tab, a
 * one-page brief or a five-line text.
 *
 * Deals are saved on the device (IndexedDB) after every change. */

import { readOm } from './om.js';
import { analyze, compBasis } from './deal.js';
import * as store from './store.js';
import { renderDealBrief, dealSummaryText, placeLine } from './brief.js';
import {
  $, el, svg, IN_ARTIFACT, XLSX, parseNum, asPercent, int, dec, money0, money2, pct, signed, times, yrs, short, niceDate,
  localDate, toast, actionSheet, getPdfjs, getXlsx, deliver, deliveryError, shareText, idle,
} from './kit.js';

let api = null;
let deal = null;          // the open deal
let reading = null;       // { name, done, total } while an OM is being read
let saveTimer = null;
let photoUrls = [];

const LOAN_KEY = 'comp-loader.loan.v1';
const CUR_KEY = 'comp-loader.deal.current';
const LOAN_DEFAULTS = { ltv: 65, rate: 6.75, amort: 30, io: false, closing: 2, minDscr: 1.25, minDy: 8 };

/* What the figures list shows, in the order a broker reads an OM. */
const SECTIONS = [
  ['The offering', [
    ['price', 'Asking price', 'money'], ['noi', 'NOI, in place', 'money'], ['cap', 'Cap rate stated', 'pct'],
    ['occ', 'Occupancy', 'pct'], ['noi_pf', 'NOI, pro forma', 'money'], ['cap_pf', 'Cap rate, pro forma', 'pct'],
    ['price_psf', 'Price per SF stated', 'money2'], ['price_unit', 'Price per unit stated', 'money'],
  ]],
  ['The property', [
    ['address', 'Address', 'text'], ['city', 'City', 'text'], ['state', 'State', 'text'], ['zip', 'ZIP', 'text'],
    ['ptype', 'Property type', 'text'], ['bsf', 'Building SF', 'int'], ['lot_sf', 'Land SF', 'int'], ['units', 'Units', 'int'],
    ['year', 'Year built', 'year'], ['renovated', 'Renovated', 'year'], ['stories', 'Stories', 'int'], ['zoning', 'Zoning', 'text'], ['parking', 'Parking', 'text'],
  ]],
  ['Income and expenses', [
    ['gross', 'Gross income (EGI)', 'money'], ['opex', 'Operating expenses', 'money'], ['taxes', 'Real estate taxes', 'money'],
  ]],
  ['Lease', [
    ['tenant', 'Tenant', 'text'], ['guarantor', 'Guarantor', 'text'], ['lease_type', 'Lease type', 'text'],
    ['lease_exp', 'Lease expiration', 'text'], ['term_left', 'Term remaining', 'text'], ['increases', 'Rent increases', 'text'],
    ['options', 'Renewal options', 'text'],
  ]],
];
const KIND = Object.fromEntries(SECTIONS.flatMap(([, rows]) => rows.map(([k, , kind]) => [k, kind])));
const LABEL = Object.fromEntries(SECTIONS.flatMap(([, rows]) => rows.map(([k, l]) => [k, l])));

const VISIT = [
  ['roof', 'Roof'], ['hvac', 'HVAC'], ['facade', 'Facade and windows'], ['interior', 'Interior and common areas'],
  ['systems', 'Electrical and plumbing'], ['parking', 'Parking and access'], ['signage', 'Signage and visibility'],
  ['ada', 'Accessibility'], ['tenants', 'Tenants and traffic'], ['neighbors', 'Neighbours and block'], ['deferred', 'Deferred maintenance'],
];

const ok = (x) => typeof x === 'number' && Number.isFinite(x);
const fmt = (kind, v) => {
  if (v === null || v === undefined || v === '') return '';
  if (kind === 'text') return String(v);
  if (kind === 'money') return money0(v);
  if (kind === 'int') return int(v);
  if (kind === 'money2') return money2(v);
  if (kind === 'pct') return `${dec(v, 2)}%`;
  if (kind === 'year') return String(v);
  return String(v);
};
const show = (kind, v) => {
  if (v === null || v === undefined || v === '') return '—';
  if (kind === 'money') return money0(v);
  if (kind === 'money2') return money2(v);
  if (kind === 'pct') return pct(v);
  if (kind === 'int') return int(v);
  return String(v);
};

function loanDefaults() {
  try { return { ...LOAN_DEFAULTS, ...JSON.parse(localStorage.getItem(LOAN_KEY) || '{}') }; } catch { return { ...LOAN_DEFAULTS }; }
}
function rememberLoan(L) {
  try { localStorage.setItem(LOAN_KEY, JSON.stringify(L)); } catch { /* fine */ }
}

function newDeal(extra = {}) {
  const now = Date.now();
  return {
    id: `d${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: '', createdAt: now, updatedAt: now, source: null, readAt: null, pages: 0,
    figures: {}, sources: {}, rentRoll: [], unpriced: false,
    loan: loanDefaults(),
    qDone: {}, myQuestions: [],
    visit: { at: null, items: {}, notes: '', photos: [] },
    ...extra,
  };
}

/* ------------------------------------------------------------- the maths */

function figuresFor(d) {
  return { ...d.figures, rentRoll: d.rentRoll, loan: d.loan };
}
function metrics() {
  const comps = api.count() ? api.basis() : null;
  return { m: analyze(figuresFor(deal), comps), comps };
}
function activeQuestions(m) {
  return [...m.questions, ...deal.myQuestions].filter((q) => !deal.qDone[q]);
}
function visitLines() {
  const v = deal.visit;
  const lines = [];
  if (v.at) lines.push(`Visited ${new Date(v.at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`);
  for (const [k, l] of VISIT) {
    const s = v.items[k];
    const note = v.itemNotes && v.itemNotes[k];
    if (s || note) lines.push(`${l}: ${s === 'ok' ? 'fine' : s === 'issue' ? 'needs attention' : 'noted'}${note ? ` (${note})` : ''}`);
  }
  if (v.notes.trim()) lines.push(...v.notes.trim().split(/\n+/));
  return lines;
}

/** The open deal in the shape the workbook builder takes, or null. */
export function dealForWorkbook(basis) {
  if (!deal || !hasFigures()) return null;
  const comps = basis && basis.n ? basis : null;
  const m = analyze(figuresFor(deal), comps);
  return { deal: workbookDeal(m), metrics: m, comps };
}
function workbookDeal(m) {
  return {
    name: deal.name || deal.figures.address, source: deal.source, readAt: deal.readAt,
    figures: { ...deal.figures, rentRoll: deal.rentRoll }, loan: deal.loan, sources: deal.sources,
    questions: activeQuestions(m), visitLines: visitLines(),
  };
}
export const currentDealName = () => (deal && hasFigures() ? (deal.name || deal.figures.address || 'Untitled deal') : null);
const hasFigures = () => deal && Object.values(deal.figures).some((v) => v !== null && v !== undefined && v !== '');

/* ---------------------------------------------------------------- saving */

function touch() {
  deal.updatedAt = Date.now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { store.saveDeal(deal); }, 400);
  document.dispatchEvent(new CustomEvent('dealchange'));
  badge();
}
function badge() {
  document.querySelectorAll('.tab[data-view="deal"] .badge').forEach((b) => {
    const qs = deal && hasFigures() ? analyze(figuresFor(deal), null).checks.filter((c) => c.level !== 'info').length : 0;
    b.hidden = !qs;
    b.textContent = qs ? String(qs) : '';
  });
}
async function openDeal(id, { quiet = false } = {}) {
  const d = await store.loadDeal(id);
  if (!d) {
    if (!quiet) toast('That deal could not be opened.');
    try { localStorage.removeItem(CUR_KEY); } catch { /* fine */ }
    return;
  }
  deal = { ...newDeal(), ...d, visit: { ...newDeal().visit, ...(d.visit || {}) } };
  try { localStorage.setItem(CUR_KEY, deal.id); } catch { /* fine */ }
  render();
  document.dispatchEvent(new CustomEvent('dealchange'));
  badge();
}
function closeDeal() {
  deal = null;
  try { localStorage.removeItem(CUR_KEY); } catch { /* fine */ }
  render();
  document.dispatchEvent(new CustomEvent('dealchange'));
  badge();
}

/* ------------------------------------------------------------ reading an OM */

async function readOmFile(file) {
  if (!file) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { toast('An offering memorandum needs to be a PDF.'); return; }
  if (reading) { toast('Still reading the last OM.'); return; }
  reading = { name: file.name, done: 0, total: 0 };
  render();
  let pages;
  try {
    const pdfjs = await getPdfjs();
    pages = await api.pdfPages(pdfjs, new Uint8Array(await file.arrayBuffer()), {
      onPage: (k, n) => { reading.done = k; reading.total = n; progress(); },
    });
  } catch (err) {
    reading = null;
    render();
    toast(err && err.name === 'PasswordException' ? 'That PDF is password protected. Ask for an unlocked copy.' : `That PDF could not be read: ${err.message || err}`);
    return;
  }
  const om = readOm(pages);
  reading = null;
  if (om.chars < 200) {
    deal = newDeal({ name: file.name.replace(/\.pdf$/i, ''), source: file.name, readAt: Date.now(), pages: om.pages });
    render();
    toast('This OM is scanned images with no text in it, so its numbers can’t be read. Enter the key figures by hand; the analysis works the same.', null, 9000);
    touch();
    return;
  }
  const figures = {};
  const sources = {};
  for (const [k, f] of Object.entries(om.fields)) {
    const key = k === 'lot' ? 'lot_sf' : k;
    if (!(key in KIND)) continue;
    figures[key] = f.value;
    sources[key] = { page: f.page, line: f.line, confidence: f.confidence, alts: f.alts || [], count: f.count || 1, orig: f.value };
  }
  deal = newDeal({
    name: figures.address || file.name.replace(/\.pdf$/i, ''),
    source: file.name, readAt: Date.now(), pages: om.pages, figures, sources,
    rentRoll: om.rentRoll ? om.rentRoll.rows.map((r) => ({ ...r, end: r.end ? new Date(r.end).toISOString() : null, start: r.start ? new Date(r.start).toISOString() : null })) : [],
    rentRollPage: om.rentRoll ? om.rentRoll.page : null,
    unpriced: om.unpriced,
  });
  try { localStorage.setItem(CUR_KEY, deal.id); } catch { /* fine */ }
  const n = Object.keys(figures).length;
  render();
  touch();
  store.askToPersist();
  toast(`Read ${om.pages} page${om.pages === 1 ? '' : 's'}: ${n} figure${n === 1 ? '' : 's'} found${om.rentRoll ? ` and a rent roll of ${om.rentRoll.rows.length}` : ''}. Tap a page tag to see where each came from.`, null, 7000);
  idle(() => getXlsx().catch(() => {}));
}

function progress() {
  const bar = document.querySelector('#deal-progress i');
  const t = $('deal-progress-text');
  if (!bar || !reading) return;
  bar.style.width = reading.total ? `${Math.round((reading.done / reading.total) * 100)}%` : '8%';
  if (t) t.textContent = reading.total ? `Page ${reading.done} of ${reading.total}` : 'Opening…';
}

/* ------------------------------------------------------------- rendering */

const root = () => $('deal-root');
const card = (title, extra) => {
  const c = el('section', 'card');
  if (title) {
    const h = el('div', 'card-head');
    h.appendChild(el('h2', null, title));
    if (extra) h.appendChild(extra);
    c.appendChild(h);
  }
  return c;
};
const icon = (paths, size = 18) => { const s = el('span'); s.innerHTML = svg(paths, size); s.style.display = 'inline-flex'; return s; };

function viewHead(title, sub, actions = []) {
  const h = el('div', 'view-head');
  h.appendChild(el('h1', null, title));
  const a = el('div', 'view-actions');
  actions.forEach((b) => a.appendChild(b));
  h.appendChild(a);
  if (sub) h.appendChild(el('p', null, sub));
  return h;
}
const button = (cls, text, fn, iconPaths) => {
  const b = el('button', `btn ${cls}`);
  b.type = 'button';
  if (iconPaths) b.insertAdjacentHTML('beforeend', svg(iconPaths, 17));
  if (text) b.appendChild(el('span', null, text));
  b.addEventListener('click', fn);
  return b;
};

function render() {
  for (const u of photoUrls) URL.revokeObjectURL(u);
  photoUrls = [];
  const r = root();
  r.textContent = '';
  if (reading) return renderReading(r);
  if (!deal) return renderLanding(r);
  renderDeal(r);
}

function renderReading(r) {
  r.appendChild(viewHead('Deal', null));
  const c = el('div', 'hero');
  c.style.marginTop = '14px';
  c.appendChild(Object.assign(el('div', 'hero-icon'), { innerHTML: svg('<path d="M14 3H7a2.5 2.5 0 0 0-2.5 2.5v13A2.5 2.5 0 0 0 7 21h10a2.5 2.5 0 0 0 2.5-2.5V8.5z"/><path d="M14 3v5.5h5.5M9 13h6M9 17h4"/>', 28) }));
  c.appendChild(el('h2', null, `Reading ${reading.name}`));
  const bar = el('div', 'progress');
  bar.id = 'deal-progress';
  bar.appendChild(el('i'));
  c.appendChild(bar);
  const t = el('p', null, 'Opening…');
  t.id = 'deal-progress-text';
  c.appendChild(t);
  r.appendChild(c);
  progress();
}

async function renderLanding(r) {
  r.appendChild(viewHead('Deal', 'Read an offering memorandum on the spot: the key figures, checked against each other and against your comps, run through a loan, with the questions to ask before you leave.'));
  const stack = el('div', 'stack');
  const hero = el('div', 'hero drop');
  hero.appendChild(Object.assign(el('div', 'hero-icon'), { innerHTML: svg('<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8h10M7 12h10M7 16h6"/>', 28) }));
  hero.appendChild(el('h2', null, 'Scan an offering memorandum'));
  hero.appendChild(el('p', null, 'Choose the OM’s PDF, from Mail, Files or a download. Price, NOI, cap rate, size, occupancy, the rent roll and the lease terms are read straight from it.'));
  const acts = el('div', 'hero-actions');
  const pick = el('label', 'btn btn-teal btn-lg', 'Choose OM');
  pick.htmlFor = 'om-file';
  pick.addEventListener('pointerdown', () => getPdfjs().catch(() => {}), { once: true });
  acts.appendChild(pick);
  acts.appendChild(button('btn-lg', 'Enter figures by hand', () => { deal = newDeal(); try { localStorage.setItem(CUR_KEY, deal.id); } catch { /* fine */ } render(); touch(); }));
  hero.appendChild(acts);
  hero.appendChild(Object.assign(el('div', 'trust'), { innerHTML: `${svg('<path d="M12 3l7 3v5c0 4.5-3 8.4-7 10-4-1.6-7-5.5-7-10V6z"/>', 14)}Read on this device. The OM is never uploaded.` }));
  stack.appendChild(hero);

  const what = card('What you get');
  const ul = el('ul', 'list');
  for (const [t, s, p] of [
    ['Every figure with its page', 'tap a tag to see the line it came from, or pick another reading', '<path d="M4 6h16M4 12h10M4 18h7"/>'],
    ['What doesn’t add up', 'a stated cap rate that isn’t the NOI over the price, a $/SF on a different SF', '<path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/>'],
    ['Against your comps', 'premium or discount to the sale comps on the Comps tab, and value at their $/SF and cap rate', '<path d="M5 19V11M10 19V6M15 19v-9M20 19V4"/>'],
    ['Financing and loan sizing', 'DSCR, debt yield, cash-on-cash and the largest loan it supports', '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>'],
    ['Questions to ask', 'written from the gaps in this OM, to tick off on the walk', '<path d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>'],
    ['Site-visit notes and photos', 'kept with the deal, and on the one-page brief', '<path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/>'],
  ]) {
    const li = el('li');
    const ic = el('span', 'tool-icon');
    ic.style.cssText = 'width:34px;height:34px;border-radius:9px;background:var(--teal-soft);color:var(--teal)';
    ic.innerHTML = svg(p, 18);
    li.appendChild(ic);
    const m = el('div', 'li-main');
    m.appendChild(el('div', null, t)).style.fontWeight = '600';
    m.appendChild(el('div', 'li-sub', s)).style.whiteSpace = 'normal';
    li.appendChild(m);
    ul.appendChild(li);
  }
  what.appendChild(ul);

  const deals = await store.listDeals();
  if (root() !== r || deal || reading) return;          // something opened while the list loaded
  if (deals.length) {
    const saved = card('Saved deals', el('span', 'count', `${deals.length}`));
    const list = el('div', 'list');
    for (const d of deals.slice(0, 30)) {
      const b = el('button', 'li');
      b.type = 'button';
      const ic = el('span', 'deal-badge');
      ic.style.cssText = 'width:36px;height:36px;border-radius:10px';
      ic.innerHTML = svg('<path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6"/>', 18);
      b.appendChild(ic);
      const m = el('div', 'li-main');
      m.appendChild(el('div', 'li-title', d.name || d.figures?.address || 'Untitled deal'));
      const f = d.figures || {};
      m.appendChild(el('div', 'li-sub', [f.price ? short(f.price) : null, f.cap ? pct(f.cap) : null, f.bsf ? `${int(f.bsf)} SF` : null, niceDate(d.updatedAt)].filter(Boolean).join(' · ')));
      b.appendChild(m);
      b.insertAdjacentHTML('beforeend', svg('<path d="M9 6l6 6-6 6"/>', 16, ' class="chev"'));
      b.addEventListener('click', () => openDeal(d.id));
      list.appendChild(b);
    }
    saved.appendChild(list);
    stack.appendChild(saved);
  }
  stack.appendChild(what);
  r.appendChild(stack);
}

function renderDeal(r) {
  const f = deal.figures;
  const title = deal.name || f.address || 'Untitled deal';
  const more = button('btn-gray', null, dealMenu, '<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>');
  more.setAttribute('aria-label', 'More deal actions');
  r.appendChild(viewHead('Deal', null, [
    button('btn-primary', 'Excel', exportExcel, '<path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 20h14"/>'),
    button('', 'Share', shareSummary, '<path d="M12 15V3m0 0L8 7m4-4l4 4M6 11H5a1 1 0 00-1 1v8a1 1 0 001 1h14a1 1 0 001-1v-8a1 1 0 00-1-1h-1"/>'),
    more,
  ]));
  const stack = el('div', 'stack');

  // the header
  const head = el('section', 'card');
  const dh = el('div', 'deal-head');
  dh.appendChild(Object.assign(el('div', 'deal-badge'), { innerHTML: svg('<path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6"/>', 24) }));
  const t = el('div');
  t.style.minWidth = '0';
  const name = el('h2', null, title);
  try { name.contentEditable = 'plaintext-only'; } catch { name.contentEditable = 'true'; }
  name.spellcheck = false;
  name.title = 'Tap to rename';
  name.addEventListener('blur', () => { deal.name = name.textContent.trim(); touch(); });
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });
  t.appendChild(name);
  const where = [f.ptype, [f.city, f.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  t.appendChild(el('div', 'sub', [where, deal.source ? `${deal.source} · ${deal.pages} page${deal.pages === 1 ? '' : 's'}` : 'entered by hand'].filter(Boolean).join(' — ')));
  const chipsBox = el('div', 'chips');
  chipsBox.style.marginTop = '6px';
  if (deal.unpriced) chipsBox.appendChild(el('span', 'chip chip-warn', 'Unpriced'));
  if (deal.visit.at) chipsBox.appendChild(el('span', 'chip chip-teal', `Visited ${niceDate(deal.visit.at)}`));
  if (chipsBox.children.length) t.appendChild(chipsBox);
  dh.appendChild(t);
  head.appendChild(dh);
  const tiles = el('div', 'tiles');
  tiles.id = 'deal-tiles';
  head.appendChild(tiles);
  stack.appendChild(head);

  const checks = el('section', 'card');
  checks.id = 'deal-checks';
  stack.appendChild(checks);
  const comps = el('section', 'card');
  comps.id = 'deal-comps';
  stack.appendChild(comps);

  stack.appendChild(figuresCard());
  stack.appendChild(financeCard());
  const ladder = el('section', 'card');
  ladder.id = 'deal-ladder';
  stack.appendChild(ladder);
  const rr = el('section', 'card');
  rr.id = 'deal-rr';
  stack.appendChild(rr);
  const qs = el('section', 'card');
  qs.id = 'deal-q';
  stack.appendChild(qs);
  stack.appendChild(visitCard());

  const bottom = el('div', 'view-actions');
  bottom.style.cssText = 'justify-content:center;margin:6px 0 4px';
  bottom.appendChild(button('', 'Use as the comps subject', useAsSubject, '<path d="M5 12h14M13 6l6 6-6 6"/>'));
  if (!IN_ARTIFACT) bottom.appendChild(button('', 'One-page brief', printBrief, '<path d="M7 9V3h10v6M7 17H5a2 2 0 01-2-2v-4a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2h-2M7 14h10v7H7z"/>'));
  bottom.appendChild(button('btn-gray', 'All deals', closeDeal, '<path d="M15 6l-6 6 6 6"/>'));
  stack.appendChild(bottom);
  r.appendChild(stack);
  renderDerived();
}

/* The parts that follow from the figures: redrawn on every edit, while the
 * inputs themselves are left alone so the keyboard stays where it was. */
function renderDerived() {
  if (!deal || !$('deal-tiles')) return;
  const { m, comps } = metrics();
  const f = deal.figures;

  const tiles = $('deal-tiles');
  tiles.textContent = '';
  const tile = (k, v, s, cls) => {
    const t = el('div', `tile${cls ? ` ${cls}` : ''}`);
    t.appendChild(el('div', 'k', k));
    t.appendChild(el('div', 'v', v));
    if (s) t.appendChild(el('div', 's', s));
    tiles.appendChild(t);
  };
  tile('Asking price', ok(m.price) ? short(m.price) : (deal.unpriced ? 'Unpriced' : '—'), m.derived.price ? 'derived from NOI and cap' : (ok(m.ppsf) ? `${money2(m.ppsf)}/SF` : null));
  const capGap = ok(f.cap) && ok(m.capCalc) && Math.abs(f.cap - m.capCalc) >= 0.1;
  tile('Cap rate on ask', ok(m.cap) ? pct(m.cap) : '—', capGap ? `OM states ${pct(f.cap)}` : (ok(f.cap_pf) ? `${pct(f.cap_pf)} pro forma` : null), capGap ? 'warn' : '');
  tile('NOI', ok(m.noi) ? short(m.noi) : '—', m.derived.noi ? 'derived from price and cap' : (ok(m.noiPsf) ? `${money2(m.noiPsf)}/SF` : null));
  if (ok(m.perUnit)) tile('Per unit', short(m.perUnit), `${int(f.units)} units`);
  else if (ok(m.perLandSf) && !ok(m.ppsf)) tile('Per land SF', money2(m.perLandSf), f.zoning || null);
  const occ = m.leases && ok(m.leases.occupancy) ? m.leases.occupancy : f.occ;
  if (ok(occ)) tile('Occupancy', pct(occ, 1), m.leases && ok(m.leases.waltIncome) ? `WALT ${yrs(m.leases.waltIncome)}` : null, occ < 85 ? 'warn' : '');
  else if (ok(m.termLeft)) tile('Lease term left', yrs(m.termLeft), f.lease_type || null, m.termLeft < 5 ? 'warn' : '');
  tile('DSCR', ok(m.dscr) ? times(m.dscr) : '—', ok(m.cashOnCash) ? `cash-on-cash ${pct(m.cashOnCash, 1)}` : 'set loan terms below', ok(m.dscr) ? (m.dscr < 1.2 ? 'bad' : m.dscr < 1.25 ? 'warn' : 'good') : '');

  // what doesn't add up
  const checks = $('deal-checks');
  checks.textContent = '';
  checks.hidden = !m.checks.length;
  if (m.checks.length) {
    const h = el('div', 'card-head');
    h.appendChild(el('h2', null, 'What doesn’t add up'));
    h.appendChild(el('span', 'count', `${m.checks.length}`));
    checks.appendChild(h);
    const ul = el('ul', 'checks');
    for (const c of m.checks) {
      const li = el('li', c.level);
      li.innerHTML = svg(c.level === 'info' ? '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.5"/>' : '<path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/>', 18);
      li.appendChild(el('span', null, c.text));
      ul.appendChild(li);
    }
    checks.appendChild(ul);
  }

  // against the comps
  const cc = $('deal-comps');
  cc.textContent = '';
  const ch = el('div', 'card-head');
  ch.appendChild(el('h2', null, 'Against your comps'));
  cc.appendChild(ch);
  if (!comps) {
    const p = el('div', 'card-pad');
    p.style.paddingTop = '0';
    p.appendChild(el('p', 'hint', 'Load sale comps on the Comps tab and this shows the premium or discount to them, where the asking $/SF sits in their range, and the value at their $/SF and cap rate.'));
    const b = button('btn-sm', 'Go to Comps', () => api.showView('comps'));
    b.style.marginTop = '10px';
    p.appendChild(b);
    cc.appendChild(p);
  } else {
    ch.appendChild(el('span', 'count', `${comps.n} priced sale comp${comps.n === 1 ? '' : 's'}`));
    const t2 = el('div', 'tiles');
    const add = (k, v, s, cls) => { const x = el('div', `tile${cls ? ` ${cls}` : ''}`); x.appendChild(el('div', 'k', k)); x.appendChild(el('div', 'v', v)); if (s) x.appendChild(el('div', 's', s)); t2.appendChild(x); };
    add('Asking vs comps', ok(m.vsWeighted) ? signed(m.vsWeighted) : '—', ok(m.ppsf) ? `${money2(m.ppsf)} vs ${money2(comps.weighted)}/SF` : 'needs price and SF', ok(m.vsWeighted) ? (m.vsWeighted > 10 ? 'warn' : m.vsWeighted < -5 ? 'good' : '') : '');
    add('Value at comp $/SF', ok(m.valueAtWeighted) ? short(m.valueAtWeighted) : '—', `${money2(comps.weighted)}/SF weighted`);
    add('Value at comp cap', ok(m.valueAtMedianCap) ? short(m.valueAtMedianCap) : '—', comps.medianCap ? `${pct(comps.medianCap)} median of ${comps.capN}` : 'no comp cap rates');
    if (ok(m.ppsf)) {
      const lower = comps.ppsfs.filter((x) => x < m.ppsf).length;
      add('Comps priced lower', `${lower} of ${comps.n}`, lower === 0 ? 'cheapest $/SF in the set' : lower === comps.n ? 'dearest $/SF in the set' : 'by $/SF');
    }
    cc.appendChild(t2);
    if (ok(m.ppsf) && comps.lo !== null && comps.hi !== null) {
      const lo = Math.min(comps.lo, m.ppsf);
      const hi = Math.max(comps.hi, m.ppsf);
      const span = hi - lo || 1;
      const bar = el('div', 'posbar');
      bar.appendChild(el('div', 'track'));
      for (const x of comps.ppsfs) { const tk = el('div', 'tick'); tk.style.left = `${((x - lo) / span) * 100}%`; bar.appendChild(tk); }
      const me = el('div', 'me');
      me.style.left = `${((m.ppsf - lo) / span) * 100}%`;
      me.title = `This deal: ${money2(m.ppsf)}/SF`;
      bar.appendChild(me);
      cc.appendChild(bar);
      const lg = el('div', 'posbar-legend');
      lg.appendChild(el('span', null, money0(lo)));
      lg.appendChild(el('span', null, 'each tick a sale comp · the pill is this deal'));
      lg.appendChild(el('span', null, money0(hi)));
      cc.appendChild(lg);
    }
  }

  // financing results
  const fo = $('deal-fin-out');
  if (fo) {
    fo.textContent = '';
    const res = el('ul', 'results');
    const line = (k, v, strong, why) => { const li = el('li', strong ? 'strong' : null); const s = el('span', null, k); if (why) s.appendChild(el('span', 'why', why)); li.appendChild(s); li.appendChild(el('b', null, v)); res.appendChild(li); };
    line('Loan', money0(m.loan));
    line('Annual debt service', money0(m.debtService), false, ok(m.debtService) ? `${money0(m.debtService / 12)} a month` : null);
    line('DSCR', times(m.dscr), true);
    line('Debt yield', pct(m.debtYield));
    line('Cash flow after debt', money0(m.cashFlow));
    line('Equity, with closing', money0(m.equity));
    line('Cash-on-cash', pct(m.cashOnCash), true);
    line('Break-even occupancy', pct(m.breakEven, 1), false, 'expenses plus debt service over gross income');
    if (m.maxLoan) line('Largest loan it supports', money0(m.maxLoan.loan), true, `limited by ${m.maxLoan.binding}${m.maxLoan.tests.DSCR ? ` · DSCR test ${short(m.maxLoan.tests.DSCR)}` : ''}${m.maxLoan.tests['Debt yield'] ? ` · debt-yield test ${short(m.maxLoan.tests['Debt yield'])}` : ''}`);
    fo.appendChild(res);
  }

  // value across cap rates
  const ld = $('deal-ladder');
  ld.textContent = '';
  ld.hidden = !m.ladder.length;
  if (m.ladder.length) {
    const h = el('div', 'card-head');
    h.appendChild(el('h2', null, 'Value across cap rates'));
    h.appendChild(el('span', 'count', `on ${m.derived.noi ? 'derived ' : ''}NOI of ${money0(m.noi)}`));
    ld.appendChild(h);
    const t = el('table', 'mini');
    const tr0 = el('tr');
    for (const x of ['Cap rate', 'Value', '$/SF', 'vs asking']) tr0.appendChild(el('th', null, x));
    t.appendChild(tr0);
    for (const x of m.ladder) {
      const tr = el('tr', Math.abs(x.cap - (m.cap ?? -9)) < 0.13 ? 'hl' : null);
      tr.appendChild(el('td', null, pct(x.cap)));
      tr.appendChild(el('td', null, money0(x.value)));
      tr.appendChild(el('td', null, ok(x.ppsf) ? money2(x.ppsf) : '—'));
      tr.appendChild(el('td', null, ok(x.vsAsk) ? signed(x.vsAsk) : '—'));
      t.appendChild(tr);
    }
    const wrap = el('div', 'scroll');
    wrap.style.paddingBottom = '6px';
    wrap.appendChild(t);
    ld.appendChild(wrap);
  }

  renderRentRoll(m);
  renderQuestions(m);
}

/* ----------------------------------------------------------- figures card */

const CORE = new Set(['price', 'noi', 'cap', 'occ', 'address', 'city', 'state', 'ptype', 'bsf', 'lot_sf', 'year', 'zoning', 'gross', 'opex', 'taxes']);
const present = (k) => deal.figures[k] !== null && deal.figures[k] !== undefined && deal.figures[k] !== '';

function figuresCard() {
  const c = el('section', 'card');
  let hidden = 0;
  const h = el('div', 'card-head');
  h.appendChild(el('h2', null, 'Key figures'));
  h.appendChild(el('span', 'count', deal.source ? 'tap a tag to see its page' : 'type as you would say them: 4.5m, 850k, 6.25%'));
  c.appendChild(h);
  for (const [title, rows] of SECTIONS) {
    // the lease rows only when the OM has a lease to speak of
    if (title === 'Lease' && !rows.some(([k]) => deal.figures[k]) && !deal.showLease) {
      const b = button('btn-plain btn-sm', '+ Single-tenant lease terms', () => { deal.showLease = true; render(); });
      b.style.margin = '0 10px 10px';
      c.appendChild(b);
      continue;
    }
    const show = rows.filter(([k]) => title === 'Lease' || CORE.has(k) || present(k) || deal.showAll);
    hidden += rows.length - show.length;
    if (!show.length) continue;
    c.appendChild(el('div', 'sec-label', title)).style.margin = '12px 16px 4px';
    const ul = el('ul', 'figs');
    for (const [key, label, kind] of show) ul.appendChild(figRow(key, label, kind));
    c.appendChild(ul);
  }
  if (hidden) {
    const b = button('btn-plain btn-sm', `+ ${hidden} more field${hidden === 1 ? '' : 's'}: pro forma, units, stories…`, () => { deal.showAll = true; render(); });
    b.style.margin = '0 10px 12px';
    c.appendChild(b);
  }
  return c;
}

function figRow(key, label, kind) {
  const li = el('li');
  const lab = el('label', 'fl', label);
  const inp = el('input', kind === 'text' ? 'text' : 'n');
  inp.id = `fig-${key}`;
  lab.htmlFor = inp.id;
  if (key === 'lot_sf' && ok(deal.figures.lot_sf)) lab.appendChild(el('small', null, `${(deal.figures.lot_sf / 43560).toFixed(3)} acres`));
  inp.value = fmt(kind, deal.figures[key]);
  inp.autocomplete = 'off';
  if (kind !== 'text') inp.inputMode = 'decimal';
  inp.placeholder = kind === 'text' ? '' : '—';
  inp.addEventListener('change', () => {
    let v;
    if (kind === 'text') v = inp.value.trim() || null;
    else {
      v = parseNum(inp.value);
      if (kind === 'pct') v = asPercent(v);
      if (kind === 'year' && v !== null && (v < 1600 || v > 2100)) v = null;
    }
    setFigure(key, v);
    inp.value = fmt(kind, v);
    if (key === 'lot_sf') { const s = lab.querySelector('small'); if (s) s.textContent = ok(v) ? `${(v / 43560).toFixed(3)} acres` : ''; }
    srcHolder.replaceChildren(sourceTag(key));
  });
  li.appendChild(lab);
  li.appendChild(inp);
  const srcHolder = el('span');
  srcHolder.style.justifySelf = 'end';
  srcHolder.appendChild(sourceTag(key));
  li.appendChild(srcHolder);
  return li;
}

function setFigure(key, v) {
  const before = deal.figures[key];
  if (v === null || v === undefined || v === '') delete deal.figures[key]; else deal.figures[key] = v;
  const s = deal.sources[key];
  if (s) s.hand = s.orig !== v;
  else if (v !== null && v !== undefined) deal.sources[key] = { hand: true };
  if (key === 'address' && (!deal.name || deal.name === before)) deal.name = v || deal.name;
  touch();
  renderDerived();
}

function sourceTag(key) {
  const s = deal.sources[key];
  const m = analyze(figuresFor(deal), null);
  if (m.derived[key] && !ok(deal.figures[key])) {
    const t = el('span', 'src derived', 'derived');
    t.title = 'Worked out from the other figures';
    return t;
  }
  if (!s) return el('span', 'src none', '');
  if (s.hand && !s.page) return el('span', 'src hand', 'typed');
  if (!s.page && !s.hand) {
    const t = el('span', 'src low', 'guess');
    t.title = s.line || 'Inferred from the OM as a whole';
    return t;
  }
  const b = el('button', `src ${s.hand ? 'hand' : s.confidence || 'medium'}`);
  b.type = 'button';
  if (!s.hand) b.appendChild(el('i'));
  b.appendChild(document.createTextNode(s.hand ? 'edited' : `p.${s.page}`));
  b.style.cursor = 'pointer';
  b.setAttribute('aria-label', `${LABEL[key]}: where it came from`);
  b.addEventListener('click', () => showSource(key));
  return b;
}

function showSource(key) {
  const s = deal.sources[key];
  const kind = KIND[key];
  const body = api.sheetOpen({ eyebrow: 'From the OM', title: LABEL[key], sub: deal.source || '' });
  const conf = { high: 'Printed in a summary and repeated in the OM, or read from a clearly labelled line.', medium: 'Read from a labelled line. Worth a glance.', low: 'A weaker match: check it against the page.' }[s.confidence] || '';
  const sec = el('section');
  sec.appendChild(el('h3', null, `Page ${s.page}${s.count > 1 ? ` · printed ${s.count} times` : ''}`));
  sec.appendChild(el('div', 'snippet', s.line || ''));
  if (conf) sec.appendChild(el('p', 'hint-sm', conf)).style.marginTop = '8px';
  body.appendChild(sec);
  if (s.hand) {
    const sec2 = el('section');
    sec2.appendChild(el('h3', null, 'Changed by hand'));
    sec2.appendChild(el('p', 'hint', `The OM reads ${show(kind, s.orig)}; you have ${show(kind, deal.figures[key])}.`));
    const b = button('btn-sm', `Go back to ${show(kind, s.orig)}`, () => { pick(key, s.orig, { page: s.page, line: s.line }); });
    b.style.marginTop = '8px';
    sec2.appendChild(b);
    body.appendChild(sec2);
  }
  if (s.alts && s.alts.length) {
    const sec3 = el('section');
    sec3.appendChild(el('h3', null, 'Other readings in the OM'));
    const ul = el('div', 'list');
    ul.style.cssText = 'background:var(--surface-2);border-radius:13px';
    for (const a of s.alts) {
      const b = el('button', 'li');
      b.type = 'button';
      const m = el('div', 'li-main');
      m.appendChild(el('div', 'li-title', `${show(kind, a.value)} · page ${a.page}`));
      m.appendChild(el('div', 'li-sub', a.line));
      b.appendChild(m);
      b.appendChild(el('span', 'chip chip-accent', 'Use'));
      b.addEventListener('click', () => pick(key, a.value, a));
      ul.appendChild(b);
    }
    sec3.appendChild(ul);
    body.appendChild(sec3);
  }
}

function pick(key, value, from) {
  const s = deal.sources[key];
  if (value !== s.orig) {
    // the chosen reading becomes the OM's figure, and the old one an alternative
    s.alts = [{ value: s.orig, page: s.page, line: s.line }, ...(s.alts || []).filter((a) => a.value !== value)];
    s.orig = value;
    s.page = from.page;
    s.line = from.line;
  }
  deal.figures[key] = value;
  s.hand = false;
  touch();
  api.sheetClose();
  render();
}

/* --------------------------------------------------------- financing card */

function financeCard() {
  const c = el('section', 'card');
  const h = el('div', 'card-head');
  h.appendChild(el('h2', null, 'Financing'));
  h.appendChild(el('span', 'count', 'your terms are remembered for the next deal'));
  c.appendChild(h);
  const L = deal.loan;
  const g = el('div', 'grid-form');
  const num = (key, label, suffix) => {
    const fd = el('div', 'field');
    const lab = el('label', null, label);
    const i = el('input', 'n');
    i.id = `loan-${key}`;
    lab.htmlFor = i.id;
    i.inputMode = 'decimal';
    i.value = ok(L[key]) ? String(L[key]) : '';
    i.placeholder = suffix || '';
    i.addEventListener('change', () => {
      let v = parseNum(i.value);
      if (['ltv', 'rate', 'closing', 'minDy'].includes(key)) v = asPercent(v);
      L[key] = v;
      i.value = ok(v) ? String(v) : '';
      rememberLoan(L);
      touch();
      renderDerived();
    });
    fd.append(lab, i);
    g.appendChild(fd);
  };
  num('ltv', 'Loan to value %', '65');
  num('rate', 'Interest rate %', '6.75');
  num('amort', 'Amortization, years', '30');
  num('closing', 'Closing costs %', '2');
  num('minDscr', 'Lender minimum DSCR', '1.25');
  num('minDy', 'Lender minimum debt yield %', '8');
  const io = el('div', 'field');
  io.appendChild(el('span', 'lbl', 'Interest only'));
  const sw = el('label', 'switch');
  const cb = el('input');
  cb.type = 'checkbox';
  cb.checked = !!L.io;
  cb.setAttribute('aria-label', 'Interest only');
  cb.addEventListener('change', () => { L.io = cb.checked; rememberLoan(L); touch(); renderDerived(); });
  sw.appendChild(cb);
  io.appendChild(sw);
  g.appendChild(io);
  c.appendChild(g);
  const out = el('div');
  out.id = 'deal-fin-out';
  out.style.padding = '0 16px 16px';
  c.appendChild(out);
  return c;
}

/* --------------------------------------------------------------- rent roll */

function renderRentRoll(m) {
  const box = $('deal-rr');
  box.textContent = '';
  const rows = deal.rentRoll || [];
  box.hidden = !rows.length;
  if (!rows.length) return;
  const h = el('div', 'card-head');
  h.appendChild(el('h2', null, 'Rent roll'));
  h.appendChild(el('span', 'count', `${rows.length} row${rows.length === 1 ? '' : 's'}${deal.rentRollPage ? ` · page ${deal.rentRollPage}` : ''}`));
  box.appendChild(h);
  const L = m.leases;
  if (L) {
    const t = el('div', 'tiles');
    const add = (k, v, s, cls) => { const x = el('div', `tile${cls ? ` ${cls}` : ''}`); x.appendChild(el('div', 'k', k)); x.appendChild(el('div', 'v', v)); if (s) x.appendChild(el('div', 's', s)); t.appendChild(x); };
    add('WALT', yrs(L.waltIncome), ok(L.waltSf) ? `${yrs(L.waltSf)} by SF` : 'by income');
    add('Occupancy', pct(L.occupancy, 1), L.vacantSf ? `${int(L.vacantSf)} SF vacant` : null, ok(L.occupancy) && L.occupancy < 85 ? 'warn' : '');
    add('Rolling in 24 mo', pct(L.roll24Pct, 0), ok(L.roll12Pct) ? `${pct(L.roll12Pct, 0)} in 12` : null, L.roll24Pct >= 25 ? 'warn' : '');
    add('Average rent', ok(L.avgRentPsf) ? `${money2(L.avgRentPsf)}/SF` : '—', `${money0(L.rent)} a year`);
    box.appendChild(t);
  }
  const t = el('table', 'mini');
  const tr0 = el('tr');
  for (const x of ['Tenant', 'SF', 'Annual rent', '$/SF', 'Expires']) tr0.appendChild(el('th', null, x));
  t.appendChild(tr0);
  for (const r of rows) {
    const tr = el('tr');
    tr.appendChild(el('td', null, [r.suite, r.tenant].filter(Boolean).join(' · ')));
    tr.appendChild(el('td', null, ok(r.sf) ? int(r.sf) : '—'));
    tr.appendChild(el('td', null, r.vacant ? 'vacant' : money0(r.annual)));
    tr.appendChild(el('td', null, ok(r.psf) ? money2(r.psf) : '—'));
    tr.appendChild(el('td', null, r.mtm ? 'MTM' : r.end ? new Date(r.end).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—'));
    t.appendChild(tr);
  }
  const wrap = el('div', 'scroll');
  wrap.style.paddingBottom = '6px';
  wrap.appendChild(t);
  box.appendChild(wrap);
  const p = el('p', 'hint-sm', 'Read from the OM’s table: check it against the leases. The Excel download has it as a Rent Roll tab with live WALT.');
  p.style.padding = '4px 16px 14px';
  box.appendChild(p);
}

/* --------------------------------------------------------------- questions */

function renderQuestions(m) {
  const box = $('deal-q');
  box.textContent = '';
  const all = [...m.questions, ...deal.myQuestions];
  const h = el('div', 'card-head');
  h.appendChild(el('h2', null, 'Questions to ask'));
  const open = all.filter((q) => !deal.qDone[q]).length;
  h.appendChild(el('span', 'count', all.length ? `${open} open` : ''));
  box.appendChild(h);
  const ul = el('ul', 'qs');
  for (const q of all) {
    const li = el('li', deal.qDone[q] ? 'done' : null);
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = !!deal.qDone[q];
    cb.setAttribute('aria-label', `Asked: ${q}`);
    cb.addEventListener('change', () => { if (cb.checked) deal.qDone[q] = true; else delete deal.qDone[q]; touch(); renderQuestions(m); });
    li.appendChild(cb);
    li.appendChild(el('span', null, q));
    if (deal.myQuestions.includes(q)) {
      const x = el('button', 'iconbtn');
      x.type = 'button';
      x.innerHTML = svg('<path d="M6 6l12 12M18 6L6 18"/>', 15);
      x.setAttribute('aria-label', 'Remove this question');
      x.addEventListener('click', () => { deal.myQuestions = deal.myQuestions.filter((y) => y !== q); delete deal.qDone[q]; touch(); renderQuestions(m); });
      li.appendChild(x);
    }
    ul.appendChild(li);
  }
  if (!all.length) ul.appendChild(el('li', 'hint', 'Questions appear as the figures go in.'));
  box.appendChild(ul);
  const add = el('form', 'add-q');
  const i = el('input', 'input');
  i.placeholder = 'Add your own question';
  i.setAttribute('aria-label', 'Add your own question');
  add.appendChild(i);
  add.appendChild(button('btn-sm', 'Add', () => add.requestSubmit()));
  add.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = i.value.trim();
    if (!q || all.includes(q)) return;
    deal.myQuestions.push(q);
    touch();
    renderQuestions(m);
    const ni = $('deal-q').querySelector('.add-q input');
    if (ni) ni.focus();
  });
  box.appendChild(add);
}

/* -------------------------------------------------------------- site visit */

function visitCard() {
  const v = deal.visit;
  v.itemNotes ||= {};
  const c = el('section', 'card');
  const h = el('div', 'card-head');
  h.appendChild(el('h2', null, 'Site visit'));
  h.appendChild(el('span', 'count', v.at ? `started ${new Date(v.at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}` : 'a walk-through checklist, notes and photos'));
  const tools = el('div', 'tools');
  if (!v.at) tools.appendChild(button('btn-sm btn-teal', 'Start visit', () => { v.at = Date.now(); touch(); render(); }));
  h.appendChild(tools);
  c.appendChild(h);
  const grid = el('div', 'visit-grid');
  for (const [k, label] of VISIT) {
    const it = el('div', 'visit-item');
    it.appendChild(el('span', null, label));
    const tri = el('div', 'tri');
    for (const [val, txt] of [['ok', 'OK'], ['issue', 'Issue']]) {
      const b = el('button', val, txt);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(v.items[k] === val));
      b.setAttribute('aria-label', `${label}: ${txt}`);
      b.addEventListener('click', async () => {
        v.items[k] = v.items[k] === val ? null : val;
        if (!v.at) v.at = Date.now();
        tri.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(v.items[k] === x.className)));
        if (v.items[k] === 'issue') {
          const note = window.prompt(`${label}: what did you see? (optional)`, v.itemNotes[k] || '');
          if (note !== null) v.itemNotes[k] = note.trim();
        }
        touch();
      });
      tri.appendChild(b);
    }
    it.appendChild(tri);
    grid.appendChild(it);
  }
  c.appendChild(grid);
  const nf = el('div', 'field');
  nf.style.padding = '0 16px 12px';
  const lab = el('label', null, 'Notes');
  const ta = el('textarea');
  ta.id = 'visit-notes';
  lab.htmlFor = ta.id;
  ta.rows = 4;
  ta.placeholder = 'Who you met, what they said, anything the OM doesn’t mention…';
  ta.value = v.notes;
  ta.addEventListener('input', () => { v.notes = ta.value; touch(); });
  nf.append(lab, ta);
  c.appendChild(nf);
  const ph = el('div', 'photos');
  ph.id = 'deal-photos';
  c.appendChild(ph);
  renderPhotos(ph);
  return c;
}

function renderPhotos(into = null) {
  const ph = into || $('deal-photos');
  if (!ph) return;
  ph.textContent = '';
  for (const p of deal.visit.photos) {
    const d = el('div', 'photo');
    const img = el('img');
    const url = URL.createObjectURL(p.blob);
    photoUrls.push(url);
    img.src = url;
    img.alt = `Site photo, ${niceDate(p.at)}`;
    d.appendChild(img);
    const x = el('button');
    x.type = 'button';
    x.innerHTML = svg('<path d="M6 6l12 12M18 6L6 18"/>', 13);
    x.setAttribute('aria-label', 'Delete this photo');
    x.addEventListener('click', () => {
      const keep = deal.visit.photos;
      deal.visit.photos = keep.filter((q) => q !== p);
      touch();
      renderPhotos();
      toast('Photo deleted.', { label: 'Undo', run: () => { deal.visit.photos = keep; touch(); renderPhotos(); } });
    });
    d.appendChild(x);
    ph.appendChild(d);
  }
  const add = el('label', 'photo-add');
  add.htmlFor = 'photo-file';
  add.innerHTML = svg('<path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/>', 24);
  add.title = 'Add photos';
  add.setAttribute('aria-label', 'Add site photos');
  ph.appendChild(add);
}

/** A phone photo is 3-12 MB; 1600 pixels on the long side is plenty for a brief, at a tenth of the size. */
async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close && bmp.close();
    return await new Promise((res) => c.toBlob((b) => res(b || file), 'image/jpeg', 0.82));
  } catch { return file; }
}

async function addPhotos(files) {
  if (!deal) return;
  const list = [...files].filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|heic|webp)$/i.test(f.name));
  for (const f of list) deal.visit.photos.push({ id: `${Date.now()}${Math.random()}`, at: Date.now(), blob: await shrink(f) });
  if (!deal.visit.at) deal.visit.at = Date.now();
  touch();
  renderPhotos();
  if (list.length) toast(`${list.length} photo${list.length === 1 ? '' : 's'} added to the deal.`);
}

/* ---------------------------------------------------------------- actions */

function useAsSubject() {
  api.setSubject(deal.figures);
  api.showView('comps');
  toast('The deal is now the subject on the Comps tab: its value conclusions and pricing matrix use these figures.');
}

function fileBase() {
  const n = (deal.name || deal.figures.address || 'Deal').replace(/[^\w\s-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `Deal - ${n} (${localDate()})`;
}

async function exportExcel() {
  const btn = document.querySelector('#deal-root .view-head .btn-primary');
  if (btn) btn.classList.add('btn-busy');
  try {
    const libs = await getXlsx();
    const { buildDealWorkbook } = await import('./workbook.js');
    const { m, comps } = metrics();
    const bytes = await buildDealWorkbook(libs.ExcelJS, libs.fflate, { deal: workbookDeal(m), metrics: m, comps });
    if (await deliver(`${fileBase()}.xlsx`, bytes, XLSX) === 'done') toast('Deal workbook ready: blue figures are inputs, and every result is a live formula.');
  } catch (err) {
    deliveryError(err);
  } finally {
    if (btn) btn.classList.remove('btn-busy');
  }
}

async function shareSummary() {
  const { m, comps } = metrics();
  const text = dealSummaryText(deal, m, comps);
  const r = await shareText(deal.name || 'Deal', text);
  if (r === 'copied') toast('Summary copied: paste it into a text or an email.');
  else if (r === 'failed') toast('The browser blocked sharing and copying here.');
}

function printBrief() {
  const { m, comps } = metrics();
  const urls = deal.visit.photos.map((p) => { const u = URL.createObjectURL(p.blob); photoUrls.push(u); return u; });
  let preparedBy = '';
  try { preparedBy = (JSON.parse(localStorage.getItem('comp-loader.subject.v1') || '{}') || {}).preparedBy || ''; } catch { /* fine */ }
  renderDealBrief($('print-sheet'), { deal: { ...deal, activeQuestions: activeQuestions(m), visitLines: visitLines() }, m, comps, photos: urls, preparedBy });
  // images have to be decoded before the print snapshot is taken
  const imgs = [...$('print-sheet').querySelectorAll('img')];
  Promise.all(imgs.map((i) => (i.decode ? i.decode().catch(() => {}) : null))).then(() => window.print());
}

async function dealMenu() {
  const v = await actionSheet(deal.name || 'Deal', [
    { label: 'Copy summary', sub: 'five lines for a text or an email', value: 'copy', icon: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>' },
    ...(IN_ARTIFACT ? [] : [{ label: 'One-page brief', sub: 'print or save as PDF, with photos', value: 'brief', icon: '<path d="M7 9V3h10v6M7 17H5a2 2 0 01-2-2v-4a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2h-2M7 14h10v7H7z"/>' }]),
    { label: 'Use as the comps subject', value: 'subject', icon: '<path d="M5 12h14M13 6l6 6-6 6"/>' },
    { label: 'Open in Maps', value: 'map', disabled: !deal.figures.address, icon: '<path d="M12 21s-7-6.1-7-11a7 7 0 1114 0c0 4.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>' },
    '-',
    { label: 'Scan another OM…', value: 'new', icon: '<path d="M12 5v14M5 12h14"/>' },
    { label: 'All deals', value: 'close', icon: '<path d="M4 6h16M4 12h16M4 18h16"/>' },
    '-',
    { label: 'Delete this deal', value: 'delete', danger: true, icon: '<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>' },
  ]);
  if (v === 'copy') {
    const { m, comps } = metrics();
    const { copyText } = await import('./kit.js');
    toast((await copyText(dealSummaryText(deal, m, comps))) ? 'Summary copied.' : 'The browser blocked copying here.');
  } else if (v === 'brief') printBrief();
  else if (v === 'subject') useAsSubject();
  else if (v === 'map') window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(placeLine(deal.figures))}`, '_blank', 'noopener');
  else if (v === 'new') $('om-file').click();
  else if (v === 'close') closeDeal();
  else if (v === 'delete') {
    const gone = deal;
    await store.deleteDeal(gone.id);
    closeDeal();
    toast('Deal deleted.', { label: 'Undo', run: async () => { await store.saveDeal(gone); openDeal(gone.id); } });
  }
}

/* ------------------------------------------------------------------- start */

export function initDeal(compsApi) {
  api = compsApi;
  $('om-file').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; readOmFile(f); });
  $('photo-file').addEventListener('change', (e) => { const fs = [...e.target.files]; e.target.value = ''; addPhotos(fs); });
  document.addEventListener('omdrop', (e) => {
    const f = e.detail;
    if (/^image\//.test(f.type) && deal) addPhotos([f]);
    else readOmFile(f);
  });
  // the comps moved: the comparison follows
  document.addEventListener('compschange', () => { if (deal) renderDerived(); });
  render();
  let cur = null;
  try { cur = localStorage.getItem(CUR_KEY); } catch { cur = null; }
  if (cur) openDeal(cur, { quiet: true }).catch(() => {});
}

