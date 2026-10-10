/* sample.js -- an invented comp set for trying the tool without PDFs.
 *
 * None of these are real transactions or real properties: the names say so,
 * and every comp carries a flag saying so, which travels into the workbook.
 * The set is built to show the rules at work -- an unpriced listing, one under
 * contract, a zoning code outside the catalogue, a sale that sold vacant. */
import { applyRules } from './costar.js';

const NOTE = 'EXAMPLE DATA -- an invented comp for demonstration, not a real transaction';

const d = (y, m, day) => new Date(Date.UTC(y, m - 1, day));

/** @type {any[][]} */
const SALES = [
  ['Example Sale A', 'MU-4', d(2025, 11, 14), 6150000, 7400, 5.6, 100, 4100, 1912, 'B'],
  ['Example Sale B', 'MU-4', d(2025, 6, 2), 4300000, 5600, null, 0, 3050, 1928, 'C'],
  ['Example Sale C', 'MU-12', d(2026, 3, 20), 8900000, 11800, 6.1, 92, 4800, 1965, 'B'],
  ['Example Sale D', 'MU-4', d(2024, 9, 9), 3350000, 4950, 6.4, 100, 2900, 1905, 'C'],
  ['Example Sale E', 'MU-13', d(2026, 1, 28), 5200000, 7900, null, 85, 3700, 1940, 'B'],
  ['Example Sale F', 'NC-8', d(2025, 2, 17), 2600000, 4200, 6.9, 100, 2400, 1920, 'C'],
  ['Example Sale G', 'MU-4', d(2024, 4, 30), 7450000, 12600, 5.9, 100, 6200, 1978, 'B'],
];

/** @type {any[][]} */
const LISTINGS = [
  ['Example Listing H', 'MU-4', 61, 4950000, 5900, 5.8, 100, 3200, 1915, null],
  ['Example Listing J', 'MU-12', 214, 9800000, 13900, 6.3, 88, 5600, 1972, null],
  ['Example Listing K', 'MU-4', 33, null, 6800, null, 100, 3400, 1931, null],
  ['Example Listing L', 'MU-13', 402, 3900000, 6100, 6.6, 75, 2950, 1908, null],
  ['Example Listing M', 'CR-3.0', 128, 7100000, 9400, null, 100, 7800, 1986, 'Under Contract'],
];

export function sampleSet(zoningCodes = {}) {
  const comps = [];
  SALES.forEach(([name, zoning, date, price, bsf, cap, occ, lot, year, bclass], i) => {
    const c = {
      name, address: name, city: 'Washington', state: 'DC', zip: 20007, submarket: 'Example',
      zoning, date, price, bsf, cap, occ, lot_sf: lot, lot_ac: Math.round((lot / 43560) * 100) / 100,
      far: Math.round((bsf / lot) * 100) / 100, year, bclass, ptype: 'Retail',
      comp_id: null, buyer_broker: null, listing_broker: null,
      kind: 'sale', partial: false, costar_ppsf: Math.round((price / bsf) * 100) / 100,
      occ_basis: 'explicit', parcels: new Set([`EX-${i}`]), portfolio: 0,
      source: 'example-comps', notes: NOTE, costar_notes: NOTE, flags: [NOTE],
    };
    if (occ === 0) { c.occ_basis = 'derived'; c.flags.push('occupancy 0% -- notes say it sold vacant'); }
    comps.push(c);
  });
  LISTINGS.forEach(([name, zoning, dom, price, bsf, cap, occ, lot, year, status], i) => {
    const c = {
      name, address: name, city: 'Washington', state: 'DC', zip: 20007, submarket: 'Example',
      zoning, dom, price, bsf, cap, occ, lot_sf: lot, lot_ac: Math.round((lot / 43560) * 100) / 100,
      far: Math.round((bsf / lot) * 100) / 100, year, bclass: null, ptype: 'Retail',
      kind: 'market', partial: false, costar_ppsf: price ? Math.round((price / bsf) * 100) / 100 : null,
      costar_ppsf_alt: [], occ_basis: 'explicit', parcels: new Set([`EXL-${i}`]), portfolio: 0,
      source: 'example-comps', notes: NOTE, costar_notes: NOTE, flags: [NOTE],
    };
    if (status) c.flags.push(`status is ${status}, not closed -- loaded as an ON-MARKET comp`);
    comps.push(c);
  });
  // invented parties and terms, so the example shows every column; the names
  // are plainly made up, like the properties
  const TERMS = {
    'Example Sale A': ['Investment', 'Example Holdings LLC', 'Sample Family Trust', null, '96 Months'],
    'Example Sale B': ['Owner User', 'Example Bakery Co', 'Sample Realty Partners', 'High Vacancy Property', '20+ Years'],
    'Example Sale C': ['Investment', 'Example REIT', 'Sample Development', '1031 Exchange', '41 Months'],
    'Example Sale E': ['Owner User', 'Example Dental Group', 'Sample Estate', null, '133 Months'],
    'Example Sale F': ['Investment', 'Example Capital', 'Sample Bank', 'Bankruptcy Sale', '12 Months'],
    'Example Listing H': ['Investment or Owner User', null, null, null, null],
    'Example Listing K': ['Owner User', null, null, 'Deferred Maintenance', null],
  };
  for (const c of comps) {
    const t = TERMS[c.name] || ['Investment', null, null, null, null];
    [c.sale_type, c.buyer, c.seller, c.conditions, c.hold] = t;
  }
  const report = { excluded: [], notes: [], parse: [] };
  const { sales, market } = applyRules(comps, [], zoningCodes, report);
  return { sales, market, report };
}
