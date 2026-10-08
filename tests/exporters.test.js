import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compsCsv, fullAddress } from '../app/exporters.js';
import { loadComps } from '../app/costar.js';
import { zoningLookup } from '../app/zoning.js';
import * as F from './fixtures.js';

/** A minimal RFC 4180 reader, to check the writer against. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(cell); rows.push(row); row = []; cell = ''; i++;
    } else cell += ch;
  }
  return rows;
}

const comp = (over) => ({
  kind: 'sale', name: '1 Test St NW', address: '1 Test St NW', city: 'Washington', state: 'DC', zip: 20007,
  price: 1000000, bsf: 2000, date: new Date(Date.UTC(2025, 1, 20)), flags: [], ...over,
});

test('csv: one header row and one row per comp, every row the same width', () => {
  const { sales, market } = loadComps([{ name: 'f.pdf', pages: [F.classicSale, F.activeListing, F.saleWithParties] }],
    { zoningCodes: zoningLookup });
  const rows = parseCsv(compsCsv(sales, market));
  assert.equal(rows.length, 1 + sales.length + market.length);
  const width = rows[0].length;
  for (const r of rows) assert.equal(r.length, width);
  const h = rows[0];
  const bakery = rows.find((r) => r[h.indexOf('Property')] === '77 Example Pl NW');
  assert.equal(bakery[h.indexOf('True Buyer')], 'Example Bakery Co');
  assert.equal(bakery[h.indexOf('Sale Type')], 'Owner User');
  assert.equal(bakery[h.indexOf('Price per SF')], '800');
  assert.equal(bakery[h.indexOf('Sale Date')], '2025-03-14');
});

test('csv: commas, quotes and line breaks survive a round trip', () => {
  const name = 'Smith, Jones & "Co"\nAnnex';
  const rows = parseCsv(compsCsv([comp({ name })], []));
  assert.equal(rows[1][rows[0].indexOf('Property')], name);
});

test('csv: text that a spreadsheet would run as a formula is neutralized', () => {
  for (const bad of ['=HYPERLINK("x")', '+1+1', '-2', '@SUM(A1)']) {
    const rows = parseCsv(compsCsv([comp({ name: bad })], []));
    const v = rows[1][rows[0].indexOf('Property')];
    assert.equal(v, `'${bad}`, bad);
  }
  // a number stays a number, even a negative one
  const rows = parseCsv(compsCsv([comp({ cap: -1.5 })], []));
  assert.equal(rows[1][rows[0].indexOf('Cap Rate %')], '-1.5');
});

test('csv: the full address is one line a map can geocode, with a 5-digit ZIP', () => {
  assert.equal(fullAddress(comp({ zip: 2001 })), '1 Test St NW, Washington, DC 02001');
  assert.equal(fullAddress(comp({ city: null, state: null, zip: null })), '1 Test St NW');
});
