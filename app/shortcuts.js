/* shortcuts.js -- every key the app answers to, in one list, and the sheet
 * that shows it: "?" anywhere you aren't typing, "Keyboard shortcuts" in the
 * search (⌘K) and in Settings.
 *
 * The list is the record: tests/shortcuts.test.js reads each keydown handler
 * in app/ and fails if one answers to a key that isn't listed here for that
 * file, or if a listed key is no longer handled. */

/* (no kit.js: the list is read by the tests in Node, where kit.js can't load) */
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };

/** ⌘ on a Mac, iPhone or iPad keyboard; Ctrl elsewhere. */
export const MAC = /Mac|iPhone|iPad/.test(globalThis.navigator ? navigator.platform || navigator.userAgent : '');

/**
 * @typedef {Object} Shortcut
 * @property {string} group where it works
 * @property {string[][]} keys each way to press it, as its keys in order ('Mod' is ⌘ or Ctrl)
 * @property {string} does
 * @property {string[]} src the files whose keydown handlers answer to it
 * @property {string[]} listen the KeyboardEvent.key values those handlers compare (lower case for letters)
 * @property {boolean} [shown] false: handled, but as any control of its kind is (left off the sheet)
 */

/** @type {Shortcut[]} */
export const SHORTCUTS = [
  { group: 'Anywhere', keys: [['?']], does: 'Show these shortcuts', src: ['shortcuts.js'], listen: ['?'] },
  { group: 'Anywhere', keys: [['Mod', 'K']], does: 'Search deals, contacts and tools, and run an action', src: ['command.js'], listen: ['k'] },
  { group: 'Anywhere', keys: [['/']], does: 'The same search, when you aren’t typing in a field', src: ['command.js'], listen: ['/'] },
  { group: 'Anywhere', keys: [['Esc']], does: 'Close the sheet or the search', src: [], listen: [] },
  { group: 'In the search', keys: [['↑'], ['↓']], does: 'Move through the results', src: ['command.js'], listen: ['ArrowUp', 'ArrowDown'] },
  { group: 'In the search', keys: [['Enter']], does: 'Open the result', src: ['command.js'], listen: ['Enter'] },
  { group: 'In a deal', keys: [['Mod', 'Z']], does: 'Undo the last change to the deal', src: ['dealui.js'], listen: ['z'] },
  { group: 'In a deal', keys: [['Shift', 'Mod', 'Z'], ['Ctrl', 'Y']], does: 'Redo it', src: ['dealui.js'], listen: ['y'] },
  { group: 'In a deal', keys: [['←'], ['→']], does: 'Move between the deal’s tabs, once one has the focus', src: ['dealui.js'], listen: ['ArrowLeft', 'ArrowRight'] },
  { group: 'In a deal', keys: [['Enter']], does: 'Finish renaming the deal', src: ['dealui.js'], listen: ['Enter'] },
  { group: 'In a deal', keys: [['Enter'], ['Space']], does: 'On a figure: how it’s worked out, and what it affects', src: ['dealui.js'], listen: ['Enter', ' '] },
  { group: 'In the rent roll', keys: [['↑'], ['↓']], does: 'The cell above or below', src: ['rentrollui.js'], listen: ['ArrowUp', 'ArrowDown'] },
  { group: 'In the rent roll', keys: [['←'], ['→']], does: 'The cell to the left or right, from the start or end of its text', src: ['rentrollui.js'], listen: ['ArrowLeft', 'ArrowRight'] },
  { group: 'In the rent roll', keys: [['Enter']], does: 'Keep the cell and go down', src: ['rentrollui.js'], listen: ['Enter'] },
  { group: 'In the rent roll', keys: [['Esc']], does: 'Put the cell back as it was', src: ['rentrollui.js'], listen: ['Escape'] },
  { group: 'Settings', keys: [['←'], ['→']], does: 'Choose the theme, once the theme control has the focus', src: ['theme.js'], listen: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'] },
];

/** A key as it is shown: ⌘ or Ctrl for 'Mod', ⇧ or Shift. */
export const keyLabel = (k, mac = MAC) => (k === 'Mod' ? (mac ? '⌘' : 'Ctrl') : k === 'Shift' ? (mac ? '⇧' : 'Shift') : k === 'Ctrl' ? (mac ? '⌃' : 'Ctrl') : k);

/** The shortcuts as the sheet shows them: [{ group, rows: [{ keys: [[labels]], does }] }]. */
export function sheetGroups(mac = MAC) {
  const out = [];
  for (const s of SHORTCUTS) {
    if (s.shown === false) continue;
    let g = out.find((x) => x.group === s.group);
    if (!g) out.push(g = { group: s.group, rows: [] });
    // Ctrl Y is the other redo on Windows and Linux; a Mac has ⇧⌘Z
    const ways = mac ? s.keys.filter((w) => !(w.length === 2 && w[0] === 'Ctrl')) : s.keys;
    g.rows.push({ keys: ways.map((w) => w.map((k) => keyLabel(k, mac))), does: s.does });
  }
  return out;
}

let api = null;

/** The sheet: every shortcut, by where it works. */
export function openShortcuts(a = api) {
  if (!a) return;
  const body = a.sheetOpen({ eyebrow: 'Keyboard', title: 'Keyboard shortcuts', sub: 'With a keyboard attached, on a computer or a tablet.' });
  // the list scrolls on a small screen and holds nothing to tab to: the list itself takes the focus, so it scrolls from the keyboard
  body.classList.add('keys-sheet');
  body.tabIndex = 0;
  body.setAttribute('aria-label', 'Keyboard shortcuts');
  const dlg = body.closest('dialog');
  if (dlg) dlg.addEventListener('close', () => { body.classList.remove('keys-sheet'); body.removeAttribute('tabindex'); body.removeAttribute('aria-label'); }, { once: true });
  for (const g of sheetGroups()) {
    const sec = el('section', 'keys-group');
    sec.appendChild(el('h3', 'sec-label', g.group));
    const dl = el('dl', 'keys-list');
    for (const r of g.rows) {
      const dt = el('dt', 'keys');
      r.keys.forEach((way, i) => {
        if (i) dt.appendChild(el('span', 'keys-or', 'or'));
        for (const k of way) dt.appendChild(el('kbd', 'kbd', k));
      });
      dl.append(dt, el('dd', null, r.does));
    }
    sec.appendChild(dl);
    body.appendChild(sec);
  }
}

export function initShortcuts(a) {
  api = a;
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('[data-shortcuts]')) openShortcuts(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
    const t = e.target;
    const typing = t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
    if (typing || document.querySelector('dialog[open]')) return;
    e.preventDefault();
    openShortcuts();
  });
}
