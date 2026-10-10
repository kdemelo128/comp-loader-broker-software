/* engine/comps.js -- what counts in a comp set's $/SF figures, one rule for
 * the deal screen, Comps "At a glance", the comp-set check tool and the comp
 * workbook: a comp counts only with a price and building SF both above zero.
 * Medians are true medians (the average of the two middle values for an even
 * count), as Excel's MEDIAN. */

const ok = (x) => typeof x === 'number' && Number.isFinite(x);
const pos = (x) => ok(x) && x > 0;

/** Does this comp count toward $/SF figures? */
export const isPriced = (c) => !!c && pos(c.price) && pos(c.bsf);

export function median(xs) {
  const v = (xs || []).filter(ok).sort((a, b) => a - b);
  if (!v.length) return null;
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
}

/** Total price over total size, over the pairs where both are above zero. */
export function weightedPpsf(prices, sizes) {
  let p = 0; let s = 0;
  for (let i = 0; i < prices.length; i++) if (pos(prices[i]) && pos(sizes[i])) { p += prices[i]; s += sizes[i]; }
  return s ? p / s : null;
}

/** What the comp set says, in the form the deal screen needs. */
export function compBasis(sales) {
  const priced = (sales || []).filter(isPriced);
  const ppsfs = priced.map((c) => c.price / c.bsf);
  const caps = (sales || []).map((c) => c.cap).filter((x) => pos(x));
  return {
    n: priced.length,
    weighted: weightedPpsf(priced.map((c) => c.price), priced.map((c) => c.bsf)),
    median: median(ppsfs),
    lo: ppsfs.length ? Math.min(...ppsfs) : null,
    hi: ppsfs.length ? Math.max(...ppsfs) : null,
    ppsfs,
    capN: caps.length,
    medianCap: median(caps),
  };
}
