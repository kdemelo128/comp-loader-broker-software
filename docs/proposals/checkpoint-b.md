# Checkpoint (b): definitions and the whole-cents list, for approval

Status: **proposal; nothing here is implemented.** Prepared 2026-10-10 on
`main` at `9197b1b` (Zlatura 4.0.0). Every number below was computed in this
session, by the app's own functions and, for the definitions, independently in
Python; the cents list comes from `tests/tools/cents-audit.mjs`.

## 1. Net effective rent

### What the app does today (two definitions)

| Where | Escalations | Free rent | TI | Commissions | Divided by |
|---|---|---|---|---|---|
| NER tool, What-if tools (`tools.js netEffectiveRent`) | compound at each lease anniversary | the free months at the rent in force then (the first months) | deducted | deducted (% of total rent) | term in years, per SF |
| Comp workbook, Lease Comps tab (`workbook.js nerFormula`) | **linear average**: base × (1 + esc × (years − 1) ÷ 2) | the free months **at that average rent** | deducted | **not deducted** | term in years, per SF |

On the workbook's own example row ($75/SF, 3% a year, 120 months, 3 months
free, $25/SF TI, no commission):

| Definition | NER, $/SF/yr |
|---|---|
| Workbook formula today | **80.50** (80.4969) |
| Tool (compounded, free months at the starting rent) | **81.60** (81.6041) |
| Same, with a 6% commission | 76.45 (76.4453) |
| Tool, discounted at 8% (level rent with the same present value) | 78.02 (78.0240) |

Python, worked month by month, gives the same four figures as the app.

### Proposal

One function in the engine, used by the tool and written into the workbook's
formula:

> **Net effective rent** = (total base rent over the term, with each
> escalation compounding on the prior year's rent at the lease anniversary,
> − the rent forgone in the free months, at the rent in force in those months,
> − tenant improvement allowance, − leasing commissions) ÷ term in years ÷ SF.

Why this one:

- Fixed percentage bumps in leases compound on the prior year's rent. That is
  how the lease engine and the rent roll already model them, so the linear
  average is the odd one out. It understates NER by about 1.4% on the example.
- Free rent is given at the start of the lease, at the starting rent. Valuing
  it at the term's average rent overstates the concession.
- It divides by the full term, the standard convention, and is undiscounted.

**Two meanings are legitimate, so both stay, labelled:**

1. **Commissions.** A landlord's NER deducts leasing commissions; tenant-side
   and survey NERs usually don't. Commissions stay an explicit input. The
   label says "net of free rent, TI and commissions" when a commission is
   entered, and "net of free rent and TI" when it isn't.
   - The Lease Comps tab has no commission column, so its NER is the second
     kind, and its note will say so.
   - I am **not** proposing to add a column, because that would move the
     tab's layout for anyone with formulas pointing at it. Say if you want one.
2. **Discounting.** "NER" (undiscounted) and "NER, discounted at X%" (the
   level rent with the same present value, monthly in advance) both stay,
   labelled as today.

### What would change on screen

- **Only the comp workbook's Lease Comps tab.** The NER column, its "Average
  net effective" summary, and the example row (80.50 → 81.60).
- The new Excel formula is the closed form of the same month-by-month sum. For
  term *n* months, *Y* = INT(*n*/12), base *K*, escalation *M*:
  *K* × (((1+*M*)^*Y* − 1)/*M* + (*n* − 12*Y*)/12 × (1+*M*)^*Y*), or
  *K* × *n*/12 when *M* = 0. It is checked by LibreOffice recalculation against
  the engine to the cent.
- The tool's numbers do not change.

## 2. Break-even occupancy

### What the app does today

The baseline report (D5) said there were two definitions. On a closer read
they are **the same formula**:

- The deal uses (operating expenses + debt service) ÷ gross potential rent.
- The tool uses (operating expenses + debt service − other income) ÷ gross
  potential rent.

They differ in two ways only:

- The tool can subtract other income that does not depend on occupancy
  (parking, antennas). The deal model has no such figure, so for every deal
  the two give the same answer: 78.58% on the retail fixture, both ways.
- The deal has two fallbacks the tool lacks:
  - With no GPR, the deal **estimates** break-even from EGI scaled to its
    occupancy, labelled "(est.)".
  - With no occupancy either, it shows "share of current income", labelled so.

### Proposal

One engine function:

> **Break-even occupancy** = (operating expenses + annual debt service
> − income that does not depend on occupancy) ÷ gross potential rent.

It returns its basis, so the label always says which kind it is:

| Basis | Label |
|---|---|
| gross potential rent | Break-even occupancy |
| EGI ÷ occupancy | Break-even occupancy (est.) |
| EGI only | Break-even, share of current income |

Occupancy-independent income defaults to zero, and the deal gains no new field
for it now.

Why: the tool's numerator is the more precise definition (income that stays
when units go dark lowers the occupancy needed), and it equals the deal's when
that income is zero.

**What would change on screen: nothing.** The deal's figures and labels are
unchanged (its other income is zero). The tool keeps its inputs and result; it
gains the estimated fallbacks only if GPR is left blank and gross income and
occupancy are given, which would show a labelled estimate where it shows "—"
today.

## 3. Whole cents: every displayed value that would move

### How it was measured

`tests/tools/cents-audit.mjs` runs, for each money input in turn, the app's own
engines and display formatting twice:

- once with the input as stored today, carrying a sub-cent part of
  $0.00499, the most a cents rounding can remove;
- once with it rounded to whole cents.

It reports every displayed string that differs. The inputs and outputs
covered:

- **Deals:** the three fixture OMs (retail, net lease, multifamily). Money
  figures, lease rents, rent per SF, and market rent.
- **Deal outputs compared:** every Overview and workbook field, the
  cap-rate ladder, the What-if table and answers, rent roll summary and
  10-year projection.
- **Tools:** all 30. Every money input at its example value, with every
  result line and table cell as displayed.
- **Comps:** the CoStar fixture set. Each comp's $/SF and the set's
  weighted, median, low and high.

**Result:** 57 inputs tested; 1,676 displayed values compared; **56 changed**,
from 9 of the inputs. They fall into three kinds.

### A. As read from the fixtures: no change at all

Every money value in the three OMs and the comp set is already a whole number
of cents, so storing them as cents changes nothing. This is the normal case:
OMs, CoStar reports and typed figures are almost always whole dollars or
cents.

### B. Rates per unit (per SF, per SF per month, per unit) rounded to cents: real changes

A rate is multiplied by area and time, so dropping its third and fourth
decimals moves totals by dollars, not fractions of a cent. Measured:

| Input rounded to cents | Displayed change |
|---|---|
| Retail fixture's five leases entered as $/SF/yr to 4 decimals (e.g. $37.8462 → $37.85) | In-place rent **$468,010 → $468,000**; monthly $39,001 → $39,000; Overview "In-place rent" and "NOI, year 1" −$10; **every projected year's EGI and NOI −$8 to −$11** (all 10 years) |
| Market rent $41.2678 → $41.27/SF/yr | Loss to lease **−$14,030 → −$14,054**; NOI year 1 $342,713 → $342,712 |
| NER tool: starting rent $42.00499 → $42.00/SF | Total face rent $1,203,850 → $1,203,707; free rent $35,004 → $35,000; commissions $72,231 → $72,222 |
| NER tool: TI $40.00499 → $40.00/SF | TI $100,012 → $100,000 |
| Converter: rent $36.00499 → $36.00/SF/yr | Annual rent $43,206 → $43,200 |
| Offer and seller net: target $475.00499 → $475.00/SF | Price at target $/SF $4,275,045 → $4,275,000 |

(In the rows above the rounding is the realistic direction: the value as
typed or extracted, then as stored.)

### C. Rounding-boundary flips: one unit in the last displayed digit

When a total that carries a sub-cent part is rounded, a displayed value that
sits exactly at a rounding edge can move by one unit. Measured instances:

- Retail projection year 4 NOI $329,904 → $329,903 (every lease's annual rent
  with a sub-cent part).
- DCF tool, year 3 row, one cell $928,287 → $928,288 (a capital reserve of
  $0.00499).
- Value sensitivity tool, two cells $11.88M → $11.87M and $13.13M → $13.12M
  (NOI $875,000.00499).

These need a stored value with a sub-cent part. Today that happens only when:

- a figure is **written back from a calculation**: Tools → deal (loan sizing,
  NOI bridge, hold returns), or What-if → "Save to deal" with a solved price
  such as the price for a 15% IRR;
- an AI-read figure has more than two decimals;
- someone types more than two decimals.

### On existing data

Converting what is already stored on each device rounds it once. Only values
that already carry sub-cent parts move: write-backs, AI values, rents per SF
typed to 3+ decimals, and stored per-SF figures the OM reader computed (e.g.
$37.846153… a year per SF in the legacy rent roll rows). I can't measure
anyone's device from here. The migration will log every value it rounds, with
old and new, in the deal's history, so nothing changes silently.

### Recommendation (needs your decision)

Keep your rule (**totals stored as whole cents**: prices, NOI, income and
expense lines, annual and monthly rent amounts, TI and fee totals, comp
prices), with one exception:

> **Rates per unit** (rent per SF per year or month, market rent, TI per SF,
> $/SF targets, price per unit) are stored to **four decimal places**, as an
> integer number of ten-thousandths of a dollar.

With that exception, category B disappears for any rate stated to four
decimals or fewer, which covers every lease and OM I know of. What remains is
category C: one-digit boundary flips, and only on values that carry sub-cent
parts today. If you'd rather keep whole cents for rates too, the B table above
is what changes.

## 4. Other definition changes in the shared engine (please approve with the above)

| Id | Change | What would change on screen |
|---|---|---|
| WALT (**approved**) | One definition everywhere: the Rent roll tab's method, measured from the rent roll's as-of date, month-to-month leases excluded, weighted by income (by SF also shown). The method's name is shown next to every WALT, and it is a setting. | The deal Overview and the deal brief, when a rent roll has month-to-month leases or an as-of date other than today. Today the Overview counts month-to-month rent at 0 years and measures from today. On the retail fixture both give 3.21 years. |
| D3 | Debt service uses whole months of amortization everywhere: years × 12 rounded, as the amortization schedule and lenders do. | Only for an amortization that isn't a whole number of months. At 27.4 years on the retail deal's $4,192,500 loan: **$336,150.26 → $336,079.48 a year**, and DSCR, cash flow and returns with it. Whole and half years (30, 25.5) are unchanged. The deal workbook's PMT formula gets the same rounding. |
| D6 | No price is derived from a zero or negative NOI. The field shows "—" with a warning, instead of a negative price. | A deal with negative NOI and a stated cap rate: today it shows a derived price of **−$833,333**; proposed, "—" with a warning. |
| D8 | A comp counts toward $/SF figures only with a price > 0 and SF > 0, everywhere: deal comparisons, Comps "At a glance", the comp workbook's weighted $/SF and its Excel formulas. The comp-set check's median age becomes the true median (the average of the two middle ages for an even count, as Excel's MEDIAN does). | Only when a comp has a $0 price or 0 SF entered: the comp workbook's SF-weighted $/SF would leave it out. "Median age" in the comp-set check tool, for an even number of dated comps. |
| D9 | Remove an unused "equity" figure from the loan sizing tool's result. | Nothing; it is never shown. |

Not changed in (b): the percent-parsing rule (D7) waits for the typed model,
where every value carries its unit.
