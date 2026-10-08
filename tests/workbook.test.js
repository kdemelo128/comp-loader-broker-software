/* The workbook is checked the way Excel checks a file before it offers to
 * "repair" it: every part declared, every relationship resolving, every r:id
 * defined, no directory entries, one selected tab. The cached values are
 * checked against the arithmetic they stand for. (CI does not have Excel or
 * LibreOffice; the full recalculation check runs in tools/verify.sh.) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import * as fflate from 'fflate';
import { buildWorkbook, byPpsf } from '../app/workbook.js';
import { loadComps } from '../app/costar.js';
import { zoningLookup } from '../app/zoning.js';
import { sampleSet } from '../app/sample.js';
import * as F from './fixtures.js';

const dec = new TextDecoder();

function resolve(owner, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = owner.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

/** The checks Excel runs on a package before it will open it cleanly. */
function packageProblems(bytes) {
  const files = fflate.unzipSync(bytes);
  const names = Object.keys(files);
  const probs = [];
  const ct = dec.decode(files['[Content_Types].xml']);
  const overrides = new Set([...ct.matchAll(/PartName="([^"]+)"/g)].map((m) => m[1]));
  const defaults = new Set([...ct.matchAll(/Extension="([^"]+)"/g)].map((m) => m[1].toLowerCase()));
  for (const n of names) {
    if (n.endsWith('/')) probs.push(`directory entry ${n}`);
    else if (n !== '[Content_Types].xml' && !overrides.has(`/${n}`) && !defaults.has(n.split('.').pop().toLowerCase())) {
      probs.push(`undeclared part ${n}`);
    }
  }
  for (const o of overrides) if (!names.includes(o.slice(1))) probs.push(`content type for missing part ${o}`);
  for (const n of names.filter((x) => x.endsWith('.rels'))) {
    const owner = n === '_rels/.rels' ? '' : `${n.split('/').slice(0, -2).join('/')}/${n.split('/').pop().slice(0, -5)}`;
    for (const m of dec.decode(files[n]).matchAll(/<Relationship\b[^>]*>/g)) {
      const target = /Target="([^"]+)"/.exec(m[0])[1];
      if (/TargetMode="External"/.test(m[0])) continue;
      if (!names.includes(resolve(owner, target))) probs.push(`broken relationship ${n} -> ${target}`);
    }
  }
  for (const n of names.filter((x) => x.endsWith('.xml') && !x.includes('_rels'))) {
    const xml = dec.decode(files[n]);
    const used = new Set([...xml.matchAll(/\br:(?:id|embed)="([^"]+)"/g)].map((m) => m[1]));
    if (!used.size) continue;
    const relPath = `${n.split('/').slice(0, -1).join('/')}/_rels/${n.split('/').pop()}.rels`;
    const declared = new Set(files[relPath] ? [...dec.decode(files[relPath]).matchAll(/Id="([^"]+)"/g)].map((m) => m[1]) : []);
    for (const id of used) if (!declared.has(id)) probs.push(`dangling ${id} in ${n}`);
  }
  const selected = names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n) && /tabSelected="1"/.test(dec.decode(files[n])));
  if (selected.length !== 1) probs.push(`${selected.length} selected tabs`);
  return { probs, files };
}

const subject = {
  address: '1 Subject Way', city: 'Washington', state: 'DC', ptype: 'Retail',
  bsf: 9000, lotSf: 4800, zoning: 'mu-4', year: 1925, noi: 520000, price: 8700000,
};

async function build(sales, market, extra = {}) {
  const bytes = await buildWorkbook(ExcelJS, fflate, { sales, market, subject, label: 'Test', sources: ['test.pdf'], ...extra });
  return bytes;
}

function fixtureSet() {
  const pages = [F.classicSale, F.activeListing, F.statusListing, F.flyerEscrow, F.landValue, F.partialSale,
    F.continuedPage1, F.continuedPage2];
  return loadComps([{ name: 'fixtures.pdf', pages }], { zoningCodes: zoningLookup });
}

test('workbook from the fixture comps passes the package checks', async () => {
  const { sales, market } = fixtureSet();
  const { probs, files } = packageProblems(await build(sales, market, { preparedBy: 'Example Brokerage' }));
  assert.deepEqual(probs, []);
  const wb = dec.decode(files['xl/workbook.xml']);
  // ExcelJS writes sheetId before name, so match the attribute wherever it sits
  const tabs = [...wb.matchAll(/<sheet\b[^>]*\bname="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(tabs, ['Summary', 'Charts', 'Sale Comps', 'On Market Comps', 'Adjustment Grid',
    'Lease Comps', 'Zoning Catalogue', 'Audit Trail', 'CoStar Notes']);
});

test('charts are attached to the Charts tab and read live ranges', async () => {
  const { sales, market } = fixtureSet();
  const { files } = packageProblems(await build(sales, market));
  const charts = Object.keys(files).filter((n) => /^xl\/charts\/chart\d+\.xml$/.test(n));
  assert.equal(charts.length, 3);                  // sales bars, sales scatter, listing bars
  const bar = dec.decode(files['xl/charts/chart1.xml']);
  assert.match(bar, /<c:f>'Sale Comps'!\$M\$4:\$M\$\d+<\/c:f>/);
  assert.match(bar, /<c:orientation val="maxMin"\/>/);
  const scatter = dec.decode(files['xl/charts/chart2.xml']);
  assert.match(scatter, /<c:trendlineType val="linear"\/>/);
});

test('an empty comp set still builds a clean workbook', async () => {
  const { probs } = packageProblems(await build([], []));
  assert.deepEqual(probs, []);
});

test('more than fifteen comps: the grids grow and every formula range follows', async () => {
  const pages = Array.from({ length: 22 }, (_, i) => F.saleWith(i + 1, { price: 1000000 + i * 50000, sf: 2000, date: `2/${i + 1}/2025` }));
  const { sales } = loadComps([{ name: 'many.pdf', pages }], { zoningCodes: zoningLookup, cap: false });
  assert.equal(sales.length, 22);
  const { probs, files } = packageProblems(await build(sales, []));
  assert.deepEqual(probs, []);
  const all = Object.entries(files).filter(([n]) => n.startsWith('xl/worksheets/sheet')).map(([, b]) => dec.decode(b)).join('');
  // sheet XML escapes the quotes around a sheet name as &apos;
  assert.match(all, /&apos;Sale Comps&apos;!\$M\$4:\$M\$25/);
  assert.doesNotMatch(all, /&apos;Sale Comps&apos;!\$M\$4:\$M\$18\b/);
});

test('the grids are written high to low $/SF whatever order the comps arrive in', async () => {
  const { sales } = fixtureSet();
  const shuffled = [...sales].reverse();
  const wbBytes = await build(shuffled, []);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(wbBytes);
  const ws = wb.getWorksheet('Sale Comps');
  const vals = [];
  for (let r = 4; r < 4 + sales.length; r++) {
    const v = ws.getCell(`M${r}`).value;
    vals.push(v && typeof v === 'object' ? v.result : v);
  }
  const nums = vals.filter((x) => typeof x === 'number');
  assert.deepEqual(nums, [...nums].sort((a, b) => b - a));
  assert.equal(typeof byPpsf, 'function');
});

test('cached values equal the arithmetic they stand for', async () => {
  const { sales, market } = fixtureSet();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await build(sales, market));
  const ws = wb.getWorksheet('Sale Comps');
  for (let r = 4; r < 4 + sales.length; r++) {
    const price = ws.getCell(`K${r}`).value;
    const sf = ws.getCell(`L${r}`).value;
    const m = ws.getCell(`M${r}`).value;
    if (typeof price === 'number' && typeof sf === 'number') {
      assert.ok(Math.abs(m.result - price / sf) < 1e-9, `row ${r}`);
      assert.match(m.formula, new RegExp(`K${r}.*L${r}`));
    }
  }
  // the subject's lowercase zoning is found, as Excel's MATCH finds it
  const sum = wb.getWorksheet('Summary');
  assert.equal(sum.getCell('E5').value.result, 3);
  assert.equal(sum.getCell('E6').value.result, 4800 * 3);
  // a Montgomery County code joins the catalogue with its FAR
  const z = wb.getWorksheet('Zoning Catalogue');
  let found = false;
  z.eachRow((row) => { if (row.getCell(1).value === 'CR-3.0 C-2.0 R-2.75 H-145') found = row.getCell(2).value === 3; });
  assert.ok(found);
});

test('the example set builds, and every comp says it is invented', async () => {
  const { sales, market } = sampleSet(zoningLookup);
  assert.ok(sales.length >= 5 && market.length >= 3);
  for (const c of [...sales, ...market]) assert.ok(c.flags.some((f) => /EXAMPLE DATA/.test(f)));
  const { probs } = packageProblems(await build(sales, market));
  assert.deepEqual(probs, []);
});

/* The market-conditions adjustment must not come from a regression that
 * explains nothing: across a mixed comp set the slope measures the mix of
 * properties, and applying it once pushed older Baltimore sales up 341%. */
async function adjustmentRate(pages) {
  const { sales } = loadComps([{ name: 'trend.pdf', pages }], { zoningCodes: zoningLookup, cap: false });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await build(sales, []));
  const ws = wb.getWorksheet('Adjustment Grid');
  return { rate: ws.getCell('C5').value, why: String(ws.getCell('E5').value) };
}

test('market conditions: a clean, plausible trend is used', async () => {
  // six sales over three years, $/SF rising a steady 4% a year
  const pages = [0, 0.5, 1, 1.5, 2, 3].map((yrs, i) => {
    const d = new Date(Date.UTC(2022, 0, 15) + yrs * 365.25 * 86400000);
    const date = `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
    return F.saleWith(i + 1, { price: Math.round(2000 * 500 * 1.04 ** yrs), sf: 2000, date });
  });
  const { rate, why } = await adjustmentRate(pages);
  assert.ok(rate > 0.03 && rate < 0.05, `rate ${rate}`);
  assert.match(why, /R² (0\.9\d|1\.00)/);
});

test('market conditions: a regression that explains little starts at zero', async () => {
  // $/SF jumps between very different properties with no relation to date
  const ppsf = [500, 40, 450, 60, 520, 35];
  const pages = ppsf.map((p, i) => F.saleWith(i + 1, { price: p * 2000, sf: 2000, date: `${i + 1}/15/202${2 + (i % 3)}` }));
  const { rate, why } = await adjustmentRate(pages);
  assert.equal(rate, 0);
  assert.match(why, /explains too little/);
});

test('market conditions: too few sales starts at zero', async () => {
  const pages = [F.saleWith(1, { price: 1e6, sf: 2000, date: '1/1/2023' }), F.saleWith(2, { price: 1.2e6, sf: 2000, date: '1/1/2025' })];
  const { rate, why } = await adjustmentRate(pages);
  assert.equal(rate, 0);
  assert.match(why, /too few/);
});
