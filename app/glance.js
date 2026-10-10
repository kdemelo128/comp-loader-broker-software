/* glance.js -- the comp set at a glance: headline figures and two charts.
 *
 * The bars rank every included comp by $/SF, sold and asking in one view, so
 * where asking prices sit against closed deals is visible at once. The scatter
 * plots sold $/SF against sale date with a least-squares trend line, the same
 * fit the workbook's Summary reports. Colour carries the set (sold blue, asking
 * orange); every mark also has a text label or a tooltip, so nothing depends on
 * colour alone. */
import { isPriced } from './engine/comps.js';
import * as S from './stats.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, text) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
};
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
};

// one rule for which comps count toward $/SF (engine/comps.js)
const ppsf = (c) => (isPriced(c) ? c.price / c.bsf : null);
const money0 = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const money2 = (n) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthYear = (d) => `${mon[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
const mdy = (d) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;

/* ---------------------------------------------------------------- tooltip */

let tipEl = null;
function tip(html, x, y) {
  if (!tipEl) {
    tipEl = el('div', 'tip');
    tipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(tipEl);
  }
  tipEl.textContent = '';
  for (const [k, v] of html) {
    const line = el('div');
    if (k) line.appendChild(document.createTextNode(`${k} `));
    line.appendChild(el('b', null, v));
    tipEl.appendChild(line);
  }
  tipEl.hidden = false;
  const r = tipEl.getBoundingClientRect();
  const left = Math.min(window.innerWidth - r.width - 8, Math.max(8, x + 14));
  const top = y + r.height + 18 > window.innerHeight ? y - r.height - 12 : y + 14;
  tipEl.style.left = `${left}px`;
  tipEl.style.top = `${top}px`;
}
function hideTip() { if (tipEl) tipEl.hidden = true; }

function hover(node, rows) {
  node.setAttribute('tabindex', '0');
  // a focusable shape that names one data point: an image, to assistive tech
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', rows.map(([k, v]) => `${k} ${v}`).join(', '));
  node.addEventListener('pointerenter', (e) => tip(rows, e.clientX, e.clientY));
  node.addEventListener('pointermove', (e) => tip(rows, e.clientX, e.clientY));
  node.addEventListener('pointerleave', hideTip);
  node.addEventListener('focus', () => {
    const b = node.getBoundingClientRect();
    tip(rows, b.right, b.top);
  });
  node.addEventListener('blur', hideTip);
}

/* ------------------------------------------------------------------- ticks */

function niceStep(span, target) {
  const raw = span / Math.max(1, target);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
}
function ticks(lo, hi, target = 4) {
  if (!(hi > lo)) return [lo];
  const step = niceStep(hi - lo, target);
  const out = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) out.push(t);
  return out;
}

/* ------------------------------------------------------------- headlines */

export function renderKpis(box, sales, market, subject) {
  box.textContent = '';
  const priced = (list) => list.filter((c) => ppsf(c) !== null);
  const wavg = (list) => {
    const p = priced(list);
    const sf = p.reduce((s, c) => s + c.bsf, 0);
    return sf ? p.reduce((s, c) => s + c.price, 0) / sf : null;
  };
  const soldMed = S.median(sales.map(ppsf));
  const askMed = S.median(market.map(ppsf));
  const today = Date.now();
  const recent = sales.filter((c) => c.date && (today - new Date(c.date).getTime()) / 86400000 / 30.44 <= 18).length;

  const kpi = (k, v, s, warn = false) => {
    const d = el('div', `kpi${warn ? ' warn' : ''}`);
    d.appendChild(el('div', 'k', k));
    d.appendChild(el('div', 'v', v));
    if (s) d.appendChild(el('div', 's', s));
    box.appendChild(d);
  };
  const sw = wavg(sales);
  kpi('Sold · SF-weighted', sw ? `${money0(sw)}/SF` : '—',
    sales.length ? `${sales.length} sale${sales.length === 1 ? '' : 's'}${soldMed ? ` · median ${money0(soldMed)}` : ''}` : 'no sale comps');
  const aw = wavg(market);
  const unpriced = market.length - priced(market).length;
  kpi('Asking · SF-weighted', aw ? `${money0(aw)}/SF` : '—',
    market.length ? `${market.length} listing${market.length === 1 ? '' : 's'}${unpriced ? ` · ${unpriced} unpriced` : ''}` : 'no listings');
  if (soldMed && askMed) {
    const prem = askMed / soldMed - 1;
    kpi('Asking premium', `${prem >= 0 ? '+' : ''}${(prem * 100).toFixed(1)}%`, 'median asking against median sold');
  }
  if (sales.length) {
    kpi('Sales in 18 months', String(recent), recent < 5 ? 'thin set: lean on market knowledge' : 'enough to support a value', recent < 5);
  }
  if (subject && subject.bsf && soldMed) {
    kpi('Subject at median', money0(soldMed * subject.bsf), `${Math.round(subject.bsf).toLocaleString('en-US')} SF × median sold $/SF`);
  }
}

/* ------------------------------------------------------ ranked $/SF bars */

export function renderRank(box, legendBox, sales, market) {
  box.textContent = '';
  legendBox.textContent = '';
  const items = [
    ...sales.map((c) => ({ c, set: 'sale' })),
    ...market.map((c) => ({ c, set: 'list' })),
  ].filter((x) => ppsf(x.c) !== null).sort((a, b) => ppsf(b.c) - ppsf(a.c));
  if (!items.length) { box.appendChild(el('p', 'empty-chart', 'No priced comps to rank yet.')); return; }

  const sets = new Set(items.map((x) => x.set));
  for (const [k, name] of [['sale', 'Sold'], ['list', 'Asking']]) {
    if (!sets.has(k)) continue;
    const s = el('span');
    const sw = el('i');
    sw.style.background = `var(--${k === 'sale' ? 'sale' : 'list'})`;
    s.appendChild(sw);
    s.appendChild(document.createTextNode(name));
    legendBox.appendChild(s);
  }

  const W = 560;
  const L = 168;                    // name column
  const R = 64;                     // value label room
  const row = 22;
  const barH = 14;
  const top = 4;
  const H = top + items.length * row + 22;
  const max = Math.max(...items.map((x) => ppsf(x.c)));
  const tks = ticks(0, max, 4);
  const xmax = Math.max(max, tks[tks.length - 1]);
  const x = (v) => L + (v / xmax) * (W - L - R);
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${items.length} comps ranked by dollars per square foot` });

  for (const t of tks) {
    s.appendChild(svg('line', { class: 'grid', x1: x(t), x2: x(t), y1: top - 2, y2: H - 18 }));
    s.appendChild(svg('text', { class: 'axis', x: x(t), y: H - 4, 'text-anchor': 'middle' }, `$${Math.round(t).toLocaleString('en-US')}`));
  }
  items.forEach(({ c, set }, i) => {
    const y = top + i * row + (row - barH) / 2;
    const v = ppsf(c);
    const name = c.name.length > 26 ? `${c.name.slice(0, 25)}…` : c.name;
    s.appendChild(svg('text', { class: 'lbl', x: L - 8, y: y + barH - 3, 'text-anchor': 'end' }, name));
    const g = svg('g');
    const hit = svg('rect', { class: 'hit', x: 0, y: top + i * row, width: W, height: row });
    // 4px rounded data end, square at the baseline
    const w = Math.max(2, x(v) - L);
    const r = Math.min(4, w / 2);
    const d = `M${L},${y} h${w - r} a${r},${r} 0 0 1 ${r},${r} v${barH - 2 * r} a${r},${r} 0 0 1 -${r},${r} h-${w - r} z`;
    const bar = svg('path', { d, class: `bar-mark ${set === 'sale' ? 'mark-sale' : 'mark-list'}` });
    g.appendChild(hit);
    g.appendChild(bar);
    s.appendChild(g);
    s.appendChild(svg('text', { class: 'val', x: x(v) + 5, y: y + barH - 3 }, money0(v)));
    const when = set === 'sale' ? (c.date ? `sold ${mdy(new Date(c.date))}` : 'sale date unknown')
      : (c.dom ? `${c.dom.toLocaleString('en-US')} days on market` : 'on market');
    hover(hit, [
      ['', c.name],
      [set === 'sale' ? 'Sold' : 'Asking', `${money2(v)}/SF`],
      ['Price', money0(c.price)],
      ['Size', `${Math.round(c.bsf).toLocaleString('en-US')} SF`],
      ['', when],
    ]);
  });
  box.appendChild(s);
}

/* ------------------------------------------------- sold $/SF against time */

export function renderTime(box, legendBox, sales) {
  box.textContent = '';
  legendBox.textContent = '';
  const pts = sales.filter((c) => c.date && ppsf(c) !== null)
    .map((c) => ({ c, t: new Date(c.date).getTime(), v: ppsf(c) }));
  if (pts.length < 2) {
    box.appendChild(el('p', 'empty-chart', 'Two or more dated sales are needed to show a trend.'));
    return;
  }
  const xs = pts.map((p) => p.t);
  const ys = pts.map((p) => p.v);
  const slope = S.slope(ys, xs);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const r2 = S.rsq(ys, xs);

  const lg = (cls, text, line = false) => {
    const s = el('span');
    const sw = el('i');
    if (line) { sw.style.height = '0'; sw.style.borderTop = '2px dashed var(--trend)'; sw.style.borderRadius = '0'; sw.style.verticalAlign = '3px'; }
    else sw.style.background = 'var(--sale)';
    s.appendChild(sw);
    s.appendChild(document.createTextNode(text));
    legendBox.appendChild(s);
  };
  lg('dot', 'Sale');
  if (slope !== null) {
    const perYear = slope * 365.25 * 86400000;
    lg('trend', `Trend ${perYear >= 0 ? '+' : '−'}${money0(Math.abs(perYear))}/SF a year${r2 !== null ? ` · R² ${r2.toFixed(2)}` : ''}`, true);
  }

  const W = 480;
  const H = 260;
  const P = { l: 52, r: 12, t: 10, b: 26 };
  const tlo = Math.min(...xs);
  const thi = Math.max(...xs);
  const pad = Math.max(15 * 86400000, (thi - tlo) * 0.05);
  const x0 = tlo - pad;
  const x1 = thi + pad;
  const ylo = Math.min(...ys);
  const yhi = Math.max(...ys);
  const yt = ticks(ylo * 0.9, yhi * 1.05, 4);
  const y0 = Math.min(yt[0], ylo * 0.9);
  const y1 = Math.max(yt[yt.length - 1], yhi * 1.05);
  const X = (t) => P.l + ((t - x0) / (x1 - x0)) * (W - P.l - P.r);
  const Y = (v) => H - P.b - ((v - y0) / (y1 - y0)) * (H - P.t - P.b);
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${pts.length} sales plotted by dollars per square foot over time` });

  for (const t of yt) {
    s.appendChild(svg('line', { class: 'grid', x1: P.l, x2: W - P.r, y1: Y(t), y2: Y(t) }));
    s.appendChild(svg('text', { class: 'axis', x: P.l - 6, y: Y(t) + 3.5, 'text-anchor': 'end' }, `$${Math.round(t).toLocaleString('en-US')}`));
  }
  // month ticks: about five, on the first of a month
  const span = (x1 - x0) / (86400000 * 30.44);
  const every = span > 48 ? 12 : span > 24 ? 6 : span > 10 ? 3 : 1;
  const start = new Date(x0);
  let d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  while (d.getUTCMonth() % every !== 0) d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  for (; d.getTime() <= x1; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + every, 1))) {
    s.appendChild(svg('text', { class: 'axis', x: X(d.getTime()), y: H - 8, 'text-anchor': 'middle' }, monthYear(d)));
  }
  if (slope !== null) {
    const a = my - slope * mx;
    s.appendChild(svg('line', { class: 'trend', x1: X(tlo), y1: Y(a + slope * tlo), x2: X(thi), y2: Y(a + slope * thi) }));
  }
  for (const p of pts) {
    const dot = svg('circle', { class: 'dot', cx: X(p.t), cy: Y(p.v), r: 5.5 });
    s.appendChild(dot);
    hover(dot, [
      ['', p.c.name],
      ['Sold', `${money2(p.v)}/SF`],
      ['on', mdy(new Date(p.t))],
      ['Price', money0(p.c.price)],
    ]);
  }
  box.appendChild(s);
}
