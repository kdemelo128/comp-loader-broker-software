/* NOI three ways (engine/figures.js rules noiOmT12, noiT12RentRoll,
 * noiOmRentRoll): only on a deal with a T-12; within 2% nothing, 2% to 5% a
 * note, above 5% a warning that says where the gap comes from; a partial year
 * or lines still to file are not compared. And the Review Queue's items
 * (review.js), worked out from where they live. Invented figures only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../app/deal.js';
import { analysisInput } from '../app/impact.js';
import { importStatement } from '../app/t12.js';
import { reviewItems, reviewCount } from '../app/review.js';
import { NOI_GAP } from '../app/engine/conventions.js';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** An invented statement: rent and expenses a month, over `n` months; T-12 NOI = 12 × (rent − taxes − other). */
function statement({ rent = 50000, taxes = 6000, other = 4000, n = 12, extra = [] } = {}) {
  const rows = [['Line', ...MON.slice(0, n).map((m) => `${m} 2025`), 'Total'], ['Base Rent', rent], ['Real Estate Taxes', taxes], ['Insurance', other], ...extra]
    .map((r, i) => ({ r: i + 1, cells: i ? [r[0], ...Array(n).fill(r[1]), r[1] * n] : r }));
  return importStatement(rows, { file: 'invented.xlsx' });
}
const deal = (figures, t12, extra = {}) => ({ figures, loan: {}, t12, ...extra });
const noiChecks = (d, rr = null) => analyze(analysisInput(d, { project: rr === null ? null : () => ({ annual: [{ noi: rr }] }) })).checks.filter((c) => /NOI|T-12/.test(c.text));

// the T-12's NOI here: 12 × (50,000 − 6,000 − 4,000) = 480,000
test('within 2%: they agree, nothing is said', () => {
  assert.deepEqual(noiChecks(deal({ noi: 489000 }, statement())), []);
  assert.ok(NOI_GAP.agree === 2 && NOI_GAP.warn === 5);
});

test('2% to 5%: noted, without a cause', () => {
  const [c] = noiChecks(deal({ noi: 500000 }, statement()));
  assert.equal(c.level, 'info');
  assert.equal(c.text, 'The T-12’s NOI ($480,000, Jan 2025 to Dec 2025) is 4.0% below the OM’s ($500,000).');
});

test('above 5%: a warning naming where the gap comes from, largest first, and when the OM is higher, why it may be', () => {
  const [c] = noiChecks(deal({ noi: 560000, gross: 640000, opex: 70000, taxes: 50000 }, statement()));
  assert.equal(c.level, 'warn');
  assert.equal(c.text, 'The T-12’s NOI ($480,000, Jan 2025 to Dec 2025) is 14.3% below the OM’s ($560,000). Most of the gap: operating expenses, $120,000 in the T-12 against $70,000 in the OM (real estate taxes $72,000 against $50,000); then effective gross income, $600,000 in the T-12 against $640,000. The OM’s NOI may be pro forma, or leave out expenses.');
  // the T-12 higher: no suggestion about the OM
  const [up] = noiChecks(deal({ noi: 420000 }, statement()));
  assert.equal(up.level, 'warn');
  assert.equal(up.text, 'The T-12’s NOI ($480,000, Jan 2025 to Dec 2025) is 12.5% above the OM’s ($420,000).');
});

test('the rent roll’s year 1 is compared, labelled a forecast; and the OM against it only on a deal with a T-12', () => {
  const cs = noiChecks(deal({ noi: 480000 }, statement(), { rr: { leases: [{ id: 'l1' }], settings: {} } }), 430000);
  assert.deepEqual(cs.map((c) => c.level), ['warn', 'warn']);
  assert.equal(cs[0].text, 'The T-12’s NOI ($480,000) is 10.4% above the rent roll’s forward-looking year 1 ($430,000). The rent roll’s year 1 is a projection, not an actual: check its operating expenses, vacancy and the leases’ rents.');
  assert.match(cs[1].text, /^The OM’s NOI \(\$480,000\) is 10\.4% above the rent roll’s forward-looking year 1 \(\$430,000\)\./);
  // no T-12: no comparison at all, however far apart (approved 2026-10-10)
  assert.deepEqual(noiChecks(deal({ noi: 900000 }, undefined, { rr: { leases: [{ id: 'l1' }], settings: {} } }), 430000), []);
});

test('a partial year, or lines still to file, aren’t compared: the deal says why', () => {
  const [p] = noiChecks(deal({ noi: 900000 }, statement({ n: 9 })));
  assert.equal(p.level, 'info');
  assert.equal(p.text, 'The T-12 has only 9 months, so its NOI isn’t compared with the OM’s or the rent roll’s.');
  const [u] = noiChecks(deal({ noi: 900000 }, statement({ extra: [['Pylon Sign Lease', 100]] })));
  assert.equal(u.text, 'Some T-12 lines are still to review (Review), so its NOI isn’t compared yet.');
});

test('after “Use the T-12’s figures”, the OM’s own NOI is what the T-12 is compared with', () => {
  const t = statement();
  t.applied = { at: 1, before: { noi: 560000, gross: null, opex: null, taxes: null } };
  const [c] = noiChecks(deal({ noi: 480000 }, t));
  assert.match(c.text, /below the OM’s \(\$560,000\)/);
});

test('Review: T-12 lines by label, checks not seen, AI readings not applied, template cells mapped with low confidence', () => {
  const t = statement({ n: 9, extra: [['Pylon Sign Lease', 100], ['Pylon Sign Lease', 50], ['Management Fees', 900]] });
  const d1 = { id: 'd1', name: 'Invented One', figures: {}, t12: t, ai: { extractions: [{ at: 1, files: ['a.pdf'], fields: [
    { key: 'price', value: 4500000, doc: 'a.pdf', page: 2, applied: false },
    { key: 'noi', value: 300000, applied: true },
    { key: 'occ', value: 92, applied: false, dismissed: true },
  ] }] } };
  const d2 = { id: 'd2', name: 'Invented Two', figures: {} };
  const tpl = { id: 't1', name: 'Invented model', mapping: { cells: [{ sheet: 'Inputs', cell: 'B9', field: 'bsf', confidence: 'low', why: 'beside “Area”' }, { sheet: 'Inputs', cell: 'B5', field: 'price', confidence: 'high' }] } };
  const g = reviewItems({ deals: [d2, d1], templates: [tpl, { ...tpl, id: 't2', archived: true }] });
  assert.deepEqual(g.map((x) => `${x.group}:${x.id}`), ['deal:d1', 'template:t1'], 'deals with nothing waiting, and archived templates, are left out');
  const items = g[0].items;
  assert.deepEqual(items.map((x) => x.kind), ['ai', 't12check', 't12line', 't12line'], 'most money at stake first');
  const pylon = items.find((x) => x.label === 'Pylon Sign Lease');
  assert.equal(pylon.count, 2, 'one item for a label on two lines');
  assert.equal(pylon.amount, 9 * 150);
  assert.deepEqual(items.find((x) => x.label === 'Management Fees').candidates, ['management', 'owner']);
  assert.equal(items.find((x) => x.kind === 'ai').label, 'Purchase / asking price');
  assert.equal(g[1].items[0].ref, 'B9');
  assert.equal(reviewCount(g), 5);
  // seen, filed, dismissed: gone
  t.seen = { months: true };
  for (const l of t.lines) if (!l.category) { l.category = 'otherOpex'; l.how = 'you'; }
  d1.ai.extractions[0].fields[0].dismissed = true;
  tpl.mapping.cells[0].confidence = 'high';
  assert.deepEqual(reviewItems({ deals: [d1, d2], templates: [tpl] }), []);
});
