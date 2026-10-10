/* The type checker over app/ (types/tsconfig.json): every unit in its place.
 * Dev only: tsc reads the JSDoc and types/zlatura.d.ts; nothing is built, and
 * the browser loads app/ exactly as it is. tests/types/mistakes.js holds
 * unit mix-ups that must each be a type error; one that stops being caught
 * is reported as an unused @ts-expect-error, and this test fails. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;

test('app/ type-checks, with units, and every deliberate mix-up is refused', () => {
  const r = spawnSync(process.execPath, [`${root}node_modules/typescript/bin/tsc`, '-p', `${root}types/tsconfig.json`], { encoding: 'utf8' });
  const errors = `${r.stdout}${r.stderr}`.split('\n').filter((l) => /error TS\d+/.test(l));
  assert.deepEqual(errors, [], `${errors.length} type error${errors.length === 1 ? '' : 's'} (an "Unused '@ts-expect-error'" one is a mix-up in tests/types/mistakes.js no longer caught)`);
  assert.equal(r.status, 0);
});

test('the mix-ups file still holds its mix-ups', () => {
  const src = fs.readFileSync(`${root}tests/types/mistakes.js`, 'utf8');
  assert.ok((src.match(/\/\/ @ts-expect-error /g) || []).length >= 24, 'at least 24 deliberate mix-ups');
});

test('nothing the checker needs is deployed with the app', () => {
  // the app's own files carry comments only; the types live outside app/, and the offline cache lists none of them
  const sw = fs.readFileSync(`${root}sw.js`, 'utf8');
  assert.ok(!/types\/|\.d\.ts|tsconfig/.test(sw), 'the service worker caches no type files');
  for (const f of fs.readdirSync(`${root}app`, { recursive: true })) assert.ok(!/\.d\.ts$|^tsconfig/.test(String(f)), `${f} is in app/`);
});
