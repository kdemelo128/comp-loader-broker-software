/* Deterministic checks on figures read from documents: quote verification,
 * grouping readings that agree, and the rent roll against the OM. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFigure, numbersIn, normalizeValue, sameValue, verifyQuote, reconcile, crossChecks, squash } from '../app/reconcile.js';

test('parsing figures as printed', () => {
  assert.equal(parseFigure('$6,450,000'), 6450000);
  assert.equal(parseFigure('$6.45M'), 6450000);
  assert.equal(parseFigure('6.45 million'), 6450000);
  assert.equal(parseFigure('(12,500)'), -12500);
  assert.equal(parseFigure('10,000 SF'), 10000);
  assert.equal(parseFigure('n/a'), null);
  assert.deepEqual(numbersIn('Asking Price $6,450,000 at a 6.10% cap on 12,000 SF'), [6450000, 6.1, 12000]);
  assert.equal(normalizeValue('pct', '6.10%'), 6.1);
  assert.equal(normalizeValue('pct', '0.061'), 6.1, 'a fraction is a rate');
  assert.equal(normalizeValue('year', '1987'), 1987);
  assert.equal(normalizeValue('year', '87'), null);
  assert.equal(normalizeValue('text', '  Acme Corp '), 'Acme Corp');
});

test('tolerances', () => {
  assert.ok(sameValue('money', 6450000, 6460000), 'within 0.5%');
  assert.ok(!sameValue('money', 6450000, 6500000));
  assert.ok(sameValue('pct', 6.1, 6.12));
  assert.ok(!sameValue('pct', 6.1, 6.2));
  assert.ok(sameValue('text', 'Acme  Corp', 'acme corp'));
});

test('verifying a quoted passage against the page text', () => {
  const pages = ['Cover page. Retail centre.', 'Investment Summary\nAsking Price   $6,450,000\nCap Rate 6.10%', 'NOI $393,450'];
  assert.equal(verifyQuote(pages, 2, 'Asking Price $6,450,000', 6450000, 'money').status, 'verified', 'spacing differences are ignored');
  const other = verifyQuote(pages, 1, 'Asking Price $6,450,000', 6450000, 'money');
  assert.equal(other.status, 'other-page');
  assert.equal(other.page, 2);
  assert.equal(verifyQuote(pages, 2, 'Asking Price $6,450,000', 6500000, 'money').status, 'value-not-in-quote');
  assert.equal(verifyQuote(pages, 2, 'Asking Price $6,950,000', 6950000, 'money').status, 'not-found', 'an invented passage is caught');
  assert.equal(verifyQuote(pages, 2, 'Cap Rate 6.10%', 6.1, 'pct').status, 'verified');
  assert.equal(verifyQuote('Tenant: Acme Corp, lease to 2031', null, 'Tenant: Acme Corp', 'Acme Corp', 'text').status, 'verified');
  assert.equal(squash('“Net”  Rent – Total'), '"net"rent-total');
});

test('reconcile groups agreeing readings and never picks', () => {
  const r = reconcile([
    { key: 'noi', value: 393450, source: { label: 'OM p.2' } },
    { key: 'noi', value: 393000, source: { label: 'T-12' } },
    { key: 'noi', value: 412000, source: { label: 'Rent roll' } },
    { key: 'price', value: 6450000, source: { label: 'OM p.1' } },
    { key: 'cap', value: 6.1, source: { label: 'OM' } }, { key: 'cap', value: 6.1, source: { label: 'AI' } },
  ], { noi: 'money', price: 'money', cap: 'pct' });
  const noi = r.find((x) => x.key === 'noi');
  assert.equal(noi.status, 'conflict');
  assert.equal(noi.groups.length, 2);
  assert.equal(noi.groups[0].readings.length, 2, '393,450 and 393,000 agree within 0.5%');
  assert.ok(Math.abs(noi.spreadPct - ((412000 - 393450) / 393450) * 100) < 1e-9);
  assert.equal(r.find((x) => x.key === 'price').status, 'single');
  assert.equal(r.find((x) => x.key === 'cap').status, 'agree');
});

test('rent roll against the OM', () => {
  const rr = { units: 5, totalSf: 11000, occupancy: 91.7, annualRent: 468000 };
  const issues = crossChecks({ occ: 100, bsf: 12000, gpr: 450000, units: 5 }, rr);
  assert.deepEqual(issues.map((i) => i.id).sort(), ['gpr', 'occ', 'sf']);
  assert.deepEqual(crossChecks({ occ: 92, bsf: 11000, gpr: 520000 }, rr), [], 'consistent figures raise nothing');
  assert.deepEqual(crossChecks({}, null), []);
});
