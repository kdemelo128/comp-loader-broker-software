/* The dependency map against the files a deal produces: the deal workbook
 * (every Deal Analysis row and section, the rent roll tabs), the rent roll
 * workbook, the deal brief (section by section) and Copy summary. Two
 * fixture deals, with a rent roll of every kind of lease and with only the
 * OM's table, each input changed in turn (about 280 changes): whatever moves
 * in a file must be on the map's list for that input on that deal. And every
 * sheet, row, section and heading the files contain is registered. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readOm } from '../app/om.js';
import { retail } from './om-fixtures.js';
import { compBasis, analyze } from '../app/deal.js';
import { fixtureDeals, changesFor, tryChange, workbookParts, briefSections, fakeDocument } from './impact-cases.js';
import { nodes, analysisInput, figId, DEAL_SHEET_ROWS, BRIEF_SECTIONS, DEAL_SHEET_SECTIONS } from '../app/impact.js';
import ExcelJS from 'exceljs';
import * as fflate from 'fflate';

const om = readOm(retail);
const figures = Object.fromEntries(Object.entries(om.fields).map(([k, v]) => [k === 'lot' ? 'lot_sf' : k, v.value]));
const DEALS = fixtureDeals(figures, om.rentRoll.rows);
const BASIS = compBasis([{ price: 4e6, bsf: 8000, cap: 6.5 }, { price: 6e6, bsf: 10000, cap: 6.0 }, { price: 3e6, bsf: 6000 }]);
const N = nodes();

test('every sheet, row, section and heading in the files is registered', async () => {
  for (const { label, deal } of DEALS) {
    const m = analyze(analysisInput(deal), BASIS);
    const extra = { questions: m.questions, visitLines: ['Observed, roof: needs attention'], scenarioLines: ['Downside (…)'] };
    const parts = await workbookParts(deal, m, BASIS, extra);
    const odd = [...parts.keys()].filter((k) => !N.has(k) && !/^xlsx\.deal\.row(4|17|26|27|41|42)$/.test(k));
    assert.deepEqual(odd, [], `${label}: parts of the workbooks the map doesn't know (a new sheet, a Deal Analysis row outside DEAL_SHEET_ROWS, or a section heading DEAL_SHEET_HEADINGS doesn't match)`);
    for (const r of Object.keys(DEAL_SHEET_ROWS)) assert.ok(parts.has(`xlsx.deal.B${r}`), `${label}: Deal Analysis row ${r} is registered but not in the workbook`);
    for (const k of Object.keys(DEAL_SHEET_SECTIONS)) if (!['visit', 'title'].includes(k) || k === 'title') assert.ok(parts.has(`xlsx.deal.${k}`) || k === 'visit', `${label}: the section “${k}” wasn't found`);
    const brief = await briefSections({ ...deal, visitLines: extra.visitLines }, m, BASIS, extra, 'A. Broker');
    const unknown = [...brief.keys()].filter((k) => !N.has(k));
    assert.deepEqual(unknown, [], `${label}: a brief heading BRIEF_HEADINGS in app/impact.js doesn't know`);
    for (const k of Object.keys(BRIEF_SECTIONS)) if (k !== 'visit') assert.ok(brief.has(`brief.${k}`), `${label}: the brief has no “${k}” section`);
  }
});

for (const { label, deal } of DEALS) {
  test(`${label}: whatever an input moves in the workbooks, the brief or the summary is on the map’s list for it`, async () => {
    const missing = new Map();
    let n = 0;
    for (const ch of changesFor(deal, { leases: 2 })) {
      const r = await tryChange(deal, ch, { comps: null, basis: BASIS, files: true });
      n += 1;
      for (const k of r.missing) if (!missing.has(`${ch.input} → ${k}`)) missing.set(`${ch.input} → ${k}`, ch.label);
    }
    assert.ok(n > 80, `${n} changes tried`);
    assert.deepEqual([...missing].map(([k, v]) => `changing ${k}, but the map doesn't say so (${v})`), []);
  });
}

test('with sale comps: the comps sections of the files follow the map too', async () => {
  const { deal } = DEALS[1];
  const missing = [];
  for (const ch of changesFor(deal).filter((c) => /^(figures\.(price|noi|bsf|cap)|comps|loan\.rate)$/.test(c.input))) {
    const r = await tryChange(deal, ch, { comps: BASIS, basis: BASIS, files: true });
    for (const k of r.missing) missing.push(`changing ${ch.label} moved ${k}, but the map doesn't say so`);
  }
  assert.deepEqual(missing, []);
});

/* ------------------------------------------- the files read only what they declare */

const DEAL_KEYS = { name: 'name', source: 'source', readAt: 'source', example: 'example', unpriced: 'unpriced', sources: 'sources', rentRoll: 'rentRoll', activeQuestions: 'questions', questions: 'questions', visitLines: 'visit', scenarioLines: 'scenario' };
/** Run `fn` on proxies of the deal, the analysis and the comps, and give back the map paths it read. */
function readsOf(deal, m, comps, fn) {
  const seen = new Set();
  const w = (obj, f) => (obj && typeof obj === 'object' ? new Proxy(obj, { get(t, k) { if (typeof k === 'string') { const p = f(k); if (p) seen.add(p); } return t[k]; } }) : obj);
  const pd = w({ ...deal, figures: w(deal.figures, (k) => `figures.${k}`), loan: w(deal.loan || {}, (k) => `loan.${k}`) }, (k) => DEAL_KEYS[k] || null);
  // the checks and questions lists are every rule's output together
  const pm = w(m, (k) => (k === 'checks' || k === 'questions' ? 'check.*' : figId(k)));
  const pc = comps ? w(comps, () => 'comps') : comps;
  fn(pd, pm, pc);
  return seen;
}
const declared = (ids) => new Set(ids.flatMap((id) => N.get(id).reads.map((r) => r.path)));
const undeclared = (seen, ids) => { const d = declared(ids); return [...seen].filter((p) => !d.has(p) && !(p === 'check.*' && [...d].some((x) => x.startsWith('check.'))) && !(p === 'fig.derived' && [...d].some((x) => x.startsWith('fig.derived.')))); };

test('the brief, the summary and the Deal Analysis sheet read only what they declare', async () => {
  const { renderDealBrief, dealSummaryText } = await import('../app/brief.js');
  const { buildDealWorkbook } = await import('../app/workbook.js');
  for (const { label, deal } of DEALS) {
    const d = { ...deal, example: false, unpriced: false, activeQuestions: ['Q?'], visitLines: ['V'], scenarioLines: ['S'], questions: ['Q?'] };
    const m = analyze(analysisInput(d), BASIS);
    const briefIds = Object.keys(BRIEF_SECTIONS).map((k) => `brief.${k}`);
    const b = readsOf(d, m, BASIS, (pd, pm, pc) => { const doc = fakeDocument(); renderDealBrief(doc.createElement('div'), { deal: pd, m: pm, comps: pc, preparedBy: 'A' }); });
    assert.deepEqual(undeclared(b, briefIds), [], `${label}: the brief reads these, which no section of it in BRIEF_SECTIONS declares`);
    const s = readsOf(d, m, BASIS, (pd, pm, pc) => dealSummaryText(pd, pm, pc));
    assert.deepEqual(undeclared(s, ['summary']), [], `${label}: Copy summary reads these, which its reads in app/impact.js don't list`);
    const sheetIds = [...N.keys()].filter((k) => k.startsWith('xlsx.deal.'));
    const wd = { ...d, rr: null, figures: { ...d.figures, rentRoll: d.rentRoll } };
    let pending = null;
    const x = readsOf(wd, m, BASIS, (pd, pm, pc) => { pending = buildDealWorkbook(ExcelJS, fflate, { deal: pd, metrics: pm, comps: pc }); });
    await pending;
    assert.deepEqual(undeclared(x, sheetIds).filter((p) => p !== 'figures.rentRoll'), [], `${label}: the Deal Analysis sheet reads these, which DEAL_SHEET_ROWS and DEAL_SHEET_SECTIONS don't declare`);
  }
});
