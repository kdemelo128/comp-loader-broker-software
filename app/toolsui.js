/* toolsui.js -- the Tools screen: the calculators a broker reaches for between
 * meetings, each in a sheet that works one-handed. Inputs are remembered on
 * the device, results update as you type, and every result copies as text.
 *
 * A tool can also fill its inputs from the open deal, save named scenarios,
 * export to Excel or print, and, after a confirmation that lists exactly what
 * changes, send its result back to the deal. Nothing reaches the deal
 * without that confirmation. */

import { quickValue, loanTool, offerTool, netEffectiveRent, exchangeDates, waltTool } from './tools.js';
import { MORE_TOOLS, GROUPS } from './toolsdefs.js';
import { dealForTools, applyFromTools } from './dealui.js';
import { kvGet, kvSet, logRounding, MONEY_VERSION } from './store.js';
import { quantizeToolInput, quantizeToolValues } from './engine/money.js';
import {
  $, el, svg, parseNum, parsePct, int, money0, money2, pct, signed, times, yrs, niceDate, toast, copyText, actionSheet, getXlsx, deliver, printed, XLSX, localDate,
} from './kit.js';

let api = null;
const MEM = 'zlatura.tools.v1';
const SAVED = 'tools.scenarios';
let memory = {};
try { memory = JSON.parse(localStorage.getItem(MEM) || '{}') || {}; } catch { memory = {}; }
const remember = () => { try { localStorage.setItem(MEM, JSON.stringify(memory)); } catch { /* fine */ } };

const ok = (x) => typeof x === 'number' && Number.isFinite(x);

/* The first seven tools. Each: inputs (id, label, kind, placeholder) and a
 * function from the values to result lines [label, value, strong?, why?]. */
const TOOLS = [
  {
    id: 'value', group: 'Valuation', title: 'Quick value', color: '#2350D8',
    desc: 'Any two of price, NOI and cap rate give the third.',
    icon: '<path d="M4 19h16M7 15l3-4 3 2 4-6"/>',
    inputs: [['price', 'Price', 'money', '4.5m'], ['noi', 'NOI', 'money', '280k'], ['cap', 'Cap rate %', 'pct', '6.25'],
      ['bsf', 'Building SF', 'num', 'optional'], ['units', 'Units', 'num', 'optional']],
    fromDeal: (d) => ({ price: d.m.price, noi: d.m.noi, cap: null, bsf: d.figures.bsf, units: d.figures.units }),
    run: (v) => {
      const r = quickValue(v);
      return { warnings: r.warnings, lines: [
        ['Price', money0(r.price), r.solved === 'price', r.solved === 'price' ? 'NOI ÷ cap rate' : null],
        ['NOI', money0(r.noi), r.solved === 'noi', r.solved === 'noi' ? 'price × cap rate' : null],
        ['Cap rate', pct(r.cap), r.solved === 'cap', r.solved === 'cap' ? 'NOI ÷ price' : null],
        ...(ok(r.mismatch) ? [['NOI ÷ price', pct(r.capCalc), true, `not the ${pct(r.cap)} typed: ${Math.abs(r.mismatch).toFixed(2)} points apart`]] : []),
        ['Price per SF', money2(r.ppsf)], ['Price per unit', money0(r.perUnit)], ['NOI per SF', money2(r.noiPsf)],
      ] };
    },
  },
  {
    id: 'loan', group: 'Debt and financing', title: 'Loan sizing', color: '#0E8A7D',
    desc: 'The largest loan by LTV, DSCR and debt yield, and which test binds.',
    icon: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
    inputs: [['price', 'Purchase price', 'money', '4.5m'], ['noi', 'NOI', 'money', '280k'], ['ltv', 'Max LTV %', 'pct', '65'],
      ['rate', 'Interest rate %', 'pct', '6.75'], ['amort', 'Amortization, years', 'num', '30'], ['io', 'Interest only', 'bool'],
      ['minDscr', 'Minimum DSCR', 'num', '1.25'], ['minDy', 'Minimum debt yield %', 'pct', '8']],
    fromDeal: (d) => ({ price: d.m.price, noi: d.m.noi, ltv: d.loan.ltv, rate: d.loan.rate, amort: d.loan.amort, io: d.loan.io, minDscr: d.loan.minDscr, minDy: d.loan.minDy }),
    toDeal: (v) => ({ loan: { ltv: v.ltv, rate: v.rate, amort: v.amort, io: !!v.io, minDscr: v.minDscr, minDy: v.minDy }, summary: `loan terms: ${pct(v.ltv, 1)} LTV, ${pct(v.rate)} rate, ${ok(v.amort) ? `${v.amort}-year amortization` : 'amortization unchanged'}${v.io ? ', interest only' : ''}, lender tests ${times(v.minDscr)} DSCR and ${pct(v.minDy, 1)} debt yield` }),
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
    id: 'offer', group: 'Valuation', title: 'Offer and seller net', color: '#C2410C',
    desc: 'Price at a target cap or $/SF, and what the seller nets.',
    icon: '<path d="M20 12V8H6a2 2 0 010-4h12v4M4 6v12a2 2 0 002 2h14v-4"/><path d="M18 12a2 2 0 000 4h4v-4z"/>',
    inputs: [['ask', 'Asking price', 'money', '4.5m'], ['noi', 'NOI', 'money', '280k'], ['targetCap', 'Target cap rate %', 'pct', '6.5'],
      ['bsf', 'Building SF', 'num', '9,000'], ['targetPpsf', 'Target $/SF', 'money', '475'],
      ['price', 'Sale price for the net sheet', 'money', 'blank = price at target cap'], ['commission', 'Commission %', 'pct0', '4'],
      ['transfer', 'Seller’s transfer taxes %', 'pct0', '1.45'], ['other', 'Other closing costs $', 'money', '25k'], ['payoff', 'Loan payoff', 'money', '1.8m']],
    fromDeal: (d) => ({ ask: d.m.price, noi: d.m.noi, bsf: d.figures.bsf }),
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
    id: 'ner', group: 'Leasing', title: 'Net effective rent', color: '#7C3AED',
    desc: 'A lease’s real rent after free rent, TI and commissions.',
    icon: '<path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1M14 9h1M9 13h1M14 13h1M9 17h6"/>',
    inputs: [['rent', 'Starting rent $/SF/yr', 'money', '42'], ['sf', 'Square feet', 'num', '2,500'], ['months', 'Term, months', 'num', '120'],
      ['esc', 'Annual increases %', 'pct', '3'], ['free', 'Free rent, months', 'num', '4'], ['ti', 'TI allowance $/SF', 'money', '40'],
      ['lc', 'Leasing commissions %', 'pct', '6'], ['discount', 'Discount rate %', 'pct', '8']],
    run: (v) => {
      const r = netEffectiveRent(v);
      if (!r) return [['Enter rent, size and term', '—']];
      return [
        ['Net effective rent', `${money2(r.nerSimple)}/SF`, true, `net of ${r.netOf}, spread evenly over the term`],
        ['Net effective rent, discounted', `${money2(r.nerDiscounted)}/SF`, true, ok(v.discount) && v.discount > 0 ? `level rent with the same present value at ${pct(v.discount, 1)}, net of ${r.netOf}` : 'add a discount rate'],
        ['Average face rent', `${money2(r.avgRent)}/SF`], ['Total face rent', money0(r.gross)], ['Free rent', money0(r.freeRent)],
        ['TI', money0(r.ti)], ['Commissions', money0(r.lc)], ['Concessions', pct(r.concessionPct, 1), false, 'of face rent'],
      ];
    },
  },
  {
    id: 'x1031', group: 'Conversions and dates', title: '1031 exchange clock', color: '#B45309',
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
    id: 'walt', group: 'Leasing', title: 'WALT and rollover', color: '#0369A1',
    desc: 'Weighted average lease term and rent rolling, from a quick rent roll.',
    icon: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    rows: true,
  },
  {
    id: 'convert', group: 'Conversions and dates', title: 'Converter', color: '#475569',
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
  ...MORE_TOOLS,
];
export const TOOL_IDS = TOOLS.map((t) => t.id);

/** A tool's run gives either lines or { lines, tables, warnings }. */
const normal = (r) => (Array.isArray(r) ? { lines: r, tables: [], warnings: [] } : { lines: r.lines || [], tables: r.tables || [], warnings: r.warnings || [], data: r.data });

/* ------------------------------------------------------------- the list */

let query = '';
function render() {
  const root = $('tools-root');
  root.textContent = '';
  const head = el('div', 'view-head');
  head.appendChild(el('h1', null, 'Tools'));
  head.appendChild(el('p', null, `${TOOLS.length} calculators for valuation, debt, returns, leasing and development. Figures you type are remembered on this device; tools marked “deal” load the open deal’s figures.`));
  root.appendChild(head);
  const search = el('input', 'tool-search');
  search.type = 'search';
  search.id = 'tool-search';
  search.placeholder = 'Search tools';
  search.setAttribute('aria-label', 'Search tools');
  search.autocomplete = 'off';
  search.value = query;
  root.appendChild(search);
  const list = el('div');
  root.appendChild(list);
  const draw = () => {
    list.textContent = '';
    const q = query.trim().toLowerCase();
    const match = (t) => !q || `${t.title} ${t.desc} ${t.group}`.toLowerCase().includes(q);
    let shown = 0;
    for (const g of GROUPS) {
      const ts = TOOLS.filter((t) => t.group === g && match(t));
      if (!ts.length) continue;
      shown += ts.length;
      list.appendChild(el('h2', 'tool-group', g));
      const grid = el('div', 'tool-grid');
      for (const t of ts) grid.appendChild(card(t));
      list.appendChild(grid);
    }
    if (!shown) list.appendChild(el('p', 'hint-sm', `No tool matches “${query}”.`));
  };
  search.addEventListener('input', () => { query = search.value; draw(); });
  draw();
}

function card(t) {
  const b = el('button', 'tool');
  b.type = 'button';
  b.dataset.tool = t.id;
  // one tint per group (styles.css), so the screen reads as seven families, not thirty colours
  b.dataset.group = GROUPS.indexOf(t.group);
  const ic = el('span', 'tool-icon');
  ic.innerHTML = svg(t.icon, 19);
  b.appendChild(ic);
  const tx = el('span');
  const h = el('h3', null, t.title);
  if (t.fromDeal) h.appendChild(el('span', 'tool-tag', 'deal'));
  tx.appendChild(h);
  tx.appendChild(el('p', null, t.desc));
  b.appendChild(tx);
  b.addEventListener('click', () => open(t));
  return b;
}

/* --------------------------------------------------------------- inputs */

function readInput(kind, raw) {
  if (kind === 'date' || kind === 'select') return raw || null;
  if (kind === 'bool') return !!raw;
  // 'pct0' is a rate where a value under 1% is ordinary (commission, transfer
  // tax): "0.5" there is half a percent, never 50%
  if (kind === 'pct') return parsePct(raw);
  if (kind === 'pct0') return parsePct(raw, { fraction: false });
  if (kind === 'list') {
    const xs = String(raw || '').split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean).map(parseNum);
    return xs.length ? xs : null;
  }
  return parseNum(raw);
}
const showNum = (v) => (Math.abs(v) >= 1000 ? int(v) : String(Math.round(v * 1e6) / 1e6));
const showInput = (kind, v) => {
  if (v === null || v === undefined) return '';
  if (kind === 'list') return Array.isArray(v) ? v.map((x) => (ok(x) ? showNum(x) : '?')).join(', ') : '';
  if ((kind === 'money' || kind === 'num' || kind === 'int') && ok(v)) return showNum(v);
  if (kind === 'money2' && ok(v)) return String(Math.round(v * 100) / 100);
  if ((kind === 'pct' || kind === 'pct0') && ok(v)) return String(Math.round(v * 1e6) / 1e6);
  return String(v);
};
/** What an input holds, as a person would read it (for the export, the print and the confirm). */
const inputText = (kind, v) => {
  if (v === null || v === undefined || v === '') return '';
  if (kind === 'bool') return v ? 'Yes' : 'No';
  if (kind === 'money' || kind === 'money2') return ok(v) ? money2(v).replace(/\.00$/, '') : '';
  if (kind === 'pct' || kind === 'pct0') return ok(v) ? `${showInput(kind, v)}%` : '';
  return showInput(kind, v);
};

function inputField(t, [id, label, kind, ph, help], mem) {
  const f = el('div', 'field');
  let i;
  if (kind === 'bool') {
    const sw = el('label', 'switch');
    i = el('input');
    i.type = 'checkbox';
    i.id = `tool-${t.id}-${id}`;
    i.checked = !!mem[id];
    i.setAttribute('aria-label', label);
    sw.appendChild(i);
    f.append(el('span', 'lbl', label), sw);
  } else if (kind === 'select') {
    const lab = el('label', null, label);
    i = el('select');
    i.id = `tool-${t.id}-${id}`;
    lab.htmlFor = i.id;
    for (const [value, text] of ph) { const o = el('option', null, text); o.value = value; i.appendChild(o); }
    i.value = mem[id] || ph[0][0];
    f.append(lab, i);
  } else {
    const lab = el('label', null, label);
    i = el('input', kind === 'date' ? null : 'n');
    i.id = `tool-${t.id}-${id}`;
    lab.htmlFor = i.id;
    if (kind === 'date') i.type = 'date'; else i.inputMode = kind === 'list' ? 'text' : 'decimal';
    i.placeholder = ph || '';
    i.autocomplete = 'off';
    i.value = kind === 'date' ? (mem[id] || '') : showInput(kind, mem[id]);
    f.append(lab, i);
  }
  if (kind === 'list') f.classList.add('wide');
  if (help) f.appendChild(el('span', 'hint-sm', help));
  return [f, i];
}

/* ------------------------------------------------------------ the sheet */

function open(t) {
  if (t.rows) { openWalt(t); return; }
  const mem = (memory[t.id] ||= {});
  const d = dealForTools();
  const ctx = { deal: d, sales: api.sales };
  const clear = el('button', 'btn btn-gray', 'Clear');
  clear.type = 'button';
  const more = el('button', 'btn btn-gray', 'Export');
  more.type = 'button';
  more.id = 'tool-export';
  const foot = [clear, more];
  let send = null;
  if (t.toDeal) {
    send = el('button', 'btn', 'Send to deal');
    send.type = 'button';
    send.id = 'tool-send';
    send.disabled = !d;
    send.title = d ? `Write this result to ${d.name}` : 'Open a deal on the Deal tab first';
    foot.push(send);
  } else {
    const copy = el('button', 'btn', 'Copy results');
    copy.type = 'button';
    copy.addEventListener('click', () => doCopy());
    foot.push(copy);
  }
  const body = api.sheetOpen({ eyebrow: `Tools · ${t.group}`, title: t.title, sub: t.desc, foot });

  // the deal and saved-scenario bar
  const bar = el('div', 'tool-bar');
  if (t.fromDeal) {
    const load = el('button', 'btn btn-sm btn-gray', d ? `Load from ${d.name}` : 'Load from deal');
    load.type = 'button';
    load.id = 'tool-load-deal';
    load.disabled = !d;
    if (!d) load.title = 'Open a deal on the Deal tab first';
    load.addEventListener('click', () => loadFromDeal());
    bar.appendChild(load);
  }
  const scn = el('button', 'btn btn-sm btn-gray', 'Scenarios');
  scn.type = 'button';
  scn.id = 'tool-scenarios';
  scn.addEventListener('click', () => scenarios());
  bar.appendChild(scn);
  body.appendChild(bar);

  const form = el('div', 'grid-form');
  form.style.padding = '0';
  const inputs = {};
  for (const spec of t.inputs) {
    const [f, i] = inputField(t, spec, mem);
    inputs[spec[0]] = [i, spec[2], spec[1]];
    form.appendChild(f);
  }
  body.appendChild(form);
  const warn = el('div', 'tool-warn');
  warn.setAttribute('role', 'status');
  body.appendChild(warn);
  const res = el('ul', 'results');
  res.setAttribute('aria-live', 'polite');
  body.appendChild(res);
  const tables = el('div', 'tool-tables');
  body.appendChild(tables);
  if (t.explain) {
    const how = el('details', 'tool-how');
    how.appendChild(el('summary', null, 'How it is worked out'));
    how.appendChild(el('p', null, t.explain));
    body.appendChild(how);
  }
  if (t.note) body.appendChild(el('p', 'hint-sm', t.note));

  // money typed into a tool is kept as the engine keeps it: totals to cents, rates per SF or unit to four decimals
  const values = () => Object.fromEntries(Object.entries(inputs).map(([id, [i, kind, label]]) => [id, quantizeToolInput(kind, label, readInput(kind, kind === 'bool' ? i.checked : i.value))]));
  const setValues = (v) => {
    for (const [id, [i, kind]] of Object.entries(inputs)) {
      if (!(id in v)) continue;
      if (kind === 'bool') i.checked = !!v[id];
      else if (kind === 'select') i.value = v[id] || i.options[0].value;
      else i.value = kind === 'date' ? (v[id] || '') : showInput(kind, v[id]);
    }
  };
  let out = { lines: [], tables: [], warnings: [] };
  let current = {};
  const update = () => {
    current = values();
    Object.assign(mem, current);
    remember();
    try {
      out = normal(t.run(current, ctx));
    } catch (e) {
      console.error(e);
      out = { lines: [['This tool could not work that out', '—']], tables: [], warnings: ['Check the figures entered.'] };
    }
    res.textContent = '';
    for (const [k, val, strong, why] of out.lines) {
      const li = el('li', strong ? 'strong' : null);
      const s = el('span', null, k);
      if (why) s.appendChild(el('span', 'why', why));
      li.append(s, el('b', null, val));
      res.appendChild(li);
    }
    warn.textContent = '';
    for (const w of out.warnings) warn.appendChild(el('p', 'warn-text', w));
    tables.textContent = '';
    for (const tb of out.tables) tables.appendChild(drawTable(tb));
    if (send) send.disabled = !d || !t.toDeal(current, out);
  };
  for (const [i, kind, label] of Object.values(inputs)) {
    i.addEventListener(kind === 'select' ? 'change' : 'input', update);
    if (!['date', 'bool', 'select'].includes(kind)) i.addEventListener('change', () => { const v = quantizeToolInput(kind, label, readInput(kind, i.value)); if (v !== null) i.value = showInput(kind, v); });
  }
  update();

  function loadFromDeal() {
    const v = t.fromDeal(d) || {};
    const got = Object.fromEntries(Object.entries(v).filter(([k, x]) => k in inputs && x !== null && x !== undefined && !(typeof x === 'number' && !Number.isFinite(x))));
    // a field the deal leaves blank on purpose (the cap in Quick value, so it is solved for) is cleared
    for (const [k, x] of Object.entries(v)) if (x === null && k in inputs) got[k] = null;
    const n = Object.values(got).filter((x) => x !== null).length;
    if (!n) { toast(`${d.name} has none of these figures yet.`); return; }
    setValues(got);
    update();
    toast(`Filled ${n} field${n === 1 ? '' : 's'} from ${d.name}. The deal is unchanged.`);
  }

  async function doCopy() {
    const text = [t.title, ...out.lines.filter(([, v]) => v && v !== '—').map(([k, v]) => `${k}: ${v}`)].join('\n');
    toast((await copyText(text)) ? 'Results copied.' : 'The browser blocked copying here.');
  }

  more.addEventListener('click', async () => {
    const pick = await actionSheet(t.title, [
      { label: 'Copy results', sub: 'As text, to paste in an email', value: 'copy' },
      { label: 'Excel workbook', sub: 'Inputs, results and tables, as values', value: 'xlsx' },
      { label: 'Print or save as PDF', value: 'print' },
    ]);
    if (pick === 'copy') doCopy();
    else if (pick === 'xlsx') exportXlsx(t, current, out, d).catch((e) => { console.error(e); toast('The workbook could not be built here.'); });
    else if (pick === 'print') printTool(t, current, out, d);
  });

  clear.addEventListener('click', () => {
    for (const [i, kind] of Object.values(inputs)) {
      if (kind === 'bool') i.checked = false; else if (kind === 'select') i.value = i.options[0].value; else i.value = '';
    }
    update();
  });

  if (send) send.addEventListener('click', async () => {
    const w = t.toDeal(current, out);
    if (!w || !d) return;
    const live = dealForTools();
    const changes = describeChanges(w, live);
    if (!changes.length) { toast('The deal already has these figures.'); return; }
    const pick = await actionSheet(`Write to ${live.name}?`, [
      { label: 'Write these to the deal', sub: `${w.summary}. Changes: ${changes.join('; ')}.`, value: 'yes', primary: true },
    ]);
    if (pick !== 'yes') return;
    applyFromTools(w, t.title);
    toast(`Written to ${live.name}. ${w.figures ? 'The figures are marked as typed, from this tool.' : ''}`.trim());
  });

  async function scenarios() {
    const all = (await kvGet(SAVED)) || {};
    const list = all[t.id] || [];
    const items = [{ label: 'Save these inputs as…', sub: 'A named scenario for this tool, kept on this device', value: { act: 'save' }, primary: true }];
    if (list.length) items.push('-');
    for (const s of list) items.push({ label: s.name, sub: `Saved ${niceDate(s.at)}`, value: { act: 'pick', s } });
    const pick = await actionSheet(`${t.title}: scenarios`, items);
    if (!pick) return;
    if (pick.act === 'save') {
      const name = (window.prompt('Name this scenario', `${t.title} ${list.length + 1}`) || '').trim();
      if (!name) return;
      list.push({ id: `s${Date.now().toString(36)}`, name, at: Date.now(), values: { ...current } });
      all[t.id] = list;
      toast((await kvSet(SAVED, all)) ? `Saved “${name}”.` : 'This device would not save it (storage is full or blocked).');
      return;
    }
    const s = pick.s;
    const act = await actionSheet(s.name, [
      { label: 'Load', sub: 'Replace the inputs with this scenario', value: 'load', primary: true },
      { label: 'Rename', value: 'rename' }, { label: 'Duplicate', value: 'dup' }, { label: 'Delete', value: 'del', danger: true },
    ]);
    if (act === 'load') { setValues(s.values); update(); toast(`Loaded “${s.name}”.`); return; }
    if (act === 'rename') {
      const name = (window.prompt('Rename the scenario', s.name) || '').trim();
      if (!name) return;
      s.name = name;
    } else if (act === 'dup') list.push({ ...s, id: `s${Date.now().toString(36)}`, name: `${s.name} (copy)`, at: Date.now(), values: { ...s.values } });
    else if (act === 'del') list.splice(list.indexOf(s), 1);
    else return;
    all[t.id] = list;
    toast((await kvSet(SAVED, all)) ? { rename: 'Renamed.', dup: 'Duplicated.', del: `Deleted “${s.name}”.` }[act] : 'This device would not save that change.');
  }

  const first = Object.values(inputs)[0][0];
  if (first && window.matchMedia('(min-width: 720px)').matches) first.focus();
}

function drawTable({ title, head, rows, mark }) {
  const box = el('div', 'tool-table');
  if (title) box.appendChild(el('h3', 'tool-table-title', title));
  const wrap = el('div', 'scroll');
  const tb = el('table', 'mini proj');
  const hr = el('tr');
  for (const h of head) hr.appendChild(el('th', null, String(h)));
  const thead = el('thead');
  thead.appendChild(hr);
  tb.appendChild(thead);
  const tbody = el('tbody');
  rows.forEach((r, i) => {
    const tr = el('tr');
    r.forEach((c, j) => {
      const td = el('td', j ? 'r' : null, c === null || c === undefined ? '—' : String(c));
      if (mark && mark[i] && mark[i][j]) td.classList.add('hit');
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  tb.appendChild(tbody);
  wrap.appendChild(tb);
  box.appendChild(wrap);
  return box;
}

const FIGURE_LABELS = { gpr: 'Gross potential rent', gross: 'Effective gross income', opex: 'Operating expenses', noi: 'NOI', price: 'Price' };
const LOAN_LABELS = { ltv: 'LTV', rate: 'Rate', amort: 'Amortization', io: 'Interest only', minDscr: 'Minimum DSCR', minDy: 'Minimum debt yield' };
const LIVE_LABELS = { hold: 'Hold (scenario)', growth: 'NOI growth (scenario)', exitCap: 'Exit cap (scenario)', saleCost: 'Sale costs (scenario)' };
const fmtAny = (k, v) => {
  if (v === null || v === undefined || v === '') return 'blank';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (['gpr', 'gross', 'opex', 'noi', 'price'].includes(k)) return money0(v);
  if (['ltv', 'rate', 'minDy', 'growth', 'exitCap', 'saleCost'].includes(k)) return pct(v, 2);
  if (k === 'minDscr') return times(v);
  return String(v);
};
/** Each value the write would change, "label: old → new". Unchanged ones are left out. */
function describeChanges(w, d) {
  const out = [];
  const add = (labels, now, k, v) => {
    if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return;
    const was = now[k];
    if (was === v || (ok(was) && ok(v) && Math.abs(was - v) < 1e-9)) return;
    out.push(`${labels[k] || k}: ${fmtAny(k, was)} → ${fmtAny(k, v)}`);
  };
  for (const [k, v] of Object.entries(w.figures || {})) add(FIGURE_LABELS, d.figures, k, v);
  for (const [k, v] of Object.entries(w.loan || {})) add(LOAN_LABELS, d.loan, k, v);
  for (const [k, v] of Object.entries(w.live || {})) add(LIVE_LABELS, d.live, k, v);
  return out;
}

/* --------------------------------------------------------------- export */

async function exportXlsx(t, v, out, d) {
  const { ExcelJS } = await getXlsx();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Zlatura';
  const ws = wb.addWorksheet(t.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
  ws.columns = [{ width: 44 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 22 }];
  const bold = { bold: true };
  ws.addRow([t.title]).font = { bold: true, size: 14 };
  ws.addRow([`Zlatura Tools · ${localDate()}${d ? ` · deal: ${d.name}` : ''}`]);
  ws.addRow([]);
  ws.addRow(['Inputs']).font = bold;
  for (const [id, label, kind] of t.inputs) {
    const x = v[id];
    if (x === null || x === undefined || x === '') continue;
    // numbers stay numbers so the sheet can be built on; percents as typed (6.5 means 6.5%)
    ws.addRow([label, kind === 'bool' ? (x ? 'Yes' : 'No') : Array.isArray(x) ? x.join(', ') : (kind === 'select' ? (t.inputs.find((s) => s[0] === id)[3].find((o) => o[0] === x) || [x, x])[1] : x)]);
  }
  ws.addRow([]);
  ws.addRow(['Results']).font = bold;
  for (const [k, val, , why] of out.lines) ws.addRow([k, val, why || '']);
  for (const w of out.warnings) ws.addRow(['Check', w]);
  for (const tb of out.tables) {
    ws.addRow([]);
    ws.addRow([tb.title || '']).font = bold;
    ws.addRow(tb.head.map(String)).font = bold;
    for (const r of tb.rows) ws.addRow(r.map((c) => (c === null || c === undefined ? '' : c)));
  }
  if (t.explain) { ws.addRow([]); ws.addRow(['How it is worked out', t.explain]); }
  ws.addRow([]);
  ws.addRow(['Results are the values shown on screen when exported; they do not recalculate in Excel.']);
  const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
  await deliver(`${t.title.replace(/[^\w]+/g, '-').replace(/-+$/, '')}-${localDate()}.xlsx`, bytes, XLSX, { map: 'none: a tool’s own inputs (filled from a deal, they are a copy made then)' });
}

function printTool(t, v, out, d) {
  const box = $('print-sheet');
  box.textContent = '';
  box.className = 'print-sheet portrait';
  const head = el('div', 'ps-head');
  const left = el('div');
  left.append(el('div', 'ps-eyebrow', `Tools · ${t.group}`), el('div', 'ps-title', t.title), el('div', 'ps-sub', t.desc));
  head.append(left, el('div', 'ps-meta', `${niceDate(new Date())}${d ? `\n${d.name}` : ''}`));
  box.appendChild(head);
  const cols = el('div', 'ps-cols');
  const kv = (title, rows) => {
    const sec = el('div');
    sec.appendChild(el('div', 'ps-h2', title));
    const tb = el('table', 'ps-kv');
    for (const [k, val] of rows) { const tr = el('tr'); tr.append(el('td', null, k), el('td', null, val)); tb.appendChild(tr); }
    sec.appendChild(tb);
    return sec;
  };
  cols.append(
    kv('Inputs', t.inputs.map(([id, label, kind]) => [label, inputText(kind, v[id])]).filter(([, x]) => x)),
    kv('Results', out.lines.map(([k, val, , why]) => [why ? `${k} (${why})` : k, val])),
  );
  box.appendChild(cols);
  if (out.warnings.length) { box.appendChild(el('div', 'ps-h2', 'Check')); const ul = el('ul', 'ps-list'); for (const w of out.warnings) ul.appendChild(el('li', null, w)); box.appendChild(ul); }
  for (const tb of out.tables) {
    box.appendChild(el('div', 'ps-h2', tb.title || ''));
    const table = el('table', 'ps-table');
    const tr = el('tr');
    for (const h of tb.head) tr.appendChild(el('th', null, String(h)));
    table.appendChild(tr);
    for (const r of tb.rows) { const row = el('tr'); r.forEach((c, j) => row.appendChild(el('td', j ? 'r' : null, c === null || c === undefined ? '—' : String(c)))); table.appendChild(row); }
    box.appendChild(table);
  }
  if (t.explain) box.appendChild(el('p', 'ps-foot', `How it is worked out: ${t.explain}`));
  if (t.note) box.appendChild(el('p', 'ps-foot', t.note));
  printed(`${t.title} (Tools)`, { map: 'none: a tool’s own inputs (filled from a deal, they are a copy made then)' });
  window.print();
}

/* ------------------------------------------------------------------ WALT */

function openWalt(t) {
  const mem = (memory.walt ||= { rows: [{}, {}, {}] });
  const add = el('button', 'btn btn-gray', '+ Row');
  add.type = 'button';
  const copy = el('button', 'btn', 'Copy results');
  copy.type = 'button';
  const body = api.sheetOpen({ eyebrow: `Tools · ${t.group}`, title: t.title, sub: 'One row per lease. Rent is the annual total; write Vacant as the tenant for empty space.', foot: [add, copy] });
  const wrap = el('div', 'scroll');
  const table = el('table', 'rows-edit');
  wrap.appendChild(table);
  body.appendChild(wrap);
  const res = el('ul', 'results');
  body.appendChild(res);
  let lines = [];
  const update = () => {
    remember();
    const s = waltTool(mem.rows.map((r) => ({ tenant: r.tenant, sf: parseNum(r.sf), annual: quantizeToolInput('money', 'Annual rent', parseNum(r.annual)), end: r.end || null })));
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

/** Every tool, for the command menu. */
export const toolIndex = () => TOOLS.map((t) => ({ id: t.id, title: t.title, desc: t.desc, group: t.group }));
/** Open a tool by id, from anywhere: the Tools screen comes up behind it. */
export function openToolById(id) {
  const t = TOOLS.find((x) => x.id === id);
  if (!t) return;
  api.showView('tools');
  open(t);
}

export function initTools(compsApi) {
  api = compsApi;
  render();
  roundSavedInputs();
}

/** Saved Tools inputs and scenarios from before 4.1, rounded once like other stored money; each change logged. */
async function roundSavedInputs() {
  if (memory.__moneyVersion >= MONEY_VERSION) return;
  const changes = [];
  for (const t of TOOLS) if (memory[t.id] && !t.rows) changes.push(...quantizeToolValues(memory[t.id], t.inputs, `${t.title}: `));
  memory.__moneyVersion = MONEY_VERSION;
  remember();
  const all = (await kvGet(SAVED)) || {};
  let n = 0;
  for (const t of TOOLS) {
    for (const sc of all[t.id] || []) { const c = quantizeToolValues(sc.values, t.inputs, `${t.title}, scenario “${sc.name}”: `); changes.push(...c); n += c.length; }
  }
  if (n) await kvSet(SAVED, all);
  await logRounding(changes, 'Tools');
}
