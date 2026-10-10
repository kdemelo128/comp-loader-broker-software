/* rrbook.js -- the rent roll as an Excel workbook: the rent roll as of a
 * date, every lease period (documented and projected, labelled), and the
 * cash flow by year through NOI.
 *
 * Totals, rent per SF, shares and the NOI bridge are live formulas with their
 * values stored beside them; the monthly accrual of each lease (day-weighted
 * proration, abatements, rollover) is the app's own arithmetic and goes in as
 * values, labelled so. */

import { XL, colLetter } from './workbook.js';
import { cleanPackage } from './package.js';
import { project, rentRollSummary, monthlyAmount, inPlace, dayOf, UNITS } from './lease.js';

const ok = (x) => typeof x === 'number' && Number.isFinite(x);
const serial = (iso) => (iso && dayOf(iso) !== null ? dayOf(iso) + 25569 : null);

export async function buildRentRollWorkbook(ExcelJS, fflate, { deal, rr, app = 'Zlatura' }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = app;
  wb.created = new Date();
  wb.calcProperties = { fullCalcOnLoad: true };
  addRentRollTabs(wb, deal, rr);
  wb.views = [{ activeTab: 0, firstSheet: 0, visibility: 'visible' }];
  return cleanPackage(fflate, await wb.xlsx.writeBuffer(), { charts: null });
}

/** The three tabs, added to any workbook (the deal workbook carries them too). */
export function addRentRollTabs(wb, deal, rr) {
  // read here, not at load: workbook.js and this module import each other
  const { sheet, title, band, headerRow, f, v, label, note, rate, MONEY, MONEY2, SF, PCT1, DATE, NUM1 } = XL;
  const asOf = rr.settings.asOf;
  const name = deal.name || (deal.figures && deal.figures.address) || 'Property';
  const sum = rentRollSummary(rr, asOf);

  // --- the rent roll
  const ws = sheet(wb, 'Rent Roll', [10, 28, 10, 11, 12, 12, 13, 11, 11, 10, 12, 30], 'FF0F766E');
  title(ws, 1, 12, `Rent Roll — ${name}`, `As of ${asOf}. Rent in force on that date, before free rent. Blue figures are inputs; totals and shares are live formulas. ${deal.example ? 'FICTIONAL SAMPLE: not a real property.' : ''}`);
  label(ws, 'A3', 'As of');
  v(ws, 'B3', serial(asOf), DATE, { input: true });
  headerRow(ws, 5, ['Unit', 'Tenant', 'SF', 'Status', 'Lease start', 'Lease end', 'Annual rent', 'Rent / SF', '% of SF', '% of rent', 'Years left', 'Source']);
  const first = 6;
  rr.leases.forEach((L, i) => {
    const r = first + i;
    const ip = inPlace(L, asOf);
    v(ws, `A${r}`, L.unit || '', null, { input: true });
    v(ws, `B${r}`, L.vacant ? 'Vacant' : (L.tenant || ''), null, { input: true });
    v(ws, `C${r}`, ok(L.sf) ? L.sf : null, SF, { input: true });
    v(ws, `D${r}`, L.vacant || !ip.monthly ? 'Vacant' : 'Leased', null, { input: true });
    v(ws, `E${r}`, serial(L.leaseStart), DATE, { input: true });
    v(ws, `F${r}`, serial(L.leaseEnd), DATE, { input: true });
    v(ws, `G${r}`, L.vacant || !ip.monthly ? null : ip.monthly * 12, MONEY, { input: true });
    f(ws, `H${r}`, rate(`G${r}`, `C${r}`), !L.vacant && ip.monthly && ok(L.sf) ? (ip.monthly * 12) / L.sf : null, MONEY2, { align: 'right' });
    f(ws, `I${r}`, rate(`C${r}`, `$C$${first + rr.leases.length + 1}`), sum.totalSf && ok(L.sf) ? L.sf / sum.totalSf : null, PCT1, { align: 'right' });
    f(ws, `J${r}`, rate(`G${r}`, `$G$${first + rr.leases.length + 1}`), sum.annualRent && !L.vacant && ip.monthly ? (ip.monthly * 12) / sum.annualRent : null, PCT1, { align: 'right' });
    const yl = !L.vacant && ip.monthly && dayOf(L.leaseEnd) !== null ? Math.max(0, (dayOf(L.leaseEnd) - dayOf(asOf)) / 365.25) : null;
    f(ws, `K${r}`, `IF(OR(F${r}="",D${r}<>"Leased"),"",MAX(0,(F${r}-$B$3)/365.25))`, yl, NUM1, { align: 'right' });
    v(ws, `L${r}`, L.source && L.source.kind === 'om' ? `OM${L.source.page ? ` p. ${L.source.page}` : ''}` : L.source && L.source.kind === 'import' ? `imported (${L.source.file || ''})` : 'entered by hand', null, { color: 'FF595959' });
  });
  const last = first + rr.leases.length - 1;
  const t = last + 2;
  const C = `C${first}:C${Math.max(first, last)}`; const G = `G${first}:G${Math.max(first, last)}`; const D = `D${first}:D${Math.max(first, last)}`; const K = `K${first}:K${Math.max(first, last)}`;
  label(ws, `A${t}`, 'Total', { bold: true });
  f(ws, `C${t}`, `SUM(${C})`, sum.totalSf || 0, SF, { bold: true, align: 'right' });
  f(ws, `G${t}`, `SUM(${G})`, sum.annualRent, MONEY, { bold: true, align: 'right' });
  label(ws, `A${t + 1}`, 'Leased SF');
  f(ws, `C${t + 1}`, `SUMIF(${D},"Leased",${C})`, sum.leasedSf, SF, { align: 'right' });
  label(ws, `A${t + 2}`, 'Occupancy by SF');
  f(ws, `C${t + 2}`, rate(`C${t + 1}`, `C${t}`), sum.totalSf ? sum.leasedSf / sum.totalSf : null, PCT1, { align: 'right' });
  label(ws, `A${t + 3}`, 'Average rent / SF (leased)');
  f(ws, `C${t + 3}`, rate(`G${t}`, `C${t + 1}`), sum.avgRentPsf, MONEY2, { align: 'right' });
  label(ws, `A${t + 4}`, 'WALT by income, years', { bold: true });
  f(ws, `C${t + 4}`, `IFERROR(SUMPRODUCT(${G},${K})/SUMIF(${K},">=0",${G}),"")`, sum.waltIncome, NUM1, { align: 'right', bold: true });
  ws.views = [{ showGridLines: false, state: 'frozen', ySplit: 5 }];

  // --- every period
  const ps = sheet(wb, 'Lease Schedule', [10, 26, 12, 12, 13, 16, 13, 13, 30], 'FF0F766E');
  title(ps, 1, 9, 'Lease Schedule', 'Every rent period of every lease. Documented periods come from the leases or the OM; projected ones (renewals, lease-up) are assumptions made in the app.');
  headerRow(ps, 3, ['Unit', 'Tenant', 'From', 'To', 'Rent', 'Unit of rent', 'Monthly', 'Kind', 'Note']);
  const P = project(rr);
  let r = 4;
  for (const L of rr.leases) {
    const lp = P.leases.find((x) => x.id === L.id);
    const periods = [...(L.periods || []), ...((lp && lp.projectedPeriods) || [])].sort((a, b) => (dayOf(a.start) ?? 0) - (dayOf(b.start) ?? 0));
    for (const p of periods) {
      v(ps, `A${r}`, L.unit || '');
      v(ps, `B${r}`, L.vacant ? 'Vacant' : (L.tenant || ''));
      v(ps, `C${r}`, serial(p.start), DATE);
      v(ps, `D${r}`, serial(p.end), DATE);
      v(ps, `E${r}`, p.rate, p.unit === 'psf_year' || p.unit === 'psf_month' ? MONEY2 : MONEY);
      v(ps, `F${r}`, UNITS[p.unit] || p.unit);
      const mo = monthlyAmount(p.rate, p.unit, L.sf);
      v(ps, `G${r}`, mo, MONEY);
      v(ps, `H${r}`, p.source === 'projected' ? 'Projected' : 'Documented', null, { color: p.source === 'projected' ? 'FF8A5A00' : 'FF000000' });
      v(ps, `I${r}`, p.note || '', null, { color: 'FF595959' });
      r += 1;
    }
  }
  ps.views = [{ showGridLines: false, state: 'frozen', ySplit: 3 }];

  // --- cash flow by year
  const cols = 1 + P.annual.length;
  const cf = sheet(wb, 'Cash Flow', [40, ...P.annual.map(() => 14)], 'FF0F766E');
  title(cf, 1, cols, 'Cash Flow by Year', `From ${P.from}, ${P.annual.length} years. Rent lines are the app's month-by-month projection of the leases (values); the subtotals are formulas. Projected rent and vacancy rest on the assumptions listed below.`);
  headerRow(cf, 3, ['', ...P.annual.map((y) => `Year ${y.year}`)]);
  const lines = [
    ['Contract rent (documented)', 'base'], ['Projected rent (renewals, lease-up)', 'projected'], ['Vacancy at market', 'vacancy'],
    ['Potential gross rent', 'gpr', 'sum3'], ['Less vacancy', 'vacancy', 'neg'], ['Less free rent and abatements', 'free', 'neg'],
    ['Expense recoveries', 'recoveries'], ['Percentage rent', 'pctRent'], ['Other income', 'other'], ['One-time items', 'oneTime'],
    ['Less general vacancy and credit loss', 'generalVacancy', 'neg'], ['Effective gross income', 'egi', 'egi'], ['Less operating expenses', 'opex', 'neg'],
    ['Net operating income', 'noi', 'noi'], ['Less tenant improvements', 'ti', 'neg'], ['Less leasing commissions', 'lc', 'neg'], ['Less capital reserves', 'reserves', 'neg'],
    ['Cash flow before debt service', 'cashFlow', 'cf'],
  ];
  const row = {};
  lines.forEach(([text, key, kind], i) => {
    const rr2 = 4 + i;
    row[`${key}${kind || ''}`] = rr2;
    label(cf, `A${rr2}`, text, { bold: ['sum3', 'egi', 'noi', 'cf'].includes(kind) });
    P.annual.forEach((y, j) => {
      const c = colLetter(j + 2);
      const R = (k) => `${c}${row[k]}`;
      if (kind === 'sum3') f(cf, `${c}${rr2}`, `${R('base')}+${R('projected')}+${R('vacancy')}`, y.gpr, MONEY, { bold: true, align: 'right' });
      else if (kind === 'egi') f(cf, `${c}${rr2}`, `${R('gprsum3')}+${R('vacancyneg')}+${R('freeneg')}+${R('recoveries')}+${R('pctRent')}+${R('other')}+${R('oneTime')}+${R('generalVacancyneg')}`, y.egi, MONEY, { bold: true, align: 'right' });
      else if (kind === 'noi') f(cf, `${c}${rr2}`, `${R('egiegi')}+${R('opexneg')}`, y.noi, MONEY, { bold: true, align: 'right' });
      else if (kind === 'cf') f(cf, `${c}${rr2}`, `${R('noinoi')}+${R('tineg')}+${R('lcneg')}+${R('reservesneg')}`, y.cashFlow, MONEY, { bold: true, align: 'right' });
      else v(cf, `${c}${rr2}`, kind === 'neg' ? -y[key] : y[key], MONEY, { align: 'right' });
    });
  });
  const s = P.settings;
  const a = 4 + lines.length + 1;
  band(cf, a, cols, 'ASSUMPTIONS');
  const facts = [
    ['As of', P.asOf], ['Market rent', ok(s.marketRent) ? `${s.marketRent} ${s.marketUnit === 'month' ? 'a month per unit' : s.marketUnit === 'year' ? 'a year per unit' : 'per SF a year'}` : 'per unit, where set'],
    ['Market rent growth', `${s.marketGrowth}% a year`], ['Renewal probability', `${s.renewal.probability}%`], ['Downtime if a tenant leaves', `${s.renewal.downtime} months`],
    ['Free rent: new / renewal', `${s.renewal.newFree} / ${s.renewal.renewFree} months`], ['New lease term', `${s.renewal.termMonths} months`],
    ['Operating expenses', ok(s.opex) ? `$${Math.round(s.opex).toLocaleString('en-US')} a year, growing ${s.expenseGrowth}%` : 'not entered'],
    ['General vacancy', `${s.generalVacancy || 0}% of potential income, less vacancy already modelled`],
  ];
  facts.forEach(([k, x], i) => { label(cf, `A${a + 1 + i}`, k); label(cf, `B${a + 1 + i}`, String(x)); });
  (P.notes || []).forEach((n, i) => note(cf, `A${a + 3 + facts.length + i}`, n, cols));
  note(cf, `A${a + 2 + facts.length}`, 'Rent accrues by the day: a lease starting mid-month earns that share of the month. Vacancy is market rent on empty space; general vacancy is charged only on what is not already modelled, so vacancy is never counted twice.', cols);
  cf.views = [{ showGridLines: false, state: 'frozen', xSplit: 1, ySplit: 3 }];
}
