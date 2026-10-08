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
