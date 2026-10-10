/* engine/money.js -- how money is kept: totals (prices, NOI, income and
 * expense lines, annual and monthly rents, TI and fee totals, comp prices) to
 * whole cents; rates per unit (rent per SF a year or a month, market rent,
 * TI per SF, $/SF targets, price per SF or per unit) to four decimal places.
 * Calculated figures (IRR, payments, values) are not rounded: they are worked
 * out in full and rounded only when shown.
 *
 * Values are kept as ordinary numbers rounded to those places (not as integer
 * cents), so every module, backup and workbook reads them unchanged. Each
 * function that rounds stored data also returns what it changed: { path, old,
 * new }, for the migration log. */

const ok = (x) => typeof x === 'number' && Number.isFinite(x);

/** Round half away from zero to `dp` places, exactly for decimal input (1.005 → 1.01). */
export function roundTo(v, dp) {
  if (!ok(v)) return v;
  const shift = (x, k) => { const [m, e] = String(x).split('e'); return Number(`${m}e${(Number(e) || 0) + k}`); };
  const r = shift(Math.round(shift(Math.abs(v), dp)), -dp);
  return v < 0 ? -r : r;
}
export const toCents = (v) => roundTo(v, 2);
export const toRate = (v) => roundTo(v, 4);

/* -------------------------------------------------------------- one deal */

const FIGURE_TOTALS = ['price', 'noi', 'gpr', 'gross', 'opex', 'taxes', 'noi_pf'];
const FIGURE_RATES = ['price_psf', 'price_unit'];
const LIVE_TOTALS = ['price', 'noi'];
const RATE_UNITS = new Set(['psf_year', 'psf_month']);

/** Round a deal's stored money in place. Returns { deal, changes: [{ path, old, new }] }. */
export function quantizeDeal(deal) {
  const changes = [];
  const fix = (obj, key, path, round) => {
    if (!obj || !ok(obj[key])) return;
    const v = round(obj[key]);
    if (v !== obj[key]) { changes.push({ path, old: obj[key], new: v }); obj[key] = v; }
  };
  const f = deal.figures || {};
  for (const k of FIGURE_TOTALS) fix(f, k, `figures.${k}`, toCents);
  for (const k of FIGURE_RATES) fix(f, k, `figures.${k}`, toRate);
  for (const k of LIVE_TOTALS) fix(deal.live, k, `live.${k}`, toCents);
  (deal.scenarios || []).forEach((s, i) => { for (const k of LIVE_TOTALS) fix(s.over, k, `scenarios[${i}].${k}`, toCents); });
  (deal.rentRoll || []).forEach((r, i) => {
    const who = `rentRoll[${i}]${r.suite ? ` (${r.suite})` : ''}`;
    fix(r, 'annual', `${who}.annual`, toCents); fix(r, 'monthly', `${who}.monthly`, toCents);
    fix(r, 'psf', `${who}.psf`, toRate); fix(r, 'marketRent', `${who}.marketRent`, toRate);
  });
  const rr = deal.rr;
  if (rr) {
    const s = rr.settings || {};
    fix(s, 'opex', 'rr.settings.opex', toCents); fix(s, 'recoverable', 'rr.settings.recoverable', toCents);
    fix(s, 'marketRent', 'rr.settings.marketRent', toRate); fix(s, 'reservesPsf', 'rr.settings.reservesPsf', toRate);
    (s.otherIncome || []).forEach((o, i) => fix(o, 'annual', `rr.settings.otherIncome[${i}].annual`, toCents));
    if (s.renewal) { fix(s.renewal, 'renewTi', 'rr.settings.renewal.renewTi', toRate); fix(s.renewal, 'newTi', 'rr.settings.renewal.newTi', toRate); }
    (rr.leases || []).forEach((L, i) => {
      const who = `rr.leases[${i}]${L.unit ? ` (unit ${L.unit})` : ''}`;
      (L.periods || []).forEach((p, j) => fix(p, 'rate', `${who}.periods[${j}].rate`, RATE_UNITS.has(p.unit) ? toRate : toCents));
      fix(L, 'marketRent', `${who}.marketRent`, toRate);
      (L.oneTime || []).forEach((o, j) => fix(o, 'amount', `${who}.oneTime[${j}].amount`, toCents));
      if (L.recovery) { fix(L.recovery, 'amount', `${who}.recovery.amount`, toCents); fix(L.recovery, 'baseAmount', `${who}.recovery.baseAmount`, toCents); fix(L.recovery, 'stopPsf', `${who}.recovery.stopPsf`, toRate); }
      if (L.percentRent) { fix(L.percentRent, 'sales', `${who}.percentRent.sales`, toCents); fix(L.percentRent, 'breakpoint', `${who}.percentRent.breakpoint`, toCents); }
    });
  }
  return { deal, changes };
}

/* ------------------------------------------------- comps and tool inputs */

/** Round the comp set's typed prices (hand-entered comps and edits to read ones). */
export function quantizeSession(session) {
  const changes = [];
  if (!session) return { session, changes };
  (session.manual || []).forEach((c, i) => {
    if (ok(c.price)) { const v = toCents(c.price); if (v !== c.price) { changes.push({ path: `manual[${i}]${c.address ? ` (${c.address})` : ''}.price`, old: c.price, new: v }); c.price = v; } }
  });
  for (const [key, e] of Object.entries(session.edits || {})) {
    if (e && ok(e.price)) { const v = toCents(e.price); if (v !== e.price) { changes.push({ path: `edits[${key}].price`, old: e.price, new: v }); e.price = v; } }
  }
  return { session, changes };
}

/** Is a tool input a rate per unit (kept to four decimals) rather than a total (cents)? */
export const isRateInput = (kind, label) => kind === 'money2' || (kind === 'money' && /\$\/SF|\/SF|per SF|per unit/i.test(String(label || '')));

/** Round one typed tool input by its kind; other kinds pass through. */
export function quantizeToolInput(kind, label, v) {
  if (!ok(v) || !['money', 'money2'].includes(kind)) return v;
  return isRateInput(kind, label) ? toRate(v) : toCents(v);
}

/** Round a set of saved tool values ({ key: value }) against the tool's inputs; returns the changes. */
export function quantizeToolValues(values, inputs, where = '') {
  const changes = [];
  for (const [key, label, kind] of inputs || []) {
    if (!values || !ok(values[key])) continue;
    const v = quantizeToolInput(kind, label, values[key]);
    if (v !== values[key]) { changes.push({ path: `${where}${key}`, old: values[key], new: v }); values[key] = v; }
  }
  return changes;
}
