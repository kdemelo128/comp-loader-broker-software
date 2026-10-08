import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadComps, splitComps, parseComp, ppsf, MAX_COMPS } from '../app/costar.js';
import { zoningInfo, zoningLookup } from '../app/zoning.js';
import { repairApostrophes } from '../app/pdftext.js';
import { layoutPage } from '../app/layout.js';
import * as F from './fixtures.js';

const one = (page, name = 'test.pdf') => {
  const blocks = splitComps([page], name);
  assert.equal(blocks.length, 1, 'one comp per fixture page');
  return parseComp(blocks[0]);
};

test('classic sale: every labelled field', () => {
  const c = one(F.classicSale);
  assert.equal(c.kind, 'sale');
  assert.equal(c.name, '1048 Example Ave NW');
  assert.equal(c.city, 'Washington');
  assert.equal(c.state, 'DC');
  assert.equal(c.zip, 20007);
  assert.equal(c.submarket, 'Georgetown');
  assert.equal(c.ptype, 'Retail');
  assert.equal(c.date.toISOString().slice(0, 10), '2025-02-20');
  assert.equal(c.price, 6625000);
  assert.equal(c.costar_ppsf, 748.16);
  assert.equal(c.bsf, 8855);
  assert.equal(c.occ, 100);
  assert.equal(c.cap, 5.25);
  assert.equal(c.zoning, 'MU-4');
  assert.equal(c.lot_sf, 4792);
  assert.equal(c.lot_ac, 0.11);
  assert.equal(c.far, 1.85);
  assert.equal(c.year, 1925);
  assert.equal(c.comp_id, 6912345);
  assert.equal(c.bclass, 'C');
  assert.equal(c.buyer_broker, 'Example Brokerage Inc');
  assert.equal(c.listing_broker, 'Sample Realty LLC');
  assert.match(c.notes, /owner-user/);
  assert.equal(c.partial, false);
});

test('listing: "Active  N Days on Market"', () => {
  const c = one(F.activeListing);
  assert.equal(c.kind, 'market');
  assert.equal(c.dom, 49);
  assert.equal(c.price, 2500000);
  assert.equal(c.bsf, 3000);
  assert.equal(c.costar_ppsf, 833.33);
});

test('listing: "Status Active" with "On Market" on its own line', () => {
  const c = one(F.statusListing);
  assert.equal(c.kind, 'market');
  assert.equal(c.dom, 127);
  assert.equal(c.bsf, 5000);
  assert.equal(c.zoning, 'CR-3.0 C-2.0 R-2.75 H-145');
  // an active listing in this layout must not be called under contract
  assert.ok(!c.flags.some((f) => /Under Contract/.test(f)), c.flags.join(' | '));
});

test('listing marked "Under Contract  N Days" is flagged as under contract', () => {
  const page = [
    '  8    12 Sample Ct',
    '       Washington, DC 20001 - Test Submarket            Retail',
    '',
    'Under Contract                   88 Days',
    'Asking Price                     $1,000,000',
    'RBA                              2,000 SF',
  ].join('\n');
  const c = one(page);
  assert.equal(c.kind, 'market');
  assert.equal(c.dom, 88);
  assert.ok(c.flags.some((f) => /Under Contract/.test(f)));
});

test('flyer layout: escrow is a listing, time on market converts to days', () => {
  const c = one(F.flyerEscrow);
  assert.equal(c.kind, 'market');
  assert.equal(c.city, 'Takoma Park');
  assert.equal(c.state, 'MD');
  assert.equal(c.submarket, 'Takoma Park');
  assert.equal(c.ptype, 'Retail');
  assert.equal(c.dom, Math.round(2 * 365.25 + 3 * 30.44));
  assert.equal(c.occ, 75);
  assert.ok(c.flags.some((f) => /status is Escrow/.test(f)));
  assert.ok(c.flags.some((f) => /Vacancy %/.test(f)));
});

test('land-value sale loads as a sale and is flagged', () => {
  const c = one(F.landValue);
  assert.equal(c.kind, 'sale');
  assert.equal(c.date.toISOString().slice(0, 10), '2023-05-01');
  assert.ok(c.flags.some((f) => /Land Value/.test(f)));
});

test('partial interest is flagged and not compared to the printed $/SF', () => {
  const c = one(F.partialSale);
  assert.equal(c.partial, true);
  assert.equal(ppsf(c), 500);                 // what was paid, not CoStar's grossed-up $1,000
  assert.ok(c.flags.some((f) => /partial-interest/.test(f)));
});

test('notes continue across pages and the page footer is dropped', () => {
  const blocks = splitComps([F.continuedPage1, F.continuedPage2], 'long.pdf');
  assert.equal(blocks.length, 1);
  const c = parseComp(blocks[0]);
  assert.match(c.costar_notes, /First part.*Second part/);
  assert.doesNotMatch(c.costar_notes, /Licensed|Page 2/);
});

test('rules: high to low $/SF, unpriced listings last', () => {
  const docs = [{
    name: 'set.pdf',
    pages: [
      F.saleWith(1, { price: 1000000, sf: 2000 }),          // $500
      F.saleWith(2, { price: 3000000, sf: 3000 }),          // $1,000
      F.saleWith(3, { price: 1500000, sf: 2000 }),          // $750
      F.listingWith(4, { price: null, sf: 2000 }),          // unpriced
      F.listingWith(5, { price: 2000000, sf: 4000 }),       // $500
      F.listingWith(6, { price: 2400000, sf: 3000 }),       // $800
    ],
  }];
  const { sales, market } = loadComps(docs, { zoningCodes: zoningLookup });
  assert.deepEqual(sales.map((c) => Math.round(ppsf(c))), [1000, 750, 500]);
  assert.deepEqual(market.map((c) => (ppsf(c) === null ? null : Math.round(ppsf(c)))), [800, 500, null]);
  assert.ok(market[2].flags.some((f) => /not disclosed/.test(f)));
});

test('rules: the same comp in two reports loads once', () => {
  const page = F.saleWith(1, { price: 1000000, sf: 2000 });
  const { sales, report } = loadComps([{ name: 'a.pdf', pages: [page] }, { name: 'b.pdf', pages: [page] }]);
  assert.equal(sales.length, 1);
  assert.ok(report.excluded.some((x) => /duplicate/.test(x)));
});

test('rules: the fifteen-comp cap drops the oldest sales, or marks them with cap off', () => {
  const pages = Array.from({ length: 18 }, (_, i) => F.saleWith(i + 1, {
    price: 1000000 + i * 1000, sf: 2000, date: `1/${i + 1}/2025`,
  }));
  const capped = loadComps([{ name: 'many.pdf', pages }]);
  assert.equal(capped.sales.length, MAX_COMPS);
  assert.equal(capped.report.excluded.length, 3);
  const kept = loadComps([{ name: 'many.pdf', pages }], { cap: false });
  assert.equal(kept.sales.length, 18);
  const cut = kept.sales.filter((c) => c.cut);
  assert.equal(cut.length, 3);
  // the three cut are the three oldest
  assert.deepEqual(cut.map((c) => c.date.getUTCDate()).sort((a, b) => a - b), [1, 2, 3]);
});

test('a malformed comp is reported, and the rest of the batch still loads', () => {
  const broken = ['  9    1 Broken Way', '       Nowhere, ZZ 00000', '', 'Sold   not-a-date'].join('\n');
  const good = F.saleWith(1, { price: 1000000, sf: 2000 });
  const { sales, report } = loadComps([{ name: 'mixed.pdf', pages: [broken, good] }]);
  assert.equal(sales.length, 1);
  assert.equal(report.parse.length, 1);
});

test('zoning: DC catalogue, Montgomery County zone names, case-insensitive like Excel', () => {
  assert.deepEqual(zoningInfo('MU-4'), { far: 3, source: 'catalogue' });
  assert.deepEqual(zoningInfo(' mu-4 '), { far: 3, source: 'catalogue' });
  assert.deepEqual(zoningInfo('CR-3.0 C-2.0 R-2.75 H-145'), { far: 3, source: 'moco' });
  assert.deepEqual(zoningInfo('CRT-2.25 C-1.5 R-1.5 H-70'), { far: 2.25, source: 'moco' });
  assert.deepEqual(zoningInfo('EOF-3.0 H-100'), { far: 3, source: 'moco' });
  assert.equal(zoningInfo('CRT'), null);                // the family alone states no FAR
  assert.equal(zoningInfo('CGO'), null);
  assert.equal(zoningLookup('NOPE'), undefined);
});

test('apostrophe repair: needs a vote, never touches REITs or MacArthur', () => {
  const pages = ['The propertyBs location and the buildingBs history.', 'Two REITs on MacArthur Blvd and DCBs core.'];
  const fixed = repairApostrophes(pages);
  assert.equal(fixed[0], 'The property’s location and the building’s history.');
  assert.match(fixed[1], /REITs on MacArthur Blvd and DC’s core/);
  const clean = ['Two REITs on MacArthur Blvd.'];
  assert.deepEqual(repairApostrophes(clean), clean);
});

test('layout: a visible gap becomes two or more spaces, adjacent words one', () => {
  const item = (str, x, y = 700, w = str.length * 5) => ({ str, transform: [10, 0, 0, 10, x, y], width: w, height: 10 });
  const text = layoutPage([item('Cap Rate', 32), item('5.25%', 200), item('Sale', 32, 680), item('Price', 55, 680)]);
  const [l1, l2] = text.split('\n').filter(Boolean);
  assert.match(l1, /^Cap Rate\s{2,}5\.25%$/);
  assert.equal(l2, 'Sale Price');
});

test('buyer, seller, sale type, conditions and hold period', () => {
  const c = one(F.saleWithParties);
  assert.equal(c.kind, 'sale');
  assert.equal(c.buyer, 'Example Bakery Co');            // the true buyer, not the recording entity
  assert.equal(c.seller, 'Sample Holdings');
  assert.equal(c.sale_type, 'Owner User');
  assert.equal(c.conditions, '1031 Exchange, Sale Leaseback');
  assert.equal(c.hold, '57 Months');
  assert.equal(c.price, 2400000);                         // the new fields change nothing else
});

test('a Sale History header is never read as a sale type', () => {
  const c = one(F.listingHistoryOnly);
  assert.equal(c.kind, 'market');
  assert.equal(c.sale_type, null);
  assert.equal(c.buyer, null);
});

test('recorded buyer stands in when no true buyer is printed', () => {
  const page = F.saleWithParties.replace(/^True Buyer.*$/m, '');
  assert.equal(one(page).buyer, '77 Example LLC');
});
