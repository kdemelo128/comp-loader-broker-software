/* tests/tools/cents-audit.mjs -- not a test: the measurement behind docs/proposals/checkpoint-b.md.
 * Run: node tests/tools/cents-audit.mjs [out.json] (needs tests/e2e/files/pages.json, made by tests/e2e/run.sh).
 *
 * What would storing typed and extracted money as whole cents change on screen?
 * For every money input, the worst a cents rounding can do is move it by just
 * under half a cent. Each input in turn is given a sub-cent part of 0.00499 (as
 * it might have been typed, extracted or written back today) and every
 * displayed output is computed with and without it, at the precision it is shown. */
globalThis.window = {}; globalThis.document = { addEventListener() {}, dispatchEvent() {} };
const A = new URL('../../app/', import.meta.url).pathname;
const fs = await import('node:fs');
const { readOm } = await import(A + 'om.js');
const { analyze, runScenario, scenarioAnswers } = await import(A + 'deal.js');
const { dealValues } = await import(A + 'dealfields.js');
const { fromOmRows, rentRollSummary, project, DEFAULT_SETTINGS } = await import(A + 'lease.js');
const { money0, money2, pct, times, dec, int } = await import(A + 'kit.js');
const { MORE_TOOLS } = await import(A + 'toolsdefs.js');
const T = await import(A + 'tools.js');
const pages = JSON.parse(fs.readFileSync(new URL('../e2e/files/pages.json', import.meta.url), 'utf8'));
const AS_OF = '2026-10-10'; const TODAY = new Date('2026-10-10T12:00:00Z');
const EPS = 0.00499;
const LOAN = { ltv: 65, rate: 6.75, amort: 30, io: false, closing: 2, minDscr: 1.25, minDy: 8 };
const MONEY_FIGS = ['price', 'noi', 'gpr', 'gross', 'opex', 'taxes', 'noi_pf', 'price_unit', 'price_psf'];
const fmtT = (type, v) => (v === null || v === undefined || typeof v !== 'number') ? String(v ?? '') : type === 'money' ? money0(v) : type === 'money2' ? money2(v) : type === 'pct' ? `${dec(v, 2)}%` : type === 'dec' ? dec(v, 2) : type === 'int' ? int(v) : String(v);

function dealScreens(figures, rr) {
  const deal = { figures, loan: { ...LOAN }, rr };
  const m = analyze({ ...figures, loan: LOAN }, null, TODAY);
  const rrSum = rr ? rentRollSummary(rr, AS_OF) : null;
  const rrProj = rr ? project(rr, { asOf: AS_OF, years: 10 }) : null;
  const out = {};
  const dv = dealValues({ deal, m, rrSum, rrProj });
  for (const [k, x] of Object.entries(dv)) if (typeof x.value === 'number') out[`Overview/workbook field: ${x.label}`] = fmtT(x.type, x.value);
  out['Overview: break-even'] = pct(m.breakEven, 1);
  for (const r of m.ladder || []) { out[`Value across cap rates ${pct(r.cap)}: value`] = money0(r.value); out[`Value across cap rates ${pct(r.cap)}: $/SF`] = money2(r.psf); }
  out['Overview: max loan'] = money0(m.maxLoan && m.maxLoan.loan);
  const rows = [['Price', (r) => money0(r.inputs.price)], ['NOI, year 1', (r) => money0(r.m.noi)], ['Cap rate', (r) => pct(r.m.capCalc)], ['Price / SF', (r) => money2(r.m.ppsf)],
    ['Loan', (r) => money0(r.m.loan)], ['DSCR', (r) => times(r.m.dscr)], ['Debt yield', (r) => pct(r.m.debtYield)], ['Cash-on-cash', (r) => pct(r.m.cashOnCash)], ['Equity', (r) => money0(r.m.equity)],
    ['Exit value', (r) => money0(r.returns?.exitValue)], ['Levered IRR', (r) => pct(r.returns?.leveredIrr)], ['Equity multiple', (r) => dec(r.returns?.leveredMultiple, 2)], ['Unlevered IRR', (r) => pct(r.returns?.unleveredIrr)]];
  const run = runScenario({ ...figures, loan: LOAN }, m, {});
  for (const [l, f] of rows) out[`What if: ${l}`] = f(run);
  const a = scenarioAnswers({ ...figures, loan: LOAN }, m, {}, { targetCap: 6.25, targetIrr: 15, capForValue: 6.35 });
  out['What if: price for a 6.25% cap'] = money0(a.priceForCap); out['What if: price for a 15% IRR'] = money0(a.priceForIrr); out['What if: value at 6.35%'] = money0(a.valueAtCap);
  if (rrSum) {
    out['Rent roll: in-place rent'] = money0(rrSum.annualRent); out['Rent roll: monthly'] = money0(rrSum.monthlyRent ?? (rrSum.annualRent / 12)); out['Rent roll: loss to lease'] = money0(rrSum.lossToLease);
    out['Rent roll: WALT'] = dec(rrSum.waltIncome, 1);
    for (const L of rr.leases) { const s = rrSum.byLease ? rrSum.byLease[L.id] : null; if (s) out[`Rent roll ${L.unit}: rent/SF`] = money2(s.psf); }
  }
  if (rrProj) rrProj.annual.forEach((y, i) => { for (const k of ['contract', 'potential', 'egi', 'noi', 'cfbds']) if (typeof y[k] === 'number') out[`Projection yr ${i + 1}: ${k}`] = money0(y[k]); });
  return out;
}
const parse = (kind, s) => { if (s === undefined || s === null || s === '') return null; const t = String(s).toLowerCase().replace(/[$,%\s]/g, ''); const m = /^(-?\d*\.?\d+)(k|m|mm|b)?$/.exec(t); return m ? Number(m[1]) * ({ k: 1e3, m: 1e6, mm: 1e6, b: 1e9 }[m[2]] || 1) : s; };
let compared = 0;
const diff = (a, b) => { const ks = Object.keys({ ...a, ...b }); compared += ks.length; return ks.filter((k) => a[k] !== b[k]).map((k) => `${k}: ${b[k]} → ${a[k]}`); };
const changes = [];

// ---------------------------------------------------------------- deals
for (const name of ['om_retail', 'om_netlease', 'om_multifamily']) {
  const om = readOm(pages[name]);
  const figures = {};
  for (const [k, f] of Object.entries(om.fields)) figures[k === 'lot' ? 'lot_sf' : k] = f.value;
  const rows = om.rentRoll ? om.rentRoll.rows : [];
  const mkRR = (perturb) => {
    if (!rows.length) return null;
    const rr = fromOmRows(rows.map((r) => ({ ...r, start: r.start ? new Date(r.start).toISOString() : null, end: r.end ? new Date(r.end).toISOString() : null })), { asOf: AS_OF, buildingSf: figures.bsf || null });
    rr.settings = { ...DEFAULT_SETTINGS, ...rr.settings, opex: figures.opex ?? null };
    if (perturb) perturb(rr);
    return rr;
  };
  const base = dealScreens(figures, mkRR());
  const whole = Object.values(figures).every((v) => typeof v !== 'number' || Math.round(v * 100) === v * 100);
  changes.push({ where: name, input: '(fixture as read)', note: `money inputs already whole cents: ${whole}`, diffs: [] });
  for (const k of MONEY_FIGS) {
    if (typeof figures[k] !== 'number') continue;
    const f2 = { ...figures, [k]: figures[k] + EPS };
    changes.push({ where: name, input: `figure ${k} = ${figures[k]} + 0.00499`, diffs: diff(dealScreens(f2, mkRR()), base) });
  }
  if (rows.length) {
    // each lease's annual rent with a sub-cent part
    changes.push({ where: name, input: 'every lease\'s annual rent + 0.00499', diffs: diff(dealScreens(figures, mkRR((rr) => rr.leases.forEach((L) => L.periods.forEach((p) => { p.rate += EPS; })))), base) });
    // the same rents entered as $/SF a year, at the four decimals a lease may state, vs rounded to cents
    const psf = (round) => mkRR((rr) => rr.leases.forEach((L) => L.periods.forEach((p) => { if (L.sf) { p.unit = 'psf_year'; const r = Math.round((p.rate / L.sf) * 1e4) / 1e4; p.rate = round ? Math.round(r * 100) / 100 : r; } })));
    changes.push({ where: name, input: 'leases entered as $/SF/yr to 4 decimals, then stored as whole cents', diffs: diff(dealScreens(figures, psf(true)), dealScreens(figures, psf(false))) });
    // a market rent per SF to four decimals vs rounded to cents (drives loss to lease and re-leasing)
    const mk = (round) => mkRR((rr) => { rr.settings.marketRent = round ? 41.27 : 41.2678; rr.settings.marketUnit = 'psf_year'; });
    changes.push({ where: name, input: 'market rent $41.2678/SF/yr stored as $41.27', diffs: diff(dealScreens(figures, mk(true)), dealScreens(figures, mk(false))) });
  }
}

// ------------------------------------------- the built-in tools (toolsui.js), with their real formatting
const K = await import(A + 'kit.js');
const src = fs.readFileSync(A + 'toolsui.js', 'utf8');
const arr = src.slice(src.indexOf('const TOOLS = [') + 'const TOOLS = '.length, src.indexOf('  ...MORE_TOOLS,\n];')) + '];';
const scope = { ...T, money0: K.money0, money2: K.money2, pct: K.pct, signed: K.signed, times: K.times, yrs: K.yrs, niceDate: K.niceDate, int: K.int, dec: K.dec, ok: (x) => typeof x === 'number' && Number.isFinite(x) };
const BUILTIN = new Function(...Object.keys(scope), `return ${arr}`)(...Object.values(scope));
const lines = (tool, v) => { try { const r = tool.run(v, {}); return Object.fromEntries((Array.isArray(r) ? r : r.lines || []).map((l) => [l[0], `${l[1]}${l[3] ? ` (${l[3]})` : ''}`])); } catch (e) { return { error: e.message }; } };
for (const tool of BUILTIN) {
  if (tool.rows) continue; // WALT: its rows are tested below
  const v = {};
  for (const [key, , kind, ph] of tool.inputs) { if (kind === 'select') v[key] = Array.isArray(ph) ? ph[0][0] : ph; else if (kind === 'bool') v[key] = false; else if (kind !== 'date') { const x = parse(kind, ph); v[key] = typeof x === 'number' ? x : null; } }
  const base = lines(tool, v);
  for (const [key, label, kind] of tool.inputs) {
    if (!['money', 'money2'].includes(kind) || typeof v[key] !== 'number') continue;
    changes.push({ where: `Tool: ${tool.title}`, input: `${label} = ${v[key]} + 0.00499`, diffs: diff(lines(tool, { ...v, [key]: v[key] + EPS }), base) });
  }
}
{ // WALT tool: rents typed per lease (shown as WALT years and total rent)
  const rows = [{ tenant: 'A', sf: 2400, annual: 124800, end: '2029-02-28' }, { tenant: 'B', sf: 4200, annual: 151200, end: '2027-12-31' }];
  const show = (rs) => { const w = T.waltTool(rs, TODAY); return { walt: K.dec(w && w.waltIncome, 1), rent: K.money0(w && w.rent) }; };
  changes.push({ where: 'Tool: WALT', input: 'each annual rent + 0.00499', diffs: diff(show(rows.map((r) => ({ ...r, annual: r.annual + EPS }))), show(rows)) });
}
// ----------------------------------------------------------------- comps
{
  const { loadComps } = await import(A + 'costar.js');
  const { compBasis } = await import(A + 'deal.js');
  const comps = loadComps([{ name: 'costar.pdf', pages: pages.costar_set }]).sales || loadComps([{ name: 'costar.pdf', pages: pages.costar_set }]).comps || [];
  const show = (cs) => { const b = compBasis(cs); return { weighted: money2(b.weighted), median: money2(b.median), lo: money2(b.lo), hi: money2(b.hi), ...Object.fromEntries(cs.map((c, i) => [`comp ${i + 1} $/SF`, money2(c.price && c.bsf ? c.price / c.bsf : null)])) }; };
  changes.push({ where: 'Comps', input: `every sale price + 0.00499 (${comps.length} comps)`, diffs: diff(show(comps.map((c) => ({ ...c, price: c.price ? c.price + EPS : c.price }))), show(comps)) });
}
// ---------------------------------------------------------------- tools
const toolOut = (tool, v) => { try { const r = tool.run(v, {}); return Object.fromEntries([...(r.lines || []).map((l) => [l[0], `${l[1]}${l[3] ? ` (${l[3]})` : ''}`]), ...(r.tables || []).flatMap((t) => t.rows.map((row, i) => [`${t.title} row ${i + 1}`, row.join(' | ')]))]); } catch (e) { return { error: e.message }; } };
for (const tool of MORE_TOOLS) {
  const v = {};
  for (const [key, , kind, ph] of tool.inputs) { if (kind === 'select') v[key] = Array.isArray(ph) ? ph[0][0] : ph; else if (kind === 'bool') v[key] = false; else if (kind === 'list') v[key] = String(ph || '').split(',').map((x) => parse('money', x.trim())).filter((x) => typeof x === 'number'); else if (kind !== 'date') v[key] = parse(kind, ph); }
  const base = toolOut(tool, v);
  for (const [key, label, kind] of tool.inputs) {
    if (!['money', 'money2'].includes(kind) || typeof v[key] !== 'number') continue;
    changes.push({ where: `Tool: ${tool.title}`, input: `${label} = ${v[key]} + 0.00499`, diffs: diff(toolOut(tool, { ...v, [key]: v[key] + EPS }), base) });
  }
}
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(changes, null, 1));
const moved = changes.filter((c) => c.diffs.length);
console.log('inputs tested', changes.length, 'with a visible change', moved.length, '; displayed values compared', compared, '; values that changed', moved.reduce((n, c) => n + c.diffs.length, 0));
for (const c of moved) { console.log(`\n## ${c.where} — ${c.input}`); for (const d of c.diffs) console.log('  ', d); }
