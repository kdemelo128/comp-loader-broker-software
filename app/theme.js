/* theme.js -- light, dark, or whatever the system says. The choice is kept
 * on this device and applied by a tiny script in index.html before the page
 * first paints; this module changes it and keeps every control in step. */

const KEY = 'zlatura.theme';
const BAR = { light: '#F7F6F3', dark: '#0F1012' };

export function getTheme() {
  try { const t = localStorage.getItem(KEY); return t === 'light' || t === 'dark' ? t : 'system'; } catch { return 'system'; }
}
/** The theme actually showing: the choice, or the system's when the choice is "system". */
export const effectiveTheme = () => {
  const t = getTheme();
  return t !== 'system' ? t : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
};

export function setTheme(t) {
  const mode = t === 'light' || t === 'dark' ? t : 'system';
  try { if (mode === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, mode); } catch { /* blocked: this session only */ }
  if (mode === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = mode;
  sync();
  document.dispatchEvent(new CustomEvent('themechange', { detail: mode }));
}

/** Every appearance control on the page shows the current choice; the browser bar matches the page. */
export function sync() {
  const mode = getTheme();
  document.querySelectorAll('[data-theme-set]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themeSet === mode)));
  const eff = effectiveTheme();
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    // with a fixed choice both tags show it; with "system" each keeps its own media query
    m.setAttribute('content', mode === 'system' ? (m.media.includes('dark') ? BAR.dark : BAR.light) : BAR[eff]);
  });
}

export function initTheme() {
  // one listener for every appearance control, now or later drawn
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme-set]');
    if (b) setTheme(b.dataset.themeSet);
  });
  // radio-group keys: arrows move the choice
  document.addEventListener('keydown', (e) => {
    const b = e.target.closest && e.target.closest('[data-theme-set]');
    if (!b || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const all = [...b.parentElement.querySelectorAll('[data-theme-set]')];
    const i = (all.indexOf(b) + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length;
    e.preventDefault();
    setTheme(all[i].dataset.themeSet);
    all[i].focus();
  });
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', sync);
  sync();
}
