# Phase 2, milestone 1: T-12 import with the Review Queue

Status: **approved 2026-10-10**, with the four decisions answered and two
changes to the category list (both below). Built in 4.7.0.

Out of scope for this milestone:

- OM checks;
- the NOI bridge;
- pricing guidance;
- multi-year history;
- the status bar.

## 1. Standard categories

Each line of a T-12 goes to exactly one category. Every amount is dollars a
year (`UsdPerYear`), the sum of 12 monthly amounts (`UsdPerMonth`).

**Income**

- Base rent
- Vacancy and credit loss (a reduction)
- Concessions and free rent (a reduction)
- Expense recoveries (CAM, taxes, insurance)
- Parking
- Other income (fees, storage, laundry, miscellaneous)

**Operating expenses**

- Real estate taxes
- Insurance
- Utilities
- Repairs and maintenance
- Contract services (janitorial, landscaping, security, elevator, snow)
- Management fee, **property management only**
- Payroll
- General and administrative (legal, accounting, marketing)
- Other operating

**Below the line (kept, not in NOI)**

- Capital expenditures
- Reserves
- TI and leasing commissions
- Debt service and interest
- Depreciation and amortization
- Owner and partnership costs, **including asset management fees and
  owner-level fees**

Two rules follow from the changes:

- A label that only says "management fee" (or "management fees") is not
  guessed. It goes to the Review Queue as uncertain, because it could be the
  property manager's fee or the owner's.
- Asset management fees and owner-level fees go below the line.

NOI is effective gross income (the income categories) less operating expenses.
Subtotal and total rows are recognised and left out of the sums. Each one the
file states is checked against the lines it covers.

## 2. Reading a file

`.xlsx` and `.csv` files are read on the device. `.xls` is refused with a plain
message, as for the rent roll.

What is detected:

- **The label column:** the column with the most text.
- **The month columns:** headings that read as months ("Jan-25", "January
  2025", "01/2025", or an end-of-month date). In a CSV, headings like "Month 1"
  count too, when there are no dates.
- **A Total column:** "Total", "T-12", "TTM", "Annual" or "YTD".
- **Section headings:** rows with a label and no numbers ("INCOME",
  "OPERATING EXPENSES").
- **Number formats:** negatives in parentheses or with a trailing minus, `$`
  signs, and thousands separators. "–", "-" and blank read as 0.

Signs are made consistent from the section a line sits in. Income counts up,
and a reduction counts down. An expense counts as a cost whichever way the
file signs it. When the file states its own NOI, the result is checked
against it.

With fewer than 12 month columns, the months are kept **as they are**. The
statement says "only N months", and the queue carries an item for it. Nothing
is scaled up to 12 months.

## 3. Matching, and remembered corrections

Each line goes through three steps, in order:

1. **Your corrections.** The label is normalised: lower case, account numbers
   ("6100-000", "4010 ·") removed, punctuation and extra spaces dropped. It is
   then looked up in the corrections saved on this device. A match there is
   **certain**.
2. **Built-in rules.** Each category has keyword rules (for example "tax" →
   real estate taxes, "insur" → insurance, "CAM", "reimburs" or "recover" →
   recoveries). A line is **likely** when exactly one category matches and
   that category sits on the same side as the section the line is in.
3. **The Review Queue.** A line goes to the queue as **uncertain** in any of
   these cases:
   - no rule matches;
   - two categories match;
   - the category disagrees with the line's section;
   - the label is a bare "management fee".

**Remembered corrections.** When you choose a line's category,
"Remember this label" is ticked.

- Only the normalised label and the category are saved, never an amount.
- They are saved in the kv store as `t12.labels` on this device, and travel in
  backups.
- A merge restore combines them label by label, the newer winning. Before
  this, a kv key other than the merged lists was restored only when the
  device had none.
- Settings lists them, and any can be removed.

**On the deal.** `deal.t12` holds:

- the file name and the sheet;
- the months;
- each line: label, normalised label, row, category, how it was matched
  (`yours`, `rule` or `review`), the 12 monthly amounts, and its total;
- the totals the file states;
- what has been reviewed.

The import is one history entry, which can be undone. An automatic snapshot is
taken first, as for other imports.

`deal.t12` is a new optional field, so no migration step is needed. The
registry's test still requires an old backup for any real step.

**"Use the T-12's figures"** is an explicit button. It is never automatic.

- It sets the deal's effective gross income, operating expenses, real estate
  taxes and NOI.
- Each figure's source says "T-12" and the months.
- It can also set the rent roll's operating expenses.
- It is one history entry, which can be undone.

## 4. The Review Queue

The Review Queue is a new "Review" view.

- **When it shows:** the tab appears in the navigation only when there is
  something to review. It has a count badge, as the Deals tab does. It is also
  in the search (⌘K).
- **Where items come from:** items are worked out from where they live, with
  no separate queue store. In this milestone there are four sources:
  1. **T-12 lines** that are uncertain. You choose a category, or "below the
     line". You can apply the choice to every line with the same label, and
     "Remember this label" is ticked.
  2. **T-12 checks:**
     - the months don't add up to the file's Total;
     - a stated subtotal or NOI doesn't match;
     - there are only N months.

     "Seen" marks a check reviewed.
  3. **AI readings never applied:** extraction fields with `applied: false`.
     You can open the deal, or dismiss them.
  4. **Template cells mapped with low confidence:** cells whose saved
     mapping says `low`. You can open the template's mapping, or confirm the
     cell ("It's right").
- **What resolving records:** resolving or dismissing an item is recorded
  where the item lives: on the T-12 line, the T-12 check, the AI record or the
  template cell. So
  it travels in backups, and for deal items it can be undone. "Leave as is" is
  a deliberate choice and is recorded.
- **Order:** grouped by deal, with the most money at stake first.
- **Left out:** low-confidence OM readings. They keep their "check" tags on
  the deal.

## 5. NOI three ways

The deal overview shows a table with each NOI, its source, and the gaps in
dollars and percent:

| NOI | Source |
|---|---|
| OM NOI | the in-place NOI, as read or typed |
| T-12 NOI | from the matched lines |
| Rent roll NOI | the projection's year 1, **labelled "forward-looking, year 1"** so nobody reads it as an actual |

The flags are registered check rules. So they appear in "What doesn't add
up", the impact map, the brief and the workbook.

| Gap between two figures | Flag |
|---|---|
| Within 2% | Agree; no flag |
| 2% to 5% | Info |
| Above 5% | Warning |

- The 2% and 5% thresholds are a convention, shown in Settings → Calculation
  conventions.
- The warning names where most of the gap comes from, by comparing the T-12's
  EGI, operating expenses and taxes with the OM's.
- When the OM's NOI is the higher one, the warning suggests it may be pro
  forma or leave out expenses.
- **The rules fire only on a deal with a T-12.** Decision 2: OM NOI is not
  compared with rent roll NOI on deals without one, so existing deals give
  exactly the results they did.

## 6. Tests

**Invented layouts only.** About 8 statement shapes are written by a script,
with invented property names, labels and figures. They copy only the
structure of real statements:

- accounting-system style, with account numbers and sections;
- months as dates, with expenses negative;
- a CSV with blank rows and subtotal rows;
- a property manager's workbook with title rows and merged headings;
- a 9-month partial year;
- a Total column that disagrees with the months;
- multifamily, with concessions and loss to lease;
- retail NNN, with recoveries and an asset management fee.

The `.xlsx` files are made when the tests run.

**Node tests:**

- reading: months, signs, subtotals, totals;
- matching: corrections win over rules; label normalisation; a bare
  "management fee" is uncertain;
- each layout's category totals against figures worked out by hand;
- the NOI flags: the thresholds and the direction rules;
- how queue items are worked out;
- corrections merged on restore;
- mutation checks: removing a rule, or breaking the sign handling, must fail.

**Browser flows:**

- `t12-flow`: import each layout, resolve the queue, see the NOI flags, use
  the T-12's figures, undo, reload, back up and restore;
- `review-flow`: the tab appears only when there are items, the badge counts,
  and dismissing works;
- axe on the new screens, in light and dark.

All of these fail on 4.6.0.

**No change for existing deals.** With no T-12 on a deal, the 618 saved
results and the 646 displayed figures stay identical.

**Verification:** the full browser suite, including perf-flow.

**Real files.**

- They are kept only in a local `private/` folder, which is in `.gitignore`.
- A local-only script (`tests/tools/t12-local.mjs`) prints structure counts
  only: lines, lines matched, items for review, and checks.
- No figures, property names or tenant names from real files go into tests,
  docs, commits or PR descriptions.
