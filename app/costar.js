/* costar.js -- CoStar comp-report parsing.
 *
 * A direct port of the original Python loader's parsing and business rules, kept
 * line-for-line comparable so the browser app and the Python loader produce the
 * same comps from the same PDFs. Field extraction reads the column-preserving
 * text produced by layout.js.
 */

export const MAX_COMPS = 15;

const HEAD = /^\s{0,6}(\d{1,3})\s{2,}(\S.*?)\s*$/;
const LOC = /^\s*(.+?),\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?(.*)$/;
const PORT = /^\s*(\d+)\s+(.+?)\s+Properties\s*$/;
const VACANT = /\b(sold vacant|(?:was|were) vacant at the time of (?:the )?sale)\b/i;

const SECTION = /^\s{0,6}(Contacts|Contacts \(Continued\)|Loan|Property Details|Transaction Details|Sale Summary|For Sale Summary|For Lease Summary|Tenants|Tenants at Sale|Assessment|Assessment At Sale|Income And Expenses|Market Conditions|Market Conditions at Sale|Property Summary|Property Summary Statistics|Property List|Previous Sale|My Notes|Amenities|Available Spaces|Transportation|Highlights|Property Notes|Transaction Notes|Sale Notes|Listing Notes|Space Details|Parcel|Public Record)\s*$/;
const NOTE_HEAD = /^\s{0,6}(Transaction Notes|Property Notes|Sale Notes|Listing Notes)(?: \(Continued\))?\s*$/;
const PAGE_JUNK = /CoStar Group - Licensed|^\s*Page \d+\s*$|^\s*\d{1,2}\/\d{1,2}\/\d{4}\s*$/;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ---------------------------------------------------------------- splitting */

/** Break a report's pages into one text block per property. */
export function splitComps(pages, source) {
  const comps = [];
  let cur = null;
  for (const page of pages) {
    const lines = page.split('\n').filter((l) => l.trim());
    let head = null;
    if (lines.length >= 2) {
      const m = HEAD.exec(lines[0]);
      if (m && (LOC.exec(lines[1]) || PORT.exec(lines[1]))) head = [m[2].trim(), lines[1]];
    }
    if (head) {
      if (cur === null || cur.title !== head[0]) {
        cur = { title: head[0], line2: head[1], text: '', source };
        comps.push(cur);
      }
      cur.text += '\n' + page;
    } else if (cur !== null) {
      cur.text += '\n' + page;
    }
  }
  return comps;
}

/* ----------------------------------------------------------- field plucking */

/** The value printed to the right of a label, in the same column band. */
function grab(text, label) {
  const re = new RegExp(`(?:^|\\s{2,})${esc(label)}\\s{2,}(\\S.*?)(?=\\s{2,}|$)`, 'm');
  const m = re.exec(text);
  return m ? m[1].trim() : null;
}

/** Every name printed against a role label, de-duplicated, in order. */
function grabRole(text, role) {
  const re = new RegExp(`^\\s*${esc(role)}\\s{2,}(\\S.*?)(?=\\s{2,}|$)`, 'gm');
  const names = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const n = m[1].trim();
    if (n && n !== '-' && !names.includes(n)) names.push(n);
  }
  return names.join('; ') || null;
}

function num(s, pat, int = false) {
  if (!s) return null;
  const m = (pat instanceof RegExp ? pat : new RegExp(pat)).exec(s);
  if (!m) return null;
  const v = parseFloat(m[1].replace(/,/g, ''));
  if (Number.isNaN(v)) return null;
  return int ? Math.round(v) : v;
}

function parcels(text) {
  const out = new Set();
  for (const label of ['Parcel Numbers', 'Parcel Number']) {
    const v = grab(text, label);
    if (!v) continue;
    for (let tok of v.split(/[,;]/)) {
      tok = tok.replace(/\s*\+\d+\s*$/, '').trim();
      if (tok) out.add(tok);
    }
  }
  return out;
}

/** Pull every notes block, merging the continuation pages CoStar splits them across. */
function notesBlocks(text) {
  const out = new Map();
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const h = NOTE_HEAD.exec(lines[i]);
    if (!h) { i += 1; continue; }
    const kind = h[1].replace(' (Continued)', '');
    const body = [];
    i += 1;
    while (i < lines.length) {
      const ln = lines[i];
      if (NOTE_HEAD.test(ln) || SECTION.test(ln)) break;
      if (!PAGE_JUNK.test(ln)) body.push(ln);
      i += 1;
    }
    let txt = body.map((x) => x.trim()).filter(Boolean).join(' ');
    txt = txt.replace(/\s{2,}/g, ' ').trim();
    // CoStar repeats the property header at the top of each page
    txt = txt.replace(/\b\d{1,3}\s+[\w'\-.]+(?: [\w'\-.]+)* (?:Washington|Baltimore|Bethesda|Arlington|Alexandria), [A-Z]{2} \d{5}[^.]*/g, '');
    if (txt && txt.toLowerCase() !== 'no data available') {
      if (!out.has(kind)) out.set(kind, []);
      out.get(kind).push(txt);
    }
  }
  const merged = {};
  for (const [k, v] of out) merged[k] = v.join(' ');
  return merged;
}

/** First sentence(s) of the notes, trimmed to fit the Notes column. */
function summarize(full, limit = 220) {
  if (!full) return null;
  if (full.length <= limit) return full;
  const cut = full.slice(0, limit);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  const head = stop > 60 ? cut.slice(0, stop + 1) : cut.slice(0, cut.lastIndexOf(' '));
  return head + ' ...';
}

/** Fields on a line, separated by two or more spaces, with their offsets. */
function lineFields(line) {
  const out = [];
  const re = /\S+(?: \S+)*/g;
  let m;
  while ((m = re.exec(line)) !== null) out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}

/** Total SF against named tenants, used to sanity-check a derived occupancy.
 *
 * The SF column is located by matching each row's fields against the header's
 * column offsets rather than by slicing a fixed character window, so a number
 * one character wider than the header does not get truncated. */
function tenantSf(text) {
  const lines = text.split('\n');
  let total = 0;
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (!(ln.includes('Tenant Name') && ln.includes('SF Occupied'))) continue;
    const a = ln.indexOf('SF Occupied');
    const b = ln.includes('Employees') ? ln.indexOf('Employees') : a + 20;
    for (const ln2 of lines.slice(i + 1)) {
      const s = ln2.trim();
      if (s.startsWith('Showing') || s === 'Assessment' || s === 'Assessment At Sale') break;
      const hits = lineFields(ln2).filter((f) => /^\d[\d,]*$/.test(f.text)
        && f.end >= a - 4 && f.start < b);
      if (hits.length) {
        total += parseInt(hits[hits.length - 1].text.replace(/,/g, ''), 10);
        found = true;
      }
    }
  }
  return found ? total : null;
}

/** CoStar's flyer layout prints elapsed time, not a day count. */
function monthsOnMarket(text) {
  const v = grab(text, 'Time On Market') || grab(text, 'Time on Market');
  if (!v) return null;
  const y = num(v, /(\d+)\s*Years?/, true) || 0;
  const mo = num(v, /(\d+)\s*Months?/, true) || 0;
  const d = num(v, /(\d+)\s*Days?/, true) || 0;
  return Math.round(y * 365.25 + mo * 30.44 + d) || null;
}

const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
const fmt2 = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const titleCase = (s) => s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());

/* ------------------------------------------------- who traded, and how */

// "Sale Type" also heads a column in CoStar's Sale History table ("Sale Date
// Price  Sale Type  Buyer  Seller"), where the label is followed by the next
// header, not a value. Only these are values.
const SALE_TYPE = /^(Investment|Owner User)(?: or (?:Owner User|Investment))?$/;

function grabAll(text, label) {
  const re = new RegExp(`(?:^|\\s{2,})${esc(label)}\\s{2,}(\\S.*?)(?=\\s{2,}|$)`, 'gm');
  return [...text.matchAll(re)].map((m) => m[1].trim());
}

/** Buyer, seller, sale type, conditions and hold period. These only add
 *  fields: nothing here changes a figure the comp set is built from. */
function transaction(c, t, conditions) {
  c.buyer = grabRole(t, 'True Buyer') || grabRole(t, 'Recorded Buyer');
  c.seller = grabRole(t, 'True Seller') || grabRole(t, 'Recorded Seller');
  c.sale_type = grabAll(t, 'Sale Type').find((v) => SALE_TYPE.test(v)) || null;
  c.conditions = conditions && conditions !== '-' ? conditions : null;
  const hold = grab(t, 'Hold Period');
  c.hold = hold && /^\d+\+?\s+(Months?|Years?)$/.test(hold) ? hold : null;
}

/* -------------------------------------------------------------- one comp */

export function parseComp(block) {
  const t = block.text;
  const title = block.title;
  const flags = [];
  const paren = /\s*\(([^)]*)\)\s*$/.exec(title);
  const name = paren ? title.slice(0, paren.index).trim() : title;
  const note = paren ? paren[1] : null;

  const c = {
    name,
    address: name.split(' - ')[0].trim(),
    source: block.source,
    flags,
    parcels: parcels(t),
    portfolio: 0,
    lat: null,
    lon: null,
  };
  if (note) c.portfolio_note = note;

  let line2 = block.line2;
  if (line2.includes('•')) {
    // flyer layout: "6,500 SF - For Sale - Retail Property - X Submarket - Takoma Park, MD 20912"
    const segs = line2.split('•').map((x) => x.trim());
    const sm = segs.find((x) => x.endsWith('Submarket'));
    if (sm) c.submarket_hint = sm.slice(0, -' Submarket'.length).trim();
    const pt = segs.find((x) => x.endsWith('Property'));
    if (pt) c.ptype_hint = pt.slice(0, -' Property'.length).trim();
    line2 = segs[segs.length - 1];
  }
  const loc = LOC.exec(line2);
  if (loc) {
    c.city = loc[1].trim();
    c.state = loc[2];
    c.zip = parseInt(loc[3], 10);
    const rest = loc[4];
    const sm = /-\s*(.+?)\s+Submarket/.exec(rest);
    c.submarket = sm ? sm[1].trim() : (c.submarket_hint ?? null);
    const cols = line2.trim().split(/\s{2,}/);
    c.ptype = c.ptype_hint || grab(t, 'Primary Property Type')
      || (cols.length > 1 ? cols[cols.length - 1].trim() : null);
  } else {
    const pm = PORT.exec(block.line2);
    if (!pm) {
      // the page header matched, but its second line is neither a city line
      // nor a portfolio count: an unfamiliar layout, reported rather than guessed
      c.kind = null;
      return c;
    }
    c.portfolio = parseInt(pm[1], 10);
    c.ptype = pm[2].trim();
    c.city = c.state = c.zip = c.submarket = null;
    c.name = `${name} (${pm[1]}-Property Portfolio)`;
  }

  const blocks = notesBlocks(t);
  const order = ['Transaction Notes', 'Sale Notes', 'Listing Notes', 'Property Notes'];
  const full = order.filter((k) => k in blocks).map((k) => `${k}: ${blocks[k]}`).join(' | ');
  c.costar_notes = full || null;
  const firstKind = order.find((k) => k in blocks);
  c.notes = summarize(firstKind ? blocks[firstKind] : null);

  const zon = grab(t, 'Zoning');
  if (zon) {
    const codes = zon.split(/[,;]/).map((z) => z.trim()).filter(Boolean);
    c.zoning = codes[0];
    if (codes.length > 1) flags.push(`dual zoning ${zon} -> used ${codes[0]}`);
  } else {
    c.zoning = null;
  }

  const lot = grab(t, 'Land Area');
  c.lot_ac = num(lot, /([\d.,]+)\s*AC/);
  c.lot_sf = num(lot, /([\d,]+)\s*SF/, true);
  c.far = num(grab(t, 'Building FAR'), /([\d.]+)/);
  c.cap = num(grab(t, 'Cap Rate'), /([\d.]+)\s*%/);
  c.bclass = grab(t, 'Building Class');
  c.year = num(grab(t, 'Built/Renovated') || grab(t, 'Built') || grab(t, 'Year Built'),
    /\b(1[6-9]\d\d|20\d\d)\b/, true);

  let size = null;
  let pct = null;
  for (const label of ['RBA (% Leased)', 'GLA (% Leased)', 'RBA', 'GLA', 'Building Size',
    'Total Size', 'Available Size']) {
    const v = grab(t, label);
    if (v) {
      size = num(v, /([\d,]+)\s*SF/, true);
      pct = num(v, /\(([\d.]+)%\)/);
      break;
    }
  }
  c.bsf = size;
  if (pct === null) pct = num(grab(t, 'Percent Leased'), /([\d.]+)\s*%/);
  if (pct === null) pct = num(grab(t, '% Leased'), /([\d.]+)\s*%/);

  // Under Contract / In Escrow / pending: not closed, so these are listings
  let pending = null;
  let pendingLine = null;
  let pm = /(?:^|\s{2,})(?:Sale\s+)?Status\s{2,}(Under Contract|In Escrow|Escrow|Under Agreement|Pending|Contingent|Under Offer)\b/im.exec(t);
  if (!pm) {
    pm = /(?:^|\s{2,})(Under Contract|In Escrow|Escrow|Under Agreement|Pending|Contingent|Under Offer)\s{2,}[\d,]+\s+Days?\b/im.exec(t);
  }
  if (pm) { pending = titleCase(pm[1]); pendingLine = pm[0]; }

  let sold = grab(t, 'Sold');
  let landValue = false;
  if (!sold) {
    // CoStar labels redevelopment/assemblage sales "Sold for Land Value  5/1/2023"
    const m = /(?:^|\s{2,})Sold for ([A-Za-z ]+?)\s{2,}(\d{1,2}\/\d{1,2}\/\d{4})/m.exec(t);
    if (m) { sold = m[2]; landValue = true; }
  }
  const active = grab(t, 'Active');
  const conditions = grab(t, 'Sale Conditions') || '';

  if (pending && !(sold && /^\d{1,2}\/\d{1,2}\/\d{4}/.test(sold))) {
    c.kind = 'market';
    c.dom = num(grab(t, 'On Market'), /([\d,]+)\s+Days?/, true)
      ?? num(pendingLine, /([\d,]+)\s+Days?/, true)
      ?? num(active || '', /([\d,]+)\s+Days?/, true);
    const ap = grab(t, 'Asking Price') || grab(t, 'Sale Price');
    c.price = num(ap, /\$([\d,]+)/, true);
    c.costar_ppsf = num(ap, /\(\$([\d,]+\.\d+)\/SF\)/);
    c.partial = false;
    flags.push(`status is ${pending}, not closed -- loaded as an ON-MARKET comp`);
    if (c.dom === null) c.dom = monthsOnMarket(t);
    if (c.costar_ppsf === null) c.costar_ppsf = num(grab(t, 'Price/SF'), /\$([\d,]+\.?\d*)/);
  } else if (sold && /^\d{1,2}\/\d{1,2}\/\d{4}/.test(sold)) {
    c.kind = 'sale';
    const [mm, dd, yy] = sold.split(' ')[0].split('/').map(Number);
    c.date = new Date(Date.UTC(yy, mm - 1, dd));
    const sp = grab(t, 'Sale Price');
    c.price = num(sp, /\$([\d,]+)/, true);
    c.costar_ppsf = num(sp, /\(\$([\d,]+\.\d+)\/SF\)/);
    c.comp_id = num(grab(t, 'Sale Comp ID'), /(\d+)/, true);
    c.buyer_broker = grabRole(t, 'Buyer Broker');
    c.listing_broker = grabRole(t, 'Listing Broker');
    c.partial = conditions.includes('Partial Interest');
    if (landValue) {
      flags.push("CoStar marks this 'Sold for Land Value' (redevelopment/assemblage) -- price reflects the land, not an operating building");
    }
    if (c.partial) {
      flags.push("partial-interest sale: CoStar's printed $/SF is grossed up to 100% ownership, so it isn't compared; workbook shows the actual $/SF paid");
    }
    if ((grab(t, 'Price Status') || '').toLowerCase() === 'allocated') {
      flags.push('price allocated from a multi-property sale');
    }
  } else if (active || grab(t, 'Under Contract') || /(?:^|\s{2,})Status\s{2,}Active\b/m.test(t)) {
    c.kind = 'market';
    c.dom = num(active || grab(t, 'Under Contract'), /([\d,]+)\s+Days?/, true);
    if (c.dom === null) {
      // newer CoStar layout: "Status  Active" and "On Market  49 Days" as separate fields
      c.dom = num(grab(t, 'On Market'), /([\d,]+)\s+Days?/, true);
    }
    // "Status  Active" on a line of its own is an active listing too; only a
    // listing that reached this branch through its "Under Contract" field is one
    // (the Python loader flagged both, which mislabels single-column layouts)
    if (!active && !/(?:^|\s{2,})Status\s{2,}Active\b/m.test(t)) {
      flags.push('status is Under Contract, not Active');
    }
    const ap = grab(t, 'Asking Price');
    c.price = num(ap, /\$([\d,]+)/, true);
    c.costar_ppsf = num(ap, /\(\$([\d,]+\.\d+)\/SF\)/)
      ?? num(grab(t, 'Price/SF'), /\$([\d,]+\.?\d*)/);
    if (c.dom === null) c.dom = monthsOnMarket(t);
    c.partial = false;
  } else {
    c.kind = null;
    return c;
  }

  if (c.kind === 'market') {
    // Listings can carry two building sizes: the broker's flyer and CoStar's database record.
    const dbBsf = num(grab(t, 'Building SF'), /([\d,]+)/, true);
    c.costar_ppsf_alt = [...t.matchAll(/\(\$([\d,]+\.\d+)\/SF\)/g)].map((m) => parseFloat(m[1].replace(/,/g, '')));
    if (dbBsf && c.bsf && c.price && Math.abs(dbBsf - c.bsf) > 0.01 * c.bsf) {
      flags.push(`CoStar prints two building sizes: ${fmtInt(c.bsf)} SF (listing; used -> `
        + `$${fmt2(c.price / c.bsf)}/SF) vs ${fmtInt(dbBsf)} SF (CoStar database; its headline `
        + `$${fmt2(c.price / dbBsf)}/SF). To use the database size, overwrite Building SF on `
        + 'the On Market Comps Import tab.');
    }
  }

  if (pct !== null) {
    c.occ = pct; c.occ_basis = 'explicit';
  } else if (c.kind === 'sale' && VACANT.test(t)) {
    c.occ = 0; c.occ_basis = 'derived';
    flags.push('occupancy 0% -- notes say it sold vacant');
  } else {
    const vac = num(t, /Vacancy Rates[\s\S]*?Subject Property\s+([\d.]+)%/);
    if (vac !== null) {
      c.occ = Math.round((100 - vac) * 10) / 10; c.occ_basis = 'derived';
      flags.push(`occupancy ${g(c.occ)}% derived from Subject Property vacancy ${g(vac)}%`);
    } else {
      const vac2 = c.kind === 'market' ? num(grab(t, 'Vacancy %'), /([\d.]+)\s*%/) : null;
      if (vac2 !== null) {
        c.occ = Math.round((100 - vac2) * 10) / 10; c.occ_basis = 'derived';
        flags.push(`occupancy ${g(c.occ)}% derived from CoStar's Vacancy % (${g(vac2)}%)`);
      } else {
        c.occ = null; c.occ_basis = null;
        if (c.kind === 'market') flags.push("occupancy not reported in CoStar's listing -- left blank");
      }
    }
  }
  transaction(c, t, conditions);
  if (c.occ_basis === 'derived' && c.occ !== null && c.bsf) {
    const occupied = tenantSf(t);
    if (occupied !== null && Math.abs((occupied / c.bsf) * 100 - c.occ) > 20) {
      flags.push(`check occupancy: tenants listed occupy ${fmtInt(occupied)} of ${fmtInt(c.bsf)} SF `
        + `(${Math.round((occupied / c.bsf) * 100)}%) vs ${g(c.occ)}% used`);
    }
  }
  return c;
}

// Python's "%g": drop a trailing ".0"
function g(x) {
  return String(Number(x.toPrecision(6)));
}

/* ----------------------------------------------------------- business rules */

export function ppsf(c) {
  return c.price && c.bsf ? c.price / c.bsf : null;
}

const isSubset = (a, b) => a.size > 0 && [...a].every((x) => b.has(x));

/* The zoning table is either a plain {code: maxFAR} object (what the Python
 * loader reads from the template) or a function returning the max FAR, null
 * for a known code with none recorded, or undefined for an unknown code. The
 * function form lets a caller recognise codes that carry their own FAR, such
 * as Montgomery County's CR-3.0. */
const zoneKnown = (table, z) => (typeof table === 'function' ? table(z) !== undefined : z in table);
const zoneFar = (table, z) => (typeof table === 'function' ? table(z) : table[z]);

export function applyRules(comps, drops, zoningCodes, report, { cap = true } = {}) {
  // de-duplicate the same comp arriving in two PDFs
  const seen = new Set();
  const uniq = [];
  for (const c of comps) {
    const stamp = c.date ? c.date.getTime() : (c.dom ?? null);
    const key = JSON.stringify([c.kind, c.address.toLowerCase(), stamp, c.price ?? null]);
    if (seen.has(key)) {
      report.excluded.push(`${c.name}: duplicate of a comp already loaded (${c.source})`);
      continue;
    }
    seen.add(key);
    uniq.push(c);
  }
  comps = uniq;

  // portfolio listing vs. its components, matched by parcel number
  let market = comps.filter((c) => c.kind === 'market');
  for (const p of market.filter((c) => c.portfolio)) {
    const parts = market.filter((x) => !x.portfolio && x.parcels.size && isSubset(x.parcels, p.parcels));
    if (!parts.length) continue;
    for (const fld of ['city', 'state', 'zip', 'submarket']) {
      const vals = new Set(parts.filter((x) => x[fld]).map((x) => x[fld]));
      if (vals.size === 1 && !p[fld]) p[fld] = [...vals][0];
    }
    const zon = new Set(parts.filter((x) => x.zoning).map((x) => x.zoning));
    if (!p.zoning && zon.size === 1) p.zoning = [...zon][0];
    p.flags.push('portfolio: city/zoning/occupancy taken from its individual listings (matched by parcel number)');
    if ((p.occ ?? null) === null && parts.every((x) => (x.occ ?? null) !== null && x.bsf)) {
      p.occ = Math.round((parts.reduce((s, x) => s + x.occ * x.bsf, 0)
        / parts.reduce((s, x) => s + x.bsf, 0)) * 10) / 10;
      p.occ_basis = 'derived';
    }
    let drop, keep;
    if (p.price && !parts.some((x) => x.price)) { drop = parts; keep = p; } else { drop = [p]; keep = null; }
    for (const d of drop) {
      d.drop_reason = keep
        ? `component of portfolio ${keep.name} (priced as a portfolio)`
        : 'portfolio wrapper; its individual properties are loaded';
    }
  }

  for (const c of comps) {
    for (const frag of drops) {
      if (c.name.toLowerCase().includes(frag.toLowerCase())
        || c.address.toLowerCase().includes(frag.toLowerCase())) {
        c.drop_reason = `excluded by --drop "${frag}"`;
      }
    }
  }
  for (const c of comps) if (c.drop_reason) report.excluded.push(`${c.name}: ${c.drop_reason}`);
  comps = comps.filter((c) => !c.drop_reason);

  let sales = comps.filter((c) => c.kind === 'sale');
  market = comps.filter((c) => c.kind === 'market');

  /* Over the cap, the template keeps the fifteen most recent sales and the
   * priced, freshest listings. With cap off the extra comps are kept but
   * marked `cut`, so a reviewer can swap one in for another. */
  const overCap = (list, reason) => {
    for (const c of list.slice(MAX_COMPS)) {
      if (cap) report.excluded.push(`${c.name}: ${reason(c)}`);
      else c.cut = reason(c);
    }
    return cap ? list.slice(0, MAX_COMPS) : list;
  };
  if (sales.length > MAX_COMPS) {
    sales.sort((a, b) => b.date - a.date);
    sales = overCap(sales, (c) => `over the ${MAX_COMPS}-row cap (older sale, ${mdy(c.date)})`);
  }
  const cmp = (a, b) => (Number(a.price === null || a.price === undefined) - Number(b.price === null || b.price === undefined))
    || (-(ppsf(a) || 0) - -(ppsf(b) || 0))
    || ((a.dom || 0) - (b.dom || 0));
  market.sort(cmp);
  if (market.length > MAX_COMPS) {
    market = overCap(market, (c) => `over the ${MAX_COMPS}-row cap `
      + `(${c.price ? '' : 'unpriced, '}${c.dom || '?'} days on market)`);
  }

  const order = (a, b) => (Number(ppsf(a) === null) - Number(ppsf(b) === null))
    || (-(ppsf(a) || 0) - -(ppsf(b) || 0))
    || ((a.dom || 0) - (b.dom || 0));
  sales.sort(order);
  market.sort(order);

  for (const c of [...sales, ...market]) {
    const z = c.zoning;
    if (z && !zoneKnown(zoningCodes, z)) {
      c.flags.push(`zoning ${z} is not in the Zoning Catalogue -> FAR/buildable SF left blank`);
    } else if (z && (zoneFar(zoningCodes, z) === null || zoneFar(zoningCodes, z) === '')) {
      c.flags.push(`zoning ${z} has no max FAR in the Zoning Catalogue -> buildable SF blank`);
    }
    if (c.kind === 'market' && !c.price) {
      c.flags.push('asking price not disclosed (kept; excluded from Survey Average)');
    }
  }
  return { sales, market };
}

export function mdy(d) {
  if (!d) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())}/${d.getUTCFullYear()}`;
}

/* ------------------------------------------------------------- entry point */

/** Parse already-extracted page text into loaded comps plus a report. */
export function loadComps(docs, { drops = [], zoningCodes = {}, cap = true } = {}) {
  const report = { excluded: [], notes: [], parse: [] };
  const blocks = [];
  for (const d of docs) {
    const found = splitComps(d.pages, d.name);
    if (!found.length) {
      report.parse.push(`${d.name}: no CoStar comp pages recognized (scanned image, or not a CoStar comp report)`);
    }
    blocks.push(...found);
  }
  const comps = [];
  for (const b of blocks) {
    let c;
    try {
      c = parseComp(b);
    } catch (err) {
      report.parse.push(`${b.title} (${b.source}): unreadable layout -- skipped (${err.message})`);
      continue;
    }
    if (c.kind === null) {
      report.parse.push(`${c.name} (${c.source}): neither Sold nor Active -- skipped`);
      continue;
    }
    const missing = [c.kind === 'sale' ? 'price' : 'dom', 'bsf'].filter((k) => !c[k]);
    if (missing.length) report.parse.push(`${c.name} (${c.source}): could not read ${missing.join(', ')}`);
    comps.push(c);
  }
  const { sales, market } = applyRules(comps, drops, zoningCodes, report, { cap });
  return { sales, market, report };
}
