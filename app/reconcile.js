/* reconcile.js -- checking figures against their sources and against each
 * other, without any AI: every rule here is arithmetic or a text search, so
 * the same inputs always give the same answer.
 *
 * - verifyQuote: is the passage a reader (the AI, or a person) cites really
 *   on that page, and does it contain the figure?
 * - reconcile: readings of the same field from several documents, grouped
 *   into values that agree within a tolerance. It never picks a winner: the
 *   broker does.
 * - crossChecks: the rent roll against the OM's own figures.
 *
 * Pure functions, no DOM: tested in Node (tests/reconcile.test.js). */

const ok = (x) => typeof x === 'number' && Number.isFinite(x);

/* ---------------------------------------------------------- normalizing */

/** A figure as printed ("$6.45M", "6,450,000", "(12,500)", "10,000 SF") to a number. */
export function parseFigure(raw) {
  if (ok(raw)) return raw;
  if (typeof raw !== 'string') return null;
  let s = raw.trim().toLowerCase().replace(/[−–]/g, '-');
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s);
  s = s.replace(/[()$,\s]/g, '').replace(/^-/, '');
  const m = s.match(/^(\d+(?:\.\d+)?|\.\d+)(k|m|mm|b|bn|thousand|million|billion)?/);
  if (!m) return null;
  let n = Number(m[1]);
  const mult = { k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9 }[m[2]];
  if (mult) n *= mult;
  return neg ? -n : n;
}

/** Every number printed in a passage, with suffixes ("$6.45 million" -> 6450000). */
export function numbersIn(text) {
  const out = [];
  const re = /\(?-?\$?\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)\s?(k|mm|m|b|bn|thousand|million|billion)?\b\)?/gi;
  for (const m of String(text || '').matchAll(re)) {
    const v = parseFigure(`${m[0].startsWith('(') && m[0].endsWith(')') ? '(' : ''}${m[1]}${m[2] || ''}${m[0].startsWith('(') && m[0].endsWith(')') ? ')' : ''}`);
    if (ok(v)) out.push(v);
  }
  return out;
}

/** The value a field takes, from what a document printed. Text stays text. */
export function normalizeValue(kind, raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (kind === 'text') return String(raw).trim() || null;
  const n = parseFigure(String(raw));
  if (!ok(n)) return null;
  if (kind === 'pct') {
    // "0.061" printed as a fraction is 6.1%; "6.1%" or "6.1" is 6.1
    return /%/.test(String(raw)) || n >= 1 ? n : n * 100;
  }
  if (kind === 'year') return n >= 1800 && n <= 2200 ? Math.round(n) : null;
  if (kind === 'int') return Math.round(n);
  return n;
}

/** Tolerances: money within 0.5%, areas and counts within 1%, rates within 0.05 points. */
export function sameValue(kind, a, b) {
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (kind === 'text') return squash(a) === squash(b);
  if (!ok(a) || !ok(b)) return false;
  if (kind === 'pct') return Math.abs(a - b) <= 0.05 + 1e-9;
  if (kind === 'year') return a === b;
  const tol = kind === 'int' ? 0.01 : 0.005;
  const big = Math.max(Math.abs(a), Math.abs(b));
  return big === 0 || Math.abs(a - b) / big <= tol + 1e-12;
}

/** Text for searching: lower case, one kind of quote and dash, no spaces at all (PDF text spaces unpredictably). */
export const squash = (s) => String(s || '').toLowerCase()
  .replace(/[‘’‛]/g, "'").replace(/[“”]/g, '"').replace(/[‐-―−]/g, '-')
  .replace(/ /g, ' ').replace(/\s+/g, '');

/* -------------------------------------------------------- verifying quotes */

/**
 * pages: the document's page texts (index 0 = page 1), or one string for a
 * text document. Returns { status, page, note }:
 *   verified           the passage is on that page and holds the figure
 *   other-page         the passage is on another page (that page is returned)
 *   value-not-in-quote the passage is there but does not hold the figure
 *   not-found          the passage is nowhere in the document
 */
export function verifyQuote(pages, page, quote, value, kind) {
  const list = Array.isArray(pages) ? pages : [String(pages || '')];
  const q = squash(quote);
  if (q.length < 3) return { status: 'not-found', page: null, note: 'No passage was given.' };
  const onPage = ok(page) && page >= 1 && page <= list.length && squash(list[page - 1]).includes(q);
  let where = onPage ? page : null;
  if (!where) { const i = list.findIndex((t) => squash(t).includes(q)); if (i >= 0) where = i + 1; }
  if (!where) return { status: 'not-found', page: null, note: 'The quoted passage is not in the document.' };
  const holds = kind === 'text' ? q.includes(squash(value)) || squash(value).includes(q)
    : numbersIn(quote).some((n) => sameValue(kind, normalizeValue(kind, String(n)), value) || sameValue(kind, n, value));
  if (!holds) return { status: 'value-not-in-quote', page: where, note: 'The passage does not contain this figure.' };
  if (!onPage && list.length > 1) return { status: 'other-page', page: where, note: `Found on page ${where}${ok(page) ? `, not page ${page}` : ''}.` };
  return { status: 'verified', page: where, note: null };
}

/* -------------------------------------------------------------- reconcile */

/**
 * readings: [{ key, value, source: { kind, label, page, quote, verified } }]
 * kinds: { key: 'money' | 'pct' | 'int' | 'year' | 'money2' | 'text' }
 * Returns one entry per key: { key, status: 'single' | 'agree' | 'conflict',
 * groups: [{ value, readings }], spreadPct } -- the groups in the order first
 * seen. It never chooses: a conflict is shown to the broker with every source.
 */
export function reconcile(readings, kinds) {
  const byKey = new Map();
  for (const r of readings) {
    if (r.value === null || r.value === undefined || r.value === '') continue;
    if (!byKey.has(r.key)) byKey.set(r.key, []);
    byKey.get(r.key).push(r);
  }
  const out = [];
  for (const [key, rs] of byKey) {
    const kind = kinds[key] || 'money';
    const groups = [];
    for (const r of rs) {
      const g = groups.find((x) => sameValue(kind, x.value, r.value));
      if (g) g.readings.push(r); else groups.push({ value: r.value, readings: [r] });
    }
    const nums = groups.map((g) => g.value).filter(ok);
    const spreadPct = kind !== 'text' && kind !== 'pct' && nums.length > 1 && Math.min(...nums.map(Math.abs)) > 0
      ? ((Math.max(...nums) - Math.min(...nums)) / Math.min(...nums.map(Math.abs))) * 100 : null;
    out.push({ key, kind, status: rs.length === 1 ? 'single' : groups.length === 1 ? 'agree' : 'conflict', groups, spreadPct });
  }
  return out;
}

/* ------------------------------------------------------------ cross-checks */

/**
 * The rent roll against the OM's figures. figures: the deal's figures; rr: a
 * rentRollSummary. Each issue: { id, level: 'warn' | 'info', text, keys }.
 */
export function crossChecks(figures, rr) {
  const out = [];
  if (!rr || !rr.units) return out;
  const f = figures || {};
  const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
  if (ok(f.occ) && ok(rr.occupancy) && Math.abs(f.occ - rr.occupancy) > 2) {
    out.push({ id: 'occ', level: 'warn', keys: ['occ'], text: `The OM states ${f.occ.toFixed(1)}% occupancy; the rent roll's leases fill ${rr.occupancy.toFixed(1)}% of its SF.` });
  }
  if (ok(f.bsf) && ok(rr.totalSf) && Math.abs(f.bsf - rr.totalSf) / f.bsf > 0.02) {
    out.push({ id: 'sf', level: 'warn', keys: ['bsf'], text: `The rent roll's units add up to ${Math.round(rr.totalSf).toLocaleString('en-US')} SF; the building is stated as ${Math.round(f.bsf).toLocaleString('en-US')} SF${rr.totalSf < f.bsf ? ' (a unit may be missing, or common area counted in the building)' : ''}.` });
  }
  if (ok(f.gpr) && rr.annualRent > f.gpr * 1.02) {
    out.push({ id: 'gpr', level: 'warn', keys: ['gpr'], text: `In-place rent on the rent roll (${money(rr.annualRent)}) is more than the stated gross potential rent (${money(f.gpr)}), which should include vacant space at market.` });
  }
  if (ok(f.gross) && !ok(f.gpr) && rr.annualRent > f.gross * 1.1) {
    out.push({ id: 'gross', level: 'info', keys: ['gross'], text: `In-place rent on the rent roll (${money(rr.annualRent)}) is well above the stated gross income (${money(f.gross)}): check the period each covers.` });
  }
  if (ok(f.units) && rr.units && f.units !== rr.units && Math.abs(f.units - rr.units) / f.units > 0.05) {
    out.push({ id: 'units', level: 'info', keys: ['units'], text: `The rent roll has ${rr.units} rows; the OM states ${f.units} units.` });
  }
  return out;
}
