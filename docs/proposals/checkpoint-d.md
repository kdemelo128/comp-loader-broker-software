# Checkpoint (d): change history, undo and snapshots: design for approval

Status: **proposal; nothing here is built.** Written 2026-10-10 against 4.2.1.
Sizes below were measured on this branch: a deal read from the retail fixture
OM is 7 KB of JSON (without photos); with 500 leases it is 280 KB; one lease
is about 400 bytes.

## What exists today

- A deal is one IndexedDB record, saved whole about 400 ms after the last
  edit (last write wins).
- Undo exists only as toast buttons after some deletions (about 20 places),
  for a few seconds.
- Stage changes keep a `stageHistory` list.
- The CRM activity log keeps 500 entries across all deals.
- The rounding log (Settings → Your data) records what the 4.1 money migration
  rounded, across all deals.
- There is no record of who changed what, or when.

## 1. What gets recorded

One **history entry per action** on a deal, kept per deal, append-only. An
action is:

- a field or cell edit;
- a rent roll import;
- "Apply from Tools";
- an AI extraction applied;
- a scenario saved or deleted;
- a unit or lease added or deleted;
- a stage change;
- a snapshot restored;
- a backup restore that changed the deal;
- an undo or redo.

Each entry holds:

- **when** (`at`);
- **what kind** (`edit`, `import`, `tool`, `ai`, `restore`, `rounding`,
  `undo`, `redo`, …);
- **a plain-English label**, e.g. "Annual rent, unit 1003: $30,111 →
  $600,000";
- **the changes**: a list of `{ path, old, new }`, with paths that use stable
  ids, e.g. `rr.leases[id=l7].periods[0].rate`, not positions.

How the changes are captured:

- `touch()` (where every edit already passes) compares the deal with its last
  recorded copy and writes the differences.
- Edits within one save window (400 ms) become one entry, so an import is one
  entry rather than 500.
- Call sites may pass a label; otherwise one is made from the field names.
- The comparison runs when the save fires, not inside the edit, so the 150 ms
  edit budget is unaffected. I'll measure it on the 500-lease deal before
  committing to this.

**Not recorded:**

- figures the app works out (they follow from the inputs);
- screen state;
- `updatedAt`;
- photo and recording bytes. Adding or removing one is recorded, by name, and
  removed media is kept for 30 days so undo works (see §4).

**Out of scope:** the comp set, templates, tasks, contacts and settings keep
what they have today. History is per deal.

## 2. How undo behaves

- **Per deal, strictly last-in-first-out.** Undo reverses the most recent
  action on the open deal, then the one before.
- **Redo** re-applies. A new edit after an undo clears the redo stack.
- **How to trigger it:**
  - Ctrl/Cmd Z, and Shift Ctrl/Cmd Z or Ctrl Y;
  - Undo and Redo buttons in the deal header, whose tooltips name the action;
  - a one-line toast after an undo ("Undid: Annual rent, unit 1003").

  While the cursor is in a field with uncommitted typing, the keys keep their
  normal text-editing meaning.
- **Undo is itself recorded** ("Undid: …"). History is never rewritten, so it
  stays a true record.
- **Depth:** the last 100 actions per deal. The stack survives a reload and a
  restart.
- **Safety check:** an undo applies only if each path still holds the value
  the entry set. Otherwise it stops and says what changed since, e.g. after a
  restore merged in a newer copy.
- **Rounding entries are skipped by undo.** Undoing one would bring back
  fractions of a cent that the next save rounds away again. They stay in the
  history as a record.
- **Undo to here:** in the history list, choosing an entry undoes everything
  after it as one new entry, which is itself undoable.
- **Toast undos:** the existing Undo buttons keep working. Deal ones go through
  the same mechanism, so they also appear in history.

## 3. Snapshots

- **What:** a named copy of the deal's data at a moment, without media bytes
  (photos are referenced by id).
- **Manual:** "Take a snapshot" (e.g. "Before seller call", "LOI sent").
- **Automatic,** before bulk or overwriting actions:
  - a rent roll import;
  - "Apply from Tools" with more than one field;
  - AI extraction applied;
  - a snapshot restore;
  - a backup restore that overwrites this deal.
- **Compare** a snapshot with the deal now: a list of differences, old and
  new, from the same comparison history uses.
- **Restore** puts the snapshot's data back as one history entry, which is
  undoable, after taking an automatic snapshot of the current state first.
- **Where they live:**
  - a new IndexedDB store `snapshots`, keyed `[dealId, snapshotId]`;
  - history in a new store `history`, keyed `[dealId, seq]`.

  Both are kept separate from the deal record, so saving a deal stays one
  small write. This raises the database version from 1 to 2. The app must
  handle an older tab still open on version 1: it is asked to close its
  connection, and told to reload if it doesn't.

## 4. Storage size limits

| What | Limit | Typical size | When over the limit |
|---|---|---|---|
| History, per deal | last 1,000 entries **or** 2 MB, whichever comes first | a cell edit ~0.2 KB, so 1,000 edits ~0.2 MB | oldest entries dropped; the deal then says "history kept since {date}" |
| One entry | 256 KB | an import of 500 leases would be ~0.3–0.5 MB of old and new values | the old side is stored as the automatic snapshot taken before the action, and the entry points to it |
| Manual snapshots, per deal | 20 | 7 KB (280 KB for a 500-lease deal) | asks you to delete one first |
| Automatic snapshots, per deal | 10 | as above | oldest automatic one removed |
| Removed photos and recordings | kept 30 days | their own size | then deleted for good |
| Everything above, all deals | 50 MB, and never above 50% of the browser's quota | | automatic snapshots pruned first, then the oldest history; Settings warns at 80% |

**Settings → Your data shows:**
- the history and snapshot sizes, from `navigator.storage.estimate()` and
  record sizes;
- "Clear history for this deal", which keeps the snapshots and the current
  deal.

Worst case for one 500-lease deal: 30 snapshots × 280 KB ≈ 8.4 MB plus 2 MB
of history. A typical deal: under 0.5 MB in total.

## 5. Backups

- **Included by default.** Backups carry each deal's history and snapshots
  (the backup format goes from version 1 to 2).
- **Optional:** "Leave out history and snapshots" makes a smaller file.
- **Version 1 backups** restore as today. Each restored deal's history starts
  with "Restored from a backup made {date}".
- **A version 2 backup in 4.2.x** is refused with the existing message, "made
  by a newer version of Zlatura: update the app first". It isn't half-read.
- **Merge restore:**
  - before a newer backup copy overwrites a deal on this device, the device
    copy gets an automatic snapshot, so the restore can be undone;
  - history entries from both sides are combined by entry id, in time order.
- **Replace restore:** deals in the backup that overwrite device copies get
  the same automatic snapshot. Deals deleted by replace are not kept, as
  today; the confirmation already says so.

## 6. The rounding log

- **The global rounding log stays as it is.** It is a one-off record of the
  4.1 migration, in Settings → Your data, and it is not in backups, as today.
- **From now on, rounding is also recorded per deal:**
  - the migration (or a pre-4.1 recovery copy) rounding a deal's stored value;
  - a typed value with more decimals being rounded on save.

  Each becomes a `rounding` history entry, e.g. "Rounded to whole cents: NOI
  $393,450.0049 → $393,450". So a deal's history explains every change to it,
  automatic ones included. These entries travel with the deal in backups.
- **Undo skips rounding entries** (see §2).

## 7. How it would be tested

- **Unit tests:**
  - comparison and applying changes, including random deals: applying then
    reversing returns exactly the original;
  - undo and redo order, the safety check, and rounding entries skipped;
  - size limits and pruning;
  - backup version 2 round trip, and restoring a version 1 backup made by the
    real 4.2 app.
- **A browser flow:**
  - edits, then undo and redo by keys and buttons;
  - reload persistence;
  - undo to here;
  - take, compare and restore a snapshot;
  - an automatic snapshot before an import;
  - the version 1 → 2 database upgrade with an old tab open;
  - a backup round trip with history.
- **`perf-flow` still checks the budgets** on the 500-lease deal, with history
  on.

## Decisions for you

1. **Backups:** include history and snapshots by default, with an option to
   leave them out? (Recommended.)
2. **Limits:** 100 undo steps; history 1,000 entries or 2 MB per deal; 20
   manual and 10 automatic snapshots; 50 MB overall. Change any?
3. **Scope:** undo for deal data only, with comps, templates, tasks and
   contacts left as they are?
4. **Removed media:** keep removed photos and recordings for 30 days so they
   can be undone or restored?
