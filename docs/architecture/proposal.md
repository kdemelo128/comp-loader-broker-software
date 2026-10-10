# Zlatura architecture proposal and migration plan

Status: **approved by the user on 2026-10-10**, with these decisions:
D-A JSDoc types checked by `tsc --checkJs`, no build step, no switch to full
TypeScript. D-B typed and extracted money stored as whole cents, computed
figures in floating point; before shipping, a list of every place a displayed
cent value changes goes to the user for review. D-C Phase 1 in the order
below, stopping for review after each checkpoint: (a) rename and migration,
(b) one engine, fixing the disagreements (WALT: one definition, default the
Rent roll tab's method, method shown on screen, configurable; net effective
rent and break-even occupancy: recommend a definition and get approval before
changing, keeping both labelled where both are legitimate), (c) the
projection off the main thread with before/after measurements, (d) change
history, undo and snapshots, (e) the dependency map. A pull request per
checkpoint; nothing merged by Claude. D-E tagline "Every source. Every
assumption. Every number." D-F the repository name and Pages URL stay. The
seven further ideas (§6) are not to be built yet.

Progress: checkpoint (a) merged (4.0.0). Checkpoint (b) implemented in
4.1.0, in review (`docs/proposals/checkpoint-b-results.md`).

Original status line: **proposal, awaiting the user's go-ahead.** Nothing in sections 2–5 is
built. Read with `docs/baseline-report.md` (what exists) and
`docs/acceptance-matrix.md` (what the brief asks for and its status).

## 1. Constraints that shape every choice

1. **It is a static, offline-first PWA on GitHub Pages.** No build step today;
   the service worker caches a fixed list of files; everything works with no
   connection. Any architecture must keep that working, or the user must
   decide to change hosting.
2. **Numbers must not move by accident.** Every refactor of a formula is
   guarded by known-answer tests and by golden outputs of every metric on the
   fixture deals, captured before and compared after.
3. **Existing data must survive.** Deals, comp sessions, templates, tasks and
   contacts in people's browsers, and every backup file ever made, must keep
   loading.
4. **Small increments.** Each increment ships with tests and a full-suite run
   and leaves the app working.

## 2. Proposed architecture

### 2.1 Types without a build step (decision needed: D-A)

Write types as JSDoc in the existing `.js` files and check them with
`tsc --noEmit --checkJs` (TypeScript as a dev dependency only). The browser
keeps loading the same files; CI and `npm test` add a type check.

- Branded types: `Money`, `Percent` (6.25 means 6.25%), `PercentagePoints`,
  `Area<'GBA'|'RSF'|'USF'>`, `Acres`, `Rate<'month'|'year'>`, `IsoDate`.
  Mixing them is a type error in checked code, and a runtime validator guards
  every boundary where data enters (OM reader, CSV import, AI results, backup
  restore).
- Missing values become explicit: `{ state: 'unknown' }`,
  `{ state: 'not_applicable' }`, `{ state: 'confirmed_zero' }` at the data
  model's edges, while engines keep taking `number | null` internally.

The alternative is converting to TypeScript with a bundler. That gives
stronger checking but adds a build step, changes deployment, and touches every
file. Recommendation: JSDoc + `checkJs`, adopted module by module, starting
with the engine.

### 2.2 Money arithmetic (decision needed: D-B)

Options:

1. **Keep IEEE doubles, round only at presentation and export** (today), add
   property tests that sums reconcile within half a cent. Matches Excel, which
   is what firms reconcile against, so native and template numbers agree.
2. **Integer cents for stored money inputs** (prices, rents, expenses typed or
   extracted) and doubles for derived math (IRR, amortization, discounting),
   rounding derived money to cents only for display and export. Inputs can no
   longer pick up float noise; derived math still matches Excel.
3. **A decimal library for all money math.** Exact decimal sums, but IRR and
   compounding still need floating point, it adds a dependency and cost to
   every calculation, and results stop matching Excel to the last digit.

Recommendation: **option 2**. It can change displayed cents only where a
stored input had float noise; the golden-output comparison will list every
such change for review before it ships.

### 2.3 One calculation engine

Move all financial math into `app/engine/` (pure ES modules: `debt.js`,
`income.js`, `valuation.js`, `returns.js`, `leasing.js` (the lease engine),
`comps.js`, `conventions.js`). UI modules and `workbook.js` call the engine and
contain no arithmetic. The existing `deal.js`, `calc.js` and `tools.js` exports
become thin re-exports during the move, so nothing breaks mid-way.

Each material function returns
`{ value, unit, inputs, formulaId, conventions, warnings }`. "Explain this
number" panels are generated from that record, not from separate prose.

Defects D2–D9 in the baseline report are fixed during this move, each with a
known-answer test and a recorded decision on the convention.

**Convention registry** (`engine/conventions.js`): day count, month basis,
annualization, WALT basis (rent, SF), timing of flows (in advance or arrears),
exit NOI year, vacancy basis. Defaults are today's behaviour, so nothing
changes unless a user changes a setting. Each is visible on a Settings page
and recorded on every result that used it.

### 2.4 Impact Graph

A small dependency-graph module (`engine/graph.js`): nodes are inputs,
derived values, template cells, report fields and scenario overrides; edges
come from each formula's declared inputs. Each formula is registered once with
its inputs, so the graph is generated from the engine, not maintained by hand.

- Before a change is applied: "This change affects NOI, cap rate, DSCR, loan
  proceeds, *Firm model* B14 and B22."
- Recalculation evaluates only affected nodes.
- Cycles are refused at registration with the cycle named.

### 2.5 Event log, Time Machine and undo

A new IndexedDB store `events`, append-only, one record per material change:
`{ dealId, seq, at, actor, origin: 'user'|'import'|'ai'|'template'|'system', path, old, new, reason, source }`.
The deal record stays as the current snapshot, so reads stay fast; named
snapshots are copies of the deal at a sequence number.

- Undo/redo: walk the log.
- Time Machine: rebuild the deal at any sequence number; diff two snapshots.
- "What changed since I last opened this deal": events after the last-viewed
  sequence number.
- Writes become per-event, which also removes the multi-tab lost-update risk
  for deals. A `BroadcastChannel` tells other tabs to refresh.
- Photos and audio stay as blobs referenced by id; the log never copies them.

### 2.6 Schema migrations

A migration registry (`app/migrate.js`): an ordered list of
`{ from, to, up(deal) }` applied on open and on restore, each with a test using
a saved real backup from that version (backups made with 3.1, 3.2 and 3.3 will
be added as fixtures). The current lazy rent roll migration becomes migration 1→2.

### 2.7 Work off the main thread

The lease projection (874 ms for 500 leases today) and OM analysis move into a
module worker, with progress events. Targets: open a 500-lease rent roll in
under 1 s and update totals after an edit in under 150 ms, measured by a
performance test in the suite.

### 2.8 Extensibility

Formal contracts, each a plain object with a version:

- parser: `{ id, accepts(file), parse(file, onProgress) → candidates }`
- calculator: the existing `toolsdefs.js` shape, plus engine formula ids
- template adapter, exporter
- data provider: `{ id, fetch(series, asOf) → { value, asOf, source, status } }`

A REST API and webhooks need a server and are deferred to Phase 7.

### 2.9 Cloud workspaces (Phase 7, decision needed later: D-D)

Accounts, sync and shared templates need a hosted backend, which costs money
and changes where data lives. The event log (2.5) is designed to be the sync
unit, so the local-first app keeps working offline and syncs events when
connected. Options to decide in Phase 7: a managed backend (e.g. Supabase or
Firebase), the firm's own server extending `server/`, or staying device-only.
Nothing is built or bought before that decision.

## 3. Rename to Zlatura (Phase 1, increment 1)

| Item | Plan |
|---|---|
| UI strings, title, manifest, README, docs, package names, workbook "creator", audit sheet name | Replace "Comp Loader" with "Zlatura". The comps feature keeps the name "Comps". |
| IndexedDB `comp-loader` | Open `zlatura`; if it is empty and `comp-loader` exists, copy every store across, then mark the copy done. The old database is kept until the user makes a backup, or 30 days pass, then deleted. Reversible until then. |
| localStorage `comp-loader.*` (8 keys) | Copy to `zlatura.*` on first start; keep reading old keys as a fallback for one version. The inline theme script reads both. |
| Service worker cache | `zlatura-<version>`; the activate step already deletes other caches. |
| File formats | Write `zlatura-backup`, `zlatura-project`, `zlatura-template`; **read both old and new ids forever**. Tests restore a real pre-rename backup, project and template package. |
| Download names | "Zlatura backup <date>.json"; other export names don't carry the product name. |
| GitHub repository name and Pages URL | Unchanged unless the user renames the repository; changing the URL also changes the installed app's origin, which would strand local data. **Not recommended** without a migration step on the old URL. |
| Icons and logo | Original light and dark marks, favicon and app icons, designed in SVG and rasterized. |
| Tagline | Options for the user to choose (below); none hard-coded until chosen. |

Tagline options: "Underwrite with confidence." · "Every source. Every
assumption. Every number." · "The deal, with its receipts." · "Gold-standard
underwriting." · "Abundance, accounted for."

## 4. Phase plan (adjusted to the code as it is)

The brief's order is kept, with these adjustments:

- **Phase 1 (foundations):**
  1. rename and migration;
  2. engine consolidation with D2–D9 fixed and golden outputs;
  3. convention registry;
  4. worker for the projection, with the performance tests;
  5. event log, undo/redo and snapshots;
  6. Impact Graph and "Explain this number";
  7. migration registry;
  8. Review Queue shell, reading existing review items (AI extractions, unmapped template fields);
  9. JSDoc types on the engine and model.

  The nav grows only as workspaces become real.
- **Phase 2** starts with operating-statement normalization and the
  historical-vs-projected view, because OM Forensics, the NOI bridge and Pricing
  Guidance all need line-item history.
- **Phase 3 (Mapping Studio)** extends the existing template engine: more
  mapping signals, output read-back, drift detection, native-vs-template
  reconciliation. Recalculation in the product needs a spreadsheet engine; in
  the browser that means either shipping a formula engine (large) or doing it
  server-side with LibreOffice. To decide in Phase 3.
- Phases 4–8 as written in the brief. Live market data (Phase 4) and live AI
  (Phase 6) need provider choices and credentials from the user.

## 5. Decisions needed from the user

| Id | Decision | Recommendation |
|---|---|---|
| D-A | Types: JSDoc + `checkJs` (no build) vs TypeScript with a bundler | JSDoc + `checkJs` |
| D-B | Money arithmetic: doubles / integer-cent inputs / decimal library | Integer-cent inputs, doubles for derived math |
| D-C | Go-ahead for Phase 1 in the order above, starting with the rename | Yes |
| D-D | Cloud backend (Phase 7) | Decide in Phase 7 |
| D-E | Tagline | User's choice |
| D-F | Keep the GitHub Pages URL (repository name) | Keep |

## 6. Further ideas (not to be built without approval)

| Idea | Why it helps | Effort |
|---|---|---|
| **T-12 cleaner**: paste or drop a T-12 export, auto-detect months, subtotals and sign conventions, learn the firm's category mapping | The most repeated analyst chore; prerequisite for OM Forensics | M |
| **Seller's update diff**: when a revised OM or rent roll arrives, show exactly which figures changed and what that moves | Common in live marketing processes; reuses the event log | S–M |
| **Buyer call sheet from comps**: buyers of the deal's comps (from the user's own comp records) become a starting call list | Turns existing comp data into outreach | S |
| **"Numbers we sent" ledger**: every export records the figures it contained, so "what did we tell the client on this date" is one click | Pillar 5 for the cost of storing export manifests | S |
| **Lender package from the deal in one step** | Repetitive assembly work; reuses the brief, rent roll and T-12 | M |
| **Rate sheet pinning**: pin today's SOFR/Treasury values to a deal with date and source | Avoids remembered rates in models | S (with a provider) |
| **Interview checklist for intern calls**: the call script and outcome capture in Field Mode | Matches how listings are actually worked | S |
