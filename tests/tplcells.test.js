/* Cell-level templates: a firm's underwriting model filled in place. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import * as fflate from 'fflate';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { inspectWorkbook, suggestCellMap, previewCells, fillCells, dependents, nameTarget } from '../app/template.js';
import { DEAL_FIELDS, dealValues, rrFieldForHeader } from '../app/dealfields.js';
import { analyze } from '../app/deal.js';

const xml = { DOMParser, XMLSerializer };

/** An underwriting model the way a firm builds one. */
async function makeModel() {
  const wb = new ExcelJS.Workbook();
  const s = wb.addWorksheet('Inputs');
  s.getCell('A1').value = 'ACME CAPITAL — ACQUISITION MODEL';
  s.mergeCells('A1:D1');
  s.getCell('A3').value = 'Property Name';
  s.getCell('A4').value = 'Address';
  s.getCell('A5').value = 'Purchase Price';
  s.getCell('B5').value = 1000000;
  s.getCell('B5').numFmt = '$#,##0';
  s.getCell('A6').value = 'NOI';
  s.getCell('A7').value = 'Cap Rate';
  s.getCell('B7').value = { formula: 'IFERROR(B6/B5,"")', result: '' };
  s.getCell('B7').numFmt = '0.00%';
  s.getCell('A8').value = 'Units';
  s.getCell('A10').value = 'Occupancy';
  s.mergeCells('B10:C10');
  s.getCell('A12').value = 'Interest Rate';
  s.getCell('B12').numFmt = '0.00%';
  wb.definedNames.add('Inputs!$B$12', 'InterestRate');
  const r = wb.addWorksheet('Rent Roll');
  r.getCell('A2').value = 'RENT ROLL';
  ['Suite', 'Tenant', 'SF', 'Lease Exp', 'Annual Rent', 'Rent / SF'].forEach((h, i) => { r.getCell(4, i + 1).value = h; });
  for (let i = 5; i <= 9; i++) {
    r.getCell(`A${i}`).value = `old ${i}`;
    r.getCell(`F${i}`).value = { formula: `IFERROR(E${i}/C${i},"")`, result: '' };
  }
  const sum = wb.addWorksheet('Summary');
  sum.getCell('A1').value = 'Price';
  sum.getCell('B1').value = { formula: 'Inputs!B5', result: 1000000 };
  sum.getCell('A2').value = 'Total rent';
  sum.getCell('B2').value = { formula: "SUM('Rent Roll'!E5:E40)", result: 0 };
  sum.getCell('A3').value = 'Price / unit';
  sum.getCell('B3').value = { formula: 'IFERROR(Inputs!B5/Inputs!B8,"")', result: '' };
  const h = wb.addWorksheet('Lists');
  h.state = 'hidden';
  h.getCell('A1').value = 'helper';
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

const deal = {
  name: 'Example Deal', figures: { address: '100 Example St', price: 12500000, noi: 875000, units: 48, occ: 96, cap: 6.85 },
  sources: { price: { page: 2 }, noi: { page: 3 }, units: { page: 2 }, occ: { hand: true } }, loan: { ltv: 65, rate: 6.75, amort: 30, closing: 2 },
};
const ctx = () => ({ deal, m: analyze({ ...deal.figures, loan: deal.loan }, null), rrSum: null, rrProj: null, scenario: null, preparedBy: 'K. Broker', today: new Date(Date.UTC(2026, 9, 9)) });

test('a workbook is read: sheets, a cell preview, named ranges, features', async () => {
  const info = inspectWorkbook(fflate, await makeModel(), xml);
  assert.deepEqual(info.sheets.map((s) => [s.name, s.hidden]), [['Inputs', false], ['Rent Roll', false], ['Summary', false], ['Lists', true]]);
  const b7 = info.sheets[0].cells.find((c) => c.ref === 'B7');
  assert.match(b7.formula, /B6\/B5/);
  assert.ok(info.definedNames.some((d) => d.name === 'InterestRate'));
  assert.deepEqual(nameTarget("'Rent Roll'!$C$5"), { sheet: 'Rent Roll', cell: 'C5' });
  assert.equal(info.features.macros, false);
});

test('suggestions: beside the label, by named range, never onto a formula', async () => {
  const info = inspectWorkbook(fflate, await makeModel(), xml);
  const map = Object.fromEntries(suggestCellMap(info, DEAL_FIELDS).map((s) => [s.field, s]));
  assert.equal(map.price.cell, 'B5');
  assert.equal(map.noi.cell, 'B6');
  assert.equal(map.units.cell, 'B8');
  assert.equal(map.address.cell, 'B4');
  assert.equal(map.rate.cell, 'B12');
  assert.equal(map.rate.confidence, 'high', 'a named range is the surest signal');
  assert.ok(!map.cap || map.cap.cell !== 'B7', 'the cap rate cell holds a formula and is not suggested');
  assert.ok(Object.values(map).every((s) => s.sheet !== 'Lists'), 'hidden helper sheets are not suggested');
});

test('dependencies: the formulas that read a cell, across sheets and through ranges', async () => {
  const info = inspectWorkbook(fflate, await makeModel(), xml);
  const formulas = [];
  for (const s of info.sheets) for (const c of s.cells) if (c.formula) formulas.push({ sheet: s.name, text: c.formula });
  assert.equal(dependents(formulas, 'Inputs', 2, 5).formulas, 3, 'B7 and two Summary formulas read B5');
  assert.equal(dependents(formulas, 'Rent Roll', 5, 6).formulas, 2, "the row's Rent/SF and the Summary's SUM over E5:E40");
  assert.equal(dependents([{ sheet: 'X', text: 'LOG10(A1)+SUM(B2:B4)' }], 'X', 7, 10).formulas, 0, 'LOG10 is a function, not cell G10');
});

test('preview: what will change, what is skipped and why', async () => {
  const bytes = await makeModel();
  const values = dealValues(ctx());
  const map = [
    { sheet: 'Inputs', cell: 'B5', field: 'price' }, { sheet: 'Inputs', cell: 'B6', field: 'noi' }, { sheet: 'Inputs', cell: 'B7', field: 'capCalc' },
    { sheet: 'Inputs', cell: 'C10', field: 'occ' }, { sheet: 'Inputs', cell: 'B3', field: 'tenant' }, { sheet: 'Gone', cell: 'A1', field: 'price' },
  ];
  const p = previewCells(fflate, bytes, map, values, xml);
  assert.equal(p[0].action, 'write');
  assert.equal(p[0].current, '1000000');
  assert.equal(p[0].next, 12500000);
  assert.equal(p[0].source, 'OM page 2');
  assert.equal(p[0].feeds, 3);
  assert.equal(p[2].action, 'skip');
  assert.match(p[2].reason, /formula/);
  assert.match(p[3].reason, /merged range starting at B10/);
  assert.match(p[4].reason, /no value/);
  assert.match(p[5].reason, /no sheet/);
});

test('fill: values in place, formulas, merges, names and hidden sheets kept, an audit sheet added', async () => {
  const bytes = await makeModel();
  const values = dealValues(ctx());
  const map = [
    { sheet: 'Inputs', cell: 'B3', field: 'dealName' }, { sheet: 'Inputs', cell: 'B5', field: 'price' }, { sheet: 'Inputs', cell: 'B6', field: 'noi' },
    { sheet: 'Inputs', cell: 'B8', field: 'units' }, { sheet: 'Inputs', cell: 'B10', field: 'occ' }, { sheet: 'Inputs', cell: 'B12', field: 'rate' },
    { sheet: 'Inputs', cell: 'B7', field: 'capCalc' },
  ];
  const tables = [{
    sheet: 'Rent Roll', headerRow: 4,
    columns: [{ col: 1, field: 'unit' }, { col: 2, field: 'tenant' }, { col: 3, field: 'sf' }, { col: 4, field: 'leaseEnd' }, { col: 5, field: 'annual' }, { col: 6, field: 'psf' }],
    rows: [
      { unit: { value: '100', type: 'text' }, tenant: { value: 'Coffee', type: 'text' }, sf: { value: 2400, type: 'int' }, leaseEnd: { value: new Date(Date.UTC(2029, 1, 28)), type: 'date' }, annual: { value: 124800, type: 'money' }, psf: { value: 52, type: 'money2' } },
      { unit: { value: '120', type: 'text' }, tenant: { value: 'Vacant', type: 'text' }, sf: { value: 1000, type: 'int' }, leaseEnd: { value: null, type: 'date' }, annual: { value: null, type: 'money' }, psf: { value: null, type: 'money2' } },
    ],
    source: 'rent roll',
  }];
  const { bytes: out, report } = fillCells(fflate, bytes, { cellMap: map, values, tables, audit: true, auditTitle: 'Example Deal' }, xml);
  assert.equal(report.written, 6);
  assert.equal(report.skipped, 1, 'the formula cell');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(out);
  const s = wb.getWorksheet('Inputs');
  assert.equal(s.getCell('B3').value, 'Example Deal');
  assert.equal(s.getCell('B5').value, 12500000);
  assert.equal(s.getCell('B5').numFmt, '$#,##0', 'the cell keeps its own format');
  assert.equal(s.getCell('B6').value, 875000);
  assert.equal(s.getCell('B10').value, 0.96, 'occupancy as a fraction under a percent format');
  assert.equal(s.getCell('B12').value, 0.0675);
  assert.equal(s.getCell('B7').formula, 'IFERROR(B6/B5,"")', 'the formula is still there');
  assert.ok(s.getCell('A1').isMerged && s.getCell('B10').isMerged, 'merges kept');
  const r = wb.getWorksheet('Rent Roll');
  assert.equal(r.getCell('A5').value, '100');
  assert.equal(r.getCell('E5').value, 124800);
  assert.equal(r.getCell('F5').formula, 'IFERROR(E5/C5,"")', 'the template’s Rent/SF formula is kept, not overwritten');
  assert.equal(r.getCell('A7').value, null, 'old rows cleared');
  assert.equal(r.getCell('F7').formula, 'IFERROR(E7/C7,"")');
  assert.equal(wb.getWorksheet('Lists').state, 'hidden');
  assert.ok(wb.definedNames.getRanges('InterestRate').ranges.length, 'the named range survives');
  const a = wb.getWorksheet('Zlatura Audit');
  assert.ok(a, 'audit sheet added');
  const rows = [];
  a.eachRow((row) => rows.push(row.values.slice(1)));
  assert.ok(rows.some((x) => x[1] === 'B5' && x[3] === 12500000 && x[4] === 'OM page 2' && x[5] === 3));
  // filling again replaces the audit sheet rather than adding a second
  const again = fillCells(fflate, out, { cellMap: map, values, audit: true }, xml);
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(again.bytes);
  assert.equal(wb2.worksheets.filter((w) => w.name === 'Zlatura Audit').length, 1);
  // a workbook filled before the rename has a "Comp Loader Audit" sheet: refilling replaces it, under the new name
  const files = fflate.unzipSync(again.bytes);
  const wbXml = fflate.strFromU8(files['xl/workbook.xml']);
  assert.ok(wbXml.includes('name="Zlatura Audit"'));
  files['xl/workbook.xml'] = fflate.strToU8(wbXml.replace('name="Zlatura Audit"', 'name="Comp Loader Audit"'));
  const legacy = fillCells(fflate, fflate.zipSync(files), { cellMap: map, values, audit: true }, xml);
  const wb3 = new ExcelJS.Workbook();
  await wb3.xlsx.load(legacy.bytes);
  assert.deepEqual(wb3.worksheets.filter((w) => /Audit$/.test(w.name)).map((w) => w.name), ['Zlatura Audit']);
});

test('macros survive byte for byte, and the workbook says it has them', async () => {
  const files = fflate.unzipSync(await makeModel());
  const vba = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);
  files['xl/vbaProject.bin'] = vba;
  const xlsm = fflate.zipSync(files);
  const info = inspectWorkbook(fflate, xlsm, xml);
  assert.equal(info.features.macros, true);
  assert.ok(info.warnings.some((w) => /macros/.test(w.text)));
  const { bytes } = fillCells(fflate, xlsm, { cellMap: [{ sheet: 'Inputs', cell: 'B6', field: 'noi' }], values: dealValues(ctx()) }, xml);
  assert.deepEqual(fflate.unzipSync(bytes)['xl/vbaProject.bin'], vba);
});

test('rent roll headings in a template', () => {
  assert.equal(rrFieldForHeader('Suite'), 'unit');
  assert.equal(rrFieldForHeader('Lease Exp'), 'leaseEnd');
  assert.equal(rrFieldForHeader('Annual Rent'), 'annual');
  assert.equal(rrFieldForHeader('Rent / SF'), 'psf');
});
