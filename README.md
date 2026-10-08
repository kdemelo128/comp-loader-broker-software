# Comp Loader

A broker's field kit that runs in the browser and installs on an iPhone like an
app. Three tabs:

- **Comps** turns CoStar comp reports into a checked comp set and an Excel
  workbook (the built-in one, or **your own template**, filled in place).
- **Deal** reads an **offering memorandum** on the spot: the key figures with the
  page each came from, what doesn't add up, where it sits against your comps, a
  loan run, a **live what-if** with hold-period returns, the questions to ask,
  and site-visit notes, photos and voice notes.
- **Tools** holds the calculators a deal needs between meetings: quick value,
  loan sizing, offer and seller net, net effective rent, 1031 deadlines, WALT
  and a converter.

Everything is read on the device. PDFs and workbooks are never uploaded, the
page makes no request to any other site, and once it has loaded it works with
no connection at all.

© 2026 Kyle Alexander De Melo. MIT License.

## Comps

1. Drop in CoStar comp report PDFs, or choose them. More can be added at any time.
2. Review the comps. Every figure is editable (type `5.2m`, `850k` or `6.25%` as
   you would say them). Search, sort, include or set aside one comp or all of
   them, open ⓘ for everything on a comp, and ⇄ to move one between Sales and On
   Market.
3. Optionally fill in the subject property, or send it from the Deal tab.
4. **Excel** downloads the workbook. **⋯** has the rest: share, the one-page comp
   sheet, CSV for a CRM or Google My Maps, copy the table, and project files.

### Your own Excel template

Under **Excel output**, choose **My template** and upload the .xlsx your firm
uses. Comp Loader finds the row of column headings on each sheet, matches each
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

The template is kept on the device. Switch back to **Comp Loader workbook** at
any time.

## Deal: reading an offering memorandum

On the Deal tab, **Choose OM** and pick the PDF (from Mail, Files or a
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

Then: **Excel** (a Deal Analysis tab and a Rent Roll tab, every result a live
formula), **Share** (a five-line summary), **Deal brief** (print or save as
PDF, with photos and any scenarios, labelled as assumptions), or **Use as the
comps subject**. Deals are saved on the device; **All deals** lists them, and
**Try a fictional example deal** shows the screen with invented figures.

An OM that is a scan, with no text in it, can't be read: enter the figures by
hand and everything else works the same. OMs have no standard layout, so check
the figures against the page tags before relying on them.

## On a phone

**iPhone:** open the site in Safari, tap **Share → Add to Home Screen**. It then
opens full screen and works offline. Files arrive through the share sheet, so
they can go straight to Mail, Outlook, Teams or Files. Needs iOS 16.4 or later.

**Android:** Chrome offers **Install app** (or ⋮ → Install app).

## The comp workbook

| Tab | What it is for |
|---|---|
| **Summary** | The subject panel; survey statistics for sales and listings; a market read; four indicated values with a concluded range; a pricing matrix |
| **Deal Analysis**, **Rent Roll** | With a deal open on the Deal tab: the offering, pricing, financing, loan sizing, a cap-rate ladder, the comps comparison, and the rent roll with live WALT |
| **Charts** | Native Excel charts that read live cells |
| **Sale Comps**, **On Market Comps** | The comp grids, high to low $/SF, with parties, terms, brokers, flags and notes |
| **Adjustment Grid** | The sales-comparison approach in appraisal order, with lender-guideline shading |
| **Lease Comps** | A structured sheet to fill in by hand, with net effective rent |
| **Zoning Catalogue** | Max FAR by District of Columbia code, plus Montgomery County zones |
| **Audit Trail**, **CoStar Notes** | Where each comp came from, every flag and hand edit, and the full notes |

Every figure is a live formula with its value stored beside it, so the file
shows numbers in Outlook's preview and Protected View and still recalculates.

### Judgements it makes, and says it made

- Unpriced listings are kept but never score as $0/SF.
- Weighted $/SF is total price over total size, not an average of ratios.
- Market conditions start at 0% unless the comps' own $/SF-over-time line is
  reliable (five or more sales, R² 0.5 or better, within ±10% a year).
- A zoning code it does not know leaves buildable SF blank rather than guessing.
- Comps past fifteen are set aside, not dropped.
- On the Deal tab, a figure worked out from others is labelled "derived", and a
  figure you typed over is labelled "edited", with the OM's own value one tap away.

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
   `Comp Loader 3.1`, click **Commit to main**, then **Push origin**.
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
npm test      # parser, OM reader, deal maths, known-answer finance, tools, template, workbook, exports, repository
```

`tests/finance.test.js` checks the deal arithmetic against figures worked out
independently (debt service, balances, DSCR, debt yield, cash-on-cash, loan
sizing, break-even occupancy, WALT, net effective rent, IRR, equity multiple,
the price for a target IRR) and that junk inputs never produce NaN or Infinity.

`tests/e2e/run.sh` drives the app in an iPhone-sized Chromium page: comps,
a template, three OM layouts, bad files, the live what-if, photos and voice
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
index.html            the page, design tokens, styles, start-up checks
app/ui.js             the shell (tabs, sheets) and the Comps screen
app/kit.js            shared helpers: numbers, formatting, toasts, sheets, files
app/dealui.js         the Deal screen
app/om.js             reading figures and the rent roll out of an OM
app/deal.js           deal maths, checks and questions
app/brief.js          the one-page deal brief and the text summary
app/toolsui.js        the Tools screen
app/tools.js          the calculators
app/template.js       filling your own Excel template in place
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
- Voice notes are stored, not transcribed.
- Hold-period returns are a simple annual model: NOI grows at one rate, the
  sale is priced on the following year's NOI, no capital reserves, no tax.
- OM layouts vary without limit; the reader shows its sources so you can check it.
- CoStar lease reports are not parsed; the Lease Comps tab is filled by hand.
- Zoning covers the District of Columbia table and Montgomery County zone names.
- Needs iOS 16.4 or later, or a current Chrome, Edge, Firefox or Safari.

## What would need a server

The app is a static site: no keys, no backend, nothing leaves the device.
Three things people ask for need more than that:

- **Transcribing voice notes** and **AI reading of an OM** need a speech or
  language-model API. Its key must never sit in this page's JavaScript (anyone
  could copy it from a public GitHub Pages site). It would need a small server
  or serverless function that holds the key, receives the audio or text with
  the broker's consent, and returns the result, and the app would have to say
  plainly that the file leaves the device.
- **Scanned OMs** need OCR. Tesseract compiled to WebAssembly can run on the
  device (several MB to download, slow on a phone); a hosted OCR service would
  be faster but, again, sends the document off the device.

## Licence

MIT; see `LICENSE`. Bundled dependencies keep their own licences; see `VENDOR.md`.
