/* brief.js -- a deal on one page, and in one text message.
 *
 * The site-visit brief is what a broker hands a manager or prints for the
 * file: the offering, the arithmetic, where it sits against the comps, what
 * doesn't add up, the questions to ask, and what was seen on site. The text
 * summary is the same in five lines, for a text or a Teams message. */

import { money0, money2, pct, signed, times, yrs, int, niceDate } from './kit.js';

const h = (doc, tag, cls, text) => {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
};
const ok = (x) => typeof x === 'number' && Number.isFinite(x);

export const placeLine = (f) => [f.address, [f.city, [f.state, f.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ');

/** Five lines that say what the deal is. */
export function dealSummaryText(deal, m, comps) {
  const f = deal.figures;
  const lines = [];
  lines.push(placeLine(f) || deal.name || 'Deal');
  lines.push([f.ptype, ok(f.bsf) ? `${int(f.bsf)} SF` : null, ok(f.units) ? `${int(f.units)} units` : null,
    ok(f.year) ? `built ${f.year}` : null, f.zoning ? `zoned ${f.zoning}` : null].filter(Boolean).join(' · '));
  lines.push([ok(m.price) ? `Asking ${money0(m.price)}` : (deal.unpriced ? 'Unpriced' : null), ok(m.ppsf) ? `${money2(m.ppsf)}/SF` : null,
    ok(m.cap) ? `${pct(m.cap)} cap` : null].filter(Boolean).join(' · '));
  lines.push([ok(m.noi) ? `NOI ${money0(m.noi)}${m.derived.noi ? ' (derived)' : ''}` : null, ok(f.occ) ? `${pct(f.occ, 1)} occupied` : null,
    m.leases && ok(m.leases.waltIncome) ? `WALT ${yrs(m.leases.waltIncome)}` : null, f.tenant ? `Tenant ${f.tenant}` : null].filter(Boolean).join(' · '));
  const L = deal.loan || {};
  if (ok(m.dscr)) {
    lines.push(`At ${pct(L.ltv, 0)} LTV, ${pct(L.rate)}, ${L.io ? 'interest only' : `${L.amort}-yr amortization`}: DSCR ${times(m.dscr)}, cash-on-cash ${pct(m.cashOnCash, 1)}`);
  }
  if (comps && comps.n && ok(m.vsWeighted)) {
    lines.push(`Against ${comps.n} sale comps (${money2(comps.weighted)}/SF weighted): ${signed(m.vsWeighted)}`);
  }
  return lines.filter(Boolean).join('\n');
}

/** Fill `box` with the deal brief (a page or two). `photos` are object URLs. */
export function renderDealBrief(box, { deal, m, comps, photos = [], preparedBy = '' }) {
  const doc = box.ownerDocument;
  box.textContent = '';
  const f = deal.figures;

  const head = h(doc, 'header', 'ps-head');
  const left = h(doc, 'div');
  left.appendChild(h(doc, 'div', 'ps-eyebrow', `${deal.example ? 'FICTIONAL SAMPLE · ' : ''}Deal brief${f.ptype ? ` · ${f.ptype}` : ''}`));
  left.appendChild(h(doc, 'h1', 'ps-title', f.address || deal.name || 'Deal'));
  const where = [f.city, f.state, f.zip].filter(Boolean).join(', ');
  if (where) left.appendChild(h(doc, 'div', 'ps-sub', where));
  head.appendChild(left);
  const right = h(doc, 'div', 'ps-meta');
  if (preparedBy) right.appendChild(h(doc, 'div', null, `Prepared by ${preparedBy}`));
  right.appendChild(h(doc, 'div', null, niceDate(new Date())));
  if (deal.source) right.appendChild(h(doc, 'div', null, `From ${deal.source}`));
  head.appendChild(right);
  box.appendChild(head);

  const stats = h(doc, 'div', 'ps-stats');
  const stat = (k, v, s) => {
    const d = h(doc, 'div', 'ps-stat');
    d.appendChild(h(doc, 'div', 'k', k));
    d.appendChild(h(doc, 'div', 'v', v));
    if (s) d.appendChild(h(doc, 'div', 's', s));
    stats.appendChild(d);
  };
  stat('Asking price', ok(m.price) ? money0(m.price) : (deal.unpriced ? 'Unpriced' : '—'), ok(m.ppsf) ? `${money2(m.ppsf)}/SF` : null);
  stat('Cap rate on asking', ok(m.capCalc) ? pct(m.capCalc) : (ok(f.cap) ? pct(f.cap) : '—'), ok(f.cap) && ok(m.capCalc) && Math.abs(f.cap - m.capCalc) >= 0.1 ? `OM states ${pct(f.cap)}` : null);
  stat('NOI', ok(m.noi) ? money0(m.noi) : '—', m.derived.noi ? 'derived from price and cap' : (ok(m.noiPsf) ? `${money2(m.noiPsf)}/SF` : null));
  stat('DSCR at the terms below', ok(m.dscr) ? times(m.dscr) : '—', ok(m.cashOnCash) ? `cash-on-cash ${pct(m.cashOnCash, 1)}` : null);
  box.appendChild(stats);

  const cols = h(doc, 'div', 'ps-cols');
  const kv = (title, rows) => {
    const wrap = h(doc, 'div');
    wrap.appendChild(h(doc, 'h2', 'ps-h2', title));
    const t = h(doc, 'table', 'ps-kv');
    for (const [k, v] of rows) {
      if (v === null || v === undefined || v === '' || v === '—') continue;
      const tr = h(doc, 'tr');
      tr.appendChild(h(doc, 'td', null, k));
      tr.appendChild(h(doc, 'td', null, String(v)));
      t.appendChild(tr);
    }
    wrap.appendChild(t);
    return wrap;
  };
  const L = deal.loan || {};
  const left2 = h(doc, 'div');
  left2.appendChild(kv('The property', [
    ['Building SF', ok(f.bsf) ? int(f.bsf) : null], ['Land', ok(f.lot_sf) ? `${int(f.lot_sf)} SF (${(f.lot_sf / 43560).toFixed(2)} ac)` : null],
    ['Units', ok(f.units) ? int(f.units) : null], ['Year built', f.year], ['Zoning', f.zoning], ['Occupancy', ok(m.occ) ? `${pct(m.occ, 1)}${m.occSource === 'rent roll' ? ' (rent roll)' : ''}` : null],
    ['Tenant', f.tenant], ['Lease type', f.lease_type], ['Lease expiration', f.lease_exp], ['Term remaining', f.term_left],
    ['Rent increases', f.increases],
  ]));
  left2.appendChild(kv('Income', [
    ['Gross potential rent', ok(f.gpr) ? money0(f.gpr) : null], ['Gross income (EGI)', ok(f.gross) ? money0(f.gross) : null], ['Operating expenses', ok(f.opex) ? money0(f.opex) : null],
    ['Expense ratio', ok(m.expenseRatio) ? pct(m.expenseRatio, 1) : null], ['Real estate taxes', ok(f.taxes) ? money0(f.taxes) : null],
    ['Pro forma NOI', ok(f.noi_pf) ? money0(f.noi_pf) : null],
    ['WALT (by income)', m.leases && ok(m.leases.waltIncome) ? yrs(m.leases.waltIncome) : null],
    ['Rent rolling in 24 months', m.leases && ok(m.leases.roll24Pct) ? pct(m.leases.roll24Pct, 0) : null],
  ]));
  cols.appendChild(left2);
  const right2 = h(doc, 'div');
  right2.appendChild(kv(`Financing: ${ok(L.ltv) ? pct(L.ltv, 0) : '—'} LTV, ${ok(L.rate) ? pct(L.rate) : '—'}, ${L.io ? 'interest only' : `${L.amort || '—'}-yr`}`, [
    ['Loan', ok(m.loan) ? money0(m.loan) : null], ['Annual debt service', ok(m.debtService) ? money0(m.debtService) : null],
    ['Debt yield', ok(m.debtYield) ? pct(m.debtYield) : null], ['Cash flow after debt', ok(m.cashFlow) ? money0(m.cashFlow) : null],
    ['Equity with closing costs', ok(m.equity) ? money0(m.equity) : null], [m.breakEvenBasis === 'egi' ? 'Break-even, share of income' : 'Break-even occupancy', ok(m.breakEven) ? `${pct(m.breakEven, 1)}${m.breakEvenBasis === 'egi-occ' ? ' (est.)' : ''}` : null],
    ['Maximum loan', m.maxLoan ? `${money0(m.maxLoan.loan)} (${m.maxLoan.binding})` : null],
  ]));
  if (comps && comps.n) {
    right2.appendChild(kv(`Against ${comps.n} sale comps`, [
      ['Comps, SF-weighted $/SF', money2(comps.weighted)], ['Comps, median $/SF', money2(comps.median)],
      ['Asking against weighted', ok(m.vsWeighted) ? signed(m.vsWeighted) : null],
      ['Value at weighted $/SF', ok(m.valueAtWeighted) ? money0(m.valueAtWeighted) : null],
      ['Value at median comp cap', ok(m.valueAtMedianCap) ? `${money0(m.valueAtMedianCap)} (${pct(comps.medianCap)})` : null],
    ]));
  }
  if (m.ladder.length) {
    right2.appendChild(kv('Value across cap rates', m.ladder.filter((_, i) => i % 2 === 0).map((x) => [pct(x.cap), `${money0(x.value)}${ok(x.ppsf) ? ` · ${money2(x.ppsf)}/SF` : ''}`])));
  }
  cols.appendChild(right2);
  box.appendChild(cols);

  const list = (title, items) => {
    if (!items.length) return;
    box.appendChild(h(doc, 'h2', 'ps-h2', title));
    const ul = h(doc, 'ul', 'ps-list');
    for (const t of items) ul.appendChild(h(doc, 'li', null, t));
    box.appendChild(ul);
  };
  const two = h(doc, 'div', 'ps-cols');
  const a = h(doc, 'div');
  const b = h(doc, 'div');
  two.append(a, b);
  box.appendChild(two);
  const into = (target, fn) => { const keep = box; box = target; fn(); box = keep; };
  into(a, () => list('What doesn’t add up', m.checks.map((c) => c.text)));
  into(a, () => list('Questions to ask', deal.activeQuestions || m.questions));
  into(b, () => list('Site visit', deal.visitLines || []));
  into(b, () => list('Scenarios: assumptions, not the OM’s figures', deal.scenarioLines || []));
  if (photos.length) {
    const g = h(doc, 'div', 'ps-photos');
    for (const url of photos.slice(0, 8)) {
      const img = h(doc, 'img');
      img.src = url;
      img.alt = '';
      g.appendChild(img);
    }
    b.appendChild(g);
  }
  box.appendChild(h(doc, 'p', 'ps-foot',
    'Figures read from the offering memorandum and checked against each other; "derived" figures were worked out from the others. '
    + 'Verify against the leases, the operating statements and the title before relying on any of them. Compiled with Zlatura.'));
}
