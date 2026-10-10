/* Each figure's unit (engine/figures.js) agrees with the places that show it:
 * the type a firm template field writes it as, the Deal Analysis cell's
 * number format and value (a percent written as a fraction, with a percent
 * format), and how the brief shows it. Today these agree by convention; this
 * holds them to the registered unit. */
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import * as fflate from 'fflate';
import { FIGURES } from '../app/engine/figures.js';
import { DEAL_FIELDS } from '../app/dealfields.js';
import { FIELD_READS, DEAL_SHEET_ROWS } from '../app/impact.js';
import { analyze, compBasis } from '../app/deal.js';
import { readOm } from '../app/om.js';
import { retail } from './om-fixtures.js';
import { fakeDocument } from './impact-cases.js';

const KIND = { '$': 'money', '$/yr': 'money', '$/unit': 'money', '$/SF': 'money2', '$/SF/yr': 'money2', '$/land SF': 'money2', '%': 'pct', '% change': 'pct', x: 'dec', years: 'dec' };
const unitOf = (id) => (FIGURES.byId.get(id) || {}).unit;

test('every registered unit is one the app knows how to show', () => {
  const known = new Set([...Object.keys(KIND), 'record', 'table', 'text', 'flag']);
  for (const F of FIGURES.list) assert.ok(known.has(F.unit), `${F.id}: unit “${F.unit}”`);
});

test('a template field writes each figure as its unit says', () => {
  let n = 0;
  for (const F of DEAL_FIELDS) {
    const figs = (FIELD_READS[F.key] || []).filter((p) => /^fig\.[a-zA-Z]+$/.test(p)).map((p) => p.slice(4));
    for (const id of figs) {
      const want = KIND[unitOf(id)];
      if (!want) continue;
      n += 1;
      assert.equal(F.type, want, `the template field “${F.key}” writes ${id} (${unitOf(id)}) as ${F.type}`);
    }
  }
  assert.ok(n >= 11, `${n} fields checked`);
});

const om = readOm(retail);
const figures = Object.fromEntries(Object.entries(om.fields).map(([k, v]) => [k === 'lot' ? 'lot_sf' : k, v.value]));
const deal = { name: 'Retail', figures: { ...figures, rentRoll: om.rentRoll.rows }, loan: { ltv: 65, rate: 6.75, amort: 30, io: false, closing: 2, minDscr: 1.25, minDy: 8 }, sources: {}, questions: [], visitLines: [], scenarioLines: [] };
const comps = compBasis([{ price: 4e6, bsf: 8000, cap: 6.5 }, { price: 6e6, bsf: 10000, cap: 6.0 }, { price: 3e6, bsf: 6000 }]);
const m = analyze({ ...figures, rentRoll: om.rentRoll.rows, loan: deal.loan }, comps);

test('each Deal Analysis row writes its figure as its unit says: format and value', async () => {
  globalThis.window ||= {}; globalThis.document ||= { addEventListener() {}, dispatchEvent() {} };
  const { buildDealWorkbook } = await import('../app/workbook.js');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildDealWorkbook(ExcelJS, fflate, { deal, metrics: m, comps }));
  const ws = wb.getWorksheet('Deal Analysis');
  let n = 0;
  for (const [row, [, reads]] of Object.entries(DEAL_SHEET_ROWS)) {
    const figs = reads.filter((p) => /^fig\.[a-zA-Z]+$/.test(p)).map((p) => p.slice(4)).filter((id) => KIND[unitOf(id)]);
    if (figs.length !== 1) continue;
    const id = figs[0]; const u = unitOf(id);
    const c = ws.getCell(`B${row}`);
    const v = c.value && typeof c.value === 'object' ? c.value.result : c.value;
    const fmt = String(c.numFmt || '');
    n += 1;
    if (KIND[u] === 'pct') {
      assert.match(fmt, /%/, `B${row} (${id}, ${u}) has a percent format`);
      if (typeof m[id] === 'number') assert.ok(Math.abs(v - m[id] / 100) < 1e-9, `B${row} holds ${id} as a fraction: ${v} for ${m[id]}%`);
    } else if (KIND[u] === 'money' || KIND[u] === 'money2') {
      assert.match(fmt, /\$/, `B${row} (${id}, ${u}) has a dollar format`);
      assert.doesNotMatch(fmt, /%/, `B${row} (${id}) isn't a percent`);
      if (typeof m[id] === 'number') assert.ok(Math.abs(v - m[id]) < 1e-6, `B${row} holds ${id} in dollars`);
    } else if (u === 'x') {
      assert.match(fmt, /x/, `B${row} (${id}) is shown as a multiple`);
    }
  }
  assert.ok(n >= 15, `${n} rows checked`);
});

test('the brief shows each figure as its unit says', async () => {
  const { renderDealBrief } = await import('../app/brief.js');
  const K = await import('../app/kit.js');
  const doc = fakeDocument();
  const box = doc.createElement('div');
  renderDealBrief(box, { deal: { ...deal, figures }, m, comps, preparedBy: 'A' });
  const text = box.textContent;
  const shown = (id) => {
    const v = m[id]; const u = unitOf(id);
    if (KIND[u] === 'money') return [K.money0(v)];
    if (KIND[u] === 'money2') return [K.money2(v)];
    if (KIND[u] === 'pct') return [K.pct(v, 0), K.pct(v, 1), K.pct(v), K.signed(v)];
    if (u === 'x') return [K.times(v)];
    return [];
  };
  let n = 0;
  for (const id of ['price', 'noi', 'ppsf', 'noiPsf', 'expenseRatio', 'loan', 'debtService', 'dscr', 'debtYield', 'cashFlow', 'equity', 'cashOnCash', 'breakEven', 'vsWeighted', 'valueAtWeighted']) {
    if (typeof m[id] !== 'number') continue;
    n += 1;
    assert.ok(shown(id).some((s) => text.includes(s)), `the brief shows ${id} (${unitOf(id)}) as one of ${shown(id).join(' / ')}`);
  }
  assert.ok(n >= 12, `${n} figures checked`);
});
