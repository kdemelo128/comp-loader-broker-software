/* The dependency map (app/impact.js) against what the code really does.
 *
 *  1. Everything is registered: every figure analyze() returns, every key of
 *     the rent roll summary, the projection and a scenario, every field a
 *     template can take, every file and printout that carries deal data.
 *     A calculation added without being registered fails here.
 *  2. Strict reads: each registered formula and template field reads only
 *     what it declares (a guard throws on anything else).
 *  3. Behaviour agrees with the map: on 80 random deals, each input changed
 *     in turn, everything that moved is on the map's list for that input on
 *     that deal ("on this deal, now"), and each declared read is seen to
 *     matter in some case. The workbooks, brief and summary are checked the
 *     same way on fixture deals in impact-files.test.js.
 *  4. No orphans, no loops. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cases } from './analyze-cases.js';
import { richRentRoll, changesFor, tryChange } from './impact-cases.js';
import { FIGURES, RULES } from '../app/engine/figures.js';
import { registry } from '../app/engine/graph.js';
import {
  nodes, readersOf, traceAnalysis, findLoop, inputOfPath, affects, figId, checkId, DELIVERABLES, NOT_CALCULATED, FIELD_READS,
  RR_SUMMARY, PROJ_LINES, SCENARIO_PARTS, scenariosOf,
} from '../app/impact.js';
import { analyze, runScenario, compBasis } from '../app/deal.js';
import { rentRollSummary, project, projectionSummary } from '../app/lease.js';
import { DEAL_FIELDS } from '../app/dealfields.js';

const ALL = cases();
const N = nodes();

/* ------------------------------------------------- 1. everything is registered */

test('every figure analyze() returns is registered, on every case', () => {
  const known = new Set(['derived', 'checks', 'questions', ...FIGURES.list.map((F) => F.id)]);
  const unknown = new Set();
  for (const c of ALL) for (const k of Object.keys(analyze(c.d, c.comps || null))) if (!known.has(k)) unknown.add(k);
  assert.deepEqual([...unknown], [], `analyze() returns ${[...unknown].map((k) => `m.${k}`).join(', ')}, which the dependency map doesn't know. Register it in app/engine/figures.js.`);
  for (const F of FIGURES.list) assert.ok(N.has(figId(F.id)), `${F.id} is on the map`);
  for (const R of RULES.list) assert.ok(N.has(checkId(R.id)), `${R.id} is on the map`);
});

test('a calculation added to analyze() without registering it fails the check above', () => {
  // the same check, on analyze()'s result with one figure added the old way
  const m = analyze({ price: 5e6, noi: 3e5 });
  m.foo = 1;
  const known = new Set(['derived', 'checks', 'questions', ...FIGURES.list.map((F) => F.id)]);
  assert.deepEqual(Object.keys(m).filter((k) => !known.has(k)), ['foo']);
});

test('every key of the rent roll summary, the projection and a scenario is registered', () => {
  const rr = richRentRoll();
  assert.deepEqual(Object.keys(rentRollSummary(rr, rr.settings.asOf)).sort(), Object.keys(RR_SUMMARY).sort(), 'rentRollSummary() and RR_SUMMARY in app/impact.js');
  const P = project(rr);
  const lines = Object.keys(P.annual[0]).filter((k) => !['year', 'from', 'to'].includes(k)).sort();
  assert.deepEqual(lines, Object.keys(PROJ_LINES).filter((k) => k !== 'notes').sort(), 'a projected year’s lines and PROJ_LINES in app/impact.js');
  assert.deepEqual(Object.keys(projectionSummary(P)).filter((k) => !['asOf', 'from', 'annual', 'notes', 'totalSf', 'settings'].includes(k)), [], 'projectionSummary() returns something new');
  const d = { price: 6e6, noi: 4e5, loan: { ltv: 60, rate: 6.5, amort: 30 } };
  assert.deepEqual(Object.keys(runScenario(d, analyze(d), { exitCap: 7 })).filter((k) => !SCENARIO_PARTS.includes(k)), [], 'runScenario() returns something SCENARIO_PARTS in app/impact.js doesn’t list');
});

test('every field a firm template can take says what it reads', () => {
  for (const F of DEAL_FIELDS) {
    assert.ok(N.has(`field.${F.key}`), `${F.key} is on the map`);
    if (F.group !== 'Property and offering') assert.ok(F.key in FIELD_READS, `the template field “${F.key}” (${F.label}) is worked out, so FIELD_READS in app/impact.js must say what it reads`);
  }
  for (const k of Object.keys(FIELD_READS)) assert.ok(DEAL_FIELDS.some((F) => F.key === k), `FIELD_READS lists “${k}”, which isn't a template field any more`);
});

test('every file and printout the app hands over says which part of the map it carries', () => {
  const calls = [];
  for (const f of fs.readdirSync(new URL('../app/', import.meta.url))) {
    if (!f.endsWith('.js') || f === 'kit.js' || f === 'impact.js') continue;
    const src = fs.readFileSync(new URL(`../app/${f}`, import.meta.url), 'utf8');
    const re = /\b(deliver|printed)\(/g;
    let mm;
    while ((mm = re.exec(src))) {
      // the call's arguments, to its closing parenthesis
      let depth = 0; let i = mm.index + mm[0].length - 1;
      for (; i < src.length; i++) { if (src[i] === '(') depth++; else if (src[i] === ')' && --depth === 0) break; }
      const args = src.slice(mm.index, i + 1);
      const tag = /map: '([^']+)'/.exec(args);
      calls.push({ where: `${f}:${src.slice(0, mm.index).split('\n').length}`, map: tag ? tag[1] : null });
    }
  }
  assert.ok(calls.length >= 15, `found ${calls.length} calls`);
  const bad = calls.filter((c) => !c.map || !(c.map in DELIVERABLES || /^none: \S/.test(c.map)));
  assert.deepEqual(bad.map((c) => c.where), [], 'each deliver() or printed() call passes { map: … } naming an entry of DELIVERABLES in app/impact.js, or “none: why”');
  for (const k of Object.keys(DELIVERABLES)) if (k !== 'summary') assert.ok(calls.some((c) => c.map === k), `a deliverable “${k}” that nothing hands over`);
});

/* ---------------------------------------------------------- 2. strict reads */

function guarded(F, x, m) {
  const declared = new Set(F.reads.map((r) => r.path));
  const check = (p) => { if (!declared.has(p)) throw new Error(`“${F.id}” reads ${p}, which it doesn't declare. Add it to its reads in app/engine/figures.js.`); };
  const watch = (obj, prefix) => (obj && typeof obj === 'object' ? new Proxy(obj, { get(t, k) { if (typeof k === 'string') check(`${prefix}.${k}`); return t[k]; } }) : obj);
  const px = new Proxy(x, {
    get(t, k) {
      if (k === 'd') return watch(t.d, 'd');
      if (k === 'loan') return watch(t.loan, 'loan');
      if (k === 'comps') { if (![...declared].some((p) => p.startsWith('comps'))) check('comps'); return watch(t.comps, 'comps'); }
      if (k === 'today') check('today');
      return t[k];
    },
  });
  const pm = new Proxy(m, { get(t, k) { if (typeof k === 'string') check(k); return t[k]; } });
  return { px, pm };
}

test('each formula and rule reads only what it declares (618 deals and the rich rent roll)', () => {
  const rr = richRentRoll();
  const extra = [{ d: { price: 9e6, noi: 6e5, bsf: 32000, rentRoll: rentRollSummary(rr, rr.settings.asOf).rows.map((r) => ({ ...r, vacant: !r.occupied })), rentRollAsOf: rr.settings.asOf, loan: { ltv: 60, rate: 7, amort: 25 } } }];
  for (const c of [...ALL, ...extra]) {
    const m = { derived: {}, checks: [], questions: [] };
    const x = { d: c.d, loan: c.d.loan || {}, comps: c.comps || null, today: new Date() };
    for (const F of FIGURES.list) {
      if (F.only && !F.only(x)) continue;
      const { px, pm } = guarded(F, x, m);
      m[F.id] = F.calc(pm, px);
    }
    for (const R of RULES.list) { const { px, pm } = guarded(R, x, m); R.calc(pm, px, [], []); }
  }
});

test('each template field reads only what it declares', () => {
  const rr = richRentRoll();
  const d = { name: 'X', figures: { address: '1 Main', price: 9e6, noi: 6e5, bsf: 32000, cap: 6.5 }, loan: { ltv: 60, rate: 7, amort: 25 }, rr, sources: {}, live: { exitCap: 7 } };
  const m = analyze({ ...d.figures, loan: d.loan });
  const ctx = { deal: d, m, rrSum: rentRollSummary(rr, rr.settings.asOf), rrProj: project(rr), scenario: runScenario({ ...d.figures, loan: d.loan }, m, d.live), preparedBy: 'A', today: new Date() };
  for (const F of DEAL_FIELDS) {
    const seen = new Set();
    const w = (obj, f) => new Proxy(obj, { get(t, k) { if (typeof k === 'string') { const p = f(k); if (p) seen.add(p); } return t[k]; } });
    const pctx = {
      deal: w({ ...d, figures: w(d.figures, (k) => `figures.${k}`), loan: w(d.loan, (k) => `loan.${k}`) }, (k) => ({ sources: 'sources', name: 'name' }[k] || null)),
      m: w(m, (k) => figId(k)), rrSum: w(ctx.rrSum, (k) => `rr.${k}`), rrProj: w(ctx.rrProj, () => 'proj.noi'), scenario: w(ctx.scenario, () => 'scenario'),
      preparedBy: ctx.preparedBy, today: ctx.today,
    };
    F.get(pctx);
    const declared = new Set(N.get(`field.${F.key}`).reads.map((r) => r.path));
    // `derived` is read for this field's own flag: its part on the map, or none (the record only ever holds price and NOI: engine/figures.js)
    const extraReads = [...seen].filter((p) => !declared.has(p) && !(p === 'fig.derived' && (declared.has(`fig.derived.${F.key}`) || !['price', 'noi'].includes(F.key))));
    assert.deepEqual(extraReads, [], `the template field “${F.key}” reads ${extraReads.join(', ')}, which FIELD_READS in app/impact.js doesn't list`);
  }
});

/* --------------------------------------------- 3. behaviour agrees with the map */

/** A random case as a deal, the way the app holds one. */
function dealOf(c) {
  const { loan, rentRoll, ...figures } = c.d;
  delete figures.rentRollAsOf;
  return { name: 'Random', figures, loan: loan || {}, rentRoll: rentRoll || [], live: c.over || {}, scenarios: [{ id: 's1', name: 'Saved', over: { ltv: 50, exitCap: 8 } }], targets: {}, sources: {}, visit: { items: {} }, myQuestions: [], qDone: {} };
}
const BASIS = compBasis([{ price: 4e6, bsf: 8000, cap: 6.5 }, { price: 6e6, bsf: 10000, cap: 6.0 }, { price: 3e6, bsf: 6000 }]);
const seenMoving = new Map(); // engine node → set of inputs seen to move it

test('on 80 random deals, whatever an input moves is on the map’s list for it on that deal', async () => {
  const random = ALL.filter((c) => c.name.startsWith('random ')).filter((_, i) => i % 7 === 0).slice(0, 80);
  const missing = new Map();
  for (const c of random) {
    const deal = dealOf(c);
    for (const ch of changesFor(deal)) {
      if (['visit', 'questions', 'name', 'source', 'sources', 'unpriced', 'preparedBy'].includes(ch.input)) continue; // they reach files only: impact-files.test.js
      const r = await tryChange(deal, ch, { comps: c.comps || null, basis: BASIS });
      for (const k of r.missing) if (!missing.has(`${ch.input} → ${k}`)) missing.set(`${ch.input} → ${k}`, `${c.name}: ${ch.label}`);
      for (const k of r.moved) { if (!seenMoving.has(k)) seenMoving.set(k, new Set()); seenMoving.get(k).add(ch.input); }
    }
  }
  assert.deepEqual([...missing].map(([k, v]) => `changing ${k}, but the map doesn't say so (${v})`), []);
});

// the rich rent roll as it is (rents per SF), and with every rent quoted a year (so SF sets no rent)
const yearly = () => { const rr = richRentRoll(); for (const L of rr.leases) for (const p of L.periods) if (/^psf/.test(p.unit) && L.sf) { p.rate *= L.sf; p.unit = 'year'; } return rr; };
for (const [label, rrOf] of [['rents per SF', richRentRoll], ['rents a year', yearly]]) test(`the rich rent roll (${label}): every lease field and Assumption moves only what the map lists`, async () => {
  const deal = { name: 'Rich', figures: { price: 9e6, noi: 6e5, bsf: 32000, occ: 92, gross: 950000, opex: 310000 }, loan: { ltv: 65, rate: 6.75, amort: 30, closing: 2, minDscr: 1.25, minDy: 8 }, rr: rrOf(), live: { noiBasis: 'rentroll' }, scenarios: [], targets: {} };
  const missing = [];
  for (const ch of changesFor(deal, { leases: 7 })) {
    if (!/^(lease|leases|rr\.)/.test(ch.input)) continue;
    const r = await tryChange(deal, ch, {});
    for (const k of r.missing) missing.push(`changing ${ch.label} moved ${k}, but the map doesn't say so`);
    for (const k of r.moved) { if (!seenMoving.has(k)) seenMoving.set(k, new Set()); seenMoving.get(k).add(ch.input); }
  }
  assert.deepEqual([...new Set(missing)], []);
});

test('each formula’s declared reads are each read on some deal, and each input it reads is seen to move it', () => {
  const traced = new Map();
  const rr = richRentRoll();
  const more = [{ d: { price: 9e6, noi: 6e5, bsf: 32000, rentRoll: [{ sf: 1000, annual: 50000, end: '2030-01-01T00:00:00.000Z' }], rentRollAsOf: rr.settings.asOf } }];
  for (const c of [...ALL, ...more]) for (const [id, s] of traceAnalysis(c.d, c.comps || null).reads) { if (!traced.has(id)) traced.set(id, new Set()); for (const p of s) traced.get(id).add(p); }
  const unread = [];
  const unmoved = [];
  for (const F of [...FIGURES.list.map((x) => [figId(x.id), x]), ...RULES.list.map((x) => [checkId(x.id), x])]) {
    const [id] = F;
    for (const R of N.get(id).reads) {
      if (!(traced.get(id) || new Set()).has(R.path)) unread.push(`${id} declares ${R.path} but never reads it`);
      const isInput = N.get(R.path).group === 'input';
      // inputs a random deal can't change (the rent roll's own fields) are moved in the rich rent roll test
      if (isInput && !(seenMoving.get(id) || new Set()).has(R.path) && !['conventions'].includes(R.path)) unmoved.push(`${id} reads ${R.path}, but changing it never moved ${id}`);
    }
  }
  assert.deepEqual(unread, []);
  assert.deepEqual(unmoved, []);
});

/* -------------------------------------------------- 4. no orphans, no loops */

test('every input is read by something, or listed as used by nothing', () => {
  const orphans = [...N.values()].filter((n) => n.group === 'input' && !readersOf(n.id).length && !(n.id in NOT_CALCULATED)).map((n) => n.id);
  assert.deepEqual(orphans, [], 'inputs nothing reads: register what reads them, or list them in NOT_CALCULATED in app/impact.js');
  const stale = Object.keys(NOT_CALCULATED).filter((id) => !N.has(id) || readersOf(id).length);
  assert.deepEqual(stale, [], 'NOT_CALCULATED lists inputs that something reads, or that no longer exist');
});

test('a loop is refused, and named', () => {
  const loop = new Map([['a', { reads: [{ path: 'b' }] }], ['b', { reads: [{ path: 'c' }] }], ['c', { reads: [{ path: 'a' }] }], ['d', { reads: [] }]]);
  assert.deepEqual(findLoop(loop), ['a', 'b', 'c', 'a']);
  assert.equal(findLoop(N), null, 'the map itself has none');
  const r = registry('Test');
  r.add('x', { reads: ['d.price'] }, () => 1);
  assert.throws(() => r.add('y', { reads: ['z'] }, () => 1), /“y” reads “z”, which isn’t registered before it/);
  assert.throws(() => r.add('x', { reads: [] }, () => 1), /registered twice/);
});

test('a recorded change is traced to the input it is to', () => {
  assert.deepEqual(inputOfPath(['figures', 'noi']), { input: 'figures.noi' });
  assert.deepEqual(inputOfPath(['rr', 'leases', { id: 'l7' }, 'periods', 0, 'rate']), { input: 'lease.rent', lease: 'l7' });
  assert.deepEqual(inputOfPath(['rr', 'leases', { id: 'l7' }, 'vacant']), { input: 'lease.status', lease: 'l7' });
  assert.deepEqual(inputOfPath(['rr', 'leases', { id: 'l7' }]), { input: 'leases' });
  assert.deepEqual(inputOfPath(['rr', 'settings', 'renewal', 'probability']), { input: 'rr.settings.renewal' });
  assert.deepEqual(inputOfPath(['live', 'exitCap']), { input: 'live.exitCap' });
  assert.equal(inputOfPath(['stage']), null);
});

test('the cap rate on the retail fixture: what moves now, and what only could', () => {
  const deal = { figures: { price: 6450000, noi: 393450, cap: 6.1, bsf: 12000 }, loan: { ltv: 65, rate: 6.75, amort: 30 }, live: {}, scenarios: [{ id: 's1', name: 'Downside', over: { rate: 8 } }] };
  const a = affects(['figures.cap'], { deal });
  assert.ok(!a.now.includes('fig.price') && !a.now.includes('fig.cap'), 'with a price and an NOI, the stated cap rate moves neither the price nor the cap rate');
  assert.ok(a.now.includes('check.statedCap') && a.now.includes('xlsx.deal.B7') && a.now.includes('field.cap'));
  assert.equal(a.could.find((x) => x.id === 'fig.price').why, 'only when no price is entered');
  const b = affects(['loan.rate'], { deal });
  assert.deepEqual(b.scenarios.map((s) => s.name), ['What-if'], 'Downside sets its own rate, so it isn’t affected');
  assert.ok(scenariosOf(deal).length === 2);
});
