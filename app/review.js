/* review.js -- what is waiting for a person to look at, worked out from where
 * each item lives (no separate queue is kept): T-12 lines not yet filed, T-12
 * checks not yet seen, AI readings never applied or dismissed, and firm
 * template cells mapped with low confidence. Resolving an item is recorded
 * where it lives, so it travels in backups and, on a deal, can be undone.
 * Pure: reviewui.js draws it. Design: docs/proposals/t12-review-queue.md. */

import { openLines, openChecks } from './t12.js';
import { DEAL_FIELDS } from './dealfields.js';

const FIELD_LABEL = Object.fromEntries(DEAL_FIELDS.map((f) => [f.key, f.label]));
const dealName = (d) => d.name || (d.figures && d.figures.address) || 'Untitled deal';
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.abs(v) : 0);

/**
 * Every item, grouped: [{ group: 'deal'|'template', id, name, items: [...] }],
 * each group's items with the most money at stake first, groups by the same.
 * Items: { kind: 't12line'|'t12check'|'ai'|'tpl', id, amount, ... }.
 */
export function reviewItems({ deals = [], templates = [] } = {}) {
  const groups = [];
  for (const d of deals) {
    if (!d) continue;
    const items = [];
    if (d.t12 && Array.isArray(d.t12.lines)) {
      // a label repeated on several lines is one item: filing it files them all
      const byKey = new Map();
      for (const l of openLines(d.t12)) {
        const it = byKey.get(l.key);
        if (it) { it.count += 1; it.amount += num(l.total); it.lineIds.push(l.id); } else byKey.set(l.key, { kind: 't12line', id: `t12line:${l.id}`, lineId: l.id, lineIds: [l.id], label: l.label, why: l.why, candidates: l.candidates || [], section: l.section, total: l.total, amount: num(l.total), count: 1 });
      }
      items.push(...byKey.values());
      for (const c of openChecks(d.t12)) items.push({ kind: 't12check', id: `t12check:${c.id}`, checkId: c.id, text: c.text, amount: num(c.amount) });
    }
    const ex = (d.ai && Array.isArray(d.ai.extractions)) ? d.ai.extractions : [];
    ex.forEach((x, i) => (x.fields || []).forEach((f, j) => {
      if (f.applied || f.dismissed) return;
      items.push({ kind: 'ai', id: `ai:${i}:${j}`, ext: i, field: j, key: f.key, label: FIELD_LABEL[f.key] || f.key, value: f.value, doc: f.doc || (x.files || [])[0] || '', page: f.page || null, status: f.status || '', at: x.at, amount: num(f.value) });
    }));
    if (items.length) groups.push({ group: 'deal', id: d.id, name: dealName(d), items: items.sort((a, b) => b.amount - a.amount) });
  }
  for (const t of templates) {
    if (!t || t.archived || !t.mapping || !Array.isArray(t.mapping.cells)) continue;
    const items = t.mapping.cells.map((c, i) => ({ c, i })).filter(({ c }) => c.confidence === 'low')
      .map(({ c, i }) => ({ kind: 'tpl', id: `tpl:${i}`, cell: i, sheet: c.sheet, ref: c.cell, field: c.field, label: FIELD_LABEL[c.field] || c.field, why: c.why || '', amount: 0 }));
    if (items.length) groups.push({ group: 'template', id: t.id, name: t.name || 'Untitled template', items });
  }
  const atStake = (g) => g.items.reduce((s, x) => s + x.amount, 0);
  return groups.sort((a, b) => (a.group === b.group ? atStake(b) - atStake(a) : a.group === 'deal' ? -1 : 1));
}

/** How many items, for the tab's badge. */
export const reviewCount = (groups) => groups.reduce((s, g) => s + g.items.length, 0);
