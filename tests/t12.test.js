/* The T-12 reader (app/t12.js) on invented layouts (tests/t12-layouts.js):
 * months, signs, subtotals and totals read; each line put in its category;
 * totals checked against figures worked out by hand. Files are made when the
 * test runs and read the way the app reads them (sheetread.js). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { LAYOUTS, layoutFile } from './t12-layouts.js';
import { gridsOf, csvRows } from '../app/sheetread.js';
import {
  CATEGORIES, CATEGORY, normalizeLabel, matchLabel, amountOf, monthOf, bestSheet, statementTotals, statementChecks,
  openLines, rematch, t12ForAnalysis,
} from '../app/t12.js';

async function read(L, opts = {}) {
  const f = await layoutFile(L, ExcelJS);
  if (L.kind === 'csv') return bestSheet([{ sheet: 'CSV', rows: csvRows(f).map((cells, i) => ({ r: i + 1, cells })).filter((x) => x.cells.some((v) => String(v).trim())) }], { file: L.file, ...opts });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(f);
  return bestSheet(gridsOf(wb), { file: L.file, ...opts });
}

test('amounts as statements write them', () => {
  assert.equal(amountOf('$1,250.50'), 1250.5);
  assert.equal(amountOf('(1,250.00)'), -1250);
  assert.equal(amountOf('1,250-'), -1250);
  assert.equal(amountOf('-'), 0);
  assert.equal(amountOf('–'), 0);
  assert.equal(amountOf(-30), -30);
  assert.ok(Number.isNaN(amountOf('Rent')));
  assert.ok(Number.isNaN(amountOf('')));
});

test('months as headings come in many forms', () => {
  assert.deepEqual(monthOf('2025-01-01'), { iso: '2025-01' });
  assert.deepEqual(monthOf('Jan-25'), { iso: '2025-01' });
  assert.deepEqual(monthOf('January 2025'), { iso: '2025-01' });
  assert.deepEqual(monthOf('01/2025'), { iso: '2025-01' });
  assert.deepEqual(monthOf('1/31/2025'), { iso: '2025-01' });
  assert.deepEqual(monthOf("Dec '24"), { iso: '2024-12' });
  assert.deepEqual(monthOf('Month 3'), { index: 3 });
  assert.equal(monthOf('Total'), null);
  assert.equal(monthOf('Janitorial 2025'), null, 'a word starting like a month is not a month');
  assert.equal(monthOf('13/2025'), null);
});

test('labels: normalised without account numbers or punctuation', () => {
  assert.equal(normalizeLabel('6100-000 · Repairs & Maintenance'), 'repairs and maintenance');
  assert.equal(normalizeLabel('4010 - Base Rent'), 'base rent');
  assert.equal(normalizeLabel('Water/Sewer (5210)'), 'water sewer');
  assert.equal(normalizeLabel('  R.E. Taxes  '), 'r e taxes');
});

test('matching: rules, the section a line sits in, and your corrections first', () => {
  assert.equal(matchLabel('Real Estate Taxes').category, 'taxes');
  assert.equal(matchLabel('Payroll Taxes').category, 'payroll');
  assert.equal(matchLabel('Tax Recoveries').category, 'recoveries');
  assert.equal(matchLabel('Parking Income').category, 'parking', 'a specific category wins over “income”');
  assert.equal(matchLabel('Asset Management Fee').category, 'owner', 'asset management is an owner cost, below the line');
  assert.equal(matchLabel('Property Management Fees').category, 'management');
  // a bare management fee is never guessed (approved 2026-10-10)
  for (const l of ['Management Fees', 'Management fee', 'MANAGEMENT', 'Mgmt Fee']) {
    const m = matchLabel(l);
    assert.equal(m.category, null, l);
    assert.equal(m.how, 'review');
    assert.deepEqual(m.candidates, ['management', 'owner']);
  }
  // the section decides between two fits, and refuses a misfit
  assert.equal(matchLabel('Common Area Maintenance', { section: 'expense' }).category, 'repairs');
  assert.equal(matchLabel('Common Area Maintenance', { section: 'income' }).category, 'recoveries');
  assert.equal(matchLabel('Common Area Maintenance').how, 'review', 'with no section, two fits wait for you');
  assert.equal(matchLabel('Pylon Sign Lease').how, 'review', 'no rule: waits for you');
  // your correction wins, by normalised label
  const corrections = { 'management fees': 'management', 'pylon sign lease': 'otherOpex' };
  assert.deepEqual([matchLabel('6400 · Management Fees', { corrections }).category, matchLabel('6400 · Management Fees', { corrections }).how], ['management', 'yours']);
  assert.equal(matchLabel('Pylon Sign Lease', { corrections }).category, 'otherOpex');
  // a correction naming a category that no longer exists is ignored
  assert.equal(matchLabel('Pylon Sign Lease', { corrections: { 'pylon sign lease': 'gone' } }).how, 'review');
});

test('every category has a side and rules, and the lists the design names', () => {
  assert.deepEqual(CATEGORIES.filter((c) => c.side === 'income').map((c) => c.id), ['rent', 'vacancy', 'concessions', 'recoveries', 'parking', 'otherIncome']);
  assert.deepEqual(CATEGORIES.filter((c) => c.side === 'expense').map((c) => c.id), ['taxes', 'insurance', 'utilities', 'repairs', 'contract', 'management', 'payroll', 'admin', 'otherOpex']);
  assert.deepEqual(CATEGORIES.filter((c) => c.side === 'below').map((c) => c.id), ['capex', 'reserves', 'tiLc', 'debt', 'depreciation', 'owner']);
  for (const c of CATEGORIES) assert.ok(c.rules.length && c.label, c.id);
});

for (const L of LAYOUTS) {
  test(`layout: ${L.name}`, async () => {
    const t = await read(L);
    if (L.expect.sheet) assert.equal(t.sheet, L.expect.sheet, 'the statement sheet, not the summary or the hidden notes');
    assert.equal(t.months.length, L.expect.months, 'months');
    const T = statementTotals(t);
    for (const [id, v] of Object.entries(L.expect.by)) assert.equal(T.by[id], v, `${id}: ${T.by[id]} (expected ${v})`);
    for (const c of CATEGORIES) if (!(c.id in L.expect.by)) assert.equal(T.by[c.id], 0, `${c.id} should be empty, is ${T.by[c.id]}`);
    assert.equal(T.egi, L.expect.egi, 'EGI');
    assert.equal(T.opex, L.expect.opex, 'operating expenses');
    assert.equal(T.noi, L.expect.egi - L.expect.opex, 'NOI');
    assert.deepEqual(openLines(t).map((l) => l.label), L.expect.review, 'lines for review');
    assert.deepEqual(statementChecks(t).map((c) => c.id), L.expect.checks, 'checks');
  });
}

test('signs: expenses written negative read as costs; the stated NOI agrees', async () => {
  const t = await read(LAYOUTS.find((L) => L.name === 'negative expenses'));
  assert.equal(t.signs.expensesNegative, true);
  assert.ok(t.lines.filter((l) => CATEGORY[l.category].side === 'expense').every((l) => l.total > 0));
  assert.equal(t.stated.noi.value, 123600);
  assert.equal(statementTotals(t).noi, 123600);
});

test('subtotals the file states are checked against their lines', async () => {
  const L = LAYOUTS.find((x) => x.name === 'CSV with subtotals');
  const t = await read(L);
  assert.deepEqual(t.subtotals.map((s) => s.label), ['Total Utilities', 'Total Repairs']);
  assert.deepEqual(statementChecks(t), []);
  // a subtotal that doesn't match is reported, naming the row
  const bad = { ...t, subtotals: t.subtotals.map((s, i) => (i === 0 ? { ...s, value: s.value + 500 } : s)) };
  const c = statementChecks(bad);
  assert.equal(c.length, 1);
  assert.match(c[0].text, /“Total Utilities” \(row \d+\) is \$19,700; the 2 lines above it add up to \$19,200\./);
});

test('a partial year is kept as it is, never scaled up, and says how many months', async () => {
  const t = await read(LAYOUTS.find((L) => L.name === 'nine months'));
  const [c] = statementChecks(t);
  assert.match(c.text, /^Only 9 months \(Jan 2025 to Sep 2025\): the totals are for those months and are not scaled up to a year\.$/);
  assert.equal(t12ForAnalysis(t).months, 9);
  assert.equal(statementTotals(t).by.rent, 108000, 'nine months of rent, not twelve');
});

test('your choice for a label, remembered, decides it on the next file', async () => {
  const L = LAYOUTS.find((x) => x.name === 'multifamily');
  const t = await read(L);
  assert.deepEqual(openLines(t).map((l) => l.label), ['Management Fees']);
  const again = await read(L, { corrections: { 'management fees': 'management' } });
  assert.deepEqual(openLines(again), []);
  assert.equal(statementTotals(again).by.management, 12 * 3300);
  // and a statement already read is matched again when a correction is saved
  const re = rematch(t, { 'management fees': 'owner' });
  assert.equal(statementTotals(re).by.owner, 12 * 3300);
  assert.equal(re.lines.find((l) => l.label === 'Management Fees').how, 'yours');
  // a line you decided by hand is not overruled
  const hand = { ...t, lines: t.lines.map((l) => (l.label === 'Management Fees' ? { ...l, category: 'management', how: 'you' } : l)) };
  assert.equal(rematch(hand, { 'management fees': 'owner' }).lines.find((l) => l.label === 'Management Fees').category, 'management');
});

test('a file that isn’t a statement says what was missing', () => {
  assert.throws(() => bestSheet([{ sheet: 'Sheet1', rows: [{ r: 1, cells: ['Name', 'Phone'] }, { r: 2, cells: ['A', '555'] }] }]), /No months or total column were found on “Sheet1”/);
});

test('what the analysis reads of a T-12', async () => {
  const t = await read(LAYOUTS[0]);
  const a = t12ForAnalysis(t);
  assert.deepEqual(Object.keys(a), ['noi', 'egi', 'opex', 'taxes', 'months', 'from', 'to', 'unassigned']);
  assert.equal(a.from, '2025-01');
  assert.equal(a.to, '2025-12');
  assert.equal(a.taxes, 36000);
  assert.equal(t12ForAnalysis(null), null);
});
