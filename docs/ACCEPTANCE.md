# Acceptance matrix — Comp Loader 3.2.0 (development branch)

Written for 3.2.0 on branch `claude/bold-archimedes-9a9r3p`, which was then
merged into `main` (pull request #2). The 3.3.0 redesign changes how screens
look and are reached, not what they do; see CHANGELOG.md.

Labels, as the directive defines them:

- **Implemented and tested**: works end to end, and an automated test
  exercises it with checked results.
- **Implemented, incompletely tested**: works, but part of it has not been
  exercised. The row says which part.
- **Partially implemented**: some of the requirement is built. The row says
  what is missing.
- **Blocked**: the rest needs something this environment doesn't have.
- **Not implemented**

## How it was tested

The results below come from tests that were run and checked. They were not
inferred.

- **Unit tests** (`npm test`, Node 22): 133 tests, all passing. They cover the
  lease engine (18), Tools maths (12), reconciliation (5), pipeline (6),
  backup (4), templates (7), finance, the parser, workbooks and the
  repository. Financial results are checked against figures worked out by hand
  or in independent Python loops.
- **Server tests** (`server/`, `npm test`): 11 tests, all passing. They use the
  real Anthropic SDK against a local stand-in for the API.
- **Browser workflows** (`tests/e2e/run.sh`): Chromium at iPhone and 320 px
  sizes. There are 19 flows, all passing, including:
  - rent roll (22 checks), templates (16), Tools (28)
  - AI (26), Home (32), backup (16), accessibility (24)
  - the 3.1.0 regression flows

  The script then recalculates every exported workbook in LibreOffice: 0
  errors and 0 stored-value mismatches.
- **Lint**: ESLint over the app, tests and server, with no findings.
- **`npm audit`**: 0 known vulnerabilities in the app and the server.

### What none of the tests used

- **Safari or a real iPhone**: only Chromium with an iPhone viewport and user
  agent.
- **Microsoft Excel**: workbooks were checked in LibreOffice and against the
  ISO schemas.
- **A live AI model or speech service**: there is no API key here. Every AI
  test uses stand-in services that return fixed answers, so they test the
  app's handling, not the model's quality.
- **A screen reader**: axe-core rules plus keyboard checks only.
- **Real brokerage documents**: all fixtures are synthetic, because real OMs
  are confidential.

## 3. Architecture and usability

| Requirement | Status | Notes |
|---|---|---|
| Unified navigation: Home, Comps, Deal (Overview / Rent roll / What if / Site visit), Tools | Implemented and tested | |
| Dashboard and pipeline | Implemented and tested | See section 9. |
| Search, sort, filter | Partially implemented | Exists for comps, rent roll, tools and contacts. There is no pipeline filter and no saved views beyond rent roll layouts. |
| Bulk actions | Partially implemented | Exists for comps (include or set aside all) and rent roll (clear with undo). |
| Responsive phone, tablet and desktop | Implemented, incompletely tested | Tested at 320, 390 and 412 px and on desktop. Real tablets and Safari were not tested. |
| Keyboard navigation and visible focus | Implemented and tested | `a11y-flow`: every control Tab reaches on Home shows a focus ring. The rent roll grid has arrow, Enter and Escape navigation (`rentroll-flow`). |
| Contrast, labels, 24 px targets, reflow | Implemented and tested | axe-core WCAG 2.0, 2.1 and 2.2 A/AA rules report no violations on every screen and the main sheets, in light and dark. Contrast, targets and labels were fixed in this release. |
| Screen-reader behaviour | Blocked | No VoiceOver or NVDA here. Only automated checks were run. |
| Undo for consequential edits | Implemented and tested | Covers deals, voice notes, photos, tasks, contacts, key dates, templates and clearing the rent roll. Restore asks twice before replacing everything. |
| Fictional sample property | Implemented and tested | Present since 3.1. |
| Consistent source labels | Implemented and tested | Every figure is labelled: OM page, typed, edited, derived, guess, AI page (checked or not), tool, scenario or rent roll. |

## 4. Rent roll and lease engine

| Requirement | Status | Notes |
|---|---|---|
| Property-type presets, configurable columns, custom fields, saved layouts | Implemented and tested | You can add, hide, rename, resize and reorder columns. |
| Units, tenants, SF, status, dates, options, deposits, arrears | Implemented and tested | |
| Current, market, annual, monthly and per-SF rents | Implemented and tested | |
| Dated rent periods: steps, fixed or % bumps, custom intervals | Implemented and tested | `lease.test.js` uses known answers worked out by hand. |
| Free rent and partial abatements with dates; mid-month proration; rent commencement separate from lease start | Implemented and tested | |
| Recoveries (pro rata, base year, stop, fixed), percentage rent, one-time items | Implemented and tested | |
| Renewal probability, downtime, market reset, lease-up | Implemented and tested | |
| Rent paid quarterly or on a custom schedule | Partially implemented | Rent accrues monthly. Escalations can be on any interval, but the payment timing itself is not modelled. |
| CPI-linked increases | Not implemented | |
| Early termination and lease extensions | Partially implemented | An extension can be entered as further periods. There is no termination modelling. |
| Validation: overlaps, gaps, bad dates, units, documented vs projected | Implemented and tested | |
| Timeline and an editable schedule | Implemented and tested | |
| Outputs: in-place rent, monthly and annual projection, expirations, concentration, loss to lease, NOI bridge | Implemented and tested | |
| Connected to What if, Tools DCF, the deal workbook and templates | Implemented and tested | Source figures are never overwritten by the projection. |
| Import from Excel or CSV with column mapping; export | Implemented and tested | |

## 5. Excel templates

| Requirement | Status | Notes |
|---|---|---|
| XLSX/XLSM upload, sheet inspection, cell, range, table and column mapping | Implemented and tested | |
| Legacy XLS/XLSB | Implemented and tested | Refused, with what to do instead. |
| Formulas, merges, hidden sheets, named ranges and formats preserved; macros kept byte for byte | Implemented and tested | Recalculated in LibreOffice; the VBA part is unchanged. |
| Suggestions with confidence, manual overrides, preview of every cell, dependency counts | Implemented and tested | |
| Cell audit sheet | Implemented and tested | |
| Recalculation | Implemented and tested | `fullCalcOnLoad` makes Excel recalculate on open; the app says so. Opening in Microsoft Excel itself was not tested. |
| Library: categories, versions, duplicate, archive, delete, export and import | Implemented and tested | |
| Firm-wide templates with permissions | Blocked | Needs a shared server with authentication. Today templates travel between people by export and import. |

## 6. Tools (30 calculators)

| Requirement | Status | Notes |
|---|---|---|
| Valuation: quick value, offer and net, DCF, NOI bridge, break-even, value sensitivity | Implemented and tested | |
| Debt: sizing, amortization, refinance, floating with a cap, maturity risk, fees | Implemented and tested | |
| Returns: hold with sponsor fees, IRR sensitivity, waterfall (rules stated), commission splits, 1031 | Implemented and tested | |
| Leasing: NER, compare, renewal vs replace, escalation, percentage rent, recoveries, absorption, WALT | Implemented and tested | |
| Development: residual land, yield on cost and spread, construction draws | Implemented and tested | |
| Comps: comp set check (quartiles, spread, recency, value range; no invented distance) | Implemented and tested | |
| Sale comp adjustment grid and normalization | Not implemented | |
| Comparable lease analysis and market-rent benchmarks | Not implemented | The Lease Comps tab is still filled by hand. |
| Bridge or construction loan as a full model | Partially implemented | Floating-rate stress and draws exist; there is no combined model. |
| Immediate recalculation, validation warnings, formula notes | Implemented and tested | Some tools have no formula note. |
| Saved scenarios (save, load, rename, duplicate, delete); Excel export; print | Implemented and tested | |
| Load from deal; write back after confirmation | Implemented and tested | Write-back exists for loan sizing, the NOI bridge and hold returns. Loading from a deal was browser-tested for loan, hold and NOI bridge. The other tools' loaders are checked only by unit-level logic. |
| Charts in tools | Not implemented | Results are shown as tables. |

## 7. AI documents and deal intelligence

| Requirement | Status | Notes |
|---|---|---|
| Server holding keys (`server/`); token, origin check, rate limit, no content logging | Implemented and tested | |
| AI extraction from PDF and text, each figure with its passage, page and period | Implemented, incompletely tested | Tested with stand-in answers. A live model run is blocked: there is no API key. |
| Deterministic check of each passage against the PDF's text | Implemented and tested | |
| Review: compare with the deal, show conflicts, apply only after ticking, keep the old value as an alternative, audit record | Implemented and tested | |
| Spreadsheets as AI input | Partially implemented | CSV and text only; save XLSX as CSV first. |
| Reconciliation: OM vs rent roll (occupancy, SF, rent, units); NOI vs price vs cap (existing checks); conflicts between documents | Implemented and tested | |
| Reconciliation against the underwriting model, comps and notes; pro forma vs history | Not implemented | |
| Conversational assistant over the deal's facts with citations | Implemented, incompletely tested | Live model run blocked. Answer quality is unverified. |

## 8. Audio and meeting intelligence

| Requirement | Status | Notes |
|---|---|---|
| Record or upload audio | Implemented and tested | Present since 3.1. |
| Transcription through any OpenAI-compatible speech service | Implemented, incompletely tested | Stand-in service only. A live provider is blocked by credentials. |
| Timestamps, review and correction of the transcript | Implemented and tested | |
| Notes: summary, decisions, action items, questions, figures with quotes and certainty | Implemented, incompletely tested | Stand-in model only. |
| Action items become tasks; summary in the deal brief, labelled as AI | Implemented and tested | |
| Speaker identification | Not implemented | Speakers are deliberately not claimed. |
| Transcript search; retention controls | Not implemented | Recordings and transcripts are deleted with the deal or the note. |

## 9. Pipeline and workspace

| Requirement | Status | Notes |
|---|---|---|
| Configurable stages (nine, renamable and hideable) and stage history | Implemented and tested | |
| Tasks with due dates, from a deal or from call notes | Implemented and tested | |
| Contacts with roles and companies, linked to deals | Implemented and tested | |
| Key dates and deadlines; dashboard of what needs attention | Implemented and tested | |
| Activity history, including deliverables | Implemented and tested | |
| Pipeline report (Excel, print) | Implemented and tested | |
| Company records separate from contacts; communication history | Not implemented | Company is a field on the contact. |
| Pipeline filtering and saved views | Not implemented | |
| Email, calendar and CRM integrations | Not implemented | Nothing is claimed. Each needs OAuth and per-provider work. |

## 10. Deliverables

| Requirement | Status | Notes |
|---|---|---|
| One-page deal brief (with scenarios, visit notes, AI summaries labelled) | Implemented and tested | |
| Comp sheet, deal workbook, rent roll workbook, template-based reports, Tools exports, pipeline report | Implemented and tested | |
| Buyer and seller proceeds | Implemented and tested | Offer and seller net tool, plus the hold returns tool. |
| Investment committee summary, scenario comparison report, marketing drafts | Not implemented | Templates can serve as an IC report, which is the user's own format. |
| Firm branding | Not implemented | |

## 11. Storage, reliability, security

| Requirement | Status | Notes |
|---|---|---|
| Saving and recovery; deal isolation | Implemented and tested | Present since 3.1. |
| Backup and restore of everything (merge, or replace with two confirmations) | Implemented and tested | |
| Storage use and eviction risk shown | Implemented, incompletely tested | Values depend on the browser. |
| Migration of earlier records | Implemented and tested | The rent roll migration (schema 2); stage defaults for older deals. |
| Protection of sensitive data | Partially implemented | No secrets are in the page, there is a CSP subset and no referrer, and the token is never backed up. Local data is not encrypted at rest beyond what the browser provides. A strict `script-src` CSP needs a host that sets headers. |
| Cross-device sync, authentication, organizational sharing | Not implemented | The data is device-local, and the README says so. The path is the AI server pattern plus a database and object storage. It is not built. |

## 12. Required real-world validation

| Item | Status |
|---|---|
| Safari on a real iPhone | Blocked (unavailable here) |
| Workbooks opened in Microsoft Excel | Blocked (LibreOffice used) |
| Real OMs, rent rolls and T-12s | Blocked (synthetic fixtures only) |
| Live AI and speech providers | Blocked (needs `ANTHROPIC_API_KEY`, `STT_URL` and `STT_API_KEY` on a deployed server) |

"Production-ready" is not claimed. The real-device, real-Excel,
live-provider and multi-user requirements above are open.
