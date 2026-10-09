/* toolsdefs.js -- the calculators added to the Tools screen, as definitions:
 * inputs, a run function from typed values to results, and optionally how
 * to fill the inputs from the open deal and what may be sent back to it.
 *
 * Input: [id, label, kind, placeholder, help]. Kinds: money, num, int, pct
 * (a fraction is read as a rate), pct0 (a small percent taken as typed),
 * date, bool, list (numbers separated by commas), select (options in the
 * placeholder slot as [[value, label], ...]).
 *
 * run(values, ctx) returns { lines: [[label, value, strong, why]], tables:
 * [{ title, head, rows }], warnings: [] }. Every figure comes from calc.js,
 * deal.js or lease.js: no formula lives here. */

import {
  amortization, refinance, floating, maturityRisk, loanFees, dcf, noiBridge, breakEven, sensitivity, around, holdWithFees,
  waterfall, commission, compareLeases, renewalVsReplacement, percentageRent, recovery, absorption, escalationSchedule,
  residualLand, yieldOnCost, drawSchedule, compSetCheck,
} from './calc.js';
import { holdReturns } from './deal.js';
import { money0, money2, pct, times, int, dec, signed, short } from './kit.js';

const ok = (x) => typeof x === 'number' && Number.isFinite(x);
const loanOf = (v) => ({ ltv: v.ltv, rate: v.rate, amort: v.amort, io: !!v.io, closing: v.closing });

export const GROUPS = ['Valuation', 'Debt and financing', 'Returns and fees', 'Leasing', 'Comps and market', 'Development', 'Conversions and dates'];

export const MORE_TOOLS = [
  /* ---------------------------------------------------------- valuation */
  {
    id: 'dcf', group: 'Valuation', title: 'Discounted cash flow', color: '#1D4ED8', icon: '<path d="M3 17l5-5 4 4 8-8M14 8h6v6"/>',
    desc: 'Value from each year’s NOI and the sale, discounted to today.',
    inputs: [['noi', 'NOI, year 1', 'money', '875k'], ['growth', 'NOI growth a year %', 'pct', '3'], ['years', 'Years held', 'int', '10'],
      ['discount', 'Discount rate %', 'pct', '8'], ['exitCap', 'Exit cap rate %', 'pct', '7'], ['saleCost', 'Sale costs %', 'pct0', '2'], ['capex', 'Capital reserve, $ a year', 'money', '0'],
      ['useRentRoll', 'NOI from the deal’s rent roll projection', 'bool']],
    explain: 'Value = Σ (NOIₜ − reserve) ÷ (1 + r)ᵗ + [NOIₙ₊₁ ÷ exit cap × (1 − sale costs)] ÷ (1 + r)ⁿ. Annual, end-of-year cash flows.',
    fromDeal: (d) => ({ noi: d.m.noi, exitCap: d.scenario && d.scenario.inputs.exitCap, saleCost: d.scenario && d.scenario.inputs.saleCost, growth: d.scenario && d.scenario.inputs.growth }),
    run: (v, ctx) => {
      const warnings = [];
      let series = null;
      if (v.useRentRoll) {
        const p = ctx.deal && ctx.deal.rrProj;
        if (p && p.annual.length >= (v.years || 10) + 1) series = p.annual.map((y) => y.noi);
        else warnings.push(p ? `The rent roll projects ${p.annual.length} years; set its projection to at least ${(v.years || 10) + 1} years (Rent roll, Assumptions) to use it here.` : 'Open a deal with a rent roll and operating expenses to use its projection.');
      }
      const r = dcf({ ...v, noiSeries: series });
      if (!r) return { lines: [['Enter NOI, years, a discount rate and an exit cap', '—']], warnings };
      if (ok(v.discount) && ok(v.exitCap) && v.exitCap > v.discount + 3) warnings.push('The exit cap is far above the discount rate: check both.');
      return {
        lines: [['Value', money0(r.value), true, `${series ? 'rent roll NOI' : 'NOI growing at one rate'}, ${pct(v.discount)} discount`], ['Implied going-in cap', pct(r.impliedCap), false, 'year-1 NOI ÷ value'],
          ['Present value of the cash flows', money0(r.pvCashFlows)], ['Sale price, net of costs', money0(r.reversion)], ['Present value of the sale', money0(r.pvReversion), false, `${pct(r.reversionShare, 0)} of the value`]],
        tables: [{ title: 'By year', head: ['Year', 'NOI', 'Cash flow', 'Present value'], rows: r.rows.map((x) => [x.year, money0(x.noi), money0(x.cashFlow), money0(x.pv)]) }],
        warnings,
      };
    },
  },
  {
    id: 'bridge', group: 'Valuation', title: 'NOI bridge', color: '#0F766E', icon: '<path d="M3 12h18M7 12v6M17 12v6M5 8c3-3 11-3 14 0"/>',
    desc: 'Potential rent down to NOI, line by line, with the ratios lenders ask for.',
    inputs: [['gpr', 'Gross potential rent', 'money', '1.2m'], ['vacancyPct', 'Vacancy %', 'pct0', '5'], ['creditPct', 'Credit loss %', 'pct0', '1'], ['concessions', 'Concessions, $', 'money', '0'],
      ['otherIncome', 'Other income', 'money', '0'], ['recoveries', 'Expense recoveries', 'money', '0'], ['taxes', 'Real estate taxes', 'money'], ['insurance', 'Insurance', 'money'],
      ['utilities', 'Utilities', 'money'], ['repairs', 'Repairs and maintenance', 'money'], ['payroll', 'Payroll', 'money'], ['mgmtPct', 'Management, % of EGI', 'pct0', '3'],
      ['otherExp', 'Other expenses', 'money'], ['reserves', 'Replacement reserves', 'money'], ['bsf', 'Building SF', 'num'], ['units', 'Units', 'num']],
    explain: 'EGI = potential rent − vacancy − credit loss − concessions + other income + recoveries. NOI = EGI − expenses (management as a share of EGI).',
    fromDeal: (d) => ({ gpr: d.figures.gpr, taxes: d.figures.taxes, bsf: d.figures.bsf, units: d.figures.units }),
    toDeal: (v, r) => (r && r.data ? { figures: { gpr: v.gpr, gross: r.data.egi, opex: r.data.opex, noi: r.data.noi }, summary: `potential rent ${money0(v.gpr)}, EGI ${money0(r.data.egi)}, expenses ${money0(r.data.opex)}, NOI ${money0(r.data.noi)}` } : null),
    run: (v) => {
      const r = noiBridge(v);
      if (!r) return { lines: [['Enter gross potential rent', '—']] };
      return {
        data: r,
        lines: [['Vacancy', money0(-r.vacancy)], ['Credit loss', money0(-r.credit)], ['Effective gross income', money0(r.egi), true], ['Management fee', money0(-r.mgmt)],
          ['Total expenses', money0(-r.opex)], ['Net operating income', money0(r.noi), true], ['Expense ratio', pct(r.expenseRatio, 1), false, 'expenses ÷ EGI'],
          ['Expenses per SF', money2(r.opexPsf)], ['Expenses per unit', money0(r.opexPerUnit)], ['NOI per SF', money2(r.noiPsf)]],
        warnings: r.warnings,
      };
    },
  },
  {
    id: 'breakeven', group: 'Valuation', title: 'Break-even occupancy', color: '#B91C1C', icon: '<path d="M4 20h16M6 16l4-6 4 3 4-7"/>',
    desc: 'The occupancy at which income just covers expenses and debt service.',
    inputs: [['gpr', 'Gross potential rent (100% let)', 'money', '1.2m'], ['opex', 'Operating expenses', 'money', '400k'], ['debtService', 'Annual debt service', 'money', '350k'], ['otherIncome', 'Other income not tied to occupancy', 'money', '0']],
    explain: 'Break-even = (expenses + debt service − other income) ÷ potential gross rent.',
    fromDeal: (d) => ({ gpr: d.figures.gpr, opex: d.figures.opex, debtService: d.m.debtService }),
    run: (v) => {
      const r = breakEven(v);
      if (!r) return { lines: [['Enter potential rent and expenses', '—']] };
      return { lines: [['Break-even occupancy', pct(r.occupancy, 1), true], ['Cushion below full occupancy', pct(r.cushion, 1)], ['Income needed', money0(r.need)]], warnings: r.occupancy > 100 ? ['Above 100%: the property does not cover its costs even fully let.'] : [] };
    },
  },
  {
    id: 'valuesens', group: 'Valuation', title: 'Value sensitivity', color: '#4338CA', icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
    desc: 'Value across NOI and cap rate, in one grid.',
    inputs: [['noi', 'NOI', 'money', '875k'], ['cap', 'Cap rate, centre %', 'pct', '7'], ['capStep', 'Cap rate step, points', 'num', '0.25'], ['noiStep', 'NOI step %', 'pct0', '5'], ['price', 'Asking price (to compare)', 'money']],
    explain: 'Each cell: NOI × (1 + step) ÷ cap rate. Shaded where the value is at or above the asking price.',
    fromDeal: (d) => ({ noi: d.m.noi, cap: d.m.cap ? Math.round(d.m.cap * 4) / 4 : null, price: d.m.price }),
    run: (v) => {
      const caps = around(v.cap, v.capStep || 0.25, 3);
      const steps = around(0, v.noiStep || 5, 2);
      if (!ok(v.noi) || !caps.length) return { lines: [['Enter NOI and a cap rate', '—']] };
      const g = sensitivity((s, c) => (v.noi * (1 + s / 100)) / (c / 100), steps, caps);
      return {
        lines: [['Value at the centre', money0(v.noi / (v.cap / 100)), true]],
        tables: [{ title: 'Value: NOI change down, cap rate across', head: ['NOI', ...caps.map((c) => pct(c))], rows: steps.map((s, i) => [`${signed(s, 0)} (${short(v.noi * (1 + s / 100))})`, ...g[i].map((x) => short(x))]),
          mark: ok(v.price) ? steps.map((s, i) => [false, ...g[i].map((x) => x >= v.price)]) : null }],
      };
    },
  },
  /* ------------------------------------------------------------- debt */
  {
    id: 'amort', group: 'Debt and financing', title: 'Amortization schedule', color: '#0E7490', icon: '<path d="M4 4v16h16M8 16l3-4 3 2 5-7"/>',
    desc: 'Payment, interest, principal and balance by year, with an interest-only period.',
    inputs: [['loan', 'Loan amount', 'money', '8.1m'], ['rate', 'Interest rate %', 'pct', '6.75'], ['amortYears', 'Amortization, years', 'int', '30'], ['termYears', 'Term (maturity), years', 'int', '10'], ['ioYears', 'Interest-only, years', 'num', '0']],
    explain: 'Monthly payment = L × i ÷ (1 − (1 + i)⁻ⁿ), i the monthly rate and n the amortization months; interest-only months pay L × i.',
    fromDeal: (d) => ({ loan: d.m.loan, rate: d.loan.rate, amortYears: d.loan.amort }),
    run: (v) => {
      const r = amortization(v);
      if (!r) return { lines: [['Enter the loan, rate, amortization and term', '—']] };
      return {
        lines: [['Monthly payment, amortizing', money0(r.monthlyAmortizing), true], ...(v.ioYears ? [['Monthly payment, interest-only', money0(r.monthlyIo)]] : []),
          ['Balance at maturity (balloon)', money0(r.balloon), true], ['Interest over the term', money0(r.totalInterest)]],
        tables: [{ title: 'By year', head: ['Year', 'Payments', 'Interest', 'Principal', 'Balance'], rows: r.years.map((y) => [y.year, money0(y.payment), money0(y.interest), money0(y.principal), money0(y.balance)]) }],
      };
    },
  },
  {
    id: 'refi', group: 'Debt and financing', title: 'Refinance and cash-out', color: '#0369A1', icon: '<path d="M4 12a8 8 0 0114-5l2-2v6h-6l2-2a5 5 0 10.5 6"/>',
    desc: 'The new loan the property supports, the old loan paid off, and what is left.',
    inputs: [['noi', 'NOI', 'money'], ['value', 'Value (or a cap rate below)', 'money'], ['capRate', 'Cap rate for value %', 'pct'], ['balance', 'Current loan balance', 'money'],
      ['maxLtv', 'Max LTV %', 'pct', '65'], ['minDscr', 'Min DSCR', 'num', '1.25'], ['minDy', 'Min debt yield %', 'pct', '9'], ['rate', 'New rate %', 'pct', '6.5'], ['amort', 'Amortization, years', 'int', '30'], ['io', 'Interest only', 'bool'], ['costsPct', 'Refinance costs, % of loan', 'pct0', '1']],
    explain: 'New loan = least of value × LTV, NOI ÷ DSCR ÷ loan constant, NOI ÷ debt yield. Cash out = new loan − old balance − costs.',
    fromDeal: (d) => ({ noi: d.m.noi, value: d.m.price, balance: d.m.loan }),
    run: (v) => {
      const r = refinance(v);
      if (!r.sized) return { lines: [['New loan', '—']], warnings: r.warnings };
      return { lines: [['New loan', money0(r.loan), true, `limited by ${r.sized.binding}`], ['Cash out after payoff and costs', money0(r.cashOut), true], ['Refinance costs', money0(r.costs)], ['New debt service', money0(r.debtService)], ['New DSCR', times(r.dscr)], ['New LTV', pct(r.ltv, 1)]], warnings: r.warnings };
    },
  },
  {
    id: 'floating', group: 'Debt and financing', title: 'Floating-rate stress', color: '#7C2D12', icon: '<path d="M3 15c3-6 6 6 9 0s6 6 9 0"/>',
    desc: 'Interest-only debt service and coverage as the index moves, with a rate cap.',
    inputs: [['loan', 'Loan amount', 'money'], ['index', 'Index today % (e.g. SOFR)', 'pct', '4.3'], ['spread', 'Spread %', 'pct0', '3'], ['capStrike', 'Rate cap strike % (blank = none)', 'pct'], ['noi', 'NOI', 'money']],
    explain: 'Rate = min(index + shock, cap strike) + spread. Debt service shown interest-only, as floating bridge loans usually are.',
    fromDeal: (d) => ({ loan: d.m.loan, noi: d.m.noi }),
    note: 'Illustrative index levels you type, not a forecast or a lender quote.',
    run: (v) => {
      const r = floating(v);
      if (!r) return { lines: [['Enter the loan, index and spread', '—']] };
      const worst = r[r.length - 1];
      return {
        lines: [['Debt service today', money0(r.find((x) => x.shock === 0).debtService), true], ['At +300 bp', money0(worst.debtService), false, ok(worst.dscr) ? `DSCR ${times(worst.dscr)}` : null]],
        tables: [{ title: 'Index shocks', head: ['Shock', 'Index', 'All-in rate', 'Debt service', 'DSCR'], rows: r.map((x) => [`${x.shock > 0 ? '+' : ''}${x.shock} bp`, `${pct(x.index)}${x.cappedIndex < x.index ? ' (capped)' : ''}`, pct(x.rate), money0(x.debtService), times(x.dscr)]) }],
        warnings: r.filter((x) => ok(x.dscr) && x.dscr < 1).length ? ['At some shocks NOI does not cover the interest.'] : [],
      };
    },
  },
  {
    id: 'maturity', group: 'Debt and financing', title: 'Maturity and refinance risk', color: '#9A3412', icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
    desc: 'Can the loan be refinanced when it comes due? Balance against new proceeds.',
    inputs: [['loan', 'Loan amount today', 'money'], ['rate', 'Rate %', 'pct', '6.75'], ['amort', 'Amortization, years', 'int', '30'], ['io', 'Interest only', 'bool'], ['termYears', 'Years to maturity', 'int', '10'],
      ['noi', 'NOI today', 'money'], ['growth', 'NOI growth a year %', 'pct', '2'], ['refiCap', 'Cap rate at maturity %', 'pct', '7.5'], ['refiLtv', 'Refinance max LTV %', 'pct', '65'], ['refiDscr', 'Refinance min DSCR', 'num', '1.25'], ['refiDy', 'Refinance min debt yield %', 'pct', '9'], ['refiRate', 'Refinance rate %', 'pct', '7']],
    explain: 'Proceeds at maturity = least of the lender tests on NOI then; the gap is proceeds minus the balance due.',
    fromDeal: (d) => ({ loan: d.m.loan, rate: d.loan.rate, amort: d.loan.amort, io: d.loan.io, noi: d.m.noi }),
    run: (v) => {
      const r = maturityRisk(v);
      if (!r) return { lines: [['Enter the loan, its terms and NOI', '—']] };
      return { lines: [['Balance due at maturity', money0(r.balance), true], ['NOI then', money0(r.noiAtMaturity)], ['Value then', money0(r.value)], ['Refinance proceeds', money0(r.proceeds), false, r.binding ? `limited by ${r.binding}` : null], ['Gap', money0(r.gap), true, ok(r.gap) && r.gap < 0 ? 'equity needed to refinance' : 'cash out'], ['LTV of the old balance then', pct(r.ltvAtMaturity, 1)]], warnings: ok(r.gap) && r.gap < 0 ? ['The loan cannot be refinanced in full on these assumptions.'] : [] };
    },
  },
  {
    id: 'loanfees', group: 'Debt and financing', title: 'Financing costs', color: '#475569', icon: '<path d="M12 3v18M7 7h7a3 3 0 010 6H9a3 3 0 000 6h8"/>',
    desc: 'Points, lender legal, third-party reports and reserves: what the loan really nets.',
    inputs: [['loan', 'Loan amount', 'money'], ['points', 'Origination, points', 'pct0', '1'], ['lenderLegal', 'Lender legal', 'money'], ['thirdParty', 'Appraisal, environmental, PCA', 'money'], ['reserves', 'Reserves held back', 'money']],
    fromDeal: (d) => ({ loan: d.m.loan }),
    run: (v) => { const r = loanFees(v); return r ? { lines: [['Total financing costs', money0(r.total), true, `${pct(r.pctOfLoan, 2)} of the loan`], ['Origination fee', money0(r.points)], ['Net loan proceeds', money0(r.netProceeds), true]] } : { lines: [['Enter the loan', '—']] }; },
  },
  /* ----------------------------------------------------- returns and fees */
  {
    id: 'hold', group: 'Returns and fees', title: 'Hold returns and fees', color: '#15803D', icon: '<path d="M3 20h18M5 20V10M10 20V6M15 20v-8M20 20V4"/>',
    desc: 'Buy, hold and sell: levered and unlevered IRR, multiple and cash-on-cash by year, before and after sponsor fees.',
    inputs: [['price', 'Purchase price', 'money'], ['noi', 'NOI, year 1', 'money'], ['growth', 'NOI growth a year %', 'pct', '2'], ['hold', 'Hold, years', 'int', '5'], ['exitCap', 'Exit cap rate %', 'pct', '7'], ['saleCost', 'Sale costs %', 'pct0', '2'],
      ['ltv', 'LTV %', 'pct', '65'], ['rate', 'Rate %', 'pct', '6.75'], ['amort', 'Amortization, years', 'int', '30'], ['io', 'Interest only', 'bool'], ['closing', 'Closing costs %', 'pct0', '2'],
      ['acqFeePct', 'Acquisition fee, % of price', 'pct0', '0'], ['amFeePct', 'Asset management fee, % of equity a year', 'pct0', '0'], ['dispFeePct', 'Disposition fee, % of sale', 'pct0', '0'], ['capexPerYear', 'Capital spending, $ a year', 'money', '0']],
    explain: 'IRR is the rate that brings the yearly equity cash flows to zero: equity in at closing, cash flow after debt each year, and the sale less costs and the loan balance in the last year. No taxes; the sale is priced on the following year’s NOI.',
    fromDeal: (d) => ({ price: d.m.price, noi: d.m.noi, ltv: d.loan.ltv, rate: d.loan.rate, amort: d.loan.amort, io: d.loan.io, closing: d.loan.closing, ...(d.scenario ? { growth: d.scenario.inputs.growth, hold: d.scenario.inputs.hold, exitCap: d.scenario.inputs.exitCap, saleCost: d.scenario.inputs.saleCost } : {}) }),
    toDeal: (v) => ({ live: { hold: v.hold, growth: v.growth, exitCap: v.exitCap, saleCost: v.saleCost }, summary: `hold ${v.hold} years, growth ${dec(v.growth, 2)}%, exit cap ${pct(v.exitCap)}, sale costs ${dec(v.saleCost, 2)}% as the What-if scenario’s assumptions (not the deal’s figures)` }),
    run: (v) => {
      const r = holdWithFees({ price: v.price, noi: v.noi, growth: v.growth, hold: v.hold, exitCap: v.exitCap, saleCost: v.saleCost, loan: loanOf(v) }, v);
      if (!r) return { lines: [['Enter price, NOI, hold, exit cap and loan terms', '—']] };
      const fees = r.fees.total > 0;
      return {
        lines: [['Levered IRR', pct(r.leveredIrr, 2), true, fees ? `${pct(r.irrAfterFees, 2)} after fees` : null], ['Equity multiple', `${dec(r.leveredMultiple, 2)}x`, true, fees ? `${dec(r.multipleAfterFees, 2)}x after fees` : null],
          ['Unlevered IRR', pct(r.unleveredIrr, 2)], ['Equity, with closing costs', money0(r.equity)], ['Exit value', money0(r.exitValue), false, `year-${r.hold + 1} NOI at ${pct(v.exitCap)}`], ['Loan balance at sale', money0(r.balance)],
          ...(fees ? [['Sponsor fees over the hold', money0(r.fees.total), false, `acquisition ${money0(r.fees.acq)}, management ${money0(r.fees.am)} a year, disposition ${money0(r.fees.disp)}`]] : []), ['Profit to equity', money0(r.profit)]],
        tables: [{ title: 'By year', head: ['Year', 'NOI', 'Debt service', 'Cash flow', 'Cash-on-cash'], rows: r.byYear.map((y) => [y.year, money0(y.noi), money0(y.debtService), money0(y.cashFlow), pct(y.coc, 1)]) }],
        warnings: ok(v.exitCap) && ok(v.price) && ok(v.noi) && v.exitCap < (v.noi / v.price) * 100 - 0.5 ? ['The exit cap is well below the going-in cap: the return leans on cap-rate compression.'] : [],
      };
    },
  },
  {
    id: 'irrsens', group: 'Returns and fees', title: 'Returns sensitivity', color: '#166534', icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/>',
    desc: 'Levered IRR across purchase price and exit cap rate.',
    inputs: [['price', 'Purchase price, centre', 'money'], ['priceStep', 'Price step %', 'pct0', '5'], ['exitCap', 'Exit cap, centre %', 'pct', '7'], ['capStep', 'Exit cap step, points', 'num', '0.25'],
      ['noi', 'NOI, year 1', 'money'], ['growth', 'NOI growth %', 'pct', '2'], ['hold', 'Hold, years', 'int', '5'], ['saleCost', 'Sale costs %', 'pct0', '2'], ['ltv', 'LTV %', 'pct', '65'], ['rate', 'Rate %', 'pct', '6.75'], ['amort', 'Amortization, years', 'int', '30'], ['closing', 'Closing costs %', 'pct0', '2']],
    fromDeal: (d) => ({ price: d.m.price, noi: d.m.noi, ltv: d.loan.ltv, rate: d.loan.rate, amort: d.loan.amort, closing: d.loan.closing, ...(d.scenario ? { exitCap: d.scenario.inputs.exitCap, hold: d.scenario.inputs.hold, growth: d.scenario.inputs.growth, saleCost: d.scenario.inputs.saleCost } : {}) }),
    run: (v) => {
      const prices = around(0, v.priceStep || 5, 2).map((s) => v.price * (1 + s / 100));
      const caps = around(v.exitCap, v.capStep || 0.25, 2);
      if (!ok(v.price) || !ok(v.noi) || !caps.length) return { lines: [['Enter price, NOI and an exit cap', '—']] };
      const g = sensitivity((p, c) => { const r = holdReturns({ price: p, noi: v.noi, growth: v.growth, hold: v.hold || 5, exitCap: c, saleCost: v.saleCost, loan: loanOf(v) }); return r ? r.leveredIrr : null; }, prices, caps);
      return { lines: [['IRR at the centre', pct(g[2][2], 2), true]], tables: [{ title: 'Levered IRR: price down, exit cap across', head: ['Price', ...caps.map((c) => pct(c))], rows: prices.map((p, i) => [short(p), ...g[i].map((x) => pct(x, 1))]) }] };
    },
  },
  {
    id: 'waterfall', group: 'Returns and fees', title: 'Distribution waterfall', color: '#6D28D9', icon: '<path d="M4 4h6v4h6v4h4v8"/>',
    desc: 'How cash splits between investors and the sponsor through IRR hurdles and promotes.',
    inputs: [['equity', 'Total equity in', 'money', '4.6m'], ['flows', 'Cash back each year, comma separated', 'list', '250k, 260k, 270k, 280k, 5.9m'], ['lpShare', 'Investors’ share of the equity %', 'pct0', '90'],
      ['h1', 'Hurdle 1 (preferred return) %', 'pct0', '8'], ['p1', 'Promote above hurdle 1 %', 'pct0', '20'], ['h2', 'Hurdle 2 %', 'pct0', '12'], ['p2', 'Promote above hurdle 2 %', 'pct0', '30'], ['h3', 'Hurdle 3 %', 'pct0', '15'], ['p3', 'Promote above hurdle 3 %', 'pct0', '40']],
    explain: 'Capital in pro rata. Cash out pro rata until the investors earn hurdle 1 (compounded yearly); between hurdles the sponsor takes the promote off the top and the rest is pro rata. No catch-up, no clawback.',
    fromDeal: (d) => (d.scenario && d.scenario.returns ? { equity: d.scenario.returns.equity, flows: d.scenario.returns.levered.slice(1) } : {}),
    run: (v) => {
      const flows = [-(v.equity || 0), ...(v.flows || [])];
      const hs = [v.h1, v.h2, v.h3].filter((x) => ok(x));
      const r = waterfall({ flows, lpShare: v.lpShare ?? 90, hurdles: hs, promotes: [v.p1, v.p2, v.p3].slice(0, hs.length) });
      if (!r) return { lines: [['Enter the equity and the cash back each year', '—']] };
      const warnings = [];
      if (hs.some((h, i) => i && h <= hs[i - 1])) warnings.push('Hurdles should rise: each one higher than the last.');
      return {
        lines: [['Investors’ IRR', pct(r.lpIrr, 2), true, `${dec(r.lpMultiple, 2)}x`], ['Sponsor’s IRR', pct(r.gpIrr, 2), true, `${dec(r.gpMultiple, 2)}x`], ['Project IRR', pct(r.projectIrr, 2)], ['Sponsor’s promote', money0(r.promote), false, 'beyond its pro-rata share'], ['Total distributed', money0(r.totalOut)]],
        tables: [{ title: 'By band', head: ['Band', 'Investors', 'Sponsor'], rows: r.bands.map((b, i) => [i === 0 ? `Up to ${pct(hs[0], 0)}` : i < hs.length ? `${pct(hs[i - 1], 0)} to ${pct(hs[i], 0)}` : `Above ${pct(hs[hs.length - 1], 0)}`, money0(b.lp), money0(b.gp)]) },
          { title: 'By year', head: ['Year', 'Investors', 'Sponsor'], rows: r.lpFlows.map((x, t) => [t, money0(x), money0(r.gpFlows[t])]) }],
        warnings,
      };
    },
  },
  {
    id: 'commission', group: 'Returns and fees', title: 'Commission and splits', color: '#B45309', icon: '<circle cx="9" cy="9" r="3"/><circle cx="15" cy="15" r="3"/><path d="M5 19L19 5"/>',
    desc: 'A sale commission, flat or tiered, split with the co-broker, the house and a referral.',
    inputs: [['price', 'Sale price', 'money'], ['flatPct', 'Flat rate % (blank to use tiers)', 'pct0'], ['t1Up', 'Tier 1: up to $', 'money', '1m'], ['t1', 'Tier 1 rate %', 'pct0', '6'], ['t2Up', 'Tier 2: up to $', 'money', '5m'], ['t2', 'Tier 2 rate %', 'pct0', '4'], ['t3', 'Above tier 2 rate %', 'pct0', '2'],
      ['coBrokerPct', 'To the co-operating broker %', 'pct0', '50'], ['referralPct', 'Referral, % of our side', 'pct0', '0'], ['housePct', 'House share, % after referral', 'pct0', '40']],
    note: 'Fee structures vary by listing agreement and firm policy: enter the ones in yours.',
    fromDeal: (d) => ({ price: d.m.price }),
    run: (v) => {
      const r = commission({ price: v.price, flatPct: v.flatPct, tiers: [{ upTo: v.t1Up, pct: v.t1 }, { upTo: v.t2Up, pct: v.t2 }, { pct: v.t3 }], coBrokerPct: v.coBrokerPct, referralPct: v.referralPct, housePct: v.housePct });
      if (!r) return { lines: [['Enter the sale price', '—']] };
      return {
        lines: [['Total commission', money0(r.total), true, `${pct(r.effectivePct, 2)} of the price`], ['Co-operating broker', money0(r.coBroker)], ['Listing side', money0(r.listingSide)], ['Referral', money0(r.referral)], ['House', money0(r.house)], ['Agent', money0(r.agent), true]],
        tables: [{ title: 'Tiers', head: ['From', 'To', 'Rate', 'Commission'], rows: r.lines.map((l) => [money0(l.from), money0(l.to), pct(l.pct, 2), money0(l.amount)]) }],
        warnings: r.lines.some((l) => l.note) ? ['Part of the price has no rate: add a top tier.'] : [],
      };
    },
  },
  /* ------------------------------------------------------------- leasing */
  {
    id: 'compare', group: 'Leasing', title: 'Compare lease proposals', color: '#7E22CE', icon: '<path d="M4 4h7v16H4zM13 4h7v16h-7z"/>',
    desc: 'Up to three proposals side by side: net effective rent and the landlord’s present value.',
    inputs: [['sf', 'SF', 'num', '5,000'], ['discount', 'Discount rate %', 'pct', '8'],
      ...['A', 'B', 'C'].flatMap((k) => [[`rent${k}`, `${k}: rent $/SF/yr`, 'money'], [`months${k}`, `${k}: term, months`, 'int'], [`esc${k}`, `${k}: increases %`, 'pct0'], [`free${k}`, `${k}: free months`, 'num'], [`ti${k}`, `${k}: TI $/SF`, 'money'], [`lc${k}`, `${k}: commission %`, 'pct0']])],
    run: (v) => {
      const props = ['A', 'B', 'C'].map((k) => ({ k, rent: v[`rent${k}`], sf: v.sf, months: v[`months${k}`], esc: v[`esc${k}`] || 0, free: v[`free${k}`] || 0, ti: v[`ti${k}`] || 0, lc: v[`lc${k}`] || 0 })).filter((p) => ok(p.rent) && ok(p.months));
      if (!props.length || !ok(v.sf)) return { lines: [['Enter the SF and at least one proposal’s rent and term', '—']] };
      const r = compareLeases(props, v.discount || 8);
      const best = r.reduce((b, x) => (x && (!b || x.nerDiscounted > b.nerDiscounted) ? x : b), null);
      return {
        lines: [['Best by discounted net effective rent', best ? `${best.k}: ${money2(best.nerDiscounted)}/SF` : '—', true]],
        tables: [{ title: 'Proposals', head: ['', 'Face rent', 'NER', 'NER, discounted', 'Concessions', 'Landlord PV'], rows: r.map((x) => [x.k, `${money2(x.avgRent)}/SF`, `${money2(x.nerSimple)}/SF`, `${money2(x.nerDiscounted)}/SF`, pct(x.concessionPct, 1), money0(x.landlordPv)]) }],
      };
    },
  },
  {
    id: 'renewal', group: 'Leasing', title: 'Renewal versus replacement', color: '#A21CAF', icon: '<path d="M4 12a8 8 0 0114-5M20 12a8 8 0 01-14 5M18 3v4h-4M6 21v-4h4"/>',
    desc: 'Keep the tenant on renewal terms, or let it go and re-let after downtime.',
    inputs: [['sf', 'SF', 'num', '5,000'], ['discount', 'Discount rate %', 'pct', '8'],
      ['rRent', 'Renewal rent $/SF/yr', 'money'], ['rEsc', 'Renewal increases %', 'pct0', '3'], ['rFree', 'Renewal free months', 'num', '2'], ['rTi', 'Renewal TI $/SF', 'money', '10'], ['rLc', 'Renewal commission %', 'pct0', '4'], ['rMonths', 'Renewal term, months', 'int', '60'],
      ['nDown', 'Downtime before a new tenant, months', 'int', '6'], ['nRent', 'New-tenant rent $/SF/yr', 'money'], ['nEsc', 'New-tenant increases %', 'pct0', '3'], ['nFree', 'New-tenant free months', 'num', '4'], ['nTi', 'New-tenant TI $/SF', 'money', '40'], ['nLc', 'New-tenant commission %', 'pct0', '6'], ['nMonths', 'New-tenant term, months', 'int', '60']],
    explain: 'Each option’s monthly cash to the landlord (rent after free months, less TI and commission up front), discounted over the same span.',
    run: (v) => {
      const r = renewalVsReplacement({ sf: v.sf, discount: v.discount || 8, renew: { rent: v.rRent, esc: v.rEsc, free: v.rFree, ti: v.rTi, lc: v.rLc, months: v.rMonths }, replace: { downtime: v.nDown, rent: v.nRent, esc: v.nEsc, free: v.nFree, ti: v.nTi, lc: v.nLc, months: v.nMonths } });
      if (!r || !ok(v.rRent) || !ok(v.nRent)) return { lines: [['Enter the SF and both rents', '—']] };
      return { lines: [[r.better === 'renew' ? 'Renewing is worth more' : 'Re-letting is worth more', money0(Math.abs(r.advantage)), true, `over ${r.months} months, in today’s dollars`], ['Renewal, present value', money0(r.renewPv)], ['Re-letting, present value', money0(r.replacePv)]] };
    },
  },
  {
    id: 'escalation', group: 'Leasing', title: 'Rent escalation schedule', color: '#9333EA', icon: '<path d="M4 18h4v-4h4v-4h4V6h4"/>',
    desc: 'A starting rent and its bumps, as dated steps with the total.',
    inputs: [['start', 'Starts', 'date'], ['months', 'Term, months', 'int', '120'], ['rate', 'Starting rent', 'money2', '36'], ['unit', 'Rent is', 'select', [['psf_year', '$/SF a year'], ['psf_month', '$/SF a month'], ['year', '$ a year'], ['month', '$ a month']]], ['sf', 'SF (for per-SF rents)', 'num'],
      ['type', 'Increases', 'select', [['pct', '% each step'], ['fixed', '$ each step']]], ['value', 'Increase', 'num', '3'], ['every', 'Every, months', 'int', '12']],
    run: (v) => {
      const r = escalationSchedule(v);
      if (!r) return { lines: [['Enter the start, term and rent', '—']] };
      return { lines: [['Total rent over the term', money0(r.total), true], ['Average a month', money0(r.average)]], tables: [{ title: 'Steps', head: ['From', 'To', 'Rate', 'Monthly'], rows: r.rows.map((x) => [x.start, x.end, dec(x.rate, 2), money0(x.monthly)]) }] };
    },
  },
  {
    id: 'pctrent', group: 'Leasing', title: 'Percentage rent', color: '#C026D3', icon: '<path d="M19 5L5 19M7 7h.01M17 17h.01"/>',
    desc: 'Overage rent above a sales breakpoint, set or natural.',
    inputs: [['sales', 'Annual sales', 'money'], ['rate', 'Percentage %', 'pct0', '6'], ['breakpoint', 'Breakpoint $ (blank with natural)', 'money'], ['baseRent', 'Annual base rent', 'money'], ['natural', 'Natural breakpoint (base rent ÷ rate)', 'bool']],
    run: (v) => { const r = percentageRent(v); return r ? { lines: [['Percentage rent', money0(r.overage), true], ['Breakpoint', money0(r.breakpoint)], ['Occupancy cost', pct(r.occupancyCost, 1), false, '(base + overage) ÷ sales'], ...(r.salesToBreakpoint > 0 ? [['Sales still needed to reach it', money0(r.salesToBreakpoint)]] : [])] } : { lines: [['Enter sales, the rate and a breakpoint', '—']] }; },
  },
  {
    id: 'recovery', group: 'Leasing', title: 'Expense recoveries', color: '#BE185D', icon: '<path d="M12 3l9 4-9 4-9-4z"/><path d="M3 12l9 4 9-4"/>',
    desc: 'A tenant’s share of operating expenses: pro rata, over a base year or a stop, or fixed.',
    inputs: [['expenses', 'Recoverable expenses, $ a year', 'money'], ['tenantSf', 'Tenant SF', 'num'], ['buildingSf', 'Building SF', 'num'], ['sharePct', 'Pro-rata share % (blank = SF share)', 'pct0'],
      ['method', 'Method', 'select', [['prorata', 'Pro rata (NNN)'], ['base_year', 'Over base year'], ['stop', 'Over an expense stop'], ['fixed', 'Fixed amount']]], ['baseYear', 'Base-year expenses', 'money'], ['stopPsf', 'Expense stop $/SF', 'money2'], ['fixed', 'Fixed recovery $', 'money']],
    fromDeal: (d) => ({ expenses: d.figures.opex, buildingSf: d.figures.bsf }),
    run: (v) => { const r = recovery(v); return r ? { lines: [['Annual recovery', money0(r.annual), true], ['Monthly', money0(r.monthly)], ['Per SF', money2(r.psf)], ['Share', pct(r.share, 2)]] } : { lines: [['Enter the expenses and the tenant’s share', '—']] }; },
  },
  {
    id: 'absorption', group: 'Leasing', title: 'Lease-up and absorption', color: '#DB2777', icon: '<path d="M4 20V10M9 20V6M14 20v-9M19 20V4"/>',
    desc: 'How long vacant space takes to lease at a steady pace, and the rent not earned meanwhile.',
    inputs: [['vacantSf', 'Vacant SF', 'num'], ['sfPerMonth', 'SF leased a month', 'num'], ['rentPsf', 'Rent $/SF/yr', 'money2'], ['freeMonths', 'Free months per new lease', 'num', '3']],
    run: (v) => { const r = absorption(v); return r ? { lines: [['Months to lease up', String(r.months), true], ['Rent not earned while empty', money0(r.lostRent)], ['Free rent given', money0(r.freeRentCost)], ['Total cost of lease-up', money0(r.totalCost), true]], tables: [{ title: 'By month', head: ['Month', 'Leased SF', 'Leased %'], rows: r.rows.map((x) => [x.month, int(x.leasedSf), pct(x.occupiedPct, 0)]) }] } : { lines: [['Enter the vacant SF, the pace and the rent', '—']] }; },
  },
  /* ------------------------------------------------------- comps, market */
  {
    id: 'compset', group: 'Comps and market', title: 'Comp set check', color: '#2563EB', icon: '<path d="M5 19V11M10 19V6M15 19v-9M20 19V4"/>',
    desc: 'How much the sale comps on the Comps tab can bear: count, recency, spread, and a value range for the subject.',
    inputs: [['subjectSf', 'Subject building SF', 'num']],
    explain: 'Quartiles of the comps’ $/SF; the value range multiplies them by the subject SF. Distance is not used: these comps carry no coordinates, so location is the broker’s judgement.',
    fromDeal: (d) => ({ subjectSf: d.figures.bsf }),
    run: (v, ctx) => {
      const sales = ctx.sales ? ctx.sales() : [];
      if (!sales.length) return { lines: [['Load sale comps on the Comps tab', '—']] };
      const r = compSetCheck(sales, { subjectSf: v.subjectSf });
      return {
        lines: [['Priced sale comps', String(r.n), true, `${r.capN} with a cap rate`], ['Median $/SF', money2(r.median)], ['Middle half', `${money2(r.p25)} to ${money2(r.p75)}`], ['SF-weighted $/SF', money2(r.weighted)], ['Spread (coefficient of variation)', pct(r.cv, 0)], ['Median age', r.medianAgeMonths !== null ? `${Math.round(r.medianAgeMonths)} months` : '—'],
          ...(r.value ? [['Subject at the median', money0(r.value.median), true], ['Subject, middle half', `${short(r.value.p25)} to ${short(r.value.p75)}`]] : [])],
        warnings: r.warnings,
      };
    },
  },
  /* -------------------------------------------------------- development */
  {
    id: 'residual', group: 'Development', title: 'Residual land value', color: '#92400E', icon: '<path d="M3 21h18M5 21V11l7-6 7 6v10"/>',
    desc: 'What the land can bear: the finished value less every cost and the developer’s profit.',
    inputs: [['gdv', 'Finished value (or NOI and exit cap)', 'money'], ['noi', 'Stabilized NOI', 'money'], ['exitCap', 'Exit cap %', 'pct', '6'], ['saleCostPct', 'Sale costs %', 'pct0', '2'], ['hardCost', 'Hard costs', 'money'],
      ['softPct', 'Soft costs, % of hard', 'pct0', '20'], ['contingencyPct', 'Contingency %', 'pct0', '5'], ['financePct', 'Financing, % of costs', 'pct0', '6'], ['profitPct', 'Developer profit %', 'pct0', '15'],
      ['profitOn', 'Profit measured on', 'select', [['cost', 'total cost (with land)'], ['gdv', 'finished value']]], ['buildableSf', 'Buildable SF', 'num'], ['units', 'Units', 'num']],
    run: (v) => {
      const r = residualLand(v);
      if (!r) return { lines: [['Enter the finished value (or NOI and exit cap) and hard costs', '—']] };
      return { lines: [['Residual land value', money0(r.land), true], ['Per buildable SF', money2(r.perBuildableSf)], ['Per unit', money0(r.perUnit)], ['Finished value, net of sale costs', money0(r.net)], ['Costs before land', money0(r.costs), false, `soft ${money0(r.soft)}, contingency ${money0(r.contingency)}, financing ${money0(r.finance)}`], ['Developer profit', money0(r.profit)]], warnings: r.warnings };
    },
  },
  {
    id: 'yoc', group: 'Development', title: 'Yield on cost', color: '#78350F', icon: '<path d="M4 20h16M7 16V9M12 16V5M17 16v-4"/>',
    desc: 'Stabilized NOI over total cost, and the spread over the exit cap.',
    inputs: [['noi', 'Stabilized NOI', 'money'], ['land', 'Land', 'money'], ['hardCost', 'Hard costs', 'money'], ['softCost', 'Soft costs', 'money'], ['financeCost', 'Financing costs', 'money'], ['exitCap', 'Exit cap %', 'pct', '6']],
    run: (v) => { const r = yieldOnCost(v); return r ? { lines: [['Yield on cost', pct(r.yoc, 2), true], ['Spread over the exit cap', ok(r.spreadBps) ? `${Math.round(r.spreadBps)} bp` : '—', true], ['Total cost', money0(r.cost)], ['Value at the exit cap', money0(r.value)], ['Value created', money0(r.valueCreated), false, ok(r.margin) ? `${pct(r.margin, 1)} on cost` : null]], warnings: ok(r.spreadBps) && r.spreadBps < 100 ? ['Under 100 bp of spread leaves little room for cost overruns or a softer exit.'] : [] } : { lines: [['Enter the NOI and the costs', '—']] }; },
  },
  {
    id: 'draws', group: 'Development', title: 'Construction draws', color: '#A16207', icon: '<path d="M3 20h18M6 20v-6M10 20v-9M14 20V8M18 20V5"/>',
    desc: 'Costs spent month by month, equity first, then the loan, with interest capitalized.',
    inputs: [['totalCost', 'Total cost to fund', 'money'], ['months', 'Months to build', 'int', '18'], ['curve', 'Spending pattern', 'select', [['s', 'S-curve'], ['straight', 'Straight line']]], ['loanToCost', 'Loan to cost %', 'pct', '65'], ['rate', 'Construction rate %', 'pct', '8']],
    run: (v) => { const r = drawSchedule(v); return r ? { lines: [['Interest during construction', money0(r.interest), true], ['Loan at completion', money0(r.loanAtCompletion)], ['Equity in first', money0(r.equity)], ['Loan drawn for costs', money0(r.loanDrawn)]], tables: [{ title: 'By month', head: ['Month', 'Cost', 'Equity', 'Loan', 'Interest', 'Loan balance'], rows: r.rows.map((x) => [x.month, money0(x.cost), money0(x.equity), money0(x.loan), money0(x.interest), money0(x.loanBalance)]) }] } : { lines: [['Enter the cost and the months', '—']] }; },
  },
];
