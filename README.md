<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/logo-dark.svg">
  <img src="docs/brand/logo-light.svg" alt="Zlatura" width="220">
</picture>

**Every source. Every assumption. Every number.**

Zlatura is a commercial real estate brokerage workspace that runs in the
browser and installs on an iPhone like an app. Five places, in a sidebar on a computer and a tab bar on a phone:

- **Home** is where the day starts: the deals to continue working on with
  their figures and next step, what needs attention, key dates, the pipeline by
  stage, tasks, contacts, recent activity, and a pipeline report to export or
  print. Every number on it is counted from what is on the device.

- **Comps** turns CoStar comp reports into a checked comp set and an Excel
  workbook (the built-in one, or **your own template**, filled in place).
- **Deal** reads an **offering memorandum** on the spot: the key figures with the
  page each came from, what doesn't add up, where it sits against your comps, a
  loan run, a **live what-if** with hold-period returns, the questions to ask,
  and site-visit notes, photos and voice notes.
- **Tools** holds 30 calculators for valuation, debt, returns and fees,
  leasing, comps and development (DCF, amortization, refinance, floating-rate
  stress, sensitivity grids, a distribution waterfall, commission splits,
  lease comparisons, residual land value and more). A tool can load the open
  deal's figures and, after you confirm each change, send its result back.
- **Settings** holds appearance (light, dark or follow the device), the
  template library, pipeline stages, the AI connection, backup and restore,
  and the calculation conventions (see *How the numbers are kept* below).

**Search or jump** (⌘K on a Mac, Ctrl K elsewhere, or **/**; the search button
on a phone) finds any deal by name, address or tenant, any contact by name,
company or role, any of the 30 tools, and the app's actions (read an OM, add
comps, a new task or contact, back up, change the theme). Arrow keys move,
Enter opens, Esc closes.

Everything is read on the device. PDFs and workbooks are never uploaded, the
page makes no request to any other site, and once it has loaded it works with
no connection at all. The optional AI features are the exception, and only
when a firm runs its own AI server and a broker turns them on (see below).

© 2026 Kyle Alexander De Melo. MIT License.

## Comps

1. Drop in CoStar comp report PDFs, or choose them. More can be added at any time.
2. Review the comps. Every figure is editable (type `5.2m`, `850k` or `6.25%` as
   you would say them). Search, sort, include or set aside one comp or all of
   them, open ⓘ for everything on a comp, and ⇄ to move one between Sales and On
   Market.
3. Optionally fill in the subject property, or send it from a deal.
4. **Excel** downloads the workbook. **⋯** has the rest: share, the one-page comp
   sheet, CSV for a CRM or Google My Maps, copy the table, and project files.

### Your own Excel template

Under **Excel output**, choose **My template** and upload the .xlsx your firm
uses. Zlatura finds the row of column headings on each sheet, matches each
column to a comp figure by its wording ("Sale Price", "Price", "Asking Price"...),
and shows you the match to correct. From then on the Excel button fills that
template:

- comps go under the headings, one row each, numbers as numbers and dates as
  dates, in the template's own cell styles;
- cells holding formulas are left alone, so the template's own $/SF, averages
  and output sheets keep working, and Excel recalculates when the file opens;
- old values under the headings are cleared first, so an old comp's figures
  never sit beside a new one's name;
- formatting, charts, logos, print setup and every other sheet are untouched:
  the file is edited in place, not rebuilt.

The template is kept on the device. Switch back to **Zlatura workbook** at
any time.

## Deal: reading an offering memorandum

On **Deals**, **Choose OM** and pick the PDF (from Mail, Files or a
download). In a few seconds:

- **Key figures**, each tagged with its page. Tap a tag to see the line it was
  read from and any other readings the OM prints; tap one to use it. Green tags
  were printed in a summary or repeated; amber ones are worth a look.
- **Headline tiles**: asking price and $/SF, cap rate on the asking price, NOI,
  occupancy and WALT, and DSCR at your loan terms.
- **What doesn't add up**: the OM checked against itself.
- **Against your comps**: the premium or discount to the sale comps on the Comps
  tab, where the asking $/SF falls among them, and the value at their $/SF and
  median cap rate.
- **Financing**: loan, debt service, DSCR, debt yield, cash-on-cash, break-even
  occupancy, and the largest loan the property supports and which test limits it.
- **Live deal: what if.** Change the price, NOI, rents, occupancy, expenses,
  rate, LTV, exit cap, hold or growth and see the deal and the scenario side by
  side: cap rate, DSCR, debt yield, cash-on-cash, equity, exit value, levered and
  unlevered IRR and equity multiple. It answers the price for a target cap rate
  or a target IRR, and the value at any cap rate. **A scenario never changes the
  deal**: the OM's figures move only when you tap **Save to deal** and confirm,
  and the figures you save are tagged "edited". Scenarios can be saved by name.
- **Value across cap rates**, the **rent roll** with WALT and rollover, and
  **questions to ask**, written from this OM's gaps, to tick off.
- **Site visit**: a checklist (what you observed), notes (what you were told),
  photos and voice notes, recorded on the spot or added from Voice Memos. Voice
  notes are kept as audio with the deal; they are **not transcribed**, because
  that needs a speech service and nothing here leaves the device.

A deal has four sections: **Overview**, **Rent roll**, **What if** and
**Site visit**.

Then: **Excel** (a Deal Analysis tab and a Rent Roll tab, every result a live
formula), **Share** (a five-line summary), **Deal brief** (print or save as
PDF, with photos and any scenarios, labelled as assumptions), or **Use as the
comps subject**. Deals are saved on the device; **All deals** lists them, and
**Try a fictional example deal** shows the screen with invented figures.

An OM that is a scan, with no text in it, can't be read: enter the figures by
hand and everything else works the same. OMs have no standard layout, so check
the figures against the page tags before relying on them.

## Home: pipeline, tasks and contacts

- **Pipeline**: every deal by stage (Prospect, Listing, Underwriting,
  Marketing, Offer / LOI, Under contract, Due diligence, Closed, Lost or
  passed) with its asking price and cap rate. **Stages** renames them to the
  firm's words or hides unused ones. Change a deal's stage on Home or on the
  deal's own **Pipeline** card; each change is logged.
- **Key dates** on each deal (LOI response, due diligence, financing
  contingency, deposit going hard, closing, lease expiration, loan maturity):
  the next 30 days are listed on Home, and anything within a week or past is
  in Needs attention. **Report** gives the pipeline, tasks and contacts as an Excel
  workbook (figures as numbers) or a printable page.
- **Tasks**: due today, overdue, the next seven days, later; each can belong
  to a deal. A deal's next steps are on its Overview. Action items from call
  notes can be added in one tap. Done and delete both have Undo.
- **Contacts**: name, company, role, phone and email (tap to call or write),
  notes, and the deals they are part of. Search by name, company or role.
- **Needs attention**: key dates within a week, overdue tasks, active deals
  with no next step, deals untouched for three weeks, and no recent backup.
- **Activity**: stage changes, tasks, contacts, and every file saved or page
  printed (with the deal it was for, when made from a deal).

All of it is kept on the device with the deals.

### Your data: backup and restore

Everything lives in this browser on this device, so **Your data** (in
Settings; Home reminds you when there is no recent backup) makes one backup file of all of it: every deal with its photos and
recordings, the comp set, the template library, tasks, contacts, activity,
saved Tools scenarios and settings. Home reminds you when there has been no
backup for 30 days. **Restore from a backup** shows what it will do first:

- **Merge** (the default) adds what this device lacks and takes a newer copy
  of anything changed since; nothing newer here is lost.
- **Replace everything** makes the device match the backup, after a second
  confirmation.

The AI access token is never written into a backup (a backup is a file that
gets copied and sent), and a restore never replaces the one on the device.
The backup holds confidential deal information: keep it somewhere safe.

## Rent roll

The **Rent roll** section holds each lease as dated rent periods, not one rent
figure, so an irregular schedule is entered as the lease reads.

- **The grid** shows one row per unit with the columns you choose: show, hide,
  rename, widen and reorder them, add your own fields, start from a preset for
  the property type, and save a layout to reuse. Arrows, Enter and Escape move
  around it as in a spreadsheet; search, sort and filter by status.
- **The lease schedule** (tap a row's schedule button) has a timeline, the rent
  periods (per month, per year, per SF a year or a month), a step builder for %
  or $ increases on any interval, free rent and partial abatements, one-time
  charges and credits, expense recoveries (pro rata, base year, expense stop,
  fixed), percentage rent, and renewal terms. It checks for overlaps, gaps,
  bad dates and per-SF rent with no SF.
- **Outputs**: expirations by year, tenant concentration, and a month-by-month
  projection to NOI, with renewals and re-leasing blended by probability and
  general vacancy netted against the vacancy already modelled. Periods taken
  from documents are kept apart from projected ones; with no market rent set,
  re-leasing assumes the last contract rent and says so.
- **Import** from Excel or CSV with a column-matching step; export to Excel or
  CSV. The deal workbook carries Rent Roll, Lease Schedule and Cash Flow tabs.
- **What if** can take NOI year by year from this projection.

## Template library

**Fill my Excel template** (Deal menu and Deal screen; also under the Comps ⋯
menu as Template library) keeps your firm's own workbooks on the device and
fills them from any deal.

1. Upload an .xlsx or .xlsm. Zlatura lists its sheets, named ranges and
   anything that needs a warning (macros, external links, pivot tables,
   connections, protection). .xls and .xlsb are refused with what to do.
2. It suggests which cell takes which deal figure (a named range, or the cell
   beside or under a label naming it), with its reason; correct it on a
   tap-to-map view of the sheet. Rent roll tables are found by their headings.
3. Before anything is written, a preview lists every cell: its value now, the
   new value, where that comes from (OM page, typed, calculated, rent roll,
   scenario) and how many formulas read it. Formula cells and the inside of
   merged ranges are never written.
4. The filled copy keeps formats, formulas, merges, named ranges, hidden sheets
   and macros (an .xlsm stays an .xlsm, its macros byte for byte). An optional
   **Zlatura Audit** sheet lists every cell written and its source (a
   workbook filled before the rename has its old *Comp Loader Audit* sheet
   replaced).

Templates have categories, versions (replace the file, restore an older one),
duplicate and delete, and export as one file to send to a colleague, who
imports it on their device. There is no shared server: that is how a firm
template travels.

## Tools

Thirty calculators in seven groups. Results update as you type, and every
figure comes from the tested functions in `app/calc.js`, `app/deal.js`,
`app/lease.js` and `app/tools.js`.

| Group | Tools |
|---|---|
| Valuation | Quick value, offer and seller net, discounted cash flow (optionally on the rent roll's projected NOI), NOI bridge, break-even occupancy, value sensitivity (NOI × cap rate) |
| Debt and financing | Loan sizing, amortization schedule with interest-only, refinance and cash-out, floating-rate stress with a rate cap, maturity and refinance risk, financing costs |
| Returns and fees | Hold returns before and after sponsor fees, IRR sensitivity (price × exit cap), distribution waterfall with IRR hurdles, commission and splits |
| Leasing | Net effective rent, compare three proposals, renewal versus replacement, escalation schedule, percentage rent, expense recoveries, lease-up and absorption, WALT |
| Comps and market | Comp set check: count, recency, spread and a value range from the sale comps on the Comps tab |
| Development | Residual land value, yield on cost, construction draws with capitalized interest |
| Conversions and dates | 1031 exchange deadlines, the converter |

In each tool:

- **Load from deal** fills the inputs from the open deal; the deal is not
  changed.
- **Send to deal** (loan sizing, NOI bridge, hold returns) shows exactly what
  will change, old value to new, and writes only when you confirm. Figures
  written are tagged as typed, from that tool; hold assumptions go to the What
  if scenario, never to the deal's own figures.
- **Scenarios** saves named sets of inputs per tool (load, rename, duplicate,
  delete), kept on the device.
- **Export** copies the results as text, builds an Excel workbook (inputs as
  numbers, results as the values shown, tables), or prints.
- **How it is worked out** gives the formula, and warnings flag inputs that
  don't hang together (an exit cap far above the discount rate, hurdles that
  don't rise, a refinance that can't repay the old loan).

The waterfall's rules are stated in the tool: capital in pro rata, cash out pro
rata until the investors reach the first hurdle (compounded yearly), then the
sponsor's promote off the top in each band; no catch-up and no clawback.

## On a phone

**iPhone:** open the site in Safari, tap **Share → Add to Home Screen**. It then
opens full screen and works offline. Files arrive through the share sheet, so
they can go straight to Mail, Outlook, Teams or Files. Needs iOS 16.4 or later.

**Android:** Chrome offers **Install app** (or ⋮ → Install app).

## The comp workbook

| Tab | What it is for |
|---|---|
| **Summary** | The subject panel; survey statistics for sales and listings; a market read; four indicated values with a concluded range; a pricing matrix |
| **Deal Analysis**, **Rent Roll** | With a deal open: the offering, pricing, financing, loan sizing, a cap-rate ladder, the comps comparison, and the rent roll with live WALT |
| **Charts** | Native Excel charts that read live cells |
| **Sale Comps**, **On Market Comps** | The comp grids, high to low $/SF, with parties, terms, brokers, flags and notes |
| **Adjustment Grid** | The sales-comparison approach in appraisal order, with lender-guideline shading |
| **Lease Comps** | A structured sheet to fill in by hand, with net effective rent |
| **Zoning Catalogue** | Max FAR by District of Columbia code, plus Montgomery County zones |
| **Audit Trail**, **CoStar Notes** | Where each comp came from, every flag and hand edit, and the full notes |

Every figure is a live formula with its value stored beside it, so the file
shows numbers in Outlook's preview and Protected View and still recalculates.

### Judgements it makes, and says it made

- Unpriced listings are kept but never score as $0/SF: a comp counts toward
  any $/SF figure only with a price and a size both above zero.
- Weighted $/SF is total price over total size, not an average of ratios.
- Market conditions start at 0% unless the comps' own $/SF-over-time line is
  reliable (five or more sales, R² 0.5 or better, within ±10% a year).
- A zoning code it does not know leaves buildable SF blank rather than guessing.
- Comps past fifteen are set aside, not dropped.
- On a deal, a figure worked out from others is labelled "derived", and a
  figure you typed over is labelled "edited", with the OM's own value one tap away.

## How the numbers are kept

Each figure is worked out by one function (`app/engine/`), so the Overview,
the Rent roll tab, the Tools, the brief and the workbooks agree.

- **WALT** is measured from the rent roll's as-of date, weighted by income,
  with month-to-month leases left out. Every WALT says how it was measured,
  for example "WALT 3.9 yrs by income". **Settings → Calculation
  conventions** can weight it by area instead, or count month-to-month leases
  at zero years. The other conventions are listed there too.
- **Net effective rent** compounds each escalation at the lease anniversary
  and takes the free months at the rent in force then. It deducts TI and,
  when entered, commissions, then divides by the term. Its label says what it
  is net of, and a discounted version is shown beside it.
- **Break-even occupancy** is (operating expenses + debt service − income
  that does not depend on occupancy) ÷ gross potential rent. With no GPR it
  is estimated from gross income and occupancy, and labelled "(est.)".
- **Loan payments** amortize over whole months.
- **No price is worked out from a zero or negative NOI.** The price shows
  "—" with a warning.
- **Money** is stored with totals in whole cents and rates per SF or per
  unit to four decimals. When 4.1 first opens, existing values are rounded
  once, and each one is listed with its old and new value under **Settings →
  Your data**.

## About the name

Zlatura joins two words for wealth: *zlato*, gold in Serbian and Croatian, and
*fartura*, abundance in Brazilian Portuguese.

## Coming from Comp Loader

Zlatura was called Comp Loader until version 4.0. Nothing needs doing:

- The first time 4.0 opens, everything kept on the device under the old name
  (deals with their photos and recordings, the comp set, templates, tasks,
  contacts, settings) is copied to Zlatura's storage in one step, all or
  nothing. Data already under the new name is never overwritten.
- The old copy is left as it was until a backup has been made since the move,
  or for 30 days; then it is deleted. **Settings → Your data** says when the
  move happened while the old copy is still there.
- Backups, comp projects and template packages made by Comp Loader open in
  Zlatura, now and later. New ones are written in Zlatura's format, which
  Comp Loader 3.x cannot read.
- The web address is unchanged, so the installed app keeps its place on the
  home screen.

## Putting it online (first time)

It is a static site: no build step, no server, no keys.

1. Install **GitHub Desktop** (desktop.github.com) and sign in.
2. **File → Add Local Repository**, pick the unzipped `comp-loader` folder, accept
   **create a repository**, then **Commit to main**.
3. **Publish repository**, untick **Keep this code private**, publish.
4. On github.com: the repository's **Settings → Pages**, Source *Deploy from a
   branch*, Branch `main`, folder `/ (root)`, **Save**.
5. A few minutes later it is live at `https://<your-username>.github.io/comp-loader/`.

## Updating to a new version

1. Unzip the new version.
2. In Finder or File Explorer, open your existing `comp-loader` folder (the one
   GitHub Desktop is tracking). Delete everything in it **except the hidden
   `.git` folder**, then copy everything from the new `comp-loader` folder in,
   including the hidden `.github` folder and `.nojekyll` file.
   (Mac: press **Cmd+Shift+.** to show hidden files. Windows: View → Show →
   Hidden items.)
3. GitHub Desktop lists the changed files. Type a summary such as
   `Zlatura 4.0`, click **Commit to main**, then **Push origin**.
4. GitHub rebuilds the site in a minute or two (the **Actions** tab shows a green
   check when the tests pass). Installed copies offer **Reload** the next time
   they open online.

Deleting and re-copying, rather than copying over the top, matters: files a new
version removes would otherwise linger in the repository.

## Locally

```sh
python3 -m http.server 8080      # then open http://localhost:8080
```

## Development

```sh
npm ci        # the packages the tests use
npm test      # parser, OM reader, deal maths, known-answer finance, lease engine, tools, templates, workbook, exports, repository
```

`tests/lease.test.js` checks the lease engine against schedules worked out by
hand (proration, steps, abatements, recoveries, percentage rent, rollover,
vacancy). `tests/calc.test.js` checks the Tools calculators (DCF, amortization,
refinance, waterfall, commission, renewal versus replacement, residual land,
draws and the rest) against figures worked out independently.
`tests/tplcells.test.js` checks template mapping, the preview and filling.

`tests/engine.test.js` holds known answers for each shared definition
(WALT, whole-month debt service, net effective rent, break-even, comp rules)
and checks that every screen and workbook gives the same figure.
`tests/money.test.js` checks the cents and four-decimal rounding and its log.

`tests/finance.test.js` checks the deal arithmetic against figures worked out
independently (debt service, balances, DSCR, debt yield, cash-on-cash, loan
sizing, break-even occupancy, WALT, net effective rent, IRR, equity multiple,
the price for a target IRR) and that junk inputs never produce NaN or Infinity.

`tests/e2e/a11y-flow.mjs` runs axe-core's WCAG 2.0/2.1/2.2 A and AA rules on
every screen, light and dark, and checks keyboard focus, 24 px targets and
reflow at 320 px. It is part of `run.sh`.

`tests/e2e/run.sh` drives the app in an iPhone-sized Chromium page: comps,
a template, three OM layouts, bad files, the rent roll workspace, the template
library, the Tools screen, the AI features (against stand-in services), Home,
the live what-if, photos and voice
notes, two deals side by side, reloads mid-edit, offline use, and a full
broker walk-through. It then recalculates every exported workbook in
LibreOffice and checks each formula against the value stored beside it. It
needs Playwright, Python (reportlab, Pillow, openpyxl) and LibreOffice, so it
is not part of `npm test`.

Each release bumps the version in `package.json`, `package-lock.json`,
`app/exporters.js` and `sw.js` together (`npm test` fails otherwise). That is
what makes every installed copy download the new release whole.

Tests run on invented documents (`tests/fixtures.js`, `tests/om-fixtures.js`);
real reports and OMs are licensed or confidential and stay out of the repository
(`.gitignore` excludes every `.pdf` and `.xlsx`).

```
index.html            the page shell and start-up checks
app/styles.css        the design system: colour, type and spacing tokens for
                      light and dark, components, layouts, print
app/theme.js          light, dark or system appearance, kept on the device
app/brand.js          the product name, tagline, and the move from the old name
                      (settings keys, file formats)
app/command.js        search or jump (⌘K / Ctrl K / "/")
app/settings.js       the Settings screen
app/ui.js             the shell (navigation, sheets) and the Comps screen
app/kit.js            shared helpers: numbers, formatting, toasts, sheets, files
app/dealui.js         Deals: the list and the deal workspace
app/om.js             reading figures and the rent roll out of an OM
app/deal.js           deal maths, checks and questions
app/engine/           one function per figure: WALT, debt service, net
                      effective rent, break-even, comp rules, money
                      rounding, and the calculation conventions
app/brief.js          the one-page deal brief and the text summary
app/lease.js          the lease engine: dated rent periods, projection, validation
app/rentroll.js       rent roll columns, presets and layouts
app/rentrollui.js     the rent roll workspace and lease schedule
app/rrbook.js         Rent Roll, Lease Schedule and Cash Flow workbook tabs
app/toolsui.js        the Tools screen
app/toolsdefs.js      the Tools calculators' inputs and results
app/tools.js          the first calculators
app/calc.js           the Tools maths: DCF, debt, returns, waterfall, leasing, development
app/template.js       filling your own Excel template in place
app/dealfields.js     the deal fields a template can take, with their sources
app/library.js        the template library on the device
app/home.js           the Home screen and the pipeline report
app/pipeline.js       stages, task due dates, what needs attention (pure)
app/crm.js            tasks, contacts and the activity log on the device
app/backup.js         the backup file: encoding, reading, the restore plan (pure)
app/backupui.js       Your data: storage, backup, restore
app/dealcrm.js        a deal's Pipeline card: stage, next steps, people
app/reconcile.js      checking quoted passages, grouping readings, rent roll against the OM
app/ai.js             talking to the AI server
app/aifacts.js        the deal as numbered facts for the assistant
app/aiui.js           AI settings, document review, the assistant, transcripts and notes
server/               the optional AI server (see server/README.md)
app/libraryui.js      the template library, mapping and preview screens
app/costar.js         CoStar parsing and the comp-set rules
app/layout.js         rebuilds column-preserving text from positioned glyphs
app/pdftext.js        pdf.js to page text
app/workbook.js       the workbooks
app/charts.js         native Excel charts (DrawingML)
app/package.js        final pass over the .xlsx package
app/stats.js          the arithmetic behind every formula
app/glance.js         the on-screen headline figures and charts
app/exporters.js      CSV and the printable comp sheet
app/store.js          keeping work, deals and the template on the device
app/zoning.js         DC max-FAR table and Montgomery County zone names
app/sample.js         the invented example set
sw.js                 offline cache
vendor/, fonts/       bundled dependencies (see VENDOR.md)
```

## How it was checked

`docs/ACCEPTANCE.md` lists every requirement of the 3.2 work with its status
(implemented and tested, incompletely tested, partial, blocked, not
implemented) and what was and was not tested.

- **Against the Python loader** it was ported from, over 47 CoStar reports in
  seven comp sets; 3.0's parser output is identical to 2.1's.
- **Every XML part of every workbook validates** against the ISO/IEC 29500
  schemas. A filled template gains no schema errors its original did not have.
- **Every formula recalculates** in LibreOffice with no errors, and every stored
  value agrees with the recalculated one, including the Deal Analysis and Rent
  Roll tabs.
- **The OM reader** is tested on three layouts: a label-and-value summary with a
  highlights page and a two-line rent roll header, a single-tenant net-lease
  summary, and a prose OM with an Actual / Pro Forma statement.
- **In a real browser**, served from a subfolder as GitHub Pages serves it, at
  iPhone and desktop sizes, light and dark, online and with the network off.

## Limits

- Scanned PDFs with no text layer can't be read (that needs OCR; see below).
- Voice notes are transcribed only through the AI server, when set up.
- Hold-period returns, the DCF and the waterfall are annual models with
  end-of-year cash flows and no tax. NOI grows at one rate unless the rent roll
  projection is used; the sale is priced on the following year's NOI.
- The waterfall has no catch-up or clawback; the commission tool uses the
  rates you enter, not a schedule of its own.
- The comp set check has no distances: CoStar comps here carry no coordinates.
- OM layouts vary without limit; the reader shows its sources so you can check it.
- CoStar lease reports are not parsed; the Lease Comps tab is filled by hand.
- Zoning covers the District of Columbia table and Montgomery County zone names.
- Needs iOS 16.4 or later, or a current Chrome, Edge, Firefox or Safari.

## AI features (optional, need a server)

The app itself sends nothing anywhere. Three features need a language or
speech model, and so a server that holds the API keys: `server/` in this
repository (see `server/README.md`). With it running, a broker turns AI on
under **AI settings** (Settings, or a deal's ⋯ menu) with the server's address and an access
token from the firm. Each send is confirmed first.

- **Read documents with AI** (Deal → ⋯): an OM, rent roll, operating
  statement or lease, as PDF or text. Every figure comes back with the passage
  it was read from, and the app checks that passage against the document's
  own text before showing it: *passage checked*, *found on another page*,
  *figure not in the passage*, or *passage not in the document* (which can't be
  applied). Documents that disagree are shown side by side. Nothing changes
  until the broker ticks figures and taps Apply; a figure the deal already had
  from the OM keeps its source, with the AI reading noted as a confirmation,
  and a replaced figure stays one tap away as an earlier reading. Applied
  figures are tagged *AI p.N*.
- **Ask about this deal**: answers from the deal's own figures, rent roll,
  scenario and comps, sent as numbered facts with their sources; each answer
  lists the facts it used and says what the deal doesn't contain. Answers that
  cite a fact that doesn't exist are flagged.
- **Transcribe** a voice note (Site visit): the transcript comes back with
  timings to check against the recording and correct, then **Make notes**
  gives a summary, decisions, action items, questions to confirm, and figures
  mentioned, each with the words that support it. Figures said aloud start
  unticked and are marked approximate or hearsay where the speaker was.

The rent roll is also checked against the OM without any AI (occupancy,
total SF, rent against gross potential rent, unit count), on the Overview's
rent roll card.

**Scanned OMs** with no text layer still can't be read by the app itself. AI
reading accepts them (the model reads the page images), but its passages
can't be checked against a text layer, so they show as unchecked.

## Security and privacy

- **On the device.** Deals, comps, templates, tasks and contacts are kept in
  this browser's storage on this device. Nothing is uploaded unless the AI
  features are on and a send is confirmed. A backup file holds all of it:
  treat it like the OMs it came from.
- **No secrets in the page.** The app holds no API key. AI keys live only on
  the firm's AI server (`server/`), which checks an access token and the
  calling site, limits each client to 20 AI requests a minute, never passes
  upstream error bodies on, and logs no documents, questions or answers. The
  access token is kept on the device and never written into a backup.
- **What the page may do.** A Content-Security-Policy forbids plugins, a
  changed base URL and form posts; no referrer is sent. User text is always
  set as text, never as HTML. GitHub Pages cannot send headers, so the policy
  does not restrict scripts; a host that can should add
  `script-src 'self'` plus the hashes of the three small inline start-up
  scripts in `index.html`, and `frame-ancestors 'none'`.
- **Dependencies.** The app bundles its libraries in `vendor/` (see
  VENDOR.md); the AI server has one, the official Anthropic SDK. `npm audit`
  reports no known vulnerabilities in either.

## Licence

MIT; see `LICENSE`. Bundled dependencies keep their own licences; see `VENDOR.md`.
