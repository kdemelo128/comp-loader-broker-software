/* settings.js -- the Settings screen: appearance, templates, pipeline
 * stages, the AI connection, and the data kept on this device. Each row
 * opens the real control; nothing here is decorative. */

import { $, el, svg } from './kit.js';
import { getTheme } from './theme.js';
import * as ai from './ai.js';
import { renderDataCard } from './backupui.js';
import { openAiSettings } from './aiui.js';
import { openTemplates } from './dealui.js';
import { editStages } from './home.js';
import { listTemplates } from './library.js';
import { VERSION } from './exporters.js';

let api = null;

const section = (title, id, sub) => {
  const c = el('section', 'card');
  if (id) c.id = id;
  const h = el('div', 'card-head');
  h.appendChild(el('h2', null, title));
  if (sub) h.appendChild(el('span', 'count', sub));
  c.appendChild(h);
  return c;
};
const row = (title, desc, controls) => {
  const r = el('li', 'set-row');
  const t = el('div', 'set-text');
  t.appendChild(el('b', null, title));
  if (desc) t.appendChild(el('span', null, desc));
  const c = el('div', 'set-ctl');
  for (const x of controls) c.appendChild(x);
  r.append(t, c);
  return r;
};
const btn = (label, fn, cls = '') => { const b = el('button', `btn btn-sm ${cls}`.trim(), label); b.type = 'button'; b.addEventListener('click', fn); return b; };

export async function renderSettings() {
  const root = $('settings-root');
  if (!root) return;
  const [aiSet, templates] = await Promise.all([ai.getSettings(), listTemplates().catch(() => [])]);
  root.textContent = '';
  const head = el('div', 'view-head');
  head.appendChild(el('h1', null, 'Settings'));
  head.appendChild(el('p', null, 'How the app looks, the templates and stages your firm uses, the AI connection, and your data on this device.'));
  root.appendChild(head);
  const stack = el('div', 'stack');

  // appearance
  const look = section('Appearance', 'settings-look');
  const ul = el('ul', 'set-list');
  const seg = el('div', 'seg theme-seg wide');
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', 'Theme');
  const mode = getTheme();
  for (const [v, label, icon] of [
    ['system', 'System', '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'],
    ['light', 'Light', '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/>'],
    ['dark', 'Dark', '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'],
  ]) {
    const b = el('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.dataset.themeSet = v;
    b.setAttribute('aria-checked', String(v === mode));
    b.innerHTML = svg(icon, 15);
    b.appendChild(el('span', null, label));
    seg.appendChild(b);
  }
  ul.appendChild(row('Theme', 'System follows your device: light by day, dark at night if it is set to switch.', [seg]));
  look.appendChild(ul);
  stack.appendChild(look);

  // templates and reports
  const tpl = section('Templates and reports', 'settings-templates');
  const tl = el('ul', 'set-list');
  const live = templates.filter((t) => !t.archived).length;
  tl.appendChild(row('Template library', live ? `${live} workbook${live === 1 ? '' : 's'} mapped and ready to fill from any deal.` : 'Map your firm’s underwriting or rent roll workbook once, then fill it for any deal.', [btn('Open library', () => openTemplates())]));
  tl.appendChild(row('Comp workbook output', 'Choose between the Comp Loader workbook and your own comp template on the Comps screen.', [btn('Go to Comps', () => api.showView('comps'))]));
  tpl.appendChild(tl);
  stack.appendChild(tpl);

  // pipeline
  const pipe = section('Pipeline', 'settings-pipeline');
  const pl = el('ul', 'set-list');
  pl.appendChild(row('Deal stages', 'Rename stages to your firm’s words, or hide the ones you do not use.', [btn('Edit stages', () => editStages())]));
  pipe.appendChild(pl);
  stack.appendChild(pipe);

  // AI
  const aic = section('AI', 'settings-ai', ai.isReady(aiSet) ? 'on' : 'off');
  const al = el('ul', 'set-list');
  let host = '';
  try { host = aiSet.url ? new URL(aiSet.url).host : ''; } catch { host = aiSet.url; }
  al.appendChild(row('AI server', ai.isReady(aiSet) ? `On, through ${host}. Documents, questions and recordings are sent only when you confirm each one.` : 'Off. Reading documents with AI, the deal assistant and transcription need your firm’s AI server; with AI off nothing leaves this device.', [btn('AI settings…', () => openAiSettings(api))]));
  aic.appendChild(al);
  stack.appendChild(aic);

  // data
  const data = el('section', 'card');
  data.id = 'settings-data';
  stack.appendChild(data);

  // about
  const about = section('About', 'settings-about', `Comp Loader ${VERSION}`);
  const p = el('div', 'about');
  p.appendChild(el('p', null, 'Everything you add (deals, comps, templates, tasks, contacts, recordings) is kept in this browser on this device. Nothing is uploaded unless you turn AI on and confirm a send.'));
  const k = el('p');
  k.style.marginTop = '8px';
  k.append('Press ', Object.assign(el('kbd', 'kbd', '⌘K'), {}), ' or ', el('kbd', 'kbd', 'Ctrl K'), ' anywhere to search deals, contacts and tools.');
  p.appendChild(k);
  p.appendChild(Object.assign(el('p', null, '© 2026 Kyle Alexander De Melo · MIT License'), { style: 'margin-top:8px' }));
  about.appendChild(p);
  stack.appendChild(about);

  root.appendChild(stack);
  await renderDataCard(data, api);
}

export function initSettings(compsApi) {
  api = compsApi;
  let visible = false;
  document.addEventListener('viewchange', (e) => { visible = e.detail === 'settings'; if (visible) renderSettings(); });
  document.addEventListener('crmchange', () => { if (visible) renderSettings(); });
}
