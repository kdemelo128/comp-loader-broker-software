/* impact.js -- the dependency map: what changing something on a deal affects.
 *
 * Every node is an input (a figure typed or read from the OM, a loan term, a
 * lease field, a rent roll setting, a What-if assumption), a figure the app
 * works out, a check or question, a scenario, an export or a document. Each
 * node lists what it reads. The deal analysis's nodes come straight from the
 * formulas registered in engine/figures.js, so they can't fall out of step
 * with it; the rest are declared here, next to the reads they describe, and
 * tests/impact.test.js holds the whole map to what the code really does.
 *
 * Paths: `figures.<key>`, `loan.<key>`, `comps` (the sale comps), `lease.<field>`
 * (that field of a lease; with a lease id, of that lease), `leases` (adding
 * or removing a lease), `rr.settings.<key>`, `live.<key>` (the What-if),
 * `fig.<id>`, `check.<id>`, `rr.<key>`, `proj.<line>`, `scenario`, `field.<key>`
 * (what a firm template can be filled with), `xlsx.deal.<…>`, `xlsx.rr.<sheet>`,
 * `brief.<section>`, `summary`. */

import { FIGURES, RULES } from './engine/figures.js';
import { DEAL_FIELDS, DEAL_INPUTS } from './dealfields.js';
import { legacyRows, setCurrentRent } from './rentroll.js';
import { analyze, runScenario, scenarioAnswers } from './deal.js';
import { rentRollSummary, project } from './lease.js';

/* ------------------------------------------------------------------ nodes */

const NODES = new Map();
/** Readers of each path: the nodes that list it among their reads. */
const READERS = new Map();

function node(id, meta) {
  if (NODES.has(id)) throw new Error(`The map has “${id}” twice.`);
  const reads = (meta.reads || []).flatMap((r) => {
    const R = typeof r === 'string' ? { path: r } : r;
    return [].concat(R.path).map((path) => ({ ...R, path }));
  });
  const N = { group: 'figure', ...meta, id, reads };
  NODES.set(id, N);
  return N;
}

/* ----------------------------------------------------------------- inputs */

const input = (id, label, extra = {}) => node(id, { group: 'input', label, ...extra });

for (const f of DEAL_INPUTS) input(`figures.${f.key}`, f.label, { kind: f.kind, section: f.section });
for (const [k, l] of [['ltv', 'Loan to value'], ['rate', 'Interest rate'], ['amort', 'Amortization'], ['io', 'Interest only'], ['closing', 'Closing costs'], ['minDscr', 'Minimum DSCR'], ['minDy', 'Minimum debt yield']]) input(`loan.${k}`, l);
input('comps', 'The sale comps');
input('rentRoll', 'The OM’s rent roll table (a deal with no rent roll of its own)');
input('name', 'Deal name');
input('unpriced', 'Unpriced (no asking price)');
input('sources', 'Where each figure came from');
input('source', 'The file the deal was read from');
input('visit', 'Site visit notes and checklist');
input('questions', 'Your own questions, and those marked done');
input('scenarios', 'Saved scenarios');
input('targets', 'What-if targets (cap rate, IRR, value)');
input('conventions', 'Calculation conventions (Settings)');
input('preparedBy', 'Prepared by (Settings)');
input('example', 'Fictional sample (an example deal)');

/** Lease fields, as a person edits them. `status` covers vacant and month to month; `rent` the rent periods. */
export const LEASE_FIELDS = [
  ['unit', 'Unit / suite'], ['tenant', 'Tenant'], ['unitType', 'Unit type'], ['sf', 'SF'], ['status', 'Status (vacant, month to month)'],
  ['leaseStart', 'Lease start'], ['rentStart', 'Rent start'], ['leaseEnd', 'Lease end'], ['rent', 'Rent (its periods and steps)'],
  ['abatements', 'Free rent and abatements'], ['marketRent', 'Market rent'], ['recovery', 'Expense recoveries'], ['percentRent', 'Percentage rent'],
  ['oneTime', 'One-time items'], ['renewal', 'Renewal assumptions'], ['leaseUpMonths', 'Lease-up months'], ['deposit', 'Security deposit'],
  ['arrears', 'Arrears'], ['options', 'Options'], ['notes', 'Notes'], ['custom', 'Custom columns'], ['source', 'Where the lease came from'],
];
for (const [k, l] of LEASE_FIELDS) input(`lease.${k}`, l, { lease: true });
input('leases', 'Adding or removing a lease');
/** Rent roll settings (Assumptions). */
export const RR_SETTINGS = [
  ['asOf', 'As-of date'], ['years', 'Years projected'], ['marketRent', 'Market rent'], ['marketUnit', 'Market rent unit'], ['marketGrowth', 'Market rent growth'],
  ['opex', 'Operating expenses'], ['expenseGrowth', 'Expense growth'], ['recoverable', 'Recoverable expenses'], ['generalVacancy', 'General vacancy'],
  ['reservesPsf', 'Capital reserves'], ['otherIncome', 'Other income'], ['leaseUpMonths', 'Lease-up months'], ['buildingSf', 'Building SF (rent roll)'], ['renewal', 'Renewal assumptions'],
];
for (const [k, l] of RR_SETTINGS) input(`rr.settings.${k}`, l);
/** What-if assumptions (deal.live). */
export const LIVE_KEYS = [
  ['price', 'Price'], ['noi', 'NOI'], ['occ', 'Occupancy'], ['rentChange', 'Rent change'], ['expenseChange', 'Expense change'], ['ltv', 'Loan to value'],
  ['rate', 'Interest rate'], ['amort', 'Amortization'], ['io', 'Interest only'], ['closing', 'Closing costs'], ['hold', 'Hold period'], ['growth', 'NOI growth'],
  ['saleCost', 'Sale costs'], ['exitCap', 'Exit cap rate'], ['noiBasis', 'NOI from the rent roll'],
];
for (const [k, l] of LIVE_KEYS) input(`live.${k}`, `What-if: ${l}`);

/** Inputs that no calculation, export or document reads: shown on the deal screen and given to the assistant only. */
export const NOT_CALCULATED = {
  'figures.cap_pf': 'shown on the deal screen only',
  'figures.renovated': 'shown on the deal screen only',
  'figures.stories': 'shown on the deal screen only',
  'figures.parking': 'shown on the deal screen only',
  'figures.options': 'shown on the deal screen only',
};

/* ---------------------------------------------------- the deal analysis */

// what the analysis reads (engine/figures.js), as the inputs a person edits (dealui figuresFor)
const LEASES_IN_ANALYSIS = ['lease.sf', 'lease.status', 'lease.rent', 'lease.leaseEnd', 'leases', 'rr.settings.asOf', { path: 'rentRoll', when: 'only for a deal with no rent roll of its own' }, 'conventions'];
function fromEngine(R) {
  const p = R.path;
  const keep = (path) => ({ ...R, path });
  if (p === 'today') return [];
  if (p === 'd.rentRoll') return LEASES_IN_ANALYSIS.map((x) => (typeof x === 'string' ? keep(x) : { ...x, when: R.when || x.when }));
  if (p === 'd.rentRollAsOf') return [keep('rr.settings.asOf')];
  if (p.startsWith('d.')) return [keep(`figures.${p.slice(2)}`)];
  if (p.startsWith('loan.')) return [keep(p)];
  if (p === 'comps' || p.startsWith('comps.')) return [keep('comps')];
  return [keep(FIGURES.byId.has(p) ? `fig.${p}` : p)];
}
/** A figure's analysis id → its map id, and back. */
export const figId = (id) => `fig.${id}`;
export const checkId = (id) => `check.${id}`;
for (const F of FIGURES.list) {
  node(figId(F.id), { label: F.label, unit: F.unit, reads: F.reads.flatMap(fromEngine), only: F.only ? 'only when there are sale comps' : null, engine: F.id });
}
for (const R of RULES.list) node(checkId(R.id), { group: 'check', label: R.label, reads: R.reads.flatMap(fromEngine), engine: R.id });
// the two parts of `derived`: what reads whether the price was worked out doesn't depend on the NOI's flag, and the other way round
node('fig.derived.price', { label: 'Price worked out from NOI and cap rate', unit: 'flag', reads: ['figures.price', 'fig.price'] });
node('fig.derived.noi', { label: 'NOI worked out from price and cap rate', unit: 'flag', reads: ['figures.noi', 'fig.noi'] });

/* --------------------------------------------- the rent roll and projection */

const RR = { when: 'only for a deal with a rent roll' };
// a lease's SF sets its rent only where the rent is quoted per SF
const perSf = (d) => !!(d.rr && d.rr.leases.some((L) => (L.periods || []).some((p) => /^psf/.test(p.unit))));
const SF_IN_RENT = { path: 'lease.sf', when: 'only for a rent quoted per SF', active: perSf };
const L_RENT = ['lease.rent', 'lease.sf', 'lease.status', 'leases', 'rr.settings.asOf'];
const L_AMOUNT = ['lease.rent', SF_IN_RENT, 'lease.status', 'leases', 'rr.settings.asOf'];
const L_END = [...L_RENT, 'lease.leaseEnd'];
const L_MARKET = ['lease.marketRent', 'rr.settings.marketRent', 'rr.settings.marketUnit', ...L_RENT];
/**
 * rentRollSummary(): every key it returns, with what it reads.
 * @type {Record<string, [string, (string | { path: string, when: string, active?: (d: any) => boolean })[]]>}
 */
export const RR_SUMMARY = {
  rows: ['Each lease’s row: rent, rent per SF, years left, loss to lease', ['lease.unit', 'lease.tenant', 'lease.abatements', 'lease.marketRent', 'rr.settings.marketRent', 'rr.settings.marketUnit', ...L_END]],
  totalSf: ['Total SF (rent roll)', ['lease.sf', 'leases']],
  leasedSf: ['Leased SF', L_RENT],
  occupancy: ['Occupancy by SF (rent roll)', L_RENT],
  units: ['Units', ['leases']],
  occupiedUnits: ['Occupied units', L_AMOUNT],
  annualRent: ['In-place rent, a year', L_AMOUNT],
  annualNet: ['In-place rent after free rent', [...L_AMOUNT, 'lease.abatements']],
  monthlyRent: ['In-place rent, a month', L_AMOUNT],
  avgRentPsf: ['Average rent per SF', L_RENT],
  waltIncome: ['WALT by income', [...L_AMOUNT, 'lease.leaseEnd', 'conventions']],
  waltSf: ['WALT by area', [...L_END, 'conventions']],
  walt: ['WALT', [...L_END, 'conventions']],
  waltWeight: ['WALT weighting', ['conventions']],
  waltMtm: ['Month-to-month leases in WALT', ['conventions']],
  marketRentOccupied: ['Market rent on leased space', L_MARKET],
  lossToLease: ['Loss to lease', L_MARKET],
  lossToLeasePct: ['Loss to lease, % of market', L_MARKET],
  expirations: ['Expirations by year', L_END],
  concentration: ['Tenant concentration', ['lease.tenant', 'lease.unit', ...L_AMOUNT]],
  top: ['Largest tenant', ['lease.tenant', 'lease.unit', ...L_AMOUNT]],
  hhi: ['Tenant concentration index', L_AMOUNT],
};
for (const [k, [label, reads]] of Object.entries(RR_SUMMARY)) node(`rr.${k}`, { group: 'rentroll', label, reads: reads.map((p) => (typeof p === 'string' ? { path: p, ...RR } : p)), rr: true });

// what the projection's lines read: the leases, rolled over at market, and the Assumptions
const ROLL = [...L_END, 'lease.renewal', 'lease.leaseUpMonths', 'lease.marketRent', 'rr.settings.years', 'rr.settings.renewal', 'rr.settings.marketRent', 'rr.settings.marketUnit',
  'rr.settings.marketGrowth', { path: 'rr.settings.leaseUpMonths', when: 'only for a vacant unit without its own lease-up months' }];
const OCCUPIED = [...ROLL, 'lease.abatements'];
/**
 * Each line of a projected year (lease.js project(): `annual[]`), with what it reads.
 * @type {Record<string, [string, (string | { path: string, when?: string, active?: (d: any) => boolean })[]]>}
 */
export const PROJ_LINES = {
  base: ['Contract rent (documented)', ['lease.rent', SF_IN_RENT, 'lease.status', 'leases', 'rr.settings.asOf', 'rr.settings.years']],
  projected: ['Projected rent (renewals, lease-up)', ROLL],
  rent: ['Rent', ['proj.base', 'proj.projected']],
  vacancy: ['Vacancy at market', ROLL],
  gpr: ['Potential gross rent', ['proj.rent', 'proj.vacancy']],
  free: ['Free rent and abatements', OCCUPIED],
  recoveries: ['Expense recoveries', [...ROLL, 'lease.recovery', 'rr.settings.recoverable', 'rr.settings.opex', 'rr.settings.expenseGrowth', { path: 'rr.settings.buildingSf', when: 'only when the leases give no SF' }]],
  pctRent: ['Percentage rent', [...ROLL, 'lease.percentRent']],
  other: ['Other income', ['rr.settings.otherIncome', 'rr.settings.years', 'rr.settings.asOf']],
  oneTime: ['One-time items', ['lease.oneTime', 'leases', 'rr.settings.asOf', 'rr.settings.years']],
  generalVacancy: ['General vacancy and credit loss', ['rr.settings.generalVacancy', 'proj.gpr', 'proj.recoveries', 'proj.pctRent', 'proj.other', 'proj.vacancy']],
  egi: ['Effective gross income (projected)', ['proj.gpr', 'proj.vacancy', 'proj.free', 'proj.recoveries', 'proj.pctRent', 'proj.other', 'proj.oneTime', 'proj.generalVacancy']],
  opex: ['Operating expenses (projected)', ['rr.settings.opex', 'rr.settings.expenseGrowth', 'rr.settings.years', 'rr.settings.asOf']],
  noi: ['NOI (projected)', ['proj.egi', 'proj.opex']],
  ti: ['Tenant improvements', ROLL],
  lc: ['Leasing commissions', ROLL],
  reserves: ['Capital reserves', ['rr.settings.reservesPsf', 'lease.sf', 'leases', 'rr.settings.expenseGrowth', 'rr.settings.years', 'rr.settings.asOf', { path: 'rr.settings.buildingSf', when: 'only when the leases give no SF' }]],
  cashFlow: ['Cash flow before debt service', ['proj.noi', 'proj.ti', 'proj.lc', 'proj.reserves']],
  occupancy: ['Occupancy (projected)', [...ROLL, { path: 'rr.settings.buildingSf', when: 'only when the leases give no SF' }]],
  notes: ['Notes on the projection’s assumptions', ['lease.unit', 'lease.tenant', 'lease.marketRent', 'lease.status', 'leases', 'rr.settings.marketRent', 'rr.settings.marketGrowth', 'rr.settings.renewal']],
};
for (const [k, [label, reads]] of Object.entries(PROJ_LINES)) {
  node(`proj.${k}`, { group: 'projection', label, reads: reads.map((p) => (typeof p === 'string' ? { path: p, ...RR } : p)), rr: true });
}

/* ------------------------------------------------------------- scenarios */

// what a scenario starts from (deal.js scenarioBase), and the assumption that replaces each
/** @type {[keyof ScenarioOver, string[]][]} */
const SCN_BASE = [
  ['price', ['fig.price']], ['noi', ['fig.noi']], ['ltv', ['loan.ltv']], ['rate', ['loan.rate']], ['amort', ['loan.amort']],
  ['io', ['loan.io']], ['closing', ['loan.closing']], ['exitCap', ['fig.cap']],
];
// the scenario's own analysis reads the deal's other figures too (runScenario analyses the deal with the scenario's price, NOI and loan)
const SCN_ALSO = () => {
  const replaced = new Set(['figures.price', 'figures.noi', 'figures.cap', 'figures.occ']);
  const set = new Set(['figures.gross', 'figures.opex', 'loan.minDscr', 'loan.minDy']);
  for (const F of [...FIGURES.list, ...RULES.list]) for (const R of F.reads) for (const x of fromEngine(R)) if (x.path.startsWith('figures.') || x.path.startsWith('lease') || x.path.startsWith('rr.') || x.path === 'rentRoll' || x.path === 'conventions') if (!replaced.has(x.path)) set.add(x.path);
  return [...set];
};
const SCN_OTHER = SCN_ALSO();
const given = (over, k) => over && over[k] !== undefined && over[k] !== null && over[k] !== '';

/**
 * What a scenario reads, given what it sets for itself (`over`): each
 * starting value from the deal unless the scenario replaces it, the deal's
 * other figures, the rent roll's projected NOI when it asks for it.
 */
export function scenarioReads(over = null, live = false) {
  const r = [];
  for (const [k, from] of SCN_BASE) {
    if (live) r.push(`live.${k}`);
    if (!given(over, k) || over === null) r.push(...from.map((path) => ({ path, when: over === null ? `only when the scenario doesn’t set its own ${k === 'exitCap' ? 'exit cap rate' : k}` : undefined })));
  }
  // occupancy: a scenario's own occupancy scales the deal's income by its ratio to the deal's, so the deal's is read either way
  r.push('fig.occ');
  for (const k of ['occ', 'rentChange', 'expenseChange', 'hold', 'growth', 'saleCost', 'noiBasis']) if (live) r.push(`live.${k}`);
  if (live) r.push('targets');
  r.push(...SCN_OTHER);
  if (over === null || over.noiBasis === 'rentroll') r.push({ path: 'proj.noi', when: 'only when the scenario takes its NOI from the rent roll' });
  return r.map((x) => (typeof x === 'string' ? { path: x } : x));
}
/** What runScenario() returns: all of it is the scenario's result, shown on the What-if and in the lines exports carry. */
export const SCENARIO_PARTS = ['inputs', 'base', 'm', 'returns', 'notes', 'series', 'changed'];
node('scenario', { group: 'scenario', label: 'What-if and saved scenarios', reads: [...scenarioReads(null, true), 'scenarios'] });

/* ------------------------------------------------- template fields, exports */

/** What each field a firm template can be filled with reads (dealfields.js DEAL_FIELDS). */
export const FIELD_READS = {
  price: ['fig.price', 'figures.price', 'sources', 'fig.derived.price'], noi: ['fig.noi', 'figures.noi', 'sources', 'fig.derived.noi'],
  capCalc: ['fig.capCalc'], ppsf: ['fig.ppsf'], perUnit: ['fig.perUnit'], ltv: ['loan.ltv'], rate: ['loan.rate'], amort: ['loan.amort'],
  loan: ['fig.loan'], debtService: ['fig.debtService'], dscr: ['fig.dscr'], debtYield: ['fig.debtYield'], equity: ['fig.equity'], cashOnCash: ['fig.cashOnCash'],
  rrRent: ['rr.annualRent'], rrOcc: ['rr.occupancy'], walt: ['rr.walt', 'conventions'], rrNoi1: ['proj.noi', 'rr.settings.opex'],
  exitCap: ['scenario'], hold: ['scenario'], leveredIrr: ['scenario'], unleveredIrr: ['scenario'], multiple: ['scenario'],
  dealName: ['name', 'figures.address'], preparedBy: ['preparedBy'], today: [],
};
for (const F of DEAL_FIELDS) {
  const reads = FIELD_READS[F.key] || [`figures.${F.key}`, 'sources'];
  node(`field.${F.key}`, { group: 'field', label: F.label, reads });
}

/** The deal workbook's Deal Analysis sheet (workbook.js dealTab): each fixed row, by the figure it prints. */
export const DEAL_SHEET_ROWS = {
  5: ['Asking price', ['fig.price', 'sources', 'fig.derived.price']], 6: ['Net operating income', ['fig.noi', 'sources', 'fig.derived.noi']], 7: ['Cap rate stated in the OM', ['figures.cap', 'sources']],
  8: ['Building SF', ['figures.bsf', 'sources']], 9: ['Land SF', ['figures.lot_sf', 'sources']], 10: ['Units', ['figures.units', 'sources']], 11: ['Gross income (EGI)', ['figures.gross', 'sources']],
  12: ['Operating expenses', ['figures.opex', 'sources']], 13: ['Real estate taxes', ['figures.taxes', 'sources']], 14: ['Occupancy', ['fig.occ', 'fig.occSource', 'sources']],
  15: ['Year built', ['figures.year', 'sources']], 16: ['Gross potential rent', ['figures.gpr', 'sources']],
  18: ['Cap rate on asking price', ['fig.capCalc']], 19: ['Price per building SF', ['fig.ppsf']], 20: ['Price per unit', ['fig.perUnit']], 21: ['Price per land SF', ['fig.perLandSf']],
  22: ['NOI per SF', ['fig.noiPsf']], 23: ['Price ÷ gross income', ['fig.grossMultiple']], 24: ['Expense ratio', ['fig.expenseRatio']], 25: ['Taxes per SF', ['fig.taxPsf']],
  28: ['Loan to value', ['loan.ltv']], 29: ['Interest rate', ['loan.rate']], 30: ['Amortization', ['loan.amort']], 31: ['Interest only', ['loan.io']], 32: ['Closing costs', ['loan.closing']],
  33: ['Loan amount', ['fig.loan']], 34: ['Annual debt service', ['fig.debtService']], 35: ['DSCR', ['fig.dscr']], 36: ['Debt yield', ['fig.debtYield']],
  37: ['Cash flow after debt service', ['fig.cashFlow']], 38: ['Equity, with closing costs', ['fig.equity']], 39: ['Cash-on-cash return', ['fig.cashOnCash']], 40: ['Break-even occupancy', ['fig.breakEven']],
  43: ['Minimum DSCR', ['loan.minDscr']], 44: ['Minimum debt yield', ['loan.minDy']], 45: ['Loan at the LTV', ['fig.maxLoan']], 46: ['Loan at the minimum DSCR', ['fig.maxLoan']],
  47: ['Loan at the minimum debt yield', ['fig.maxLoan']], 48: ['Maximum loan', ['fig.maxLoan']], 49: ['Price that loan supports', ['fig.maxLoan', 'loan.ltv']],
};
/** The headings the Deal Analysis sheet's sections start with, and the section each is. */
export const DEAL_SHEET_HEADINGS = [
  [/^VALUE ACROSS CAP RATES/, 'ladder'], [/^AGAINST THE SALE COMPS/, 'comps'], [/^WHAT DOESN'T ADD UP/, 'checks'], [/^QUESTIONS TO ASK/, 'questions'],
  [/^SITE VISIT NOTES/, 'visit'], [/^SCENARIOS/, 'scenarios'],
];
/** Its sections below row 50, which grow with the deal, by the heading each starts with. */
export const DEAL_SHEET_SECTIONS = {
  title: ['Title', ['name', 'figures.address', 'source', 'example']],
  ladder: ['Value across cap rates', ['fig.ladder', 'fig.cap']],
  comps: ['Against the sale comps', ['comps', 'fig.vsWeighted', 'fig.valueAtWeighted', 'fig.valueAtMedianCap']],
  checks: ['What doesn’t add up', RULES.list.map((R) => checkId(R.id))],
  questions: ['Questions to ask', [...RULES.list.map((R) => checkId(R.id)), 'questions']],
  visit: ['Site visit notes', ['visit']],
  scenarios: ['Scenarios', ['scenario']],
};
for (const [r, [label, reads]] of Object.entries(DEAL_SHEET_ROWS)) node(`xlsx.deal.B${r}`, { group: 'export', file: 'Deal workbook', sheet: 'Deal Analysis', label: `${label} (B${r})`, reads });
for (const [k, [label, reads]] of Object.entries(DEAL_SHEET_SECTIONS)) node(`xlsx.deal.${k}`, { group: 'export', file: 'Deal workbook', sheet: 'Deal Analysis', label, reads });
node('xlsx.deal.omRentRoll', { group: 'export', file: 'Deal workbook', sheet: 'Rent Roll', label: 'Rent Roll (the OM’s table)', reads: [{ path: 'rentRoll', when: 'only for a deal with no rent roll of its own' }] });

/** The rent roll tabs (rrbook.js), in the rent roll workbook and the deal workbook alike. */
export const RR_SHEETS = {
  'Rent Roll': ['lease.unit', 'lease.tenant', 'lease.leaseStart', 'lease.source', 'name', 'figures.address', 'example', ...L_END, 'rr.totalSf', 'rr.annualRent', 'rr.leasedSf', 'rr.avgRentPsf', 'rr.waltIncome'],
  'Lease Schedule': ['lease.unit', 'lease.tenant', ...OCCUPIED, 'proj.projected'],
  'Cash Flow': [...Object.keys(PROJ_LINES).map((k) => `proj.${k}`), 'rr.settings.asOf', 'rr.settings.marketRent', 'rr.settings.marketUnit', 'rr.settings.marketGrowth', 'rr.settings.renewal', 'rr.settings.opex', 'rr.settings.expenseGrowth', 'rr.settings.generalVacancy'],
};
for (const [s, reads] of Object.entries(RR_SHEETS)) node(`xlsx.rr.${s}`, { group: 'export', file: 'Rent roll workbook, and the deal workbook', sheet: s, label: s, reads: reads.map((p) => (typeof p === 'string' ? { path: p, ...RR } : p)), rr: true });
node('csv.rr', { group: 'export', file: 'Rent roll CSV', label: 'The grid as shown', rr: true, reads: [...LEASE_FIELDS.map(([k]) => `lease.${k}`), 'leases', 'rr.settings.asOf', 'rr.settings.marketRent', 'rr.settings.marketUnit', 'rr.totalSf'] });

/* -------------------------------------------------------------- documents */

const ALL_CHECKS = RULES.list.map((R) => checkId(R.id));
/** The deal brief (brief.js renderDealBrief), section by section. */
export const BRIEF_SECTIONS = {
  head: ['Heading', ['figures.address', 'figures.city', 'figures.state', 'figures.zip', 'figures.ptype', 'name', 'source', 'preparedBy', 'example']],
  stats: ['Headline figures', ['fig.price', 'unpriced', 'fig.ppsf', 'fig.capCalc', 'figures.cap', 'fig.noi', 'fig.derived.noi', 'fig.noiPsf', 'fig.dscr', 'fig.cashOnCash']],
  property: ['The property', ['figures.bsf', 'figures.lot_sf', 'figures.units', 'figures.year', 'figures.zoning', 'fig.occ', 'fig.occSource', 'figures.tenant', 'figures.lease_type', 'figures.lease_exp', 'figures.term_left', 'figures.increases']],
  income: ['Income', ['figures.gpr', 'figures.gross', 'figures.opex', 'fig.expenseRatio', 'figures.taxes', 'figures.noi_pf', 'fig.leases', 'conventions']],
  financing: ['Financing', ['loan.ltv', 'loan.rate', 'loan.io', 'loan.amort', 'fig.loan', 'fig.debtService', 'fig.debtYield', 'fig.cashFlow', 'fig.equity', 'fig.breakEven', 'fig.breakEvenBasis', 'fig.maxLoan']],
  comps: ['Against the sale comps', ['comps', 'fig.vsWeighted', 'fig.valueAtWeighted', 'fig.valueAtMedianCap']],
  ladder: ['Value across cap rates', ['fig.ladder']],
  checks: ['What doesn’t add up', ALL_CHECKS],
  questions: ['Questions to ask', [...ALL_CHECKS, 'questions']],
  visit: ['Site visit', ['visit']],
  scenarios: ['Scenarios', ['scenario']],
};
/** The brief's section headings, and the section each starts. */
export const BRIEF_HEADINGS = [
  [/^The property$/, 'property'], [/^Income$/, 'income'], [/^Financing/, 'financing'], [/^Against \d+ sale comps$/, 'comps'], [/^Value across cap rates$/, 'ladder'],
  [/^What doesn’t add up$/, 'checks'], [/^Questions to ask$/, 'questions'], [/^Site visit$/, 'visit'], [/^Scenarios/, 'scenarios'],
];
for (const [k, [label, reads]] of Object.entries(BRIEF_SECTIONS)) node(`brief.${k}`, { group: 'document', file: 'Deal brief', label, reads });
node('summary', {
  group: 'document', file: 'Copy summary', label: 'The five-line summary',
  reads: ['figures.address', 'figures.city', 'figures.state', 'figures.zip', 'name', 'figures.ptype', 'figures.bsf', 'figures.units', 'figures.year', 'figures.zoning',
    'fig.price', 'unpriced', 'fig.ppsf', 'fig.cap', 'fig.noi', 'fig.derived.noi', 'figures.occ', 'fig.leases', 'conventions', 'figures.tenant',
    'loan.ltv', 'loan.rate', 'loan.io', 'loan.amort', 'fig.dscr', 'fig.cashOnCash', 'comps', 'fig.vsWeighted'],
});

/**
 * The files and printouts that carry deal data, by the name a deliver() or
 * printed() call gives. Each lists the nodes it is made of. A call that hands
 * over anything else says so with `map: 'none: <why>'`.
 */
export const DELIVERABLES = {
  'deal-workbook': ['Deal workbook (Excel)', () => [...NODES.keys()].filter((k) => k.startsWith('xlsx.'))],
  'rr-workbook': ['Rent roll workbook (Excel)', () => [...NODES.keys()].filter((k) => k.startsWith('xlsx.rr.'))],
  'rr-csv': ['Rent roll CSV', () => ['csv.rr']],
  'template-fill': ['A firm template, filled', () => [...NODES.keys()].filter((k) => k.startsWith('field.'))],
  'deal-brief': ['Deal brief (printed or PDF)', () => [...NODES.keys()].filter((k) => k.startsWith('brief.'))],
  summary: ['Copy summary', () => ['summary']],
};

/* ----------------------------------------------------- building the graph */

for (const N of NODES.values()) {
  for (const R of N.reads) {
    if (!NODES.has(R.path)) throw new Error(`The map: “${N.id}” reads “${R.path}”, which isn’t a node.`);
    if (!READERS.has(R.path)) READERS.set(R.path, []);
    READERS.get(R.path).push({ id: N.id, when: R.when || null });
  }
}
/** A loop in a map of { id → { reads: [{ path }] } }, as the ids round it, or null. */
export function findLoop(map) {
  const state = new Map();
  let loop = null;
  const visit = (id, trail) => {
    if (loop || state.get(id) === 2) return;
    if (state.get(id) === 1) { loop = [...trail.slice(trail.indexOf(id)), id]; return; }
    state.set(id, 1);
    for (const R of (map.get(id) || { reads: [] }).reads) visit(R.path, [...trail, id]);
    state.set(id, 2);
  };
  for (const id of map.keys()) visit(id, []);
  return loop;
}
// no node may depend on itself, however indirectly
{
  const loop = findLoop(NODES);
  if (loop) throw new Error(`The map has a loop: ${loop.join(' → ')}.`);
}

export const nodes = () => NODES;
export const nodeOf = (id) => NODES.get(id) || null;
export const readersOf = (id) => READERS.get(id) || [];

/** Everything that reads `paths`, directly or through other figures: { id → the first condition met on the way, or null }. */
export function downstream(paths, { edge = null } = {}) {
  const out = new Map();
  const queue = [];
  for (const p of [].concat(paths)) if (NODES.has(p)) queue.push([p, null]);
  while (queue.length) {
    const [id, cond] = queue.shift();
    for (const r of readersOf(id)) {
      if (edge && !edge(id, r.id)) continue;
      const c = cond || r.when;
      if (out.has(r.id) && (out.get(r.id) === null || c !== null)) continue;
      out.set(r.id, c);
      queue.push([r.id, c]);
    }
  }
  return out;
}

/** Everything `id` is worked out from, directly or through other figures, down to the inputs. */
export function upstream(id) {
  const out = new Set();
  const stack = [id];
  while (stack.length) {
    const n = NODES.get(stack.pop());
    for (const R of (n ? n.reads : [])) if (!out.has(R.path)) { out.add(R.path); stack.push(R.path); }
  }
  return out;
}

/* -------------------------------------- from a change to the inputs it touches */

/**
 * The input a recorded change (history.js: a path of steps) is to: e.g.
 * ['rr','leases',{id:'l7'},'periods',0,'rate'] → { input: 'lease.rent', lease: 'l7' }.
 * Null for a change no figure reads (notes, the pipeline stage, photos).
 */
export function inputOfPath(steps) {
  const s = steps.map((x) => (x && typeof x === 'object' ? x : String(x)));
  const [a, b, c, d] = s;
  if (a === 'figures' && b) return NODES.has(`figures.${b}`) ? { input: `figures.${b}` } : null;
  if (a === 'loan' && b) return NODES.has(`loan.${b}`) ? { input: `loan.${b}` } : null;
  if (a === 'live' && b) return NODES.has(`live.${b}`) ? { input: `live.${b}` } : null;
  if (a === 'rr' && b === 'settings' && c) return NODES.has(`rr.settings.${c}`) ? { input: `rr.settings.${c}` } : null;
  if (a === 'rr' && b === 'leases') {
    if (!c || typeof c !== 'object' || d === undefined) return { input: 'leases' };
    const f = { vacant: 'status', mtm: 'status', status: 'status', periods: 'rent', marketUnit: 'marketRent' }[d] || d;
    return NODES.has(`lease.${f}`) ? { input: `lease.${f}`, lease: c.id } : null;
  }
  if (a === 'rentRoll') return { input: 'rentRoll' };
  if (a === 'scenarios') return { input: 'scenarios' };
  if (a === 'targets') return { input: 'targets' };
  if (a === 'visit') return { input: 'visit' };
  if (a === 'myQuestions' || a === 'qDone') return { input: 'questions' };
  if (a === 'sources') return { input: 'sources' };
  if (a === 'name' || a === 'unpriced' || a === 'source') return { input: a };
  return null;
}

/* ======================================================== on this deal, now */

/** What the analysis reads of a deal (as dealui has always passed it). */
export function analysisInput(d) {
  // one source: with a rent roll, the analysis reads its rows from it (not a stored copy that could lag behind),
  // and WALT and its other figures are measured from its own as-of date
  const rr = hasRentRoll(d) ? d.rr : null;
  return { ...d.figures, rentRoll: rr ? legacyRows(rr) : d.rentRoll, loan: d.loan, rentRollAsOf: rr && rr.settings ? rr.settings.asOf : null };
}
export const hasRentRoll = (d) => !!(d && d.rr && Array.isArray(d.rr.leases) && d.rr.leases.length);

/**
 * The analysis worked out with every read recorded, formula by formula:
 * { m, reads: Map(map id → Set of the map paths it read this time) }. A
 * formula only reads what its branch needs, so this is what each figure
 * rests on for this deal as it stands; a figure not worked out (comps
 * figures with no comps) has no entry.
 */
export function traceAnalysis(d, comps = null, today = new Date()) {
  const m = { derived: {}, checks: [], questions: [] };
  const x = { d, loan: d.loan || {}, comps, today };
  const reads = new Map();
  let seen = null;
  const note = (p) => { if (seen) seen.add(p); };
  const over = (obj, prefix) => (obj && typeof obj === 'object' ? new Proxy(obj, { get(t, k) { if (typeof k === 'string') note(`${prefix}.${k}`); return t[k]; } }) : obj);
  const px = new Proxy(x, {
    get(t, k) {
      if (k === 'd') return over(t.d, 'd');
      if (k === 'loan') return over(t.loan, 'loan');
      if (k === 'comps') { note('comps'); return over(t.comps, 'comps'); }
      if (k === 'today') note('today');
      return t[k];
    },
  });
  const pm = new Proxy(m, { get(t, k) { if (typeof k === 'string') note(k); return t[k]; } });
  const toMap = (s) => new Set([...s].flatMap((p) => fromEngine({ path: p })).map((r) => r.path));
  for (const F of FIGURES.list) {
    if (F.only && !F.only(x)) continue;
    seen = new Set();
    m[F.id] = F.calc(pm, px);
    reads.set(figId(F.id), toMap(seen));
  }
  for (const R of RULES.list) {
    seen = new Set();
    R.calc(pm, px, m.checks, m.questions);
    reads.set(checkId(R.id), toMap(seen));
  }
  seen = null;
  return { m, reads };
}

/** The scenarios on a deal: the What-if (when it sets anything) and each saved one. */
export function scenariosOf(deal) {
  const out = [{ id: 'live', name: 'What-if', over: deal.live || {}, live: true }];
  for (const sc of deal.scenarios || []) out.push({ id: sc.id, name: sc.name, over: sc.over || {}, live: false });
  return out;
}

/**
 * What changing `inputs` (map ids, e.g. ['loan.rate']) affects on this deal
 * as it stands. ctx: { deal, comps (compBasis or null), templates ([{ id,
 * name, mapping }]) }. Returns { now, could, scenarios, templates }: `now`
 * the nodes that move with this deal's figures as they are, `could` the
 * others the map reaches, each with the condition that leaves it out here.
 */
export function affects(inputs, { deal, comps = null, templates = [], today = new Date() }) {
  const rr = hasRentRoll(deal);
  const { reads } = traceAnalysis(analysisInput(deal), comps, today);
  const scns = scenariosOf(deal).map((s) => ({ ...s, reads: new Set(scenarioReads(s.over, s.live).map((r) => r.path)) }));
  const scnReads = new Set(scns.flatMap((s) => [...s.reads]));
  if ((deal.scenarios || []).length) scnReads.add('scenarios');
  const fromRr = (p) => p.startsWith('lease.') || p === 'leases' || p.startsWith('rr.') || p.startsWith('proj.');
  // switching the comps brings the comps figures in or out; a first lease, the rent roll's
  const switching = (what) => inputs.includes(what);
  const exists = (id) => {
    const N = NODES.get(id);
    if (!N) return false;
    if (N.rr && !rr && !switching('leases')) return false;
    if (N.engine && N.group === 'figure' && !reads.has(id)) return !!(N.only && switching('comps'));
    if ((id === 'xlsx.deal.comps' || id === 'brief.comps') && !(comps && comps.n) && !switching('comps')) return false;
    if (id === 'xlsx.deal.omRentRoll' && (rr || !(deal.rentRoll || []).length)) return false;
    return true;
  };
  const edge = (from, to) => {
    if (!exists(to)) return false;
    if (fromRr(from) && !rr && !from.startsWith('rr.settings.asOf')) return false;
    if (from === 'rentRoll' && rr) return false;
    const N = NODES.get(to);
    if (N.engine) return reads.has(to) ? reads.get(to).has(from) : true;
    if (to === 'scenario') return scnReads.has(from);
    // a read that only matters in some circumstances, and says how to tell
    const R = N.reads.find((x) => x.path === from && x.active);
    return R ? R.active(deal) : true;
  };
  const all = downstream(inputs);
  const now = downstream(inputs, { edge });
  const could = [];
  for (const [id, cond] of all) {
    if (now.has(id) || id === 'scenario') continue;
    const N = NODES.get(id);
    could.push({ id, why: N.rr && !rr ? 'only for a deal with a rent roll' : N.only && !exists(id) ? N.only : cond || 'not with this deal’s figures as they are' });
  }
  const hit = new Set([...inputs, ...now.keys()]);
  const scenarios = now.has('scenario') ? scns.filter((s) => [...s.reads].some((p) => hit.has(p)) || (s.live && inputs.some((p) => p.startsWith('live.')))) : [];
  const tpl = [];
  for (const t of templates || []) {
    const cells = ((t.mapping && t.mapping.cells) || []).filter((c) => now.has(`field.${c.field}`));
    if (cells.length) tpl.push({ id: t.id, name: t.name, cells: cells.map((c) => ({ sheet: c.sheet, cell: c.cell, field: c.field })) });
  }
  return { now: [...now.keys()], could, scenarios, templates: tpl };
}

/** A map id's group, as the Affects list shows them. */
export function groupOf(id) {
  const N = NODES.get(id);
  if (!N) return null;
  if (N.group === 'figure' || N.group === 'rentroll' || N.group === 'projection') return 'Figures';
  if (N.group === 'check') return 'Checks and questions';
  if (N.group === 'scenario') return 'Scenarios';
  if (N.group === 'export' || N.group === 'field') return 'Exports';
  if (N.group === 'document') return 'Documents';
  return 'Inputs';
}

/* ===================================================== values, before and after */

/**
 * What a firm template can draw on for a deal (dealfields.js DEAL_FIELDS):
 * its analysis, rent roll, projection and What-if. `projectFn(rr, opts)`
 * gives a projection ({ annual }); the screens pass the worker's cache.
 */
export function fieldContext(d, { comps = null, preparedBy = '', today = new Date(), projectFn = (rr, o) => project(rr, o) } = {}) {
  const m = analyze(analysisInput(d), comps);
  const rr = d.rr && d.rr.leases.length ? d.rr : null;
  const hold = Number.isFinite((d.live || {}).hold) ? d.live.hold : 5;
  const series = (d.live || {}).noiBasis === 'rentroll' && rr && Number.isFinite(rr.settings.opex) ? projectFn(rr, { years: hold + 1 }).annual.map((y) => y.noi) : null;
  return {
    deal: d, m, rrSum: rr ? rentRollSummary(rr, rr.settings.asOf) : null, rrProj: rr && Number.isFinite(rr.settings.opex) ? projectFn(rr) : null,
    scenario: runScenario(analysisInput(d), m, d.live || {}, { noiSeries: series }), preparedBy, today,
  };
}

/** A scenario's NOI from the rent roll, as the What-if asks for it (null when it can't be worked out). */
function seriesFor(d, over, projectFn) {
  const rr = hasRentRoll(d) ? d.rr : null;
  if (over.noiBasis !== 'rentroll' || !rr || !Number.isFinite(rr.settings.opex)) return null;
  const years = Math.max(2, Math.round(Number.isFinite(over.hold) ? over.hold : 5) + 1);
  return projectFn(rr, { years }).annual.map((y) => y.noi);
}

/**
 * Every value the map knows for a deal, by map id: figures, checks (what each
 * says, if anything), rent roll and projection, each scenario's results, each
 * template field. Exports and documents are made of these: one changes when
 * something it reads changes. `projectFn` null leaves the projection out
 * (the screens work it out in the worker).
 */
export function valuesOf(d, { comps = null, today = new Date(), projectFn = (rr, o) => project(rr, o), preparedBy = '' } = {}) {
  const out = new Map();
  const a = analysisInput(d);
  const m = analyze(a, comps, today);
  for (const F of FIGURES.list) if (F.id in m) out.set(figId(F.id), m[F.id]);
  out.set('fig.derived.price', !!m.derived.price);
  out.set('fig.derived.noi', !!m.derived.noi);
  const x = { d: a, loan: a.loan || {}, comps, today };
  for (const R of RULES.list) { const C = []; const Q = []; R.calc(m, x, C, Q); out.set(checkId(R.id), C.length || Q.length ? { checks: C, questions: Q } : null); }
  const rr = hasRentRoll(d) ? d.rr : null;
  if (rr) {
    const sum = rentRollSummary(rr, rr.settings.asOf);
    for (const k of Object.keys(RR_SUMMARY)) out.set(`rr.${k}`, sum[k]);
    if (projectFn) {
      const P = projectFn(rr);
      for (const k of Object.keys(PROJ_LINES)) out.set(`proj.${k}`, k === 'notes' ? P.notes : P.annual.map((y) => y[k]));
    }
  }
  for (const s of scenariosOf(d)) {
    if (!projectFn && s.over.noiBasis === 'rentroll') continue;
    const run = runScenario(a, m, s.over, { noiSeries: projectFn ? seriesFor(d, s.over, projectFn) : null });
    const v = { inputs: run.inputs, m: run.m, returns: run.returns, notes: run.notes, series: run.series };
    if (s.live) {
      const tg = d.targets || {};
      const ans = scenarioAnswers(a, m, s.over, { targetCap: tg.cap, targetIrr: tg.irr, capForValue: tg.value ?? run.inputs.exitCap }, { noiSeries: run.series });
      v.answers = { priceForCap: ans.priceForCap, valueAtCap: ans.valueAtCap, priceForIrr: ans.priceForIrr, equity: ans.equity };
    }
    out.set(`scenario:${s.id}`, v);
  }
  if (projectFn || !rr) {
    const ctx = fieldContext(d, { comps, today, preparedBy, projectFn: projectFn || ((r, o) => project(r, o)) });
    for (const F of DEAL_FIELDS) if (F.key !== 'today') out.set(`field.${F.key}`, F.get(ctx));
  }
  return { values: out, m };
}

/** Values compared as text, so 0.1 + 0.2 and 0.30000000000000004 are the same number and a list is compared whole. */
export const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** A deal with one input set to a trial value (a copy: the deal itself is untouched). */
export function withTrial(d, inputId, value, leaseIdOf = null) {
  const t = structuredClone({ ...d, visit: undefined, photos: undefined });
  const [head, key] = [inputId.slice(0, inputId.indexOf('.')), inputId.slice(inputId.indexOf('.') + 1)];
  if (head === 'figures') { t.figures = { ...t.figures }; if (value === null || value === '') delete t.figures[key]; else t.figures[key] = value; }
  else if (head === 'loan') t.loan = { ...(t.loan || {}), [key]: value };
  else if (head === 'live') t.live = { ...(t.live || {}), [key]: value };
  else if (inputId.startsWith('rr.settings.')) t.rr.settings[inputId.slice(12)] = value;
  else if (head === 'lease') {
    const L = t.rr.leases.find((x) => x.id === leaseIdOf);
    if (!L) return t;
    if (key === 'rent') setCurrentRent(L, value, 'year', { asOf: t.rr.settings.asOf });
    else if (key === 'marketRent') L.marketRent = value;
    else L[key] = value;
  }
  return t;
}

/** Which inputs a trial value can be typed for, and as what. */
export function trialKind(inputId) {
  const N = NODES.get(inputId);
  if (!N || N.group !== 'input') return null;
  if (inputId.startsWith('figures.')) return ['money', 'money2', 'pct', 'int', 'year'].includes(N.kind) ? N.kind : null;
  if (/^loan\.(ltv|rate|closing|minDy)$/.test(inputId) || /^live\.(occ|rentChange|expenseChange|ltv|rate|closing|growth|saleCost|exitCap)$/.test(inputId)) return 'pct';
  if (/^loan\.(amort|minDscr)$/.test(inputId) || /^live\.(amort|hold)$/.test(inputId)) return 'dec';
  if (/^live\.(price|noi)$/.test(inputId)) return 'money';
  if (/^rr\.settings\.(opex|recoverable)$/.test(inputId)) return 'money';
  if (/^rr\.settings\.(marketRent|reservesPsf)$/.test(inputId)) return 'money2';
  if (/^rr\.settings\.(marketGrowth|expenseGrowth|generalVacancy)$/.test(inputId)) return 'pct';
  if (/^rr\.settings\.(years|leaseUpMonths)$/.test(inputId)) return 'dec';
  if (inputId === 'lease.sf') return 'int';
  if (inputId === 'lease.rent') return 'money';
  if (inputId === 'lease.marketRent') return 'money2';
  if (inputId === 'lease.leaseEnd') return 'date';
  return null;
}
