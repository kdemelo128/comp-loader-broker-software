/* engine/breakeven.js -- break-even occupancy, one definition for the deal,
 * the deal brief, the workbook and the Break-even tool:
 *   (operating expenses + annual debt service − income not tied to occupancy)
 *   ÷ gross potential rent.
 * Without gross potential rent it is estimated from gross income scaled up
 * from the occupancy it was earned at; with neither, it can only be a share of
 * current income. The basis comes back with the figure, for its label. */

const ok = (x) => typeof x === 'number' && Number.isFinite(x);
const pos = (x) => ok(x) && x > 0;

export const BREAK_EVEN_LABEL = {
  gpr: 'Break-even occupancy',
  'egi-occ': 'Break-even occupancy (est.)',
  egi: 'Break-even, share of current income',
};

/**
 * @param {{ gpr?: UsdPerYear, gross?: UsdPerYear, occ?: Pct, opex?: UsdPerYear, debtService?: UsdPerYear, otherIncome?: UsdPerYear }} parts
 * @returns {{ value: Pct, basis: string, label: string, need: UsdPerYear, cushion: Points } | null}
 */
export function breakEvenOccupancy({ gpr, gross, occ, opex, debtService = 0, otherIncome = 0 }) {
  if (!ok(opex)) return null;
  const need = opex + (ok(debtService) ? debtService : 0) - (ok(otherIncome) ? otherIncome : 0);
  let value = null; let basis = null;
  if (pos(gpr)) { value = (need / gpr) * 100; basis = 'gpr'; } else if (pos(gross)) {
    const ratio = (need / gross) * 100;
    if (pos(occ)) { value = ratio * (occ / 100); basis = 'egi-occ'; } else { value = ratio; basis = 'egi'; }
  }
  if (value === null) return null;
  return { value, basis, label: BREAK_EVEN_LABEL[basis], need, cushion: 100 - value };
}
