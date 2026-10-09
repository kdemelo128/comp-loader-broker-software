/* template.js -- fill a workbook the broker already uses.
 *
 * A firm's comp template is a designed object: its fonts, colours, logo,
 * column widths, formulas, charts and print setup are the point of it.
 * Loading it into a spreadsheet library and saving it again loses some of
 * that (ExcelJS, for one, drops charts). So this module never rebuilds the
 * file. It opens the .xlsx package, changes the text of the cells the comps
 * go in, and leaves every other byte of every other part exactly as it was.
 *
 * Steps:
 *   inspectTemplate()  finds each sheet's header row and maps its columns to
 *                      comp fields by their wording ("Sale Price", "Price",
 *                      "Asking Price"...), and guesses which sheet takes sales
 *                      and which takes listings.
 *   fillTemplate()     writes the comps under the headers, one row each:
 *                      numbers as numbers, dates as dates, text as text, in
 *                      the cell's own style. Cells holding formulas are left
 *                      alone, so a template's own $/SF or average formulas
 *                      keep working. Excel recalculates on opening.
 *
 * XML is handled through DOMParser/XMLSerializer, injected so the tests can
 * run it outside a browser. */

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const ppsf = (c) => (num(c.price) && num(c.bsf) ? c.price / c.bsf : null);

const statusOf = (c) => {
  if (c.kind === 'sale') return 'Sold';
  const p = (c.flags || []).find((f) => f.startsWith('status is '));
  const m = p && /^status is ([A-Za-z ]+?),/.exec(p);
  return m ? m[1] : 'Active';
};
const fullAddress = (c) => [c.address || c.name, [c.city, [c.state, c.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')]
  .filter(Boolean).join(', ');

/* What a column can hold. `re` is tried against the header in lower case
 * with its whitespace collapsed; the first field to match a header takes it,
 * so the specific forms come before the general ones. `type` decides how a
 * value is written: money, money2 ($/SF), int, dec, pct, date, text. */
export const TEMPLATE_FIELDS = [
  { key: 'ppsf_land', label: '$/land SF', type: 'money2', re: /(\$|price)\s*(\/|per)\s*(land|lot)\s*(sf|sq)|land\s*\$\s*\/\s*sf/, get: (c) => (num(c.price) && num(c.lot_sf) ? c.price / c.lot_sf : null) },
  { key: 'ppac', label: '$/acre', type: 'money', re: /(\$|price)\s*(\/|per)\s*(lot\s*|land\s*)?(ac|acre)\b/, get: (c) => (num(c.price) && num(c.lot_sf) ? c.price / (c.lot_sf / 43560) : null) },
  { key: 'ppbldbl', label: '$/buildable SF', type: 'money2', re: /(\$|price)\s*(\/|per)\s*buildable/, get: (c) => (num(c.price) && num(c.lot_sf) && num(c.max_far) ? c.price / (c.lot_sf * c.max_far) : null) },
  { key: 'ppsf', label: '$/SF', type: 'money2', re: /(\$|price|sale|asking)\s*\/\s*(sf|sq|rsf)|(price|\$)\s*per\s*(building\s*)?(sf|sq|square)|\bpsf\b|\bppsf\b/, get: ppsf },
  { key: 'city_state', label: 'City, state', type: 'text', re: /^city,?\s*(and\s*|&\s*)?state$/, get: (c) => [c.city, c.state].filter(Boolean).join(', ') || null },
  { key: 'full_address', label: 'Full address', type: 'text', re: /^full address|^location$|^address,? city/, get: fullAddress },
  { key: 'address', label: 'Address', type: 'text', re: /address|^street/, get: (c) => c.address || null },
  { key: 'name', label: 'Property name', type: 'text', re: /^(property|building|comp|project)?\s*name$|^property$|^comp(arable)?$|^building$/, get: (c) => c.name },
  { key: 'city', label: 'City', type: 'text', re: /^city|municipality|^town$/, get: (c) => c.city || null },
  { key: 'state', label: 'State', type: 'text', re: /^state$|^st$/, get: (c) => c.state || null },
  { key: 'zip', label: 'ZIP', type: 'text', re: /^zip|postal/, get: (c) => (c.zip ? String(c.zip).padStart(5, '0') : null) },
  { key: 'submarket', label: 'Submarket', type: 'text', re: /submarket|neighbou?rhood|^market$/, get: (c) => c.submarket || null },
  { key: 'zoning', label: 'Zoning', type: 'text', re: /zoning|^zone$/, get: (c) => c.zoning || null },
  { key: 'dom', label: 'Days on market', type: 'int', re: /days on (the )?m(ar)?k(e)?t|^dom$/, get: (c) => num(c.dom) },
  { key: 'date', label: 'Sale date', type: 'date', re: /(sale|sold|closing|close|transaction|recorded)\s*date|^date( sold)?$/, get: (c) => (c.date ? new Date(c.date) : null) },
  { key: 'status', label: 'Status', type: 'text', re: /^status|^listing status/, get: statusOf },
  { key: 'lot_ac', label: 'Lot size (acres)', type: 'dec', re: /(lot|land|site).*\b(ac|acres?)\b|^acres?$|^acreage$/, get: (c) => (num(c.lot_ac) ?? (num(c.lot_sf) ? c.lot_sf / 43560 : null)) },
  { key: 'lot_sf', label: 'Lot size (SF)', type: 'int', re: /(lot|land|site)\s*(size|area)?\s*(\(?sf|sq)|^(lot|land|site)\s*(size|area)?$/, get: (c) => num(c.lot_sf) },
  { key: 'buildable', label: 'Buildable SF', type: 'int', re: /buildable/, get: (c) => (num(c.lot_sf) && num(c.max_far) ? c.lot_sf * c.max_far : null) },
  { key: 'far', label: 'FAR', type: 'dec', re: /\bfar\b|floor area ratio/, get: (c) => num(c.far) },
  { key: 'price', label: 'Price', type: 'money', re: /^(?!.*(\bper\b|\/)).*\b(price|consideration)\b|^amount$/, get: (c) => num(c.price) },
  { key: 'bsf', label: 'Building SF', type: 'int', re: /building\s*(sf|size|area|sq)|bldg|^rba$|^gba$|^nra$|^gla$|^rsf$|^sf$|^size$|square f(ee|oo)t|^sq\.? ?ft/, get: (c) => num(c.bsf) },
  { key: 'cap', label: 'Cap rate', type: 'pct', re: /cap(italization)?\s*rate|^cap$/, get: (c) => num(c.cap) },
  { key: 'occ', label: 'Occupancy', type: 'pct', re: /occupan|^%?\s*leased$|percent leased|^occ\b/, get: (c) => num(c.occ) },
  { key: 'comp_id', label: 'CoStar ID', type: 'int', re: /comp\s*(id|#|number)|costar\s*(id|#)|^id$/, get: (c) => num(c.comp_id) },
  { key: 'ptype', label: 'Property type', type: 'text', re: /(property|asset|building)\s*type|^type$|^use$/, get: (c) => c.ptype || null },
  { key: 'year', label: 'Year built', type: 'int', re: /year\s*built|^built$|yr\.?\s*built|^year$/, get: (c) => num(c.year) },
  { key: 'bclass', label: 'Building class', type: 'text', re: /class/, get: (c) => c.bclass || null },
  { key: 'buyer_broker', label: 'Buyer broker', type: 'text', re: /buyer'?s?\s*broker|procuring/, get: (c) => c.buyer_broker || null },
  { key: 'listing_broker', label: 'Listing broker', type: 'text', re: /list(ing)?\s*broker|seller'?s?\s*broker/, get: (c) => c.listing_broker || null },
  { key: 'buyer', label: 'Buyer', type: 'text', re: /buyer|purchaser|grantee/, get: (c) => c.buyer || null },
  { key: 'seller', label: 'Seller', type: 'text', re: /seller|grantor|vendor/, get: (c) => c.seller || null },
  { key: 'sale_type', label: 'Sale type', type: 'text', re: /sale\s*type|marketed to/, get: (c) => c.sale_type || null },
  { key: 'conditions', label: 'Sale conditions', type: 'text', re: /condition/, get: (c) => c.conditions || null },
  { key: 'hold', label: 'Hold period', type: 'text', re: /hold/, get: (c) => c.hold || null },
  { key: 'costar_notes', label: 'CoStar notes', type: 'text', re: /costar\s*notes?|description/, get: (c) => c.costar_notes || null },
  { key: 'notes', label: 'Notes', type: 'text', re: /notes?|comments?|remarks/, get: () => null },
  { key: 'source', label: 'Source', type: 'text', re: /^source/, get: (c) => c.source || null },
  { key: 'flags', label: 'Flags', type: 'text', re: /^flags?$/, get: (c) => ((c.flags || []).join('; ') || null) },
];
const FIELD = Object.fromEntries(TEMPLATE_FIELDS.map((f) => [f.key, f]));

const norm = (s) => String(s || '').toLowerCase().replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();

/** The comp field a header names, or null. */
export function fieldForHeader(text) {
  const h = norm(text);
  if (!h || h.length > 60) return null;
  for (const f of TEMPLATE_FIELDS) if (f.re.test(h)) return f.key;
  return null;
}

/* ------------------------------------------------------------- the package */

const colNum = (letters) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
export const colName = (n) => {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};
const splitRef = (ref) => {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)$/.exec(ref);
  return m ? { col: colNum(m[1]), row: Number(m[2]) } : null;
};

const dirOf = (p) => p.slice(0, p.lastIndexOf('/') + 1);
function resolve(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = (dirOf(base) + target).split('/');
  const out = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return out.join('/');
}
const relsPath = (p) => `${dirOf(p)}_rels/${p.slice(p.lastIndexOf('/') + 1)}.rels`;

class Package {
  constructor(fflate, bytes, xml) {
    this.fflate = fflate;
    this.xml = xml;
    try {
      this.files = fflate.unzipSync(bytes);
    } catch {
      throw new Error('That file is not an Excel workbook (.xlsx). Save the template as .xlsx and try again.');
    }
    if (!this.files['[Content_Types].xml'] || !this.files['xl/workbook.xml']) {
      throw new Error(this.files['xl/workbook.bin']
        ? 'That is an .xlsb workbook. Save the template as .xlsx and try again.'
        : 'That file is not an Excel workbook (.xlsx).');
    }
    this.docs = new Map();
  }

  has(p) { return !!this.files[p]; }

  doc(p) {
    if (!this.docs.has(p)) {
      const text = this.fflate.strFromU8(this.files[p]);
      const d = new this.xml.DOMParser().parseFromString(text, 'application/xml');
      if (d.getElementsByTagName('parsererror').length) throw new Error(`${p} could not be read.`);
      this.docs.set(p, d);
    }
    return this.docs.get(p);
  }

  dirty(p) { (this.changed ||= new Set()).add(p); }

  rels(p) {
    const rp = relsPath(p);
    if (!this.has(rp)) return [];
    return [...this.doc(rp).getElementsByTagNameNS(PKG_REL, 'Relationship')].map((r) => ({
      id: r.getAttribute('Id'), type: r.getAttribute('Type') || '', target: resolve(p, r.getAttribute('Target') || ''), node: r,
    }));
  }

  bytes() {
    const out = {};
    for (const [p, data] of Object.entries(this.files)) {
      if (this.removed && this.removed.has(p)) continue;
      if (this.changed && this.changed.has(p)) {
        let s = new this.xml.XMLSerializer().serializeToString(this.doc(p));
        if (!s.startsWith('<?xml')) s = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${s}`;
        out[p] = this.fflate.strToU8(s);
      } else out[p] = data;
    }
    return this.fflate.zipSync(out, { level: 6 });
  }
}

const kids = (node, name) => [...node.childNodes].filter((n) => n.nodeType === 1 && n.localName === name);
const kid = (node, name) => kids(node, name)[0] || null;

function sharedStrings(pkg) {
  const rel = pkg.rels('xl/workbook.xml').find((r) => r.type.endsWith('/sharedStrings'));
  if (!rel || !pkg.has(rel.target)) return [];
  return [...pkg.doc(rel.target).getElementsByTagNameNS(MAIN, 'si')].map((si) => [...si.getElementsByTagNameNS(MAIN, 't')].map((t) => t.textContent).join(''));
}

function cellText(c, sst) {
  const t = c.getAttribute('t');
  if (t === 's') { const v = kid(c, 'v'); return v ? sst[Number(v.textContent)] ?? '' : ''; }
  if (t === 'inlineStr') { const is = kid(c, 'is'); return is ? [...is.getElementsByTagNameNS(MAIN, 't')].map((x) => x.textContent).join('') : ''; }
  const v = kid(c, 'v');
  return v ? v.textContent : '';
}

function sheetsOf(pkg) {
  const wb = pkg.doc('xl/workbook.xml');
  const rels = new Map(pkg.rels('xl/workbook.xml').map((r) => [r.id, r]));
  return [...wb.getElementsByTagNameNS(MAIN, 'sheet')].map((s) => {
    const rel = rels.get(s.getAttributeNS(REL, 'id'));
    return { name: s.getAttribute('name'), path: rel ? rel.target : null, hidden: !!s.getAttribute('state') && s.getAttribute('state') !== 'visible' };
  }).filter((s) => s.path && pkg.has(s.path) && /\/worksheets\//.test(s.path));
}

/* --------------------------------------------------------------- inspect */

function guessRole(name, fields) {
  const n = norm(name);
  if (/lease|rent/.test(n) && !/sale/.test(n)) return 'skip';
  if (/on[ -]?market|listing|active|for sale|asking/.test(n)) return 'market';
  if (/sale|sold|closed/.test(n)) return 'sale';
  if (fields.includes('dom') || fields.includes('status')) return 'market';
  if (fields.includes('date')) return 'sale';
  return 'skip';
}

/**
 * Read a template's layout.
 * Returns { sheets: [{ name, path, role, headerRow, columns: [{ col, letter, header, field }] }] }.
 */
export function inspectTemplate(fflate, bytes, xml) {
  const pkg = new Package(fflate, bytes, xml);
  const sst = sharedStrings(pkg);
  const sheets = [];
  for (const s of sheetsOf(pkg)) {
    const doc = pkg.doc(s.path);
    const data = doc.getElementsByTagNameNS(MAIN, 'sheetData')[0];
    if (!data) continue;
    let best = null;
    for (const row of kids(data, 'row').slice(0, 40)) {
      const r = Number(row.getAttribute('r'));
      if (r > 40) break;
      const columns = [];
      for (const c of kids(row, 'c')) {
        const ref = splitRef(c.getAttribute('r') || '');
        if (!ref) continue;
        const text = cellText(c, sst).trim();
        if (!text || kid(c, 'f')) continue;
        columns.push({ col: ref.col, letter: colName(ref.col), header: text.replace(/\s+/g, ' '), field: fieldForHeader(text) });
      }
      const hits = columns.filter((c) => c.field).length;
      if (hits >= 3 && (!best || hits > best.hits)) best = { r, columns, hits };
    }
    if (!best) continue;
    // formulas in the row under the header mark a sheet that calculates rather than takes input
    const under = kids(data, 'row').find((r) => Number(r.getAttribute('r')) === best.r + 1);
    const formulaCols = under ? kids(under, 'c').filter((c) => kid(c, 'f')).length : 0;
    // a field named twice goes to the first column that names it
    const seen = new Set();
    for (const c of best.columns) {
      if (!c.field) continue;
      if (seen.has(c.field)) c.field = null; else seen.add(c.field);
    }
    sheets.push({
      name: s.name, path: s.path, hidden: s.hidden, headerRow: best.r, columns: best.columns, formulaCols,
      role: guessRole(s.name, best.columns.map((c) => c.field)),
    });
  }
  // one sale sheet and one listing sheet unless the person says otherwise
  // (the one with the most recognised columns, when a template has several)
  for (const role of ['sale', 'market']) {
    const score = (s) => s.columns.filter((c) => c.field).length - 2 * s.formulaCols
      + (/import|input|data|paste/i.test(s.name) ? 2 : 0) - (/output|summary|report|formula/i.test(s.name) ? 4 : 0);
    const list = sheets.filter((s) => s.role === role).sort((a, b) => score(b) - score(a));
    list.slice(1).forEach((s) => { s.role = 'skip'; });
  }
  return { sheets };
}

/* ------------------------------------------------------------------ styles */

const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
const BUILTIN_PCT = new Set([9, 10]);

class Styles {
  constructor(pkg) {
    this.pkg = pkg;
    const rel = pkg.rels('xl/workbook.xml').find((r) => r.type.endsWith('/styles'));
    this.path = rel && pkg.has(rel.target) ? rel.target : null;
    this.memo = new Map();
    if (!this.path) return;
    this.doc = pkg.doc(this.path);
    const ss = this.doc.documentElement;
    this.cellXfs = kid(ss, 'cellXfs');
    this.numFmts = kid(ss, 'numFmts');
    this.codes = new Map();
    if (this.numFmts) for (const f of kids(this.numFmts, 'numFmt')) this.codes.set(Number(f.getAttribute('numFmtId')), f.getAttribute('formatCode') || '');
  }

  xf(s) { return this.cellXfs ? kids(this.cellXfs, 'xf')[s] || null : null; }

  fmtOf(s) {
    const xf = this.xf(s);
    const id = xf ? Number(xf.getAttribute('numFmtId') || 0) : 0;
    return { id, code: this.codes ? this.codes.get(id) || '' : '' };
  }

  kind(s) {
    const { id, code } = this.fmtOf(s);
    if (BUILTIN_DATE.has(id)) return 'date';
    if (BUILTIN_PCT.has(id) || /%/.test(code)) return 'pct';
    // a custom code with day, month or year letters outside quotes and brackets is a date
    if (code && /[dmy]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, ''))) return 'date';
    return id === 0 ? 'general' : 'number';
  }

  /** A style like `s` but with the given number format code. */
  withFormat(s, code) {
    if (!this.cellXfs) return s;
    const key = `${s}|${code}`;
    if (this.memo.has(key)) return this.memo.get(key);
    const ss = this.doc.documentElement;
    let id = { 'm/d/yyyy': 14, '0.00%': 10, '#,##0': 3, '0.00': 2 }[code];
    if (id === undefined) {
      if (!this.numFmts) {
        this.numFmts = this.doc.createElementNS(MAIN, 'numFmts');
        ss.insertBefore(this.numFmts, ss.firstElementChild || ss.firstChild);
      }
      const existing = [...this.codes].find(([, c]) => c === code);
      if (existing) id = existing[0];
      else {
        id = Math.max(163, ...this.codes.keys()) + 1;
        const nf = this.doc.createElementNS(MAIN, 'numFmt');
        nf.setAttribute('numFmtId', String(id));
        nf.setAttribute('formatCode', code);
        this.numFmts.appendChild(nf);
        this.numFmts.setAttribute('count', String(kids(this.numFmts, 'numFmt').length));
        this.codes.set(id, code);
      }
    }
    const base = this.xf(s) || this.xf(0);
    const xf = base ? base.cloneNode(true) : this.doc.createElementNS(MAIN, 'xf');
    xf.setAttribute('numFmtId', String(id));
    xf.setAttribute('applyNumberFormat', '1');
    this.cellXfs.appendChild(xf);
    const n = kids(this.cellXfs, 'xf').length;
    this.cellXfs.setAttribute('count', String(n));
    this.pkg.dirty(this.path);
    this.memo.set(key, n - 1);
    return n - 1;
  }
}

/* -------------------------------------------------------------------- fill */

const EPOCH = Date.UTC(1899, 11, 30);
const serial = (d) => (d.getTime() - EPOCH) / 86400000;
const XML_BAD = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

const DEFAULT_FMT = { money: '"$"#,##0', money2: '"$"#,##0.00', int: '#,##0', dec: '0.00', pct: '0.00%', date: 'm/d/yyyy' };

function getRow(doc, data, r, cache) {
  if (cache.has(r)) return cache.get(r);
  let after = null;
  for (const row of kids(data, 'row')) {
    const n = Number(row.getAttribute('r'));
    if (n === r) { cache.set(r, row); return row; }
    if (n > r) { after = row; break; }
  }
  const row = doc.createElementNS(MAIN, 'row');
  row.setAttribute('r', String(r));
  data.insertBefore(row, after);
  cache.set(r, row);
  return row;
}

function getCell(doc, row, col, r) {
  let after = null;
  for (const c of kids(row, 'c')) {
    const ref = splitRef(c.getAttribute('r') || '');
    if (!ref) continue;
    if (ref.col === col) return c;
    if (ref.col > col) { after = c; break; }
  }
  const c = doc.createElementNS(MAIN, 'c');
  c.setAttribute('r', `${colName(col)}${r}`);
  row.insertBefore(c, after);
  return c;
}

function clearValue(c) {
  for (const n of [...c.childNodes]) c.removeChild(n);
  c.removeAttribute('t');
}

function setValue(doc, c, type, value, styles, fallbackStyle) {
  clearValue(c);
  if (value === null || value === undefined || value === '') return;
  let s = c.getAttribute('s') !== null ? Number(c.getAttribute('s')) : fallbackStyle;
  if (type === 'text') {
    const t = String(value).replace(XML_BAD, '').slice(0, 32000);
    c.setAttribute('t', 'inlineStr');
    const is = doc.createElementNS(MAIN, 'is');
    const te = doc.createElementNS(MAIN, 't');
    te.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
    te.textContent = t;
    is.appendChild(te);
    c.appendChild(is);
    if (s) c.setAttribute('s', String(s));
    return;
  }
  let v = value;
  const kind = styles.kind(s || 0);
  if (type === 'date') {
    v = serial(value);
    if (kind !== 'date') s = styles.withFormat(s || 0, DEFAULT_FMT.date);
  } else if (type === 'pct') {
    // a percent-formatted cell wants 0.0625; a plain number cell wants 6.25 as printed
    if (kind === 'pct') v = value / 100;
    else if (kind === 'general') { v = value / 100; s = styles.withFormat(s || 0, DEFAULT_FMT.pct); } else v = value;
  } else if (kind === 'general') {
    s = styles.withFormat(s || 0, DEFAULT_FMT[type] || '#,##0');
  }
  if (type === 'int' || type === 'money') v = Math.round(v);
  else if (type === 'money2') v = Math.round(v * 100) / 100;
  else v = Math.round(v * 1e6) / 1e6;
  const ve = doc.createElementNS(MAIN, 'v');
  ve.textContent = String(v);
  c.appendChild(ve);
  if (s) c.setAttribute('s', String(s));
}

/** Widen an Excel table (and its filter) over the header so it covers the rows written. */
function stretchTables(pkg, sheetPath, headerRow, lastRow) {
  for (const rel of pkg.rels(sheetPath).filter((x) => x.type.endsWith('/table'))) {
    if (!pkg.has(rel.target)) continue;
    const t = pkg.doc(rel.target).documentElement;
    const ref = (t.getAttribute('ref') || '').split(':');
    const a = splitRef(ref[0] || '');
    const b = splitRef(ref[1] || '');
    if (!a || !b || a.row !== headerRow) continue;
    const totals = Number(t.getAttribute('totalsRowCount') || 0);
    const end = Math.max(b.row, lastRow + totals);
    if (end === b.row) continue;
    const nref = `${colName(a.col)}${a.row}:${colName(b.col)}${end}`;
    t.setAttribute('ref', nref);
    const af = kid(t, 'autoFilter');
    if (af) af.setAttribute('ref', `${colName(a.col)}${a.row}:${colName(b.col)}${end - totals}`);
    pkg.dirty(rel.target);
  }
}

/**
 * Write the comps into the template.
 * `plan` is inspectTemplate()'s result, with any roles and fields the person changed.
 * Returns { bytes, report: { written, formulasKept, sheets } }.
 */
export function fillTemplate(fflate, bytes, plan, { sales, market }, xml) {
  const pkg = new Package(fflate, bytes, xml);
  const styles = new Styles(pkg);
  const report = { written: 0, formulasKept: 0, sheets: [] };

  for (const sh of plan.sheets) {
    if (sh.role !== 'sale' && sh.role !== 'market') continue;
    const comps = sh.role === 'sale' ? sales : market;
    const cols = sh.columns.filter((c) => c.field && FIELD[c.field]);
    if (!cols.length) continue;
    const doc = pkg.doc(sh.path);
    const data = doc.getElementsByTagNameNS(MAIN, 'sheetData')[0];
    const cache = new Map();
    const first = sh.headerRow + 1;

    // the template's first data row lends its style to any row the template doesn't have
    const lend = new Map();
    const firstRow = kids(data, 'row').find((r) => Number(r.getAttribute('r')) === first);
    if (firstRow) {
      for (const c of kids(firstRow, 'c')) {
        const ref = splitRef(c.getAttribute('r') || '');
        if (ref && c.getAttribute('s')) lend.set(ref.col, Number(c.getAttribute('s')));
      }
    }

    // clear whatever an earlier use left under the headers (values only; formulas and styles
    // stay), so an old comp's figures never sit beside a new comp's name
    const mapped = new Set(sh.columns.map((c) => c.col));
    for (const row of kids(data, 'row')) {
      if (Number(row.getAttribute('r')) < first) continue;
      for (const c of kids(row, 'c')) {
        const ref = splitRef(c.getAttribute('r') || '');
        if (ref && mapped.has(ref.col) && !kid(c, 'f') && c.childNodes.length) clearValue(c);
      }
    }

    comps.forEach((comp, i) => {
      const r = first + i;
      const row = getRow(doc, data, r, cache);
      row.removeAttribute('spans');
      for (const col of cols) {
        const cell = getCell(doc, row, col.col, r);
        if (kid(cell, 'f')) { report.formulasKept += 1; continue; }
        const F = FIELD[col.field];
        setValue(doc, cell, F.type, F.get(comp), styles, lend.get(col.col) ?? 0);
      }
    });
    const last = first + comps.length - 1;
    report.written += comps.length;
    report.sheets.push({ name: sh.name, role: sh.role, rows: comps.length, from: first, to: last });

    // the sheet's used range and any table over the header grow to fit
    const dim = doc.getElementsByTagNameNS(MAIN, 'dimension')[0];
    if (dim && comps.length) {
      const [a, b] = (dim.getAttribute('ref') || 'A1').split(':');
      const end = splitRef(b || a) || { col: 1, row: 1 };
      const maxCol = Math.max(end.col, ...cols.map((c) => c.col));
      dim.setAttribute('ref', `${splitRef(a) ? a : 'A1'}:${colName(maxCol)}${Math.max(end.row, last)}`);
    }
    stretchTables(pkg, sh.path, sh.headerRow, last);
    pkg.dirty(sh.path);
  }

  // formulas that read the new values recalculate when the file opens; the
  // calculation chain is a cache Excel rebuilds, and a stale one triggers a repair
  const wbDoc = pkg.doc('xl/workbook.xml');
  let calcPr = wbDoc.getElementsByTagNameNS(MAIN, 'calcPr')[0];
  if (!calcPr) {
    calcPr = wbDoc.createElementNS(MAIN, 'calcPr');
    const root = wbDoc.documentElement;
    // calcPr follows definedNames/sheets and precedes oleSize, customWorkbookViews, pivotCaches...
    const before = ['oleSize', 'customWorkbookViews', 'pivotCaches', 'smartTagPr', 'smartTagTypes', 'webPublishing', 'fileRecoveryPr', 'webPublishObjects', 'extLst']
      .map((n) => kid(root, n)).find(Boolean) || null;
    root.insertBefore(calcPr, before);
  }
  calcPr.setAttribute('fullCalcOnLoad', '1');
  pkg.dirty('xl/workbook.xml');
  const chain = pkg.rels('xl/workbook.xml').find((r) => r.type.endsWith('/calcChain'));
  if (chain) {
    (pkg.removed ||= new Set()).add(chain.target);
    chain.node.parentNode.removeChild(chain.node);
    pkg.dirty(relsPath('xl/workbook.xml'));
    const ct = pkg.doc('[Content_Types].xml');
    for (const o of [...ct.documentElement.childNodes]) {
      if (o.nodeType === 1 && o.getAttribute('PartName') === `/${chain.target}`) ct.documentElement.removeChild(o);
    }
    pkg.dirty('[Content_Types].xml');
  }
  return { bytes: pkg.bytes(), report };
}

/* ======================================================= cell-level templates
 *
 * Beyond comp tables: an underwriting model, a rent roll format or an IC
 * report takes single figures in particular cells ("Purchase Price" in B14)
 * and tables of leases. The same rule holds -- the file is edited in place,
 * cell by cell, and nothing else in it changes -- with more care, because
 * these workbooks are full of formulas:
 *   - a cell holding a formula is never overwritten;
 *   - a cell inside a merged range (other than its top-left) is never written,
 *     because Excel would not show it;
 *   - every write is listed before it happens, with what the cell holds now
 *     and how many formulas read it;
 *   - macros, pivot tables, external links and other parts this module does
 *     not understand are left byte for byte, and named in a warning. */

const ref = (col, row) => `${colName(col)}${row}`;
const unquote = (s) => (s.startsWith("'") ? s.slice(1, -1).replace(/''/g, "'") : s);

/** What a workbook contains that a broker should know before it is filled. */
function workbookFeatures(pkg) {
  const names = Object.keys(pkg.files);
  const has = (re) => names.some((n) => re.test(n));
  const wb = pkg.doc('xl/workbook.xml');
  const f = {
    macros: has(/vbaProject\.bin$/i),
    externalLinks: has(/^xl\/externalLinks\//),
    pivots: has(/^xl\/pivotTables\//) || has(/^xl\/pivotCache\//),
    charts: has(/^xl\/charts\/chart\d*\.xml$/),
    tables: has(/^xl\/tables\//),
    comments: has(/^xl\/comments\d*\.xml$/) || has(/^xl\/threadedComments\//),
    images: has(/^xl\/media\//),
    connections: has(/^xl\/connections\.xml$/),
    slicers: has(/^xl\/slicers?\//) || has(/^xl\/slicerCaches\//),
    // an empty <workbookProtection/> (openpyxl writes one) locks nothing; lockStructure is what stops a sheet being added
    workbookProtected: [...wb.getElementsByTagNameNS(MAIN, 'workbookProtection')].some((x) => /^(1|true)$/i.test(x.getAttribute('lockStructure') || '')),
    protectedSheets: [],
  };
  const warnings = [];
  if (f.macros) warnings.push({ level: 'warn', text: 'The workbook has macros. They are kept exactly as they are (not run, not checked); save the result as .xlsm, and Excel will ask before enabling them.' });
  if (f.externalLinks) warnings.push({ level: 'warn', text: 'It links to other workbooks. The links are kept; their values update only when Excel can reach those files.' });
  if (f.pivots) warnings.push({ level: 'warn', text: 'It has pivot tables. They are kept, but they show the old data until you refresh them in Excel (Data → Refresh All).' });
  if (f.connections) warnings.push({ level: 'info', text: 'It has data connections. They are kept and are not refreshed.' });
  if (f.slicers) warnings.push({ level: 'info', text: 'It has slicers. They are kept as they are.' });
  if (f.workbookProtected) warnings.push({ level: 'info', text: 'The workbook structure is protected. Cells can still be filled; no sheet is added.' });
  return { features: f, warnings };
}

/** Merged ranges on a sheet: [{ a: {col,row}, b: {col,row} }]. */
function mergesOf(doc) {
  return [...doc.getElementsByTagNameNS(MAIN, 'mergeCell')].map((m) => {
    const [x, y] = (m.getAttribute('ref') || '').split(':');
    return { a: splitRef(x || ''), b: splitRef(y || x || '') };
  }).filter((m) => m.a && m.b);
}
const inMerge = (merges, col, row) => merges.find((m) => col >= m.a.col && col <= m.b.col && row >= m.a.row && row <= m.b.row) || null;

/** Every formula in the workbook, with the sheet it sits on, for dependency counts. */
function allFormulas(pkg, sheets) {
  const out = [];
  for (const s of sheets) {
    const doc = pkg.doc(s.path);
    for (const f of doc.getElementsByTagNameNS(MAIN, 'f')) {
      const t = f.textContent || '';
      if (t) out.push({ sheet: s.name, text: t });
    }
  }
  const wb = pkg.doc('xl/workbook.xml');
  for (const d of wb.getElementsByTagNameNS(MAIN, 'definedName')) out.push({ sheet: null, text: d.textContent || '', name: d.getAttribute('name') });
  return out;
}

const REF_RE = /((?:'(?:[^']|'')+'|[A-Za-z_][\w.]*)!)?\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?(?![\w(!])/g;
/** How many formulas (and named ranges) read a cell, directly or through a range. */
export function dependents(formulas, sheet, col, row) {
  let n = 0;
  const names = [];
  for (const f of formulas) {
    const text = f.text.replace(/"(?:[^"]|"")*"/g, '');
    REF_RE.lastIndex = 0;
    let m;
    let hit = false;
    while ((m = REF_RE.exec(text))) {
      const before = text[m.index - 1];
      if (before && /[\w.]/.test(before)) continue;
      const sh = m[1] ? unquote(m[1].slice(0, -1)) : f.sheet;
      if (sh !== sheet) continue;
      const c1 = colNum(m[2]); const r1 = Number(m[3]);
      const c2 = m[4] ? colNum(m[4]) : c1; const r2 = m[5] ? Number(m[5]) : r1;
      if (col >= Math.min(c1, c2) && col <= Math.max(c1, c2) && row >= Math.min(r1, r2) && row <= Math.max(r1, r2)) { hit = true; break; }
    }
    if (hit) { if (f.name) names.push(f.name); else n += 1; }
  }
  return { formulas: n, names };
}

/**
 * Everything the mapping screen needs: sheets with a preview of their cells,
 * named ranges, what the workbook contains, and the formulas (for counts).
 * `limit` bounds the preview of a large sheet; the fill itself is not bounded.
 */
export function inspectWorkbook(fflate, bytes, xml, { rows = 80, cols = 20 } = {}) {
  const pkg = new Package(fflate, bytes, xml);
  const sst = sharedStrings(pkg);
  const sheets = sheetsOf(pkg);
  const { features, warnings } = workbookFeatures(pkg);
  const styles = new Styles(pkg);
  const out = [];
  for (const s of sheets) {
    const doc = pkg.doc(s.path);
    const data = doc.getElementsByTagNameNS(MAIN, 'sheetData')[0];
    const merges = mergesOf(doc);
    if (doc.getElementsByTagNameNS(MAIN, 'sheetProtection').length) features.protectedSheets.push(s.name);
    const cells = [];
    let maxRow = 0; let maxCol = 0;
    if (data) {
      for (const row of kids(data, 'row')) {
        const r = Number(row.getAttribute('r'));
        if (r > rows) break;
        for (const c of kids(row, 'c')) {
          const p = splitRef(c.getAttribute('r') || '');
          if (!p || p.col > cols) continue;
          const f = kid(c, 'f');
          const text = cellText(c, sst);
          const sIdx = c.getAttribute('s') !== null ? Number(c.getAttribute('s')) : 0;
          if (!text && !f) continue;
          cells.push({ ref: ref(p.col, p.row), col: p.col, row: p.row, text, formula: f ? (f.textContent || (f.getAttribute('t') === 'shared' ? '(shared formula)' : '(formula)')) : null, kind: styles.kind(sIdx), type: c.getAttribute('t') || 'n' });
          maxRow = Math.max(maxRow, p.row); maxCol = Math.max(maxCol, p.col);
        }
      }
    }
    out.push({ name: s.name, path: s.path, hidden: s.hidden, cells, merges: merges.map((m) => ({ a: ref(m.a.col, m.a.row), b: ref(m.b.col, m.b.row) })), maxRow, maxCol });
  }
  const wb = pkg.doc('xl/workbook.xml');
  const definedNames = [...wb.getElementsByTagNameNS(MAIN, 'definedName')].map((d) => ({ name: d.getAttribute('name'), ref: d.textContent || '', hidden: d.getAttribute('hidden') === '1' }))
    .filter((d) => !/^_xlnm\./.test(d.name));
  if (features.protectedSheets.length) warnings.push({ level: 'info', text: `Protected sheet${features.protectedSheets.length === 1 ? '' : 's'}: ${features.protectedSheets.join(', ')}. Locked cells there are still written; unprotecting is not needed.` });
  return { sheets: out, definedNames, features, warnings };
}

/** A single-cell named range's sheet and cell, or null for a range or a formula. */
export function nameTarget(ref0) {
  const m = /^(?:'((?:[^']|'')+)'|([^!]+))!\$?([A-Z]{1,3})\$?(\d+)$/.exec(String(ref0 || '').trim());
  if (!m) return null;
  return { sheet: (m[1] || m[2]).replace(/''/g, "'"), cell: `${m[3]}${m[4]}` };
}

/**
 * Suggested cells for each field: a named range named for it (high
 * confidence), else the cell beside or under a label that names it, when
 * that cell is empty or a plain number -- never a formula. `fields` is
 * [{ key, label, re }]. Returns [{ field, sheet, cell, confidence, why }].
 */
export function suggestCellMap(info, fields) {
  const out = [];
  const taken = new Set();
  for (const F of fields) {
    // 1. a named range
    const words = (n) => n.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_.]+/g, ' ').toLowerCase().trim();
    const named = info.definedNames.find((d) => F.re.test(words(d.name)) && nameTarget(d.ref));
    if (named) {
      const t = nameTarget(named.ref);
      const key = `${t.sheet}!${t.cell}`;
      if (!taken.has(key)) { taken.add(key); out.push({ field: F.key, sheet: t.sheet, cell: t.cell, confidence: 'high', why: `named range ${named.name}` }); continue; }
    }
    // 2. a label, and the cell it introduces
    let best = null;
    for (const s of info.sheets) {
      if (s.hidden) continue;
      const at = new Map(s.cells.map((c) => [c.ref, c]));
      // a row of several headings is a table's header, not a label beside its value
      const textPerRow = new Map();
      for (const c of s.cells) if (!c.formula && (c.type === 's' || c.type === 'inlineStr') && c.text) textPerRow.set(c.row, (textPerRow.get(c.row) || 0) + 1);
      for (const c of s.cells) {
        if (c.formula || c.type !== 's' && c.type !== 'inlineStr' && c.type !== 'str') continue;
        if ((textPerRow.get(c.row) || 0) >= 4) continue;
        const label = norm(c.text).replace(/[:*]+$/, '');
        if (!label || label.length > 50 || !F.re.test(label)) continue;
        const exact = F.exact && F.exact.test(label);
        for (const [dc, dr, w] of [[1, 0, 3], [2, 0, 2], [3, 0, 1], [0, 1, 1]]) {
          const target = ref(c.col + dc, c.row + dr);
          const t = at.get(target);
          if (t && t.formula) break;                     // the label's value is calculated: leave it
          if (t && (t.type === 's' || t.type === 'inlineStr') && t.text) continue;   // another label
          if (inMerge((s.merges || []).map((m) => ({ a: splitRef(m.a), b: splitRef(m.b) })), c.col + dc, c.row + dr)
            && !(s.merges || []).some((m) => m.a === target)) continue;
          const key = `${s.name}!${target}`;
          if (taken.has(key)) continue;
          const score = w + (exact ? 3 : 0) + (t ? 1 : 0);
          if (!best || score > best.score) best = { score, sheet: s.name, cell: target, why: `next to “${c.text.trim()}” on ${s.name}`, exact };
          break;
        }
      }
    }
    if (best) {
      taken.add(`${best.sheet}!${best.cell}`);
      out.push({ field: F.key, sheet: best.sheet, cell: best.cell, confidence: best.exact || best.score >= 5 ? 'medium' : 'low', why: best.why });
    }
  }
  return out;
}

/**
 * What filling would do, cell by cell, without doing it. `cellMap` is
 * [{ sheet, cell, field }]; `values` maps a field to { value, type, source }.
 * Each entry: action 'write', or 'skip' with the reason.
 */
export function previewCells(fflate, bytes, cellMap, values, xml) {
  const pkg = new Package(fflate, bytes, xml);
  const sst = sharedStrings(pkg);
  const sheets = sheetsOf(pkg);
  const formulas = allFormulas(pkg, sheets);
  return cellMap.map((m) => {
    const s = sheets.find((x) => x.name === m.sheet);
    const p = splitRef(m.cell || '');
    const v = values[m.field] || { value: null };
    const base = { ...m, next: v.value, type: v.type, source: v.source || '' };
    if (!s) return { ...base, action: 'skip', reason: `There is no sheet named “${m.sheet}” any more.` };
    if (!p) return { ...base, action: 'skip', reason: `“${m.cell}” is not a cell reference.` };
    const doc = pkg.doc(s.path);
    const data = doc.getElementsByTagNameNS(MAIN, 'sheetData')[0];
    const row = data ? kids(data, 'row').find((r) => Number(r.getAttribute('r')) === p.row) : null;
    const c = row ? kids(row, 'c').find((x) => { const q = splitRef(x.getAttribute('r') || ''); return q && q.col === p.col; }) : null;
    const f = c ? kid(c, 'f') : null;
    const current = c ? cellText(c, sst) : '';
    const dep = dependents(formulas, s.name, p.col, p.row);
    const merge = inMerge(mergesOf(doc), p.col, p.row);
    const out = { ...base, current: f ? `=${f.textContent || '(shared formula)'}` : current, feeds: dep.formulas, names: dep.names };
    if (f) return { ...out, action: 'skip', reason: 'The cell holds a formula; it is left alone.' };
    if (merge && !(merge.a.col === p.col && merge.a.row === p.row)) return { ...out, action: 'skip', reason: `The cell is inside the merged range starting at ${ref(merge.a.col, merge.a.row)}; write to that cell instead.` };
    if (v.value === null || v.value === undefined || v.value === '') return { ...out, action: 'skip', reason: 'The deal has no value for this field; the cell is left as it is.' };
    return { ...out, action: 'write' };
  });
}

/**
 * Fill a workbook: single cells from `cellMap` and tables of rows (a rent roll,
 * comps) under a header. `tables`: [{ sheet, headerRow, columns: [{ col, field }],
 * rows: [{ field: { value, type } }], clear: true }]. With `audit`, a sheet named
 * "Comp Loader Audit" lists every cell written, with its source. Returns
 * { bytes, report: { written, skipped, preview, tables } }.
 */
export function fillCells(fflate, bytes, { cellMap = [], values = {}, tables = [], audit = true, auditTitle = '' } = {}, xml) {
  const preview = previewCells(fflate, bytes, cellMap, values, xml);
  const pkg = new Package(fflate, bytes, xml);
  const styles = new Styles(pkg);
  const sheets = sheetsOf(pkg);
  const caches = new Map();
  const at = (s) => {
    if (!caches.has(s.path)) {
      const doc = pkg.doc(s.path);
      caches.set(s.path, { doc, data: doc.getElementsByTagNameNS(MAIN, 'sheetData')[0], rows: new Map() });
    }
    return caches.get(s.path);
  };
  const report = { written: 0, skipped: preview.filter((p) => p.action === 'skip').length, preview, tables: [] };
  const log = [];
  for (const p of preview) {
    if (p.action !== 'write') continue;
    const s = sheets.find((x) => x.name === p.sheet);
    const q = splitRef(p.cell);
    const { doc, data, rows } = at(s);
    const row = getRow(doc, data, q.row, rows);
    row.removeAttribute('spans');
    const cell = getCell(doc, row, q.col, q.row);
    setValue(doc, cell, p.type || 'text', p.type === 'date' && !(p.next instanceof Date) ? new Date(p.next) : p.next, styles, 0);
    growDimension(doc, q.col, q.row);
    pkg.dirty(s.path);
    report.written += 1;
    log.push([p.sheet, p.cell, p.label || p.field, p.next, p.source, p.feeds]);
  }
  for (const t of tables) {
    const s = sheets.find((x) => x.name === t.sheet);
    if (!s) { report.tables.push({ sheet: t.sheet, rows: 0, skipped: 'no such sheet' }); continue; }
    const { doc, data, rows } = at(s);
    const first = t.headerRow + 1;
    const cols = t.columns.filter((c) => c.field);
    const mapped = new Set(cols.map((c) => c.col));
    if (t.clear !== false) {
      for (const row of kids(data, 'row')) {
        if (Number(row.getAttribute('r')) < first) continue;
        for (const c of kids(row, 'c')) {
          const q = splitRef(c.getAttribute('r') || '');
          if (q && mapped.has(q.col) && !kid(c, 'f') && c.childNodes.length) clearValue(c);
        }
      }
    }
    let kept = 0;
    t.rows.forEach((rowVals, i) => {
      const r = first + i;
      const row = getRow(doc, data, r, rows);
      row.removeAttribute('spans');
      for (const col of cols) {
        const cell = getCell(doc, row, col.col, r);
        if (kid(cell, 'f')) { kept += 1; continue; }
        const v = rowVals[col.field];
        setValue(doc, cell, v ? v.type : 'text', v ? v.value : null, styles, 0);
      }
    });
    if (t.rows.length) {
      growDimension(doc, Math.max(...cols.map((c) => c.col)), first + t.rows.length - 1);
      stretchTables(pkg, s.path, t.headerRow, first + t.rows.length - 1);
    }
    pkg.dirty(s.path);
    report.tables.push({ sheet: t.sheet, rows: t.rows.length, from: first, to: first + t.rows.length - 1, formulasKept: kept });
    log.push([t.sheet, `${colName(Math.min(...cols.map((c) => c.col)))}${first}:${colName(Math.max(...cols.map((c) => c.col)))}${first + Math.max(0, t.rows.length - 1)}`, `table of ${t.rows.length} rows`, '', t.source || '', '']);
  }
  recalcOnOpen(pkg);
  const { features } = workbookFeatures(pkg);
  if (audit && !features.workbookProtected) addAuditSheet(pkg, log, auditTitle);
  return { bytes: pkg.bytes(), report };
}

function growDimension(doc, col, row) {
  const dim = doc.getElementsByTagNameNS(MAIN, 'dimension')[0];
  if (!dim) return;
  const [a, b] = (dim.getAttribute('ref') || 'A1').split(':');
  const end = splitRef(b || a) || { col: 1, row: 1 };
  dim.setAttribute('ref', `${splitRef(a) ? a : 'A1'}:${colName(Math.max(end.col, col))}${Math.max(end.row, row)}`);
}

function recalcOnOpen(pkg) {
  const wbDoc = pkg.doc('xl/workbook.xml');
  let calcPr = wbDoc.getElementsByTagNameNS(MAIN, 'calcPr')[0];
  if (!calcPr) {
    calcPr = wbDoc.createElementNS(MAIN, 'calcPr');
    const root = wbDoc.documentElement;
    const before = ['oleSize', 'customWorkbookViews', 'pivotCaches', 'smartTagPr', 'smartTagTypes', 'webPublishing', 'fileRecoveryPr', 'webPublishObjects', 'extLst']
      .map((n) => kid(root, n)).find(Boolean) || null;
    root.insertBefore(calcPr, before);
  }
  calcPr.setAttribute('fullCalcOnLoad', '1');
  pkg.dirty('xl/workbook.xml');
  const chain = pkg.rels('xl/workbook.xml').find((r) => r.type.endsWith('/calcChain'));
  if (chain) {
    (pkg.removed ||= new Set()).add(chain.target);
    chain.node.parentNode.removeChild(chain.node);
    pkg.dirty(relsPath('xl/workbook.xml'));
    const ct = pkg.doc('[Content_Types].xml');
    for (const o of [...ct.documentElement.childNodes]) {
      if (o.nodeType === 1 && o.getAttribute('PartName') === `/${chain.target}`) ct.documentElement.removeChild(o);
    }
    pkg.dirty('[Content_Types].xml');
  }
}

const AUDIT = 'Comp Loader Audit';
const esc = (s) => String(s).replace(XML_BAD, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** A sheet listing every cell written and where its value came from; refilling replaces it. */
function addAuditSheet(pkg, log, auditTitle) {
  const cell = (r, c, v) => {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${colName(c)}${r}"><v>${v}</v></c>`;
    const t = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
    return `<c r="${colName(c)}${r}" t="inlineStr"><is><t xml:space="preserve">${esc(t).slice(0, 32000)}</t></is></c>`;
  };
  const rows = [
    [`Filled by Comp Loader on ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC${auditTitle ? ` · ${auditTitle}` : ''}`],
    ['Only the cells below were written. Cells holding formulas were left alone. Excel recalculates when the file opens.'],
    [],
    ['Sheet', 'Cell', 'Field', 'Value written', 'Source', 'Formulas reading it'],
    ...log,
  ];
  const body = rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => cell(i + 1, j + 1, v)).join('')}</row>`).join('');
  const xmlText = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="${MAIN}"><cols><col min="1" max="1" width="22" customWidth="1"/><col min="2" max="2" width="12" customWidth="1"/><col min="3" max="3" width="30" customWidth="1"/><col min="4" max="4" width="22" customWidth="1"/><col min="5" max="5" width="36" customWidth="1"/><col min="6" max="6" width="18" customWidth="1"/></cols><sheetData>${body}</sheetData></worksheet>`;
  const existing = sheetsOf(pkg).find((s) => s.name === AUDIT);
  if (existing) { pkg.files[existing.path] = pkg.fflate.strToU8(xmlText); pkg.docs.delete(existing.path); return; }
  let n = 1;
  while (pkg.has(`xl/worksheets/sheet${n}.xml`)) n += 1;
  const path = `xl/worksheets/sheet${n}.xml`;
  pkg.files[path] = pkg.fflate.strToU8(xmlText);
  // the relationship from the workbook
  const rp = relsPath('xl/workbook.xml');
  const rdoc = pkg.doc(rp);
  const ids = [...rdoc.getElementsByTagNameNS(PKG_REL, 'Relationship')].map((r) => r.getAttribute('Id'));
  let k = ids.length + 1;
  while (ids.includes(`rId${k}`)) k += 1;
  const rel = rdoc.createElementNS(PKG_REL, 'Relationship');
  rel.setAttribute('Id', `rId${k}`);
  rel.setAttribute('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet');
  rel.setAttribute('Target', `worksheets/sheet${n}.xml`);
  rdoc.documentElement.appendChild(rel);
  pkg.dirty(rp);
  // the sheet in the workbook, last
  const wb = pkg.doc('xl/workbook.xml');
  const sheetsEl = wb.getElementsByTagNameNS(MAIN, 'sheets')[0];
  const maxId = Math.max(0, ...[...sheetsEl.getElementsByTagNameNS(MAIN, 'sheet')].map((s) => Number(s.getAttribute('sheetId')) || 0));
  const sh = wb.createElementNS(MAIN, 'sheet');
  sh.setAttribute('name', AUDIT);
  sh.setAttribute('sheetId', String(maxId + 1));
  sh.setAttributeNS(REL, 'r:id', `rId${k}`);
  sheetsEl.appendChild(sh);
  pkg.dirty('xl/workbook.xml');
  // its content type
  const ct = pkg.doc('[Content_Types].xml');
  const o = ct.createElementNS('http://schemas.openxmlformats.org/package/2006/content-types', 'Override');
  o.setAttribute('PartName', `/${path}`);
  o.setAttribute('ContentType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml');
  ct.documentElement.appendChild(o);
  pkg.dirty('[Content_Types].xml');
}
