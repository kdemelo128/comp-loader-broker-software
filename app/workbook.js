/* workbook.js -- builds the comps workbook in the browser.
 *
 * Every figure is a live formula with its computed value cached beside it, so
 * the file shows numbers in Outlook's preview, iOS Quick Look and Excel's
 * Protected View, and still recalculates the moment an input changes. The
 * cached values are computed here with the same arithmetic Excel uses
 * (stats.js), and the test suite recalculates every generated workbook and
 * checks that the two agree.
 *
 * Tabs:
 *   Summary          subject panel, survey, market read, value conclusions,
 *                    pricing matrix
 *   Deal Analysis    (with an OM on the Deal screen) the offering, pricing,
 *                    financing, loan sizing and a cap-rate ladder
 *   Rent Roll        (with a rent roll in the OM) leases, WALT, occupancy
 *   Charts           ranked $/SF bars and the $/SF-over-time scatter
 *   Sale Comps       closed sales, high to low $/SF
 *   On Market Comps  active and pending listings, high to low $/SF
 *   Adjustment Grid  the sales-comparison approach, in the appraisal sequence
 *   Lease Comps      structured sheet to fill in by hand
 *   Zoning Catalogue max FAR by code, feeding buildable SF
 *   Audit Trail      provenance, flags and the $/SF reconciliation
 *   CoStar Notes     the full notes behind each comp
 */
import { addRentRollTabs } from './rrbook.js';
import { netEffectiveRent, nerExcel } from './engine/leasing.js';
import * as S from './stats.js';
import { ZONING, zoningInfo, MOCO_NOTE } from './zoning.js';
import { cleanPackage } from './package.js';
import { chartParts } from './charts.js';

const NAVY = 'FF1F3864';
const NAVY_SOFT = 'FFEEF2F8';
const RULE = 'FFBFC9D9';
const INPUT_BLUE = 'FF0000FF';
const FILLIN = 'FFFFF2CC';
const GREY = 'FF595959';
const WARN = 'FF9C5700';
const FONT = 'Arial';

const MONEY = '$#,##0;($#,##0);"-"';
const MONEY2 = '$#,##0.00;($#,##0.00);"-"';
const SF = '#,##0;;"-"';
const PCT1 = '0.0%;-0.0%;"-"';
const PCT_ADJ = '+0.0%;-0.0%;0.0%';          // an adjustment: signed, and zero is a real answer
// occupancy is the one percentage where zero is a real answer (sold vacant),
// so it prints as 0.0% rather than the dash used for "nothing here"
const OCC = '0.0%';
const PCT2 = '0.00%;-0.00%;"-"';
const DATE = 'mm/dd/yyyy';
const NUM1 = '#,##0.0;;"-"';
const FAR_FMT = '0.00;;"-"';
const MAX_TEXT = 32000;                      // Excel's cell limit is 32,767 characters

export const colLetter = (n) => {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

/* ------------------------------------------------------------------ helpers */

function sheet(wb, name, widths, tabColor) {
  const ws = wb.addWorksheet(name, {
    views: [{ showGridLines: false }],
    properties: { tabColor: { argb: tabColor || NAVY }, defaultRowHeight: 14 },
    pageSetup: {
      orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
    },
  });
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  return ws;
}

function title(ws, row, span, text, sub) {
  const c = ws.getCell(row, 1);
  c.value = text;
  c.font = { name: FONT, size: 15, bold: true, color: { argb: NAVY } };
  ws.mergeCells(row, 1, row, span);
  if (sub) {
    const s = ws.getCell(row + 1, 1);
    s.value = sub;
    s.font = { name: FONT, size: 9, color: { argb: GREY } };
    ws.mergeCells(row + 1, 1, row + 1, span);
  }
  ws.getRow(row).height = 21;
}

function band(ws, row, span, text) {
  for (let i = 1; i <= span; i++) {
    const c = ws.getCell(row, i);
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY_SOFT } };
    c.border = { top: { style: 'thin', color: { argb: RULE } }, bottom: { style: 'thin', color: { argb: RULE } } };
    c.font = { name: FONT, size: 9, bold: true, color: { argb: NAVY } };
  }
  ws.getCell(row, 1).value = text;
}

function headerRow(ws, row, labels, span) {
  labels.forEach((t, i) => {
    const c = ws.getCell(row, i + 1);
    c.value = t;
    c.font = { name: FONT, size: 8.5, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    c.alignment = { vertical: 'bottom', wrapText: true, horizontal: i < 2 ? 'left' : 'center' };
    c.border = { bottom: { style: 'thin', color: { argb: NAVY } } };
  });
  ws.getRow(row).height = 30;
  if (span) {
    for (let i = labels.length + 1; i <= span; i++) {
      ws.getCell(row, i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    }
  }
}

/* Vertical alignment is 'middle', not 'center': ExcelJS drops any value it does
 * not recognise, and the cell silently falls back to bottom-aligned. */

/** A formula with its value cached beside it. */
function f(ws, addr, formula, result, numFmt, opts = {}) {
  const c = ws.getCell(addr);
  c.value = { formula, result: result === null || result === undefined ? '' : result };
  c.font = { name: FONT, size: opts.size || 9, bold: !!opts.bold, color: { argb: opts.color || 'FF000000' } };
  if (numFmt) c.numFmt = numFmt;
  if (opts.align || opts.wrap) c.alignment = { horizontal: opts.align || 'left', vertical: 'middle', wrapText: !!opts.wrap };
  if (opts.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } };
  return c;
}

const clamp = (x) => (typeof x === 'string' && x.length > MAX_TEXT ? `${x.slice(0, MAX_TEXT)} ...` : x);

/** A literal value. Inputs are blue, to the usual model convention. */
function v(ws, addr, value, numFmt, opts = {}) {
  const c = ws.getCell(addr);
  c.value = value === null || value === undefined || value === '' ? null : clamp(value);
  c.font = {
    name: FONT,
    size: opts.size || 9,
    bold: !!opts.bold,
    italic: !!opts.italic,
    color: { argb: opts.input ? INPUT_BLUE : (opts.color || 'FF000000') },
  };
  if (numFmt) c.numFmt = numFmt;
  if (opts.align || opts.wrap) {
    c.alignment = { horizontal: opts.align || 'left', vertical: opts.wrap ? 'top' : 'middle', wrapText: !!opts.wrap };
  }
  if (opts.fillin) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILLIN } };
  else if (opts.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } };
  return c;
}

function label(ws, addr, text, opts = {}) {
  const c = ws.getCell(addr);
  c.value = text;
  c.font = { name: FONT, size: opts.size || 9, bold: !!opts.bold, italic: !!opts.italic, color: { argb: opts.color || 'FF000000' } };
  if (opts.align || opts.wrap) c.alignment = { horizontal: opts.align || 'left', wrapText: !!opts.wrap, vertical: 'middle' };
  return c;
}

function note(ws, addr, text, span) {
  const c = ws.getCell(addr);
  c.value = text;
  c.font = { name: FONT, size: 8, italic: true, color: { argb: GREY } };
  c.alignment = { wrapText: true, vertical: 'top' };
  const r = Number(addr.replace(/\D/g, ''));
  if (span) ws.mergeCells(r, 1, r, span);
  // a merged cell does not grow to fit wrapped text, so size the row for it
  ws.getRow(r).height = Math.max(14, Math.ceil(text.length / Math.max(60, (span || 1) * 13)) * 11.5);
}

const mapUrl = (c) => {
  const q = [c.address, c.city, c.state].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
};

const statusOf = (c) => {
  const p = (c.flags || []).find((x) => x.startsWith('status is '));
  if (!p) return 'Active';
  const m = /^status is ([A-Za-z ]+?),/.exec(p);
  return m ? m[1] : 'Pending';
};

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const pos = (x) => typeof x === 'number' && Number.isFinite(x) && x > 0;
const pctOf = (x) => (num(x) === null ? null : x / 100);

/* MIN and MAX over a range holding no numbers return 0 in Excel, not an error,
 * so IFERROR will not blank them. COUNT decides instead, which keeps an empty
 * comp set empty rather than showing a misleading zero. */
const agg = (mode, rng) => (mode === 'MIN' || mode === 'MAX'
  ? `IF(COUNT(${rng})=0,"",${mode}(${rng}))`
  : `IFERROR(${mode}(${rng}),"")`);

/* An empty cell is zero in arithmetic, so =Price/SF on a listing with no
 * disclosed price returns 0 rather than an error -- and a column of zeros then
 * drags down every median, minimum and percentile built on it. Both operands
 * are tested for blank before the operation, which is what keeps an unpriced
 * listing out of the survey instead of scoring it at $0/SF. */
const rate = (a, b) => `IFERROR(IF(OR(${a}="",${b}=""),"",${a}/${b}),"")`;
/** A price per unit of size: blank unless both are above zero (engine/comps.js: only priced comps count). */
const perSize = (a, b) => `IFERROR(IF(OR(${a}="",${b}="",N(${a})<=0,N(${b})<=0),"",${a}/${b}),"")`;
const prod = (a, b) => `IFERROR(IF(OR(${a}="",${b}=""),"",${a}*${b}),"")`;

/* ----------------------------------------------------------------- geometry */

/* Rows and ranges for one build. The comp grids hold fifteen comps, as the
 * template does, and grow when more are included. The zoning catalogue grows by
 * any code a comp or the subject carries that states its own FAR. */
function geometry(sales, market, subject) {
  const slots = Math.max(15, sales.length, market.length);
  const first = 4;
  const last = first + slots - 1;

  const adjFirst = 12;
  const adjLast = adjFirst + slots - 1;
  const adj = {
    first: adjFirst,
    last: adjLast,
    mean: adjLast + 3,
    wavg: adjLast + 4,
    least: adjLast + 5,
    med: adjLast + 6,
    low: adjLast + 7,
    high: adjLast + 8,
  };

  const zones = ZONING.map(([code, far]) => ({ code, far, note: null }));
  const seen = new Set(zones.map((z) => z.code.toUpperCase()));
  for (const code of [...sales, ...market].map((c) => c.zoning).concat([subject.zoning])) {
    if (!code) continue;
    const info = zoningInfo(code);
    const k = String(code).trim().toUpperCase();
    if (info && info.source === 'moco' && !seen.has(k)) {
      zones.push({ code: String(code).trim(), far: info.far, note: MOCO_NOTE });
      seen.add(k);
    }
  }
  const zfirst = 4;
  const zlast = zfirst + zones.length - 1;
  return {
    slots, first, last, adj, zones, zfirst, zlast,
    zfar: `'Zoning Catalogue'!$B$${zfirst}:$B$${zlast}`,
    zcode: `'Zoning Catalogue'!$A$${zfirst}:$A$${zlast}`,
  };
}

/** Max FAR for a code, as the workbook's own lookup will find it. */
function farOf(code) {
  const info = zoningInfo(code);
  return info && typeof info.far === 'number' ? info.far : null;
}

/** INDEX returns 0 for an empty cell, so a code with no FAR recorded is tested
 *  for blank before it is used -- otherwise it would read as an FAR of zero. */
const farLookup = (g, ref) => `IFERROR(IF(INDEX(${g.zfar},MATCH(${ref},${g.zcode},0))="","",`
  + `INDEX(${g.zfar},MATCH(${ref},${g.zcode},0))),"")`;

/** A column of either comp grid, as an absolute range. */
const colRange = (g, tab, L) => `'${tab}'!$${L}$${g.first}:$${L}$${g.last}`;

/* ------------------------------------------------------- the two comp grids */

const SALE_COLS = [
  ['#', 4], ['Property Name', 26], ['Address', 23], ['City', 13], ['ST', 5], ['ZIP', 7],
  ['Submarket', 15], ['Zoning', 12], ['Sale Date', 11], ['Months Ago', 8],
  ['Sale Price', 13], ['Building SF', 11], ['$/SF', 10], ['Cap Rate', 8], ['Occupancy', 9],
  ['Lot SF', 10], ['Lot AC', 8], ['$/Land SF', 10], ['Existing FAR', 8], ['Max FAR (Zoning)', 9],
  ['Buildable SF', 11], ['$/Buildable SF', 11], ['Year Built', 8], ['Age (Yrs)', 7],
  ['Class', 6], ['Property Type', 14], ['Map', 6], ['Sale Type', 13], ['True Buyer', 22], ['True Seller', 22],
  ['Sale Conditions', 22], ['Hold Period', 10], ['Buyer Broker', 20], ['Listing Broker', 20],
  ['CoStar ID', 10], ['Source PDF', 20], ['Flags', 32], ['CoStar Notes (summary)', 40],
];

const MKT_COLS = [
  ['#', 4], ['Property Name', 26], ['Address', 23], ['City', 13], ['ST', 5], ['ZIP', 7],
  ['Submarket', 15], ['Zoning', 12], ['Days on Market', 9], ['Months on Market', 9],
  ['Asking Price', 13], ['Building SF', 11], ['$/SF', 10], ['Cap Rate', 8], ['Occupancy', 9],
  ['Lot SF', 10], ['Lot AC', 8], ['$/Land SF', 10], ['Existing FAR', 8], ['Max FAR (Zoning)', 9],
  ['Buildable SF', 11], ['$/Buildable SF', 11], ['Year Built', 8], ['Age (Yrs)', 7],
  ['Class', 6], ['Property Type', 14], ['Map', 6], ['Status', 14], ['Marketed To', 13],
  ['Sale Conditions', 22], ['Source PDF', 20], ['Flags', 32], ['CoStar Notes (summary)', 40],
];

function compGrid(wb, g, name, cols, comps, kind, tabColor, meta) {
  const ws = sheet(wb, name, cols.map(([, w]) => w), tabColor);
  const span = cols.length;
  const sale = kind === 'sale';
  const { first: FIRST, last: LAST } = g;
  title(ws, 1, span,
    sale ? 'SALE COMPARABLES' : 'ON MARKET COMPARABLES',
    `${meta.label} · ordered high to low $/SF · ${comps.length} comp${comps.length === 1 ? '' : 's'} · `
    + `built ${meta.stamp}${sale ? '' : ' · pending and under-contract listings are shown here because they have not closed'}`);
  headerRow(ws, 3, cols.map(([t]) => t), span);
  ws.views = [{ showGridLines: false, state: 'frozen', xSplit: 3, ySplit: 3 }];

  for (let i = 0; i < g.slots; i++) {
    const r = FIRST + i;
    const c = comps[i];
    const zebra = i % 2 === 1 ? 'FFF7F9FC' : null;
    for (let k = 1; k <= span; k++) {
      const cell = ws.getCell(r, k);
      cell.border = { bottom: { style: 'hair', color: { argb: RULE } } };
      if (zebra) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: zebra } };
    }
    if (!c) continue;
    const far = farOf(c.zoning);
    const bldbl = num(c.lot_sf) && far ? c.lot_sf * far : null;
    const ppsf = num(c.price) && num(c.bsf) ? c.price / c.bsf : null;

    v(ws, `A${r}`, i + 1, null, { align: 'center', color: GREY });
    v(ws, `B${r}`, c.name);
    v(ws, `C${r}`, c.address);
    v(ws, `D${r}`, c.city);
    v(ws, `E${r}`, c.state, null, { align: 'center' });
    v(ws, `F${r}`, c.zip, '00000', { align: 'center' });
    v(ws, `G${r}`, c.submarket || null);
    v(ws, `H${r}`, c.zoning, null, { align: 'center', wrap: true });

    if (sale) {
      v(ws, `I${r}`, c.date ? new Date(c.date) : null, DATE, { align: 'center' });
      f(ws, `J${r}`, `IF(I${r}="","",(TODAY()-I${r})/30.44)`,
        c.date ? (meta.todaySerial - S.serial(new Date(c.date))) / 30.44 : '', NUM1, { align: 'center' });
    } else {
      v(ws, `I${r}`, num(c.dom), SF, { align: 'center' });
      f(ws, `J${r}`, `IF(I${r}="","",I${r}/30.44)`, num(c.dom) !== null ? c.dom / 30.44 : '', NUM1, { align: 'center' });
    }
    v(ws, `K${r}`, num(c.price), MONEY, { align: 'right' });
    v(ws, `L${r}`, num(c.bsf), SF, { align: 'right' });
    f(ws, `M${r}`, perSize(`K${r}`, `L${r}`), ppsf, MONEY2, { align: 'right', bold: true });
    v(ws, `N${r}`, pctOf(c.cap), PCT2, { align: 'center' });
    v(ws, `O${r}`, pctOf(c.occ), OCC, { align: 'center' });
    v(ws, `P${r}`, num(c.lot_sf), SF, { align: 'right' });
    v(ws, `Q${r}`, num(c.lot_ac), FAR_FMT, { align: 'center' });
    f(ws, `R${r}`, perSize(`K${r}`, `P${r}`), pos(c.price) && pos(c.lot_sf) ? c.price / c.lot_sf : '', MONEY2, { align: 'right' });
    v(ws, `S${r}`, num(c.far), FAR_FMT, { align: 'center' });
    f(ws, `T${r}`, farLookup(g, `H${r}`), far ?? '', FAR_FMT, { align: 'center' });
    f(ws, `U${r}`, prod(`P${r}`, `T${r}`), bldbl ?? '', SF, { align: 'right' });
    f(ws, `V${r}`, perSize(`K${r}`, `U${r}`), pos(c.price) && pos(bldbl) ? c.price / bldbl : '', MONEY2, { align: 'right' });
    v(ws, `W${r}`, num(c.year), '0;;"-"', { align: 'center' });
    f(ws, `X${r}`, `IF(W${r}="","",YEAR(TODAY())-W${r})`, num(c.year) !== null ? meta.year - c.year : '', '0;;"-"', { align: 'center' });
    v(ws, `Y${r}`, c.bclass || null, null, { align: 'center' });
    v(ws, `Z${r}`, c.ptype || null);
    if (c.address) {
      const mc = ws.getCell(`AA${r}`);
      mc.value = { text: 'map', hyperlink: mapUrl(c), tooltip: 'Open in Google Maps' };
      mc.font = { name: FONT, size: 9, color: { argb: 'FF0563C1' }, underline: true };
      mc.alignment = { horizontal: 'center' };
    }

    // the text columns past Map are written by header name, so adding one can
    // never shift another out from under its heading
    const at = (heading) => `${colLetter(cols.findIndex(([h]) => h === heading) + 1)}${r}`;
    const small = { wrap: true, size: 8 };
    if (sale) {
      v(ws, at('Sale Type'), c.sale_type || null, null, { align: 'center', wrap: true });
      v(ws, at('True Buyer'), c.buyer || null, null, { wrap: true });
      v(ws, at('True Seller'), c.seller || null, null, { wrap: true });
      v(ws, at('Sale Conditions'), c.conditions || null, null, small);
      v(ws, at('Hold Period'), c.hold || null, null, { align: 'center', size: 8 });
      v(ws, at('Buyer Broker'), c.buyer_broker || null, null, { wrap: true });
      v(ws, at('Listing Broker'), c.listing_broker || null, null, { wrap: true });
      v(ws, at('CoStar ID'), num(c.comp_id), '0', { align: 'center' });
    } else {
      v(ws, at('Status'), statusOf(c), null, { align: 'center' });
      v(ws, at('Marketed To'), c.sale_type || null, null, { align: 'center', wrap: true });
      v(ws, at('Sale Conditions'), c.conditions || null, null, small);
    }
    v(ws, at('Source PDF'), c.source, null, { color: GREY, size: 8 });
    v(ws, at('Flags'), (c.flags || []).join(' · ') || null, null, { ...small, color: GREY });
    v(ws, at('CoStar Notes (summary)'), c.notes || null, null, small);
    ws.getRow(r).height = 26;
  }

  /* survey footer -- the statistics a broker quotes from a comp set */
  const col = (k) => comps.map((c) => k(c));
  const prices = col((c) => num(c.price));
  const sizes = col((c) => num(c.bsf));
  const lots = col((c) => num(c.lot_sf));
  const doms = col((c) => num(c.dom));
  const caps = col((c) => pctOf(c.cap));
  const occs = col((c) => pctOf(c.occ));
  const bldbls = col((c) => {
    const fr = farOf(c.zoning);
    return num(c.lot_sf) && fr ? c.lot_sf * fr : null;
  });
  const ratio = (n, d) => n.map((x, i) => (x !== null && d[i] ? x / d[i] : null));
  const ppsfs = ratio(prices, sizes);
  const lppsf = ratio(prices, lots);
  const bppsf = ratio(prices, bldbls);
  // SUMPRODUCT over an empty set is 0 in Excel, so the cache is 0 too and the
  // number format renders it as a dash
  // price-per-size totals count a comp only with both above zero (engine/comps.js)
  const gatedPos = (series, gate) => series.reduce((a, x, i) => a + (pos(x) && pos(gate[i]) ? x : 0), 0);

  const R = (n) => `${n}$${FIRST}:${n}$${LAST}`;
  const guard = (a, b) => `--ISNUMBER(${R(a)}),--ISNUMBER(${R(b)})`;
  const guardPos = (a, b) => `${guard(a, b)},--(${R(a)}>0),--(${R(b)}>0)`;
  const wrow = LAST + 1;

  band(ws, wrow, span, 'SURVEY — SF-WEIGHTED');
  f(ws, `K${wrow}`, `IFERROR(SUMPRODUCT(${guardPos('K', 'L')},${R('K')}),"")`, gatedPos(prices, sizes), MONEY, { bold: true });
  f(ws, `L${wrow}`, `IFERROR(SUMPRODUCT(${guardPos('K', 'L')},${R('L')}),"")`, gatedPos(sizes, prices), SF, { bold: true });
  f(ws, `M${wrow}`, rate(`K${wrow}`, `L${wrow}`), S.weightedPpsf(prices, sizes), MONEY2, { bold: true });
  f(ws, `N${wrow}`, `IFERROR(SUMPRODUCT(${guard('N', 'K')},${R('N')},${R('K')})/SUMPRODUCT(${guard('N', 'K')},${R('K')}),"")`,
    S.weightedMean(caps, caps.map((c, i) => (c === null ? null : prices[i]))), PCT2, { bold: true });
  f(ws, `O${wrow}`, `IFERROR(SUMPRODUCT(${guard('O', 'L')},${R('O')},${R('L')})/SUMPRODUCT(${guard('O', 'L')},${R('L')}),"")`,
    S.weightedMean(occs, occs.map((o, i) => (o === null ? null : sizes[i]))), OCC, { bold: true });
  f(ws, `P${wrow}`, `IFERROR(SUMPRODUCT(${guardPos('K', 'P')},${R('P')}),"")`, gatedPos(lots, prices), SF, { bold: true });
  // each ratio gates its numerator on its own denominator, so a comp missing a
  // lot size cannot put its price over a smaller base
  f(ws, `R${wrow}`, `IFERROR(SUMPRODUCT(${guardPos('K', 'P')},${R('K')})/SUMPRODUCT(${guardPos('K', 'P')},${R('P')}),"")`,
    S.weightedPpsf(prices, lots), MONEY2, { bold: true });
  f(ws, `U${wrow}`, `IFERROR(SUMPRODUCT(${guardPos('K', 'U')},${R('U')}),"")`, gatedPos(bldbls, prices), SF, { bold: true });
  f(ws, `V${wrow}`, `IFERROR(SUMPRODUCT(${guardPos('K', 'U')},${R('K')})/SUMPRODUCT(${guardPos('K', 'U')},${R('U')}),"")`,
    S.weightedPpsf(prices, bldbls), MONEY2, { bold: true });

  const AGG = { MEDIAN: S.median, MIN: S.min, MAX: S.max };
  [['Median', 'MEDIAN'], ['Low', 'MIN'], ['High', 'MAX']].forEach(([nm, mode], j) => {
    const r = LAST + 2 + j;
    band(ws, r, span, nm);
    const fn = AGG[mode];
    const stat = (L, series, fmt) => f(ws, `${L}${r}`, agg(mode, R(L)), fn(series), fmt);
    if (!sale) stat('I', doms, SF);
    stat('K', prices, MONEY);
    stat('L', sizes, SF);
    stat('M', ppsfs, MONEY2);
    stat('N', caps, PCT2);
    stat('O', occs, OCC);
    stat('R', lppsf, MONEY2);
    stat('V', bppsf, MONEY2);
  });

  note(ws, `A${LAST + 6}`,
    'Blue figures came from CoStar and can be overwritten; black figures are formulas and will follow. '
    + 'The SF-weighted row divides total price by total size rather than averaging the ratios, so a large '
    + 'comp carries the weight it should and an unpriced listing adds nothing to either side. '
    + 'Buildable SF uses the Zoning Catalogue tab; a code it does not hold leaves buildable SF blank rather than guessing.',
    span);

  // on paper the grid stops at Property Type: brokers, flags and notes are
  // screen columns, and squeezing them onto the page shrinks everything to nothing
  ws.pageSetup.printArea = `A1:Z${LAST + 4}`;
  ws.pageSetup.printTitlesRow = '3:3';
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: LAST, column: span } };
  // in-grid bar on the $/SF column: the comp set's spread, readable at a glance
  ws.addConditionalFormatting({
    ref: `M${FIRST}:M${LAST}`,
    rules: [{
      type: 'dataBar',
      priority: 1,
      gradient: false,
      showValue: true,
      color: { argb: sale ? 'FF8DB6E8' : 'FFF4A784' },
      cfvo: [{ type: 'num', value: 0 }, { type: 'max' }],
    }],
  });
  return ws;
}

/* ------------------------------------------------- shared derived figures */

const ppsfOf = (c) => (num(c.price) && num(c.bsf) ? c.price / c.bsf : null);
const yearsAgo = (c, meta) => (c.date ? (meta.todaySerial - S.serial(new Date(c.date))) / 365.25 : null);

/* The market-conditions adjustment starts from the comps' own $/SF-over-time
 * regression only when that regression actually explains the data. Across a
 * mixed set -- a $500/SF storefront beside a $35/SF warehouse -- the slope
 * measures which properties happened to sell when, not how the market moved,
 * and applying it would push older sales up or down by hundreds of percent.
 * Appraisers take this adjustment from paired sales or a market index; when
 * the comps cannot supply one, it starts at zero and says why. */
const TREND_MIN_SALES = 5;
const TREND_MIN_R2 = 0.5;
const TREND_MAX_RATE = 0.10;      // a market rarely moves more than 10% a year in $/SF

/** Annual change in $/SF implied by the sale comps, as a fraction of the
 *  median, and whether it is reliable enough to adjust by. The rate used is
 *  rounded to the precision written into the cell, so the cached adjustments
 *  downstream agree with Excel to the last digit. */
function trendRate(sales) {
  const ys = sales.map(ppsfOf);
  const xs = sales.map((c) => (c.date ? S.serial(new Date(c.date)) : null));
  const n = ys.filter((y, i) => y !== null && xs[i] !== null).length;
  const sl = S.slope(ys, xs);
  const med = S.median(ys);
  const r2 = S.rsq(ys, xs);
  const raw = sl !== null && med ? (sl * 365.25) / med : null;
  const pctTxt = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
  let rate = 0;
  let why;
  if (raw === null || n < TREND_MIN_SALES) {
    why = `Only ${n} dated, priced sale${n === 1 ? '' : 's'}: too few to read a market trend from, so this starts at 0%. `
      + 'Enter a rate from market data if you have one.';
  } else if (r2 === null || r2 < TREND_MIN_R2) {
    why = `The comps' $/SF-over-time line has R² ${r2 === null ? 'n/a' : r2.toFixed(2)}: it explains too little to adjust by, `
      + `so this starts at 0% (the line itself says ${pctTxt(raw)} a year). Enter a rate from market data if you have one.`;
  } else if (Math.abs(raw) > TREND_MAX_RATE) {
    why = `The comps' line implies ${pctTxt(raw)} a year, more than a market moves; it is more likely the mix of properties `
      + 'than time, so this starts at 0%. Enter a rate from market data if you have one.';
  } else {
    rate = Math.round(raw * 1e6) / 1e6;
    why = `From the comps' own $/SF-over-time line (R² ${r2.toFixed(2)}, ${n} sales). An older sale is adjusted by this `
      + 'rate × the years since it closed.';
  }
  return { rate, raw, r2, n, why };
}

/** Each sale run through the Adjustment Grid at its starting rates: market
 *  conditions from the trend, every other adjustment at zero. */
function adjustedPpsf(sales, meta, trend) {
  const rows = sales.map((c) => {
    const u = ppsfOf(c);
    const yrs = yearsAgo(c, meta);
    const time = u !== null && yrs !== null ? trend.rate * yrs : null;
    const normalized = u !== null ? u * (1 + (time ?? 0)) : null;
    const adjusted = normalized;                    // property adjustments start at zero
    const gross = u !== null ? Math.abs(time ?? 0) : null;
    const reliability = gross !== null ? 1 / (1 + gross) : null;
    return { u, time, normalized, adjusted, gross, reliability, weight: u === null ? null : 1 };
  });
  const adj = rows.map((x) => x.adjusted);
  return {
    rows,
    weighted: S.weightedMean(adj, rows.map((x) => x.weight)),
    least: S.weightedMean(adj, rows.map((x) => x.reliability)),
    mean: S.mean(adj),
    median: S.median(adj),
    low: S.min(adj),
    high: S.max(adj),
  };
}

/* -------------------------------------------------------------- charts tab */

function chartsTab(wb, sales, market, meta) {
  const ws = sheet(wb, 'Charts', [12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12], 'FF2A78D6');
  title(ws, 1, 12, 'COMP SET CHARTS',
    `${meta.label} · live charts drawn from the Sale Comps and On Market Comps tabs · built ${meta.stamp}`);
  if (!sales.length && !market.length) {
    label(ws, 'A4', 'No comps to chart.', { italic: true, color: GREY });
  }
  // the charts themselves are added to this sheet when the package is written
  ws.pageSetup.fitToHeight = 1;
  return ws;
}

/* ------------------------------------------------------------- summary tab */

const SUM_W = [34, 15, 15, 15, 15, 15, 15, 15, 26];
// rows the sale survey block writes (it starts at row 15)
const SR = { ppsf: 17, cap: 18, price: 19, bsf: 20, land: 21, bldbl: 22, occ: 23, months: 24 };

function summaryTab(wb, g, sales, market, subject, meta, trend, A) {
  const ws = sheet(wb, 'Summary', SUM_W);
  const span = SUM_W.length;
  const by = meta.preparedBy ? `Prepared by ${meta.preparedBy} · ` : '';
  title(ws, 1, span, 'COMP SET SUMMARY',
    `${by}${meta.label} · ${sales.length} sale comps, ${market.length} on-market comps · built ${meta.stamp}`);

  /* ---- subject property: the only block anyone has to fill in ---- */
  band(ws, 4, span, 'SUBJECT PROPERTY — fill in the shaded cells');
  const subRows = [
    ['Address', subject.address || null, null],
    ['City, State', [subject.city, subject.state].filter(Boolean).join(', ') || null, null],
    ['Property Type', subject.ptype || null, null],
    ['Building SF', num(subject.bsf), SF],
    ['Lot SF', num(subject.lotSf), SF],
    ['Zoning', subject.zoning ? String(subject.zoning).trim() : null, null],
    ['Year Built', num(subject.year), '0;;"-"'],
    ['In-Place NOI ($/yr)', num(subject.noi), MONEY],
    ['Asking / Target Price', num(subject.price), MONEY],
  ];
  subRows.forEach(([nm, val, fmt], i) => {
    const r = 5 + i;
    label(ws, `A${r}`, nm);
    v(ws, `B${r}`, val, fmt, { input: true, fillin: true, align: fmt ? 'right' : 'left' });
  });
  const subjFar = farOf(subject.zoning);
  const subjBldbl = num(subject.lotSf) && subjFar ? subject.lotSf * subjFar : null;
  const inPlace = num(subject.noi) && num(subject.price) ? subject.noi / subject.price : null;
  label(ws, 'D5', 'Max FAR (zoning)', { bold: true });
  f(ws, 'E5', farLookup(g, 'B10'), subjFar ?? '', FAR_FMT, { align: 'right' });
  label(ws, 'D6', 'Buildable SF', { bold: true });
  f(ws, 'E6', prod('B9', 'E5'), subjBldbl ?? '', SF, { align: 'right' });
  label(ws, 'D7', 'In-place cap on asking', { bold: true });
  f(ws, 'E7', rate('B12', 'B13'), inPlace ?? '', PCT2, { align: 'right' });
  label(ws, 'D8', 'Asking $/SF', { bold: true });
  f(ws, 'E8', rate('B13', 'B8'), num(subject.price) && num(subject.bsf) ? subject.price / subject.bsf : '', MONEY2, { align: 'right' });

  /* ---- survey statistics ---- */
  const statBlock = (startRow, heading, tab, comps, domCol) => {
    band(ws, startRow, span, heading);
    headerRow(ws, startRow + 1, ['Metric', 'Count', 'Low', '25th Pctl', 'Median', 'Mean', 'Weighted', '75th Pctl', 'High'], span);
    const series = {
      '$/SF': comps.map(ppsfOf),
      'Cap Rate': comps.map((c) => pctOf(c.cap)),
      'Price': comps.map((c) => num(c.price)),
      'Building SF': comps.map((c) => num(c.bsf)),
      '$/Land SF': comps.map((c) => (num(c.price) && num(c.lot_sf) ? c.price / c.lot_sf : null)),
      '$/Buildable SF': comps.map((c) => {
        const fr = farOf(c.zoning);
        return num(c.price) && num(c.lot_sf) && fr ? c.price / (c.lot_sf * fr) : null;
      }),
      'Occupancy': comps.map((c) => pctOf(c.occ)),
      [domCol.name]: comps.map(domCol.get),
    };
    const colOf = { '$/SF': 'M', 'Cap Rate': 'N', 'Price': 'K', 'Building SF': 'L', '$/Land SF': 'R', '$/Buildable SF': 'V', 'Occupancy': 'O', [domCol.name]: domCol.col };
    const fmtOf = { '$/SF': MONEY2, 'Cap Rate': PCT2, 'Price': MONEY, 'Building SF': SF, '$/Land SF': MONEY2, '$/Buildable SF': MONEY2, 'Occupancy': OCC, [domCol.name]: NUM1 };
    const prices = comps.map((c) => num(c.price));
    const sizes = comps.map((c) => num(c.bsf));
    const K = colRange(g, tab, 'K');
    const Lr = colRange(g, tab, 'L');
    let r = startRow + 2;
    for (const [metric, data] of Object.entries(series)) {
      const fmt = fmtOf[metric];
      const rng = colRange(g, tab, colOf[metric]);
      label(ws, `A${r}`, metric, { bold: metric === '$/SF' });
      f(ws, `B${r}`, `COUNT(${rng})`, S.count(data), '0', { align: 'center' });
      f(ws, `C${r}`, agg('MIN', rng), S.min(data), fmt);
      f(ws, `D${r}`, `IFERROR(PERCENTILE(${rng},0.25),"")`, S.percentile(data, 0.25), fmt);
      f(ws, `E${r}`, `IFERROR(MEDIAN(${rng}),"")`, S.median(data), fmt, { bold: true });
      f(ws, `F${r}`, `IFERROR(AVERAGE(${rng}),"")`, S.mean(data), fmt);
      if (metric === '$/SF') {
        f(ws, `G${r}`, `IFERROR(SUMPRODUCT(--ISNUMBER(${K}),--ISNUMBER(${Lr}),--(${K}>0),--(${Lr}>0),${K})/SUMPRODUCT(--ISNUMBER(${K}),--ISNUMBER(${Lr}),--(${K}>0),--(${Lr}>0),${Lr}),"")`,
          S.weightedPpsf(prices, sizes), fmt, { bold: true });
      } else if (metric === 'Cap Rate' || metric === 'Occupancy') {
        const w = metric === 'Cap Rate' ? K : Lr;
        f(ws, `G${r}`, `IFERROR(SUMPRODUCT(--ISNUMBER(${rng}),--ISNUMBER(${w}),${rng},${w})/SUMPRODUCT(--ISNUMBER(${rng}),--ISNUMBER(${w}),${w}),"")`,
          S.weightedMean(data, data.map((x, i) => (x === null ? null : (metric === 'Cap Rate' ? prices[i] : sizes[i])))), fmt);
      } else {
        label(ws, `G${r}`, '—', { color: GREY, align: 'center' });
      }
      f(ws, `H${r}`, `IFERROR(PERCENTILE(${rng},0.75),"")`, S.percentile(data, 0.75), fmt);
      f(ws, `I${r}`, agg('MAX', rng), S.max(data), fmt);
      r++;
    }
    return r;
  };

  let r = statBlock(15, 'SALE COMP SURVEY', 'Sale Comps', sales,
    { name: 'Months Since Sale', col: 'J', get: (c) => (c.date ? (meta.todaySerial - S.serial(new Date(c.date))) / 30.44 : null) });
  note(ws, `A${r}`, 'Weighted: $/SF is total price over total size; cap rate is weighted by price; occupancy by building size.', span);

  /* ---- market read: trend, asking against sold, and depth ---- */
  r += 2;
  band(ws, r, span, 'MARKET READ');
  const ys = sales.map(ppsfOf);
  const xs = sales.map((c) => (c.date ? S.serial(new Date(c.date)) : null));
  const sl = S.slope(ys, xs);
  const med = S.median(ys);
  const M = colRange(g, 'Sale Comps', 'M');
  const I = colRange(g, 'Sale Comps', 'I');
  const tr = r + 1;
  label(ws, `A${tr}`, '$/SF change per year (trend line)');
  f(ws, `B${tr}`, `IFERROR(SLOPE(${M},${I})*365.25,"")`, sl === null ? '' : sl * 365.25, MONEY2);
  label(ws, `D${tr}`, 'As % of median $/SF', { bold: true });
  ws.mergeCells(tr, 4, tr, 5);
  f(ws, `F${tr}`, `IFERROR(SLOPE(${M},${I})*365.25/MEDIAN(${M}),"")`,
    sl !== null && med ? (sl * 365.25) / med : '', PCT1, { bold: true });
  label(ws, `G${tr}`, 'R² of the trend', { bold: true });
  f(ws, `H${tr}`, `IFERROR(RSQ(${M},${I}),"")`, S.rsq(ys, xs) ?? '', '0.00');

  const askMed = S.median(market.map(ppsfOf));
  const MM = colRange(g, 'On Market Comps', 'M');
  const ar = tr + 1;
  label(ws, `A${ar}`, 'Median asking $/SF (on market)');
  f(ws, `B${ar}`, `IFERROR(MEDIAN(${MM}),"")`, askMed ?? '', MONEY2);
  label(ws, `D${ar}`, 'Median sold $/SF', { bold: true });
  ws.mergeCells(ar, 4, ar, 5);
  f(ws, `F${ar}`, `IFERROR(MEDIAN(${M}),"")`, med ?? '', MONEY2);
  label(ws, `G${ar}`, 'Asking premium', { bold: true });
  f(ws, `H${ar}`, `IFERROR(B${ar}/F${ar}-1,"")`, askMed && med ? askMed / med - 1 : '', PCT1, { bold: true });

  // a thin set is the first thing a reviewer asks about: fewer than five sales
  // in the last eighteen months is the usual line
  const J = colRange(g, 'Sale Comps', 'J');
  const recent = sales.filter((c) => c.date && (meta.todaySerial - S.serial(new Date(c.date))) / 30.44 <= 18).length;
  const dr = ar + 1;
  label(ws, `A${dr}`, 'Sales in the last 18 months');
  f(ws, `B${dr}`, `COUNTIF(${J},"<=18")`, recent, '0', { align: 'right' });
  const thin = recent < 5;
  f(ws, `D${dr}`, `IF(B${dr}<5,"Thin set: fewer than five sales in 18 months. Lean on current market knowledge.",`
    + `"Enough recent sales to support a sales-comparison value.")`,
  thin ? 'Thin set: fewer than five sales in 18 months. Lean on current market knowledge.'
    : 'Enough recent sales to support a sales-comparison value.', null, { bold: thin, color: thin ? WARN : 'FF000000' });
  ws.mergeCells(dr, 4, dr, span);
  note(ws, `A${dr + 1}`,
    'The trend line is a sanity check on a handful of points, not a market index: read R² before quoting it, and remember a '
    + 'land-value sale or a partial interest in the set will tilt it. The Adjustment Grid uses it for its market-conditions '
    + `adjustment only with at least ${TREND_MIN_SALES} sales, an R² of ${TREND_MIN_R2} or more and a rate within ±${TREND_MAX_RATE * 100}% a year. `
    + 'A positive asking premium is normal; a wide one says sellers are ahead of where deals close.', span);

  r = statBlock(dr + 3, 'ON MARKET SURVEY (asking)', 'On Market Comps', market,
    { name: 'Months on Market', col: 'J', get: (c) => (num(c.dom) !== null ? c.dom / 30.44 : null) });

  /* ---- what the comps say the subject is worth ---- */
  r += 1;
  band(ws, r, span, 'INDICATED VALUE — four approaches, driven by the cells above');
  headerRow(ws, r + 1, ['Approach', 'Basis', 'Low', 'Mid', 'High', 'Low $/SF', 'Mid $/SF', 'High $/SF', 'Driven by'], span);
  const bsf = num(subject.bsf);
  const times = (x, k) => (x !== null && x !== undefined && k ? x * k : null);
  const caps = sales.map((c) => pctOf(c.cap));
  const c25 = S.percentile(caps, 0.25);
  const c50 = S.median(caps);
  const c75 = S.percentile(caps, 0.75);
  const noi = num(subject.noi);
  const bSeries = sales.map((c) => {
    const fr = farOf(c.zoning);
    return num(c.price) && num(c.lot_sf) && fr ? c.price / (c.lot_sf * fr) : null;
  });
  const rows = [
    {
      name: 'Sales comparison ($/SF)', basis: 'Subject SF × comp $/SF',
      lo: prod(`$D$${SR.ppsf}`, '$B$8'), mid: prod(`$E$${SR.ppsf}`, '$B$8'), hi: prod(`$H$${SR.ppsf}`, '$B$8'),
      loV: times(S.percentile(ys, 0.25), bsf), midV: times(med, bsf), hiV: times(S.percentile(ys, 0.75), bsf),
      src: '25th / median / 75th percentile $/SF',
    },
    {
      // a higher cap rate is a lower value, so the ends swap
      name: 'Income (direct capitalization)', basis: 'Subject NOI ÷ comp cap rate',
      lo: rate('$B$12', `$H$${SR.cap}`), mid: rate('$B$12', `$E$${SR.cap}`), hi: rate('$B$12', `$D$${SR.cap}`),
      loV: noi && c75 ? noi / c75 : null, midV: noi && c50 ? noi / c50 : null, hiV: noi && c25 ? noi / c25 : null,
      src: '75th / median / 25th percentile cap rate',
    },
    {
      name: 'Land basis ($/buildable SF)', basis: 'Subject buildable SF × comp $/buildable SF',
      lo: prod(`$D$${SR.bldbl}`, '$E$6'), mid: prod(`$E$${SR.bldbl}`, '$E$6'), hi: prod(`$H$${SR.bldbl}`, '$E$6'),
      loV: times(S.percentile(bSeries, 0.25), subjBldbl), midV: times(S.median(bSeries), subjBldbl),
      hiV: times(S.percentile(bSeries, 0.75), subjBldbl),
      src: 'Zoning max FAR × lot size',
    },
    {
      name: 'Adjusted sales comparison', basis: 'Subject SF × adjusted $/SF',
      lo: prod(`'Adjustment Grid'!$Q$${g.adj.low}`, '$B$8'),
      mid: prod(`'Adjustment Grid'!$Q$${g.adj.wavg}`, '$B$8'),
      hi: prod(`'Adjustment Grid'!$Q$${g.adj.high}`, '$B$8'),
      loV: times(A.low, bsf), midV: times(A.weighted, bsf), hiV: times(A.high, bsf),
      src: 'Adjustment Grid: low / weighted / high',
    },
  ];
  const vr0 = r + 2;
  rows.forEach((row, i) => {
    const rr = vr0 + i;
    label(ws, `A${rr}`, row.name, { bold: true });
    label(ws, `B${rr}`, row.basis, { size: 8, color: GREY, wrap: true });
    f(ws, `C${rr}`, row.lo, row.loV, MONEY);
    f(ws, `D${rr}`, row.mid, row.midV, MONEY, { bold: true });
    f(ws, `E${rr}`, row.hi, row.hiV, MONEY);
    f(ws, `F${rr}`, rate(`C${rr}`, '$B$8'), row.loV !== null && bsf ? row.loV / bsf : null, MONEY2);
    f(ws, `G${rr}`, rate(`D${rr}`, '$B$8'), row.midV !== null && bsf ? row.midV / bsf : null, MONEY2, { bold: true });
    f(ws, `H${rr}`, rate(`E${rr}`, '$B$8'), row.hiV !== null && bsf ? row.hiV / bsf : null, MONEY2);
    label(ws, `I${rr}`, row.src, { size: 8, color: GREY, wrap: true });
    ws.getRow(rr).height = 24;
  });

  const cr = vr0 + rows.length;
  band(ws, cr, span, 'CONCLUDED RANGE');
  const cLo = S.min(rows.map((x) => x.loV));
  const cMid = S.median(rows.map((x) => x.midV));
  const cHi = S.max(rows.map((x) => x.hiV));
  f(ws, `C${cr}`, agg('MIN', `C${vr0}:C${cr - 1}`), cLo, MONEY, { bold: true });
  f(ws, `D${cr}`, `IFERROR(MEDIAN(D${vr0}:D${cr - 1}),"")`, cMid, MONEY, { bold: true });
  f(ws, `E${cr}`, agg('MAX', `E${vr0}:E${cr - 1}`), cHi, MONEY, { bold: true });
  const per = (x) => (x !== null && bsf ? x / bsf : null);
  f(ws, `F${cr}`, rate(`C${cr}`, '$B$8'), per(cLo), MONEY2);
  f(ws, `G${cr}`, rate(`D${cr}`, '$B$8'), per(cMid), MONEY2, { bold: true });
  f(ws, `H${cr}`, rate(`E${cr}`, '$B$8'), per(cHi), MONEY2);

  const pr = cr + 2;
  band(ws, pr, span, 'PRICING SIGNAL');
  label(ws, `A${pr + 1}`, 'Asking against the concluded midpoint');
  f(ws, `B${pr + 1}`, `IFERROR(IF(OR($B$13="",D${cr}=""),"",$B$13/D${cr}-1),"")`,
    num(subject.price) && cMid ? subject.price / cMid - 1 : null, PCT1, { bold: true });
  label(ws, `D${pr + 1}`, 'Implied cap at the midpoint', { bold: true });
  f(ws, `F${pr + 1}`, rate('$B$12', `D${cr}`), noi && cMid ? noi / cMid : null, PCT2, { bold: true });
  note(ws, `A${pr + 2}`,
    'A positive figure means the asking price sits above what this comp set supports. Every number on this tab is a '
    + 'formula over the comp grids, so changing a comp or a subject input moves all of it.', span);

  /* ---- pricing matrix: value at a ladder of cap rates ---- */
  const pm = pr + 4;
  band(ws, pm, span, 'PRICING MATRIX — subject value across a ladder of cap rates');
  const roundTo = (x, step) => Math.round(x / step) * step;
  const center = Math.round(roundTo(c50 ?? inPlace ?? 0.06, 0.0025) * 1e6) / 1e6;
  const step = 0.0025;
  const why = c50 !== null ? 'Starts at the median sale cap rate, rounded to the step.'
    : inPlace !== null ? 'No cap rates in this comp set, so it starts at the subject\'s in-place cap, rounded.'
      : 'No cap rates in this comp set and no subject NOI: set the center yourself.';
  label(ws, `A${pm + 1}`, 'Center cap rate');
  label(ws, `E${pm + 1}`, why, { size: 8, italic: true, color: GREY });
  ws.mergeCells(pm + 1, 5, pm + 1, span);
  v(ws, `B${pm + 1}`, center, PCT2, { input: true, fillin: true, align: 'right' });
  label(ws, `C${pm + 1}`, 'Step', { bold: true, align: 'right' });
  v(ws, `D${pm + 1}`, step, PCT2, { input: true, fillin: true, align: 'right' });
  headerRow(ws, pm + 2, ['Cap Rate', 'Indicated Value', '$/SF', 'Against Asking'], span);
  for (let k = -4; k <= 4; k++) {
    const rr = pm + 7 + k;              // rows pm+3 .. pm+11
    const capK = Math.round((center + k * step) * 1e9) / 1e9;
    const capV = capK > 0 ? capK : null;
    const val = noi && capV ? noi / capV : null;
    const bold = k === 0;
    f(ws, `A${rr}`, `IF($B$${pm + 1}="","",IF($B$${pm + 1}+(${k})*$D$${pm + 1}<=0,"",$B$${pm + 1}+(${k})*$D$${pm + 1}))`,
      capV, PCT2, { bold, align: 'left' });
    f(ws, `B${rr}`, rate('$B$12', `A${rr}`), val, MONEY, { bold });
    f(ws, `C${rr}`, rate(`B${rr}`, '$B$8'), val !== null && bsf ? val / bsf : null, MONEY2, { bold });
    f(ws, `D${rr}`, `IFERROR(IF(OR(B${rr}="",$B$13=""),"",B${rr}/$B$13-1),"")`,
      val !== null && num(subject.price) ? val / subject.price - 1 : null, PCT1, { bold });
  }
  note(ws, `A${pm + 12}`,
    'Each row capitalizes the subject\'s in-place NOI at the rate on the left. Set the center and the step to frame a '
    + 'pricing conversation; the row in bold is the center.', span);

  ws.pageSetup.printArea = `A1:I${pm + 12}`;
  return ws;
}

/* ---------------------------------------------------- adjustment grid tab */

const ADJ_HEAD = ['#', 'Property Name', 'Sale Date', 'Unadjusted $/SF',
  'Property Rights', 'Financing', 'Conditions of Sale', 'Market Conditions', 'Normalized $/SF',
  'Location', 'Size', 'Age / Condition', 'Quality', 'Occupancy / Lease', 'Other', 'Net Property Adj.',
  'Adjusted $/SF', 'Gross Adj.', 'Reliability Weight', 'Your Weight', 'Comment', 'Net Adj. (overall)',
  'CoStar Sale Type & Conditions'];
const ADJ_W = [4, 34, 11, 11, 9, 9, 10, 10, 11, 9, 8, 10, 8, 10, 8, 10, 11, 9, 10, 8, 28, 10, 30];

// Lender underwriting guidelines, not appraisal standards: USPAP sets no
// numeric limit. A comp past them is flagged, never dropped -- it can still be
// the best evidence available, and the reviewer says why.
const NET_GUIDE = 0.15;
const GROSS_GUIDE = 0.25;

function adjustmentTab(wb, g, sales, subject, meta, trend, A) {
  const ws = sheet(wb, 'Adjustment Grid', ADJ_W, 'FF2E75B6');
  const span = ADJ_W.length;
  title(ws, 1, span, 'SALES COMPARISON — ADJUSTMENT GRID',
    'Each sale is brought to the subject in the appraisal sequence: transaction terms and market conditions first, '
    + 'then the property differences. Blue cells are yours to set.');

  band(ws, 4, span, 'ADJUSTMENT RATES');
  label(ws, 'B5', 'Market trend: change in $/SF per year', { bold: true });
  v(ws, 'C5', trend.rate, PCT_ADJ, { input: true, fillin: true, align: 'right' });
  label(ws, 'E5', trend.why, { size: 8, italic: true, color: trend.rate ? GREY : WARN });
  ws.mergeCells('E5:W5');

  label(ws, 'B6', 'Size: adjustment per doubling of SF', { bold: true });
  v(ws, 'C6', 0, PCT_ADJ, { input: true, fillin: true, align: 'right' });
  // the column computes rate x log2(comp SF / subject SF): a positive rate moves
  // a larger comp up and a smaller one down, which is the usual direction
  label(ws, 'E6', 'Starts at zero. Smaller buildings usually trade higher per foot, so a comp larger than the subject is '
    + 'adjusted up: enter a positive rate. At 8%, a comp twice the subject\'s size is adjusted +8%, one half its size -8%.',
  { size: 8, italic: true, color: GREY });
  ws.mergeCells('E6:W6');

  label(ws, 'B7', 'Subject building SF', { bold: true });
  f(ws, 'C7', 'IF(Summary!$B$8="","",Summary!$B$8)', num(subject.bsf) ?? '', SF, { align: 'right' });
  label(ws, 'E7', 'From the Summary tab, so there is one place to change it.', { size: 8, italic: true, color: GREY });
  ws.mergeCells('E7:W7');

  note(ws, 'A8',
    'Sequence: property rights, financing, conditions of sale and market conditions compound one after another to a '
    + 'normalized $/SF; the property adjustments are then added together and applied once. Gross adjustment is the sum '
    + 'of every adjustment ignoring sign; the comps that need the least adjusting are the most reliable, which is what '
    + 'the reliability weight expresses.', span);

  label(ws, 'B9', 'Flag comps adjusted past (lender guidelines)', { bold: true });
  v(ws, 'C9', NET_GUIDE, PCT1, { input: true, fillin: true, align: 'right' });
  label(ws, 'D9', 'net', { color: GREY });
  v(ws, 'E9', GROSS_GUIDE, PCT1, { input: true, fillin: true, align: 'right' });
  label(ws, 'F9', 'gross', { color: GREY });
  label(ws, 'G9', 'Common lender thresholds, not limits: a comp past them is shaded, not dropped. If it is still the best '
    + 'evidence, keep it and say why in the Comment column.', { size: 8, italic: true, color: GREY });
  ws.mergeCells('G9:W9');

  band(ws, 10, span, 'COMPS');
  headerRow(ws, 11, ADJ_HEAD, span);
  ws.views = [{ showGridLines: false, state: 'frozen', xSplit: 2, ySplit: 11 }];

  const { adj } = g;
  for (let i = 0; i < g.slots; i++) {
    const r = adj.first + i;
    const sr = g.first + i;
    const c = sales[i];
    for (let k = 1; k <= span; k++) {
      const cell = ws.getCell(r, k);
      cell.border = { bottom: { style: 'hair', color: { argb: RULE } } };
      if (i % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F9FC' } };
    }
    if (!c) continue;
    const x = A.rows[i];
    const sizeAdj = num(subject.bsf) && num(c.bsf) ? 0 : '';
    const hasU = x.u !== null;

    v(ws, `A${r}`, i + 1, null, { align: 'center', color: GREY });
    f(ws, `B${r}`, `'Sale Comps'!B${sr}`, c.name);
    // a blank date must stay blank: as a number it is day zero, a century ago
    f(ws, `C${r}`, `IF('Sale Comps'!I${sr}="","",'Sale Comps'!I${sr})`,
      c.date ? S.serial(new Date(c.date)) : '', DATE, { align: 'center' });
    f(ws, `D${r}`, `IFERROR('Sale Comps'!M${sr},"")`, x.u ?? '', MONEY2, { align: 'right' });
    for (const L of ['E', 'F', 'G']) v(ws, `${L}${r}`, 0, PCT_ADJ, { input: true, align: 'center' });
    f(ws, `H${r}`, `IF(OR(D${r}="",C${r}=""),"",$C$5*(TODAY()-C${r})/365.25)`, x.time ?? '', PCT_ADJ, { align: 'center' });
    f(ws, `I${r}`, `IF(D${r}="","",D${r}*(1+N(E${r}))*(1+N(F${r}))*(1+N(G${r}))*(1+N(H${r})))`,
      x.normalized ?? '', MONEY2, { align: 'right', bold: true });
    v(ws, `J${r}`, 0, PCT_ADJ, { input: true, align: 'center' });
    f(ws, `K${r}`, `IFERROR($C$6*LOG('Sale Comps'!L${sr}/$C$7,2),"")`, sizeAdj, PCT_ADJ, { align: 'center' });
    for (const L of ['L', 'M', 'N', 'O']) v(ws, `${L}${r}`, 0, PCT_ADJ, { input: true, align: 'center' });
    f(ws, `P${r}`, `IF(I${r}="","",N(J${r})+N(K${r})+N(L${r})+N(M${r})+N(N${r})+N(O${r}))`,
      hasU ? 0 : '', PCT_ADJ, { align: 'center', bold: true });
    f(ws, `Q${r}`, `IF(I${r}="","",I${r}*(1+P${r}))`, x.adjusted ?? '', MONEY2, { align: 'right', bold: true });
    f(ws, `R${r}`, `IF(D${r}="","",ABS(N(E${r}))+ABS(N(F${r}))+ABS(N(G${r}))+ABS(N(H${r}))+ABS(N(J${r}))`
      + `+ABS(N(K${r}))+ABS(N(L${r}))+ABS(N(M${r}))+ABS(N(N${r}))+ABS(N(O${r})))`, x.gross ?? '', PCT1, { align: 'center' });
    f(ws, `S${r}`, `IF(R${r}="","",1/(1+R${r}))`, x.reliability ?? '', '0.00', { align: 'center' });
    v(ws, `T${r}`, hasU ? 1 : null, '0.0', { input: true, align: 'center' });
    v(ws, `U${r}`, null, null, { input: true, wrap: true, size: 8 });
    // everything the grid did to this comp, as one figure: adjusted over unadjusted
    f(ws, `V${r}`, `IFERROR(IF(OR(Q${r}="",D${r}=""),"",Q${r}/D${r}-1),"")`,
      hasU && x.adjusted !== null ? x.adjusted / x.u - 1 : '', PCT_ADJ, { align: 'center', bold: true });
    // what CoStar recorded about the deal, beside the conditions-of-sale column's job
    const terms = [c.sale_type, c.conditions].filter(Boolean).join(' · ');
    v(ws, `W${r}`, terms || null, null, { wrap: true, size: 8, color: GREY });
    ws.getRow(r).height = 18;
  }

  // shade any comp past the guideline thresholds set in row 9
  const amber = { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFCE4B8' }, fgColor: { argb: 'FFFCE4B8' } };
  ws.addConditionalFormatting({
    ref: `V${adj.first}:V${adj.last}`,
    rules: [{ type: 'expression', priority: 1, formulae: [`AND(ISNUMBER(V${adj.first}),ABS(V${adj.first})>$C$9)`],
      style: { fill: amber, font: { bold: true, color: { argb: WARN } } } }],
  });
  ws.addConditionalFormatting({
    ref: `R${adj.first}:R${adj.last}`,
    rules: [{ type: 'expression', priority: 2, formulae: [`AND(ISNUMBER(R${adj.first}),R${adj.first}>$E$9)`],
      style: { fill: amber, font: { bold: true, color: { argb: WARN } } } }],
  });

  const Q = `Q${adj.first}:Q${adj.last}`;
  const T = `T${adj.first}:T${adj.last}`;
  const Sw = `S${adj.first}:S${adj.last}`;
  const wsum = (w) => `IFERROR(SUMPRODUCT(--ISNUMBER(${Q}),--ISNUMBER(${w}),${Q},${w})`
    + `/SUMPRODUCT(--ISNUMBER(${Q}),--ISNUMBER(${w}),${w}),"")`;
  band(ws, adj.last + 2, span, 'ADJUSTED $/SF CONCLUSION');
  const concl = [
    [adj.mean, 'Mean', `IFERROR(AVERAGE(${Q}),"")`, A.mean],
    [adj.wavg, 'Weighted by your weights', wsum(T), A.weighted],
    [adj.least, 'Weighted by reliability (least adjusted counts most)', wsum(Sw), A.least],
    [adj.med, 'Median', `IFERROR(MEDIAN(${Q}),"")`, A.median],
    [adj.low, 'Low', agg('MIN', Q), A.low],
    [adj.high, 'High', agg('MAX', Q), A.high],
  ];
  for (const [r, nm, formula, val] of concl) {
    label(ws, `A${r}`, nm, { bold: r === adj.wavg });
    ws.mergeCells(r, 1, r, 16);
    f(ws, `Q${r}`, formula, val, MONEY2, { align: 'right', bold: r === adj.wavg });
  }

  const ir = adj.high + 2;
  band(ws, ir, span, 'INDICATED SUBJECT VALUE');
  const bsf = num(subject.bsf);
  const out = [
    ['Adjusted $/SF, weighted by your weights', `IFERROR(Q${adj.wavg},"")`, A.weighted, MONEY2],
    ['× Subject building SF', 'IF($C$7="","",$C$7)', bsf, SF],
    ['Indicated value', prod(`Q${adj.wavg}`, '$C$7'), A.weighted !== null && bsf ? A.weighted * bsf : null, MONEY],
    ['Indicated value, weighted by reliability', prod(`Q${adj.least}`, '$C$7'), A.least !== null && bsf ? A.least * bsf : null, MONEY],
    ['Implied cap on subject NOI', rate('Summary!$B$12', prod(`Q${adj.wavg}`, '$C$7')),
      num(subject.noi) && A.weighted && bsf ? subject.noi / (A.weighted * bsf) : null, PCT2],
    ['Range, low to high', prod(`Q${adj.low}`, '$C$7'), A.low !== null && bsf ? A.low * bsf : null, MONEY],
  ];
  out.forEach(([nm, formula, val, fmt], i) => {
    const r = ir + 1 + i;
    label(ws, `A${r}`, nm, { bold: i === 2 });
    ws.mergeCells(r, 1, r, 16);
    f(ws, `Q${r}`, formula, val, fmt, { align: 'right', bold: i === 2 });
    if (i === 5) {
      f(ws, `R${r}`, prod(`Q${adj.high}`, '$C$7'), A.high !== null && bsf ? A.high * bsf : null, MONEY, { align: 'right' });
    }
  });
  const gr = ir + 7;
  const pastNet = A.rows.filter((x) => x.u !== null && x.adjusted !== null && Math.abs(x.adjusted / x.u - 1) > NET_GUIDE).length;
  const pastGross = A.rows.filter((x) => x.gross !== null && x.gross > GROSS_GUIDE).length;
  label(ws, `A${gr}`, 'Comps past the guidelines: net (column V) and gross (column R)', { bold: pastNet + pastGross > 0 });
  ws.mergeCells(gr, 1, gr, 16);
  // COUNTIF skips the blank text the formula columns hold for empty rows
  f(ws, `Q${gr}`, `COUNTIF(V${adj.first}:V${adj.last},">"&$C$9)+COUNTIF(V${adj.first}:V${adj.last},"<"&-$C$9)`,
    pastNet, '0', { align: 'right', bold: true });
  f(ws, `R${gr}`, `COUNTIF(R${adj.first}:R${adj.last},">"&$E$9)`, pastGross, '0', { align: 'right', bold: true });

  note(ws, `A${ir + 9}`,
    'Leave an adjustment at zero rather than inventing one: a grid where every line has been nudged is harder to defend '
    + 'than one with two honest adjustments. Set a comp\'s weight to zero to drop it from the conclusion.', span);
  return ws;
}

/* ---------------------------------------------------- lease comps (manual) */

const LEASE_COLS = [
  ['#', 4], ['Tenant', 22], ['Property / Address', 26], ['City', 13], ['ST', 5],
  ['Suite / Floor', 12], ['Leased SF', 10], ['Lease Start', 11], ['Term (mos)', 9],
  ['Expiration', 11], ['Base Rent ($/SF/yr)', 12], ['Lease Type', 11],
  ['Escalation (%/yr)', 11], ['Free Rent (mos)', 10], ['TI ($/SF)', 10],
  ['Net Effective Rent ($/SF/yr)', 14], ['Source', 18], ['Notes', 34],
];

function leaseTab(wb, meta) {
  const ws = sheet(wb, 'Lease Comps', LEASE_COLS.map(([, w]) => w), 'FF548235');
  const span = LEASE_COLS.length;
  title(ws, 1, span, 'LEASE COMPARABLES',
    'Filled in by hand — CoStar lease reports are not parsed. Shaded cells are inputs; the Expiration and '
    + 'Net Effective Rent columns are formulas.');
  headerRow(ws, 3, LEASE_COLS.map(([t]) => t), span);
  ws.views = [{ showGridLines: false, state: 'frozen', xSplit: 2, ySplit: 3 }];

  // one example row, so the expected format for every column is visible
  const ex = 4;
  v(ws, `A${ex}`, 'e.g.', null, { align: 'center', italic: true, color: GREY });
  v(ws, `B${ex}`, 'Example Tenant LLC', null, { italic: true, color: GREY });
  v(ws, `C${ex}`, '1234 Example Ave NW', null, { italic: true, color: GREY });
  v(ws, `D${ex}`, 'Washington', null, { italic: true, color: GREY });
  v(ws, `E${ex}`, 'DC', null, { italic: true, color: GREY, align: 'center' });
  v(ws, `F${ex}`, 'Ground', null, { italic: true, color: GREY });
  v(ws, `G${ex}`, 2400, SF, { italic: true, color: GREY, align: 'right' });
  v(ws, `H${ex}`, new Date(Date.UTC(2026, 0, 1)), DATE, { italic: true, color: GREY, align: 'center' });
  v(ws, `I${ex}`, 120, '0', { italic: true, color: GREY, align: 'center' });
  f(ws, `J${ex}`, `IF(OR(H${ex}="",I${ex}=""),"",EDATE(H${ex},I${ex}))`, S.serial(new Date(Date.UTC(2036, 0, 1))), DATE, { align: 'center', color: GREY });
  v(ws, `K${ex}`, 75, MONEY2, { italic: true, color: GREY, align: 'right' });
  v(ws, `L${ex}`, 'NNN', null, { italic: true, color: GREY, align: 'center' });
  v(ws, `M${ex}`, 0.03, PCT1, { italic: true, color: GREY, align: 'center' });
  v(ws, `N${ex}`, 3, '0', { italic: true, color: GREY, align: 'center' });
  v(ws, `O${ex}`, 25, MONEY2, { italic: true, color: GREY, align: 'right' });
  // the engine's net effective rent (engine/leasing.js), the same definition as the Tools' NER
  f(ws, `P${ex}`, nerExcel(ex), netEffectiveRent({ rent: 75, sf: 1, months: 120, esc: 3, free: 3, ti: 25 }).nerSimple, MONEY2, { align: 'right', color: GREY });
  v(ws, `Q${ex}`, 'CoStar / broker', null, { italic: true, color: GREY, size: 8 });
  v(ws, `R${ex}`, 'Delete this example row before sending the file out.', null, { italic: true, color: GREY, size: 8, wrap: true });

  for (let r = ex + 1; r <= ex + 20; r++) {
    ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'K', 'L', 'M', 'N', 'O', 'Q', 'R'].forEach((L) => {
      v(ws, `${L}${r}`, null, null, { input: true, fillin: true });
    });
    ws.getCell(`G${r}`).numFmt = SF;
    ws.getCell(`H${r}`).numFmt = DATE;
    ws.getCell(`K${r}`).numFmt = MONEY2;
    ws.getCell(`M${r}`).numFmt = PCT1;
    ws.getCell(`O${r}`).numFmt = MONEY2;
    f(ws, `J${r}`, `IF(OR(H${r}="",I${r}=""),"",EDATE(H${r},I${r}))`, '', DATE, { align: 'center' });
    f(ws, `P${r}`, nerExcel(r), '', MONEY2, { align: 'right' });
    ws.getCell(`L${r}`).dataValidation = {
      type: 'list', allowBlank: true, formulae: ['"NNN,NN,N,Full Service,Modified Gross,Gross,Absolute Net"'],
    };
  }

  const sr = ex + 22;
  band(ws, sr, span, 'SURVEY');
  [['Average base rent', 'AVERAGE', 'K'], ['Median base rent', 'MEDIAN', 'K'],
    ['Average net effective', 'AVERAGE', 'P'], ['SF-weighted base rent', 'W', 'K']].forEach(([name, mode, L], i) => {
    const r = sr + 1 + i;
    label(ws, `A${r}`, name);
    ws.mergeCells(r, 1, r, 6);
    const rng = `${L}$${ex + 1}:${L}$${ex + 20}`;
    const formula = mode === 'W'
      ? `IFERROR(SUMPRODUCT(--ISNUMBER(${rng}),--ISNUMBER(G$${ex + 1}:G$${ex + 20}),${rng},G$${ex + 1}:G$${ex + 20})/SUMPRODUCT(--ISNUMBER(${rng}),--ISNUMBER(G$${ex + 1}:G$${ex + 20}),G$${ex + 1}:G$${ex + 20}),"")`
      : `IFERROR(${mode}(${rng}),"")`;
    f(ws, `G${r}`, formula, '', MONEY2, { align: 'right', bold: true });
  });

  note(ws, `A${sr + 6}`,
    'Net effective rent: the base rent over the full term, with each escalation compounding at the lease anniversary, '
    + 'less the free months at the rent then in force and the TI allowance, divided by the term in years. There is no '
    + 'commission column, so it is net of free rent and TI only, and not discounted to a present value (the Tools give '
    + 'both). Compare like with like: a full-service rent is not a NNN rent until operating expenses are netted out of it.', span);
  return ws;
}

/* ---------------------------------------------- zoning, audit trail, notes */

function zoningTab(wb, g) {
  const ws = sheet(wb, 'Zoning Catalogue', [26, 12, 70], 'FF7F7F7F');
  title(ws, 1, 3, 'ZONING CATALOGUE',
    'Max FAR by zoning code, feeding the Buildable SF and $/Buildable SF columns on both comp grids.');
  headerRow(ws, 3, ['ZONE', 'MAX FAR', 'Note'], 3);
  g.zones.forEach(({ code, far, note: why }, i) => {
    const r = g.zfirst + i;
    v(ws, `A${r}`, code, null, { input: true });
    v(ws, `B${r}`, far, FAR_FMT, { input: true, align: 'center' });
    if (why) label(ws, `C${r}`, why, { size: 8, color: GREY });
    else if (far === null) label(ws, `C${r}`, 'no max FAR recorded -- buildable SF is left blank for this code', { size: 8, color: GREY });
  });
  note(ws, `A${g.zlast + 2}`,
    'District of Columbia codes, plus any Montgomery County code in this comp set, whose name states its own maximum FAR. '
    + 'A comp zoned elsewhere (Prince George\'s County, Arlington, Alexandria, Baltimore) is flagged and its buildable SF left '
    + 'blank rather than borrowing a District FAR. Add a code and its max FAR here and both grids pick it up.', 3);
  return ws;
}

const AUDIT_COLS = [
  ['#', 4], ['Comp', 26], ['Set', 10], ['Status', 14], ['Source PDF', 24], ['CoStar ID', 10],
  ['Occupancy Basis', 13], ['CoStar printed $/SF', 13], ['Workbook $/SF', 12],
  ['Variance', 10], ['Check', 22], ['Notes on the check', 40],
];

function auditTab(wb, g, sales, market, meta) {
  const ws = sheet(wb, 'Audit Trail', AUDIT_COLS.map(([, w]) => w), 'FFC00000');
  const span = AUDIT_COLS.length;
  title(ws, 1, span, 'AUDIT TRAIL',
    'Where each comp came from, and the workbook\'s own $/SF checked against the figure CoStar printed.');
  headerRow(ws, 3, AUDIT_COLS.map(([t]) => t), span);
  ws.views = [{ showGridLines: false, state: 'frozen', xSplit: 2, ySplit: 3 }];

  const all = [
    ...sales.map((c, i) => ({ c, set: 'Sale', tab: 'Sale Comps', row: g.first + i, n: i + 1 })),
    ...market.map((c, i) => ({ c, set: 'On Market', tab: 'On Market Comps', row: g.first + i, n: i + 1 })),
  ];
  let r = 4;
  for (const { c, set, tab, row, n } of all) {
    const ppsf = ppsfOf(c);
    const printed = c.partial ? null : num(c.costar_ppsf);
    v(ws, `A${r}`, n, null, { align: 'center', color: GREY });
    v(ws, `B${r}`, c.name);
    v(ws, `C${r}`, set, null, { align: 'center' });
    v(ws, `D${r}`, set === 'Sale' ? 'Sold' : statusOf(c), null, { align: 'center' });
    v(ws, `E${r}`, c.source, null, { size: 8, color: GREY });
    v(ws, `F${r}`, num(c.comp_id), '0', { align: 'center' });
    v(ws, `G${r}`, c.occ_basis || '—', null, { align: 'center' });
    v(ws, `H${r}`, printed, MONEY2, { align: 'right' });
    f(ws, `I${r}`, `IFERROR('${tab}'!M${row},"")`, ppsf, MONEY2, { align: 'right' });
    f(ws, `J${r}`, `IF(OR(H${r}="",I${r}=""),"",I${r}-H${r})`, printed !== null && ppsf !== null ? ppsf - printed : '', MONEY2, { align: 'right' });
    const ok = printed !== null && ppsf !== null && Math.abs(ppsf - printed) <= Math.max(0.5, printed * 0.001);
    const alt = (c.costar_ppsf_alt || []).some((a) => ppsf !== null && Math.abs(ppsf - a) <= 0.02);
    f(ws, `K${r}`, `IF(H${r}="","no printed $/SF",IF(ABS(J${r})<=MAX(0.5,H${r}*0.001),"match","REVIEW"))`,
      printed === null ? 'no printed $/SF' : (ok ? 'match' : 'REVIEW'), null,
      { align: 'center', bold: !ok && printed !== null, color: printed !== null && !ok ? 'FFC00000' : 'FF000000' });
    let why = '';
    if (c.partial) why = "partial-interest sale: CoStar grosses its printed $/SF up to a 100% ownership basis, so it is not comparable to the price actually paid";
    else if (printed === null) why = 'CoStar did not print a $/SF for this comp';
    else if (!ok && alt) why = "matches the $/SF CoStar prints against the listing's own building size rather than its headline figure";
    v(ws, `L${r}`, why || null, null, { wrap: true, size: 8, color: GREY });
    ws.getRow(r).height = 24;
    r++;
  }

  r += 1;
  band(ws, r, span, 'FLAGS AND DERIVED FIGURES — every judgement the loader made, named');
  r += 1;
  headerRow(ws, r, ['#', 'Comp', 'Set', 'Flag'], span);
  r += 1;
  let any = false;
  for (const { c, set, n } of all) {
    for (const flag of c.flags || []) {
      v(ws, `A${r}`, n, null, { align: 'center', color: GREY });
      v(ws, `B${r}`, c.name);
      v(ws, `C${r}`, set, null, { align: 'center' });
      const cell = ws.getCell(`D${r}`);
      cell.value = flag;
      cell.font = { name: FONT, size: 8.5 };
      cell.alignment = { wrapText: true, vertical: 'top' };
      ws.mergeCells(r, 4, r, span);
      ws.getRow(r).height = 22;
      r++;
      any = true;
    }
  }
  if (!any) label(ws, `A${r}`, 'No flags — every comp read cleanly.', { italic: true, color: GREY });

  r += 2;
  band(ws, r, span, 'HOW THIS FILE WAS BUILT');
  const prov = [
    `Source reports: ${meta.sources.join(', ') || '—'}`,
    `Comps written: ${sales.length} sale, ${market.length} on-market`,
    ...(meta.manual ? [`${meta.manual} comp${meta.manual === 1 ? ' was' : 's were'} entered or changed by hand in the loader; see each comp's flags.`] : []),
    'Parsed in the browser from the CoStar PDFs. Nothing was uploaded to a server — the PDFs never left this device.',
    'Ordering: high to low $/SF, computed from each comp\'s own price and building size rather than CoStar\'s printed figure, '
    + 'so the order matches what this workbook calculates.',
    'Unpriced listings are kept and excluded from every weighted figure, so they cannot drag an average down.',
    `Built ${meta.stamp} by ${meta.app}.`,
  ];
  prov.forEach((t, i) => {
    const rr = r + 1 + i;
    label(ws, `A${rr}`, t, { size: 8.5, wrap: true });
    ws.mergeCells(rr, 1, rr, span);
    ws.getRow(rr).height = 14;
  });
  return ws;
}

function notesTab(wb, sales, market) {
  const ws = sheet(wb, 'CoStar Notes', [4, 26, 10, 22, 150], 'FF7F7F7F');
  title(ws, 1, 5, 'COSTAR NOTES',
    'The full transaction, sale, listing and property notes behind each comp, as CoStar printed them.');
  headerRow(ws, 3, ['#', 'Comp', 'Set', 'Source PDF', 'Notes'], 5);
  ws.views = [{ showGridLines: false, state: 'frozen', xSplit: 2, ySplit: 3 }];
  let r = 4;
  const all = [...sales.map((c, i) => [c, 'Sale', i + 1]), ...market.map((c, i) => [c, 'On Market', i + 1])];
  for (const [c, set, n] of all) {
    v(ws, `A${r}`, n, null, { align: 'center', color: GREY });
    v(ws, `B${r}`, c.name, null, { wrap: true });
    v(ws, `C${r}`, set, null, { align: 'center' });
    v(ws, `D${r}`, c.source, null, { size: 8, color: GREY, wrap: true });
    v(ws, `E${r}`, c.costar_notes || '(no notes printed)', null, { wrap: true, size: 8.5 });
    ws.getRow(r).height = Math.min(220, Math.max(28, Math.ceil((c.costar_notes || '').length / 150) * 11));
    r++;
  }
  return ws;
}


/* ------------------------------------------------------------ deal analysis */

/* One property, worked through from its offering memorandum: the OM's own
 * figures as inputs (blue, with the page each came from), the pricing and
 * financing arithmetic as live formulas, a ladder of values across cap rates,
 * and the comps for context. Change the price or the loan terms and every
 * figure follows. Cached values come from deal.js, the same arithmetic the
 * app shows on screen. */
const DEAL_W = [36, 17, 15, 15, 15, 30];

function dealTab(wb, deal, m, comps, meta) {
  const ws = sheet(wb, 'Deal Analysis', DEAL_W, 'FF0F766E');
  const d = deal.figures;
  const name = deal.name || d.address || 'Subject property';
  title(ws, 1, 6, `Deal Analysis — ${name}`,
    `${deal.source ? `From ${deal.source}` : 'Entered by hand'}${deal.readAt ? `, read ${new Date(deal.readAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}` : ''}. `
    + 'Blue figures are inputs: change any of them and the analysis follows. Figures marked "derived" were worked out from the others, not printed in the OM.');
  const src = (k) => {
    const f = deal.sources && deal.sources[k];
    if (m.derived[k]) return 'derived';
    return f && f.page ? `OM p. ${f.page}` : (f && f.hand ? 'entered by hand' : '');
  };
  const input = (r, text, key, value, fmt) => {
    label(ws, `A${r}`, text);
    v(ws, `B${r}`, value, fmt, { input: true, align: 'right' });
    label(ws, `C${r}`, src(key), { color: GREY, size: 8 });
  };
  const out = (r, text, formula, result, fmt, opts = {}) => {
    label(ws, `A${r}`, text, { bold: !!opts.bold });
    f(ws, `B${r}`, formula, result, fmt, { align: 'right', bold: !!opts.bold });
    if (opts.note) label(ws, `C${r}`, opts.note, { color: GREY, size: 8 });
  };
  const n = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const pc = (x) => (n(x) === null ? null : x / 100);

  band(ws, 4, 6, 'THE OFFERING');
  input(5, 'Asking price', 'price', n(m.price), MONEY);
  input(6, 'Net operating income (in place)', 'noi', n(m.noi), MONEY);
  input(7, 'Cap rate stated in the OM', 'cap', pc(d.cap), PCT2);
  input(8, 'Building SF', 'bsf', n(d.bsf), SF);
  input(9, 'Land SF', 'lot_sf', n(d.lot_sf), SF);
  input(10, 'Units', 'units', n(d.units), SF);
  input(11, 'Gross income (EGI)', 'gross', n(d.gross), MONEY);
  input(12, 'Operating expenses', 'opex', n(d.opex), MONEY);
  input(13, 'Real estate taxes', 'taxes', n(d.taxes), MONEY);
  input(14, 'Occupancy', 'occ', pc(m.occ), OCC);
  if (m.occSource === 'rent roll') label(ws, 'C14', 'from the rent roll', { color: GREY, size: 8 });
  input(15, 'Year built', 'year', n(d.year), '0');
  input(16, 'Gross potential rent', 'gpr', n(d.gpr), MONEY);

  band(ws, 17, 6, 'PRICING');
  out(18, 'Cap rate on asking price', 'IFERROR(IF(OR(B5="",B6=""),"",B6/B5),"")', pc(m.capCalc), PCT2, { bold: true });
  out(19, 'Price per building SF', rate('B5', 'B8'), m.ppsf, MONEY2);
  out(20, 'Price per unit', rate('B5', 'B10'), m.perUnit, MONEY);
  out(21, 'Price per land SF', rate('B5', 'B9'), m.perLandSf, MONEY2);
  out(22, 'NOI per SF', rate('B6', 'B8'), m.noiPsf, MONEY2);
  out(23, 'Price ÷ gross income', rate('B5', 'B11'), m.grossMultiple, '0.00"x";;"-"');
  out(24, 'Expense ratio', rate('B12', 'B11'), pc(m.expenseRatio), PCT1);
  out(25, 'Taxes per SF', rate('B13', 'B8'), m.taxPsf, MONEY2);

  const L = deal.loan || {};
  band(ws, 27, 6, 'FINANCING');
  const lin = (r, text, value, fmt) => { label(ws, `A${r}`, text); v(ws, `B${r}`, value, fmt, { input: true, align: 'right' }); };
  lin(28, 'Loan to value', pc(L.ltv), PCT1);
  lin(29, 'Interest rate', pc(L.rate), PCT2);
  lin(30, 'Amortization (years)', n(L.amort), '0');
  lin(31, 'Interest only', L.io ? 'Yes' : 'No', null);
  ws.getCell('B31').dataValidation = { type: 'list', allowBlank: false, formulae: ['"Yes,No"'] };
  lin(32, 'Closing costs (% of price)', pc(L.closing) ?? 0, PCT1);
  // monthly payments over whole months (engine/debt.js)
  const ds = 'IF(B33="","",IF(B31="Yes",B33*B29,-PMT(B29/12,ROUND(B30*12,0),B33)*12))';
  out(33, 'Loan amount', 'IF(OR(B5="",B28=""),"",B5*B28)', m.loan, MONEY);
  out(34, 'Annual debt service', `IFERROR(${ds},"")`, m.debtService, MONEY);
  out(35, 'Debt-service coverage (DSCR)', rate('B6', 'B34'), m.dscr, '0.00"x";;"-"', { bold: true });
  out(36, 'Debt yield', rate('B6', 'B33'), pc(m.debtYield), PCT2);
  out(37, 'Cash flow after debt service', 'IF(OR(B6="",B34=""),"",B6-B34)', m.cashFlow, MONEY);
  out(38, 'Equity, with closing costs', 'IF(B5="","",B5-N(B33)+B5*N(B32))', m.equity, MONEY);
  out(39, 'Cash-on-cash return', rate('B37', 'B38'), pc(m.cashOnCash), PCT2, { bold: true });
  // the same three bases as deal.js: over gross potential rent when the OM gives it,
  // else gross income scaled to its occupancy, else a share of current income
  out(40, 'Break-even occupancy', 'IFERROR(IF(OR(B12="",B34=""),"",IF(N(B16)>0,(B12+B34)/B16,IF(N(B11)<=0,"",IF(N(B14)>0,(B12+B34)/B11*B14,(B12+B34)/B11)))),"")', pc(m.breakEven), PCT1,
    { note: 'expenses plus debt service over gross potential rent; without it, over gross income scaled by occupancy' });

  band(ws, 42, 6, 'LOAN SIZING — THE LARGEST LOAN THE PROPERTY SUPPORTS');
  lin(43, 'Minimum DSCR', n(L.minDscr), '0.00"x"');
  lin(44, 'Minimum debt yield', pc(L.minDy), PCT1);
  const k = 'IF(B31="Yes",B29,-PMT(B29/12,ROUND(B30*12,0),1)*12)';
  const T = m.maxLoan ? m.maxLoan.tests : {};
  out(45, 'Loan at the LTV', 'IF(OR(B5="",B28=""),"",B5*B28)', T.LTV ?? null, MONEY);
  out(46, 'Loan at the minimum DSCR', `IFERROR(IF(OR(B6="",B43=""),"",B6/B43/(${k})),"")`, T.DSCR ?? null, MONEY);
  out(47, 'Loan at the minimum debt yield', rate('B6', 'B44'), T['Debt yield'] ?? null, MONEY);
  out(48, 'Maximum loan', agg('MIN', 'B45:B47'), m.maxLoan ? m.maxLoan.loan : null, MONEY, { bold: true });
  out(49, 'Price that loan supports at the LTV', rate('B48', 'B28'), m.maxLoan && pc(L.ltv) ? m.maxLoan.loan / pc(L.ltv) : null, MONEY);

  band(ws, 51, 6, 'VALUE ACROSS CAP RATES');
  headerRow(ws, 52, ['Cap rate', 'Value', '$/SF', 'Against asking'], 6);
  const ladder = m.ladder.length ? m.ladder : [];
  ladder.forEach((x, i) => {
    const r = 53 + i;
    v(ws, `A${r}`, x.cap / 100, PCT2, { input: true, align: 'left' });
    f(ws, `B${r}`, `IFERROR(IF(OR($B$6="",A${r}=""),"",$B$6/A${r}),"")`, x.value, MONEY, { align: 'right', bold: Math.abs(x.cap - (m.cap ?? 0)) < 0.13 });
    f(ws, `C${r}`, rate(`B${r}`, '$B$8'), x.ppsf, MONEY2, { align: 'right' });
    f(ws, `D${r}`, `IFERROR(IF(OR(B${r}="",$B$5=""),"",B${r}/$B$5-1),"")`, pc(x.vsAsk), PCT_ADJ, { align: 'right' });
  });
  let r = 53 + Math.max(ladder.length, 1) + 1;

  if (comps && comps.n) {
    band(ws, r, 6, 'AGAINST THE SALE COMPS');
    note(ws, `A${r + 1}`, `From the ${comps.n} priced sale comps in this comp set when the file was made. They are fixed figures here; the comp tabs hold the comps themselves.`, 6);
    const row0 = r + 2;
    lin(row0, 'Comps: SF-weighted $/SF', comps.weighted, MONEY2);
    lin(row0 + 1, 'Comps: median $/SF', comps.median, MONEY2);
    lin(row0 + 2, 'Comps: median cap rate', pc(comps.medianCap), PCT2);
    out(row0 + 3, 'Asking $/SF against the weighted comps', `IFERROR(IF(OR(B19="",B${row0}=""),"",B19/B${row0}-1),"")`, pc(m.vsWeighted), PCT_ADJ, { bold: true });
    out(row0 + 4, 'Value at the weighted comp $/SF', prod('B8', `B${row0}`), m.valueAtWeighted ?? null, MONEY);
    out(row0 + 5, 'Value at the median comp cap rate', rate('B6', `B${row0 + 2}`), m.valueAtMedianCap ?? null, MONEY);
    r = row0 + 7;
  }

  const lists = [
    ['WHAT DOESN\'T ADD UP', m.checks.map((c) => c.text)],
    ['QUESTIONS TO ASK', (deal.questions || m.questions)],
    ['SITE VISIT NOTES', deal.visitLines || []],
    ['SCENARIOS — ASSUMPTIONS FROM THE APP, NOT THE OM\'S FIGURES (FIXED VALUES)', deal.scenarioLines || []],
  ];
  for (const [head, items] of lists) {
    if (!items.length) continue;
    band(ws, r, 6, head);
    r += 1;
    for (const t of items) { note(ws, `A${r}`, `•  ${t}`, 6); ws.getCell(`A${r}`).font = { name: FONT, size: 9, color: { argb: 'FF000000' } }; r += 1; }
    r += 1;
  }
  ws.views = [{ showGridLines: false, state: 'frozen', ySplit: 3 }];
  return ws;
}

function rentRollTab(wb, rows, asOf) {
  const ws = sheet(wb, 'Rent Roll', [32, 10, 11, 12, 12, 14, 11, 11, 10], 'FF0F766E');
  title(ws, 1, 9, 'Rent Roll', 'As read from the offering memorandum. Check it against the leases; blue figures are inputs.');
  label(ws, 'A3', 'As of');
  v(ws, 'B3', S.serial(asOf), DATE, { input: true });
  headerRow(ws, 5, ['Tenant', 'Suite', 'SF', 'Lease start', 'Lease end', 'Annual rent', 'Rent / SF', 'Years left', 'Status']);
  const first = 6;
  const years = (e) => (e ? Math.max(0, (S.serial(new Date(e)) - S.serial(asOf)) / 365.25) : null);
  rows.forEach((x, i) => {
    const r = first + i;
    v(ws, `A${r}`, x.tenant || '', null, { input: true });
    v(ws, `B${r}`, x.suite || '', null, { input: true });
    v(ws, `C${r}`, x.sf ?? null, SF, { input: true });
    v(ws, `D${r}`, x.start ? S.serial(new Date(x.start)) : null, DATE, { input: true });
    v(ws, `E${r}`, x.end ? S.serial(new Date(x.end)) : null, DATE, { input: true });
    v(ws, `F${r}`, x.vacant ? null : (x.annual ?? null), MONEY, { input: true });
    f(ws, `G${r}`, rate(`F${r}`, `C${r}`), !x.vacant && x.annual && x.sf ? x.annual / x.sf : null, MONEY2, { align: 'right' });
    f(ws, `H${r}`, `IF(E${r}="","",MAX(0,(E${r}-$B$3)/365.25))`, x.vacant ? null : years(x.end), NUM1, { align: 'right' });
    v(ws, `I${r}`, x.vacant ? 'Vacant' : 'Leased', null, { input: true });
  });
  const last = first + rows.length - 1;
  const tr = last + 2;
  const leased = rows.filter((x) => !x.vacant);
  const sfAll = rows.reduce((s, x) => s + (x.sf || 0), 0);
  const sfLeased = leased.reduce((s, x) => s + (x.sf || 0), 0);
  const rent = leased.reduce((s, x) => s + (x.annual || 0), 0);
  const datedRent = leased.filter((x) => x.end).reduce((s, x) => s + (x.annual || 0), 0);
  const walt = datedRent ? leased.filter((x) => x.end).reduce((s, x) => s + (x.annual || 0) * years(x.end), 0) / datedRent : null;
  const C = `C${first}:C${last}`; const F = `F${first}:F${last}`; const H = `H${first}:H${last}`; const I = `I${first}:I${last}`;
  label(ws, `A${tr}`, 'Total', { bold: true });
  f(ws, `C${tr}`, `SUM(${C})`, sfAll, SF, { bold: true, align: 'right' });
  f(ws, `F${tr}`, `SUM(${F})`, rent, MONEY, { bold: true, align: 'right' });
  f(ws, `G${tr}`, rate(`F${tr}`, `C${tr + 1}`), sfLeased && rent ? rent / sfLeased : null, MONEY2, { align: 'right', bold: true });
  label(ws, `A${tr + 1}`, 'Leased SF');
  f(ws, `C${tr + 1}`, `SUMIF(${I},"Leased",${C})`, sfLeased, SF, { align: 'right' });
  label(ws, `A${tr + 2}`, 'Occupancy by SF');
  f(ws, `C${tr + 2}`, rate(`C${tr + 1}`, `C${tr}`), sfAll ? sfLeased / sfAll : null, OCC, { align: 'right' });
  label(ws, `A${tr + 3}`, 'WALT by income (years)', { bold: true });
  f(ws, `C${tr + 3}`, `IFERROR(SUMPRODUCT(${F},${H})/SUMIF(${H},">=0",${F}),"")`, walt, NUM1, { align: 'right', bold: true });
  ws.views = [{ showGridLines: false, state: 'frozen', ySplit: 5 }];
}

/** A workbook holding just the deal: its analysis and its rent roll. */
export async function buildDealWorkbook(ExcelJS, fflate, { deal, metrics, comps, app = 'Zlatura' }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = app;
  wb.lastModifiedBy = app;
  wb.created = new Date();
  wb.modified = new Date();
  wb.calcProperties = { fullCalcOnLoad: true };
  addDeal(wb, deal, metrics, comps);
  wb.views = [{ activeTab: 0, firstSheet: 0, visibility: 'visible' }];
  return cleanPackage(fflate, await wb.xlsx.writeBuffer(), { charts: null });
}

function addDeal(wb, deal, metrics, comps) {
  const now = new Date();
  const asOf = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  dealTab(wb, deal, metrics, comps, {});
  // the full rent roll (lease schedules, cash flow) when the deal has one; else the OM's table
  if (deal.rr && deal.rr.leases && deal.rr.leases.length) { addRentRollTabs(wb, deal, deal.rr); return; }
  const rows = deal.figures.rentRoll || [];
  if (rows.length) rentRollTab(wb, rows, asOf);
}

/* ------------------------------------------------------------- entry point */

/** The order every grid uses: high to low $/SF, unpriced last, then freshest. */
export function byPpsf(a, b) {
  const pa = ppsfOf(a);
  const pb = ppsfOf(b);
  return (Number(pa === null) - Number(pb === null)) || ((pb || 0) - (pa || 0)) || ((a.dom || 0) - (b.dom || 0));
}

/** Build the workbook and return it as bytes ready to download. */
export async function buildWorkbook(ExcelJS, fflate, {
  sales, market, subject = {}, label: setLabel, sources = [], app = 'Zlatura', preparedBy = '', manual = 0,
  deal = null,
}) {
  // the order is the rule, whatever order the comps arrive in
  sales = [...sales].sort(byPpsf);
  market = [...market].sort(byPpsf);

  const wb = new ExcelJS.Workbook();
  wb.creator = app;
  wb.lastModifiedBy = app;
  wb.created = new Date();
  wb.modified = new Date();
  wb.calcProperties = { fullCalcOnLoad: true };

  const now = new Date();
  const meta = {
    label: setLabel || 'Comp set',
    stamp: now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
    todaySerial: S.serial(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))),
    year: now.getFullYear(),
    sources,
    app,
    preparedBy: String(preparedBy || '').trim(),
    manual,
  };

  const g = geometry(sales, market, subject);
  const trend = trendRate(sales);
  const A = adjustedPpsf(sales, meta, trend);

  summaryTab(wb, g, sales, market, subject, meta, trend, A);
  // an OM analysed on the Deal screen travels with the comps it was judged against
  if (deal) addDeal(wb, deal.deal, deal.metrics, deal.comps);
  chartsTab(wb, sales, market, meta);
  compGrid(wb, g, 'Sale Comps', SALE_COLS, sales, 'sale', 'FF1F3864', meta);
  compGrid(wb, g, 'On Market Comps', MKT_COLS, market, 'market', 'FFEB6834', meta);
  adjustmentTab(wb, g, sales, subject, meta, trend, A);
  leaseTab(wb, meta);
  zoningTab(wb, g);
  auditTab(wb, g, sales, market, meta);
  notesTab(wb, sales, market);

  wb.views = [{ activeTab: 0, firstSheet: 0, visibility: 'visible' }];
  const charts = chartSpecs(g, sales, market);
  return cleanPackage(fflate, await wb.xlsx.writeBuffer(), {
    charts: charts.length ? { sheet: 'Charts', parts: chartParts(charts) } : null,
  });
}

/** What goes on the Charts tab, with the cell ranges each chart reads. */
function chartSpecs(g, sales, market) {
  const specs = [];
  let row = 3;                                   // zero-based: the first chart starts on row 4
  const bars = (heading, tab, comps, color) => {
    const n = comps.length;
    const end = g.first + n - 1;
    const height = Math.max(14, Math.ceil(n * 1.4) + 6);
    specs.push({
      type: 'bar', title: heading, color,
      cat: { ref: `'${tab}'!$B$${g.first}:$B$${end}`, values: comps.map((c) => c.name) },
      val: { ref: `'${tab}'!$M$${g.first}:$M$${end}`, values: comps.map(ppsfOf), format: '$#,##0' },
      from: { col: 0, row }, to: { col: 12, row: row + height },
    });
    row += height + 2;
  };
  if (sales.length) bars('Sale comps — $/SF, high to low', 'Sale Comps', sales, '2A78D6');
  const dated = sales.filter((c) => c.date && ppsfOf(c) !== null).length;
  if (dated >= 2) {
    const end = g.first + sales.length - 1;
    specs.push({
      type: 'scatter', title: 'Sale $/SF over time, with a linear trend', color: '2A78D6',
      x: { ref: `'Sale Comps'!$I$${g.first}:$I$${end}`, values: sales.map((c) => (c.date ? S.serial(new Date(c.date)) : null)), format: 'mmm yyyy' },
      y: { ref: `'Sale Comps'!$M$${g.first}:$M$${end}`, values: sales.map(ppsfOf), format: '$#,##0' },
      from: { col: 0, row }, to: { col: 12, row: row + 20 },
    });
    row += 22;
  }
  if (market.length) bars('On market — asking $/SF, high to low', 'On Market Comps', market, 'EB6834');
  return specs;
}

/* The helpers other workbook builders share (rrbook.js, the template report). */
export const XL = { sheet, title, band, headerRow, f, v, label, note, rate, prod, agg, MONEY, MONEY2, SF, PCT1, PCT2, DATE, NUM1, OCC, GREY, FONT };
