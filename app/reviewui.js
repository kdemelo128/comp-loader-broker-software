/* reviewui.js -- the Review Queue: everything waiting for a person, across
 * deals and firm templates (review.js works out what). The Review tab shows
 * only when something is waiting, with a count, as the Deals tab does.
 * Each action records itself where the item lives: a deal's change goes in
 * its history (and can be undone); a template's in the template. */

import { el, toast, money0 } from './kit.js';
import { reviewItems, reviewCount } from './review.js';
import { listAllDeals, updateDeal, showDeal, openTemplates } from './dealui.js';
import { listTemplates, putTemplate } from './library.js';
import { CATEGORY, markSeen } from './t12.js';
import { categorySelect, fileT12Line } from './t12ui.js';

let visible = false;
let drawing = 0;
const $ = (id) => document.getElementById(id);
const usd = (x) => (typeof x === 'number' && Number.isFinite(x) ? (x < 0 ? `−${money0(-x)}` : money0(x)) : String(x ?? ''));

async function gather() {
  const [deals, templates] = await Promise.all([listAllDeals(), listTemplates()]);
  return reviewItems({ deals, templates });
}

/** The tab: shown only with something waiting, with how many. */
async function refreshTab(groups = null) {
  const g = groups || await gather();
  const n = reviewCount(g);
  document.querySelectorAll('.tab[data-view="review"]').forEach((t) => {
    t.hidden = n === 0 && !visible;
    const b = t.querySelector('.badge');
    b.hidden = !n;
    b.textContent = n ? String(n) : '';
    t.setAttribute('aria-label', n ? `Review, ${n} item${n === 1 ? '' : 's'} waiting` : 'Review');
  });
  return g;
}

async function render() {
  const root = $('review-root');
  if (!root) return;
  const ticket = ++drawing;
  const groups = await gather();
  if (ticket !== drawing) return;
  await refreshTab(groups);
  root.textContent = '';
  const head = el('div', 'view-head');
  head.appendChild(el('h1', null, 'Review'));
  const n = reviewCount(groups);
  head.appendChild(el('p', null, n ? `${n} item${n === 1 ? '' : 's'} waiting, most money at stake first. Each choice is recorded where it belongs, and on a deal it can be undone.` : 'Nothing is waiting. T-12 lines to file, T-12 figures that don’t add up, AI readings not yet applied and template cells mapped with low confidence appear here.'));
  root.appendChild(head);
  const stack = el('div', 'stack');
  for (const g of groups) stack.appendChild(groupCard(g));
  root.appendChild(stack);
}

function groupCard(g) {
  const c = el('section', 'card review-group');
  c.dataset.group = `${g.group}:${g.id}`;
  const h = el('div', 'card-head');
  h.appendChild(el('h2', null, g.name));
  h.appendChild(el('span', 'count', `${g.group === 'deal' ? 'Deal' : 'Firm template'} · ${g.items.length} item${g.items.length === 1 ? '' : 's'}`));
  const open = el('button', 'btn btn-sm btn-gray', g.group === 'deal' ? 'Open the deal' : 'Open the templates');
  open.type = 'button';
  open.addEventListener('click', () => (g.group === 'deal' ? showDeal(g.id) : openTemplates()));
  h.appendChild(open);
  c.appendChild(h);
  const ul = el('ul', 'review-list');
  for (const it of g.items) ul.appendChild(itemRow(g, it));
  c.appendChild(ul);
  return c;
}

function itemRow(g, it) {
  const li = el('li', `review-item review-${it.kind}`);
  li.dataset.item = it.id;
  const text = el('div', 'review-text');
  const acts = el('div', 'review-acts');
  const btn = (label, cls, fn) => { const b = el('button', `btn btn-sm ${cls}`, label); b.type = 'button'; b.addEventListener('click', fn); acts.appendChild(b); return b; };
  if (it.kind === 't12line') {
    text.append(el('b', null, `T-12 line: ${it.label}`), el('span', 'sub', ` ${usd(it.total)}${it.count > 1 ? ` · ${it.count} lines with this label` : ''} · ${it.why}`));
    const sel = categorySelect({ category: null, candidates: it.candidates });
    sel.setAttribute('aria-label', `Category for ${it.label}`);
    const rem = el('label', 'check');
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = true;
    rem.append(cb, ' Remember this label');
    const file = btn('File it', 'btn-primary', async () => {
      if (!sel.value) { sel.focus(); toast('Choose a category first.'); return; }
      const cat = sel.value;
      await updateDeal(g.id, async (d) => {
        if (!d.t12) return false;
        await fileT12Line(d, it.lineId, cat, { sameLabel: true, remember: cb.checked });
        return true;
      }, { kind: 'edit', label: `T-12: “${it.label}” filed under ${CATEGORY[cat].label.toLowerCase()}${it.count > 1 ? ` (${it.count} lines)` : ''}` });
      changed(`“${it.label}” filed under ${CATEGORY[cat].label.toLowerCase()}.`);
    });
    file.disabled = false;
    acts.prepend(sel);
    acts.appendChild(rem);
  } else if (it.kind === 't12check') {
    text.append(el('b', null, 'T-12: '), el('span', null, it.text));
    btn('Seen', 'btn-gray', async () => {
      await updateDeal(g.id, (d) => { if (!d.t12) return false; markSeen(d.t12, it.checkId); return true; }, { kind: 'edit', label: 'T-12: a check marked seen' });
      changed('Marked seen. It stays on the T-12 card.');
    });
  } else if (it.kind === 'ai') {
    text.append(el('b', null, `AI reading not applied: ${it.label} ${typeof it.value === 'number' ? usd(it.value) : `“${it.value}”`}`), el('span', 'sub', ` ${it.doc}${it.page ? `, page ${it.page}` : ''}${it.status ? ` · ${it.status.replace(/-/g, ' ')}` : ''}`));
    btn('Dismiss', 'btn-gray', async () => {
      await updateDeal(g.id, (d) => { const f = d.ai && d.ai.extractions[it.ext] && d.ai.extractions[it.ext].fields[it.field]; if (!f) return false; f.dismissed = true; return true; }, { kind: 'edit', label: `AI reading of ${it.label.toLowerCase()} dismissed` });
      changed('Dismissed.');
    });
  } else if (it.kind === 'tpl') {
    text.append(el('b', null, `Template cell ${it.sheet}!${it.ref} → ${it.label}`), el('span', 'sub', ` mapped with low confidence${it.why ? `: ${it.why}` : ''}`));
    btn('It’s right', 'btn-gray', async () => {
      const list = await listTemplates();
      const t = list.find((x) => x.id === g.id);
      const cell = t && t.mapping.cells[it.cell];
      if (!cell) return;
      cell.confidence = 'high';
      cell.why = 'confirmed by you';
      try { await putTemplate(t); } catch (e) { toast(e.message); return; }
      changed('Confirmed.');
    });
  }
  li.append(text, acts);
  return li;
}

function changed(msg) {
  document.dispatchEvent(new CustomEvent('reviewchange'));
  toast(msg);
}

export function initReview() {
  document.addEventListener('viewchange', (e) => { visible = e.detail === 'review'; if (visible) render(); else refreshTab(); });
  const again = () => { if (visible) render(); else refreshTab(); };
  let timer = null;
  document.addEventListener('reviewchange', again);
  // a deal edit can add or settle items (a T-12 imported, a line filed on the deal screen): counted again once the typing stops
  document.addEventListener('dealchange', () => { clearTimeout(timer); timer = setTimeout(again, 300); });
  refreshTab();
}
