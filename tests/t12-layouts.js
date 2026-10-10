/* Invented T-12 layouts for the tests: every property, label and figure is
 * made up. They copy only the shapes real operating statements come in
 * (docs/proposals/t12-review-queue.md, section 6). Monthly amounts are kept
 * simple (most lines the same each month) so each expected total below can
 * be checked by hand: 12 × the monthly amount, plus the odd month noted.
 *
 * Each layout: { name, file, kind: 'xlsx'|'csv', build(ExcelJS) → workbook
 * (xlsx) or text (csv), expect }. */

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const twelve = (v) => Array(12).fill(v);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
/** A sheet from rows of values (numbers, text, Dates, null). */
function sheet(wb, name, rows, { merges = [], hidden = false } = {}) {
  const ws = wb.addWorksheet(name, hidden ? { state: 'hidden' } : {});
  rows.forEach((r) => ws.addRow(r));
  for (const m of merges) ws.mergeCells(m);
  return ws;
}
const csv = (rows) => rows.map((r) => r.map((v) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(',')).join('\r\n');
const money = (n) => (n < 0 ? `(${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2 })})` : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);

/* 1. An accounting system's export: account numbers, sections, dated months, a Total column. */
const acctLines = [
  ['INCOME'],
  ['4010', 'Base Rent', twelve(20000)],
  ['4020', 'CAM Reimbursements', twelve(1500)],
  ['4030', 'Parking Income', twelve(800)],
  ['4090', 'Late Fees', [0, 0, 150, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ['', 'Total Income', null],
  ['OPERATING EXPENSES'],
  ['6110', 'Real Estate Taxes', twelve(3000)],
  ['6120', 'Property Insurance', twelve(700)],
  ['6210', 'Electricity', twelve(900)],
  ['6220', 'Water & Sewer', twelve(250)],
  ['6310', 'Repairs & Maintenance', twelve(1100)],
  ['6410', 'Janitorial Services', twelve(1200)],
  ['6510', 'Property Management Fees', twelve(900)],
  ['6610', 'Legal & Accounting', twelve(300)],
  ['', 'Total Operating Expenses', null],
  ['', 'Net Operating Income', null],
  ['NON-OPERATING'],
  ['7110', 'Capital Improvements', [0, 0, 0, 0, 0, 12000, 0, 0, 0, 0, 0, 0]],
  ['7210', 'Asset Management Fee', twelve(400)],
  ['7310', 'Mortgage Interest', twelve(5500)],
  ['7410', 'Depreciation', twelve(2600)],
];
function acct(wb) {
  const income = acctLines.slice(1, 5); const exp = acctLines.slice(7, 15);
  const tot = (ls) => twelve(0).map((_, i) => sum(ls.map((l) => l[2][i])));
  const months = twelve(0).map((_, i) => new Date(Date.UTC(2025, i, 1)));
  const rows = [['Invented Plaza Holdings LLC'], ['Income Statement - Trailing 12 Months'], ['Period: Jan 2025 - Dec 2025'], [], ['Acct', 'Description', ...months, 'Total']];
  for (const l of acctLines) {
    if (l.length === 1) { rows.push([null, l[0]]); continue; }
    const vals = l[2] || (l[1] === 'Total Income' ? tot(income) : l[1] === 'Total Operating Expenses' ? tot(exp) : twelve(0).map((_, i) => tot(income)[i] - tot(exp)[i]));
    rows.push([l[0] || null, l[1], ...vals, sum(vals)]);
  }
  sheet(wb, 'Income Statement', rows);
  return wb;
}

/* 2. Months as text ("Jan-25"), expenses written negative, no section headings, the NOI stated. */
function negExp(wb) {
  const rows = [['Invented Commons'], ['Line item', ...MON.map((m) => `${m}-25`), 'T12'],
    ['Rental Revenue', ...twelve(15000), 180000],
    ['Tenant Reimbursements', ...twelve(2000), 24000],
    ['Real Estate Taxes', ...twelve(-2500), -30000],
    ['Insurance', ...twelve(-600), -7200],
    ['Utilities', ...twelve(-1000), -12000],
    ['Landscaping', ...twelve(-400), -4800],
    ['Repairs and Maintenance', ...twelve(-1500), -18000],
    ['Property Management', ...twelve(-700), -8400],
    ['Net Operating Income', ...twelve(15000 + 2000 - 2500 - 600 - 1000 - 400 - 1500 - 700), 123600],
  ];
  sheet(wb, 'T12', rows);
  return wb;
}

/* 3. A CSV: "$" amounts as text, negatives in brackets, blank rows, subtotals, months as 01/2025. */
function csvBlank() {
  const head = ['GL Description', ...twelve(0).map((_, i) => `${String(i + 1).padStart(2, '0')}/2025`), 'Total'];
  const row = (label, v) => [label, ...twelve(v).map(money), money(v * 12)];
  return csv([
    ['Invented Gardens Apartments - 12 Month Statement'], [],
    head, [],
    ['Revenue'],
    row('Gross Potential Rent', 50000),
    row('Vacancy Loss', -2500),
    row('Laundry Income', 300),
    row('Total Revenue', 47800), [],
    ['Expenses'],
    row('Electric', 1200),
    row('Gas', 400),
    row('Total Utilities', 1600),
    row('Repairs', 2000),
    row('Turnover / Make Ready', 800),
    row('Total Repairs', 2800),
    row('Real Estate Taxes', 4000),
    row('Insurance', 1500),
    row('Payroll', 3500),
    row('Total Expenses', 1600 + 2800 + 4000 + 1500 + 3500), [],
    row('Net Operating Income', 47800 - 13400),
  ]);
}

/* 4. A property manager's workbook: title rows, a merged heading above the months, full month names, a hidden notes sheet and a short summary sheet. */
function pmWorkbook(wb) {
  const rows = [
    ['INVENTED CENTER'], ['Operating Statement'], [],
    [null, 'Trailing Twelve Months', null, null, null, null, null, null, null, null, null, null, null, null],
    ['Description', ...FULL.map((m) => `${m} 2025`), 'Annual Total'],
    ['Revenue'],
    ['Minimum Rent', ...twelve(30000), 360000],
    ['Percentage Rent', ...[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6000], 6000],
    ['Tax Recovery', ...twelve(2500), 30000],
    ['Insurance Reimbursement', ...twelve(500), 6000],
    ['Total Revenue', ...twelve(0).map((_, i) => 33000 + (i === 11 ? 6000 : 0)), 402000],
    ['Expenses'],
    ['Property Taxes', ...twelve(3200), 38400],
    ['Insurance Premium', ...twelve(650), 7800],
    ['Common Area Maintenance', ...twelve(1800), 21600],
    ['Snow Removal', ...[3000, 2500, 1000, 0, 0, 0, 0, 0, 0, 0, 1500, 2000], 10000],
    ['Security Patrol', ...twelve(900), 10800],
    ['Management Fee - Property', ...twelve(1000), 12000],
    ['Marketing', ...twelve(200), 2400],
    ['Total Expenses', ...twelve(0), 103000],
    ['Net Operating Income', ...twelve(0), 299000],
  ];
  sheet(wb, 'Operating Statement', rows, { merges: ['A1:D1', 'B4:M4'] });
  sheet(wb, 'Notes', [['These figures are invented.'], ['Prepared for testing only.']], { hidden: true });
  sheet(wb, 'Summary', [['Item', 'Total'], ['Revenue', 402000], ['Expenses', 103000]]);
  return wb;
}

/* 5. A partial year: nine months and a YTD column. */
function partial(wb) {
  const nine = (v) => Array(9).fill(v);
  sheet(wb, 'YTD', [
    ['Invented Lofts - YTD'],
    ['Account', ...MON.slice(0, 9).map((m) => `${m} 2025`), 'YTD'],
    ['Rent Income', ...nine(12000), 108000],
    ['Real Estate Taxes', ...nine(1500), 13500],
    ['Insurance', ...nine(400), 3600],
    ['Repairs & Maintenance', ...nine(700), 6300],
  ]);
  return wb;
}

/* 6. A Total column that disagrees with its months on two lines. */
function badTotal(wb) {
  sheet(wb, 'Statement', [
    ['Line', ...MON.map((m) => `${m} 2025`), 'Total'],
    ['Base Rent', ...twelve(8000), 96000],
    ['Real Estate Taxes', ...twelve(1000), 13000],
    ['Insurance', ...twelve(300), 3600],
    ['Utilities', ...twelve(500), 5500],
  ]);
  return wb;
}

/* 7. Multifamily: loss to lease, vacancy, concessions, bad debt, other income, payroll, a bare "Management Fees", months numbered. */
function multifamily() {
  const head = ['Category', ...twelve(0).map((_, i) => `Month ${i + 1}`), 'Total'];
  const row = (label, v) => [label, ...twelve(v), v * 12];
  return csv([
    ['Invented Ridge Apartments'], head,
    ['INCOME'],
    row('Gross Potential Rent', 90000),
    row('Loss to Lease', -2000),
    row('Vacancy', -4500),
    row('Concessions', -1000),
    row('Bad Debt', -500),
    row('Pet Fees', 400),
    row('RUBS Income', 1800),
    row('Application Fees', 200),
    ['EXPENSES'],
    row('Salaries & Wages', 7000),
    row('Payroll Taxes', 600),
    row('Management Fees', 3300),
    row('Pest Control', 250),
    row('Landscape Contract', 900),
    row('Real Estate Taxes', 8000),
    row('Insurance', 2500),
    row('Water/Sewer', 2600),
    row('Advertising', 500),
    row('Office Supplies', 150),
  ]);
}

/* 8. Retail NNN: recoveries, an asset management fee and owner costs below the line, and a line no rule knows. */
function retailNnn(wb) {
  sheet(wb, 'P&L', [
    ['Invented Square'],
    ['', ...MON.map((m) => `${m} 25`), 'TTM'],
    ['Income'],
    ['Base Rent', ...twelve(25000), 300000],
    ['CAM Recoveries', ...twelve(3000), 36000],
    ['Real Estate Tax Recoveries', ...twelve(2800), 33600],
    ['Total Income', ...twelve(30800), 369600],
    ['Operating Expenses'],
    ['Real Estate Taxes', ...twelve(2800), 33600],
    ['Insurance', ...twelve(600), 7200],
    ['Common Area Maintenance', ...twelve(2400), 28800],
    ['Pylon Sign Lease', ...twelve(100), 1200],
    ['Total Operating Expenses', ...twelve(5900), 70800],
    ['Net Operating Income', ...twelve(24900), 298800],
    ['Below the Line'],
    ['Asset Management Fee', ...twelve(1000), 12000],
    ['Partnership Expenses', ...twelve(150), 1800],
    ['Leasing Commissions', ...[0, 0, 0, 0, 9000, 0, 0, 0, 0, 0, 0, 0], 9000],
  ]);
  return wb;
}

export const LAYOUTS = [
  {
    name: 'accounting export', file: 'invented-acct.xlsx', kind: 'xlsx', build: acct,
    expect: {
      months: 12, egi: 12 * (20000 + 1500 + 800) + 150, opex: 12 * (3000 + 700 + 900 + 250 + 1100 + 1200 + 900 + 300),
      by: { rent: 240000, recoveries: 18000, parking: 9600, otherIncome: 150, taxes: 36000, insurance: 8400, utilities: 12 * 1150, repairs: 13200, contract: 14400, management: 10800, admin: 3600, capex: 12000, owner: 4800, debt: 66000, depreciation: 31200 },
      review: [], checks: [],
    },
  },
  {
    name: 'negative expenses', file: 'invented-neg.xlsx', kind: 'xlsx', build: negExp,
    expect: { months: 12, egi: 204000, opex: 80400, by: { rent: 180000, recoveries: 24000, taxes: 30000, insurance: 7200, utilities: 12000, contract: 4800, repairs: 18000, management: 8400 }, review: [], checks: [] },
  },
  {
    name: 'CSV with subtotals', file: 'invented-gardens.csv', kind: 'csv', build: csvBlank,
    expect: { months: 12, egi: 12 * 47800, opex: 12 * 13400, by: { rent: 600000, vacancy: -30000, otherIncome: 3600, utilities: 19200, repairs: 33600, taxes: 48000, insurance: 18000, payroll: 42000 }, review: [], checks: [] },
  },
  {
    name: 'property manager workbook', file: 'invented-center.xlsx', kind: 'xlsx', build: pmWorkbook,
    // the stated monthly subtotals of expenses and NOI are left at 0 in the months, as some reports do; the Annual Total column is the file's
    expect: { months: 12, egi: 402000, opex: 103000, by: { rent: 366000, recoveries: 36000, taxes: 38400, insurance: 7800, repairs: 21600, contract: 20800, management: 12000, admin: 2400 }, review: [], checks: [], sheet: 'Operating Statement' },
  },
  {
    name: 'nine months', file: 'invented-lofts.xlsx', kind: 'xlsx', build: partial,
    expect: { months: 9, egi: 108000, opex: 13500 + 3600 + 6300, by: { rent: 108000, taxes: 13500, insurance: 3600, repairs: 6300 }, review: [], checks: ['months'] },
  },
  {
    name: 'total column disagrees', file: 'invented-bad.xlsx', kind: 'xlsx', build: badTotal,
    expect: { months: 12, egi: 96000, opex: 12000 + 3600 + 6000, by: { rent: 96000, taxes: 12000, insurance: 3600, utilities: 6000 }, review: [], checks: ['linetotals'] },
  },
  {
    name: 'multifamily', file: 'invented-ridge.csv', kind: 'csv', build: multifamily,
    expect: {
      months: 12,
      // the bare "Management Fees" waits for review, so it is in no category yet
      egi: 12 * (90000 - 2000 - 4500 - 1000 - 500 + 400 + 1800 + 200), opex: 12 * (7000 + 600 + 250 + 900 + 8000 + 2500 + 2600 + 500 + 150),
      by: { rent: 1080000, vacancy: 12 * -7000, concessions: -12000, otherIncome: 12 * 600, recoveries: 21600, payroll: 12 * 7600, repairs: 3000, contract: 10800, taxes: 96000, insurance: 30000, utilities: 31200, admin: 7800 },
      review: ['Management Fees'], checks: [],
    },
  },
  {
    name: 'retail NNN', file: 'invented-square.xlsx', kind: 'xlsx', build: retailNnn,
    expect: { months: 12, egi: 369600, opex: 33600 + 7200 + 28800, by: { rent: 300000, recoveries: 69600, taxes: 33600, insurance: 7200, repairs: 28800, owner: 13800, tiLc: 9000 }, review: ['Pylon Sign Lease'], checks: [] },
  },
];

/** The layout's file as bytes (xlsx) or text (csv). */
export async function layoutFile(L, ExcelJS) {
  if (L.kind === 'csv') return L.build();
  const wb = L.build(new ExcelJS.Workbook());
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
