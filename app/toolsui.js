/* toolsui.js -- the Tools screen: the calculators a broker reaches for between
 * meetings, each in a sheet that works one-handed. Inputs are remembered on
 * the device, results update as you type, and every result copies as text. */

import { quickValue, loanTool, offerTool, netEffectiveRent, exchangeDates, waltTool } from './tools.js';
import {
  $, el, svg, parseNum, parsePct, int, money0, money2, pct, signed, times, yrs, niceDate, toast, copyText,
} from './kit.js';

let api = null;
const MEM = 'comp-loader.tools.v1';
let memory = {};
try { memory = JSON.parse(localStorage.getItem(MEM) || '{}') || {}; } catch { memory = {}; }
const remember = () => { try { localStorage.setItem(MEM, JSON.stringify(memory)); } catch { /* fine */ } };

const ok = (x) => typeof x === 'number' && Number.isFinite(x);

/* Each tool: inputs (id, label, kind, placeholder) and a function from the
 * values to result lines [label, value, strong?, why?]. */
const TOOLS = [
  {
    id: 'value', title: 'Quick value', color: '#2350D8',
    desc: 'Any two of price, NOI and cap rate give the third.',
    icon: '<path d="M4 19h16M7 15l3-4 3 2 4-6"/>',
    inputs: [['price', 'Price', 'money', '4.5m'], ['noi', 'NOI', 'money', '280k'], ['cap', 'Cap rate %', 'pct', '6.25'],
      ['bsf', 'Building SF', 'num', 'optional'], ['units', 'Units', 'num', 'optional']],
    run: (v) => {
      const r = quickValue(v);
      return [
        ['Price', money0(r.price), r.solved === 'price', r.solved === 'price' ? 'NOI ÷ cap rate' : null],
        ['NOI', money0(r.noi), r.solved === 'noi', r.solved === 'noi' ? 'price × cap rate' : null],
        ['Cap rate', pct(r.cap), r.solved === 'cap', r.solved === 'cap' ? 'NOI ÷ price' : null],
        ...(ok(r.mismatch) ? [['NOI ÷ price', pct(r.capCalc), true, `not the ${pct(r.cap)} typed: ${Math.abs(r.mismatch).toFixed(2)} points apart`]] : []),
        ['Price per SF', money2(r.ppsf)], ['Price per unit', money0(r.perUnit)], ['NOI per SF', money2(r.noiPsf)],
      ];
    },
  },
  {
    id: 'loan', title: 'Loan sizing', color: '#0E8A7D',
    desc: 'The largest loan by LTV, DSCR and debt yield, and which test binds.',
    icon: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
    inputs: [['price', 'Purchase price', 'money', '4.5m'], ['noi', 'NOI', 'money', '280k'], ['ltv', 'Max LTV %', 'pct', '65'],
      ['rate', 'Interest rate %', 'pct', '6.75'], ['amort', 'Amortization, years', 'num', '30'], ['io', 'Interest only', 'bool'],
      ['minDscr', 'Minimum DSCR', 'num', '1.25'], ['minDy', 'Minimum debt yield %', 'pct', '8']],
    run: (v) => {
      const r = loanTool(v);
      if (!r.sized) return [['Enter a price or NOI, and the lender’s tests', '—']];
      const t = r.sized.tests;
      return [
        ['Maximum loan', money0(r.loan), true, `limited by ${r.sized.binding}`],
        ['By LTV', money0(t.LTV)], ['By DSCR', money0(t.DSCR)], ['By debt yield', money0(t['Debt yield'])],
        ['Loan to value at that loan', pct(r.ltvAtMax, 1)], ['Monthly payment', money0(r.monthly)], ['Annual debt service', money0(r.debtService)],
        ['DSCR at that loan', times(r.dscr)], ['Debt yield at that loan', pct(r.debtYield)], ['Equity needed', money0(r.equity), true, 'before closing costs'],
      ];
    },
  },
  {
    id: 'offer', title: 'Offer and seller net', color: '#C2410C',
    desc: 'Price at a target cap or $/SF, and what the seller nets.',
    icon: '<path d="M20 12V8H6a2 2 0 010-4h12v4M4 6v12a2 2 0 002 2h14v-4"/><path d="M18 12a2 2 0 000 4h4v-4z"/>',
    inputs: [['ask', 'Asking price', 'money', '4.5m'], ['noi', 'NOI', 'money', '280k'], ['targetCap', 'Target cap rate %', 'pct', '6.5'],
      ['bsf', 'Building SF', 'num', '9,000'], ['targetPpsf', 'Target $/SF', 'money', '475'],
      ['price', 'Sale price for the net sheet', 'money', 'blank = price at target cap'], ['commission', 'Commission %', 'pct0', '4'],
      ['transfer', 'Seller’s transfer taxes %', 'pct0', '1.45'], ['other', 'Other closing costs $', 'money', '25k'], ['payoff', 'Loan payoff', 'money', '1.8m']],
    run: (v) => {
      const r = offerTool(v);
      return [
        ['Price at target cap', money0(r.atCap), true, ok(r.atCapVsAsk) ? `${signed(r.atCapVsAsk)} to asking` : null],
        ['Price at target $/SF', money0(r.atPpsf), true, ok(r.atPpsfVsAsk) ? `${signed(r.atPpsfVsAsk)} to asking` : null],
        ['Net sheet price', money0(r.price), false, [ok(r.capAtPrice) ? `${pct(r.capAtPrice)} cap` : null, ok(r.ppsfAtPrice) ? `${money2(r.ppsfAtPrice)}/SF` : null].filter(Boolean).join(' · ') || null],
        ['Commission', money0(r.commission)], ['Transfer taxes', money0(r.transfer)], ['Total selling costs', money0(r.costs)],
        ['Seller’s net proceeds', money0(r.net), true, ok(r.netPct) ? `${pct(r.netPct, 1)} of price, after the payoff` : null],
      ];
    },
    note: 'Transfer and recordation tax rates and who pays them vary by jurisdiction and contract: enter the seller’s share for this deal.',
  },
  {
    id: 'ner', title: 'Net effective rent', color: '#7C3AED',
    desc: 'A lease’s real rent after free rent, TI and commissions.',
    icon: '<path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1M14 9h1M9 13h1M14 13h1M9 17h6"/>',
    inputs: [['rent', 'Starting rent $/SF/yr', 'money', '42'], ['sf', 'Square feet', 'num', '2,500'], ['months', 'Term, months', 'num', '120'],
      ['esc', 'Annual increases %', 'pct', '3'], ['free', 'Free rent, months', 'num', '4'], ['ti', 'TI allowance $/SF', 'money', '40'],
      ['lc', 'Leasing commissions %', 'pct', '6'], ['discount', 'Discount rate %', 'pct', '8']],
    run: (v) => {
      const r = netEffectiveRent(v);
      if (!r) return [['Enter rent, size and term', '—']];
      return [
        ['Net effective rent', `${money2(r.nerSimple)}/SF`, true, 'net rent spread evenly over the term'],
        ['Discounted net effective', `${money2(r.nerDiscounted)}/SF`, true, ok(v.discount) && v.discount > 0 ? `level rent with the same value at ${pct(v.discount, 1)}` : 'add a discount rate'],
        ['Average face rent', `${money2(r.avgRent)}/SF`], ['Total face rent', money0(r.gross)], ['Free rent', money0(r.freeRent)],
        ['TI', money0(r.ti)], ['Commissions', money0(r.lc)], ['Concessions', pct(r.concessionPct, 1), false, 'of face rent'],
      ];
    },
  },
  {
    id: 'x1031', title: '1031 exchange clock', color: '#B45309',
    desc: 'The 45-day identification and 180-day closing deadlines.',
    icon: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>',
    inputs: [['closing', 'Relinquished property closed on', 'date']],
    run: (v) => {
      const r = exchangeDates(v.closing);
      if (!r) return [['Enter the closing date', '—']];
      const left = (d) => (d > 0 ? `${d} days left` : d === 0 ? 'today' : `${-d} days ago`);
      return [
        ['Identify replacement property by', niceDate(r.identify), true, left(r.identifyLeft)],
        ['Close on it by', niceDate(r.close), true, `${left(r.closeLeft)}, or the tax return's due date if earlier`],
      ];
    },
    note: 'Day counts are calendar days from the closing, weekends and holidays included. Confirm with the qualified intermediary and a tax adviser.',
  },
  {
    id: 'walt', title: 'WALT and rollover', color: '#0369A1',
    desc: 'Weighted average lease term and rent rolling, from a quick rent roll.',
    icon: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    rows: true,
  },
  {
    id: 'convert', title: 'Converter', color: '#475569',
    desc: 'Acres and SF, FAR to buildable, rent per month and per year.',
    icon: '<path d="M7 7h11l-3-3M17 17H6l3 3"/>',
    inputs: [['acres', 'Acres', 'num', '0.5'], ['sf', 'Land SF', 'num', '21,780'], ['far', 'FAR', 'num', '3.0'],
      ['rentYr', 'Rent $/SF a year', 'money', '36'], ['rentMo', 'Rent $/SF a month', 'money', '3.00'], ['sfLease', 'SF leased', 'num', '1,200']],
    run: (v) => {
      const land = ok(v.sf) ? v.sf : ok(v.acres) ? v.acres * 43560 : null;
      const yr = ok(v.rentYr) ? v.rentYr : ok(v.rentMo) ? v.rentMo * 12 : null;
      return [
        ['Land SF', ok(land) ? int(land) : '—'], ['Acres', ok(land) ? (land / 43560).toFixed(4) : '—'],
        ['Buildable SF at that FAR', ok(land) && ok(v.far) ? int(land * v.far) : '—', true],
        ['Rent a year', ok(yr) ? `${money2(yr)}/SF` : '—'], ['Rent a month', ok(yr) ? `${money2(yr / 12)}/SF` : '—'],
        ['Annual rent', ok(yr) && ok(v.sfLease) ? money0(yr * v.sfLease) : '—', true], ['Monthly rent', ok(yr) && ok(v.sfLease) ? money0((yr * v.sfLease) / 12) : '—'],
      ];
    },
  },
];

function render() {
  const root = $('tools-root');
  root.textContent = '';
  const head = el('div', 'view-head');
  head.appendChild(el('h1', null, 'Tools'));
  head.appendChild(el('p', null, 'Quick calculators for between meetings. Figures you type are remembered on this device.'));
  root.appendChild(head);
  const grid = el('div', 'tool-grid');
  for (const t of TOOLS) {
    const b = el('button', 'tool');
    b.type = 'button';
    const ic = el('span', 'tool-icon');
    ic.style.background = t.color;
    ic.innerHTML = svg(t.icon, 22);
    b.appendChild(ic);
    const tx = el('span');
    tx.appendChild(el('h3', null, t.title));
    tx.appendChild(el('p', null, t.desc));
    b.appendChild(tx);
    b.addEventListener('click', () => open(t));
    grid.appendChild(b);
  }
  root.appendChild(grid);
}

function readInput(kind, raw) {
  if (kind === 'date') return raw || null;
  if (kind === 'bool') return !!raw;
  // 'pct0' is a rate where a value under 1% is ordinary (commission, transfer
  // tax): "0.5" there is half a percent, never 50%
  if (kind === 'pct') return parsePct(raw);
  if (kind === 'pct0') return parsePct(raw, { fraction: false });
  return parseNum(raw);
}
const showInput = (kind, v) => {
  if (v === null || v === undefined) return '';
  if (kind === 'money' || kind === 'num') return Math.abs(v) >= 1000 ? int(v) : String(v);
  return String(v);
};

function open(t) {
  if (t.rows) { openWalt(t); return; }
  const mem = (memory[t.id] ||= {});
  const copy = el('button', 'btn', 'Copy results');
  copy.type = 'button';
  const clear = el('button', 'btn btn-gray', 'Clear');
  clear.type = 'button';
  const body = api.sheetOpen({ eyebrow: 'Tools', title: t.title, sub: t.desc, foot: [clear, copy] });
  const form = el('div', 'grid-form');
  form.style.padding = '0';
  const inputs = {};
  for (const [id, label, kind, ph] of t.inputs) {
    const f = el('div', 'field');
    const lab = el('label', null, label);
    let i;
    if (kind === 'bool') {
      const sw = el('label', 'switch');
      i = el('input');
      i.type = 'checkbox';
      i.checked = !!mem[id];
      i.setAttribute('aria-label', label);
      sw.appendChild(i);
      f.append(el('span', 'lbl', label), sw);
    } else {
      i = el('input', kind === 'date' ? null : 'n');
      i.id = `tool-${t.id}-${id}`;
      lab.htmlFor = i.id;
      if (kind === 'date') i.type = 'date'; else i.inputMode = 'decimal';
      i.placeholder = ph || '';
      i.autocomplete = 'off';
      i.value = kind === 'date' ? (mem[id] || '') : showInput(kind, mem[id]);
      f.append(lab, i);
    }
    inputs[id] = [i, kind];
    form.appendChild(f);
  }
  body.appendChild(form);
  const res = el('ul', 'results');
  body.appendChild(res);
  if (t.note) body.appendChild(el('p', 'hint-sm', t.note));
  const values = () => Object.fromEntries(Object.entries(inputs).map(([id, [i, kind]]) => [id, readInput(kind, kind === 'bool' ? i.checked : i.value)]));
  let lines = [];
  const update = () => {
    const v = values();
    Object.assign(mem, v);
    remember();
    lines = t.run(v);
    res.textContent = '';
    for (const [k, val, strong, why] of lines) {
      const li = el('li', strong ? 'strong' : null);
      const s = el('span', null, k);
      if (why) s.appendChild(el('span', 'why', why));
      li.append(s, el('b', null, val));
      res.appendChild(li);
    }
  };
  for (const [i, kind] of Object.values(inputs)) {
    i.addEventListener('input', update);
    if (kind !== 'date' && kind !== 'bool') i.addEventListener('change', () => { const v = readInput(kind, i.value); i.value = showInput(kind, v); });
  }
  update();
  copy.addEventListener('click', async () => {
    const text = [t.title, ...lines.filter(([, v]) => v && v !== '—').map(([k, v]) => `${k}: ${v}`)].join('\n');
    toast((await copyText(text)) ? 'Results copied.' : 'The browser blocked copying here.');
  });
  clear.addEventListener('click', () => {
    for (const [i, kind] of Object.values(inputs)) { if (kind === 'bool') i.checked = false; else i.value = ''; }
    update();
  });
  const first = Object.values(inputs)[0][0];
  if (first && window.matchMedia('(min-width: 720px)').matches) first.focus();
}

function openWalt(t) {
  const mem = (memory.walt ||= { rows: [{}, {}, {}] });
  const add = el('button', 'btn btn-gray', '+ Row');
  add.type = 'button';
  const copy = el('button', 'btn', 'Copy results');
  copy.type = 'button';
  const body = api.sheetOpen({ eyebrow: 'Tools', title: t.title, sub: 'One row per lease. Rent is the annual total; write Vacant as the tenant for empty space.', foot: [add, copy] });
  const wrap = el('div', 'scroll');
  const table = el('table', 'rows-edit');
  wrap.appendChild(table);
  body.appendChild(wrap);
  const res = el('ul', 'results');
  body.appendChild(res);
  let lines = [];
  const update = () => {
    remember();
    const s = waltTool(mem.rows.map((r) => ({ tenant: r.tenant, sf: parseNum(r.sf), annual: parseNum(r.annual), end: r.end || null })));
    lines = s ? [
      ['WALT by income', yrs(s.waltIncome), true], ['WALT by SF', yrs(s.waltSf)], ['Occupancy by SF', pct(s.occupancy, 1)],
      ['Rent expiring within 12 months', pct(s.roll12Pct, 0)], ['Rent expiring within 24 months', pct(s.roll24Pct, 0)],
      ['Total annual rent', money0(s.rent)], ['Average rent', ok(s.avgRentPsf) ? `${money2(s.avgRentPsf)}/SF` : '—'],
    ] : [['Add a lease with its SF or rent', '—']];
    res.textContent = '';
    for (const [k, v, strong] of lines) { const li = el('li', strong ? 'strong' : null); li.append(el('span', null, k), el('b', null, v)); res.appendChild(li); }
  };
  const draw = () => {
    table.textContent = '';
    const h = el('tr');
    for (const x of ['Tenant', 'SF', 'Annual rent', 'Expires', '']) h.appendChild(el('th', null, x));
    table.appendChild(h);
    mem.rows.forEach((r, idx) => {
      const tr = el('tr');
      for (const [k, type, ph] of [['tenant', 'text', 'Tenant'], ['sf', 'n', '2,400'], ['annual', 'n', '96,000'], ['end', 'date', '']]) {
        const td = el('td');
        const i = el('input');
        if (type === 'date') i.type = 'date'; else if (type === 'n') i.inputMode = 'decimal';
        i.placeholder = ph;
        i.value = r[k] || '';
        i.setAttribute('aria-label', `${k} for row ${idx + 1}`);
        i.addEventListener('input', () => { r[k] = i.value; update(); });
        td.appendChild(i);
        tr.appendChild(td);
      }
      const td = el('td');
      const x = el('button', 'iconbtn');
      x.type = 'button';
      x.innerHTML = svg('<path d="M6 6l12 12M18 6L6 18"/>', 15);
      x.setAttribute('aria-label', `Remove row ${idx + 1}`);
      x.addEventListener('click', () => { mem.rows.splice(idx, 1); if (!mem.rows.length) mem.rows.push({}); draw(); update(); });
      td.appendChild(x);
      tr.appendChild(td);
      table.appendChild(tr);
    });
  };
  add.addEventListener('click', () => { mem.rows.push({}); draw(); update(); const ins = table.querySelectorAll('tr:last-child input'); if (ins[0]) ins[0].focus(); });
  copy.addEventListener('click', async () => {
    const text = [t.title, ...lines.filter(([, v]) => v && v !== '—').map(([k, v]) => `${k}: ${v}`)].join('\n');
    toast((await copyText(text)) ? 'Results copied.' : 'The browser blocked copying here.');
  });
  draw();
  update();
}

export function initTools(compsApi) {
  api = compsApi;
  render();
}
