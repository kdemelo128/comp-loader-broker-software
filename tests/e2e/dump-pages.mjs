/* The invented OM and CoStar page text from the unit-test fixtures, for make_pdfs.py to typeset. */
import fs from 'fs';
import * as om from '../om-fixtures.js';
import * as cs from '../fixtures.js';

fs.writeFileSync(process.argv[2], JSON.stringify({
  om_retail: om.retail, om_netlease: om.netlease, om_multifamily: om.multifamily,
  costar_set: [cs.classicSale, cs.activeListing, cs.statusListing, cs.flyerEscrow, cs.landValue, cs.saleWithParties],
}));
