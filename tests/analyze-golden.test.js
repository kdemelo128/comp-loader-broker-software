/* The analysis gives exactly what 4.3.1 gave, on every case in
 * analyze-cases.js: every figure, check, question and scenario result, to the
 * last digit, with the same keys in the same order. tests/fixtures/
 * analyze-golden.json was written by 4.3.1, before analyze() was split into
 * registered formulas (engine/figures.js). A change here is a change to a
 * number someone sees: regenerate the file only for a change that was meant. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cases, record, kept } from './analyze-cases.js';

const golden = JSON.parse(fs.readFileSync(new URL('./fixtures/analyze-golden.json', import.meta.url), 'utf8'));

test('analyze() gives exactly the saved results on every case', () => {
  const all = cases();
  assert.equal(all.length, Object.keys(golden).length, 'the same cases as the saved file');
  const differ = [];
  for (const c of all) {
    const text = record(c);
    if (kept(c, text) !== golden[c.name]) differ.push(`${c.name}: ${golden[c.name].startsWith('sha256:') ? text.slice(0, 400) : firstDifference(golden[c.name], text)}`);
  }
  assert.deepEqual(differ, [], `${differ.length} of ${all.length} cases differ`);
});

function firstDifference(a, b) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `saved …${a.slice(Math.max(0, i - 60), i + 60)}… now …${b.slice(Math.max(0, i - 60), i + 60)}…`;
}
