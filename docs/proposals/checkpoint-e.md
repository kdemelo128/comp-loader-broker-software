# Checkpoint (e): the dependency map, "what does this change affect": design for approval

Status: **approved 2026-10-10**, all four decisions as recommended, in two
pull requests. Part 1, `analyze()` split into registered formulas with no
change to any result, is built in 4.3.2 (618 deals identical to the last
digit, speed unchanged within noise). Part 2, the map, the Affects screens and
their tests, is built in 4.4.0, with two changes from this design:
"What this column affects" is in the rent roll's ⋯ menu ("What a column
affects…", then the column) rather than on each column heading, which only
sorts; and a read that matters only sometimes outside the analysis (a lease's
SF sets its rent only when the rent is quoted per SF) carries a test the map
applies, so "on this deal, now" is right there too. Original status: proposal, written 2026-10-10
against 4.3.1.
Timings below were measured in this container (Node, the 500-lease deal from
`perf-flow`, 10-year projection) unless marked as an estimate.

## 1. What it shows

Pick any input on a deal and you get one list, **"Changing <input> affects"**,
in five groups:

| Group | Example (changing the loan rate) |
|---|---|
| **Figures** on this deal | Debt service, DSCR, cash flow, cash-on-cash, break-even occupancy, max loan (its DSCR test) |
| **Checks and questions** | "DSCR below 1.25x" (it may appear or disappear) |
| **Scenarios** | What-if, and each saved scenario by name. A scenario that sets its own rate is listed as "not affected: Downside sets its own rate" |
| **Exports** | Deal workbook › Deal Analysis, the Debt service and DSCR rows (by cell); each firm template that maps one of those figures, by cell (e.g. "IC model › Inputs!B14", a made-up example), with how many of that workbook's own formulas read the cell |
| **Documents** | The deal brief (Financing section) and Copy summary |

Two refinements make the list honest rather than long:

- **On this deal, now.** The list shows only what moves for this deal as it
  stands. Example: with a price and an NOI entered, the stated cap rate doesn't
  change the price. A collapsed line, "Could also affect, in other
  circumstances (3)", lists the rest, each with its condition: "Price, only when
  no price is entered".
- **Try a value (optional).** Type a trial value and each line shows
  before → after, without saving. Lines that don't change move to "Unchanged
  with this value".

**One lease works the same way.** Its row figures are in-place rent, $/SF,
years left and loss to lease. The rent-roll totals it feeds are listed **by
field**. A lease's SF affects occupancy, total SF, average rent per SF and WALT
by area, but not in-place rent. Its tenant name affects only the concentration
table and the exports that print it. The list also covers projected NOI by
year, the deal occupancy (only when the OM gives none), scenarios using the
rent-roll NOI, the rent roll workbook, and the deal workbook.

The same graph gives the reverse direction for free: **"Worked out from"** on
any figure, e.g. DSCR ← NOI, debt service ← loan, rate, amortization. That is
the first piece of "Explain this number". See decision 4.

**Out of scope:**
- The Tools screen's stand-alone calculators. They don't read deal data.
  "Apply from Tools" writes deal inputs, which the map does cover.
- The comp set is one input ("the comps"), not comp by comp.

## 2. How the map is built: from the engine, enforced by tests

I don't recommend a separate hand-written list. Nothing would stop it going
stale.

**Formulas declare their inputs where they are written:**

- **Deal analysis.** `analyze()` (about 45 figures in one function today) is
  split into registered formulas in a new `app/engine/graph.js`:
  ```js
  formula('dscr', { label: 'DSCR', unit: 'x', reads: ['noi', 'debtService'] }, ({ noi, debtService }) => div(noi, debtService));
  formula('price', { label: 'Price', unit: '$', reads: ['in.price', { path: 'in.noi', when: 'only when no price is entered' }, { path: 'in.cap', when: '…' }] }, …);
  ```
  - `analyze()` keeps its name and its result. It becomes "evaluate the
    registered formulas in order", so every screen, export and test that calls
    it is unchanged.
  - The arithmetic moves without being changed. The golden outputs
    (`tests/tools/golden.mjs`) for every figure on every fixture must match
    exactly before and after.
- **Checks and questions, scenarios.** Each check, and `scenarioBase`, are
  registered the same way. A saved scenario reads each base value unless it
  overrides it, so "Downside sets its own rate" falls out of the data.
- **The rent roll and its projection.** These stay as they are: loops over
  every lease, already tuned in (c). Each output is registered with the lease
  fields and settings it reads, e.g.
  `rr.occupancy ← leases[*].sf, .vacant, .periods`.
- **Exports and documents.** These are registered too:
  - each deal workbook row records the figure it prints, e.g.
    `out(r, 'DSCR', …, { figure: 'dscr' })`;
  - the rent roll workbook sheets, the brief's sections, Copy summary, and the
    firm-template fields (`DEAL_FIELDS`) are registered;
  - a firm template's cells come from its own mapping.

**Why it can't drift.** The tests enforce the declarations in four ways:

1. **Strict reads.** In the tests, every registered formula, check, template
   field and export receives its inputs through a guard. Reading anything it
   didn't declare throws, naming the formula and the input. A formula can't
   quietly start using an input the map doesn't know about.
2. **Everything is registered.** The test fills a fixture deal with every
   input, a rent roll, a loan, comps, the What-if and two saved scenarios. It
   then fails on:
   - any key that `analyze()`, `rentRollSummary()`, `projectionSummary()`,
     `runScenario()` or `holdReturns()` returns that isn't in the map. For
     example: "analyze() returns `m.foo`, which the map doesn't know.
     Register it in app/engine/graph.js." **This is the "added a calculation
     and forgot to register it" test.**
   - any sheet a built workbook contains that isn't registered;
   - any `deliver()` or `printed()` call (the two ways the app hands over a
     file or a printout) that doesn't name its map entry. This is a repo test,
     like the existing check on the service-worker asset list.
3. **Behaviour agrees with the map.**
   - On the fixture deals plus 200 random deals, change each input in turn,
     recompute everything, and compare.
   - Every figure, check, scenario result, workbook cell and template value
     that actually changed must be in that input's list. Otherwise the test
     fails: "changing loan.closing moved Equity, but the map doesn't say so".
   - The reverse also holds: every declared input must move its formula in at
     least one case, so the map doesn't list things that never happen.
   - Leases are covered field by field on a small rent roll of 12 leases.
4. **No orphans, no cycles.**
   - Every deal input is either read by something or listed as "not used in
     any calculation or export" (e.g. the deal's private notes), so a new input can't be
     silently ignored.
   - A cycle is refused when the map is built, naming the loop; a test
     registers one on purpose.

## 3. Where it appears in the app

1. **Every input on the deal screen** gets an "Affects" action next to its
   source tag. Its accessible name is "What changing NOI affects". It opens the
   list as a sheet: bottom sheet on a phone, side sheet on a desktop.
2. **The rent roll:**
   - a lease's ⋯ menu has "What this lease affects";
   - a column header's menu has "What this column affects" (all leases);
   - the Assumptions panel's fields have "Affects" as on the deal screen.
3. **What-if inputs:** the same "Affects" action, limited to scenario figures.
4. **History.** Each entry gets "What it changed": the map applied to the
   entry's recorded paths, so "Annual rent, unit 1003" shows what that edit
   moved.
5. **Command palette (Ctrl/Cmd K):** "What does … affect?", then pick an
   input.

On every figure, the same sheet has a "Worked out from" tab (decision 4).

## 4. How it is tested

- **Unit tests:** the four guarantees in §2.
- **Golden outputs:** the split-up `analyze()` gives identical figures on
  every fixture (zero differences), and the LibreOffice recalculation of every
  exported workbook still matches.
- **A browser flow, `impact-flow` (fails on 4.3.1, which has no map):**
  - the cap rate's list on the retail fixture, with the "only when no price"
    line collapsed;
  - try a loan rate and check that DSCR shows before → after, and nothing is
    saved (History unchanged);
  - one lease's list on the 500-lease deal;
  - History's "What it changed";
  - the palette command;
  - axe (accessibility) checks on the sheet, phone and desktop.
- **The full browser suite,** and `perf-flow` (below).

## 5. What it costs in speed on the 500-lease deal

Measured today, at full speed:

| Step | Time |
|---|---|
| `analyze()`, the whole deal | 0.6 ms |
| rent roll summary | 1.1 ms |
| a scenario | 0.4 ms |
| the projection (already in the worker) | about 80 ms |

**Editing: nothing added.** The map is consulted only when someone opens a
list, so the 150 ms edit budget is untouched. `perf-flow` keeps checking it.

**The split-up `analyze()`:**
- The goal is to stay within 10% of 0.6 ms. I'll measure it before going
  further, and stop and tell you if it's slower.
- The strict-read guard runs only in the tests, not in the app.

**Opening a list** (estimates, to be measured in `impact-flow`):
- for a deal input: under 2 ms, plus 0.4 ms per saved scenario;
- with a trial value: the same again.

**Trying a value on a lease or a rent-roll setting:**
- This needs one projection: about 70 to 80 ms at full speed, and about 330 ms
  with the CPU slowed 4×.
- It runs in the worker. The list appears at once, and the numbers fill in
  when ready.
- Working out "what moves" by re-running the projection once per lease would
  take about 40 s on 500 leases. That is why leases use the declared map, not
  trial runs.

**Firm templates:**
- Counting a template's own formulas that read a mapped cell reuses the
  existing formula scan. A large firm workbook could make that slow.
- If it takes over 50 ms, the count loads after the list.

**Startup:** one new module of about 10 to 15 KB. The map is built once when
the app starts (estimated under 1 ms).

## 6. Decisions for you

1. **Split `analyze()` into registered formulas** (recommended), rather than
   keeping it whole and maintaining a separate table checked only by the
   behaviour test. Splitting means the declaration sits next to the formula
   and can't be skipped. It also starts the "results carry their inputs and
   formula id" item from the brief. The cost is a larger, purely structural
   change, guarded by zero-difference golden outputs.
2. **Detail in exports:** row by row for the deal workbook's Deal Analysis
   sheet; sheet by sheet for the rent roll workbook (Rent Roll, Lease
   Schedule, Cash Flow); cell by cell for firm templates. (Recommended.)
3. **"Try a value"**, before → after without saving: include it in (e)?
   (Recommended. It is what lets you check the list against the numbers.)
4. **"Worked out from"** (the reverse direction) on the same sheet: include it
   in (e)? (Recommended. It is small once the map exists. A full "Explain this
   number" panel stays for later.)

Version: 4.4.0. One PR, unless the `analyze()` split turns out large enough
to review on its own. In that case: the split first, with zero golden
differences, then the map and screens.

## 7. Phase 1 after (e): what is still open

| Item | State today | Recommendation |
|---|---|---|
| Typed deal model with unit types (JSDoc checked by `tsc --checkJs`, decided D-A) | Not started | **Phase 1, next after (e)**, for the engine, the deal model and the map. Phase 2 adds many money, area and period fields (T-12 lines, statements); unit mix-ups ($/SF/yr vs /mo, % vs points) are cheapest to stop before that. The map's declared units seed the types. No runtime change. |
| Migration registry (Phase 1 item 7 in the approved plan) | Not started; four one-off migrations exist (rename, money rounding, rent roll schema 2, database and backup v2) | **Phase 1**, small. Phase 2 changes the deal's shape; old-backup fixtures (3.3.0, 4.2.1) already exist to test it. |
| Navigation and design system | Mostly done (tokens, light/dark/system, shell, 5 workspaces, axe in both themes). Missing: status bar, `?` shortcut sheet, breadcrumbs | `?` shortcut sheet in Phase 1 (small; there are now Ctrl K, Ctrl Z, Shift Ctrl Z). **Status bar and breadcrumbs later**, with the workspaces they describe. |
| Command palette | Done (Ctrl/Cmd K, `shell-flow`). Comps, notes and documents not indexed | **Later**, with global search. |
| Review Queue skeleton | Not started; review happens per feature (AI review sheet, template preview) | **Move to the start of Phase 2.** Today it would hold two sources that already have their own screens; its real sources (statement normalization, OM Forensics findings, document conflicts) arrive in Phase 2, and the brief keeps empty workspaces out of the navigation. |
