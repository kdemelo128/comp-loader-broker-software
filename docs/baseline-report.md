# Zlatura Phase 0: baseline report

Audited 2026-10-10 in the Claude Code cloud container (Linux, Node 22.22,
headless Chromium via Playwright, LibreOffice). Every figure below comes from a
run or a code read in this audit; where something was not run, it says so.

## 1. Repository state

| Item | Finding |
|---|---|
| Latest work | `main` at the merge of pull request #3 (`65ab2d8`), version **3.3.0**: the 3.2.0 line (PR #2) plus the interface redesign (PR #3). The brief says "3.2.0 development line"; 3.3.0 is a superset of it, so nothing is missing. |
| Development branch | `claude/bold-archimedes-9a9r3p` at `8ddc4e9`, whose content is byte-identical to `main` (`git diff` is empty). Moving the branch pointer onto the merge commit was refused by this session's safety rules, so Phase 0 commits sit on `8ddc4e9`; a pull request from this branch shows only the new commits. |
| Working tree | Clean at the start of the audit. |
| Other branches | `main` only. |
| Deployment | GitHub Pages serves `main` (root folder). Whether the live site has picked up 3.3.0 was not checked from here. |
| CI | `.github/workflows/test.yml`: `npm ci && npm test`, then the server's tests, on push and pull request. The browser suite does not run in CI (it needs Chromium, Python with reportlab/openpyxl, and LibreOffice). |
| Build | None. Static ES modules served as files; the service worker caches a fixed asset list. No bundler, transpiler or type checker. |

## 2. Size and module boundaries

17,862 lines across `app/*.js`, `app/styles.css`, `index.html`, `sw.js` and
`server/*.mjs`. Largest modules: `dealui.js` 2,042 (the deal workspace),
`workbook.js` 1,501 (Excel writer), `ui.js` 1,474 (shell and Comps screen),
`styles.css` 1,124, `rentrollui.js` 1,101, `template.js` 935, `toolsui.js` 686,
`om.js` 672, `costar.js` 580, `lease.js` 564, `home.js` 515, `deal.js` 470,
`calc.js` 441.

Boundaries that already fit the brief: the math is in pure modules with no DOM
or storage (`deal.js`, `calc.js`, `tools.js`, `lease.js`, `rentroll.js`,
`stats.js`, `reconcile.js`); parsing is separate (`om.js`, `costar.js`,
`pdftext.js`); Excel output is separate (`workbook.js`, `rrbook.js`,
`template.js`). Boundaries that don't: UI modules (`dealui.js`, `ui.js`,
`glance.js`, `home.js`) still do some arithmetic inline (section 5).

Dependencies: the app ships three vendored libraries (pdf.js 4.7.76 legacy,
ExcelJS 4.4.0, fflate 0.8.3; `VENDOR.md`). Dev dependencies: `@xmldom/xmldom`,
`axe-core`, `exceljs`, `fflate`. The AI server depends on `@anthropic-ai/sdk`.
`npm audit`: **0 vulnerabilities** in both packages.

## 3. Test baseline (run in this audit)

| Suite | Result |
|---|---|
| `npm test` (unit) | 133 / 133 pass (3.0 s) |
| `server` tests | 11 / 11 pass |
| Browser suite (`tests/e2e/run.sh`, 20 flows) | All pass on `8ddc4e9` (run at the end of the 3.3.0 work): 0 failures; LibreOffice recalculation of 9 exported workbooks, 0 errors, 0 mismatches |
| Diagnostic scripts outside the suite | `om-flow` runs clean. `deal-export` crashed because it looked for a button named "One-page brief" (renamed "Deal brief"); label fixed in this phase, now runs clean. Neither asserts anything; they print output for inspection. |

What none of the tests use: Safari or Firefox (not installed here), Microsoft
Excel (LibreOffice only), real brokerage documents (all fixtures are synthetic),
live AI or speech services (stand-ins), screen readers.

## 4. Feature inventory

`docs/acceptance-matrix.md` lists every feature in the brief with its status.
In short: the rent roll and lease engine, Excel template filling, the 30 tools,
comps from CoStar PDFs, OM reading, What if scenarios, the AI review
architecture, Home and pipeline, backup and restore, and accessibility work
exist and are tested on synthetic fixtures. The typed model, Impact Graph,
event history, Mapping Studio's drift and reconciliation features, Document
Center, marketing deliverables, capital markets beyond loan math, buyer CRM,
diligence, live data providers, accounts and sync do not exist yet.

## 5. Calculation audit

A read of every formula module (`deal.js`, `calc.js`, `tools.js`, `lease.js`,
`stats.js`, `reconcile.js`, `glance.js`, `workbook.js`, `rrbook.js` and inline
arithmetic in UI modules). Items marked **verified** were re-read line by line
before being listed here.

### 5.1 Defects

| # | Finding | Evidence | Status |
|---|---|---|---|
| D1 | The lease comparison tool's **"Landlord PV"** was `NER discounted × SF × years`, a sum of level payments, not a present value, though the label and the tool's note say discounted. At 12% a year on $1,000 a month for 12 months it showed $12,000; the PV is $11,367.63. | `calc.js` `compareLeases` (verified) | **Fixed in Phase 0**, with a known-answer test computed independently (fails before, passes after). |
| D2 | **WALT can differ between the deal Overview and the Rent roll tab.** The Overview (`deal.js` `leaseStats`) measures from today and counts month-to-month leases as 0 years; the Rent roll tab and its workbook (`lease.js` `rentRollSummary`, `rrbook.js`) measure from the rent roll's as-of date. | Audit report; both functions exist as described | Open. Fix by making one function the source (Phase 1, engine consolidation). |
| D3 | **Two debt-service implementations** round the amortization term differently: `deal.js` uses `years × 12` as is, `calc.js` rounds to whole months. Identical for whole or half years; different for odd terms (27.4 years: $74,441.57 vs $74,423.71 a year on the audit's example). | `deal.js:15-24`, `calc.js:24-31` (verified) | Open, low impact. Consolidate. |
| D4 | **Net effective rent differs between the NER tool and the workbook's Lease Comps formulas**: the tool compounds escalations by month and deducts commissions; the workbook formula uses a linear average escalation and no commission. | `tools.js:74-99`, `workbook.js` Lease Comps formulas | Open. Pick one convention, write it into the convention registry, use it in both. |
| D5 | **Break-even occupancy** has two definitions: the deal's (expenses + debt service over gross income, scaled to the occupancy earned at) and the tool's (over GPR, subtracting other income). The tool is prefilled from the deal, so a user can see two numbers under one name. | `deal.js:183-189`, `calc.js:143-147` | Open. Name them differently or consolidate. |
| D6 | **Price derived from a negative NOI**: with a stated cap rate and a negative NOI, the deal analysis and Quick value derive a negative price. Other functions require NOI > 0. | `deal.js:146`, `tools.js:18` (verified) | Open, edge case. Block with a warning. |
| D7 | **Percent parsing in AI reconciliation** treats any value below 1 without a "%" as a fraction, so "0.5" becomes 50%. The app's own parser (`kit.js asPercent`) has the same rule for values strictly between 0 and 1, so it matters only for genuinely sub-1% figures typed without "%". | `reconcile.js:52` (verified) | Open, low. Needs the unit to be explicit (typed model). |
| D8 | **Different rules for which comps count**: positive-only in `deal.js`, truthy in `glance.js`/`ui.js`, any finite value in `stats.js`, so a $0 or blank comp can be included in one median and not another. Median age takes the upper middle value for an even count. | Audit report | Open, low. Consolidate into one comp-set function. |
| D9 | The loan sizing tool computes `equity = price − loan` (no closing costs) while the deal includes closing costs. The tool **does not display** this field, so it is latent. | `tools.js:42` (verified; no UI line shows it) | Open, latent. Remove or align. |

### 5.2 Conventions in use (to become the convention registry)

- Years are actual days ÷ 365.25 everywhere. Months are actual calendar days in
  the lease engine (day-weighted proration), but 30.44 or 30.4375 days in the
  comp and tool code.
- Debt: monthly compounding, payments shown annually. IRR and DCF: annual,
  end-of-year flows; exit priced on the following year's NOI. Leasing PVs:
  monthly, in advance.
- Percent stored as 6.25 (not 0.0625) in the engines; the workbook divides by
  100 when writing.
- WALT weighted by income (and by SF where shown).
- Money is IEEE double precision throughout; nothing is rounded to cents
  except at display; Excel exports carry live formulas without ROUND.
- Missing is `null` in the engines (never silently 0), with these exceptions:
  closing costs default to 0; vacant in-place rent is 0; `nz()` in `calc.js`
  treats a missing optional input as 0; some UI code drops 0 by truthiness.

### 5.3 Test independence

Most material formulas have tests whose expected values were worked out
independently (Excel PMT, hand-computed proration, IRR from a spreadsheet).
Some expected values come from the code itself: WALT, loan sizing via the
module's own loan constant, and the hold-with-fees round trip. Excel formulas
in the Deal Analysis, rent roll and Lease Comps tabs are checked for
self-consistency (LibreOffice recalculation equals the stored values), not
against the app's own numbers. That gap is how D2 and D4 went unnoticed.

## 6. Storage and data model

- **Stores:** IndexedDB `comp-loader` v2 with `session`, `deals` and `kv`
  (templates, tasks, contacts, activity, stages, AI settings, tool scenarios,
  rent roll layouts, comp output settings, last backup). Eight localStorage keys
  prefixed `comp-loader.` (theme, loan defaults, current deal, unsaved deal
  mirror, subject, unsaved comp session, iOS hint, tool inputs). Cache name
  `comp-loader-3.3.0`. File formats `comp-loader-backup` v1,
  `comp-loader-project` v1, `comp-loader-template` v1.
- **Deal shape:** one object holding figures, sources, the rent roll (legacy
  `rentRoll` rows plus `rr` leases and periods), loan, What if overrides,
  scenarios, targets, visit (photos and audio as blobs), stage history, key
  dates and AI extractions. `schema: 2` is set lazily by one rent roll
  migration; there is no migration registry.
- **Saves:** whole-deal last-write-wins, debounced 400 ms, with a synchronous
  localStorage mirror for crash recovery. CRM and library lists are rewritten
  whole on each change, with no coordination between browser tabs (two open
  tabs can lose an update). Store errors are swallowed in places, so a failed
  deal save is not always shown.
- **History:** stage history, a 500-entry activity log, the last 10 versions of
  each template, toast undos for deletions. No event log.
- **Missing values in storage:** cleared deal figures are deleted keys; lease
  numbers and dates are `null`, lease text is `''`. After a backup and restore,
  `undefined` and absent are indistinguishable.
- **Old name:** about 90 occurrences of "comp-loader" / "Comp Loader" across
  code, UI strings, manifest, server, docs and tests (inventory kept for the
  rename).

## 7. Performance (measured in this audit)

Headless Chromium at 1440 px in this container, wall time from Playwright
action to the screen showing the result (so includes a few ms of harness
overhead). Three runs, consistent to within about 10%.

| Measure | Result | Brief's budget |
|---|---|---|
| Import a 500-line rent roll CSV and show it | 2.3–4.2 s | — |
| Open the deal (Overview) after reload | 0.29–0.37 s | — |
| Open the 500-lease Rent roll tab | 1.9–2.1 s | under 1 s: **not met** |
| Edit one rent and see totals update | 1.7–1.9 s | under 150 ms: **not met** |
| Lease projection alone (Node, 500 leases, 10 years) | 874 ms | — |
| Rent roll summary / validation alone (Node) | 3.9 ms / 2.1 ms | — |
| Read a 121-page text OM (`errors-flow`) | 832 ms | progress shown, UI not blocked: pdf.js parses in a worker, but OM analysis and the projection run on the main thread |

The projection is the bottleneck, not rendering. It is pure, so it can be
optimized behind the existing known-answer tests and moved into a worker.

## 8. Security observations

- The AI server keeps the Anthropic and speech keys server-side; the browser
  holds only the server URL and an app token (in IndexedDB, excluded from
  backups). Token comparison is timing-safe; there is an origin allowlist.
- The server's rate limit is per socket address (behind a reverse proxy all
  users share one bucket) and counts only POSTs after the token check, so
  wrong-token attempts are not limited.
- GitHub Pages cannot set HTTP security headers; the page sets a CSP subset by
  meta tag and no referrer.
- Local data is unencrypted in the browser profile, which the README states.

## 9. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A large refactor (typed model, engine consolidation) changes a number silently | Medium | High | Known-answer tests first; golden outputs of every deal metric for the fixture deals captured before refactoring and compared after. |
| The rename loses local data (IndexedDB name change) | Medium | High | Copy-then-switch migration, old database kept until a backup is confirmed; restore test with a pre-rename backup. |
| Old installed copies keep serving the old service worker | Medium | Medium | New cache name; existing activate-step clean-up; update toast already exists. |
| Moving to cloud sync breaks the local-first guarantee | Medium | High | Sync as a layer on the event log; local export kept; decided in Phase 7 only. |
| Formula duplicates keep diverging (D2–D5, D8) | High until fixed | Medium | Single engine module; differential tests between engine and workbook formulas. |
| Performance budgets for large rent rolls | Certain today | Medium | Projection optimization and a worker in Phase 1. |
| Features claimed beyond what was tested | Medium | High | Acceptance matrix with the brief's statuses; evidence named per row. |
| Paid services (AI, data providers, hosting a backend) | n/a | Cost | Not added without the user's approval. |
| Multi-tab lost updates | Low | Medium | Event log with per-event writes; BroadcastChannel for change notices. |

## 10. Changes made in Phase 0

- D1 fixed (`calc.js`, `tools.js`), with a known-answer test.
- `tests/e2e/deal-export.mjs` label updated.
- Added this report, `docs/acceptance-matrix.md` and
  `docs/architecture/proposal.md`. No structural change, no rename, no new
  dependency.
