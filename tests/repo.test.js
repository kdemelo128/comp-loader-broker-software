/* Checks on the site as GitHub Pages will serve it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const list = (dir) => fs.readdirSync(path.join(ROOT, dir)).map((f) => `${dir}/${f}`);

test('the service worker caches every file the app needs, and only files that exist', () => {
  const sw = read('sw.js');
  const assets = [...sw.slice(sw.indexOf('const ASSETS'), sw.indexOf('];')).matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const shipped = ['index.html', 'manifest.webmanifest',
    ...list('app'), ...list('vendor'), ...list('fonts'), ...list('icons')].filter((f) => !f.endsWith('.md'));
  for (const f of shipped) assert.ok(assets.includes(f), `sw.js does not cache ${f}`);
  for (const a of assets.filter((x) => x !== './')) assert.ok(exists(a), `sw.js caches ${a}, which does not exist`);
});

test('every file the page and manifest point at exists', () => {
  const html = read('index.html');
  for (const m of html.matchAll(/(?:src|href)="([^"#:]+)"/g)) {
    assert.ok(exists(m[1]), `index.html references missing ${m[1]}`);
  }
  for (const m of html.matchAll(/url\("(?!data:)([^"]+)"\)/g)) assert.ok(exists(m[1]), `index.html font ${m[1]} is missing`);
  const man = JSON.parse(read('manifest.webmanifest'));
  for (const icon of man.icons) assert.ok(exists(icon.src), `manifest icon ${icon.src} is missing`);
  assert.equal(man.display, 'standalone');
  assert.ok(man.icons.some((i) => i.purpose === 'maskable'));
});

test('every module the app imports exists, with the same capitalization', () => {
  for (const f of list('app')) {
    const src = read(f);
    for (const m of src.matchAll(/(?:from|import\()\s*'(\.\.?\/[^']+)'/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1]));
      // GitHub Pages is case-sensitive even when the machine you built on is not
      const dir = path.posix.dirname(target);
      assert.ok(fs.readdirSync(path.join(ROOT, dir)).includes(path.posix.basename(target)), `${f} imports missing ${m[1]}`);
    }
  }
});

test('no text file carries raw control characters (some hosts refuse them)', () => {
  const files = ['index.html', 'sw.js', 'manifest.webmanifest', ...list('app'), ...list('vendor')];
  for (const f of files) {
    const buf = fs.readFileSync(path.join(ROOT, f));
    // tab, newline and carriage return are fine
    const bad = buf.findIndex((b) => (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) || b === 0x7f);
    assert.equal(bad, -1, `${f} has a control byte at offset ${bad}`);
  }
});

test('the page makes no request to another site', () => {
  const html = read('index.html');
  const external = [...html.matchAll(/(?:src|href)="(https?:[^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(external, []);
  for (const f of list('app')) {
    const src = read(f);
    for (const m of src.matchAll(/fetch\(\s*['"`](https?:[^'"`]+)/g)) assert.fail(`${f} fetches ${m[1]}`);
  }
});
