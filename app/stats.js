/* stats.js -- the arithmetic behind every formula the workbook writes.
 *
 * Each exported function mirrors one Excel function so the cached value stored
 * beside a formula is the value Excel will compute when it recalculates. Where
 * they could drift, the Excel function is named in a comment. */

export const nums = (a) => a.filter((v) => typeof v === 'number' && Number.isFinite(v));

export const count = (a) => nums(a).length;
export const min = (a) => (count(a) ? Math.min(...nums(a)) : null);
export const max = (a) => (count(a) ? Math.max(...nums(a)) : null);
export const sum = (a) => nums(a).reduce((s, v) => s + v, 0);
export const mean = (a) => (count(a) ? sum(a) / count(a) : null);

/** Excel PERCENTILE / PERCENTILE.INC: linear interpolation on rank p*(n-1). */
export function percentile(a, p) {
  const v = nums(a).sort((x, y) => x - y);
  if (!v.length) return null;
  if (v.length === 1) return v[0];
  const r = p * (v.length - 1);
  const lo = Math.floor(r);
  const hi = Math.ceil(r);
  return lo === hi ? v[lo] : v[lo] + (r - lo) * (v[hi] - v[lo]);
}

export const median = (a) => percentile(a, 0.5);

/** SF-weighted dollars per square foot: total price over total size.
 *  Only pairs where both numbers are present contribute, so an unpriced
 *  listing cannot add size to the denominator without adding to the numerator. */
export function weightedPpsf(prices, sizes) {
  let p = 0;
  let s = 0;
  for (let i = 0; i < prices.length; i++) {
    const pr = prices[i];
    const sz = sizes[i];
    if (typeof pr === 'number' && typeof sz === 'number' && Number.isFinite(pr) && Number.isFinite(sz)) {
      p += pr; s += sz;
    }
  }
  return s ? p / s : null;
}

/** Weighted mean of any series (Excel SUMPRODUCT/SUMIF pair). */
export function weightedMean(values, weights) {
  let n = 0;
  let d = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const w = weights[i];
    if (typeof v === 'number' && typeof w === 'number' && Number.isFinite(v) && Number.isFinite(w)) {
      n += v * w; d += w;
    }
  }
  return d ? n / d : null;
}

function pairs(ys, xs) {
  const out = [];
  for (let i = 0; i < ys.length; i++) {
    if (typeof ys[i] === 'number' && typeof xs[i] === 'number'
      && Number.isFinite(ys[i]) && Number.isFinite(xs[i])) out.push([xs[i], ys[i]]);
  }
  return out;
}

/** Excel SLOPE(known_y, known_x). */
export function slope(ys, xs) {
  const p = pairs(ys, xs);
  if (p.length < 2) return null;
  const mx = p.reduce((s, [x]) => s + x, 0) / p.length;
  const my = p.reduce((s, [, y]) => s + y, 0) / p.length;
  let num = 0;
  let den = 0;
  for (const [x, y] of p) { num += (x - mx) * (y - my); den += (x - mx) ** 2; }
  return den ? num / den : null;
}

/** Excel RSQ(known_y, known_x). */
export function rsq(ys, xs) {
  const p = pairs(ys, xs);
  if (p.length < 2) return null;
  const mx = p.reduce((s, [x]) => s + x, 0) / p.length;
  const my = p.reduce((s, [, y]) => s + y, 0) / p.length;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of p) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  return sxx && syy ? (sxy * sxy) / (sxx * syy) : null;
}

export const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/** A JS date as an Excel serial number. */
export function serial(d) {
  if (!d) return null;
  return (d.getTime() - EXCEL_EPOCH) / 86400000;
}
