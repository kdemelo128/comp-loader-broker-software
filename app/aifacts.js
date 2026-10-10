/* aifacts.js -- the deal as numbered facts for the assistant. The assistant
 * may use only these, and must cite them by id; each says where it came
 * from (an OM page, typed, AI-read, calculated, the rent roll, a scenario
 * assumption, the comps). Pure, no DOM. */

import { waltMethod } from './engine/walt.js';

const ok = (x) => typeof x === 'number' && Number.isFinite(x);
const money = (n) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const money2 = (n) => `$${n.toFixed(2)}`;
const pct = (n, d = 2) => `${n.toFixed(d)}%`;

function show(kind, v) {
  if (kind === 'money') return money(v);
  if (kind === 'money2') return money2(v);
  if (kind === 'pct') return pct(v);
  if (kind === 'int') return Math.round(v).toLocaleString('en-US');
  return String(v);
}

/** Where a figure came from, in a few words. */
export function sourceLabel(s) {
  if (!s) return 'unknown source';
  if (s.ai) return `read by AI from ${s.doc || 'a document'}${s.page ? ` p.${s.page}` : ''}${s.verified ? ', passage checked' : ', passage not checked'}${s.hand ? ', then edited' : ''}`;
  if (s.tool) return `typed (from the ${s.tool} tool)`;
  if (s.hand && !s.page) return 'typed by the broker';
  if (s.hand) return `edited by the broker (the OM p.${s.page} reads ${s.orig})`;
  if (s.page) return `OM page ${s.page}${s.confirmed && s.confirmed.length ? `, confirmed by ${s.confirmed.map((c) => c.by).join(' and ')}` : ''}`;
  return 'inferred from the OM';
}

/**
 * ctx: { deal, fields: [{ key, label, kind }], m (analysis), scenario,
 * rrSum, comps, issues } -> [{ id, label, value, source }].
 */
export function buildFacts({ deal, fields, m = {}, scenario = null, rrSum = null, comps = null, issues = [] }) {
  const out = [];
  const add = (label, value, source) => { out.push({ id: `f${out.length + 1}`, label, value, source }); };
  for (const f of fields) {
    const v = deal.figures[f.key];
    if (v === null || v === undefined || v === '' || (typeof v === 'number' && !ok(v))) continue;
    add(f.label, show(f.kind, v), sourceLabel(deal.sources && deal.sources[f.key]));
  }
  const calc = [
    ['cap', 'Cap rate on the asking price (NOI ÷ price)', (x) => pct(x)], ['ppsf', 'Price per SF', money2], ['perUnit', 'Price per unit', money],
    ['noiPsf', 'NOI per SF', money2], ['expenseRatio', 'Expense ratio', (x) => pct(x, 1)], ['loan', 'Loan at the broker’s terms', money],
    ['debtService', 'Annual debt service', money], ['dscr', 'DSCR', (x) => `${x.toFixed(2)}x`], ['debtYield', 'Debt yield', (x) => pct(x)],
    ['equity', 'Equity needed, with closing costs', money], ['cashOnCash', 'Cash-on-cash, year 1', (x) => pct(x, 1)], ['breakEven', 'Break-even occupancy', (x) => pct(x, 1)],
    ['termLeft', 'Lease term remaining, years', (x) => x.toFixed(1)],
  ];
  for (const [k, label, fmt] of calc) if (ok(m[k])) add(label, fmt(m[k]), 'calculated from the figures above');
  if (deal.loan) {
    const L = deal.loan;
    add('Loan terms assumed', `${ok(L.ltv) ? `${L.ltv}% LTV` : 'LTV not set'}, ${ok(L.rate) ? `${L.rate}% rate` : 'rate not set'}, ${L.io ? 'interest only' : `${L.amort || '?'}-year amortization`}`, 'assumption (the broker’s loan terms)');
  }
  if (rrSum && rrSum.units) {
    const src = 'the deal’s rent roll';
    add('Rent roll: units', `${rrSum.units} (${rrSum.occupiedUnits} occupied)`, src);
    if (ok(rrSum.occupancy)) add('Rent roll: occupancy by SF', pct(rrSum.occupancy, 1), src);
    add('Rent roll: in-place annual rent', money(rrSum.annualRent), src);
    if (ok(rrSum.avgRentPsf)) add('Rent roll: average rent per SF', money2(rrSum.avgRentPsf), src);
    if (ok(rrSum.walt)) add(`Rent roll: WALT ${waltMethod()}, years`, rrSum.walt.toFixed(1), src);
    if (rrSum.top) add('Rent roll: largest tenant', `${rrSum.top.tenant} (${ok(rrSum.top.share) ? pct(rrSum.top.share, 1) : '?'} of rent)`, src);
    for (const e of (rrSum.expirations || []).slice(0, 4)) add(`Rent roll: leases expiring in ${e.year}`, `${e.count}, ${money(e.rent)} of rent${ok(e.rentPct) ? ` (${pct(e.rentPct, 1)})` : ''}`, src);
    if (ok(rrSum.lossToLeasePct)) add('Rent roll: loss to lease', pct(rrSum.lossToLeasePct, 1), `${src} against the market rents entered`);
  }
  if (scenario && scenario.changed && scenario.changed.length && scenario.returns) {
    const s = scenario.inputs;
    const r = scenario.returns;
    add('Scenario assumptions', `price ${money(s.price)}, NOI ${money(s.noi)}, hold ${s.hold} years, growth ${s.growth}%, exit cap ${s.exitCap}%`, 'scenario (the broker’s what-if, not the OM)');
    if (ok(r.leveredIrr)) add('Scenario: levered IRR', pct(r.leveredIrr), 'scenario, calculated');
    if (ok(r.leveredMultiple)) add('Scenario: equity multiple', `${r.leveredMultiple.toFixed(2)}x`, 'scenario, calculated');
  }
  if (comps && comps.n) {
    add('Sale comps loaded', String(comps.n), 'the Comps tab');
    if (ok(comps.median)) add('Sale comps: median $/SF', money2(comps.median), 'the Comps tab');
    if (ok(comps.medianCap)) add('Sale comps: median cap rate', pct(comps.medianCap), `the Comps tab (${comps.capN} report one)`);
    if (ok(m.vsMedian)) add('Asking $/SF against the comps’ median', `${m.vsMedian > 0 ? '+' : ''}${m.vsMedian.toFixed(1)}%`, 'calculated');
  }
  for (const c of m.checks || []) add('Check', c.text, 'the app’s consistency checks');
  for (const i of issues) add('Reconciliation', i.text, 'rent roll against the OM');
  return out;
}
