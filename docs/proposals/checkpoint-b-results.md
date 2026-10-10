# Checkpoint (b): results

Status: **implemented on `claude/bold-archimedes-9a9r3p`, version 4.1.0,
awaiting review.** The definitions were approved on 2026-10-10 (see
`checkpoint-b.md`). This file records every figure that changed, which
known-answer tests failed on the old code, and one correction to the
proposal.

## 1. How the before/after was measured

`tests/tools/golden.mjs` runs the app's own modules on a fixed set of cases
and records every displayed figure, every exported workbook cell (value and
formula), and every tool result line. It was run twice:

- on a copy of the app at commit `0252cda` (4.0.0, before this change);
- on this branch.

`node tests/tools/golden.mjs --diff before.json after.json` lists every
difference. **653 figures compared; 72 changed.** All 72 are below: 53 where
the shown value or label changed (§2), and 19 where only the Excel formula
text changed and the value is the same (§3). The raw output is in
`checkpoint-b-golden-diff.md`.

The cases:

| Case | What it holds |
|---|---|
| `om_retail`, `om_netlease`, `om_multifamily` | The three fixture OMs as read, 65% LTV, 6.75%, 30 years |
| WALT case | Four suites as of 2026-06-30, viewed 2026-10-10: A $100,000/yr to 2031-06-30, B month to month at $50,000/yr, C $60,000/yr to 2028-06-30, D vacant |
| 27.4-year amortization | The retail OM with a 27.4-year amortization (328.8 months) |
| Negative NOI | NOI −$50,000, stated cap rate 6%, no price |
| Sub-cent values | The retail OM with values carrying parts of a cent: price $5,573,615.873421 (a solved "price for a 15% IRR" saved to the deal), NOI $393,449.996312 (a NOI bridge written back), operating expenses $135,750.004999, market rent $41.267839/SF, lease rents as $/SF/yr to full precision ($37.846153…). In the new code the deal goes through the money migration first, as a stored deal does. |
| Every tool at its example inputs | All 30 tools |
| Extra tool cases | Break-even with no GPR (gross income $529,200 at 91.7%); break-even with GPR; Quick value with negative NOI; NER with and without a 6% commission |
| WALT tool | Two leases, measured from 2026-10-10 |
| Comps | The CoStar fixture set, and the same set plus a typed comp with a $0 price on 5,000 SF |

## 2. Figures whose shown value or label changed (53)

### WALT: one definition (the Rent roll tab's), from the as-of date, month-to-month leases left out

| Case and figure | Before | After |
|---|---|---|
| WALT case · Overview tile: WALT | 2.7 yrs | 3.9 yrs |
| WALT case · Overview: WALT by SF | 2.7 yrs | 3.7 yrs |
| WALT tool (two leases) · WALT by income, 4 decimals | 3.5945 | 3.5958 |

The Rent roll tab already showed 3.9 years on the WALT case; it did not
change. The Overview now gives the same figure, labelled "by income", with the
full method on hover ("WALT by income, as of Jun 30, 2026; month-to-month
leases left out"). The WALT tool's change is in counting: it now counts whole
days from the date, as the Rent roll tab does, where it used to count from the
current time of day (here noon), half a day less.

### Debt service on whole months of amortization

Only when the amortization is not a whole number of months; whole and half
years are unchanged.

| Case and figure | Before | After |
|---|---|---|
| 27.4-year amortization · Annual debt service | $336,150 | $336,079 |
| 27.4-year amortization · Overview: largest loan it supports | $3,925,719 | $3,926,545 |
| 27.4-year amortization · Overview: cash flow after debt | $57,300 | $57,371 |
| 27.4-year amortization · What if: price for a 15% IRR | $5,569,533 | $5,569,562 |
| 27.4-year amortization · Deal workbook: annual debt service | 336,150.2585 | 336,079.4782 (formula gains `ROUND(B30*12,0)`) |
| 27.4-year amortization · Deal workbook: DSCR | 1.1705 | 1.1707 |
| 27.4-year amortization · Deal workbook: cash flow after debt service | 57,299.7415 | 57,370.5218 |
| 27.4-year amortization · Deal workbook: break-even occupancy | 0.8177 | 0.8176 |
| 27.4-year amortization · Deal workbook: loan at the minimum DSCR | 3,925,718.5343 | 3,926,545.3127 (formula gains `ROUND`) |
| 27.4-year amortization · Deal workbook: maximum loan | 3,925,718.5343 | 3,926,545.3127 |

### No price from a zero or negative NOI

| Case and figure | Before | After |
|---|---|---|
| Negative NOI · Purchase / asking price | −$833,333 | (not derived) |
| Negative NOI · Cap rate (NOI ÷ price) | 6% | (not derived) |
| Negative NOI · Price per SF | −$83.33 | (not derived) |
| Negative NOI · Overview: price | −$833,333 | — |
| Negative NOI · What if: price | −$833,333 | — |
| Negative NOI · What doesn't add up | (none) | The NOI is negative (−$50,000), so no price is worked out from the stated 6.00% cap rate. |
| Quick value tool (negative NOI) · Price | −$833,333 (NOI ÷ cap rate) | — |
| Quick value tool (negative NOI) · warning | (none) | The NOI is negative, so no price is worked out from the cap rate. |

### Money stored to whole cents (totals) and four decimals (rates)

Only the sub-cent case moves. The three OMs, the comp set and every tool
example are already whole cents, so nothing in them changed.

| Case and figure | Before | After | Why |
|---|---|---|---|
| Sub-cent values · NOI, year 1 (rent roll projection) | $342,712 | $342,713 | Rents per SF kept to 4 decimals and market rent $41.2678: the year sits on a rounding edge |
| Sub-cent values · Projection year 1: EGI / NOI | $478,462 · $342,712 | $478,463 · $342,713 | same |
| Sub-cent values · Projection year 3: EGI / NOI | $506,673 · $362,655 | $506,672 · $362,655 | same |
| Sub-cent values · Projection year 7: EGI / NOI | $516,439 · $354,347 | $516,439 · $354,346 | same |
| Sub-cent values · Projection year 8: EGI / NOI | $577,279 · $410,324 | $577,278 · $410,323 | same |
| Sub-cent values · Projection year 10: EGI / NOI | $637,424 · $460,301 | $637,423 · $460,300 | same |
| Sub-cent values · Deal workbook: loan amount | 3,622,850.3177 | 3,622,850.3155 | price $5,573,615.873421 → $5,573,615.87, × 65% |
| Sub-cent values · Deal workbook: annual debt service | 281,972.8584 | 281,972.8583 | follows the loan (formula gains `ROUND`) |
| Sub-cent values · Deal workbook: cash flow after debt service | 111,477.1379 | 111,477.1417 | NOI $393,449.996312 → $393,450 |
| Sub-cent values · Deal workbook: loan at the minimum DSCR | 4,044,106.8040 | 4,044,106.8419 | same (formula gains `ROUND`) |
| Sub-cent values · Deal workbook: maximum loan | 3,622,850.3177 | 3,622,850.3155 | follows the loan amount |

Every projected year moves by at most $1. On screen the workbook cells above
show whole dollars, which do not change.

### Net effective rent: one definition, both labelled variants

| Case and figure | Before | After |
|---|---|---|
| Comp workbook · Lease Comps example row NER (P4), both comp cases | $80.50 | $81.60 |
| NER tool (example) · Net effective rent, label | $39.86/SF (net rent spread evenly over the term) | $39.86/SF (net of free rent, TI and commissions, spread evenly over the term) |
| NER tool (no commission) · label | $81.60/SF (net rent spread evenly over the term) | $81.60/SF (net of free rent and TI, spread evenly over the term) |
| NER tool (with commission) · label | $76.45/SF (net rent spread evenly over the term) | $76.45/SF (net of free rent, TI and commissions, spread evenly over the term) |
| NER tool (example) · "Discounted net effective" → "Net effective rent, discounted" | $35.26/SF (level rent with the same value at 8.0%) | $35.26/SF (level rent with the same present value at 8.0%, net of free rent, TI and commissions) |
| NER tool (no commission) · same rename | $78.02/SF | $78.02/SF (… net of free rent and TI) |
| NER tool (with commission) · same rename | $70.56/SF | $70.56/SF (… net of free rent, TI and commissions) |

The tool's numbers did not change. The Lease Comps formula is now the closed
form of the tool's month-by-month sum. The tab has no commission column (as
decided), so its NER is net of free rent and TI, and its note says so.

### Break-even occupancy: one function, its basis named

| Case and figure | Before | After |
|---|---|---|
| Break-even tool (no GPR; gross income $529,200 at 91.7%) | — ("Enter potential rent and expenses") | **Break-even occupancy (est.) 80.1%**; cushion 19.9%; income needed $462,060; warning: "Estimated: no gross potential rent, so gross income is scaled up from the occupancy it was earned at." |

With GPR the tool and the deal give the same figure as before (78.6% on the
retail inputs). The tool gains two optional inputs, gross income and
occupancy, used only when GPR is blank.

### Comps count only with a price and SF above zero

| Case and figure | Before | After |
|---|---|---|
| Comps + a $0-price comp · weighted $/SF (deal, stats) | $595.97 | $772.77 |
| Comps + a $0-price comp · comp workbook Sale Comps L19 (SF, priced comps) | 21,855 | 16,855 (formula gains `>0` guards) |
| Comps + a $0-price comp · comp workbook Sale Comps M19 (weighted $/SF) | $595.97 | $772.77 |
| Comps + a $0-price comp · comp workbook Sale Comps P19 (land SF) | 28,772 | 17,882 (formula gains `>0` guards) |
| Comps + a $0-price comp · comp workbook Sale Comps R19 ($/land SF) | $452.70 | $728.39 (formula gains `>0` guards) |

$772.77 is the weighted $/SF of the CoStar set without the $0 comp, as it
should be. The comp-set check's median age is now the true median. That has
no golden case because the fixture set has an odd number of dated comps; the
known-answer test below covers it (9.99 → 8.00 months on two comps).

## 3. Excel formula text changed, value the same (19)

- **Deal workbook, every case:** "Annual debt service" and "Loan at the
  minimum DSCR" (10 cells, 5 cases). `PMT(B29/12,B30*12,…)` became
  `PMT(B29/12,ROUND(B30*12,0),…)`; for 30 years it gives the same result.
- **Comp workbook, Sale Comps summary row:** K19, L19, P19, R19, U19, V19 on
  the CoStar set (6 cells), and K19, U19, V19 on the set with a $0 comp (3
  cells). Each `SUMPRODUCT` gained `--(K>0)` and `--(L>0)` (or P, U)
  terms. Every comp in the fixture set has a price and SF, so the totals
  are the same.

## 4. Known-answer tests on the old code

`tests/engine.test.js` holds 11 known-answer tests. Every expected value was
worked out independently, by hand or in Python, not with the module under
test. The tests call the app's public functions, so the same file was run
against the 4.0.0 copy:

| # | Test | Old code | Old value vs expected |
|---|---|---|---|
| 1 | WALT from the as-of date, month-to-month left out (Overview) | **fails** | 2.952446 vs 3.875086 |
| 2 | WALT: the Overview and the Rent roll tab agree (Rent roll tab) | passes | the Rent roll tab already used this method |
| 3 | WALT tool, same definition from today | **fails** | 3.594456 vs 3.595825 |
| 4 | Debt service on whole months | **fails** | $336,150.26 vs $336,079.48 |
| 5 | No price from a zero or negative NOI | **fails** | price −$833,333 |
| 6 | Break-even: one definition, basis named | **fails** | no basis; no estimate without GPR |
| 7 | NER: tool and comp workbook agree | **fails** | Lease Comps example row $80.4969 vs $81.6041 |
| 8 | NER: a part month of free rent forgoes that part of the month | **fails** | $37.8183 vs $38.0281 |
| 9 | A comp counts only with price and SF above zero | **fails** | a $0 comp lowered the weighted $/SF |
| 10 | Median comp age is the true median | **fails** | 9.9877 vs 8.0000 months |
| 11 | Loan tool equity = price − loan, before closing costs | passes | unchanged behaviour (see §5) |

**9 of 11 fail on the old code and all 11 pass on the new.**
`tests/money.test.js` (5 tests) cannot load on the old code, because
`app/engine/money.js` did not exist.

Test 1's old value (2.95) differs from the golden WALT case's old Overview
(2.7) because the test hands the as-of date straight to the Overview's WALT
function (`leaseStats`). The 2.95 is therefore only the month-to-month error
(its rent counted at 0 years). The golden case runs the Overview as the app
did, measuring from today, which takes off another quarter-year.

## 5. A correction to the proposal (D9, the loan tool's equity)

The proposal (and the Phase 0 baseline report, D9) said the loan sizing
tool's equity figure was "never shown". **That was wrong.** The tool shows
it as **"Equity needed … before closing costs"** (`app/toolsui.js`). It is a
labelled, correct figure, different from the deal's "Equity needed, with
closing costs", and each label says which it is.

You approved removing it on the strength of my wrong claim, so I **did not
remove it**. The known-answer test checks that it is what its label says
(price less the loan). If you still want it gone, or want the tool to add
closing costs like the deal, say so and it is a one-line change.

## 6. Two defects found while checking

- **The Overview read a stale copy of the rent roll.** A deal with a lease
  rent roll keeps an older flat copy (`rentRoll`) for compatibility. The
  Overview's WALT used that copy, so after a lease edit it could show 3.5
  years while the Rent roll tab showed 3.1. The Overview now derives its rows
  from the lease rent roll, as the Rent roll tab does. Found by the browser
  flow `engine-flow`.
- **Part-month free rent.** The NER tool treated 2.5 free months as 3. Now a
  part month forgoes that part of the month's rent. Found because the
  LibreOffice recalculation of the new Excel formula disagreed with the
  engine on that case (NER!P7, $37.8183 vs $38.0281). The engine was fixed,
  and the formula rounds a fractional term to whole months (`ROUND(I,0)`), as
  the engine does. Whole-month cases are unchanged, so no golden figure
  moved.

## 7. Money: how it is stored

- **Totals** (prices, NOI, income and expense lines, annual and monthly
  rents, TI and fee totals, comp prices) are stored **rounded to whole
  cents**.
- **Rates** (rent per SF per year or month, market rent, TI per SF, $/SF
  targets, price per unit, recovery stops per SF) are stored **to four
  decimals**.
- Rounding is half away from zero, reading the value as typed: $1.005 becomes
  $1.01.
- Computed figures (IRR, loan payments, projections) stay in floating point.

**Representation:** the values are kept as ordinary JavaScript numbers,
rounded, not as integer counts of cents. Every stored total is therefore the
nearest double to a whole number of cents, and every rate the nearest double
to four decimals. The saved-data shape is unchanged, so 4.0.0 can still read
it. Integer cents would change every reader and the backup format, which
belongs with the typed model.

**The migration** runs once on each device when 4.1.0 first opens, again
after a backup is restored, and on opening any deal not yet converted.
Deals and the session (typed and edited comp prices) are covered, as are the
saved Tools inputs and scenarios. Every value it rounds is logged with:

- where it was (deal name, Tools or Comps);
- the field;
- the old value;
- the new value.

Settings → Your data says how many values were rounded, and "Show" lists
them all. New values are rounded as they are saved, so the log only ever
shows values that existed before.

## 8. Calculation conventions

Settings → Calculation conventions lists every convention the engine uses:

- **Settable:**
  - WALT weighting (by income, the default, or by area);
  - month-to-month leases (left out, the default, or counted at 0 years).

  The choice is kept on the device. Every WALT label follows it.
- **Fixed, and stated:**
  - WALT measured from the rent roll's as-of date;
  - years of 365.25 days;
  - whole months of amortization;
  - cash flows at year end;
  - the NER and break-even definitions;
  - which comps count;
  - the money rule.

## 9. What was verified, not verified, and assumed

**Verified:**

- `npm test`: 153 unit tests pass, including the 11 known-answer and 5 money
  tests.
- ESLint is clean.
- The browser suite (`tests/e2e/run.sh`): 22 flows and the LibreOffice
  recalculation of the exported workbooks, run on the pushed commit; the
  result is in the pull request.
- `engine-flow`, a browser flow that:
  - restores a backup made by the real 3.3.0 app (the test fixture), edited
    to carry sub-cent values, a month-to-month lease and an earlier as-of
    date;
  - checks the 4 rounded values in Settings, old and new;
  - checks the WALT label and its method on the Overview and the Rent roll
    tab;
  - changes the WALT convention and checks the change sticks after reload;
  - checks the NER and break-even tools.
- `tests/e2e/make_engine_check.mjs` writes the new Excel formulas for 13
  cases:
  - 7 NER cases (no escalation, part years, free rent beyond a year, a part
    month);
  - 5 loan payments (27.4, 25.5, 30 years at 0%, 30 years, 19.95 years);
  - the comps' weighted $/SF with a $0 price, a 0 SF and a text ("Undisclosed") price.

  LibreOffice recalculates them: 0 errors, 0 mismatches against the engine.

**Not verified:**

- Safari, Firefox and Microsoft Excel (only Chromium and LibreOffice are
  available here).
- Real brokerage files: all cases are synthetic fixtures.
- Anyone's actual stored data: I can't see what the migration will round on
  a real device. It logs every change instead.

**Assumed:**

- A fractional amortization term is rounded to the nearest month, as the
  amortization schedule already did.
- Each NER escalation compounds at the lease anniversary, and free months
  come first, at the starting rent.
- A rate is any money input whose label says per SF or per unit, or that is
  typed to two decimals in a tool (`money2`).
