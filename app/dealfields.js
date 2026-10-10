/* dealfields.js -- what a deal can put into a firm's own workbook.
 *
 * Each field: its label, the words a template uses for it (`re`, tried on a
 * label in lower case; `exact` marks an unambiguous label), how it is
 * written (`type`), and where its value comes from. `get(ctx)` returns
 * { value, source } so every cell filled can say what it rests on: the OM
 * (with its page), a figure the broker typed, the app's arithmetic, the rent
 * roll, or a scenario assumption. */

import { waltMethod } from './engine/walt.js';

const ok = (x) => typeof x === 'number' && Number.isFinite(x);

/** Where a deal figure came from, in words. */
export function sourceOf(deal, key, m) {
  if (m && m.derived && m.derived[key]) return 'calculated from the other figures';
  const s = deal.sources && deal.sources[key];
  if (!s) return deal.figures && deal.figures[key] !== undefined ? 'entered' : '';
  if (s.hand) return 'typed by the broker';
  if (s.page) return `OM page ${s.page}`;
  return 'read from the OM';
}

const fig = (key, label, type, re, exact) => ({
  key, label, type, re, exact, group: 'Property and offering',
  get: ({ deal, m }) => {
    const v = key === 'price' ? m.price : key === 'noi' ? m.noi : deal.figures[key];
    return { value: v ?? null, source: sourceOf(deal, key, m) };
  },
});
const calc = (key, label, type, re, get, why, exact) => ({
  key, label, type, re, exact, group: 'Calculated',
  get: (ctx) => { const v = get(ctx); return { value: ok(v) || typeof v === 'string' ? v : null, source: typeof why === 'function' ? why() : why }; },
});

export const DEAL_FIELDS = [
  fig('address', 'Address', 'text', /^(property )?address$|^street address|^location$|^site address/, /^(property )?address$/),
  fig('city', 'City', 'text', /^city$|^municipality$/),
  fig('state', 'State', 'text', /^state$/),
  fig('zip', 'ZIP', 'text', /^zip|^postal/),
  fig('ptype', 'Property type', 'text', /^(property|asset)\s*type$|^asset class$|^product type$/),
  fig('year', 'Year built', 'int', /^year\s*built$|^yr\.?\s*built$|^built$/, /^year\s*built$/),
  fig('bsf', 'Building SF', 'int', /^(building|rentable|net rentable|gross)\s*(sf|area|size|square feet)$|^(nra|rba|gla|rsf)$|^square feet$|^total sf$/, /^(building sf|nra|rba|rentable sf)$/),
  fig('lot_sf', 'Land SF', 'int', /^(land|lot|site)\s*(sf|area|size)$/),
  fig('units', 'Units', 'int', /^(number of |total |# of )?units$|^unit count$|^apartment units$/, /^(number of units|total units|units)$/),
  fig('zoning', 'Zoning', 'text', /^zoning$/),
  fig('price', 'Purchase / asking price', 'money', /^(purchase|asking|offering|sale|acquisition|contract)\s*price$|^price$|^purchase price \(\$\)$/, /^(purchase|asking) price$/),
  fig('noi', 'NOI (in place)', 'money', /^(in[- ]place |current |year 1 |t-?12 )?(net operating income|noi)$/, /^(net operating income|noi)$/),
  fig('cap', 'Cap rate (stated in the OM)', 'pct', /^(going[- ]in |in[- ]place |stated |asking )?cap(italization)? rate$/, /^(going-in|going in) cap rate$/),
  fig('occ', 'Occupancy', 'pct', /^(current |physical )?occupancy$|^% leased$|^percent leased$/),
  fig('gpr', 'Gross potential rent', 'money', /^gross potential (rent|income)$|^gpr$|^potential gross income$/),
  fig('gross', 'Effective gross income', 'money', /^effective gross (income|revenue)$|^egi$|^total (operating )?(income|revenue)$/),
  fig('opex', 'Operating expenses', 'money', /^(total )?operating expenses$|^total expenses$|^opex$/),
  fig('taxes', 'Real estate taxes', 'money', /^(real estate|property) tax(es)?$/),
  fig('noi_pf', 'NOI (pro forma)', 'money', /^pro[- ]?forma (net operating income|noi)$|^stabili[sz]ed noi$/),
  fig('tenant', 'Tenant', 'text', /^tenant$/),
  fig('lease_exp', 'Lease expiration', 'text', /^lease expiration$/),
  calc('capCalc', 'Cap rate (NOI ÷ price)', 'pct', /^(calculated |implied )?cap rate on (price|ask)|^implied cap rate$/, ({ m }) => m.capCalc, 'calculated: NOI ÷ price'),
  calc('ppsf', 'Price per SF', 'money2', /^price\s*(\/|per)\s*(sf|square foot|rsf)$|^\$\s*\/\s*sf$/, ({ m }) => m.ppsf, 'calculated: price ÷ building SF', /^price per sf$/),
  calc('perUnit', 'Price per unit', 'money', /^price\s*(\/|per)\s*unit$/, ({ m }) => m.perUnit, 'calculated: price ÷ units'),
  calc('ltv', 'Loan to value', 'pct', /^(ltv|loan[- ]to[- ]value)( %)?$/, ({ deal }) => (deal.loan || {}).ltv, 'financing assumption'),
  calc('rate', 'Interest rate', 'pct', /^(interest )?rate$|^interest rate$|^coupon$/, ({ deal }) => (deal.loan || {}).rate, 'financing assumption', /^interest rate$/),
  calc('amort', 'Amortization (years)', 'int', /^amorti[sz]ation( \(?years\)?| period)?$/, ({ deal }) => (deal.loan || {}).amort, 'financing assumption'),
  calc('loan', 'Loan amount', 'money', /^loan( amount)?$|^(senior |first mortgage )?loan amount$|^debt$/, ({ m }) => m.loan, 'calculated: price × LTV', /^loan amount$/),
  calc('debtService', 'Annual debt service', 'money', /^(annual )?debt service$/, ({ m }) => m.debtService, 'calculated from the loan terms'),
  calc('dscr', 'DSCR', 'dec', /^dscr$|^debt service coverage( ratio)?$/, ({ m }) => m.dscr, 'calculated: NOI ÷ debt service'),
  calc('debtYield', 'Debt yield', 'pct', /^debt yield$/, ({ m }) => m.debtYield, 'calculated: NOI ÷ loan'),
  calc('equity', 'Equity required', 'money', /^(total )?equity( required)?$|^equity investment$/, ({ m }) => m.equity, 'calculated: price − loan + closing costs'),
  calc('cashOnCash', 'Cash-on-cash (year 1)', 'pct', /^cash[- ]on[- ]cash( return)?$/, ({ m }) => m.cashOnCash, 'calculated: cash flow ÷ equity'),
  calc('rrRent', 'In-place rent (rent roll)', 'money', /^(in[- ]place|current|annual(ized)?) (base )?rent$|^total annual rent$/, ({ rrSum }) => rrSum && rrSum.annualRent, 'rent roll: rent in force on its as-of date'),
  calc('rrOcc', 'Occupancy (rent roll, by SF)', 'pct', /^occupancy \(rent roll\)$|^leased %$/, ({ rrSum }) => rrSum && rrSum.occupancy, 'rent roll: leased SF ÷ total SF'),
  calc('walt', 'WALT (years)', 'dec', /^walt( \(?years\)?)?$|^weighted average lease term$/, ({ rrSum }) => rrSum && rrSum.walt, () => `rent roll: WALT ${waltMethod()}`),
  calc('rrNoi1', 'NOI, year 1 (rent roll projection)', 'money', /^year 1 noi$|^noi year 1$|^projected noi$/, ({ rrProj }) => rrProj && rrProj.annual[0] && rrProj.annual[0].noi, 'rent roll projection, year 1'),
  calc('exitCap', 'Exit cap rate', 'pct', /^(exit|terminal|residual|reversion) cap( rate)?$/, ({ scenario }) => scenario && scenario.inputs.exitCap, 'scenario assumption'),
  calc('hold', 'Hold period (years)', 'int', /^hold( period)?( \(?years\)?)?$|^investment horizon$/, ({ scenario }) => scenario && scenario.inputs.hold, 'scenario assumption'),
  calc('leveredIrr', 'Levered IRR', 'pct', /^levered irr$|^irr \(levered\)$/, ({ scenario }) => scenario && scenario.returns && scenario.returns.leveredIrr, 'calculated from the scenario'),
  calc('unleveredIrr', 'Unlevered IRR', 'pct', /^unlevered irr$|^irr \(unlevered\)$/, ({ scenario }) => scenario && scenario.returns && scenario.returns.unleveredIrr, 'calculated from the scenario'),
  calc('multiple', 'Equity multiple', 'dec', /^equity multiple$|^moic$/, ({ scenario }) => scenario && scenario.returns && scenario.returns.leveredMultiple, 'calculated from the scenario'),
  {
    key: 'dealName', label: 'Deal name', type: 'text', group: 'Deal', re: /^(deal|property|project) name$|^property$|^deal$/, exact: /^(deal|property) name$/,
    get: ({ deal }) => ({ value: deal.name || deal.figures.address || null, source: 'the deal' }),
  },
  {
    key: 'preparedBy', label: 'Prepared by', type: 'text', group: 'Deal', re: /^prepared by$|^analyst$|^broker$/,
    get: ({ preparedBy }) => ({ value: preparedBy || null, source: 'settings' }),
  },
  {
    key: 'today', label: 'Date prepared', type: 'date', group: 'Deal', re: /^(as of|date|prepared on|analysis date|date prepared)$/,
    get: ({ today }) => ({ value: today || new Date(), source: 'the date the file was made' }),
  },
];
export const DEAL_FIELD = Object.fromEntries(DEAL_FIELDS.map((f) => [f.key, f]));

/** Every field's value for a deal: { key: { value, type, source, label } }. */
export function dealValues(ctx) {
  const out = {};
  for (const F of DEAL_FIELDS) {
    const { value, source } = F.get(ctx);
    out[F.key] = { value: F.type === 'date' && value && !(value instanceof Date) ? new Date(value) : value, type: F.type, source, label: F.label };
  }
  return out;
}

/** Rent roll columns a template table can take, by the words of its headings. */
export const RR_TABLE_FIELDS = [
  { key: 'unit', label: 'Unit / suite', type: 'text', re: /^(unit|suite|ste|space|apt)\b|unit\s*#|suite\s*#/ },
  { key: 'tenant', label: 'Tenant', type: 'text', re: /tenant|lessee|occupant|resident/ },
  // rent per SF before SF: "Rent / SF" names a rent, not an area
  { key: 'psf', label: 'Rent / SF / yr', type: 'money2', re: /(rent|rate).*(psf|\/\s?sf|per sf)|^psf$|\$\/sf/ },
  { key: 'sf', label: 'SF', type: 'int', re: /\b(sf|rsf|nra|sq\.?\s?ft|size|area)\b|square\s*f/ },
  { key: 'leaseStart', label: 'Lease start', type: 'date', re: /(lease )?(start|commence)|move[- ]?in/ },
  { key: 'leaseEnd', label: 'Lease end', type: 'date', re: /(lease )?(end|expir|exp\b)|move[- ]?out|lxd/ },
  { key: 'annual', label: 'Annual rent', type: 'money', re: /annual|yearly|\/yr|per year|base rent/ },
  { key: 'monthly', label: 'Monthly rent', type: 'money', re: /monthly|\/mo|per month|current rent|rent$/ },
  { key: 'marketRent', label: 'Market rent', type: 'money2', re: /market/ },
  { key: 'status', label: 'Status', type: 'text', re: /status|occupied|vacan/ },
];
export function rrFieldForHeader(text) {
  const h = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!h || h.length > 50) return null;
  for (const f of RR_TABLE_FIELDS) if (f.re.test(h)) return f.key;
  return null;
}
