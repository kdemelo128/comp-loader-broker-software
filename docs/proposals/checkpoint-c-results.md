# Checkpoint (c): results

Status: **implemented on `claude/bold-archimedes-9a9r3p`, version 4.2.0,
awaiting review.** Goal: open a 500-lease rent roll in under 1 s, and see the
totals update after an edit in under 150 ms, with the lease projection off the
main thread.

## 1. Result

Medians of 5 runs; 4.1.0 is `main` at `088582d`. Measured in this container:
headless Chromium (Playwright 1.56.1), 4 vCPUs (Intel Xeon, 2.80 GHz),
1440 × 900, no CPU throttling.

| Action | 4.1.0 | 4.2.0 | Budget | Met |
|---|---|---|---|---|
| Open the Rent roll tab: the grid and its totals painted | 1,843 ms | **189 ms** | under 1 s | yes |
| Edit one rent: the totals painted | 1,065 ms | **66 ms** | under 150 ms | yes |
| Open: the projection table shown | 1,888 ms | 242 ms | — | |
| Edit: the projection table updated | 1,082 ms | 160 ms | — | |
| Jump to the last unit: its row painted | 123 ms | 98 ms | — | |
| Longest main-thread block, opening | 1,617 ms | 152 ms | — | |
| Longest main-thread block, editing | 902 ms | 51 ms | — | |

The same, with the CPU slowed 4× (Chrome's CPU throttling, roughly a mid-range
phone; medians of 3 runs):

| Action | 4.1.0 | 4.2.0 | Budget | Met |
|---|---|---|---|---|
| Open the Rent roll tab | 9,699 ms | **814 ms** | under 1 s | yes |
| Edit one rent: the totals | 4,894 ms | **326 ms** | under 150 ms | **no** |
| Open: the projection shown | 10,738 ms | 945 ms | — | |
| Edit: the projection updated | 4,999 ms | 491 ms | — | |
| Jump to the last unit | 670 ms | 585 ms | — | |
| Longest main-thread block, opening / editing | 8,318 / 4,111 ms | 649 / 238 ms | — | |

Every run, in ms:

| | 4.1.0 | 4.2.0 |
|---|---|---|
| Open, 1× | 1843, 2039, 1726, 1787, 1853 | 193, 189, 158, 215, 180 |
| Edit, 1× | 1155, 1070, 1053, 1055, 1065 | 66, 75, 66, 59, 100 |
| Open, 4× | 9350, 9699, 9736 | 814, 990, 734 |
| Edit, 4× | 5185, 4768, 4894 | 302, 351, 326 |

### How it is measured

`tests/e2e/perf-flow.mjs`, now part of `tests/e2e/run.sh`, does the following:

1. Reads the retail fixture OM.
2. Imports a 500-row CSV into its rent roll, giving 505 units (the OM's 5 and
   the 500 imported).
3. Saves the deal and reloads the page.
4. Times two actions inside the page:
   - **open:** a click on the Rent roll tab;
   - **edit:** typing a new annual rent into one row and pressing Tab.

Each time runs from the moment a capturing listener sees the person's action,
before the app does. It stops at the frame after the result is in the page,
so it includes style, layout and paint.

- "Open" ends when the grid holds every row (`aria-rowcount` 507: the header,
  505 units and the totals), its first rows are drawn, and the totals row
  reads "Total · 505".
- "Edit" ends when the In-place rent tile shows the new figure.
- Long tasks are the browser's Long Tasks API: blocks of 50 ms or more.
- `THROTTLE=4` runs the same with Chrome's CPU throttling.

The 4.1.0 numbers come from the same script, run against a copy of 4.1.0
served on its own port. 4.1.0 has no `aria-rowcount`, so the script counts its
drawn rows instead; 4.1.0 drew all of them.

The Phase 0 baseline (§7 of the baseline report) measured with Playwright
round-trips: 1.9–2.1 s to open and 1.7–1.9 s to edit. This in-page method is
more precise. On 4.1.0 it gives about the same for opening and less for
editing.

## 2. What changed

### The projection: 14× faster, same results

A profile of 4.1.0 showed `dayOf` (date text to a day number) taking 718 of
the projection's 895 ms. It ran a regular expression and built two `Date`
objects on every call, and the monthly loop called it for every period and
abatement in every month of every lease.

- `dayOf` and `isoOf` now remember the dates they have converted (up to 50,000
  each).
- `leaseMonths` converts each period's and abatement's dates once per lease
  instead of every month.

The arithmetic and its order are unchanged. In Node, the 500-lease, 10-year
projection fell from 873 ms to 61 ms.

**Proof that nothing moved:**

- The old and new `project()` and `leaseMonths()`, plus `dayOf()` and
  `isoOf()` on edge cases, ran on the 500-lease rent roll and 300 random rent
  rolls: **7,931 outputs, all identical, compared as JSON strings**. The
  random rolls cover:
  - vacancies and month-to-month leases;
  - abatements, including part-percent and overlapping ones;
  - invalid and part-month dates;
  - every rent unit;
  - recoveries of every kind, percentage rent and one-time items;
  - market-rent gaps;
  - renewal settings, with 1-, 5-, 6-, 10-, 11- and 15-year horizons.
- `tests/tools/golden.mjs`, 4.1.0 against 4.2.0: **646 figures compared, 0
  changed.**
- In the browser, every value 4.1.0 and 4.2.0 show for the 500-lease deal was
  compared, before and after the same edit: **1,026 comparisons, 0
  differences**. That covers:
  - all 505 grid rows, read by scrolling through 4.2.0's windowed grid;
  - the tiles, the totals row and the issues list;
  - the expirations, concentration and projection tables;
  - the Overview's tiles and its rent-roll card.

### The projection runs in a worker

- `app/projector-worker.js` is a module worker that runs `project()`.
- `app/projector.js` gives the screens three calls:
  - **`projectionLater(rr, opts)`**: a promise of the projection's summary
    (its years, start and notes), worked out in the worker.
  - **`projectionNow(rr, opts)`**: that summary at once if exactly this rent
    roll was already worked out, else nothing. The cache is keyed by the rent
    roll's full content, so a stale answer can't be shown, and it keeps the
    last 8.
  - **`projectionSync(rr, opts)`**: works it out on the page, for one-off work
    a person asked for. It shares the same results.
- Each job gets a copy of the rent roll as it was when asked, so an edit made
  meanwhile can't reach it. Two identical requests share one job.
- If the worker can't start or load, the same work runs on the page after the
  screen has drawn (`bigroll-flow` blocks the worker file to check this).
- The worker is in the offline cache, and `bigroll-flow` checks it works
  offline.

What uses it:

| Where | Before | Now |
|---|---|---|
| Rent roll tab: the 10-year projection | main thread, on every edit | worker. The rest of the tab, including Assumptions, draws at once; the table says "Working out the projection, month by month…" until it arrives. |
| Overview: the OM's gross income against the rent roll's next 12 months | main thread, on every edit | worker. The note appears when it arrives. |
| What if: NOI year by year from the rent roll (when chosen) | main thread, on every edit | worker. Until it arrives the panel says so, rather than show figures on another basis. Saved scenarios likewise. |
| Template fills, scenario lines in the brief and the AI facts | main thread | main thread (`projectionSync`), now 14× faster; they run once, when asked |
| Workbook exports (`rrbook.js`), the one-lease schedule sheet | main thread | unchanged, now 14× faster. They need the month-by-month detail, which the worker doesn't return. |

### Long rent rolls draw only the rows near the screen

Moving the projection off the main thread wasn't enough on its own. With it
done, opening still took 1,171 ms and an edit 256 ms. A timeline trace showed
why: with a 505-row grid the page held about 48,700 elements, nearly all of
them the grid. Opening spent 330 ms on style,
227 ms on layout and 715–877 ms on paint, and an edit spent 250 ms repainting
it. With only 60 rows on the page, paint fell to 100 ms on open and 21 ms on
an edit.

So a rent roll of **more than 100 units** draws about 60 rows: the ones on
screen plus 20 above and below. Spacer rows keep the table its full height.
More rows are drawn, 20 at a time, as they scroll into view. Rent rolls of 100
units or fewer are drawn whole, exactly as before.

What stays the same, with how each was checked (`bigroll-flow`):

- **Every row counts.** Totals, tiles, search, filters, sorting and
  validation all work on every unit, drawn or not. Search finds unit 1450, far
  down the list.
- **Screen readers** get the table's full size (`aria-rowcount`) and each
  row's place (`aria-rowindex`). The spacer rows are hidden from them. axe
  finds no violations on the windowed grid.
- **Arrow keys** move past the last drawn row; it is drawn and scrolled to.
- **A cell being typed in is saved** if its row scrolls out of view: the cell
  is committed first. Removing an input otherwise fires no change event.
- **"+ Unit"** on a long rent roll draws the new row and puts the cursor in it.

One difference, on rent rolls over 100 units: the browser's own find (Ctrl F)
and printing the screen only see the drawn rows. The grid's search box sees
every row, and the Rent Roll workbook export has every unit.

## 3. Not met, and why

**An edit with the CPU slowed 4× takes 326 ms, against 150 ms.** At full speed
it takes 66 ms: about 45 ms of script and the rest drawing. No single item
dominates the script:

- the deal's redraw: 17 ms;
- the save, with the whole-cents rounding of 505 leases: 10 ms;
- the totals and issues: 14 ms;
- handing the rent roll to the worker: 10 ms.

Getting a slow phone under 150 ms would mean recomputing the summaries
incrementally instead of over the whole rent roll, which is a larger change
than this checkpoint. It is listed as a follow-up, not done.

## 4. Verified, not verified, assumed

**Verified:**

- `npm test`: 157 pass (4 new in `tests/projector.test.js`). ESLint is clean.
- The browser suite, `tests/e2e/run.sh`, with the two new flows:
  - `bigroll-flow`: windowing, keys, saving on scroll, search, + Unit, axe,
    the worker, offline, and the fallback with no worker;
  - `perf-flow`: the budgets.

  Its result for the pushed commit is in the pull request.
- The old-against-new projection comparison, the golden comparison and the
  in-browser display comparison above.

**Not verified:**

- Safari and Firefox (module workers are in Safari 15+ and Firefox 114+; the
  app already needs iOS 16.4).
- A real phone. The 4× figures are Chrome's CPU throttling on this machine,
  not a device.
- Real brokerage rent rolls: the 500 leases are generated, one rent period
  each, with no abatements. Rent rolls with many periods per lease project
  more slowly.
- Screen readers in use. axe checks the markup; nobody has listened to it.

**Assumed:**

- The budgets are for this kind of machine at full speed, as in the Phase 0
  baseline. The 4× numbers are reported so the gap on a slower device is
  visible.
- 100 units is a sensible point to start windowing. Smaller rent rolls stay
  fully drawn, so find-in-page and printing behave as before for them.
