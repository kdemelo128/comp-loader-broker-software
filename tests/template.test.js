import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import * as fflate from 'fflate';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { inspectTemplate, fillTemplate, fieldForHeader } from '../app/template.js';

const xml = { DOMParser, XMLSerializer };

/** A firm's template: styled headers, a formula column, a percent column, a table, leftover data. */
async function makeTemplate() {
  const wb = new ExcelJS.Workbook();
  const s = wb.addWorksheet('Sale Comps Data Import');
  s.addRow(['Property Name', 'Sale Date', 'Sale\nPrice', 'Building\nSF', 'Price / SF', 'Cap Rate', 'Occupancy', 'Latitude', 'Notes']);
  s.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  s.addRow(['Comp #1', new Date(Date.UTC(2020, 0, 1)), 1000000, 1000, null, 0.05, 90, 38.9, 'old note']);
  s.getCell('E2').value = { formula: 'IFERROR(C2/D2,"")', result: 1000 };
  s.getCell('F2').numFmt = '0.00%';
  s.getCell('G2').numFmt = '0.0';
  s.getCell('B2').numFmt = 'mm/dd/yy';
  const m = wb.addWorksheet('On Market Comps');
  m.addTable({
    name: 'Listings', ref: 'A1', headerRow: true,
    columns: [{ name: 'Property' }, { name: 'Days on Market' }, { name: 'Asking Price' }, { name: 'Building SF' }],
    rows: [['Placeholder', 1, 1, 1]],
  });
  wb.addWorksheet('Lease Comps').addRow(['Tenant', 'Rent per SF', 'Lease Expiration']);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

const comps = {
  sales: [
    { kind: 'sale', name: '100 Example St', date: new Date(Date.UTC(2025, 5, 30)), price: 5200000, bsf: 8000, cap: 6.25, occ: 95, flags: [] },
    { kind: 'sale', name: '200 Sample Ave', date: new Date(Date.UTC(2024, 11, 1)), price: 3100000, bsf: 4000, cap: null, occ: null, flags: [] },
  ],
  market: [
    { kind: 'market', name: '300 Test Rd', dom: 41, price: 2500000, bsf: 3000, flags: [] },
    { kind: 'market', name: '400 Mock Blvd', dom: 12, price: null, bsf: 2200, flags: [] },
  ],
};

function readSheet(bytes, idx) {
  const files = fflate.unzipSync(bytes);
  const doc = new DOMParser().parseFromString(fflate.strFromU8(files[`xl/worksheets/sheet${idx}.xml`]), 'application/xml');
  const cells = {};
  for (const c of [...doc.getElementsByTagName('c')]) {
    const v = c.getElementsByTagName('v')[0];
    const t = c.getElementsByTagName('t')[0];
    const f = c.getElementsByTagName('f')[0];
    cells[c.getAttribute('r')] = { v: v ? v.textContent : t ? t.textContent : null, f: f ? f.textContent : null, s: c.getAttribute('s'), t: c.getAttribute('t') };
  }
  return { cells, files };
}

test('headers name their fields', () => {
  assert.equal(fieldForHeader('Sale\nPrice'), 'price');
  assert.equal(fieldForHeader('SALE PRICE PER BUILDING SF'), 'ppsf');
  assert.equal(fieldForHeader('Asking Price Per Acre'), 'ppac');
  assert.equal(fieldForHeader('Lot Size\nAC'), 'lot_ac');
  assert.equal(fieldForHeader('Lot Size\nSF'), 'lot_sf');
  assert.equal(fieldForHeader('City, State'), 'city_state');
  assert.equal(fieldForHeader('Buyers Broker Company'), 'buyer_broker');
  assert.equal(fieldForHeader('CoStar Notes'), 'costar_notes');
  assert.equal(fieldForHeader('SF Leased'), null, 'leased SF is not occupancy');
  assert.equal(fieldForHeader('Days on\nMarket'), 'dom');
});

test('a template is read: header rows, fields and which sheet takes what', async () => {
  const plan = inspectTemplate(fflate, await makeTemplate(), xml);
  const [sale, market] = plan.sheets;
  assert.equal(plan.sheets.length, 2, 'the lease sheet has too few comp columns to count');
  assert.equal(sale.role, 'sale');
  assert.equal(sale.headerRow, 1);
  assert.deepEqual(sale.columns.map((c) => c.field), ['name', 'date', 'price', 'bsf', 'ppsf', 'cap', 'occ', null, 'notes']);
  assert.equal(market.role, 'market');
});

test('comps are written in the template\'s own cells and styles, formulas kept', async () => {
  const bytes = await makeTemplate();
  const plan = inspectTemplate(fflate, bytes, xml);
  const { bytes: out, report } = fillTemplate(fflate, bytes, plan, comps, xml);
  assert.equal(report.written, 4);
  assert.equal(report.formulasKept, 1, 'the template\'s $/SF formula in row 2');
  const { cells, files } = readSheet(out, 1);

  assert.equal(cells.A2.v, '100 Example St');
  assert.equal(cells.A2.t, 'inlineStr');
  assert.equal(cells.B2.v, String((Date.UTC(2025, 5, 30) - Date.UTC(1899, 11, 30)) / 86400000), 'a date serial');
  assert.equal(cells.C2.v, '5200000');
  assert.equal(cells.E2.f, 'IFERROR(C2/D2,"")', 'the formula is untouched');
  assert.equal(cells.F2.v, '0.0625', 'a percent-formatted cell takes a fraction');
  assert.equal(cells.G2.v, '95', 'a plain-number cell takes the percent as printed');
  assert.equal(cells.H2.v, null, 'an old value under an unmapped header is cleared');
  assert.equal(cells.I2.v, null, 'and so is the old note');
  assert.equal(cells.A3.v, '200 Sample Ave');
  assert.equal(cells.F3.v, null, 'no cap rate stays blank, not zero');
  assert.ok(cells.B3.s, 'a new row borrows the first data row\'s styles');

  const wbx = fflate.strFromU8(files['xl/workbook.xml']);
  assert.match(wbx, /fullCalcOnLoad="1"/, 'formulas recalculate on opening');
});

test('a new date or percent cell with no format gets one, so it never shows a raw serial', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Sales').addRow(['Property', 'Sale Date', 'Price', 'Cap Rate']);
  const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
  const plan = inspectTemplate(fflate, bytes, xml);
  plan.sheets[0].role = 'sale';
  const { bytes: out } = fillTemplate(fflate, bytes, plan, comps, xml);
  const { cells, files } = readSheet(out, 1);
  const styles = fflate.strFromU8(files['xl/styles.xml']);
  const xfs = [...new DOMParser().parseFromString(styles, 'application/xml').getElementsByTagName('cellXfs')[0].getElementsByTagName('xf')];
  assert.equal(xfs[Number(cells.B2.s)].getAttribute('numFmtId'), '14', 'm/d/yyyy');
  assert.equal(xfs[Number(cells.D2.s)].getAttribute('numFmtId'), '10', '0.00%');
  assert.equal(cells.D2.v, '0.0625');
});

test('an Excel table over the header grows to cover the rows written', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('On Market');
  ws.addTable({ name: 'T', ref: 'A1', headerRow: true, columns: [{ name: 'Property' }, { name: 'Days on Market' }, { name: 'Asking Price' }], rows: [['x', 1, 1]] });
  const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
  const plan = inspectTemplate(fflate, bytes, xml);
  plan.sheets[0].role = 'market';
  const big = { sales: [], market: Array.from({ length: 6 }, (_, i) => ({ kind: 'market', name: `L${i}`, dom: i, price: 1e6 + i, flags: [] })) };
  const { bytes: out } = fillTemplate(fflate, bytes, plan, big, xml);
  const files = fflate.unzipSync(out);
  const table = Object.keys(files).find((p) => /tables\/table\d+\.xml$/.test(p));
  assert.match(fflate.strFromU8(files[table]), /ref="A1:C7"/);
});

test('a stale calculation chain is removed, with its relationship and content type', async () => {
  const bytes = await makeTemplate();
  const files = fflate.unzipSync(bytes);
  files['xl/calcChain.xml'] = fflate.strToU8('<?xml version="1.0" encoding="UTF-8"?><calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><c r="E2" i="1"/></calcChain>');
  const rels = fflate.strFromU8(files['xl/_rels/workbook.xml.rels']);
  files['xl/_rels/workbook.xml.rels'] = fflate.strToU8(rels.replace('</Relationships>',
    '<Relationship Id="rIdCC" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" Target="calcChain.xml"/></Relationships>'));
  const ct = fflate.strFromU8(files['[Content_Types].xml']);
  files['[Content_Types].xml'] = fflate.strToU8(ct.replace('</Types>',
    '<Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/></Types>'));
  const withChain = fflate.zipSync(files);
  const { bytes: out } = fillTemplate(fflate, withChain, inspectTemplate(fflate, withChain, xml), comps, xml);
  const after = fflate.unzipSync(out);
  assert.ok(!after['xl/calcChain.xml']);
  assert.doesNotMatch(fflate.strFromU8(after['xl/_rels/workbook.xml.rels']), /calcChain/);
  assert.doesNotMatch(fflate.strFromU8(after['[Content_Types].xml']), /calcChain/);
});

test('a file that is not a workbook says so', () => {
  assert.throws(() => inspectTemplate(fflate, new Uint8Array([1, 2, 3]), xml), /not an Excel workbook/);
});
