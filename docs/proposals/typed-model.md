# Phase 1 item 2: the typed deal model, with unit types: design for approval

Status: **approved 2026-10-10** (all three decisions as recommended) and built in 4.4.1. Original status: proposal, written 2026-10-10 against 4.4.0.

The goal: a number in one unit can't be used where another is expected, for
example:

- a rent per SF a month where a rent per SF a year is wanted;
- 0.065 shown as a percent;
- a land price per SF used as a building price per SF;
- months where years are wanted.

The rule: **no change in what the app shows or saves.** Types exist only for
the checker. At run time they are ordinary numbers, so the golden outputs
(618 deals, 646 displayed figures) must still match exactly.

## 1. The units

A new `app/engine/units.js` holds the types, as JSDoc, which the browser
ignores. `app/model.js` describes the deal with them: figures, loan, rent roll
and leases, settings, What-if and scenarios.

| Type | Means | Where it appears |
|---|---|---|
| `Usd` | dollars, at one time | price, loan, balance, equity, a TI total |
| `UsdPerYear` | dollars a year | NOI, gross income, expenses, taxes, GPR, debt service, annual rent |
| `UsdPerMonth` | dollars a month | monthly rent, a loan payment |
| `UsdPerSfYear` | rent per SF a year | lease rates quoted per SF a year, market rent, reserves per SF |
| `UsdPerSfMonth` | rent per SF a month | lease rates quoted per SF a month |
| `UsdPerSf` | price per SF: no time in it | price per SF, NOI per SF, comp $/SF |
| `UsdPerLandSf` | price per SF of land | price per land SF |
| `UsdPerUnit`, `UsdPerUnitMonth` | per apartment, and a month's rent per unit | price per unit, multifamily market rent |
| `Rent` | `{ rate, unit }`, with `unit` one of `year`, `month`, `psf_year`, `psf_month` | a lease period; turned into dollars only through `monthlyAmount()` |
| `Pct` | percent: 6.25 means 6.25% | cap rates, LTV, interest, occupancy, growth |
| `Fraction` | 0.0625, as Excel takes it | only at the Excel and inner-arithmetic boundaries, and converted in one place each way |
| `PctChange` | a relative change: rents +3% | What-if rent and expense changes, against the comps |
| `Points` | the difference of two percents | the stated cap rate against NOI ÷ price ("0.15 points apart") |
| `Bps` | basis points | floating-rate shocks |
| `Sf`, `LandSf`, `Acres` | building or rentable area as the deal states it; land area; land in acres | lease SF, building SF, lot SF |
| `Years`, `Months` | spans of time | amortization and hold in years; lease-up, downtime and new-lease term in months |
| `IsoDate`, `DayNumber`, `ExcelSerial` | a date as text, as the engine's day count, and as Excel's number | lease dates, the as-of date, workbook dates |
| `Multiple` | a ratio, shown as "x" | DSCR, equity multiple, price ÷ gross income |

Not split: building SF into GBA, RSF and USF. The deal has one "Building SF"
field and the OM reader doesn't tell them apart. That belongs with the Phase 2
statement work.

## 2. How mixing is caught

**At check time.** `tsc --noEmit --checkJs`, with TypeScript as a dev
dependency only, so there is no build step and nothing changes in deployment.

- **It covers every file in `app/`.** Today that finds 197 loose spots; each
  gets annotated, with no change in behaviour.
- **Units are "flavors".** A plain number is accepted anywhere, so unannotated
  arithmetic needs no casts. A number known to be in one unit is refused
  where another is expected.
- **Units are given at the source:**
  - the deal model;
  - the engine's arguments and results;
  - each registered formula's result, where the registry's `unit` string
    becomes its type;
  - the parsers: `parsePct` returns `Pct`, and the fraction form converts
    explicitly;
  - the formatters: `pct()` takes `Pct`, `money2()` a per-SF amount, and so
    on.
- **What it then catches.** A `Fraction` passed to `pct()`, a `UsdPerSfMonth`
  passed where a `UsdPerSfYear` is wanted, `Months` passed as `Years`, an
  `IsoDate` passed where a `DayNumber` is wanted: each is a type error, in any
  file.

**Conversions are named and few.** These are the only ways across units:

- `perMonth`, `perYear`;
- `fractionOf`, `pctOf`;
- `monthlyAmount(rent, sf)` for a quoted rent;
- `dayOf`, `isoOf`, `serial`.

Each already exists or is a one-line identity with a name.

**At test time, the registries must agree.** The map (4.4.0) already knows
every figure's unit. A new test checks that each figure's unit agrees with:

- its template field's type (money, money2, pct, dec);
- its Deal Analysis row's Excel number format (a `%` figure written as a
  fraction with a percent format; a dollar figure with a money format);
- the formatter the brief uses for it.

Today these agree by convention only; after this PR they can't drift.

## 3. Tests

- **`tests/types.test.js`** runs the checker over `app/` and fails on any
  error. It runs in `npm test`, so it runs in CI. It adds about 2 s.
- **`tests/types/mistakes.js`** holds about 20 deliberate mix-ups, each marked
  `@ts-expect-error`. If one stops being caught, for example because someone
  loosens a type, the checker reports the unused marker and the test fails.
  On 4.4.0 they all compile cleanly, which is the "fails on old code" check.
  The mix-ups cover:
  - a monthly rent where a yearly one is wanted;
  - a per-SF rent where a total is wanted;
  - a fraction displayed as a percent;
  - percentage points where a percent is wanted;
  - land SF where building SF is wanted;
  - months where years are wanted;
  - an ISO date where a day number is wanted;
  - a relative change where an occupancy is wanted;
  - and more of the same kind.
- **`tests/units.test.js`** is the registry-agreement test above. On 4.4.0 it
  has nothing to read, because the units are new.
- **No change, proven:**
  - `analyze-golden` (618 deals) is identical;
  - `tests/tools/golden.mjs` (646 displayed values, workbook cells and tools)
    is byte-identical;
  - the full browser suite passes;
  - `perf-flow` holds the 150 ms edit budget.
  The types vanish at run time, so speed is unchanged. The one new run-time
  cost is the named identity conversions, which I'll measure with the
  `analyze()` bench.

## 4. What it costs

- **Size.** One PR, mostly JSDoc lines added to existing functions. No logic
  changes; any edit that isn't a comment is listed in the PR.
- **Ongoing.** New code in `app/` must type-check. A contributor who needs a
  new unit adds it to `units.js` with its conversion.

## 5. Decisions for you

1. **Flavors**, so plain numbers pass and only two known units clash
   (recommended). The alternative is strict brands everywhere: every number
   annotated, roughly 1,000 more edits in the screens, for little more safety.
2. **All of `app/` checked from this PR** (recommended, at 197 spots), rather
   than the engine and model only.
3. **No GBA/RSF/USF split** until Phase 2's statement work (recommended).
