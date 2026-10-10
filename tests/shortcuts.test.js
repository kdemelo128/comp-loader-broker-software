/* The keyboard shortcut list (app/shortcuts.js) against the code: every key a
 * keydown handler in app/ answers to is listed for that file, and every key
 * listed is still handled there. A shortcut added without a line on the "?"
 * sheet fails here. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { SHORTCUTS, sheetGroups, keyLabel } from '../app/shortcuts.js';

const APP = new URL('../app/', import.meta.url).pathname;
const files = fs.readdirSync(APP).filter((f) => f.endsWith('.js'));

/** The keys a file's keydown handlers compare against, read from its source. */
function handledKeys(src) {
  const keys = new Set();
  if (!/addEventListener\('keydown'/.test(src)) return keys;
  // e.key === 'Enter', e.key.toLowerCase() === 'k'
  for (const m of src.matchAll(/\be\.key(?:\.toLowerCase\(\))?\s*[!=]==\s*'([^']+)'/g)) keys.add(m[1]);
  // ['ArrowLeft', 'ArrowRight'].includes(e.key)
  for (const m of src.matchAll(/\[((?:'[^']+',\s*)*'[^']+')\]\.includes\(e\.key\)/g)) for (const k of m[1].matchAll(/'([^']+)'/g)) keys.add(k[1]);
  // a key read into a variable first: const k = (e.key || '').toLowerCase(); ... k === 'z'
  for (const m of src.matchAll(/const (\w+) = \(e\.key \|\| ''\)\.toLowerCase\(\);([\s\S]*?)\n}\n/g)) {
    for (const k of m[2].matchAll(new RegExp(`\\b${m[1]}\\s*[!=]==\\s*'([^']+)'`, 'g'))) keys.add(k[1]);
  }
  return keys;
}

test('the scan finds the keys it should (so the next test means something)', () => {
  const dealui = handledKeys(fs.readFileSync(APP + 'dealui.js', 'utf8'));
  for (const k of ['z', 'y', 'Enter', ' ', 'ArrowLeft', 'ArrowRight']) assert.ok(dealui.has(k), `dealui.js: ${JSON.stringify(k)}`);
  const cmd = handledKeys(fs.readFileSync(APP + 'command.js', 'utf8'));
  for (const k of ['k', '/', 'ArrowUp', 'ArrowDown', 'Enter']) assert.ok(cmd.has(k), `command.js: ${k}`);
  assert.deepEqual([...handledKeys(fs.readFileSync(APP + 'theme.js', 'utf8'))].sort(), ['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp']);
});

test('every key a handler answers to is on the list, for that file', () => {
  const missing = [];
  for (const f of files) {
    for (const k of handledKeys(fs.readFileSync(APP + f, 'utf8'))) {
      if (!SHORTCUTS.some((s) => s.src.includes(f) && s.listen.includes(k))) missing.push(`${f}: ${JSON.stringify(k)}`);
    }
  }
  assert.deepEqual(missing, [], 'add these to SHORTCUTS in app/shortcuts.js, so the "?" sheet lists them');
});

test('every key on the list is still handled where it says', () => {
  const stale = [];
  for (const s of SHORTCUTS) {
    for (const f of s.src) {
      assert.ok(files.includes(f), `${s.does}: no file ${f}`);
      const got = handledKeys(fs.readFileSync(APP + f, 'utf8'));
      for (const k of s.listen) if (!got.has(k)) stale.push(`${s.does} (${f}: ${JSON.stringify(k)})`);
    }
  }
  assert.deepEqual(stale, []);
});

test('the sheet: by where each works, with ⌘ on a Mac and Ctrl elsewhere', () => {
  const pc = sheetGroups(false);
  const mac = sheetGroups(true);
  assert.deepEqual(pc.map((g) => g.group), ['Anywhere', 'In the search', 'In a deal', 'In the rent roll', 'Settings']);
  const row = (gs, does) => gs.flatMap((g) => g.rows).find((r) => r.does === does);
  assert.deepEqual(row(pc, 'Undo the last change to the deal').keys, [['Ctrl', 'Z']]);
  assert.deepEqual(row(mac, 'Undo the last change to the deal').keys, [['⌘', 'Z']]);
  assert.deepEqual(row(pc, 'Redo it').keys, [['Shift', 'Ctrl', 'Z'], ['Ctrl', 'Y']]);
  assert.deepEqual(row(mac, 'Redo it').keys, [['⇧', '⌘', 'Z']], 'a Mac has no Ctrl Y redo');
  assert.deepEqual(row(pc, 'Show these shortcuts').keys, [['?']]);
  assert.equal(keyLabel('Mod', true), '⌘');
  assert.equal(keyLabel('Mod', false), 'Ctrl');
  // every row says what it does, and has a key
  for (const g of pc) for (const r of g.rows) assert.ok(r.does && r.keys.length && r.keys.every((w) => w.length), g.group);
});
