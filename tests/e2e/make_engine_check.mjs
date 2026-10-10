/* A workbook of the engine's new Excel formulas, each with the engine's own
 * value cached, for recalc.py: LibreOffice recalculates every formula and any
 * difference from the engine is a mismatch. Covers the comp workbook's NER
 * (no escalation, part years, free rent beyond a year), whole-month loan
 * payments (odd amortization terms, a 0% rate) and the priced-comps rule. */
import ExcelJS from 'exceljs';
import { netEffectiveRent, nerExcel } from '../../app/engine/leasing.js';
import { debtService } from '../../app/engine/debt.js';
import { weightedPpsf } from '../../app/engine/comps.js';

const wb = new ExcelJS.Workbook();
const ner = wb.addWorksheet('NER');
ner.addRow(['', '', '', '', '', '', '', '', 'Months', '', 'Rent $/SF', '', 'Esc', 'Free months', 'TI $/SF', 'NER']);
const cases = [[120, 75, 0.03, 3, 25], [126, 42, 0.025, 4, 40], [60, 30, 0, 0, 0], [18, 55, 0.04, 14, 0], [1, 20, 0.03, 0, 0], [87, 36.5, 0.035, 2.5, 12.25], [126.4, 42, 0.03, 1, 10]];
cases.forEach(([I, K, M, N, O], j) => {
  const r = j + 2;
  ner.getCell(`I${r}`).value = I; ner.getCell(`K${r}`).value = K; ner.getCell(`M${r}`).value = M; ner.getCell(`N${r}`).value = N; ner.getCell(`O${r}`).value = O;
  ner.getCell(`P${r}`).value = { formula: nerExcel(r), result: netEffectiveRent({ rent: K, sf: 1, months: I, esc: M * 100, free: N, ti: O }).nerSimple };
});
const debt = wb.addWorksheet('Debt');
debt.addRow(['Loan', 'Rate %', 'Amortization years', 'Annual debt service']);
[[4192500, 6.75, 27.4], [1e6, 5, 25.5], [2e6, 0, 30], [3e6, 7.1, 30], [850000, 6.25, 19.95]].forEach(([L, rate, yrs], j) => {
  const r = j + 2;
  debt.getCell(`A${r}`).value = L; debt.getCell(`B${r}`).value = rate; debt.getCell(`C${r}`).value = yrs;
  debt.getCell(`D${r}`).value = { formula: `-PMT(B${r}/100/12,ROUND(C${r}*12,0),A${r})*12`, result: debtService(L, rate, yrs) };
});
const comps = wb.addWorksheet('Comps');
comps.addRow(['Price', 'SF']);
const P = [1000000, 0, 2500000, 'Undisclosed', 900000, 1200000]; const S = [10000, 5000, 20000, 8000, 0, 9000];
P.forEach((p, j) => { comps.getCell(`A${j + 2}`).value = p; comps.getCell(`B${j + 2}`).value = S[j]; });
const R = (c) => `${c}2:${c}7`;
comps.getCell('D2').value = { formula: `SUMPRODUCT(--ISNUMBER(${R('A')}),--ISNUMBER(${R('B')}),--(${R('A')}>0),--(${R('B')}>0),${R('A')})/SUMPRODUCT(--ISNUMBER(${R('A')}),--ISNUMBER(${R('B')}),--(${R('A')}>0),--(${R('B')}>0),${R('B')})`, result: weightedPpsf(P.map((x) => (typeof x === 'number' ? x : null)), S) };
await wb.xlsx.writeFile(process.argv[2]);
