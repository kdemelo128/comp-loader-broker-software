/* tests/impact-cases.js -- deals for the dependency map's tests: a rent roll
 * that uses every lease feature the projection reads (market rents, each
 * recovery method, percentage rent, abatements, one-time items, a vacant unit
 * let up, a month-to-month tenant, renewal terms on one lease), and ways to
 * change each input. Not a test file itself. */
import { DEFAULT_SETTINGS } from '../app/lease.js';

const lease = (id, unit, tenant, sf, start, end, rate, extra = {}) => ({
  id, unit, tenant, sf, leaseStart: start, rentStart: null, leaseEnd: end, unitType: '', deposit: null, arrears: null, options: '', notes: '', custom: {},
  periods: rate === null ? [] : [{ start, end, rate, unit: 'psf_year', source: 'documented' }, ...(extra.steps || [])],
  abatements: [], ...extra,
});

/** A rent roll with every feature in use, as of 2026-06-30. */
export function richRentRoll() {
  const leases = [
    lease('a', '100', 'Anchor Grocer', 20000, '2019-01-01', '2029-12-31', 18, {
      steps: [{ start: '2030-01-01', end: '2034-12-31', rate: 20, unit: 'psf_year', source: 'documented' }],
      leaseEnd: '2034-12-31', recovery: { method: 'prorata', share: null }, percentRent: { rate: 2, sales: 9e6, breakpoint: 7e6, natural: false, growth: 2 },
      marketRent: 21, marketUnit: 'psf_year',
    }),
    lease('b', '110', 'Coffee Co', 1500, '2022-03-01', '2027-02-28', 42, { recovery: { method: 'base_year', baseAmount: 120000 }, abatements: [{ start: '2026-06-01', end: '2026-08-31', pct: 50 }] }),
    lease('c', '120', 'Nail Salon', 1200, '2021-07-01', '2026-12-31', 38, { recovery: { method: 'stop', stopPsf: 4 }, renewal: { probability: 90, termMonths: 36, downtime: 2 } }),
    lease('d', '130', 'Dentist', 2400, '2023-01-01', '2032-12-31', 36, { recovery: { method: 'fixed', amount: 9000, growth: 3 }, oneTime: [{ date: '2027-03-01', amount: 15000, label: 'termination fee' }] }),
    lease('e', '140', '', 3000, null, null, null, { vacant: true, marketRent: 30, marketUnit: 'psf_year', leaseUpMonths: 9 }),
    lease('f', '150', 'Phone Store', 1000, '2018-05-01', null, 40, { mtm: true, periods: [{ start: '2018-05-01', end: '2026-07-31', rate: 40, unit: 'psf_year', source: 'documented' }] }),
    lease('g', '160', 'Pizza', 1800, '2024-02-01', '2031-01-31', 34, { recovery: { method: 'prorata', share: 6 }, marketRent: 4000, marketUnit: 'month' }),
  ];
  return {
    settings: {
      ...DEFAULT_SETTINGS, asOf: '2026-06-30', years: 10, marketRent: 32, marketUnit: 'psf_year', marketGrowth: 3, opex: 310000, expenseGrowth: 3,
      recoverable: 280000, generalVacancy: 5, reservesPsf: 0.25, otherIncome: [{ label: 'Parking', annual: 24000, growth: 2 }], leaseUpMonths: 6, buildingSf: 32000,
      renewal: { ...DEFAULT_SETTINGS.renewal, newTi: 15, newLc: 6, renewTi: 5, renewLc: 3 },
    },
    leases,
    columns: null,
  };
}

/** A different value of the same kind, for trying a change: never equal to `v`. */
export function nudge(v, key = '') {
  if (typeof v === 'number') return v === 0 ? 1 : Math.round(v * 1.37 * 1e4) / 1e4 + (Number.isInteger(v) ? 1 : 0);
  if (typeof v === 'boolean') return !v;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) { const d = new Date(`${v}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 17); return d.toISOString().slice(0, 10); }
  if (typeof v === 'string') return `${v || key} changed`;
  if (v === null || v === undefined) return key === 'io' ? true : 7;
  return v;
}

/** Changes to a lease's fields, as the grid and the lease sheet make them: field → (lease) => void. */
export const LEASE_CHANGES = {
  unit: (L) => { L.unit = `${L.unit}x`; }, tenant: (L) => { L.tenant = `${L.tenant || 'New'} Inc`; }, unitType: (L) => { L.unitType = 'Inline'; },
  sf: (L) => { L.sf = Math.round((L.sf || 1000) * 1.37); }, status: (L) => { L.vacant = !L.vacant; L.mtm = false; },
  leaseStart: (L) => { L.leaseStart = '2020-02-01'; }, rentStart: (L) => { L.rentStart = '2026-09-01'; },
  leaseEnd: (L) => { L.leaseEnd = L.leaseEnd ? '2028-03-31' : '2029-06-30'; },
  rent: (L) => { if (!L.periods.length) L.periods.push({ start: '2026-01-01', end: '2030-12-31', rate: 30, unit: 'psf_year', source: 'documented' }); for (const p of L.periods) p.rate *= 1.37; },
  abatements: (L) => { L.abatements = [{ start: '2026-05-01', end: '2027-04-30', pct: 25 }]; },
  marketRent: (L) => { L.marketRent = 27; L.marketUnit = 'psf_year'; },
  recovery: (L) => { L.recovery = L.recovery ? { ...L.recovery, share: 9, baseAmount: 90000, stopPsf: 6, amount: 12000 } : { method: 'prorata' }; },
  percentRent: (L) => { L.percentRent = { rate: 3, sales: 4e6, breakpoint: 1e6, natural: false }; },
  oneTime: (L) => { L.oneTime = [{ date: '2028-01-01', amount: 5000 }]; }, renewal: (L) => { L.renewal = { probability: 10, downtime: 12 }; },
  leaseUpMonths: (L) => { L.leaseUpMonths = 2; }, deposit: (L) => { L.deposit = 5000; }, arrears: (L) => { L.arrears = 700; },
  options: (L) => { L.options = 'One 5-year'; }, notes: (L) => { L.notes = 'n'; }, custom: (L) => { L.custom = { x: 1 }; },
  source: (L) => { L.source = { kind: 'import', file: 'x.csv' }; },
};
/** Changes to the rent roll's Assumptions. */
export const SETTING_CHANGES = {
  asOf: (s) => { s.asOf = '2027-01-31'; }, years: (s) => { s.years = 7; }, marketRent: (s) => { s.marketRent = 25; }, marketUnit: (s) => { s.marketUnit = 'psf_month'; },
  marketGrowth: (s) => { s.marketGrowth = 6; }, opex: (s) => { s.opex = (s.opex || 300000) * 1.3; }, expenseGrowth: (s) => { s.expenseGrowth = 5; }, recoverable: (s) => { s.recoverable = 200000; },
  generalVacancy: (s) => { s.generalVacancy = 9; }, reservesPsf: (s) => { s.reservesPsf = 0.5; }, otherIncome: (s) => { s.otherIncome = [{ annual: 50000, growth: 0 }]; },
  leaseUpMonths: (s) => { s.leaseUpMonths = 12; }, buildingSf: (s) => { s.buildingSf = 50000; },
  renewal: (s) => { s.renewal = { ...s.renewal, probability: 20, newTi: 30, termMonths: 84, downtime: 9, newFree: 6, escalation: 1 }; },
};

/* ------------------------------------------------ everything a deal shows */

import ExcelJS from 'exceljs';
import * as fflate from 'fflate';
import { valuesOf, analysisInput, hasRentRoll, affects, DEAL_SHEET_ROWS, DEAL_SHEET_HEADINGS, BRIEF_HEADINGS, LIVE_KEYS } from '../app/impact.js';
import { DEAL_INPUTS } from '../app/dealfields.js';
import { setConventions } from '../app/engine/conventions.js';

// the exporters draw on the page's helpers (kit.js), which look for a window
globalThis.window ||= {};
globalThis.document ||= { addEventListener() {}, dispatchEvent() {} };
let X = null;
const exporters = async () => (X ||= { ...(await import('../app/workbook.js')), ...(await import('../app/rrbook.js')), ...(await import('../app/brief.js')) });
import { analyze } from '../app/deal.js';

/** A stand-in for the page, enough for the brief to be drawn into. */
export function fakeDocument() {
  const doc = {};
  doc.createElement = (tag) => ({
    tag, className: '', children: [], own: null, ownerDocument: doc,
    appendChild(c) { this.children.push(c); return c; }, append(...cs) { this.children.push(...cs); },
    get textContent() { return this.own ?? this.children.map((c) => c.textContent).join(' '); },
    set textContent(v) { this.own = v === '' ? null : String(v); this.children = []; },
  });
  return doc;
}

/** What the workbook and the brief are given besides the analysis (dealui workbookDeal, printBrief), as plain lines. */
function extras(deal, values, m) {
  const questions = [...m.questions, ...(deal.myQuestions || [])].filter((q) => !(deal.qDone || {})[q]);
  const visitLines = Object.entries((deal.visit && deal.visit.items) || {}).map(([k, v]) => `${k}: ${v}`);
  const scenarioLines = [...values.keys()].filter((k) => k.startsWith('scenario:')).map((k) => `${k} ${JSON.stringify(values.get(k))}`);
  return { questions, visitLines, scenarioLines };
}

/** The brief, by section (map ids). */
export async function briefSections(deal, m, comps, extra, preparedBy) {
  const { renderDealBrief } = await exporters();
  const doc = fakeDocument();
  const box = doc.createElement('div');
  renderDealBrief(box, { deal: { ...deal, activeQuestions: extra.questions, visitLines: extra.visitLines, scenarioLines: extra.scenarioLines }, m, comps, preparedBy });
  const out = new Map();
  let cur = null;
  const add = (t) => { if (cur && t) out.set(cur, `${out.get(cur) || ''}|${t}`); };
  const walk = (n) => {
    const before = cur;
    if (n.className === 'ps-head') cur = 'brief.head';
    if (n.className === 'ps-stats') cur = 'brief.stats';
    if (n.className === 'ps-foot') return;
    if (n.tag === 'h2') { const h = BRIEF_HEADINGS.find(([re]) => re.test(n.textContent)); cur = h ? `brief.${h[1]}` : `brief.?${n.textContent}`; }
    if (n.own !== null) add(n.own);
    for (const c of n.children) walk(c);
    if (n.className === 'ps-head' || n.className === 'ps-stats') cur = before;
  };
  walk(box);
  return out;
}

const cellText = (v) => (v && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify('result' in v ? v.result : v) : JSON.stringify(v ?? null));

/** The workbooks' cells, by the map id each row or sheet is. */
export async function workbookParts(deal, m, comps, extra) {
  const { buildDealWorkbook, buildRentRollWorkbook } = await exporters();
  const out = new Map();
  const add = (id, t) => out.set(id, `${out.get(id) || ''}|${t}`);
  const rr = hasRentRoll(deal);
  const wdeal = { name: deal.name || deal.figures.address, source: deal.source, readAt: deal.readAt, figures: { ...deal.figures, rentRoll: deal.rentRoll }, loan: deal.loan, sources: deal.sources || {}, rr: rr ? deal.rr : null, questions: extra.questions, visitLines: extra.visitLines, scenarioLines: extra.scenarioLines };
  const books = [await buildDealWorkbook(ExcelJS, fflate, { deal: wdeal, metrics: m, comps })];
  if (rr) books.push(await buildRentRollWorkbook(ExcelJS, fflate, { deal, rr: deal.rr }));
  for (const bytes of books) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes);
    wb.eachSheet((ws) => {
      if (ws.name === 'Deal Analysis') {
        let section = 'title';
        ws.eachRow((row, r) => {
          const text = row.values.map(cellText).join(',');
          if (r <= 3) { add('xlsx.deal.title', text); return; }
          if (r < 50) { add(DEAL_SHEET_ROWS[r] ? `xlsx.deal.B${r}` : `xlsx.deal.row${r}`, text); return; }
          const head = String(row.getCell(1).value || '');
          const h = DEAL_SHEET_HEADINGS.find(([re]) => re.test(head));
          if (h) section = h[1];
          add(`xlsx.deal.${section}`, text);
        });
      } else {
        const id = !rr && ws.name === 'Rent Roll' ? 'xlsx.deal.omRentRoll' : ['Rent Roll', 'Lease Schedule', 'Cash Flow'].includes(ws.name) ? `xlsx.rr.${ws.name}` : `xlsx.?${ws.name}`;
        ws.eachRow((row) => add(id, row.values.map(cellText).join(',')));
      }
    });
  }
  return out;
}

/** Everything a deal shows, by map id: values, and with `files` the workbooks, the brief and the summary. */
export async function everything(deal, { comps = null, preparedBy = 'A. Broker', files = false, today } = {}) {
  const { values } = valuesOf(deal, { comps, preparedBy, today });
  const out = new Map([...values].map(([k, v]) => [k, JSON.stringify(v ?? null)]));
  if (files) {
    const m = analyze(analysisInput(deal), comps);
    const extra = extras(deal, values, m);
    for (const [k, v] of await workbookParts(deal, m, comps, extra)) out.set(k, v);
    for (const [k, v] of await briefSections(deal, m, comps, extra, preparedBy)) out.set(k, v);
    out.set('summary', (await exporters()).dealSummaryText(deal, m, comps));
  }
  return out;
}

/* ----------------------------------------------- changes, and what they move */

const SAMPLE = { money: 1250000, money2: 41.5, pct: 7.25, int: 5400, year: 1999, text: 'Something' };
const TEXT = { lease_exp: 'January 31, 2031', term_left: '4 years', lease_type: 'Gross', guarantor: 'Bob’s Burgers LLC', tenant: 'Acme' };
const clone = (d) => structuredClone(d);

/**
 * Every change worth trying on a deal: { input, lease, label, apply(deal) }.
 * Each figure is changed and cleared (or set, if empty); each loan term
 * likewise; the comps switched; each What-if assumption set; each Assumption,
 * and each field of the chosen leases, changed as the screens change them.
 */
export function changesFor(deal, { leases = 3 } = {}) {
  const out = [];
  const add = (input, label, apply, lease = null) => out.push({ input, lease, label, apply });
  for (const f of DEAL_INPUTS) {
    const v = deal.figures[f.key];
    if (v !== undefined && v !== null && v !== '') {
      add(`figures.${f.key}`, `${f.key} changed`, (d) => { d.figures[f.key] = nudge(v, f.key); });
      add(`figures.${f.key}`, `${f.key} cleared`, (d) => { delete d.figures[f.key]; });
    } else add(`figures.${f.key}`, `${f.key} set`, (d) => { d.figures[f.key] = f.kind === 'text' ? (TEXT[f.key] || SAMPLE.text) : SAMPLE[f.kind]; });
  }
  for (const k of ['ltv', 'rate', 'amort', 'io', 'closing', 'minDscr', 'minDy']) {
    const v = (deal.loan || {})[k];
    add(`loan.${k}`, `loan ${k} changed`, (d) => { d.loan = { ...(d.loan || {}), [k]: k === 'io' ? !v : nudge(v, k) }; });
    if (v !== undefined && v !== null && k !== 'io') add(`loan.${k}`, `loan ${k} cleared`, (d) => { d.loan = { ...d.loan }; delete d.loan[k]; });
  }
  add('comps', 'comps switched', null);
  for (const [k] of LIVE_KEYS) {
    const v = (deal.live || {})[k];
    const nv = k === 'noiBasis' ? (v === 'rentroll' ? undefined : 'rentroll') : k === 'io' ? !v : v !== undefined ? nudge(v, k) : ({ price: 8e6, noi: 450000, occ: 85, rentChange: 4, expenseChange: 6, ltv: 55, rate: 7.5, amort: 25, closing: 3, hold: 7, growth: 3, saleCost: 3, exitCap: 7.75 }[k]);
    add(`live.${k}`, `What-if ${k}`, (d) => { d.live = { ...(d.live || {}) }; if (nv === undefined) delete d.live[k]; else d.live[k] = nv; });
  }
  add('targets', 'targets set', (d) => { d.targets = { cap: 7, irr: 12, value: 7.5 }; });
  add('scenarios', 'a scenario saved', (d) => { d.scenarios = [...(d.scenarios || []), { id: 'snew', name: 'New', over: { exitCap: 8.5, hold: 6 } }]; });
  if ((deal.scenarios || []).length) add('scenarios', 'a scenario deleted', (d) => { d.scenarios = d.scenarios.slice(1); });
  add('name', 'renamed', (d) => { d.name = `${d.name || 'Deal'} (2)`; });
  add('source', 'source changed', (d) => { d.source = 'another.pdf'; });
  add('unpriced', 'marked unpriced', (d) => { d.unpriced = !d.unpriced; });
  add('sources', 'a figure marked as typed', (d) => { d.sources = { ...(d.sources || {}), price: { hand: true }, bsf: { page: 3 } }; });
  add('visit', 'site visit noted', (d) => { d.visit = { ...(d.visit || {}), items: { ...((d.visit || {}).items || {}), roof: 'issue' } }; });
  add('questions', 'a question added and one done', (d) => { d.myQuestions = [...(d.myQuestions || []), 'Is there a ground lease?']; d.qDone = { 'What is the current assessment, and does a sale at this price trigger a reassessment?': true }; });
  add('conventions', 'WALT by area, month-to-month at 0', null);
  add('preparedBy', 'prepared by someone else', null);
  if (hasRentRoll(deal)) {
    const ids = deal.rr.leases.slice(0, leases).map((L) => L.id).concat(deal.rr.leases.filter((L) => L.vacant).map((L) => L.id).slice(0, 1));
    for (const id of [...new Set(ids)]) for (const [f, fn] of Object.entries(LEASE_CHANGES)) add(`lease.${f}`, `lease ${id} ${f}`, (d) => fn(d.rr.leases.find((L) => L.id === id)), id);
    for (const [k, fn] of Object.entries(SETTING_CHANGES)) add(`rr.settings.${k}`, `setting ${k}`, (d) => fn(d.rr.settings));
    add('leases', 'a lease removed', (d) => { d.rr.leases.splice(1, 1); });
    add('leases', 'a lease added', (d) => { d.rr.leases.push({ ...structuredClone(d.rr.leases[0]), id: 'added', unit: '999', tenant: 'Newco', sf: 1500 }); });
  }
  if (deal.t12) {
    // as the T-12 card and the Review Queue change it: a line put in another category, a line still to review, the statement removed
    add('t12', 'a T-12 expense line moved below the line', (d) => { const l = d.t12.lines.find((x) => x.category === 'repairs'); l.category = 'capex'; l.how = 'you'; });
    add('t12', 'a T-12 line sent back for review', (d) => { const l = d.t12.lines.find((x) => x.category === 'insurance'); l.category = null; l.how = 'review'; });
    add('t12', 'the T-12 removed', (d) => { delete d.t12; });
  }
  if (hasRentRoll(deal)) {
    // (the OM's rent roll table is read only by a deal with no rent roll of its own)
  } else if ((deal.rentRoll || []).length) {
    add('rentRoll', 'the OM’s rent roll row changed', (d) => { d.rentRoll = d.rentRoll.map((r, i) => (i === 0 ? { ...r, annual: (r.annual || 1000) * 1.5, sf: (r.sf || 100) + 250 } : r)); });
  }
  return out;
}

/**
 * Try one change: what moved, against what the map says moves on this deal.
 * Returns the ids that moved but that affects() doesn't list (should be none),
 * and the moved ids, for tallying which declared reads were seen to matter.
 */
export async function tryChange(deal, ch, { comps = null, basis = null, files = false } = {}) {
  const today = new Date(Date.UTC(2026, 9, 10, 12));
  const before = await everything(deal, { comps, files, today });
  let after;
  const d = clone(deal);
  if (ch.input === 'comps') after = await everything(d, { comps: comps ? null : basis, files, today });
  else if (ch.input === 'conventions') { setConventions({ 'walt.weight': 'sf', 'walt.mtm': 'zero' }); try { after = await everything(d, { comps, files, today }); } finally { setConventions({ 'walt.weight': 'income', 'walt.mtm': 'exclude' }); } }
  else if (ch.input === 'preparedBy') after = await everything(d, { comps, files, today, preparedBy: 'Someone Else' });
  else { ch.apply(d); after = await everything(d, { comps, files, today }); }
  const moved = [...new Set([...before.keys(), ...after.keys()])].filter((k) => before.get(k) !== after.get(k));
  const a = affects([ch.input], { deal, comps, today });
  const listed = new Set([ch.input, ...a.now, ...a.scenarios.map((s) => `scenario:${s.id}`)]);
  const missing = moved.filter((k) => !listed.has(k) && !(ch.input === 'scenarios' && k.startsWith('scenario:')) && !(ch.input === 'conventions' && k === 'proj.notes'));
  return { moved, missing, listed };
}

/** The deals the files are checked on: the rich rent roll, and the retail OM without one. */
export function fixtureDeals(retailFigures, retailRows) {
  const base = { live: {}, scenarios: [{ id: 's1', name: 'Downside', over: { rate: 8, exitCap: 7.5 } }], targets: {}, sources: { noi: { page: 2 } }, visit: { items: {} }, myQuestions: [], qDone: {} };
  return [
    { label: 'rich rent roll', deal: { ...base, name: 'Rich centre', figures: { address: '1 Main St', city: 'Springfield', price: 9e6, noi: 600000, bsf: 32000, cap: 6.5, occ: 92, gross: 950000, opex: 310000, year: 1975, taxes: 120000 }, loan: { ltv: 65, rate: 6.75, amort: 30, io: false, closing: 2, minDscr: 1.25, minDy: 8 }, rr: richRentRoll(), live: { noiBasis: 'rentroll', hold: 5 } } },
    { label: 'retail OM, no rent roll of its own', deal: { ...base, name: 'Retail', figures: { ...retailFigures }, rentRoll: retailRows, loan: { ltv: 65, rate: 6.75, amort: 30, io: false, closing: 2, minDscr: 1.25, minDy: 8 } } },
  ];
}
