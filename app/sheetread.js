/* sheetread.js -- a spreadsheet's cells as plain values, read on the device:
 * the rent roll import and the T-12 import both start here. Pure apart from
 * readGrids(), which loads ExcelJS when a workbook needs it. */

/** A cell's value as text, a number or an ISO date (YYYY-MM-DD): formulas give their cached result. */
export function cellValue(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return cellValue(v.result);
    if ('richText' in v) return v.richText.map((x) => x.text).join('');
    if ('text' in v) return v.text;
  }
  return v;
}

/** The rows of a CSV file (quoted fields, doubled quotes, CR LF or LF), every field as text. */
export function csvRows(text) {
  const rows = [];
  let row = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; } else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

/** Files a spreadsheet import refuses, with what to do instead; null when it can be read. */
export function unreadable(file, what) {
  if (/\.xls$/i.test(file.name)) return `That is an old .xls file. Open it in Excel and save it as .xlsx (or CSV), then import it.`;
  if (/\.xlsm$/i.test(file.name)) return `That workbook has macros. Save a copy as .xlsx or CSV to import its ${what}.`;
  return null;
}
export const isCsv = (file) => /\.csv$/i.test(file.name) || file.type === 'text/csv';

/**
 * Every visible sheet of a workbook (or the one table of a CSV) as rows of
 * values: [{ sheet, rows: [{ r (1-based row number), cells: [] }] }], empty
 * rows left out, at most `maxRows` rows a sheet.
 */
export async function readGrids(file, getXlsx, { maxRows = 400 } = {}) {
  if (isCsv(file)) return [{ sheet: 'CSV', rows: csvRows(await file.text()).map((cells, i) => ({ r: i + 1, cells })).filter((x) => x.cells.some((v) => String(v).trim())) }];
  const { ExcelJS } = await getXlsx();
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(await file.arrayBuffer()); } catch { throw new Error('That file could not be opened as an Excel workbook. It may be damaged, password protected or not really .xlsx.'); }
  return gridsOf(wb, { maxRows });
}

/** The same for an ExcelJS workbook already loaded (the tests read their invented files this way). */
export function gridsOf(wb, { maxRows = 400 } = {}) {
  const out = [];
  wb.eachSheet((ws) => {
    if (ws.state && ws.state !== 'visible') return;
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      if (r > maxRows) return;
      const cells = [];
      row.eachCell({ includeEmpty: true }, (cell, c) => {
        // a merged cell's value sits in its first cell only
        cells[c - 1] = cell.isMerged && cell.master && cell.master !== cell ? null : cellValue(cell.value);
      });
      rows.push({ r, cells });
    });
    out.push({ sheet: ws.name, rows });
  });
  return out;
}
