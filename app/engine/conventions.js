/* engine/conventions.js -- every convention the calculations use, in one
 * place, with its current setting. The settable ones are chosen in Settings
 * (kept on the device as kv `conventions`); the rest are stated so a reader
 * can see exactly how a number was worked out. Defaults reproduce the app's
 * behaviour, so nothing changes unless someone changes a setting. */

export const CONVENTIONS = [
  {
    id: 'walt.weight', label: 'WALT weighting', settable: true, default: 'income',
    options: [['income', 'By income'], ['sf', 'By area (SF)']],
    help: 'Which WALT is shown as the headline. Both are worked out; this picks the one shown as “WALT”.',
  },
  {
    id: 'walt.mtm', label: 'Month-to-month leases in WALT', settable: true, default: 'exclude',
    options: [['exclude', 'Left out'], ['zero', 'Counted at 0 years']],
    help: 'A month-to-month lease has no term left to weight. Left out, it doesn’t move WALT; counted at 0 years, it pulls WALT down by its share.',
  },
  { id: 'walt.from', label: 'WALT measured from', value: 'The rent roll’s as-of date (the WALT tool: today)' },
  { id: 'years', label: 'Years between dates', value: 'Whole days ÷ 365.25' },
  { id: 'debt.term', label: 'Loan payments', value: 'Monthly, over a whole number of months (amortization years × 12, rounded), shown a year at a time' },
  { id: 'returns.timing', label: 'IRR and DCF', value: 'Annual cash flows at year end; the sale priced on the following year’s NOI' },
  { id: 'ner', label: 'Net effective rent', value: 'Escalations compound at each lease anniversary; free months at the rent then in force; less TI, and commissions when entered; ÷ term in years ÷ SF. Discounted: the level rent with the same present value, monthly in advance' },
  { id: 'breakeven', label: 'Break-even occupancy', value: '(Expenses + debt service − income not tied to occupancy) ÷ gross potential rent; without GPR, estimated from gross income and its occupancy, and labelled' },
  { id: 'comps.priced', label: 'Comps in $/SF figures', value: 'Only comps with a price and building SF above zero' },
  { id: 'money', label: 'Money kept', value: 'Totals to whole cents; rates per SF or per unit to four decimals' },
  { id: 'noi.threeWays', label: 'NOI three ways (a deal with a T-12)', value: 'The OM’s, the T-12’s and the rent roll’s forward-looking year 1 compared in pairs, the gap as a share of the larger: within 2% they agree; 2% to 5% is noted; above 5% is a warning. A T-12 of fewer than 12 months, or with lines still to review, isn’t compared' },
  { id: 't12.months', label: 'A T-12 of fewer than 12 months', value: 'Its months as they are: never scaled up to a year' },
];
/** The NOI three ways thresholds, in percent of the larger NOI (convention noi.threeWays). */
export const NOI_GAP = { agree: 2, warn: 5 };

const current = Object.fromEntries(CONVENTIONS.filter((c) => c.settable).map((c) => [c.id, c.default]));

/** The current setting of a settable convention. */
export const conv = (id) => current[id];

/** Apply saved settings (unknown ids and values are ignored). */
export function setConventions(saved) {
  for (const c of CONVENTIONS) {
    if (!c.settable || !saved || !(c.id in saved)) continue;
    if (c.options.some(([v]) => v === saved[c.id])) current[c.id] = saved[c.id];
  }
  return { ...current };
}

/** All settable values, for saving. */
export const conventionValues = () => ({ ...current });
