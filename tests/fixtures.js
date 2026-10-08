/* fixtures.js -- invented CoStar-shaped page text for the tests.
 *
 * Real CoStar reports are licensed and stay out of this repository. These pages
 * reproduce the layouts the parser has to read -- the fixed-width text that
 * app/layout.js rebuilds from a PDF -- with made-up properties and figures:
 *
 *   classicSale    "Sold  2/20/2025" with the usual labelled fields
 *   activeListing  "Active  49 Days on Market"
 *   statusListing  "Status  Active" with "On Market  127 Days" on its own line
 *   flyerEscrow    broker-flyer header line, "Status  Escrow", "Time On Market"
 *   landValue      "Sold for Land Value  5/1/2023"
 *   partialSale    a partial-interest transfer
 *   continued      notes running over onto a second page
 */

export const classicSale = [
  '  1    1048 Example Ave NW',
  '       Washington, DC 20007 - Georgetown Submarket            Retail',
  '',
  'Sold                             2/20/2025                          Land Area                        0.11 AC/4,792 SF',
  'Sale Price                       $6,625,000 ($748.16/SF)            Sale Comp Status                 Research Complete',
  'Cap Rate                         5.25%                              Zoning                           MU-4',
  'RBA (% Leased)                   8,855 SF (100.0%)                  Built/Renovated                  1925',
  'Sale Comp ID                     6912345                            Building Class                   C',
  'Sale Conditions                  -                                  Building FAR                     1.85',
  'Buyer Broker                     Example Brokerage Inc',
  'Listing Broker                   Sample Realty LLC',
  '',
  'Transaction Notes',
  'The property sold to an owner-user after a short marketing period. The buyer plans to occupy the ground floor.',
].join('\n');

export const activeListing = [
  '  2    1620 Example Ave NW',
  '       Washington, DC 20007 - Georgetown Submarket            Retail',
  '',
  'Active                           49 Days on Market',
  'Asking Price                     $2,500,000 ($833.33/SF)',
  'GLA (% Leased)                   3,000 SF (100.0%)',
  'Zoning                           MU-4',
  'Land Area                        0.03 AC/1,307 SF',
].join('\n');

export const statusListing = [
  '  3    4901 Sample Ave',
  '       Bethesda, MD 20814 - Bethesda/Chevy Chase Submarket            Retail',
  '',
  'Status                           Active',
  'On Market                        127 Days',
  'Asking Price                     $3,200,000 ($640.00/SF)',
  'Building Size                    5,000 SF',
  'Zoning                           CR-3.0 C-2.0 R-2.75 H-145',
  'Land Area                        0.09 AC/4,000 SF',
].join('\n');

export const flyerEscrow = [
  '  4    8000 Example Ave',
  '       6,000 SF • For Sale • Retail Property • Takoma Park Submarket • Takoma Park, MD 20912',
  '',
  'Status                           Escrow',
  'Time On Market                   2 Years 3 Months',
  'Asking Price                     $1,500,000',
  'GLA                              6,000 SF',
  'Vacancy %                        25%',
].join('\n');

export const landValue = [
  '  5    7904 Sample Ave',
  '       Bethesda, MD 20814 - Bethesda/Chevy Chase Submarket            Land',
  '',
  'Sold for Land Value              5/1/2023',
  'Sale Price                       $4,000,000 ($800.00/SF)',
  'RBA                              5,000 SF',
  'Land Area                        0.25 AC/10,890 SF',
  'Zoning                           CRT',
].join('\n');

export const partialSale = [
  '  6    3065 Example St NW',
  '       Washington, DC 20007 - Georgetown Submarket            Retail',
  '',
  'Sold                             3/3/2024',
  'Sale Price                       $2,400,000 ($1,000.00/SF)',
  'Sale Conditions                  Partial Interest',
  'RBA (% Leased)                   4,800 SF (90.0%)',
  'Zoning                           MU-4',
].join('\n');

export const continuedPage1 = [
  '  7    1515 Example St NW',
  '       Washington, DC 20009 - Dupont Circle Submarket            Office',
  '',
  'Sold                             9/9/2025',
  'Sale Price                       $3,300,000 ($550.00/SF)',
  'RBA (% Leased)                   6,000 SF (80.0%)',
  'Zoning                           MU-4',
  '',
  'Transaction Notes',
  'First part of a long note that runs onto the next page.',
].join('\n');

export const continuedPage2 = [
  'Transaction Notes (Continued)',
  'Second part of the same note.',
  '',
  'CoStar Group - Licensed to Example Brokerage - 123456',
  'Page 2',
].join('\n');

/** A sale with chosen figures, for the rules tests. */
export function saleWith(n, { price, sf, date = '1/15/2025', name = `${100 + n} Test St NW` }) {
  return [
    `  ${n}    ${name}`,
    '       Washington, DC 20001 - Test Submarket            Retail',
    '',
    `Sold                             ${date}`,
    `Sale Price                       ${price === null ? 'Not Disclosed' : `$${price.toLocaleString('en-US')}`}`,
    `RBA (% Leased)                   ${sf.toLocaleString('en-US')} SF (100.0%)`,
    'Zoning                           MU-4',
  ].join('\n');
}

/** A listing with chosen figures. */
export function listingWith(n, { price, sf, dom = 30, name = `${200 + n} Test St NW` }) {
  return [
    `  ${n}    ${name}`,
    '       Washington, DC 20001 - Test Submarket            Retail',
    '',
    `Active                           ${dom} Days on Market`,
    `Asking Price                     ${price === null ? 'Not Disclosed' : `$${price.toLocaleString('en-US')}`}`,
    `RBA (% Leased)                   ${sf.toLocaleString('en-US')} SF (100.0%)`,
    'Zoning                           MU-4',
  ].join('\n');
}

/* A sale with its contacts table and a Sale History table whose header row
 * reads "Sale Type  Buyer" -- the label there is followed by another header,
 * not a value, and must not be read as one. */
export const saleWithParties = [
  '  9    77 Example Pl NW',
  '       Washington, DC 20007 - Georgetown Submarket            Retail',
  '',
  'Sold                             3/14/2025                          Land Area                        0.05 AC/2,200 SF',
  'Sale Price                       $2,400,000 ($800.00/SF)            Sale Comp ID                     7000009',
  'GLA                              3,000 SF',
  'Sale Type                        Owner User                         Hold Period                      57 Months',
  'Sale Conditions                  1031 Exchange, Sale Leaseback',
  '',
  'Contacts',
  'Type                           Name                                          Location                                      Phone',
  'Recorded Buyer                 77 Example LLC                                -                                             -',
  'True Buyer                     Example Bakery Co                             Washington, DC 20007                          (202) 555-0100',
  'True Seller                    Sample Holdings                               Bethesda, MD 20814                            -',
  'Listing Broker                 Sample Realty LLC',
  '',
  'Sale History',
  'Sale Date       Price            Sale Type        Buyer            Seller',
  '6/1/2020        $1,900,000       Investment       Sample Holdings  Prior Owner',
].join('\n');

/* A listing whose only "Sale Type" text is the Sale History header. */
export const listingHistoryOnly = [
  '  10   88 Example Pl NW',
  '       Washington, DC 20007 - Georgetown Submarket            Retail',
  '',
  'Active                           30 Days on Market',
  'Asking Price                     $1,500,000 ($750.00/SF)',
  'GLA                              2,000 SF',
  '',
  'Sale History',
  'Sale Date       Price            Sale Type        Buyer            Seller',
].join('\n');
