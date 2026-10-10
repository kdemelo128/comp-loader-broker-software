/* calc.js -- the calculators behind the Tools screen, beyond the original
 * seven. Pure functions: each takes the figures a broker would type and
 * returns every result, with null wherever an input is missing, and
 * `warnings` for inputs that are implausible or inconsistent.
 *
 * Shared arithmetic comes from deal.js (debt service, balances, IRR, loan
 * sizing, hold returns) and lease.js (rent schedules), so a DSCR or an IRR
 * here is the same number the Deal screen shows. */

import { debtService, balanceAfter, sizeLoan, irr, holdReturns } from './deal.js';
import { generateSteps, monthlyAmount, dayOf } from './lease.js';
import { netEffectiveRent } from './tools.js';

const ok = (x) => typeof x === 'number' && Number.isFinite(x);
const pos = (x) => ok(x) && x > 0;
const nz = (x) => (ok(x) ? x : 0);

/* ------------------------------------------------------------------ debt */

/**
 * A loan month by month: interest-only for `ioYears`, then amortizing over
 * `amortYears`, to a maturity of `termYears` (the balloon is the balance then).
 */
export function amortization({ loan, rate, amortYears = 30, termYears = 10, ioYears = 0 }) {
  if (!pos(loan) || !ok(rate) || rate < 0 || !pos(termYears)) return null;
  const i = rate / 100 / 12;
  const months = Math.round(termYears * 12);
  const io = Math.min(months, Math.round(nz(ioYears) * 12));
  const n = Math.round(nz(amortYears) * 12);
  if (months > io && !pos(n)) return null;
  const pmtAmort = i === 0 ? loan / n : (loan * i) / (1 - (1 + i) ** -n);
  let bal = loan;
  const rows = [];
  for (let k = 1; k <= months; k++) {
    const interest = bal * i;
    const payment = k <= io ? interest : Math.min(pmtAmort, bal + interest);
    const principal = payment - interest;
    bal = Math.max(0, bal - principal);
    rows.push({ month: k, payment, interest, principal, balance: bal });
  }
  const years = [];
  for (let y = 0; y < Math.ceil(months / 12); y++) {
    const part = rows.slice(y * 12, y * 12 + 12);
    years.push({ year: y + 1, payment: part.reduce((s, r) => s + r.payment, 0), interest: part.reduce((s, r) => s + r.interest, 0), principal: part.reduce((s, r) => s + r.principal, 0), balance: part[part.length - 1].balance });
  }
  return { months: rows, years, monthlyIo: loan * i, monthlyAmortizing: pmtAmort, balloon: bal, totalInterest: rows.reduce((s, r) => s + r.interest, 0) };
}

/** Refinance: the new loan the property supports, the old loan paid off, and the cash left. */
export function refinance({ noi, value, capRate, balance, maxLtv, minDscr, minDy, rate, amort, io, costsPct = 1 }) {
  const v = pos(value) ? value : pos(noi) && pos(capRate) ? noi / (capRate / 100) : null;
  const s = sizeLoan({ price: v, noi, ltv: maxLtv, dscr: minDscr, dy: minDy, rate, amort, io });
  if (!s) return { value: v, sized: null, warnings: ['Enter NOI and a value (or cap rate), and the lender’s tests.'] };
  const costs = s.loan * nz(costsPct) / 100;
  const ds = debtService(s.loan, rate, amort, io);
  const cashOut = s.loan - nz(balance) - costs;
  const warnings = [];
  if (cashOut < 0) warnings.push(`The new loan falls ${Math.round(-cashOut).toLocaleString('en-US')} dollars short of paying off the old one and the costs: cash in, not out.`);
  return { value: v, sized: s, loan: s.loan, costs, cashOut, debtService: ds, dscr: ok(ds) && ok(noi) ? noi / ds : null, ltv: v ? (s.loan / v) * 100 : null, warnings };
}

/** Floating rate: debt service and coverage as the index moves, with an interest-rate cap if bought. */
export function floating({ loan, index, spread, capStrike, noi, shocks = [-100, 0, 100, 200, 300] }) {
  if (!pos(loan) || !ok(index) || !ok(spread)) return null;
  return shocks.map((bp) => {
    const idx = index + bp / 100;
    const capped = ok(capStrike) ? Math.min(idx, capStrike) : idx;
    const r = Math.max(0, capped) + spread;
    const ds = loan * r / 100;
    return { shock: bp, index: idx, cappedIndex: capped, rate: r, debtService: ds, dscr: ok(noi) ? noi / ds : null };
  });
}

/**
 * Refinance risk at maturity: the balance then, against what the property
 * could borrow then (NOI grown, valued at a refinance cap, under the new
 * lender's tests). A shortfall is equity the owner must bring.
 */
export function maturityRisk({ loan, rate, amort, io, termYears, noi, growth = 0, refiCap, refiLtv, refiDscr, refiDy, refiRate, refiAmort = 30 }) {
  if (!pos(loan) || !pos(termYears) || !ok(noi)) return null;
  const balance = balanceAfter(loan, rate, amort, termYears, io);
  const noiAtMaturity = noi * (1 + nz(growth) / 100) ** termYears;
  const value = pos(refiCap) ? noiAtMaturity / (refiCap / 100) : null;
  const s = sizeLoan({ price: value, noi: noiAtMaturity, ltv: refiLtv, dscr: refiDscr, dy: refiDy, rate: refiRate, amort: refiAmort, io: false });
  const proceeds = s ? s.loan : null;
  return { balance, noiAtMaturity, value, proceeds, binding: s ? s.binding : null, gap: ok(proceeds) && ok(balance) ? proceeds - balance : null, ltvAtMaturity: value && ok(balance) ? (balance / value) * 100 : null };
}

/** All-in cost of the loan: points, closing costs and reserves held back. */
export function loanFees({ loan, points = 1, lenderLegal = 0, thirdParty = 0, reserves = 0 }) {
  if (!pos(loan)) return null;
  const pts = loan * nz(points) / 100;
  const total = pts + nz(lenderLegal) + nz(thirdParty) + nz(reserves);
  return { points: pts, total, netProceeds: loan - total, pctOfLoan: (total / loan) * 100 };
}

/* ------------------------------------------------------------- valuation */

/**
 * Discounted cash flow: each year's NOI (grown, or from a series) and the
 * sale at the end (next year's NOI at the exit cap, less sale costs), all
 * discounted to today. Annual, end-of-year cash flows.
 */
export function dcf({ noi, growth = 0, years = 10, discount, exitCap, saleCost = 0, capex = 0, noiSeries = null }) {
  const n = Math.round(years);
  if (!pos(discount) || !pos(exitCap) || !(n >= 1 && n <= 50)) return null;
  const series = Array.isArray(noiSeries) && noiSeries.length >= n + 1 ? noiSeries.slice(0, n + 1) : (ok(noi) ? Array.from({ length: n + 1 }, (_, t) => noi * (1 + nz(growth) / 100) ** t) : null);
  if (!series) return null;
  const d = discount / 100;
  const rows = [];
  let pvCf = 0;
  for (let t = 1; t <= n; t++) {
    const cf = series[t - 1] - nz(capex);
    const pv = cf / (1 + d) ** t;
    pvCf += pv;
    rows.push({ year: t, noi: series[t - 1], cashFlow: cf, pv });
  }
  const reversion = (series[n] / (exitCap / 100)) * (1 - nz(saleCost) / 100);
  const pvRev = reversion / (1 + d) ** n;
  const value = pvCf + pvRev;
  return { rows, reversion, pvReversion: pvRev, pvCashFlows: pvCf, value, impliedCap: value ? (series[0] / value) * 100 : null, reversionShare: value ? (pvRev / value) * 100 : null };
}

/** An operating statement from its parts: potential rent down to NOI, with the ratios lenders ask for. */
export function noiBridge({ gpr, vacancyPct = 0, creditPct = 0, concessions = 0, otherIncome = 0, recoveries = 0, taxes = 0, insurance = 0, utilities = 0, repairs = 0, payroll = 0, mgmtPct = 0, otherExp = 0, reserves = 0, bsf, units }) {
  if (!pos(gpr)) return null;
  const vacancy = gpr * nz(vacancyPct) / 100;
  const credit = gpr * nz(creditPct) / 100;
  const egi = gpr - vacancy - credit - nz(concessions) + nz(otherIncome) + nz(recoveries);
  const mgmt = egi * nz(mgmtPct) / 100;
  const opex = nz(taxes) + nz(insurance) + nz(utilities) + nz(repairs) + nz(payroll) + mgmt + nz(otherExp) + nz(reserves);
  const noi = egi - opex;
  const warnings = [];
  if (nz(vacancyPct) + nz(creditPct) > 50) warnings.push('Vacancy and credit loss above half of potential rent: check the inputs.');
  if (noi < 0) warnings.push('Expenses exceed income: NOI is negative.');
  return {
    vacancy, credit, egi, mgmt, opex, noi, expenseRatio: egi ? (opex / egi) * 100 : null,
    opexPsf: pos(bsf) ? opex / bsf : null, opexPerUnit: pos(units) ? opex / units : null, noiPsf: pos(bsf) ? noi / bsf : null, warnings,
  };
}

/** Break-even occupancy: the share of potential income that covers expenses and debt service. */
export function breakEven({ gpr, opex, debtService: ds = 0, otherIncome = 0 }) {
  if (!pos(gpr) || !ok(opex)) return null;
  const need = opex + nz(ds) - nz(otherIncome);
  return { occupancy: (need / gpr) * 100, need, cushion: 100 - (need / gpr) * 100 };
}

/** A two-way table: `fn(x, y)` for every row value x and column value y. */
export function sensitivity(fn, xs, ys) {
  return xs.map((x) => ys.map((y) => { const v = fn(x, y); return ok(v) ? v : null; }));
}
/** Steps either side of a centre: (6.5, 0.25, 2) -> [6, 6.25, 6.5, 6.75, 7]. */
export const around = (centre, step, n = 2) => (ok(centre) && pos(step) ? Array.from({ length: 2 * n + 1 }, (_, k) => Math.round((centre + (k - n) * step) * 1e6) / 1e6) : []);

/* --------------------------------------------------------------- returns */

/**
 * Hold returns with sponsor fees: an acquisition fee paid at closing (more
 * equity), an asset-management fee each year (on the initial equity), and a
 * disposition fee at sale. Returns the investor's IRR before and after fees.
 */
export function holdWithFees(args, { acqFeePct = 0, amFeePct = 0, dispFeePct = 0, capexPerYear = 0 } = {}) {
  const r = holdReturns(args);
  if (!r) return null;
  const acq = args.price * nz(acqFeePct) / 100;
  const am = r.equity * nz(amFeePct) / 100;
  const disp = r.exitValue * nz(dispFeePct) / 100;
  const flows = r.levered.map((x, t) => (t === 0 ? x - acq : x - am - nz(capexPerYear) - (t === r.hold ? disp : 0)));
  const eq = r.equity + acq;
  return {
    ...r, fees: { acq, am, disp, total: acq + am * r.hold + disp }, leveredAfterFees: flows,
    irrAfterFees: irr(flows), multipleAfterFees: flows.slice(1).reduce((s, x) => s + x, 0) / eq,
    byYear: flows.slice(1).map((cf, i) => ({ year: i + 1, noi: r.nois[i], debtService: r.debtService, cashFlow: cf - (i + 1 === r.hold ? r.exitValue - r.saleCosts - r.balance - disp : 0), coc: eq ? ((cf - (i + 1 === r.hold ? r.exitValue - r.saleCosts - r.balance - disp : 0)) / eq) * 100 : null })),
  };
}

/**
 * A distribution waterfall with IRR hurdles, on yearly equity cash flows
 * (`flows[0]` the contribution, negative). Rules, stated so they can be
 * checked: capital comes in pro rata, `lpShare` from the investors and the
 * rest from the sponsor. Cash out goes in bands. Until the investors reach
 * the first hurdle, it is split pro rata (no promote). Between hurdle k and
 * k+1, the sponsor takes `promote[k]` off the top and the rest is pro rata.
 * Above the last hurdle, the last promote applies. A hurdle is reached when
 * the investors' contributions, compounded yearly at the hurdle rate, have
 * been paid back by their distributions compounded the same way. No
 * catch-up, no clawback, annual compounding.
 */
export function waterfall({ flows, lpShare = 90, hurdles = [8, 12, 15], promotes = [20, 30, 40] }) {
  if (!Array.isArray(flows) || flows.length < 2 || !flows.every(ok) || !(flows[0] < 0)) return null;
  const lp = Math.min(100, Math.max(0, lpShare)) / 100;
  const hs = hurdles.filter(ok);
  const pr = [0, ...promotes.slice(0, hs.length).map((p) => nz(p) / 100)];
  const bal = hs.map(() => 0);
  const lpFlows = []; const gpFlows = [];
  const bands = Array.from({ length: hs.length + 1 }, () => ({ lp: 0, gp: 0 }));
  flows.forEach((x, t) => {
    if (t > 0) for (let k = 0; k < hs.length; k++) bal[k] *= 1 + hs[k] / 100;
    let lpT = 0; let gpT = 0;
    if (x < 0) {
      lpT = x * lp; gpT = x * (1 - lp);
      for (let k = 0; k < hs.length; k++) bal[k] += -lpT;
    } else {
      let cash = x;
      for (let band = 0; band <= hs.length && cash > 1e-9; band++) {
        const f = (1 - pr[band]) * lp;        // the investors' share of each dollar in this band
        const need = band < hs.length ? Math.max(0, bal[band]) : Infinity;
        const take = Math.min(cash, f > 0 ? need / f : cash);
        const toLp = take * f;
        lpT += toLp; gpT += take - toLp;
        bands[band].lp += toLp; bands[band].gp += take - toLp;
        for (let k = 0; k < hs.length; k++) bal[k] -= toLp;
        cash -= take;
      }
    }
    lpFlows.push(lpT); gpFlows.push(gpT);
  });
  const sum = (a) => a.slice(1).reduce((s, v) => s + v, 0);
  const lpIn = -lpFlows[0]; const gpIn = -gpFlows[0];
  return {
    lpFlows, gpFlows, bands, lpIrr: irr(lpFlows), gpIrr: gpIn > 0 ? irr(gpFlows) : null, projectIrr: irr(flows),
    lpMultiple: lpIn ? sum(lpFlows) / lpIn : null, gpMultiple: gpIn ? sum(gpFlows) / gpIn : null,
    // what the sponsor got beyond its pro-rata share of everything paid out
    promote: sum(gpFlows) - sum(flows) * (1 - lp),
    totalOut: sum(flows),
  };
}

/**
 * Brokerage commission on a sale: a flat rate, or tiers ("6% of the first
 * $1M, 4% of the next $4M, 2% above"), split with a cooperating broker, then
 * between the house and the agent, less a referral.
 */
export function commission({ price, flatPct, tiers = [], coBrokerPct = 0, housePct = 0, referralPct = 0 }) {
  if (!pos(price)) return null;
  let total = 0;
  const lines = [];
  if (ok(flatPct)) { total = price * flatPct / 100; lines.push({ from: 0, to: price, pct: flatPct, amount: total }); } else {
    let lo = 0;
    for (const t of tiers.filter((x) => ok(x.pct))) {
      const hi = ok(t.upTo) ? Math.min(price, t.upTo) : price;
      if (hi > lo) { const a = (hi - lo) * t.pct / 100; total += a; lines.push({ from: lo, to: hi, pct: t.pct, amount: a }); }
      if (!ok(t.upTo) || t.upTo >= price) { lo = price; break; }
      lo = t.upTo;
    }
    if (lo < price) lines.push({ from: lo, to: price, pct: 0, amount: 0, note: 'no rate for this part of the price' });
  }
  const coop = total * nz(coBrokerPct) / 100;
  const ours = total - coop;
  const referral = ours * nz(referralPct) / 100;
  const house = (ours - referral) * nz(housePct) / 100;
  return { total, effectivePct: (total / price) * 100, lines, coBroker: coop, listingSide: ours, referral, house, agent: ours - referral - house };
}

/* --------------------------------------------------------------- leasing */

/** Up to three lease proposals side by side, on the same terms of comparison. */
export function compareLeases(proposals, discount = 8) {
  return proposals.map((p) => {
    const r = netEffectiveRent({ ...p, discount });
    return r ? { ...p, ...r, landlordPv: r.pv } : null;
  });
}

/**
 * Renew the tenant, or let it go and re-let: the landlord's present value of
 * each over the same span, monthly. `renew` and `replace` each take rent
 * ($/SF/yr), escalation %, free months, TI $/SF, commission % of rent, and
 * term; `replace` adds downtime months before the new lease starts.
 */
export function renewalVsReplacement({ sf, renew, replace, discount = 8 }) {
  if (!pos(sf)) return null;
  const span = Math.max(Math.round(nz(renew.months)), Math.round(nz(replace.downtime)) + Math.round(nz(replace.months)));
  const r = nz(discount) / 100 / 12;
  const flow = (o, start) => {
    const out = Array(span).fill(0);
    const m = Math.round(nz(o.months));
    let rentTotal = 0;
    for (let k = 0; k < m && start + k < span; k++) {
      const rent = (nz(o.rent) * sf / 12) * (1 + nz(o.esc) / 100) ** Math.floor(k / 12);
      rentTotal += rent;
      if (k >= nz(o.free)) out[start + k] += rent;
    }
    const up = nz(o.ti) * sf + rentTotal * nz(o.lc) / 100;
    if (start < span) out[start] -= up;
    return out;
  };
  const pv = (xs) => xs.reduce((s, x, k) => s + x / (1 + r) ** k, 0);
  const a = flow(renew, 0);
  const b = flow(replace, Math.round(nz(replace.downtime)));
  const pva = pv(a); const pvb = pv(b);
  return { months: span, renewPv: pva, replacePv: pvb, advantage: pva - pvb, better: pva >= pvb ? 'renew' : 'replace', renewTotal: a.reduce((s, x) => s + x, 0), replaceTotal: b.reduce((s, x) => s + x, 0) };
}

/** Percentage rent: the share of sales above the breakpoint (set, or natural = base rent ÷ rate). */
export function percentageRent({ sales, rate, breakpoint, baseRent, natural = false }) {
  if (!ok(sales) || !pos(rate)) return null;
  const bp = natural && pos(baseRent) ? baseRent / (rate / 100) : breakpoint;
  if (!ok(bp)) return null;
  const overage = Math.max(0, sales - bp) * rate / 100;
  return { breakpoint: bp, overage, occupancyCost: pos(baseRent) ? ((baseRent + overage) / sales) * 100 : null, salesToBreakpoint: bp - sales };
}

/** A tenant's share of operating expenses: pro rata, over a base year, over a stop, or fixed. */
export function recovery({ expenses, tenantSf, buildingSf, sharePct, method = 'prorata', baseYear, stopPsf, fixed }) {
  if (!ok(expenses)) return null;
  const share = ok(sharePct) ? sharePct / 100 : pos(tenantSf) && pos(buildingSf) ? tenantSf / buildingSf : null;
  if (method === 'fixed') return { share, annual: nz(fixed), monthly: nz(fixed) / 12 };
  if (share === null) return null;
  let annual = 0;
  if (method === 'prorata') annual = expenses * share;
  else if (method === 'base_year') annual = Math.max(0, expenses - nz(baseYear)) * share;
  else if (method === 'stop') annual = pos(buildingSf) && pos(tenantSf) ? Math.max(0, expenses / buildingSf - nz(stopPsf)) * tenantSf : 0;
  return { share: share * 100, annual, monthly: annual / 12, psf: pos(tenantSf) ? annual / tenantSf : null };
}

/** Lease-up of vacant space at a steady pace: how long, and the rent not earned meanwhile. */
export function absorption({ vacantSf, sfPerMonth, rentPsf, freeMonths = 0 }) {
  if (!pos(vacantSf) || !pos(sfPerMonth) || !pos(rentPsf)) return null;
  const months = Math.ceil(vacantSf / sfPerMonth);
  let lost = 0; let leased = 0;
  const rows = [];
  for (let k = 1; k <= months; k++) {
    const before = leased;
    leased = Math.min(vacantSf, leased + sfPerMonth);
    // a month's new leases earn nothing during their free months; the space not yet leased earns nothing at all
    lost += (vacantSf - before) * rentPsf / 12;
    rows.push({ month: k, leasedSf: leased, occupiedPct: (leased / vacantSf) * 100 });
  }
  const freeCost = vacantSf * rentPsf / 12 * nz(freeMonths);
  return { months, lostRent: lost, freeRentCost: freeCost, totalCost: lost + freeCost, rows };
}

/** A rent schedule from a starting rent and bumps, as dated steps with totals. */
export function escalationSchedule({ start, months, rate, unit = 'psf_year', sf, type = 'pct', value = 3, every = 12 }) {
  if (!dayOf(start) || !pos(months) || !ok(rate)) return null;
  const endD = new Date((dayOf(start) * 86400000));
  endD.setUTCMonth(endD.getUTCMonth() + Math.round(months));
  endD.setUTCDate(endD.getUTCDate() - 1);
  const steps = generateSteps({ start, end: endD.toISOString().slice(0, 10), rate, unit, escalation: { type, value }, every });
  let total = 0;
  const rows = steps.map((s) => {
    const mo = monthlyAmount(s.rate, s.unit, sf);
    const mths = Math.round((dayOf(s.end) - dayOf(s.start) + 1) / 30.4375);
    if (mo !== null) total += mo * mths;
    return { ...s, monthly: mo, months: mths };
  });
  return { rows, total: rows.every((r) => r.monthly !== null) ? total : null, average: rows.every((r) => r.monthly !== null) ? total / Math.round(months) : null };
}

/* ----------------------------------------------------------- development */

/**
 * Residual land value: what the finished project is worth, less every cost
 * of building it and the developer's profit, is what the land can bear.
 */
export function residualLand({ gdv, noi, exitCap, saleCostPct = 2, hardCost, softPct = 20, contingencyPct = 5, financePct = 6, profitPct = 15, profitOn = 'cost', buildableSf, units }) {
  const value = pos(gdv) ? gdv : pos(noi) && pos(exitCap) ? noi / (exitCap / 100) : null;
  if (!value || !pos(hardCost)) return null;
  const net = value * (1 - nz(saleCostPct) / 100);
  const soft = hardCost * nz(softPct) / 100;
  const cont = (hardCost + soft) * nz(contingencyPct) / 100;
  const base = hardCost + soft + cont;
  const finance = base * nz(financePct) / 100;
  const costs = base + finance;
  // profit on cost includes the land in the cost: solve L = net - costs - p(costs + L)
  const p = nz(profitPct) / 100;
  const land = profitOn === 'gdv' ? net - costs - value * p : (net - costs * (1 + p)) / (1 + p);
  const profit = profitOn === 'gdv' ? value * p : (costs + land) * p;
  return { value, net, soft, contingency: cont, finance, costs, profit, land, perBuildableSf: pos(buildableSf) ? land / buildableSf : null, perUnit: pos(units) ? land / units : null, warnings: land < 0 ? ['The project does not support a land price at these costs and this profit.'] : [] };
}

/** Yield on cost and the spread over the exit cap: how much value development creates. */
export function yieldOnCost({ noi, land = 0, hardCost = 0, softCost = 0, financeCost = 0, exitCap }) {
  const cost = nz(land) + nz(hardCost) + nz(softCost) + nz(financeCost);
  if (!pos(noi) || !pos(cost)) return null;
  const yoc = (noi / cost) * 100;
  const value = pos(exitCap) ? noi / (exitCap / 100) : null;
  return { cost, yoc, spreadBps: pos(exitCap) ? (yoc - exitCap) * 100 : null, value, valueCreated: value !== null ? value - cost : null, margin: value !== null ? ((value - cost) / cost) * 100 : null };
}

/**
 * A construction draw schedule: costs spent over `months` (straight-line, or
 * an S-curve that starts slow, peaks mid-build and tails off), equity first,
 * then the loan, with interest on the drawn loan balance added to the loan
 * each month (capitalised), as construction lenders usually do.
 */
export function drawSchedule({ totalCost, months, curve = 's', loanToCost = 65, rate = 8 }) {
  const n = Math.round(nz(months));
  if (!pos(totalCost) || !(n >= 1 && n <= 120)) return null;
  const w = Array.from({ length: n }, (_, i) => (curve === 'straight' ? 1 : Math.sin(Math.PI * (i + 0.5) / n) ** 2));
  const ws = w.reduce((s, x) => s + x, 0);
  const equity = totalCost * (1 - nz(loanToCost) / 100);
  const i = nz(rate) / 100 / 12;
  let spent = 0; let eqUsed = 0; let loanBal = 0; let interest = 0;
  const rows = [];
  for (let k = 0; k < n; k++) {
    const cost = (totalCost * w[k]) / ws;
    const fromEq = Math.max(0, Math.min(cost, equity - eqUsed));
    eqUsed += fromEq;
    const fromLoan = cost - fromEq;
    const int = loanBal * i;
    interest += int;
    loanBal += fromLoan + int;
    spent += cost;
    rows.push({ month: k + 1, cost, equity: fromEq, loan: fromLoan, interest: int, loanBalance: loanBal, spentPct: (spent / totalCost) * 100 });
  }
  return { rows, equity: eqUsed, loanDrawn: loanBal - interest, interest, loanAtCompletion: loanBal };
}

/* ----------------------------------------------------------------- comps */

/**
 * How much a set of sale comps can bear: how many, how recent, how spread,
 * and a value range for the subject at their $/SF. Never invents distance:
 * the comps carry no coordinates here, so location is left to the broker.
 */
export function compSetCheck(sales, { subjectSf, today = new Date() } = {}) {
  const priced = (sales || []).filter((c) => pos(c.price) && pos(c.bsf));
  const ppsf = priced.map((c) => c.price / c.bsf).sort((a, b) => a - b);
  const q = (p) => { if (!ppsf.length) return null; const i = (ppsf.length - 1) * p; const lo = Math.floor(i); return ppsf[lo] + (ppsf[Math.ceil(i)] - ppsf[lo]) * (i - lo); };
  const mean = ppsf.length ? ppsf.reduce((s, x) => s + x, 0) / ppsf.length : null;
  const sd = ppsf.length > 1 ? Math.sqrt(ppsf.reduce((s, x) => s + (x - mean) ** 2, 0) / (ppsf.length - 1)) : null;
  const ages = priced.filter((c) => c.date).map((c) => (today - new Date(c.date)) / (365.25 * 86400000) * 12).sort((a, b) => a - b);
  const weighted = priced.length ? priced.reduce((s, c) => s + c.price, 0) / priced.reduce((s, c) => s + c.bsf, 0) : null;
  const sizes = priced.map((c) => c.bsf);
  const warnings = [];
  if (priced.length < 3) warnings.push(`Only ${priced.length} priced sale comp${priced.length === 1 ? '' : 's'}: too few to lean on.`);
  if (ages.length && ages[Math.floor(ages.length / 2)] > 24) warnings.push('The median comp sold more than two years ago.');
  if (sd !== null && mean && sd / mean > 0.3) warnings.push(`The $/SF spread is wide (coefficient of variation ${Math.round((sd / mean) * 100)}%): the comps may not be alike.`);
  if (pos(subjectSf) && sizes.length && (subjectSf < Math.min(...sizes) * 0.5 || subjectSf > Math.max(...sizes) * 2)) warnings.push('The subject is far outside the comps’ size range.');
  const capN = (sales || []).filter((c) => pos(c.cap)).length;
  if (capN < 3) warnings.push(`${capN} comp${capN === 1 ? '' : 's'} report a cap rate.`);
  return {
    n: priced.length, capN, low: ppsf[0] ?? null, p25: q(0.25), median: q(0.5), p75: q(0.75), high: ppsf[ppsf.length - 1] ?? null, weighted,
    cv: sd !== null && mean ? (sd / mean) * 100 : null, medianAgeMonths: ages.length ? ages[Math.floor(ages.length / 2)] : null,
    value: pos(subjectSf) ? { p25: q(0.25) * subjectSf, median: q(0.5) * subjectSf, weighted: weighted * subjectSf, p75: q(0.75) * subjectSf } : null,
    warnings,
  };
}
