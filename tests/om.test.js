import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readOm, parseMoney, parsePct, parseArea, parseDate, splitCells } from '../app/om.js';
import { retail, netlease, multifamily } from './om-fixtures.js';

const val = (om, k) => om.fields[k] && om.fields[k].value;

test('values read the way OMs print them', () => {
  assert.equal(parseMoney('$4,950,000'), 4950000);
  assert.equal(parseMoney('$4.95M'), 4950000);
  assert.equal(parseMoney('$6.45 million'), 6450000);
  assert.equal(parseMoney('(43,776)'), -43776);
  assert.equal(parseMoney('2019'), null, 'a bare year is not money');
  assert.equal(parsePct('6.10%'), 6.1);
  assert.equal(parsePct('6.10', true), 6.1);
  assert.equal(parseArea('1.45 AC').sf, 1.45 * 43560);
  assert.equal(parseArea('12,000 SF').sf, 12000);
  assert.equal(parseDate('02/28/2029').date.toISOString().slice(0, 10), '2029-02-28');
  assert.equal(parseDate('Dec-29').date.toISOString().slice(0, 10), '2029-12-31');
  assert.equal(parseDate('6/30').date.toISOString().slice(0, 10), '2030-06-30');
  assert.ok(parseDate('MTM').mtm);
  assert.deepEqual(splitCells('  Cap Rate     6.10%').map((c) => c.text), ['Cap Rate', '6.10%']);
});

test('label-and-value summary, highlights and operating statement', () => {
  const om = readOm(retail);
  assert.equal(val(om, 'price'), 6450000);
  assert.equal(val(om, 'cap'), 6.1);
  assert.equal(val(om, 'noi'), 393450);
  assert.equal(val(om, 'bsf'), 12000);
  assert.equal(Math.round(val(om, 'lot')), Math.round(0.21 * 43560), 'acres become SF');
  assert.equal(val(om, 'year'), 1948);
  assert.equal(val(om, 'occ'), 91.7);
  assert.equal(val(om, 'zoning'), 'MU-4');
  assert.equal(val(om, 'gross'), 529200, 'the Current column, not Pro Forma');
  assert.equal(val(om, 'opex'), 135750);
  assert.equal(val(om, 'taxes'), 78450);
  assert.equal(val(om, 'address'), '4410 Example Avenue NW');
  assert.equal(val(om, 'city'), 'Washington');
  assert.equal(val(om, 'state'), 'DC');
  assert.equal(om.fields.price.confidence, 'high', 'printed on two pages, in a summary');
  assert.equal(om.fields.price.page, 2);
  assert.ok(!om.fields.tenant, 'a word in a table header is not a tenant');
  assert.ok(!('gross' in om.fields && om.fields.gross.value === 185400), 'demographic income is not gross income');
});

test('a two-line rent roll header, vacancies and totals', () => {
  const rr = readOm(retail).rentRoll;
  assert.equal(rr.page, 5);
  assert.equal(rr.rows.length, 5, 'four leases and a vacancy; the Total line ends the table');
  const coffee = rr.rows[0];
  assert.equal(coffee.tenant, 'Corner Coffee Co.');
  assert.equal(coffee.sf, 2400);
  assert.equal(coffee.annual, 124800);
  assert.equal(coffee.psf, 52);
  assert.equal(coffee.end.toISOString().slice(0, 10), '2029-02-28');
  assert.ok(rr.rows[2].vacant);
  assert.equal(rr.rows[2].sf, 1000);
});

test('single-tenant net lease terms', () => {
  const om = readOm(netlease);
  assert.equal(val(om, 'price'), 3280000);
  assert.equal(val(om, 'cap'), 5.25, 'the exit cap rate in the footnote is not the going-in cap');
  assert.equal(val(om, 'noi'), 172200);
  assert.equal(val(om, 'tenant'), 'Northstar Pharmacy, Inc.');
  assert.equal(val(om, 'lease_type'), 'Absolute NNN');
  assert.equal(val(om, 'term_left'), '9.3 Years');
  assert.equal(val(om, 'increases'), '10% every 5 years');
  assert.equal(Math.round(val(om, 'lot')), Math.round(1.45 * 43560));
  assert.equal(val(om, 'city'), 'Rockville');
});

test('prose and an Actual / Pro Forma statement', () => {
  const om = readOm(multifamily);
  assert.equal(val(om, 'price'), 12500000, '"offered at $12,500,000"');
  assert.equal(val(om, 'cap'), 5.75, '"a 5.75% cap rate"');
  assert.equal(val(om, 'units'), 48);
  assert.equal(val(om, 'bsf'), 41600, '"totaling 41,600 square feet"');
  assert.equal(val(om, 'occ'), 96, '"96% occupied"');
  assert.equal(val(om, 'noi'), 718750, 'the Actual column');
  assert.equal(val(om, 'year'), 1964);
  assert.equal(val(om, 'ptype'), 'Multifamily');
});

test('an OM with no price says so', () => {
  const om = readOm(['Offering Memorandum\n\n  Pricing      Call for Offers\n  Building Size    10,000 SF']);
  assert.equal(om.fields.price, undefined);
  assert.ok(om.unpriced);
  assert.equal(val(om, 'bsf'), 10000);
});
