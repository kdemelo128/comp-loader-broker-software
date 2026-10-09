# Changelog

## 3.2.0 (on the development branch; not yet merged or deployed)

The version (and so the offline cache name) is 3.2.0, so an installed copy
fetches every new file whole once this reaches the published site.

### New

- **Rent roll workspace** (Deal → Rent roll). Leases as dated rent periods
  with a lease engine behind them (`app/lease.js`): per-month, per-year and
  per-SF rents, step increases, day-weighted proration, free rent and partial
  abatements, recoveries (pro rata, base year, stop, fixed), percentage rent,
  one-time items, renewal and re-leasing blended by probability, lease-up, and
  a monthly and annual projection to NOI. Configurable columns, presets,
  saved layouts, keyboard navigation, validation (overlaps, gaps, bad dates),
  expirations, concentration, import from Excel or CSV, and Rent Roll, Lease
  Schedule and Cash Flow tabs in the deal workbook. What if can use the
  projection's NOI year by year.
- **Template library.** Upload a firm's own .xlsx or .xlsm, map deal fields to
  its cells (suggested from named ranges and labels, corrected on a
  tap-to-map view), preview every cell before writing, and fill it in place:
  formulas, formats, merges, named ranges, hidden sheets and macros kept, an
  optional audit sheet of every value written and its source. Versions,
  duplicate, export and import as one file.
- **Tools: 23 new calculators**, 30 in all, in seven groups with search:
  discounted cash flow (optionally on the rent roll's NOI), NOI bridge,
  break-even occupancy, value sensitivity; amortization schedule, refinance
  and cash-out, floating-rate stress with a rate cap, maturity and refinance
  risk, financing costs; hold returns before and after sponsor fees, IRR
  sensitivity, a distribution waterfall with IRR hurdles, commission and
  splits; lease proposal comparison, renewal versus replacement, escalation
  schedule, percentage rent, recoveries, absorption; a comp set check; and
  residual land value, yield on cost and construction draws.
- Every tool can **save named scenarios**, **export** to Excel or print, and
  explain its formula; tools that use deal figures can **load them from the
  open deal**. Loan sizing, the NOI bridge and hold returns can **send their
  result to the deal**, after a confirmation listing each change from old to
  new; figures are tagged as typed from that tool, and hold assumptions go to
  the What if scenario, never the deal's figures.
- The Deal screen is split into Overview, Rent roll, What if and Site visit.
- **AI features, through an optional server** (`server/`, which holds the API
  keys; the app holds only its address and an access token). Read documents
  with AI: figures come back with their passages, which the app checks against
  the document text before showing them, and nothing is applied until the
  broker ticks it. Ask about this deal: answers from the deal's facts with
  citations. Transcribe voice notes, correct the transcript, and make notes
  (summary, decisions, action items, figures mentioned). Every send is
  confirmed; with AI off nothing leaves the device.
- **Home**: a dashboard with what needs attention, the pipeline by stage
  (stage also on each deal's new Pipeline card, with its history), tasks by
  due date, contacts linked to deals, recent activity, and every file saved
  or page printed. A pipeline report exports to Excel or prints. Call-note
  action items can become a deal's next steps. Nine stages (the firm can
  rename or hide them) and key dates per deal, with the next 30 days on Home.
  The deal brief includes call-note summaries, labelled as AI summaries.
- **Backup and restore** of everything on the device in one file (deals with
  photos and recordings, comps, templates, tasks, contacts, settings; never
  the AI token). Restoring merges, newer copy winning, or replaces everything
  after a second confirmation. Home shows storage use, whether the browser may
  clear it, and the last backup, and reminds after 30 days.
- **Reconciliation without AI** (`app/reconcile.js`): quoted passages checked
  against page text, readings grouped by tolerance (never auto-picked), and
  the rent roll checked against the OM's occupancy, SF, rent and units.

### Fixed (accessibility and security)

- Text contrast: the faint grey, the green, amber and teal now meet WCAG AA
  (4.5:1) on every surface they sit on, light and dark.
- Tap targets of at least 24 px (WCAG 2.2): page-source tags, chips,
  checkboxes; sideways-scrolling tables can be reached and scrolled from the
  keyboard; the file pickers have names; chart points have a role for their
  labels; a date field shows a focus ring on its calendar button too.
- A Content-Security-Policy forbids plugins, a re-pointed base URL and form
  posts; the page sends no referrer.
- The AI server limits each client to 20 AI requests a minute.

### Tests

- `tests/lease.test.js` (18), `tests/tplcells.test.js` (7) and
  `tests/calc.test.js` (12) check the new maths against figures worked out by
  hand or independently.
- `tests/reconcile.test.js` (5) for quote checks and reconciliation;
  `tests/pipeline.test.js` (6) for stages, key dates, task due dates and attention;
  `tests/backup.test.js` (4) for the backup round trip and restore plans;
  `server/test/server.test.mjs` (10) runs the server and the real Anthropic SDK
  against a local stand-in for the API. No live model call is tested: that
  needs a key.
- Browser flows `rentroll-flow` (22 checks), `template-flow` (16),
  `tools-flow` (28), `home-flow` (32), `backup-flow` (16: a wiped browser restored, photos byte
  for byte) and `ai-flow` (26, against the real server code and
  stand-in model and speech services), and the filled template recalculated
  in LibreOffice.
- `a11y-flow` (24 checks): axe-core's WCAG 2.0/2.1/2.2 A and AA rules on every
  screen and the main sheets, light and dark, with no violations; every
  control Tab reaches on Home shows a focus ring; 24 px targets; reflow at
  320 px. Automated checks are a floor: no screen-reader session was run.

## 3.1.0

A reliability release, found by testing every workflow in a phone-sized
browser, and a live what-if on the Deal tab.

### Fixed

- **A deal edited and closed within half a second was lost**, and a change
  made just before switching deals could be written into the next one. Saves
  now belong to their deal and are flushed on switch, close and leaving the
  app; a change still in flight when the app is closed is replayed on the next
  launch. Comp edits get the same protection.
- **Photos chosen for one deal could land in another** if the deal was
  switched while they were being shrunk. They now always go to the deal they
  were chosen for; so do voice notes, and a photo's Undo.
- **Closing costs, transfer tax and commission typed as 0.5 were read as
  50%.** These fields take a percentage as typed; a % sign is always taken
  literally.
- **Break-even occupancy was overstated** for a part-let building (it divided
  by effective rather than potential income). It now uses gross potential
  rent, else effective income scaled by occupancy, and says which.
- Gross potential rent is no longer taken for effective gross income, and
  pro forma NOI is read from the Pro Forma column of an operating statement.
- The lease clock counts down from the expiration date, not the OM's printed
  "years remaining".
- Value at the comps' cap rate warns when one or two comps carry it, and is
  withheld for a zero or negative NOI.
- On iPhone, tapping a field no longer zooms the page; comp prices and dates
  fit on the narrowest phones; the page-source tags take a finger-sized tap.
- Unreadable PDFs say why and what to do. A comps batch where every file
  fails says so.
- The brief no longer leaves a heading alone at the foot of a page (and is
  now called the deal brief: a full one runs to a second page).
- An installed copy downloads each release whole, bypassing the HTTP cache,
  so it can't mix old and new files; it checks for an update when reopened.
- The GitHub test workflow, `.nojekyll` and `.gitignore` are back.

### New

- **Live deal: what if**, with hold-period returns (levered and unlevered
  IRR, equity multiple, exit value), the price for a target cap rate or IRR,
  saved scenarios, and Save to deal only on confirmation.
- **Voice notes** on the site visit: record, or add a Voice Memos file.
  Stored with the deal, not transcribed.
- Site-visit lines say what was observed and what was told.
- A legend for the figure tags, and a fictional example deal.
- Known-answer finance tests.


## 3.0.0

A redesign, and two new screens beside the comps: **Deal** and **Tools**.

### New

- **Offering memorandum scanner (Deal tab).** Choose an OM's PDF and the asking
  price, NOI, cap rate, building and land size, units, year built, occupancy,
  income, expenses, taxes, zoning, single-tenant lease terms and the rent roll
  are read from it. Every figure shows the page it came from: tap the tag to see
  the line, and pick another reading if the OM prints more than one. Any two of
  price, NOI and cap rate give the third, marked as derived.
- **What doesn't add up.** The OM checked against itself: a stated cap rate that
  isn't NOI over price, a $/SF on a different square footage, a rent roll whose
  occupancy or area disagrees with the summary, pro forma upside, light
  expenses, and thin debt coverage.
- **Against your comps.** The asking $/SF against the sale comps on the Comps
  tab, where it falls in their range, and the value at their $/SF and median cap.
- **Financing and loan sizing.** Loan, debt service, DSCR, debt yield, cash flow,
  cash-on-cash, break-even occupancy, and the largest loan the property supports
  by LTV, DSCR and debt yield. Your terms are remembered for the next deal.
- **Value across cap rates**, WALT and rollover from the rent roll, and
  **questions to ask**, written from the gaps in the OM, to tick off on site.
- **Site visit**: a walk-through checklist, notes and photos, kept with the deal.
- **Deal outputs**: an Excel workbook (Deal Analysis and Rent Roll tabs, every
  result a live formula), a one-page brief to print or save as PDF with the
  photos, a five-line summary to text, and "use as the comps subject". The comp
  workbook can carry the open deal's analysis as a tab after the Summary.
- **Your own Excel template.** Upload the comp sheet your firm already uses and
  the Excel button fills it: the header row is found and each column matched to
  a comp figure by its wording, and you can change any match. Only the comp
  cells change; formatting, formulas, charts, logos and every other sheet stay
  exactly as they were. The built-in workbook is one tap away.
- **Tools tab**: quick value, loan sizing, offer price and seller net sheet, net
  effective rent, 1031 exchange deadlines, WALT and rollover, and a converter.
- Saved deals, stored on the device; deals, template and settings survive a reload.

### Changed

- **New design.** A tab bar on the phone and a sidebar on a desk, grouped cards,
  the system font, a cobalt-and-teal palette, light and dark, and a new icon.
- **Comps on a phone are cards**, not a table to scroll sideways. Every figure is
  still editable in place.
- **Faster comps.** Search, sort (by $/SF, date, price, size, cap rate or name),
  include or set aside every comp in one tap, read two PDFs at a time with
  page-by-page progress, and the PDF reader and Excel library start loading
  before the tap that needs them.
- Export, CSV, comp sheet and project actions are in one action sheet.
- Copyright Kyle Alexander De Melo.

### Fixed

- The first visit no longer announces "a new version is ready".

## 2.1.0

### New

- **Buyer, seller and deal terms.** Each comp now carries CoStar's true buyer and
  seller (the recorded entity when no true party is printed), sale type
  (investment or owner-user), sale conditions (1031 exchange, bankruptcy, high
  vacancy, sale-leaseback and so on) and hold period. They appear on the Sale
  Comps tab, in the comp detail panel, in the CSV, and beside the Adjustment
  Grid, where they inform the conditions-of-sale adjustment.
- **Comp detail panel.** ⓘ on any row shows everything on a comp: figures,
  parties and terms, flags, CoStar's full notes, and a map link.
- **Printable comp sheet.** One landscape page with the headline figures and both
  comp tables, for a BOV or an offering memorandum. Print it, or save it as a PDF
  from the print dialog.
- **CSV export**, with a single full-address column that Google My Maps can
  geocode, so the whole comp set can go on a map in a minute.
- **Owner-user** sales and listings are marked in the comp tables.
- **Lender-guideline flags in the Adjustment Grid.** Each comp shows its overall
  net adjustment; comps past 15% net or 25% gross (both editable) are shaded and
  counted. These are underwriting guidelines, not limits, so nothing is dropped.
- The version number is shown at the foot of the page.

### Fixed

- **The market-conditions adjustment came from a regression that explained
  nothing.** Across a mixed comp set the $/SF-over-time line measures which
  properties sold when, not how the market moved; in the southeast Baltimore set
  it implied +61% a year and adjusted one sale up 341%. On all seven test sets R²
  was between 0.01 and 0.27. The adjustment now starts at 0% unless the line is
  reliable (five or more sales, R² 0.5 or better, within ±10% a year), and the
  reason is printed beside the rate.
- The size-adjustment note told you to enter a negative rate to adjust a larger
  comp up; with the formula as written, that adjusts it down. The note now
  matches the formula.
- Older iPhones could not read PDFs: the pdf.js build used needs Safari 17.4.
  The legacy build, which polyfills what is missing, supports iOS 16.4 and
  later, and an older browser is told plainly to update.
- The "Install app" button, the iPhone home-screen hint and an empty file list
  showed on every device: the stylesheet let a class override `hidden`.
- On a slow connection, a nine-second start-up timer could declare a working
  browser unsupported and hide the app for good. Start-up is now judged when the
  page finishes loading, and a file that failed to download gets its own message.
- Opening the app and dropping a report before saved work had loaded could
  overwrite the new report with the old session.
- Library files are now named with their version, so an installed copy can never
  keep a stale one from its cache.
- Montgomery County zones written without a hyphen (`CR3.0`) and the industrial
  zones (`IL-1.0 H-50`) now give a buildable SF.
- The test workflow failed on GitHub before running a test: it needed a
  `package-lock.json`, and `npm test` pointed at a folder Node 22 will not
  accept. Two tests also checked for the wrong XML spelling.
- Test dependencies: fflate 0.8.3 fixes a ZIP64 parsing loop (the browser copy
  is updated too), and uuid is pinned to a patched release. `npm audit` is clean.

### Checked

Every XML part of every generated workbook now validates against the ISO/IEC
29500 schemas, the check behind Excel's "We found a problem with some content".

## 2.0.0

### New in the workbook

- **Charts tab.** Native Excel charts: sale comps ranked by $/SF, sale $/SF over
  time with a linear trendline, and listings ranked by asking $/SF. They read
  live cell ranges, so they move when a comp is edited, and they carry cached
  values, so they draw in Protected View and in previews.
- **Adjustment Grid in the appraisal sequence.** Property rights, financing,
  conditions of sale and market conditions compound to a normalized $/SF; the
  property adjustments (location, size, age and condition, quality, occupancy
  and lease, other) are then summed and applied once. Each comp shows its gross
  adjustment and a reliability weight, and the conclusion is given both by your
  weights and weighted toward the comps that needed the least adjusting.
- **Pricing matrix.** The subject's value at a ladder of cap rates, with the
  center and the step as inputs, and each row's $/SF and premium or discount to
  the asking price.
- **Market read.** Median asking $/SF against median sold $/SF, and a count of
  sales in the last eighteen months that warns when the set is thin.
- **Montgomery County zoning.** Zone names such as `CR-3.0 C-2.0 R-2.75 H-145`
  state their own maximum FAR; it is read from the name, added to the Zoning
  Catalogue, and Bethesda and Silver Spring comps get a buildable SF.
- **No fifteen-comp ceiling.** The grids hold fifteen, as the template did, and
  grow when more comps are included.
- **Prepared by** line on the Summary.
- Hand edits, moves between Sales and On Market, and hand-entered comps are all
  named in each comp's flags and on the Audit Trail.

### New in the app

- Reports **add to the set**. Dropping a second batch no longer replaces the
  first, and edits survive.
- **Your work is kept** on the device between visits, and can be saved as a
  **project file** to open on another device or hand to someone else.
- **At a glance** panel: headline figures, a ranked $/SF chart of sold and
  asking side by side, and sale $/SF over time with the trend.
- **Add a comp** by hand, **move** a comp between Sales and On Market,
  **sold-within** window for the sales.
- Comps past the fifteenth are kept and set aside rather than dropped; tick one
  to include it.
- **Share** the workbook straight to Mail, Outlook or Files from a phone.
- Numbers can be typed as brokers type them: `5.2m`, `850k`, `6.25%`.
- Installs as an app on Android and desktop Chrome or Edge, and shows iPhone
  users how to add it to the home screen. On the desktop, an installed copy
  opens PDFs double-clicked in the file manager.
- Starts faster: the PDF reader and the Excel writer load only when needed.

### Fixed

- Editing a figure redrew the whole table and lost the keyboard's place.
- An edited price or size could leave the workbook out of $/SF order. The
  workbook is now always written high to low.
- Installed copies never picked up a new version unless the cache was renamed.
  The app's own files now come from the network first.
- Vertical alignment in the workbook was silently dropped by ExcelJS, so cells
  sat at the bottom of their rows.
- `INDEX` on a zoning code with no FAR recorded returned 0 rather than blank.
- A sale with no date in the Adjustment Grid read as day zero, a century ago.
- An active listing laid out as "Status  Active" on a line of its own was
  flagged as under contract. (The Python loader had the same flaw; it is fixed
  there too.)
- Lowercase zoning matched in Excel but not in the stored value.
- Typing `5.2M` blanked the price.
- One malformed comp page stopped the whole batch.
- Clipboard text starting with `=`, `+`, `-` or `@` could run as a formula when
  pasted into a spreadsheet.
- The download's file name used tomorrow's date after 8 p.m. Eastern.

## 1.0.0

First release: CoStar comp PDFs parsed in the browser into the comp workbook,
with the same rules as the original Python loader.
