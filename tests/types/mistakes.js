/* tests/types/mistakes.js -- unit mix-ups the type checker must refuse.
 *
 * Never run: the checker reads it (types/tsconfig.json, by tests/types.test.js).
 * Each line marked @ts-expect-error is a mistake that must be a type error.
 * If one stops being caught (a unit loosened, a signature lost), the checker
 * reports the marker as unused and the test fails. On 4.4.0, which has no
 * units, every one of them compiles, so every marker is unused. */

import { debtService, balanceAfter, sizeLoan, holdReturns, analyze, compBasis } from '../../app/deal.js';
import { monthlyPayment } from '../../app/engine/debt.js';
import { netEffectiveRent } from '../../app/engine/leasing.js';
import { breakEvenOccupancy } from '../../app/engine/breakeven.js';
import { walt } from '../../app/engine/walt.js';
import { addMonths, generateSteps, monthlyAmount } from '../../app/lease.js';
import { pct, signed, money0, money2, times, yrs, parsePct } from '../../app/kit.js';

/* Values known to be in one unit (as the deal model and the engine give them). */
/** @type {Usd} */ const price = 6450000;
/** @type {UsdPerYear} */ const noi = 393450;
/** @type {UsdPerMonth} */ const monthlyRent = 39000;
/** @type {UsdPerSfYear} */ const rentPsfYear = 42;
/** @type {UsdPerSfMonth} */ const rentPsfMonth = 3.5;
/** @type {UsdPerSf} */ const pricePsf = 537.5;
/** @type {Pct} */ const rate = 6.75;
/** @type {Fraction} */ const rateFraction = 0.0675;
/** @type {PctChange} */ const vsComps = 12;
/** @type {Years} */ const amort = 30;
/** @type {Months} */ const term = 120;
/** @type {Multiple} */ const dscr = 1.21;
/** @type {Sf} */ const sf = 12000;
/** @type {IsoDate} */ const asOf = '2026-10-01';
const m = analyze({ price, noi, bsf: sf, loan: { ltv: 65, rate, amort } });

/* What is right compiles. */
debtService(price, rate, amort);
monthlyPayment(price, rate, term);
netEffectiveRent({ rent: rentPsfYear, sf, months: term });
pct(rate); pct(vsComps); money0(noi); money2(pricePsf); times(dscr); yrs(amort);
monthlyAmount(rentPsfMonth, 'psf_month', sf);
pct(parsePct('6.5'));
pct(m.cap); money0(m.noi); times(m.dscr);

/* Percent and fraction. */
// @ts-expect-error an interest rate as a fraction (0.0675) where a percent (6.75) is wanted
debtService(price, rateFraction, amort);
// @ts-expect-error a fraction shown as a percent: 0.07%, not 6.75%
pct(rateFraction);
// @ts-expect-error an LTV as a fraction
sizeLoan({ price, noi, ltv: rateFraction, dscr, dy: 8, rate, amort, io: false });
// @ts-expect-error a fraction shown with a sign as a percent
signed(rateFraction);

/* Years and months. */
// @ts-expect-error a term in months where the amortization in years is wanted
debtService(price, rate, term);
// @ts-expect-error years where a number of monthly payments is wanted
monthlyPayment(price, rate, amort);
// @ts-expect-error months where years held are wanted
balanceAfter(price, rate, amort, term);
// @ts-expect-error years where months are added to a date
addMonths(asOf, amort);
// @ts-expect-error a step every N years where every N months is wanted
generateSteps({ start: asOf, end: '2036-09-30', rate: rentPsfYear, unit: 'psf_year', every: amort });
// @ts-expect-error free rent in years where months are wanted
netEffectiveRent({ rent: rentPsfYear, sf, months: term, free: amort });
// @ts-expect-error months shown as years
yrs(term);

/* A year, a month, and per SF. */
// @ts-expect-error a rent per SF a month where a rent per SF a year is wanted
netEffectiveRent({ rent: rentPsfMonth, sf, months: term });
// @ts-expect-error a price per SF used as a rent per SF a year
netEffectiveRent({ rent: m.ppsf, sf, months: term });
// @ts-expect-error a month's rent where gross potential rent (a year's) is wanted
breakEvenOccupancy({ gpr: monthlyRent, gross: 529200, occ: 91.7, opex: 135750 });
// @ts-expect-error a month's rent as a lease's annual rent, in WALT
walt([{ annual: monthlyRent, sf, end: '2031-06-30' }]);
// @ts-expect-error a year's NOI where a price is wanted
holdReturns({ price: noi, noi, exitCap: 7 });

/* Dollars, percents and ratios shown as each other. */
// @ts-expect-error NOI shown as a percent
pct(m.noi);
// @ts-expect-error a cap rate shown as dollars
money0(m.cap);
// @ts-expect-error a percent shown as a multiple (DSCR)
times(rate);
// @ts-expect-error DSCR shown as years
yrs(m.dscr);
// @ts-expect-error an interest rate shown as a price per SF
money2(rate);
// @ts-expect-error the comps' median price per SF shown as a percent
pct(compBasis([]).median);

/* The deal model. */
// @ts-expect-error a loan to value written as a fraction
/** @type {Loan} */ const loan = { ltv: rateFraction };
// @ts-expect-error a month's operating expenses where the rent roll's (a year's) are wanted
/** @type {RentRollSettings} */ const settings = { asOf, opex: monthlyRent };

export { loan, settings };
