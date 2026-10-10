/* engine/leasing.js -- net effective rent, one definition for the NER tool,
 * the lease comparison and the comp workbook's Lease Comps formula.
 *
 * Total base rent over the term, each escalation compounding on the prior
 * year's rent at the lease anniversary, less the rent forgone in the free
 * months (at the rent in force then: the first months), less the TI allowance
 * and, when entered, leasing commissions (a % of total rent); divided by the
 * term in years and by SF. The discounted figure is the level rent with the
 * same present value, monthly in advance. */

const ok = (x) => typeof x === 'number' && Number.isFinite(x);
const pos = (x) => ok(x) && x > 0;

/**
 * @param {{ rent: UsdPerSfYear, sf: Sf, months: Months, esc?: Pct, free?: Months, ti?: UsdPerSf, lc?: Pct, discount?: Pct }} lease
 */
export function netEffectiveRent({ rent, sf, months, esc = 0, free = 0, ti = 0, lc = 0, discount = 0 }) {
  if (!pos(rent) || !pos(sf) || !pos(months)) return null;
  const n = Math.round(months);
  const r = ok(discount) && discount > 0 ? discount / 100 / 12 : 0;
  let gross = 0; let cash = 0; let pv = 0;
  for (let i = 0; i < n; i++) {
    const m = (rent * sf / 12) * (1 + (esc || 0) / 100) ** Math.floor(i / 12);
    gross += m;
    // free months, including a part month (2.5 months free forgoes half of the third month)
    const paid = m * (1 - Math.min(1, Math.max(0, (free || 0) - i)));
    cash += paid;
    pv += paid / (1 + r) ** i;
  }
  const tiTotal = (ti || 0) * sf;
  const lcTotal = gross * (lc || 0) / 100;
  const net = cash - tiTotal - lcTotal;
  const years = n / 12;
  const annuity = r ? ((1 - (1 + r) ** -n) / r) * (1 + r) : n;
  const pvNet = pv - tiTotal - lcTotal;
  return {
    gross, cash, freeRent: gross - cash, ti: tiTotal, lc: lcTotal, net,
    // present value at the discount rate (monthly, in advance), after TI and commission; the undiscounted net when no rate
    pv: r ? pvNet : net,
    nerSimple: net / sf / years,
    nerDiscounted: r ? ((pvNet / annuity) * 12) / sf : net / sf / years,
    avgRent: gross / sf / years,
    concessionPct: gross ? ((gross - net) / gross) * 100 : null,
    netOf: pos(lc) ? 'free rent, TI and commissions' : 'free rent and TI',
  };
}

/**
 * The same definition as an Excel formula for one Lease Comps row: base rent
 * K, term I (months), escalation M (fraction a year), free months N, TI O.
 * Total rent over m months is K × (((1+M)^Y − 1)/M + (m − 12Y)/12 × (1+M)^Y),
 * Y = INT(m/12) (K × m/12 when M is 0); NER = (total(I) − total(N) − O) ÷ (I/12).
 * No commission column on that tab, so it is NER net of free rent and TI.
 */
export function nerExcel(r) {
  const esc = `IF(M${r}="",0,M${r})`;
  const free = `IF(N${r}="",0,N${r})`;
  const term = `ROUND(I${r},0)`; // whole months, as the engine counts the term
  const total = (m) => `IF(${esc}=0,K${r}*(${m})/12,K${r}*(((1+${esc})^INT((${m})/12)-1)/${esc}+((${m})-12*INT((${m})/12))/12*(1+${esc})^INT((${m})/12)))`;
  return `IF(OR(K${r}="",I${r}=""),"",(${total(term)}-${total(free)}-IF(O${r}="",0,O${r}))/(${term}/12))`;
}
