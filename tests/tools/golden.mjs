/* tests/tools/golden.mjs -- not a test: every displayed figure for a set of
 * cases chosen to exercise each definition in checkpoint (b), as the app
 * formats it. Run it against two versions of app/ and diff the output to get
 * the before/after list of every figure that changed:
 *
 *   node tests/tools/golden.mjs <app-dir> > out.json
 *   node tests/tools/golden.mjs --diff before.json after.json
 *
 * It only calls functions that exist in both versions; where a new function
 * exists (the cents rounding), the "after" side applies it the way the app's
 * migration does. Needs tests/e2e/files/pages.json (made by tests/e2e/run.sh). */
import fs from 'node:fs';

if (process.argv[2] === '--diff') {
  const a = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const b = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  const rows = keys.filter((k) => a[k] !== b[k]);
  console.log(`| Case and figure | Before | After |\n|---|---|---|`);
  for (const k of rows) console.log(`| ${k.replace(/\|/g, '\\|')} | ${String(a[k] ?? '(none)').replace(/\|/g, '\\|')} | ${String(b[k] ?? '(none)').replace(/\|/g, '\\|')} |`);
  console.error(`${keys.length} figures compared, ${rows.length} changed`);
  process.exit(0);
}

globalThis.window = {}; globalThis.document = { addEventListener() {}, dispatchEvent() {} };
const A = new URL(`file://${fs.realpathSync(process.argv[2] || new URL('../../app/', import.meta.url).pathname)}/`);
const imp = (m) => import(new URL(m, A).href);
const { readOm } = await imp('om.js');
const D = await imp('deal.js');
const { dealValues } = await imp('dealfields.js');
const L = await imp('lease.js');
const K = await imp('kit.js');
const { MORE_TOOLS } = await imp('toolsdefs.js');
const T = await imp('tools.js');
const C = await imp('calc.js');
const S = await imp('stats.js');
const money = await imp('engine/money.js').catch(() => null);
const ExcelJS = (await import('exceljs')).default;
const fflate = await import('fflate');
const W = await imp('workbook.js');
const pages = JSON.parse(fs.readFileSync(new URL('../e2e/files/pages.json', import.meta.url), 'utf8'));
const { money0, money2, pct, times, dec, int, yrs } = K;

const TODAY = new Date('2026-10-10T12:00:00Z');
const AS_OF = '2026-10-10';
const LOAN = { ltv: 65, rate: 6.75, amort: 30, io: false, closing: 2, minDscr: 1.25, minDy: 8 };
const out = {};
const put = (k, v) => { out[k] = v === undefined ? '(undefined)' : v; };
const fmtT = (type, v) => (typeof v !== 'number' ? String(v ?? '') : type === 'money' ? money0(v) : type === 'money2' ? money2(v) : type === 'pct' ? `${dec(v, 2)}%` : type === 'dec' ? dec(v, 2) : type === 'int' ? int(v) : String(v));
const cell = (ws, a) => {
  let v = ws.getCell(a).value;
  if (v && typeof v === 'object' && !(v instanceof Date)) v = 'result' in v ? v.result : ('formula' in v ? '' : JSON.stringify(v));
  if (v && typeof v === 'object' && v.error) v = v.error;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return typeof v === 'number' ? String(Math.round(v * 1e4) / 1e4) : (v ?? '');
};
const formula = (ws, a) => { const v = ws.getCell(a).value; return v && typeof v === 'object' && v.formula ? `=${v.formula}` : ''; };

/** A deal as the app would hold it after migration (money rounded), when this version rounds. */
const migrated = (deal) => (money && money.quantizeDeal ? money.quantizeDeal(structuredClone(deal)).deal : deal);

async function dealCase(name, deal) {
  deal = migrated(deal);
  const f = { ...deal.figures, rentRoll: deal.rentRoll, loan: deal.loan, rentRollAsOf: deal.rr && deal.rr.settings ? deal.rr.settings.asOf : null };
  const m = D.analyze(f, null, TODAY);
  const rrSum = deal.rr ? L.rentRollSummary(deal.rr, deal.rr.settings.asOf) : null;
  const rrProj = deal.rr ? L.project(deal.rr, { asOf: deal.rr.settings.asOf, years: 10 }) : null;
  for (const [, x] of Object.entries(dealValues({ deal, m, rrSum, rrProj }))) if (typeof x.value === 'number') put(`${name} · ${x.label}`, fmtT(x.type, x.value));
  put(`${name} · Overview: price`, money0(m.price));
  put(`${name} · Overview tile: WALT`, m.leases && typeof m.leases.waltIncome === 'number' ? yrs(m.leases.waltIncome) : '—');
  put(`${name} · Overview: WALT by SF`, m.leases && typeof m.leases.waltSf === 'number' ? yrs(m.leases.waltSf) : '—');
  put(`${name} · Overview: break-even`, pct(m.breakEven, 1));
  put(`${name} · Overview: largest loan it supports`, money0(m.maxLoan && m.maxLoan.loan));
  put(`${name} · Overview: cash flow after debt`, money0(m.cashFlow));
  for (const c of m.checks || []) put(`${name} · What doesn't add up: ${String(c.text || c).slice(0, 40)}…`, String(c.text || c));
  for (const r of m.ladder || []) put(`${name} · Value across cap rates ${pct(r.cap)}`, `${money0(r.value)} · ${money2(r.psf)}`);
  const run = D.runScenario(f, m, {});
  const rows = [['Price', (r) => money0(r.inputs.price)], ['NOI, year 1', (r) => money0(r.m.noi)], ['Cap rate', (r) => pct(r.m.capCalc)], ['Price / SF', (r) => money2(r.m.ppsf)],
    ['Loan', (r) => money0(r.m.loan)], ['DSCR', (r) => times(r.m.dscr)], ['Debt yield', (r) => pct(r.m.debtYield)], ['Cash-on-cash', (r) => pct(r.m.cashOnCash)], ['Equity', (r) => money0(r.m.equity)],
    ['Exit value', (r) => money0(r.returns && r.returns.exitValue)], ['Levered IRR', (r) => pct(r.returns && r.returns.leveredIrr)], ['Equity multiple', (r) => dec(r.returns && r.returns.leveredMultiple, 2)], ['Unlevered IRR', (r) => pct(r.returns && r.returns.unleveredIrr)]];
  for (const [l, fn] of rows) put(`${name} · What if: ${l}`, fn(run));
  const a = D.scenarioAnswers(f, m, {}, { targetCap: 6.25, targetIrr: 15, capForValue: 6.35 });
  put(`${name} · What if: price for a 15% IRR`, money0(a.priceForIrr));
  if (rrSum) {
    put(`${name} · Rent roll: in-place rent`, money0(rrSum.annualRent));
    put(`${name} · Rent roll: WALT`, yrs(rrSum.waltIncome));
    put(`${name} · Rent roll: WALT by SF`, yrs(rrSum.waltSf));
    put(`${name} · Rent roll: loss to lease`, money0(rrSum.lossToLease));
    for (const r of rrSum.rows) put(`${name} · Rent roll ${r.unit}: annual / per SF`, `${money0(r.annual)} · ${money2(r.psf)}`);
  }
  if (rrProj) rrProj.annual.forEach((y, i) => put(`${name} · Projection year ${i + 1}: EGI / NOI`, `${money0(y.egi)} · ${money0(y.noi)}`));
  // the deal workbook, as exported
  const wdeal = { name: deal.name, figures: { ...deal.figures, rentRoll: deal.rentRoll }, loan: deal.loan, sources: {}, rr: deal.rr, questions: [], visitLines: [], scenarioLines: [] };
  const bytes = await W.buildDealWorkbook(ExcelJS, fflate, { deal: wdeal, metrics: m, comps: null });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  const da = wb.getWorksheet('Deal Analysis');
  if (da) for (const r of [33, 34, 35, 37, 39, 40, 46, 48]) put(`${name} · Deal workbook ${da.getCell(`A${r}`).value}`, `${cell(da, `B${r}`) ?? ''} ${formula(da, `B${r}`)}`);
  const rt = wb.getWorksheet('Rent Roll');
  if (rt) {
    put(`${name} · Deal workbook Rent Roll: as of`, String(cell(rt, 'B3')));
    rt.eachRow((row) => { const lab = String(row.getCell(1).value || ''); if (/^WALT/.test(lab)) put(`${name} · Deal workbook Rent Roll: ${lab}`, `${cell(rt, `C${row.number}`)} ${formula(rt, `C${row.number}`)}`); });
  }
}

/* --------------------------------------------------------- the deal cases */
for (const nm of ['om_retail', 'om_netlease', 'om_multifamily']) {
  const om = readOm(pages[nm]);
  const figures = {};
  for (const [k, x] of Object.entries(om.fields)) figures[k === 'lot' ? 'lot_sf' : k] = x.value;
  const rows = om.rentRoll ? om.rentRoll.rows.map((r) => ({ ...r, start: r.start ? new Date(r.start).toISOString() : null, end: r.end ? new Date(r.end).toISOString() : null })) : [];
  const rr = rows.length ? L.fromOmRows(rows, { asOf: AS_OF, buildingSf: figures.bsf || null }) : null;
  if (rr) rr.settings.opex = figures.opex ?? null;
  await dealCase(nm, { name: nm, figures, rentRoll: rows, rr, loan: { ...LOAN } });
}
{ // WALT: a month-to-month tenant, and a rent roll as of 2026-06-30 viewed on 2026-10-10
  const rr = {
    settings: { ...L.DEFAULT_SETTINGS, asOf: '2026-06-30', opex: 60000, buildingSf: 5300 },
    leases: [
      { id: 'a', unit: '1', tenant: 'A', sf: 2000, leaseStart: '2021-07-01', leaseEnd: '2031-06-30', periods: [{ start: '2021-07-01', end: '2031-06-30', rate: 100000, unit: 'year' }], abatements: [], custom: {} },
      { id: 'b', unit: '2', tenant: 'B', sf: 1000, mtm: true, leaseStart: '2020-01-01', leaseEnd: null, periods: [{ start: '2020-01-01', end: '2026-07-31', rate: 50000, unit: 'year' }], abatements: [], custom: {} },
      { id: 'c', unit: '3', tenant: 'C', sf: 1500, leaseStart: '2023-07-01', leaseEnd: '2028-06-30', periods: [{ start: '2023-07-01', end: '2028-06-30', rate: 60000, unit: 'year' }], abatements: [], custom: {} },
      { id: 'd', unit: '4', tenant: '', sf: 800, vacant: true, periods: [], abatements: [], custom: {} },
    ],
  };
  const rows = [
    { suite: '1', tenant: 'A', sf: 2000, annual: 100000, end: '2031-06-30T00:00:00.000Z', mtm: false },
    { suite: '2', tenant: 'B', sf: 1000, annual: 50000, end: null, mtm: true },
    { suite: '3', tenant: 'C', sf: 1500, annual: 60000, end: '2028-06-30T00:00:00.000Z', mtm: false },
    { suite: '4', tenant: 'Vacant', sf: 800, annual: null, end: null, vacant: true },
  ];
  await dealCase('WALT case', { name: 'WALT case', figures: { price: 3000000, noi: 150000, bsf: 5300 }, rentRoll: rows, rr, loan: { ...LOAN } });
}
{ // an amortization that isn't a whole number of months
  const om = readOm(pages.om_retail);
  const figures = {};
  for (const [k, x] of Object.entries(om.fields)) figures[k === 'lot' ? 'lot_sf' : k] = x.value;
  await dealCase('27.4-year amortization', { name: 'amort', figures, rentRoll: [], rr: null, loan: { ...LOAN, amort: 27.4 } });
}
await dealCase('Negative NOI', { name: 'neg', figures: { noi: -50000, cap: 6, bsf: 10000 }, rentRoll: [], rr: null, loan: { ...LOAN } });
{ // values with parts of a cent, as written back from tools and What if, or typed to many decimals
  const om = readOm(pages.om_retail);
  const figures = {};
  for (const [k, x] of Object.entries(om.fields)) figures[k === 'lot' ? 'lot_sf' : k] = x.value;
  figures.price = 5573615.873421; // What if: "price for a 15% IRR", saved to the deal
  figures.noi = 393449.996312; // a NOI bridge result written back
  const rows = om.rentRoll.rows.map((r) => ({ ...r, start: r.start ? new Date(r.start).toISOString() : null, end: r.end ? new Date(r.end).toISOString() : null }));
  const rr = L.fromOmRows(rows, { asOf: AS_OF, buildingSf: figures.bsf });
  rr.settings.opex = 135750.004999;
  rr.settings.marketRent = 41.267839; rr.settings.marketUnit = 'psf_year';
  rr.leases.forEach((x) => x.periods.forEach((p) => { if (x.sf) { p.unit = 'psf_year'; p.rate = p.rate / x.sf; } })); // $37.846153846… a year per SF
  await dealCase('Sub-cent values', { name: 'subcent', figures, rentRoll: rows.map((r) => ({ ...r, psf: r.annual && r.sf ? r.annual / r.sf : null })), rr, loan: { ...LOAN } });
}

/* --------------------------------------------------------------- tools */
const parse = (s) => { if (s === undefined || s === null || s === '') return null; const t = String(s).toLowerCase().replace(/[$,%\s]/g, ''); const x = /^(-?\d*\.?\d+)(k|m|mm|b)?$/.exec(t); return x ? Number(x[1]) * ({ k: 1e3, m: 1e6, mm: 1e6, b: 1e9 }[x[2]] || 1) : null; };
const src = fs.readFileSync(new URL('toolsui.js', A), 'utf8');
const arr = `${src.slice(src.indexOf('const TOOLS = [') + 'const TOOLS = '.length, src.indexOf('  ...MORE_TOOLS,\n];'))}]`;
const scope = { ...T, money0, money2, pct, signed: K.signed, times, yrs, niceDate: K.niceDate, int, dec, ok: (x) => typeof x === 'number' && Number.isFinite(x) };
const BUILTIN = new Function(...Object.keys(scope), `return ${arr}`)(...Object.values(scope));
const runTool = (tool, v) => { try { const r = tool.run(v, {}); const lines = Array.isArray(r) ? r : (r.lines || []); return [...lines.map((l) => [l[0], `${l[1]}${l[3] ? ` (${l[3]})` : ''}`]), ...((r && r.tables) || []).flatMap((t) => t.rows.map((row, i) => [`${t.title} row ${i + 1}`, row.join(' · ')])), ...((r && r.warnings) || []).map((w, i) => [`warning ${i + 1}`, w])]; } catch (e) { return [['error', e.message]]; } };
const example = (tool) => { const v = {}; for (const [key, , kind, ph] of tool.inputs) { if (kind === 'select') v[key] = Array.isArray(ph) ? ph[0][0] : ph; else if (kind === 'bool') v[key] = false; else if (kind === 'list') v[key] = String(ph || '').split(',').map((x) => parse(x.trim())).filter((x) => typeof x === 'number'); else if (kind !== 'date') v[key] = parse(ph); } return v; };
for (const tool of [...BUILTIN, ...MORE_TOOLS]) {
  if (tool.rows) continue;
  for (const [k, v] of runTool(tool, example(tool))) put(`Tool ${tool.title} (example) · ${k}`, v);
}
const byId = Object.fromEntries([...BUILTIN, ...MORE_TOOLS].map((t) => [t.id, t]));
const extra = [
  ['breakeven', 'no GPR, EGI and occupancy', { gpr: null, gross: 529200, occ: 91.7, opex: 135750, debtService: 326310 }],
  ['breakeven', 'GPR', { gpr: 588000, opex: 135750, debtService: 326310 }],
  ['value', 'negative NOI', { price: null, noi: -50000, cap: 6 }],
  ['ner', 'no commission', { rent: 75, sf: 1000, months: 120, esc: 3, free: 3, ti: 25, lc: null, discount: 8 }],
  ['ner', 'with commission', { rent: 75, sf: 1000, months: 120, esc: 3, free: 3, ti: 25, lc: 6, discount: 8 }],
];
for (const [id, label, v] of extra) if (byId[id]) for (const [k, x] of runTool(byId[id], v)) put(`Tool ${byId[id].title} (${label}) · ${k}`, x);
{ // the WALT tool, typed rows, measured from today
  const w = T.waltTool([{ tenant: 'A', sf: 2000, annual: 100000, end: '2031-06-30' }, { tenant: 'C', sf: 1500, annual: 60000, end: '2028-06-30' }], TODAY);
  put('Tool WALT (two leases) · WALT by income, to 4 decimals', String(Math.round(w.waltIncome * 1e4) / 1e4));
  put('Tool WALT (two leases) · WALT by income, as shown', yrs(w.waltIncome));
}
put('Tool Loan sizing · result fields', Object.keys(T.loanTool({ price: 6450000, noi: 393450, ltv: 65, rate: 6.75, amort: 30, minDscr: 1.25, minDy: 8 }) || {}).sort().join(', '));

/* --------------------------------------------------------------- comps */
const { loadComps } = await imp('costar.js');
const set = loadComps([{ name: 'costar.pdf', pages: pages.costar_set }]);
const sales = set.sales;
const withZero = [...sales, { ...sales[0], id: 'zero', address: 'Typed comp, $0 price', price: 0, bsf: 5000 }];
for (const [nm, cs] of [['CoStar set', sales], ['CoStar set + a $0-price comp', withZero]]) {
  const b = D.compBasis(cs);
  put(`Comps ${nm} · weighted $/SF (deal)`, money2(b.weighted));
  put(`Comps ${nm} · median $/SF (deal)`, money2(b.median));
  put(`Comps ${nm} · weighted $/SF (workbook, stats)`, money2(S.weightedPpsf(cs.map((c) => c.price), cs.map((c) => c.bsf))));
  const chk = C.compSetCheck(cs, { today: TODAY });
  put(`Comps ${nm} · comp set check: median age`, chk.medianAgeMonths !== null ? `${Math.round(chk.medianAgeMonths)} months` : '—');
  put(`Comps ${nm} · comp set check: SF-weighted`, money2(chk.weighted));
  const bytes = await W.buildWorkbook(ExcelJS, fflate, { sales: cs, market: set.market, subject: {}, label: nm, sources: [] });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  const sc = wb.getWorksheet('Sale Comps');
  sc.eachRow((row) => { const any = [...Array(22)].some((_, j) => { const x = row.getCell(j + 1).value; return x && typeof x === 'object' && x.formula && /SUMPRODUCT/.test(x.formula); }); for (let c = 1; c <= 22; c++) { const v = row.getCell(c).value; if (any && v && typeof v === 'object' && v.formula) put(`Comps ${nm} · comp workbook Sale Comps ${row.getCell(c).address}`, `${typeof v.result === 'number' ? money2(v.result) : (v.result ?? '')} =${v.formula}`); } });
  const lc = wb.getWorksheet('Lease Comps');
  put(`Comps ${nm} · comp workbook Lease Comps example NER (P4)`, `${money2(Number(cell(lc, 'P4')))} ${formula(lc, 'P4')}`);
}
process.stdout.write(JSON.stringify(out, null, 1));
