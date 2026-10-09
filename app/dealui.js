/* dealui.js -- the Deal screen: an offering memorandum, read and worked through
 * on the spot.
 *
 * Built for a site visit with an owner, a seller or a manager standing there:
 * drop or pick the OM, and in a few seconds the key figures are on screen with
 * the page each came from, checked against each other, priced against the
 * comps already loaded, run through a loan, and turned into the questions
 * worth asking before leaving the building. Notes and photos from the visit
 * are kept with the deal, and the whole thing goes out as an Excel tab, a
 * deal brief or a five-line text.
 *
 * Deals are saved on the device (IndexedDB) after every change. */

import { readOm } from './om.js';
import { analyze, runScenario, scenarioAnswers } from './deal.js';
import * as store from './store.js';
import { renderDealBrief, dealSummaryText, placeLine } from './brief.js';
import { fromOmRows, project, rentRollSummary } from './lease.js';
import { emptyRentRoll, layoutFromPreset, presetFor, MARKET_UNIT, legacyRows } from './rentroll.js';
import { renderRentRollWorkspace } from './rentrollui.js';
import { openLibrary } from './libraryui.js';
import { openAiSettings, readWithAi, openAssistant, transcribeNote, openTranscript } from './aiui.js';
import { crossChecks } from './reconcile.js';
import {
  $, el, svg, IN_ARTIFACT, XLSX, parseNum, parsePct, int, dec, money0, money2, pct, signed, times, yrs, short, niceDate,
  localDate, toast, actionSheet, getPdfjs, getXlsx, deliver, deliveryError, shareText, idle, pdfProblem,
} from './kit.js';

let api = null;
let deal = null;          // the open deal
let reading = null;       // { name, done, total } while an OM is being read
let saveTimer = null;
let pending = null;       // the deal whose latest change has not reached storage yet
/* One object per deal for the whole session. A photo still shrinking or a
 * recording still running holds on to its deal; if that deal is closed and
 * opened again it must be the same object, or the late arrival would be
 * saved onto a stale copy over newer changes. */
const opened = new Map();
const deleted = new Set();  // a late photo or recording must not bring a deleted deal back
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
    ['gpr', 'Gross potential rent', 'money'], ['gross', 'Gross income (EGI)', 'money'], ['opex', 'Operating expenses', 'money'], ['taxes', 'Real estate taxes', 'money'],
  ]],
  ['Lease', [
    ['tenant', 'Tenant', 'text'], ['guarantor', 'Guarantor', 'text'], ['lease_type', 'Lease type', 'text'],
    ['lease_exp', 'Lease expiration', 'text'], ['term_left', 'Term remaining', 'text'], ['increases', 'Rent increases', 'text'],
    ['options', 'Renewal options', 'text'],
  ]],
];
const KIND = Object.fromEntries(SECTIONS.flatMap(([, rows]) => rows.map(([k, , kind]) => [k, kind])));
const LABEL = Object.fromEntries(SECTIONS.flatMap(([, rows]) => rows.map(([k, l]) => [k, l])));
/** The deal's fields for AI reading and the assistant: key, label, kind. */
const FIELD_LIST = SECTIONS.flatMap(([, rows]) => rows.map(([key, label, kind]) => ({ key, label, kind })));

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
    live: {}, scenarios: [], targets: { cap: null, irr: 15, value: null },
    visit: { at: null, items: {}, notes: '', photos: [], audio: [] },
    ...extra,
  };
}

/* An invented deal to try the screen with. Every figure is made up, the name
 * says so, and the header, brief and workbook carry the label. */
function exampleDeal() {
  const y = new Date().getFullYear();
  const iso = (yy, m, d) => new Date(Date.UTC(yy, m - 1, d)).toISOString();
  const f = {
    address: '100 Example Street (fictional)', city: 'Sampletown', state: 'MD', ptype: 'Retail', price: 4850000, noi: 315250, cap: 6.5, occ: 88,
    bsf: 10400, lot_sf: 15000, year: 1962, zoning: 'MU-4', gpr: 540000, gross: 482000, opex: 166750, taxes: 61200, noi_pf: 352000,
  };
  const sources = Object.fromEntries(Object.keys(f).map((k) => [k, { hand: true }]));
  return newDeal({
    name: 'Example deal: fictional sample', example: true, figures: f, sources,
    rentRoll: [
      { suite: '101', tenant: 'Sample Bakery (fictional)', sf: 2200, annual: 101200, psf: 46, end: iso(y + 3, 5, 31) },
      { suite: '102', tenant: 'Example Dental (fictional)', sf: 1800, annual: 79200, psf: 44, end: iso(y + 6, 8, 31) },
      { suite: '103', tenant: 'Vacant', sf: 1250, vacant: true },
      { suite: '201', tenant: 'Placeholder Law LLP (fictional)', sf: 3150, annual: 113400, psf: 36, end: iso(y + 1, 12, 31) },
      { suite: '202', tenant: 'Demo Fitness (fictional)', sf: 2000, annual: 72000, psf: 36, mtm: true },
    ],
    myQuestions: [],
  });
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
    // what was looked at on the walk-through, kept apart from what was said
    if (s || note) lines.push(`Observed, ${l.toLowerCase()}: ${s === 'ok' ? 'looked fine' : s === 'issue' ? 'needs attention' : 'noted'}${note ? ` (${note})` : ''}`);
  }
  if (v.notes.trim()) lines.push(...v.notes.trim().split(/\n+/).map((x) => `Note, as written: ${x}`));
  const n = (v.audio || []).length;
  const tr = (v.audio || []).filter((a) => a.transcript).length;
  if (n) lines.push(`${n} voice note${n === 1 ? '' : 's'} recorded on the visit (kept with the deal${tr ? `; ${tr} transcribed, check against the recording` : '; not transcribed'})`);
  return lines;
}

/** Each saved scenario, and the unsaved one if it differs from the deal, as a line of text. */
function scenarioLines(m) {
  const line = (name, over) => {
    const r = runScenario(figuresFor(deal), m, over, { noiSeries: over.noiBasis === 'rentroll' ? rentRollSeries(Number.isFinite(over.hold) ? over.hold : 5) : null });
    const changed = Object.entries(over).map(([k, v]) => {
      if (k === 'noiBasis') return v === 'rentroll' ? 'NOI from the rent roll' : null;
      const spec = SCN.find((x) => x[0] === k);
      return spec ? `${spec[1].replace(/, % change| %|, years/g, '').toLowerCase()} ${scnShow(spec[2], v)}` : null;
    }).filter(Boolean).join(', ');
    return `${name} (${changed}): price ${money0(r.inputs.price)}, NOI ${money0(r.m.noi)}, cap ${pct(r.m.capCalc)}, DSCR ${times(r.m.dscr)}, `
      + `levered IRR ${pct(r.returns?.leveredIrr, 1)} over ${r.inputs.hold} years at a ${pct(r.inputs.exitCap)} exit`;
  };
  const out = (deal.scenarios || []).map((sc) => line(sc.name, sc.over));
  if (deal.live && Object.keys(deal.live).length) out.unshift(line('Working scenario, unsaved', deal.live));
  return out;
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
    name: `${deal.example ? 'FICTIONAL SAMPLE — ' : ''}${deal.name || deal.figures.address}`, source: deal.source, readAt: deal.readAt,
    figures: { ...deal.figures, rentRoll: deal.rentRoll }, loan: deal.loan, sources: deal.sources, rr: deal.rr, example: !!deal.example,
    questions: activeQuestions(m), visitLines: visitLines(), scenarioLines: scenarioLines(m),
  };
}
export const currentDealName = () => (deal && hasFigures() ? (deal.name || deal.figures.address || 'Untitled deal') : null);
const hasFigures = () => deal && Object.values(deal.figures).some((v) => v !== null && v !== undefined && v !== '');

/* ---------------------------------------------------------------- saving */

/* Saves are debounced, and each one is tied to the deal it belongs to: a
 * change to one deal can never be written under another, and switching,
 * closing or leaving the app writes the last change first rather than
 * dropping it. */
function touch(d = deal) {
  if (!d || deleted.has(d.id)) return;
  if (!opened.has(d.id)) opened.set(d.id, d);
  d.updatedAt = Date.now();
  queueSave(d);
  if (d === deal) {
    document.dispatchEvent(new CustomEvent('dealchange'));
    badge();
  }
}
function queueSave(d) {
  if (pending && pending !== d) saveNow(pending);
  pending = d;
  writeRecovery(d);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushDeal, 400);
}
function saveNow(d) {
  const at = d.updatedAt;
  return store.saveDeal(d).then((ok) => { if (ok) clearRecovery(d.id, at); return ok; });
}
/** Write the pending change now. Resolves when storage has it (or has refused it). */
export function flushDeal() {
  clearTimeout(saveTimer);
  const d = pending;
  pending = null;
  return d ? saveNow(d) : Promise.resolve(true);
}

/* IndexedDB is asynchronous, and a browser tearing down a page (a reload, a
 * phone closing the app) abandons a transaction still in flight. So every
 * unsaved change is also mirrored, synchronously, to localStorage, without
 * the photos, and replayed when that deal next opens if storage never got it. */
const REC_KEY = 'comp-loader.deal.unsaved';
function writeRecovery(d) {
  try {
    const { visit, ...rest } = d;
    localStorage.setItem(REC_KEY, JSON.stringify({ ...rest, visit: { ...visit, photos: undefined, audio: undefined } }));
  } catch { /* storage full or blocked: IndexedDB still gets it */ }
}
function readRecovery() {
  try { return JSON.parse(localStorage.getItem(REC_KEY) || 'null'); } catch { return null; }
}
function clearRecovery(id, at) {
  const r = readRecovery();
  if (r && r.id === id && (r.updatedAt || 0) <= at) { try { localStorage.removeItem(REC_KEY); } catch { /* fine */ } }
}
/** The deal as storage has it, with any change that never reached storage put back. */
function recovered(id, stored) {
  const r = readRecovery();
  if (!r || r.id !== id || (stored && (r.updatedAt || 0) <= (stored.updatedAt || 0))) return { d: stored, replayed: false };
  // photos and recordings are Blobs, which only IndexedDB holds: they always come from there
  const photos = stored?.visit?.photos || [];
  const audio = stored?.visit?.audio || [];
  return { d: { ...(stored || {}), ...r, visit: { ...(r.visit || {}), photos, audio } }, replayed: true };
}
function dropPending(d) {
  if (pending === d) { clearTimeout(saveTimer); pending = null; }
}
function badge() {
  document.querySelectorAll('.tab[data-view="deal"] .badge').forEach((b) => {
    const qs = deal && hasFigures() ? analyze(figuresFor(deal), null).checks.filter((c) => c.level !== 'info').length : 0;
    b.hidden = !qs;
    b.textContent = qs ? String(qs) : '';
  });
}
async function openDeal(id, { quiet = false } = {}) {
  await flushDeal();
  if (opened.has(id)) {
    deal = opened.get(id);
    try { localStorage.setItem(CUR_KEY, deal.id); } catch { /* fine */ }
    render();
    document.dispatchEvent(new CustomEvent('dealchange'));
    badge();
    return;
  }
  const { d, replayed } = recovered(id, await store.loadDeal(id));
  if (!d) {
    if (!quiet) toast('That deal could not be opened.');
    try { localStorage.removeItem(CUR_KEY); } catch { /* fine */ }
    return;
  }
  deal = { ...newDeal(), ...d, visit: { ...newDeal().visit, ...(d.visit || {}) } };
  opened.set(deal.id, deal);
  try { localStorage.setItem(CUR_KEY, deal.id); } catch { /* fine */ }
  if (replayed) saveNow(deal);
  render();
  document.dispatchEvent(new CustomEvent('dealchange'));
  badge();
}
function closeDeal() {
  flushDeal();
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
  flushDeal();
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
    toast(`${file.name} can’t be read: ${pdfProblem(err, file)}`, null, 8000);
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

let renderSeq = 0;         // a newer render makes an older, still-loading one stand down
function render() {
  renderSeq += 1;
  for (const u of photoUrls) URL.revokeObjectURL(u);
  photoUrls = [];
  const r = root();
  r.textContent = '';
  if (reading) return renderReading(r);
  if (!deal) return renderLanding(r);
  if (ensureRentRoll(deal)) touch();
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
  const seq = renderSeq;
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
  acts.appendChild(button('btn-plain', 'Try a fictional example deal', () => { flushDeal(); deal = exampleDeal(); try { localStorage.setItem(CUR_KEY, deal.id); } catch { /* fine */ } render(); touch(); }));
  acts.appendChild(button('btn-lg', 'Enter figures by hand', () => { flushDeal(); deal = newDeal(); try { localStorage.setItem(CUR_KEY, deal.id); } catch { /* fine */ } render(); touch(); }));
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
    ['Site-visit notes and photos', 'kept with the deal, and on the deal brief', '<path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/>'],
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
  if (seq !== renderSeq || root() !== r || deal || reading) return;   // something else drew while the list loaded
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
  const named = deal;
  name.addEventListener('blur', () => { named.name = name.textContent.trim(); touch(named); });
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });
  t.appendChild(name);
  const where = [f.ptype, [f.city, f.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  t.appendChild(el('div', 'sub', [where, deal.source ? `${deal.source} · ${deal.pages} page${deal.pages === 1 ? '' : 's'}` : 'entered by hand'].filter(Boolean).join(' — ')));
  const chipsBox = el('div', 'chips');
  chipsBox.style.marginTop = '6px';
  if (deal.example) chipsBox.appendChild(el('span', 'chip chip-warn', 'Fictional sample: not a real property'));
  if (deal.unpriced) chipsBox.appendChild(el('span', 'chip chip-warn', 'Unpriced'));
  if (deal.visit.at) chipsBox.appendChild(el('span', 'chip chip-teal', `Visited ${niceDate(deal.visit.at)}`));
  if (chipsBox.children.length) t.appendChild(chipsBox);
  dh.appendChild(t);
  head.appendChild(dh);
  const tiles = el('div', 'tiles');
  tiles.id = 'deal-tiles';
  head.appendChild(tiles);
  stack.appendChild(head);

  // the deal's sections, one at a time: a tab bar rather than one endless page
  const tabs = el('div', 'seg');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Deal sections');
  const panes = {};
  for (const [key, label] of PANES) {
    const b = el('button', null, label);
    b.type = 'button';
    b.id = `tab-${key}`;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-controls', `pane-${key}`);
    b.addEventListener('click', () => showPane(key));
    b.addEventListener('keydown', (e) => {
      const i = PANES.findIndex(([k]) => k === key);
      const to = e.key === 'ArrowRight' ? PANES[(i + 1) % PANES.length] : e.key === 'ArrowLeft' ? PANES[(i - 1 + PANES.length) % PANES.length] : null;
      if (to) { e.preventDefault(); showPane(to[0]); $(`tab-${to[0]}`).focus(); }
    });
    tabs.appendChild(b);
    const p = el('div', 'pane stack');
    p.id = `pane-${key}`;
    p.setAttribute('role', 'tabpanel');
    p.setAttribute('aria-labelledby', b.id);
    panes[key] = p;
  }
  stack.appendChild(tabs);

  const checks = el('section', 'card');
  checks.id = 'deal-checks';
  panes.overview.appendChild(checks);
  const comps = el('section', 'card');
  comps.id = 'deal-comps';
  panes.overview.appendChild(comps);
  panes.overview.appendChild(figuresCard());
  panes.overview.appendChild(financeCard());
  const ladder = el('section', 'card');
  ladder.id = 'deal-ladder';
  panes.overview.appendChild(ladder);
  const rr = el('section', 'card');
  rr.id = 'deal-rr';
  panes.overview.appendChild(rr);
  const qs = el('section', 'card');
  qs.id = 'deal-q';
  panes.overview.appendChild(qs);
  const rrw = el('section', 'card rr-card');
  rrw.id = 'deal-rentroll';
  panes.rentroll.appendChild(rrw);
  panes.whatif.appendChild(scenarioCard());
  panes.visit.appendChild(visitCard());
  for (const p of Object.values(panes)) stack.appendChild(p);

  const bottom = el('div', 'view-actions');
  bottom.style.cssText = 'justify-content:center;margin:6px 0 4px';
  bottom.appendChild(button('', 'Use as the comps subject', useAsSubject, '<path d="M5 12h14M13 6l6 6-6 6"/>'));
  bottom.appendChild(button('', 'Fill my Excel template', openTemplates, '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5M9 13l2 2 4-4"/>'));
  if (!IN_ARTIFACT) bottom.appendChild(button('', 'Deal brief', printBrief, '<path d="M7 9V3h10v6M7 17H5a2 2 0 01-2-2v-4a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2h-2M7 14h10v7H7z"/>'));
  bottom.appendChild(button('btn-gray', 'All deals', closeDeal, '<path d="M15 6l-6 6 6 6"/>'));
  stack.appendChild(bottom);
  r.appendChild(stack);
  renderDerived();
  showPane(pane, { focus: false });
}

const PANES = [['overview', 'Overview'], ['rentroll', 'Rent roll'], ['whatif', 'What if'], ['visit', 'Site visit']];
let pane = 'overview';
function showPane(key, { focus = true } = {}) {
  if (!PANES.some(([k]) => k === key)) key = 'overview';
  pane = key;
  for (const [k] of PANES) {
    const p = $(`pane-${k}`); const t = $(`tab-${k}`);
    if (!p || !t) continue;
    p.hidden = k !== key;
    t.setAttribute('aria-selected', String(k === key));
    t.tabIndex = k === key ? 0 : -1;
  }
  if (key === 'rentroll') drawRentRoll();
  if (focus) { const t = $(`tab-${key}`); if (t) t.scrollIntoView({ block: 'nearest' }); }
}

/* --------------------------------------------------------------- rent roll */

/** A deal from before the rent roll existed gets one: the OM's table as documented periods. */
function ensureRentRoll(d) {
  if (d.rr) return false;
  const asOf = localDate();
  const bsf = d.figures && Number.isFinite(d.figures.bsf) ? d.figures.bsf : null;
  const preset = presetFor(d.figures && d.figures.ptype);
  if (d.rentRoll && d.rentRoll.length) {
    d.rr = fromOmRows(d.rentRoll, { asOf, page: d.rentRollPage, buildingSf: bsf });
    d.rr.columns = layoutFromPreset(preset);
    d.rr.preset = preset;
    d.rr.settings.marketUnit = MARKET_UNIT[preset] || 'psf_year';
  } else d.rr = emptyRentRoll(d.figures && d.figures.ptype, asOf, bsf);
  if (d.figures && Number.isFinite(d.figures.opex)) d.rr.settings.opex = d.figures.opex;
  d.schema = 2;
  return true;
}

function drawRentRoll() {
  const box = $('deal-rentroll');
  if (!box || !deal) return;
  renderRentRollWorkspace(box, deal, api, rentRollChanged);
}

/** Any rent roll edit: the flat rows the analysis reads follow, the deal saves, the analysis redraws. */
function rentRollChanged() {
  deal.rentRoll = legacyRows(deal.rr);
  touch();
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
    line(m.breakEvenBasis === 'egi' ? 'Break-even, share of current income' : 'Break-even occupancy', pct(m.breakEven, 1), false, BREAK_EVEN_WHY[m.breakEvenBasis] || 'needs expenses and gross income');
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
  renderScenario(m);
}

const BREAK_EVEN_WHY = {
  gpr: 'expenses plus debt service, over gross potential rent',
  'egi-occ': 'expenses plus debt service over gross income, scaled to the occupancy it was earned at; add gross potential rent for the exact figure',
  egi: 'expenses plus debt service over current gross income; add occupancy or gross potential rent to turn it into an occupancy',
};

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
  // where each kind of figure comes from, in one line
  const lg = el('div', 'lineage');
  lg.innerHTML = '<span class="src high"><i></i>p.4</span> read from the OM: green printed in a summary or more than once, blue a labelled line, amber a weak match · '
    + '<span class="src derived">derived</span> worked out from the others · <span class="src hand">edited</span> <span class="src hand">typed</span> entered by you · '
    + 'scenario figures live only in Live deal below.';
  c.appendChild(lg);
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
      v = kind === 'pct' ? parsePct(inp.value) : parseNum(inp.value);
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
  if (s.ai && !s.hand) {
    const b = el('button', `src ai${s.verified ? '' : ' unchecked'}`, `AI${s.page ? ` p.${s.page}` : ''}`);
    b.type = 'button';
    b.setAttribute('aria-label', `${LABEL[key]}: read by AI, where it came from`);
    b.addEventListener('click', () => showSource(key));
    return b;
  }
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
  if (s.ai) { showAiSource(key); return; }
  const body = api.sheetOpen({ eyebrow: 'From the OM', title: LABEL[key], sub: deal.source || '' });
  const conf = { high: 'Printed in a summary and repeated in the OM, or read from a clearly labelled line.', medium: 'Read from a labelled line. Worth a glance.', low: 'A weaker match: check it against the page.' }[s.confidence] || '';
  const sec = el('section');
  sec.appendChild(el('h3', null, `Page ${s.page}${s.count > 1 ? ` · printed ${s.count} times` : ''}`));
  sec.appendChild(el('div', 'snippet', s.line || ''));
  if (conf) sec.appendChild(el('p', 'hint-sm', conf)).style.marginTop = '8px';
  body.appendChild(sec);
  if (s.confirmed && s.confirmed.length) {
    const sc = el('section');
    sc.appendChild(el('h3', null, 'Also confirmed by'));
    for (const c of s.confirmed) sc.appendChild(el('p', 'hint-sm', `${c.by}: ${c.doc || ''}${c.page ? ` p.${c.page}` : ''}${c.verified ? ' (passage checked)' : ''} — “${c.line || ''}”`));
    body.appendChild(sc);
  }
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
      m.appendChild(el('div', 'li-title', `${show(kind, a.value)}${a.page ? ` · page ${a.page}` : ''}${a.ai ? ' · read by AI' : ''}`));
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
    s.ai = !!from.ai;
    s.doc = from.doc;
    s.verified = from.verified;
  }
  deal.figures[key] = value;
  // an earlier figure that was typed by hand goes back to being typed
  s.hand = !from.page && !from.ai && from.line === 'typed by hand';
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
      // closing costs are often under 1%, so "0.5" there means half a percent
      const v = key === 'closing' ? parsePct(i.value, { fraction: false })
        : ['ltv', 'rate', 'minDy'].includes(key) ? parsePct(i.value) : parseNum(i.value);
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

/* ------------------------------------------------------- live deal: what if */

/* A scenario is only the changes typed here, kept apart from the deal's own
 * figures: the OM's price and NOI never move unless "Save to deal" is tapped
 * and confirmed. Hold-period assumptions (years, growth, exit cap, sale costs)
 * are scenario assumptions too, and the Deal column uses the same ones, so
 * the two columns differ only by what was changed. */
const SCN = [
  ['price', 'Purchase price', 'money'], ['noi', 'NOI', 'money'],
  ['rentChange', 'Rents, % change', 'delta'], ['occ', 'Occupancy %', 'pct'], ['expenseChange', 'Expenses, % change', 'delta'],
  ['rate', 'Interest rate %', 'pct'], ['ltv', 'Loan to value %', 'pct'],
  ['exitCap', 'Exit cap rate %', 'pct'], ['hold', 'Hold, years', 'int'], ['growth', 'NOI growth a year %', 'delta'], ['saleCost', 'Sale costs %', 'pct0'],
];
const HOLD_KEYS = ['exitCap', 'hold', 'growth', 'saleCost', 'noiBasis'];
const scnShow = (kind, v) => {
  if (!ok(v)) return '';
  if (kind === 'money') return money0(v);
  if (kind === 'int') return String(Math.round(v));
  if (kind === 'delta') return `${v > 0 ? '+' : ''}${dec(v, 2)}%`;
  return `${dec(v, 2)}%`;
};
const scnRead = (kind, raw) => {
  if (kind === 'money') return parseNum(raw);
  if (kind === 'int') { const v = parseNum(raw); return ok(v) && v >= 1 && v <= 30 ? Math.round(v) : null; }
  if (kind === 'delta') { const v = parseNum(raw); return ok(v) && v > -100 && v < 1000 ? v : null; }
  if (kind === 'pct0') return parsePct(raw, { fraction: false });
  return parsePct(raw);
};

function scenarioCard() {
  deal.live ||= {};
  deal.scenarios ||= [];
  deal.targets ||= { cap: null, irr: 15, value: null };
  const c = el('section', 'card');
  c.id = 'deal-live';
  const h = el('div', 'card-head');
  h.appendChild(el('h2', null, 'Live deal: what if'));
  h.appendChild(el('span', 'count', 'changes here never alter the deal unless you save them to it'));
  c.appendChild(h);
  // where the hold-period NOI comes from
  const basis = el('div', 'scn-basis');
  const bl = el('label', null, 'NOI over the hold');
  bl.htmlFor = 'scn-noiBasis';
  const bs = el('select', 'compact');
  bs.id = 'scn-noiBasis';
  for (const [v, l] of [['om', 'The deal’s NOI, growing at the rate below'], ['rentroll', 'The rent roll’s projection, year by year']]) { const o = el('option', null, l); o.value = v; bs.appendChild(o); }
  bs.value = deal.live.noiBasis || 'om';
  bs.addEventListener('change', () => { if (bs.value === 'om') delete deal.live.noiBasis; else deal.live.noiBasis = bs.value; touch(); renderDerived(); });
  basis.append(bl, bs);
  c.appendChild(basis);
  const g = el('div', 'grid-form');
  g.id = 'scn-inputs';
  c.appendChild(g);
  const notes = el('div');
  notes.id = 'scn-notes';
  c.appendChild(notes);
  const out = el('div');
  out.id = 'scn-out';
  out.style.padding = '0 16px 6px';
  c.appendChild(out);
  const ans = el('div');
  ans.id = 'scn-answers';
  ans.style.padding = '6px 16px 6px';
  c.appendChild(ans);
  const acts = el('div', 'view-actions');
  acts.style.cssText = 'padding:8px 16px 16px';
  acts.appendChild(button('btn-sm', 'Reset to the deal', () => { deal.live = {}; touch(); render(); }));
  acts.appendChild(button('btn-sm', 'Save scenario', saveScenario));
  acts.appendChild(button('btn-sm btn-teal', 'Save to deal…', saveToDeal));
  c.appendChild(acts);
  const saved = el('div');
  saved.id = 'scn-saved';
  c.appendChild(saved);
  return c;
}

/** The rent roll's NOI for each year of the hold and the year after, or null. */
function rentRollSeries(hold) {
  const rr = deal.rr;
  if (!rr || !rr.leases.length || !Number.isFinite(rr.settings.opex)) return null;
  const years = Math.max(2, Math.round(Number.isFinite(hold) ? hold : 5) + 1);
  return project(rr, { years }).annual.map((y) => y.noi);
}

function renderScenario(m) {
  const g = $('scn-inputs');
  if (!g) return;
  const hold = Number.isFinite(deal.live.hold) ? deal.live.hold : 5;
  const ctx = { noiSeries: deal.live.noiBasis === 'rentroll' ? rentRollSeries(hold) : null };
  const run = runScenario(figuresFor(deal), m, deal.live, ctx);
  const base = run.base;
  // inputs: drawn once, then only their state changes, so the keyboard stays put
  if (!g.children.length) {
    for (const [key, label, kind] of SCN) {
      const fd = el('div', 'field');
      fd.dataset.key = key;
      const lab = el('label', null, label);
      const i = el('input', 'n');
      i.id = `scn-${key}`;
      lab.htmlFor = i.id;
      i.inputMode = 'decimal';
      i.autocomplete = 'off';
      i.addEventListener('change', () => {
        const v = scnRead(kind, i.value);
        if (v === null) delete deal.live[key]; else deal.live[key] = v;
        touch();
        renderDerived();
      });
      fd.append(lab, i);
      g.appendChild(fd);
    }
  }
  for (const [key, , kind] of SCN) {
    const fd = g.querySelector(`[data-key="${key}"]`);
    const i = fd.querySelector('input');
    const changed = ok(deal.live[key]);
    fd.classList.toggle('changed', changed);
    if (document.activeElement !== i) i.value = changed ? scnShow(kind, deal.live[key]) : '';
    const was = kind === 'delta' ? (key === 'growth' ? `${dec(base.growth, 2)}% assumed` : 'no change') : (ok(base[key]) ? scnShow(kind, base[key]) : '—');
    i.placeholder = was;
    i.title = changed ? `Scenario: ${scnShow(kind, deal.live[key])}; the deal has ${was}` : `The deal has ${was}`;
  }

  const nb = $('scn-notes');
  nb.textContent = '';
  for (const t of run.notes) { const p = el('p', 'hint-sm', t); p.style.padding = '0 16px 8px'; nb.appendChild(p); }

  // the Deal column uses the deal's figures with the same hold assumptions
  const holdOnly = Object.fromEntries(Object.entries(deal.live).filter(([k]) => HOLD_KEYS.includes(k)));
  const dealRun = runScenario(figuresFor(deal), m, holdOnly, ctx);
  const box = $('scn-out');
  box.textContent = '';
  const t = el('table', 'mini scn');
  const tr0 = el('tr');
  for (const x of ['', 'Deal', 'Scenario']) tr0.appendChild(el('th', null, x));
  t.appendChild(tr0);
  const A = dealRun; const B = run;
  const rows = [
    ['Price', (r) => money0(r.inputs.price)],
    ['NOI, year 1', (r) => money0(r.m.noi)],
    ['Cap rate', (r) => pct(r.m.capCalc)],
    ['Price / SF', (r) => money2(r.m.ppsf)],
    ['Loan', (r) => money0(r.m.loan)],
    ['DSCR', (r) => times(r.m.dscr)],
    ['Debt yield', (r) => pct(r.m.debtYield)],
    ['Cash-on-cash, year 1', (r) => pct(r.m.cashOnCash)],
    ['Equity, with closing', (r) => money0(r.m.equity)],
    [`Exit value, year ${B.inputs.hold}`, (r) => money0(r.returns?.exitValue)],
    ['Levered IRR', (r) => pct(r.returns?.leveredIrr)],
    ['Equity multiple', (r) => (ok(r.returns?.leveredMultiple) ? `${r.returns.leveredMultiple.toFixed(2)}x` : '—')],
    ['Unlevered IRR', (r) => pct(r.returns?.unleveredIrr)],
  ];
  for (const [label, f] of rows) {
    const tr = el('tr');
    const a = f(A); const b = f(B);
    tr.appendChild(el('td', null, label));
    tr.appendChild(el('td', null, a));
    tr.appendChild(el('td', a !== b ? 'scn-diff' : null, b));
    t.appendChild(tr);
  }
  const wrap = el('div', 'scroll');
  wrap.appendChild(t);
  box.appendChild(wrap);
  const s = B.inputs;
  const p = el('p', 'hint-sm', `Returns: ${s.hold}-year hold, ${B.series ? 'NOI year by year from the rent roll projection' : `NOI growing ${dec(s.growth, 2)}% a year`}, sold at a ${ok(s.exitCap) ? pct(s.exitCap) : '—'} cap on the following year's NOI, less ${dec(s.saleCost, 2)}% sale costs and the loan balance. All scenario assumptions: change them above.`);
  p.style.marginTop = '8px';
  box.appendChild(p);

  // answers to the questions a buyer asks, on the scenario's terms
  const tg = deal.targets;
  const a = scenarioAnswers(figuresFor(deal), m, deal.live, { targetCap: tg.cap ?? (ok(s.exitCap) ? Math.round((m.cap ?? s.exitCap) * 4 + 1) / 4 : null), targetIrr: tg.irr, capForValue: tg.value ?? s.exitCap }, ctx);
  const ab = $('scn-answers');
  ab.textContent = '';
  ab.appendChild(el('div', 'sec-label', 'Answers, on the scenario’s terms'));
  const res = el('ul', 'results');
  const ask = (label, key, val, fmt, why) => {
    const li = el('li');
    const left = el('span');
    const txt = el('span', null, label);
    const i = el('input', 'n scn-target');
    i.inputMode = 'decimal';
    i.value = ok(val) ? dec(val, 2) : '';
    i.setAttribute('aria-label', `${label} target, percent`);
    i.addEventListener('change', () => { const v = parsePct(i.value); tg[key] = ok(v) && v > 0 && v < 100 ? v : null; touch(); renderDerived(); });
    left.append(txt, i, el('span', null, '%'));
    if (why) left.appendChild(el('span', 'why', why));
    li.appendChild(left);
    li.appendChild(el('b', null, fmt));
    res.appendChild(li);
  };
  const capT = tg.cap ?? (ok(s.exitCap) ? Math.round((m.cap ?? s.exitCap) * 4 + 1) / 4 : null);
  ask('Price for a cap rate of', 'cap', capT, money0(a.priceForCap), ok(s.noi) ? `NOI ${money0(s.noi)} ÷ cap rate` : 'needs NOI');
  ask('Price for a levered IRR of', 'irr', tg.irr, money0(a.priceForIrr), a.priceForIrr ? 'same loan terms, hold and exit' : 'not reachable on these terms, or needs an exit cap');
  ask('Value at a cap rate of', 'value', tg.value ?? s.exitCap, money0(a.valueAtCap), null);
  const li = el('li');
  li.appendChild(el('span', null, 'Equity needed, with closing costs'));
  li.appendChild(el('b', null, money0(a.equity)));
  res.appendChild(li);
  ab.appendChild(res);

  renderSavedScenarios(m);
}

function renderSavedScenarios(m) {
  const box = $('scn-saved');
  if (!box) return;
  box.textContent = '';
  if (!deal.scenarios.length) return;
  box.appendChild(el('div', 'sec-label', 'Saved scenarios')).style.margin = '0 16px 6px';
  const list = el('div', 'list');
  list.style.cssText = 'margin:0 16px 14px;background:var(--surface-2);border-radius:13px';
  for (const sc of deal.scenarios) {
    const r = runScenario(figuresFor(deal), m, sc.over, { noiSeries: sc.over.noiBasis === 'rentroll' ? rentRollSeries(Number.isFinite(sc.over.hold) ? sc.over.hold : 5) : null });
    const row = el('div', 'li');
    const main = el('div', 'li-main');
    main.appendChild(el('div', 'li-title', sc.name));
    const sub = el('div', 'li-sub', [short(r.inputs.price), `${pct(r.m.capCalc)} cap`, `${times(r.m.dscr)} DSCR`, `${pct(r.returns?.leveredIrr, 1)} levered IRR`].join(' · '));
    sub.style.whiteSpace = 'normal';
    main.appendChild(sub);
    row.appendChild(main);
    const use = button('btn-plain btn-sm', 'Load', () => { deal.live = { ...sc.over }; touch(); render(); toast(`Loaded “${sc.name}”. The deal itself is unchanged.`); });
    const del = el('button', 'iconbtn');
    del.type = 'button';
    del.innerHTML = svg('<path d="M6 6l12 12M18 6L6 18"/>', 15);
    del.setAttribute('aria-label', `Delete scenario ${sc.name}`);
    del.addEventListener('click', () => {
      const d = deal;
      const keep = d.scenarios;
      d.scenarios = keep.filter((x) => x !== sc);
      touch(d);
      renderDerived();
      toast('Scenario deleted.', { label: 'Undo', run: () => { d.scenarios = keep; touch(d); if (deal === d) renderDerived(); } });
    });
    row.append(use, del);
    list.appendChild(row);
  }
  box.appendChild(list);
}

function saveScenario() {
  if (!Object.keys(deal.live).length) { toast('Change a figure first: the scenario is what differs from the deal.'); return; }
  const n = deal.scenarios.length + 1;
  const name = (window.prompt('Name this scenario', `Scenario ${n}`) || '').trim();
  if (!name) return;
  deal.scenarios.push({ id: `s${Date.now().toString(36)}`, name, at: Date.now(), over: { ...deal.live } });
  touch();
  renderDerived();
  toast(`Saved “${name}”. The deal’s own figures are unchanged.`);
}

/* The one way a scenario reaches the deal: asked for, confirmed, and marked as typed. */
function saveToDeal() {
  const L = deal.live;
  if (!Object.keys(L).length) { toast('Nothing to save: the scenario matches the deal.'); return; }
  const { m } = metrics();
  const run = runScenario(figuresFor(deal), m, L);
  const writes = [];
  if (ok(L.price)) writes.push(['price', run.inputs.price, `price ${money0(run.inputs.price)}`]);
  if (ok(L.noi) || ok(L.rentChange) || ok(L.expenseChange) || ok(L.occ)) writes.push(['noi', run.m.noi, `NOI ${money0(run.m.noi)}`]);
  if (ok(L.occ)) writes.push(['occ', L.occ, `occupancy ${pct(L.occ, 1)}`]);
  const loanKeys = ['rate', 'ltv'].filter((k) => ok(L[k]));
  const parts = [...writes.map((w) => w[2]), ...loanKeys.map((k) => `${k === 'rate' ? 'rate' : 'LTV'} ${pct(L[k])}`)];
  const holdNote = HOLD_KEYS.some((k) => ok(L[k])) ? '\n\nHold, growth, exit cap and sale costs stay with the scenario: the deal has no such figures.' : '';
  if (!parts.length) { toast('Only hold-period assumptions are changed; they stay with the scenario.'); return; }
  if (!window.confirm(`Write ${parts.join(', ')} into the deal?\n\nThe OM’s own figures stay one tap away on each page tag.${holdNote}`)) return;
  for (const [k, v] of writes) {
    deal.figures[k] = v;
    const s = deal.sources[k];
    if (s) s.hand = s.orig !== v; else deal.sources[k] = { hand: true };
  }
  // a cap rate that no longer matches the new price and NOI would be flagged as a discrepancy
  for (const k of loanKeys) deal.loan[k] = L[k];
  const kept = Object.fromEntries(Object.entries(L).filter(([k]) => HOLD_KEYS.includes(k)));
  deal.live = kept;
  touch();
  render();
  toast('Saved to the deal. Figures you changed are tagged “edited”.');
}

/* --------------------------------------------------------------- rent roll */

function renderRentRoll(m) {
  const box = $('deal-rr');
  if (!box) return;
  box.textContent = '';
  const rr = deal.rr;
  const n = rr ? rr.leases.length : 0;
  const h = el('div', 'card-head');
  h.appendChild(el('h2', null, 'Rent roll'));
  h.appendChild(el('span', 'count', n ? `${n} unit${n === 1 ? '' : 's'}${deal.rentRollPage ? ` · read from OM page ${deal.rentRollPage}` : ''}` : 'none yet'));
  box.appendChild(h);
  if (n) {
    const sum = rentRollSummary(rr, rr.settings.asOf);
    const t = el('div', 'tiles');
    const add = (k, v, s2, cls) => { const x = el('div', `tile${cls ? ` ${cls}` : ''}`); x.appendChild(el('div', 'k', k)); x.appendChild(el('div', 'v', v)); if (s2) x.appendChild(el('div', 's', s2)); t.appendChild(x); };
    add('In-place rent', short(sum.annualRent), `as of ${rr.settings.asOf}`);
    add('Occupancy', pct(sum.occupancy, 1), sum.totalSf ? `${int(sum.leasedSf)} SF leased` : null, ok(sum.occupancy) && sum.occupancy < 85 ? 'warn' : '');
    add('WALT', yrs(sum.waltIncome), 'by income');
    const soon = sum.expirations.filter((e) => typeof e.year === 'number' && e.year <= new Date().getFullYear() + 1).reduce((x, e) => x + (e.rentPct || 0), 0);
    add('Expiring by next year-end', pct(soon, 0), 'of rent', soon >= 25 ? 'warn' : '');
    box.appendChild(t);
    // the rent roll against the OM's own figures (reconcile.js: arithmetic, no AI)
    const issues = crossChecks(deal.figures, sum);
    if (issues.length) {
      const ul = el('ul', 'rr-checks');
      ul.id = 'deal-rr-checks';
      for (const i of issues) ul.appendChild(el('li', i.level === 'warn' ? 'warn-text' : null, i.text));
      box.appendChild(ul);
    }
    // the OM's own gross income against what the rent roll adds up to
    const P = project(rr, { years: 1 }).annual[0];
    if (Number.isFinite(deal.figures.gross) && P && P.egi) {
      const gap = (P.egi / deal.figures.gross - 1) * 100;
      if (Math.abs(gap) > 5) {
        const p = el('p', 'hint-sm', `The rent roll projects ${money0(P.egi)} of effective gross income over the next twelve months; the OM states ${money0(deal.figures.gross)} (${gap > 0 ? '+' : ''}${gap.toFixed(1)}%). Check which leases, recoveries or other income explain it.`);
        p.style.padding = '0 16px 10px';
        box.appendChild(p);
      }
    }
  } else {
    const p = el('p', 'hint');
    p.style.padding = '0 16px 6px';
    p.textContent = 'No rent roll yet. Add units by hand, import one from Excel or CSV, or read an OM that prints one.';
    box.appendChild(p);
  }
  const b = button('btn-sm', n ? 'Open the rent roll' : 'Start a rent roll', () => showPane('rentroll'));
  b.style.margin = '0 16px 16px';
  box.appendChild(b);
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
  const au = el('div', 'voice');
  au.id = 'deal-audio';
  c.appendChild(au);
  renderAudio(au);
  return c;
}

/* ------------------------------------------------------------ voice notes */

/* Recorded with the microphone, or a Voice Memos file added, and kept with
 * the deal as audio. Nothing is transcribed: that needs a speech-to-text
 * service, which would mean sending the recording off the device, and this
 * app has none. The screen says so rather than pretending. */
let rec = null;            // { mr, d, start, timer } while recording

function renderAudio(into = null) {
  const box = into || $('deal-audio');
  if (!box || !deal) return;
  box.textContent = '';
  const v = deal.visit;
  v.audio ||= [];
  const head = el('div', 'voice-head');
  head.appendChild(el('span', 'sec-label', 'Voice notes'));
  const recording = rec && rec.d === deal;
  const recBtn = button(recording ? 'btn-sm btn-danger' : 'btn-sm', recording ? `Stop · ${clock((Date.now() - rec.start) / 1000)}` : 'Record', () => (rec ? stopRec() : startRec()),
    recording ? '<rect x="7" y="7" width="10" height="10" rx="2"/>' : '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>');
  recBtn.id = 'rec-btn';
  head.appendChild(recBtn);
  const add = el('label', 'btn btn-sm btn-gray', 'Add audio file');
  const fi = el('input');
  fi.type = 'file';
  fi.accept = 'audio/*,.m4a,.mp3,.wav,.aac,.caf';
  fi.multiple = true;
  fi.hidden = true;
  fi.id = 'audio-file';
  fi.addEventListener('change', () => { const fs = [...fi.files]; fi.value = ''; addAudioFiles(fs); });
  add.htmlFor = fi.id;
  head.append(add, fi);
  box.appendChild(head);
  for (const a of v.audio) {
    const row = el('div', 'voice-row');
    const meta = el('div', 'voice-meta');
    meta.appendChild(el('b', null, a.name || 'Voice note'));
    meta.appendChild(el('span', null, [new Date(a.at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }), ok(a.seconds) ? clock(a.seconds) : null].filter(Boolean).join(' · ')));
    row.appendChild(meta);
    const au = el('audio');
    au.controls = true;
    au.preload = 'metadata';
    const url = URL.createObjectURL(a.blob);
    photoUrls.push(url);
    au.src = url;
    row.appendChild(au);
    const x = el('button', 'iconbtn');
    x.type = 'button';
    x.innerHTML = svg('<path d="M6 6l12 12M18 6L6 18"/>', 14);
    x.setAttribute('aria-label', `Delete ${a.name || 'voice note'}`);
    x.addEventListener('click', () => {
      const d = deal;
      const keep = d.visit.audio;
      d.visit.audio = keep.filter((q) => q !== a);
      touch(d);
      renderAudio();
      toast('Voice note deleted.', { label: 'Undo', run: () => { d.visit.audio = keep; touch(d); if (deal === d) renderAudio(); } });
    });
    row.appendChild(x);
    const acts = el('div', 'voice-acts');
    if (a.transcript) {
      acts.appendChild(button('btn-sm btn-gray', a.transcript.reviewed ? 'Transcript' : 'Transcript (not yet checked)', () => openTranscript(aiHost(), a)));
    } else acts.appendChild(button('btn-sm btn-gray', 'Transcribe…', () => transcribeNote(aiHost(), a)));
    row.appendChild(acts);
    box.appendChild(row);
  }
  box.appendChild(el('p', 'hint-sm', v.audio.length
    ? 'Kept on this device with the deal. Transcribe sends a recording to your firm’s AI server only when you ask (AI settings, in the deal’s ⋯ menu).'
    : 'Record what the owner or manager says, or add a Voice Memos file. Kept with the deal on this device.'));
}

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

async function startRec() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
    toast('This browser can’t record here. Record in Voice Memos, then add the file.');
    return;
  }
  const d = deal;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    toast(err && err.name === 'NotAllowedError'
      ? 'Microphone access was refused. Allow it for this site in Settings, or record in Voice Memos and add the file.'
      : `The microphone could not start (${err && err.message ? err.message : err}). Record in Voice Memos and add the file instead.`, null, 8000);
    return;
  }
  const type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
  let mr;
  try { mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined); } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    toast(`Recording could not start: ${err.message || err}`);
    return;
  }
  const chunks = [];
  const start = Date.now();
  mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  mr.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    clearInterval(rec && rec.timer);
    rec = null;
    const blob = new Blob(chunks, { type: mr.mimeType || type || 'audio/mp4' });
    if (!blob.size) { toast('Nothing was recorded. Check the microphone and try again.'); if (deal === d) renderAudio(); return; }
    const n = (d.visit.audio || []).length + 1;
    (d.visit.audio ||= []).push({ id: `a${Date.now().toString(36)}`, at: start, blob, name: `Voice note ${n}`, seconds: (Date.now() - start) / 1000 });
    if (!d.visit.at) d.visit.at = start;
    touch(d);
    if (deal === d) renderAudio();
    toast(`Voice note saved to ${deal === d ? 'the deal' : d.name || 'the earlier deal'}.`);
  };
  mr.start(1000);
  rec = { mr, d, start, timer: setInterval(() => { const b = $('rec-btn'); if (b && rec && rec.d === deal) b.querySelector('span').textContent = `Stop · ${clock((Date.now() - rec.start) / 1000)}`; }, 500) };
  renderAudio();
}

function stopRec() {
  if (rec && rec.mr.state !== 'inactive') rec.mr.stop();
}

async function addAudioFiles(files) {
  const d = deal;
  if (!d) return;
  const list = files.filter((f) => /^audio\//.test(f.type) || /\.(m4a|mp3|wav|aac|caf|ogg|webm)$/i.test(f.name));
  const empty = list.filter((f) => !f.size);
  const good = list.filter((f) => f.size);
  if (!list.length) { toast('Those are not audio files.'); return; }
  for (const f of good) {
    const seconds = await new Promise((res) => {
      const a = new Audio();
      const u = URL.createObjectURL(f);
      const done = (v) => { URL.revokeObjectURL(u); res(v); };
      a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? a.duration : null);
      a.onerror = () => done(null);
      setTimeout(() => done(null), 4000);
      a.src = u;
    });
    (d.visit.audio ||= []).push({ id: `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, at: f.lastModified || Date.now(), blob: f, name: f.name.replace(/\.[^.]+$/, ''), seconds });
  }
  if (good.length) touch(d);
  if (deal === d) renderAudio();
  toast(`${good.length} voice note${good.length === 1 ? '' : 's'} added.${empty.length ? ` ${empty.length} empty file${empty.length === 1 ? '' : 's'} skipped.` : ''}`);
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
      const d = deal;
      const keep = d.visit.photos;
      d.visit.photos = keep.filter((q) => q !== p);
      touch(d);
      renderPhotos();
      // the undo belongs to this deal, even if another one is open by the time it is tapped
      toast('Photo deleted.', { label: 'Undo', run: () => { d.visit.photos = keep; touch(d); if (deal === d) renderPhotos(); } });
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
  } catch {
    // a format this browser can't decode (HEIC outside Safari) can't be shown
    // or printed either: keep only what an <img> can draw
    return /^image\/(jpeg|png|webp|gif)$/i.test(file.type) ? file : null;
  }
}

async function addPhotos(files) {
  // shrinking takes a moment per photo; the photos belong to the deal that was
  // open when they were chosen, whatever is open by the time they are ready
  const d = deal;
  if (!d) return;
  const list = [...files].filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|heic|webp)$/i.test(f.name));
  const skipped = files.length - list.length;
  if (!list.length) { toast(skipped ? 'Those files are not photos.' : 'No photos were chosen.'); return; }
  let added = 0;
  for (const f of list) {
    const blob = await shrink(f);
    if (!blob) continue;
    d.visit.photos.push({ id: `${Date.now()}${Math.random().toString(36).slice(2)}`, at: Date.now(), blob, name: f.name });
    added += 1;
  }
  if (!d.visit.at) d.visit.at = Date.now();
  touch(d);
  if (deal === d) renderPhotos();
  const where = deal === d ? 'the deal' : `${d.name || 'the earlier deal'}`;
  const failed = list.length - added;
  toast(`${added} photo${added === 1 ? '' : 's'} added to ${where}.${failed ? ` ${failed} could not be read (HEIC needs Safari; share as JPEG).` : ''}${skipped ? ` ${skipped} non-photo file${skipped === 1 ? '' : 's'} skipped.` : ''}`);
}

/* ---------------------------------------------------------------- actions */

/* ------------------------------------------------------ firm templates */

/** Everything a template can draw on for this deal: figures, analysis, rent roll, scenario. */
function templateContext(d) {
  const comps = api.count() ? api.basis() : null;
  const m = analyze(figuresFor(d), comps);
  const rr = d.rr && d.rr.leases.length ? d.rr : null;
  let preparedBy = '';
  try { preparedBy = (JSON.parse(localStorage.getItem('comp-loader.subject.v1') || '{}') || {}).preparedBy || ''; } catch { /* fine */ }
  const hold = Number.isFinite((d.live || {}).hold) ? d.live.hold : 5;
  const series = (d.live || {}).noiBasis === 'rentroll' && rr && Number.isFinite(rr.settings.opex) ? project(rr, { years: hold + 1 }).annual.map((y) => y.noi) : null;
  return {
    deal: d, m, rrSum: rr ? rentRollSummary(rr, rr.settings.asOf) : null, rrProj: rr && Number.isFinite(rr.settings.opex) ? project(rr) : null,
    scenario: runScenario(figuresFor(d), m, d.live || {}, { noiSeries: series }), preparedBy, today: new Date(),
  };
}
/** The open deal for the Tools screen: its figures, analysis, rent roll and scenario, or null. */
export function dealForTools() {
  if (!deal || !hasFigures()) return null;
  const ctx = templateContext(deal);
  return { name: deal.name || deal.figures.address || 'Untitled deal', figures: { ...deal.figures }, loan: { ...deal.loan }, live: { ...(deal.live || {}) }, m: ctx.m, rrSum: ctx.rrSum, rrProj: ctx.rrProj, scenario: ctx.scenario };
}

/**
 * The one way a tool's result reaches the deal: called only after the person
 * confirmed. Figures written are tagged as typed (with the tool named), loan
 * terms replace the deal's, and hold assumptions go to the What-if scenario,
 * never to the deal's own figures.
 */
export function applyFromTools({ figures = {}, loan = {}, live = {} }, toolTitle) {
  if (!deal) return false;
  for (const [k, v] of Object.entries(figures)) {
    if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) continue;
    deal.figures[k] = v;
    const s = deal.sources[k];
    if (s) { s.hand = s.orig !== v; s.tool = toolTitle; } else deal.sources[k] = { hand: true, tool: toolTitle };
  }
  for (const [k, v] of Object.entries(loan)) if (v !== null && v !== undefined) deal.loan[k] = v;
  deal.live = { ...(deal.live || {}), ...Object.fromEntries(Object.entries(live).filter(([, v]) => v !== null && v !== undefined)) };
  touch();
  render();
  return true;
}

/* ------------------------------------------------------------------- AI */

/** What the AI screens need from the open deal. */
function aiHost() {
  const d = deal;
  return {
    api, fields: FIELD_LIST, deal: () => d,
    touch: () => touch(d),
    apply: (entries) => { if (deal === d) applyReviewed(entries); },
    context: () => {
      const ctx = templateContext(d);
      return { m: ctx.m, scenario: ctx.scenario, rrSum: ctx.rrSum, comps: api.count() ? api.basis() : null, issues: ctx.rrSum ? crossChecks(d.figures, ctx.rrSum) : [] };
    },
  };
}

/**
 * Figures the broker accepted from an AI reading. The figure the deal had
 * stays as an alternative reading, so it is one tap to go back.
 */
function applyReviewed(entries) {
  for (const { key, value, source } of entries) {
    if (!(key in KIND) || value === null || value === undefined) continue;
    const before = deal.figures[key];
    const s = deal.sources[key];
    // the same figure the OM reader already found: keep its source, note the confirmation
    if (s && !s.hand && !s.ai && s.page && (before === value || (ok(before) && ok(value) && Math.abs(before - value) < 1e-9))) {
      s.confirmed = [...(s.confirmed || []), { by: source.via === 'voice note' ? 'a call' : 'AI reading', doc: source.doc, page: source.page, line: source.line, verified: source.verified }];
      continue;
    }
    const alts = [];
    if (before !== null && before !== undefined && before !== '' && before !== value) {
      alts.push(s && !s.hand ? { value: s.orig ?? before, page: s.page || null, line: s.line || '', ai: !!s.ai, doc: s.doc, verified: s.verified } : { value: before, page: null, line: 'typed by hand', ai: false });
    }
    deal.figures[key] = value;
    deal.sources[key] = { ...source, orig: value, hand: false, alts: [...alts, ...((s && s.alts) || []).filter((a) => a.value !== value)] };
    if (key === 'address' && !deal.name) deal.name = value;
  }
  touch();
  render();
}

function showAiSource(key) {
  const s = deal.sources[key];
  const body = api.sheetOpen({ eyebrow: s.via === 'voice note' ? 'Said on a call' : 'Read by AI', title: LABEL[key], sub: `${s.doc || ''}${s.page ? `, page ${s.page}` : ''}` });
  const sec = el('section');
  sec.appendChild(el('h3', null, s.verified ? 'The passage, checked against the document' : 'The passage (not found word for word: check it)'));
  sec.appendChild(el('div', 'snippet', s.line || ''));
  sec.appendChild(el('p', 'hint-sm', `${s.model ? `Read by ${s.model}. ` : ''}Accepted by you from the AI review; AI reading can still be wrong.`)).style.marginTop = '8px';
  body.appendChild(sec);
  if (s.alts && s.alts.length) {
    const sec3 = el('section');
    sec3.appendChild(el('h3', null, 'Earlier readings'));
    const ul = el('div', 'list');
    ul.style.cssText = 'background:var(--surface-2);border-radius:13px';
    for (const a of s.alts) {
      const b = el('button', 'li');
      b.type = 'button';
      const m = el('div', 'li-main');
      m.appendChild(el('div', 'li-title', `${show(KIND[key], a.value)}${a.page ? ` · page ${a.page}` : ''}${a.ai ? ' · read by AI' : ''}`));
      m.appendChild(el('div', 'li-sub', a.line || ''));
      b.appendChild(m);
      b.appendChild(el('span', 'chip chip-accent', 'Use'));
      b.addEventListener('click', () => pick(key, a.value, a));
      ul.appendChild(b);
    }
    sec3.appendChild(ul);
    body.appendChild(sec3);
  }
}

function chooseForAi() {
  const fi = el('input');
  fi.type = 'file';
  fi.multiple = true;
  fi.accept = '.pdf,.txt,.csv,.md,application/pdf,text/plain,text/csv';
  fi.id = 'ai-files';
  fi.hidden = true;
  fi.addEventListener('change', () => { const files = [...fi.files]; fi.remove(); readWithAi(aiHost(), files); });
  document.body.appendChild(fi);
  fi.click();
}

export function openTemplates() {
  return openLibrary(api, { getDeal: () => (deal && hasFigures() ? deal : null), ctxFor: templateContext });
}

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
  renderDealBrief($('print-sheet'), { deal: { ...deal, activeQuestions: activeQuestions(m), visitLines: visitLines(), scenarioLines: scenarioLines(m) }, m, comps, photos: urls, preparedBy });
  // images have to be decoded before the print snapshot is taken
  const imgs = [...$('print-sheet').querySelectorAll('img')];
  Promise.all(imgs.map((i) => (i.decode ? i.decode().catch(() => {}) : null))).then(() => window.print());
}

async function dealMenu() {
  const v = await actionSheet(deal.name || 'Deal', [
    { label: 'Copy summary', sub: 'five lines for a text or an email', value: 'copy', icon: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>' },
    ...(IN_ARTIFACT ? [] : [{ label: 'Deal brief', sub: 'print or save as PDF, with photos', value: 'brief', icon: '<path d="M7 9V3h10v6M7 17H5a2 2 0 01-2-2v-4a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2h-2M7 14h10v7H7z"/>' }]),
    { label: 'Fill my Excel template…', sub: 'your firm’s underwriting or rent roll workbook', value: 'template', icon: '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/>' },
    { label: 'Use as the comps subject', value: 'subject', icon: '<path d="M5 12h14M13 6l6 6-6 6"/>' },
    '-',
    { label: 'Read documents with AI…', sub: 'OM, rent roll, T-12 or lease: figures to check, page by page', value: 'ai-read', icon: '<path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z"/><path d="M5 17l.9 2.1L8 20l-2.1.9L5 23l-.9-2.1L2 20l2.1-.9z"/>' },
    { label: 'Ask about this deal…', sub: 'answers from this deal’s figures, with sources', value: 'ai-ask', icon: '<path d="M21 12a8 8 0 01-11.6 7.1L4 21l1.9-5.4A8 8 0 1121 12z"/>' },
    { label: 'AI settings…', value: 'ai-settings', icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>' },
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
  else if (v === 'template') openTemplates();
  else if (v === 'ai-read') chooseForAi();
  else if (v === 'ai-ask') openAssistant(aiHost());
  else if (v === 'ai-settings') openAiSettings(api);
  else if (v === 'map') window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(placeLine(deal.figures))}`, '_blank', 'noopener');
  else if (v === 'new') $('om-file').click();
  else if (v === 'close') closeDeal();
  else if (v === 'delete') {
    const gone = deal;
    dropPending(gone);
    clearRecovery(gone.id, Infinity);
    opened.delete(gone.id);
    deleted.add(gone.id);
    await store.deleteDeal(gone.id);
    deal = null;
    closeDeal();
    toast('Deal deleted.', { label: 'Undo', run: async () => { deleted.delete(gone.id); await store.saveDeal(gone); openDeal(gone.id); } });
  }
}

/* ------------------------------------------------------------------- start */

export function initDeal(compsApi) {
  api = compsApi;
  // a phone suspends a page it has hidden, and may never resume it: the last
  // change goes to storage the moment the app leaves the screen
  const flushNow = () => { flushDeal(); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushNow(); });
  window.addEventListener('pagehide', flushNow);
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
  replayRecovery().then(() => { if (cur) return openDeal(cur, { quiet: true }); return deal ? null : render(); }).catch(() => {});
}

/** A change the last session made but storage never received goes in now, before anything reads the deals. */
async function replayRecovery() {
  const r = readRecovery();
  if (!r || !r.id) return;
  const { d, replayed } = recovered(r.id, await store.loadDeal(r.id));
  if (replayed && d) await saveNow({ ...newDeal(), ...d, visit: { ...newDeal().visit, ...(d.visit || {}) } });
}

