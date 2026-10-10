/* tests/tools/t12-local.mjs -- not a test: read real T-12s kept in private/
 * (git-ignored; never committed) the way the app reads them, and print only
 * their structure: how many lines, how many each matching step placed, how
 * many wait for review, which checks were raised (by kind) and the months.
 * No amount, label, property or tenant name is printed, so the output can be
 * shared. Every real file stays on this machine.
 *
 *   node tests/tools/t12-local.mjs                # every .xlsx and .csv in private/
 *   node tests/tools/t12-local.mjs private/a.xlsx  # one */
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { gridsOf, csvRows } from '../../app/sheetread.js';
import { bestSheet, openLines, statementChecks, CATEGORY } from '../../app/t12.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const dir = path.join(ROOT, 'private');
const files = process.argv.slice(2).length ? process.argv.slice(2) : (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.(xlsx|csv)$/i.test(f)).map((f) => path.join(dir, f)) : []);
if (!files.length) { console.log('No files: put real T-12s (.xlsx or .csv) in private/ (git-ignored) or name them.'); process.exit(0); }

let n = 0;
for (const f of files) {
  n += 1;
  const tag = `file ${n}`; // the file's name may name the property: it isn't printed
  try {
    let grids;
    if (/\.csv$/i.test(f)) grids = [{ sheet: 'CSV', rows: csvRows(fs.readFileSync(f, 'utf8')).map((cells, i) => ({ r: i + 1, cells })).filter((x) => x.cells.some((v) => String(v).trim())) }];
    else { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(fs.readFileSync(f)); grids = gridsOf(wb, { maxRows: 1500 }); }
    const t = bestSheet(grids, {});
    const by = (how) => t.lines.filter((l) => l.how === how).length;
    const sides = {};
    for (const l of t.lines) if (l.category) { const s = CATEGORY[l.category].side; sides[s] = (sides[s] || 0) + 1; }
    const checks = statementChecks(t).map((c) => c.kind);
    console.log(`${tag}: ${grids.length} sheet(s); ${t.months.length} month column(s); ${t.lines.length} lines: ${by('rule')} placed by wording, ${openLines(t).length} for review; by side ${JSON.stringify(sides)}; subtotals ${t.subtotals.length}; stated ${Object.keys(t.stated).join(', ') || 'none'}; expenses written negative: ${t.signs.expensesNegative}; checks: ${checks.join(', ') || 'none'}`);
    // why lines went to review, as kinds only (no label)
    const why = {};
    for (const l of openLines(t)) { const k = /management fee/.test(l.why) ? 'bare management fee' : /no category/.test(l.why) ? 'no rule' : /but it sits under/.test(l.why) ? 'section disagrees' : 'two categories'; why[k] = (why[k] || 0) + 1; }
    if (Object.keys(why).length) console.log(`  review reasons: ${JSON.stringify(why)}`);
  } catch (e) {
    console.log(`${tag}: not read (${String(e.message).replace(/“[^”]*”/g, '“…”')})`);
  }
}
