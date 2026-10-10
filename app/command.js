/* command.js -- one keyboard-first way to get anywhere: ⌘K (Ctrl K) or "/"
 * opens a search over the deals, contacts and tools on this device and the
 * actions the app really has. Every result does what it says. */

import { el, svg, toast, short, pct } from './kit.js';
import { listAllDeals, showDeal, startDealByHand, openTemplates, impactCommands } from './dealui.js';
import { listContacts } from './crm.js';
import { toolIndex, openToolById } from './toolsui.js';
import { editContact } from './dealcrm.js';
import { makeBackup } from './backupui.js';
import { openAiSettings } from './aiui.js';
import { editStages } from './home.js';
import { setTheme } from './theme.js';
import { STAGE_LABEL, stageOf } from './pipeline.js';

let api = null;
let dlg = null;

const ICON = {
  deal: '<path d="M3 21h18M5 21V8l7-5 7 5v13"/><path d="M9 21v-5h6v5"/>',
  contact: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  tool: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>',
  go: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  act: '<path d="M12 5v14M5 12h14"/>',
  theme: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/>',
};

/** Every query word must appear somewhere; a match at the start of the title ranks first. */
export function rank(items, q) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  const out = [];
  for (const it of items) {
    const hay = `${it.title} ${it.detail || ''} ${it.keywords || ''}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    const t = it.title.toLowerCase();
    const score = (t.startsWith(words[0]) ? 0 : t.includes(words[0]) ? 1 : 2) + (it.weight || 0);
    out.push([score, it]);
  }
  return out.sort((a, b) => a[0] - b[0]).map((x) => x[1]);
}

async function sources() {
  const [deals, contacts] = await Promise.all([listAllDeals().catch(() => []), listContacts().catch(() => [])]);
  const close = () => dlg && dlg.close();
  const items = [];
  for (const d of deals) {
    const f = d.figures || {};
    items.push({
      group: 'Deals', icon: 'deal', title: d.name || f.address || 'Untitled deal',
      detail: [STAGE_LABEL[stageOf(d)], f.ptype, [f.city, f.state].filter(Boolean).join(', '), f.price ? short(f.price) : null, f.cap ? `${pct(f.cap)} cap` : null].filter(Boolean).join(' · '),
      keywords: `${f.address || ''} ${f.tenant || ''}`, run: () => { close(); showDeal(d.id); },
    });
  }
  for (const c of contacts) {
    items.push({ group: 'Contacts', icon: 'contact', title: c.name, detail: [c.role, c.company, c.phone, c.email].filter(Boolean).join(' · '), run: () => { close(); editContact(api, c, deals.map((d) => ({ id: d.id, name: d.name || 'Untitled deal' }))); } });
  }
  for (const t of toolIndex()) items.push({ group: 'Tools', icon: 'tool', title: t.title, detail: `${t.group} · ${t.desc}`, weight: 0.2, run: () => { close(); openToolById(t.id); } });
  const go = (view, title, keywords) => ({ group: 'Go to', icon: 'go', title, keywords, weight: 0.4, run: () => { close(); api.showView(view); } });
  items.push(go('home', 'Home', 'dashboard pipeline tasks'), go('deal', 'Deals', 'deal workspace om'), go('comps', 'Comps', 'comparable sales market'), go('tools', 'Tools', 'calculators'), go('settings', 'Settings', 'preferences appearance backup'));
  const act = (title, detail, run, keywords = '') => ({ group: 'Actions', icon: 'act', title, detail, keywords, weight: 0.3, run: () => { close(); run(); } });
  items.push(
    act('Read an offering memorandum…', 'Choose an OM PDF; its figures are read on this device', () => { api.showView('deal'); document.getElementById('om-file').click(); }, 'om pdf scan new deal'),
    act('Add CoStar comp reports…', 'Choose comp report PDFs for the comp set', () => { api.showView('comps'); document.getElementById('file').click(); }, 'comps pdf'),
    act('New deal by hand', 'Start a deal and type its figures', () => { startDealByHand(); api.showView('deal'); }, 'create'),
    act('New task', 'Add a next step on Home', () => { api.showView('home'); setTimeout(() => { if (!document.activeElement?.matches('input, select, textarea')) document.getElementById('task-title')?.focus(); }, 350); }, 'todo follow up'),
    act('New contact', 'A person on a deal: owner, broker, lender…', () => editContact(api, {}, deals.map((d) => ({ id: d.id, name: d.name || 'Untitled deal' }))), 'person'),
    act('Back up everything', 'One file with every deal, comp set, template and contact', () => makeBackup().catch((e) => toast(`The backup could not be made: ${e.message}`)), 'export save'),
    act('Template library', 'Your firm’s Excel workbooks, mapped to deal fields', () => openTemplates(), 'excel xlsx'),
    act('Edit pipeline stages', 'Rename or hide stages', () => editStages(), 'pipeline'),
    act('AI settings', 'Your firm’s AI server address and access token', () => openAiSettings(api), 'assistant'),
  );
  // the open deal: what each of its inputs affects (the dependency map)
  for (const c of impactCommands()) items.push({ group: 'This deal', icon: 'act', title: c.title, keywords: 'affects impact depends change what if', weight: 0.6, run: () => { close(); c.run(); } });
  for (const [v, label] of [['light', 'Light'], ['dark', 'Dark'], ['system', 'System']]) {
    items.push({ group: 'Appearance', icon: 'theme', title: `Theme: ${label}`, keywords: 'appearance mode', weight: 0.5, run: () => { close(); setTheme(v); toast(`Theme: ${label}.`); } });
  }
  return items;
}

const ORDER = ['Deals', 'Actions', 'This deal', 'Contacts', 'Tools', 'Go to', 'Appearance'];
const ASKS_IMPACT = /\b(affects?|impacts?|depends?|what does)\b/i;

export async function openCommand() {
  if (dlg && dlg.open) { dlg.querySelector('input').focus(); return; }
  // the dialog opens at once so nothing typed is lost while the deals load
  let items = [];
  let loaded = false;
  dlg = el('dialog', 'cmdk');
  dlg.setAttribute('aria-label', 'Search and jump');
  const card = el('div', 'cmdk-card');
  const bar = el('div', 'cmdk-in');
  bar.insertAdjacentHTML('beforeend', svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', 18));
  const input = el('input');
  input.type = 'text';
  input.id = 'cmdk-input';
  input.placeholder = 'Search deals, contacts, tools and actions';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-controls', 'cmdk-list');
  input.setAttribute('aria-autocomplete', 'list');
  bar.appendChild(input);
  const list = el('div', 'cmdk-list');
  list.id = 'cmdk-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Results');
  const foot = el('div', 'cmdk-foot');
  foot.innerHTML = '<span><kbd class="kbd">↑</kbd><kbd class="kbd">↓</kbd> move</span><span><kbd class="kbd">Enter</kbd> open</span><span><kbd class="kbd">Esc</kbd> close</span>';
  card.append(bar, list, foot);
  dlg.appendChild(card);
  document.body.appendChild(dlg);

  let shown = [];
  let sel = 0;
  const select = (i) => {
    sel = Math.max(0, Math.min(shown.length - 1, i));
    list.querySelectorAll('.cmdk-item').forEach((n, k) => n.setAttribute('aria-selected', String(k === sel)));
    const cur = list.querySelector(`#cmdk-opt-${sel}`);
    if (cur) { input.setAttribute('aria-activedescendant', cur.id); cur.scrollIntoView({ block: 'nearest' }); } else input.removeAttribute('aria-activedescendant');
  };
  const draw = () => {
    const q = input.value.trim();
    let r = rank(items, q);
    // "what does … affect?" only when that is what's asked: it would otherwise crowd out deals and contacts ("lender")
    if (!ASKS_IMPACT.test(q)) r = r.filter((x) => x.group !== 'This deal');
    if (!q) r = r.filter((x) => x.group !== 'Contacts' && x.group !== 'Tools' && x.group !== 'Appearance').slice(0, 14);
    // grouped: with a query, the group holding the best match comes first; within a group, best match first
    const order = q ? [...new Set(r.map((x) => x.group))] : ORDER;
    shown = order.flatMap((g) => r.filter((x) => x.group === g).slice(0, q ? 8 : 6));
    list.textContent = '';
    let k = 0;
    for (const g of order) {
      const inG = shown.filter((x) => x.group === g);
      if (!inG.length) continue;
      const head = el('div', 'cmdk-group', g);
      head.setAttribute('role', 'presentation');
      list.appendChild(head);
      for (const it of inG) {
        const n = el('div', 'cmdk-item');
        n.id = `cmdk-opt-${k}`;
        n.setAttribute('role', 'option');
        const ic = el('span', 'ic');
        ic.innerHTML = svg(ICON[it.icon] || ICON.go, 15);
        const tx = el('span', 'tx');
        tx.appendChild(el('div', 't', it.title));
        if (it.detail) tx.appendChild(el('div', 'd', it.detail));
        n.append(ic, tx);
        const idx = k;
        n.addEventListener('mousemove', () => { if (sel !== idx) select(idx); });
        n.addEventListener('click', () => it.run());
        list.appendChild(n);
        k += 1;
      }
    }
    if (!shown.length) list.appendChild(el('div', 'cmdk-empty', loaded ? `Nothing matches “${q}”.` : 'Loading…'));
    select(0);
  };
  input.addEventListener('input', draw);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); select(sel + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); select(sel - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); ready.then(() => { if (shown[sel]) shown[sel].run(); }); }
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => dlg.remove());
  const ready = sources().then((x) => { items = x; }, () => {}).then(() => { loaded = true; if (dlg && dlg.open) draw(); });
  draw();
  dlg.showModal();
  input.focus();
  await ready;
}

export function initCommand(compsApi) {
  api = compsApi;
  document.addEventListener('click', (e) => { if (e.target.closest('[data-cmd]')) openCommand(); });
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openCommand(); }
    else if (e.key === '/' && !typing && !document.querySelector('dialog[open]')) { e.preventDefault(); openCommand(); }
  });
}
