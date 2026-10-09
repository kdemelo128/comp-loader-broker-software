/* kit.js -- the small things every screen shares: building elements, reading
 * numbers the way brokers type them, formatting, toasts, sheets, and handing
 * a finished file to the person. */

export const $ = (id) => document.getElementById(id);
export const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  // a sideways-scrolling table must be reachable from the keyboard (WCAG 2.1.1)
  if (tag === 'div' && cls && /(^|\s)scroll(\s|$)/.test(cls)) n.tabIndex = 0;
  return n;
};
export const svg = (paths, size = 18, extra = '') => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${paths}</svg>`;

export const IN_ARTIFACT = !!(window.claude && typeof window.claude.use === 'function');
export const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/* ------------------------------------------------------------- numbers */

const ok = (n) => typeof n === 'number' && Number.isFinite(n);

/** Numbers as brokers type them: "$5,200,000", "5.2m", "5.2MM", "850k", "6.25%", "(12,000)". */
export function parseNum(s) {
  if (s === null || s === undefined) return null;
  let t = String(s).trim().toLowerCase().replace(/[$,\s]/g, '').replace(/%$/, '');
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (t === '') return null;
  const m = /^(-?\d*\.?\d+)(k|mm|m|b)?$/.exec(t);
  if (!m) return null;
  const v = Number(m[1]) * ({ k: 1e3, m: 1e6, mm: 1e6, b: 1e9 }[m[2]] || 1);
  return Number.isFinite(v) ? (neg ? -v : v) : null;
}
/** A rate typed as a fraction (0.065) means 6.5%. */
export const asPercent = (v) => (v !== null && v > 0 && v < 1 ? Math.round(v * 1e6) / 1e4 : v);

/**
 * A percentage as typed. "6.25", "6.25%" and, where `fraction` is allowed,
 * "0.0625" all mean 6.25%. A number written with a % sign is always taken as
 * printed, and fields where a value under 1% is ordinary (closing costs,
 * transfer tax, commission) pass `fraction: false`, so "0.5" stays 0.5%
 * rather than becoming 50%.
 */
export function parsePct(raw, { fraction = true } = {}) {
  const v = parseNum(raw);
  if (v === null) return null;
  if (!fraction || /%\s*\)?\s*$/.test(String(raw).trim())) return v;
  return asPercent(v);
}

export const int = (n) => (ok(n) ? Math.round(n).toLocaleString('en-US') : '');
export const dec = (n, d = 2) => (ok(n) ? String(Math.round(n * 10 ** d) / 10 ** d) : '');
export const money0 = (n) => (ok(n) ? `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}` : '—');
export const money2 = (n) => (ok(n)
  ? `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—');
export const pct = (n, d = 2) => (ok(n) ? `${n.toFixed(d)}%` : '—');
export const signed = (n, d = 1) => (ok(n) ? `${n > 0 ? '+' : ''}${n.toFixed(d)}%` : '—');
export const times = (n) => (ok(n) ? `${n.toFixed(2)}x` : '—');
export const yrs = (n) => (ok(n) ? `${n.toFixed(1)} yrs` : '—');
/** $6.45M, $850K: for tiles where width is tight. */
export const short = (n) => {
  if (!ok(n)) return '—';
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e8 ? 0 : 2)}M`;
  if (a >= 1e4) return `${sign}$${Math.round(a / 1e3)}K`;
  return money0(n);
};

export const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const niceDate = (d) => (d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');

/* --------------------------------------------------------------- toast */

let toastTimer = null;
export function toast(msg, action = null, ms = 4200) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  clearTimeout(toastTimer);
  const t = el('div', 'toast');
  t.setAttribute('role', 'status');
  t.appendChild(el('span', null, msg));
  if (action) {
    const b = el('button', null, action.label);
    b.type = 'button';
    b.addEventListener('click', () => { t.remove(); action.run(); });
    t.appendChild(b);
  }
  document.body.appendChild(t);
  toastTimer = setTimeout(() => t.remove(), action ? Math.max(ms, 7000) : ms);
}

/* -------------------------------------------------------------- sheets */

/** Open a <dialog> as a sheet: from the bottom on a phone, centred on a desk. */
export function openSheet(dlg) {
  if (typeof dlg.showModal === 'function') { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', '');
  const body = dlg.querySelector('.sheet-body');
  if (body) body.scrollTop = 0;
}
export function closeSheet(dlg) {
  if (typeof dlg.close === 'function' && dlg.open) dlg.close(); else dlg.removeAttribute('open');
}
/** Tapping the dimmed backdrop closes a sheet. */
export function backdropCloses(dlg) {
  dlg.addEventListener('click', (e) => { if (e.target === dlg) closeSheet(dlg); });
}

/** A list of choices in a sheet; resolves with the chosen value or null. */
export function actionSheet(title, items) {
  return new Promise((resolve) => {
    const dlg = el('dialog', 'sheet action-sheet');
    const box = el('div', 'sheet-card');
    if (title) box.appendChild(el('div', 'action-title', title));
    const list = el('div', 'action-list');
    for (const it of items) {
      if (it === '-') { list.appendChild(el('hr')); continue; }
      const b = el('button', `action-item${it.danger ? ' danger' : ''}${it.primary ? ' primary' : ''}`);
      b.type = 'button';
      if (it.icon) b.insertAdjacentHTML('beforeend', svg(it.icon, 20));
      const txt = el('span', 'action-text');
      txt.appendChild(el('span', 'action-label', it.label));
      if (it.sub) txt.appendChild(el('span', 'action-sub', it.sub));
      b.appendChild(txt);
      b.disabled = !!it.disabled;
      b.addEventListener('click', () => { done(it.value); });
      list.appendChild(b);
    }
    box.appendChild(list);
    const cancel = el('button', 'action-cancel', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => done(null));
    dlg.append(box, cancel);
    document.body.appendChild(dlg);
    let settled = false;
    function done(v) {
      if (settled) return;
      settled = true;
      closeSheet(dlg);
      dlg.remove();
      resolve(v);
    }
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) done(null); });
    openSheet(dlg);
  });
}

/* ---------------------------------------------------------- libraries */

let pdfjsP = null;
// Vendor files carry their version in the name, so a cached copy is never
// mistaken for a newer one. The legacy build of pdf.js polyfills what Safari
// before 17.4 lacks; its oldest requirement is Safari 16.4 (iOS 16.4).
const PDFJS = '../vendor/pdf-4.7.76-legacy.min.js';
const PDFJS_WORKER = '../vendor/pdf-4.7.76-legacy.worker.min.js';
export const getPdfjs = () => (pdfjsP ||= import(PDFJS).then((m) => {
  m.GlobalWorkerOptions.workerSrc = new URL(PDFJS_WORKER, import.meta.url).href;
  return m;
}).catch((err) => {
  pdfjsP = null;
  if (err instanceof SyntaxError) {
    throw new Error('this browser is too old to read PDFs. Update to iOS 16.4 or later, or a current Chrome, Edge or Firefox');
  }
  throw err;
}));

const loadScript = (src) => new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = src;
  s.onload = resolve;
  s.onerror = () => reject(new Error(`could not load ${src.split('/').pop()}`));
  document.head.appendChild(s);
});
let xlsxP = null;
export const getXlsx = () => (xlsxP ||= Promise.all([
  window.ExcelJS ? null : loadScript(new URL('../vendor/exceljs-4.4.0.min.js', import.meta.url).href),
  window.fflate ? null : loadScript(new URL('../vendor/fflate-0.8.3.min.js', import.meta.url).href),
]).then(() => ({ ExcelJS: window.ExcelJS, fflate: window.fflate }))
  .catch((e) => { xlsxP = null; throw e; }));
let fflateP = null;
export const getFflate = () => (fflateP ||= (window.fflate ? Promise.resolve() : loadScript(new URL('../vendor/fflate-0.8.3.min.js', import.meta.url).href))
  .then(() => window.fflate).catch((e) => { fflateP = null; throw e; }));

/** Warm a library up while the person is still deciding, so the tap that needs it is instant. */
export const idle = (fn) => (window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 3000 }) : setTimeout(fn, 1200));

/* -------------------------------------------------------- handing over */

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const canShareFiles = () => {
  try {
    return !IN_ARTIFACT && !!navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.xlsx', { type: XLSX })] });
  } catch { return false; }
};

/** Hand a file to the person: through the artifact's save channel when the page
 *  is published as one, through the share sheet where a download link is
 *  unreliable (an iPhone home-screen app), and as an ordinary download otherwise. */
export async function deliver(filename, bytes, type, opts = {}) {
  const r = await handOver(filename, bytes, type, opts);
  // the Home screen keeps a list of what was produced, and for which deal
  if (r === 'done') document.dispatchEvent(new CustomEvent('deliverable', { detail: { name: filename, kind: 'file' } }));
  return r;
}
/** A print (deal brief, comp sheet, a tool's results) counts as a deliverable too. */
export const printed = (name) => document.dispatchEvent(new CustomEvent('deliverable', { detail: { name, kind: 'print' } }));

async function handOver(filename, bytes, type, { share = false } = {}) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type });
  if (IN_ARTIFACT) {
    const downloads = await window.claude.use('downloads').catch(() => null);
    if (downloads) { await downloads.save({ filename, data: blob }); return 'done'; }
  }
  if ((share || (isIOS() && isStandalone())) && canShareFiles()) {
    const file = new File([blob], filename, { type });
    try {
      await navigator.share({ files: [file], title: filename });
      return 'done';
    } catch (err) {
      if (err && err.name === 'AbortError') { const e = new Error('cancelled'); e.code = 'declined'; throw e; }
      // Safari opens the share sheet only straight after a tap, and building the
      // file can outlast that window: offer a fresh tap rather than failing
      if (err && err.name === 'NotAllowedError') {
        toast('Your file is ready.', { label: 'Share', run: () => navigator.share({ files: [file], title: filename }).catch(() => {}) });
        return 'pending';
      }
      if (share) throw err;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = el('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'done';
}

export function deliveryError(err) {
  if (err && err.code === 'declined') toast('Cancelled.');
  else if (err && err.code === 'rate_limited') toast('A save prompt is already open.');
  else toast(`That did not work: ${err?.message || err}`);
}

/** What went wrong with a PDF, said so the person knows what to do next. */
export function pdfProblem(err, file) {
  const msg = String(err && err.message ? err.message : err || '');
  if (err && err.name === 'PasswordException') return 'it is password protected. Ask for an unlocked copy.';
  if ((file && file.size === 0) || /empty|zero bytes/i.test(msg)) return 'the file is empty: it probably did not finish downloading. Download it again.';
  if ((err && err.name === 'InvalidPDFException') || /invalid pdf|pdf structure|missing pdf/i.test(msg)) {
    return 'it is not a readable PDF: it may be damaged or only partly downloaded. Download it again, or export a fresh copy.';
  }
  if (/too old/.test(msg)) return `${msg}.`;
  return `it could not be opened (${msg || 'unknown error'}). Try again, or save a fresh copy of the PDF.`;
}

/** Copy text, with the old-browser fallback. Resolves true when it worked. */
export function copyText(text) {
  const fallback = () => {
    const ta = el('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let done = false;
    try { done = document.execCommand('copy'); } catch { done = false; }
    ta.remove();
    return done;
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).then(() => true, () => fallback());
  }
  return Promise.resolve(fallback());
}

/** Share text through the share sheet where there is one; copy it otherwise. */
export async function shareText(title, text) {
  if (!IN_ARTIFACT && navigator.share) {
    try { await navigator.share({ title, text }); return 'shared'; } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
    }
  }
  return (await copyText(text)) ? 'copied' : 'failed';
}
