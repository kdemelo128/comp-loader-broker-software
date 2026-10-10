/* t12.js -- a trailing-twelve-month operating statement (a T-12) read from
 * its cells, each line put in a standard category, and its NOI worked out.
 * Pure: the screens (t12ui.js) read the file and keep what this returns on
 * the deal as `deal.t12`. Design: docs/proposals/t12-review-queue.md.
 *
 * Amounts are kept the way the analysis reads them: income positive (a
 * reduction such as vacancy negative), every expense positive as a cost,
 * whatever sign the file used. Each line keeps its months as read
 * (UsdPerMonth) and its total for the period (UsdPerYear over 12 months; over
 * fewer months it is what those months add up to, never scaled up). */

/* ------------------------------------------------------------ categories */

/**
 * @typedef {'income'|'expense'|'below'} Side
 * @typedef {{ id: string, label: string, side: Side, reduces?: boolean, generic?: number, rules: RegExp[], unless?: RegExp }} Category
 * `generic`: a catch-all, 1 (base rent) or 2 (other income, other operating); a more specific category wins over it
 */

/** The standard categories, in the order a statement is shown. Rules are tried on the normalised label. */
/** @type {Category[]} */
export const CATEGORIES = [
  // income
  { id: 'rent', label: 'Base rent', side: 'income', generic: 1, rules: [/\brents?\b/, /\brental (income|revenue)\b/, /\bgross potential\b/, /\bgpr\b/, /\bscheduled (rent|income)\b/], unless: /\b(free|abate|concession|parking|garage|reimb|recover|loss to lease|vacan|expense|storage|pet|laundry)/ },
  { id: 'vacancy', label: 'Vacancy and credit loss', side: 'income', reduces: true, rules: [/\bvacan/, /\bcredit loss\b/, /\bbad debts?\b/, /\bcollection loss/, /\bloss to lease\b/, /\bwrite ?offs?\b/, /\b(model|employee|down|non ?revenue) units?\b/, /\buncollect/] },
  { id: 'concessions', label: 'Concessions and free rent', side: 'income', reduces: true, rules: [/\bconcession/, /\bfree rent\b/, /\babate/, /\bmove ?in special/, /\brent discount/] },
  { id: 'recoveries', label: 'Expense recoveries', side: 'income', rules: [/\bcam\b/, /\breimburs/, /\brecover/, /\bcommon area\b/, /\bpass ?through/, /\bescalation/, /\brubs\b/] },
  { id: 'parking', label: 'Parking', side: 'income', rules: [/\bparking\b/, /\bgarage\b/, /\bcarport/] },
  { id: 'otherIncome', label: 'Other income', side: 'income', generic: 2, rules: [/\bother (income|revenue)\b/, /\bmisc(ellaneous)? (income|revenue)\b/, /\blate (fee|charge)/, /\bfee income\b/, /\bapplication fee/, /\bstorage\b/, /\blaundry\b/, /\bvending\b/, /\bpet (fee|rent)/, /\binterest income\b/, /\bsignage\b/, /\bantenna/, /\bcell tower/, /\btermination fee/, /\bnsf\b/, /\bincome\b/] },
  // operating expenses
  { id: 'taxes', label: 'Real estate taxes', side: 'expense', rules: [/\breal estate tax/, /\bproperty tax/, /\bre taxes?\b/, /\bad valorem\b/, /\btaxes\b/, /\btax\b/, /\bpilot\b/], unless: /\b(payroll|income tax|franchise|recover|reimb)/ },
  { id: 'insurance', label: 'Insurance', side: 'expense', rules: [/\binsur/, /\bpremium/], unless: /\b(recover|reimb|workers comp)/ },
  { id: 'utilities', label: 'Utilities', side: 'expense', rules: [/\butilit/, /\belectric/, /\bgas\b/, /\bwater\b/, /\bsewer\b/, /\btrash\b/, /\brefuse\b/, /\bgarbage\b/, /\bwaste\b/, /\bpower\b/, /\benergy\b/, /\bheating oil\b/, /\bfuel\b/], unless: /\b(income|reimb|recover|rubs)/ },
  { id: 'repairs', label: 'Repairs and maintenance', side: 'expense', rules: [/\brepair/, /\bmaint/, /\br ?(and|&) ?m\b/, /\bsupplies\b/, /\bhvac\b/, /\bplumbing\b/, /\bpaint/, /\bturnover\b/, /\bmake ready\b/, /\bgeneral building\b/, /\bpest\b/], unless: /\boffice\b/ },
  { id: 'contract', label: 'Contract services', side: 'expense', rules: [/\bjanitor/, /\bcleaning\b/, /\blandscap/, /\bsnow\b/, /\bsecurity\b/, /\belevator/, /\bcontract (service|labor)/, /\bgrounds\b/, /\balarm\b/, /\bfire (protection|monitoring|safety)/, /\bwindow wash/, /\bporter/, /\bpatrol/], unless: /\b(deposit|income)/ },
  { id: 'management', label: 'Management fee (property)', side: 'expense', rules: [/\bproperty management\b/, /\bproperty mgmt\b/, /\bmanagement fees? property\b/, /\bmanaging agent\b/, /\bmanagement company\b/, /\bpm fees?\b/] },
  { id: 'payroll', label: 'Payroll', side: 'expense', rules: [/\bpayroll/, /\bsalar/, /\bwages?\b/, /\bemployee/, /\bstaff\b/, /\bbenefits?\b/, /\bbonus/, /\bworkers comp/, /\bsuperintendent/, /\bon ?site manager/, /\bleasing agent/], unless: /\b(units?|unit rent)\b/ },
  { id: 'admin', label: 'General and administrative', side: 'expense', rules: [/\badmin/, /\bg ?(and|&) ?a\b/, /\boffice (expense|supplies)/, /\blegal\b/, /\baccounting\b/, /\baudit\b/, /\bprofessional (fee|service)/, /\btelephone\b/, /\binternet\b/, /\bsoftware\b/, /\bpostage\b/, /\bbank (fee|charge)/, /\blicen[cs]e/, /\bpermit/, /\bdues\b/, /\bsubscription/, /\btravel\b/, /\bmarketing\b/, /\badvertis/, /\bpromotion/, /\bleasing (expense|cost)/, /\bcomputer\b/] },
  { id: 'otherOpex', label: 'Other operating', side: 'expense', generic: 2, rules: [/\bother (operating|expense)/, /\bmisc(ellaneous)? (expense|operating)/, /\bmiscellaneous\b/, /\bexpenses?\b/] },
  // below the line: kept, not in NOI
  { id: 'capex', label: 'Capital expenditures', side: 'below', rules: [/\bcapital\b/, /\bcapex\b/, /\bcap ex\b/, /\bimprovements?\b/, /\bresurfac/] , unless: /\btenant improvement/ },
  { id: 'reserves', label: 'Reserves', side: 'below', rules: [/\breserves?\b/] },
  { id: 'tiLc', label: 'TI and leasing commissions', side: 'below', rules: [/\btenant improvement/, /\bti\b/, /\bleasing commission/, /\blc\b/, /\bcommissions?\b/] },
  { id: 'debt', label: 'Debt service and interest', side: 'below', rules: [/\bdebt service\b/, /\bmortgage\b/, /\binterest expense\b/, /\bloan\b/, /\bprincipal\b/, /\binterest\b/], unless: /\binterest income\b/ },
  { id: 'depreciation', label: 'Depreciation and amortization', side: 'below', rules: [/\bdepreciation\b/, /\bamorti[sz]ation\b/] },
  { id: 'owner', label: 'Owner and partnership costs', side: 'below', rules: [/\basset management\b/, /\basset mgmt\b/, /\bowner/, /\bpartnership\b/, /\bpartner\b/, /\bentity\b/, /\bfranchise tax/, /\borgani[sz]ational/, /\bsponsor/, /\binvestor/, /\bincentive fee/, /\bacquisition fee/, /\bdisposition fee/, /\bfund\b/] },
];
export const CATEGORY = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
export const SIDES = { income: 'Income', expense: 'Operating expenses', below: 'Below the line (not in NOI)' };

/** A label that only says "management fee": property manager's or owner's? Never guessed (approved 2026-10-10). */
const BARE_MANAGEMENT = /^(management|mgmt)( fees?)?$/;

/* -------------------------------------------------------------- labels */

/** A label as it is matched and remembered: lower case, without account numbers or punctuation. */
export function normalizeLabel(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/^\s*[\d][\d\-.]*\s*[·:\-–—]?\s*/, '') // a leading account number: "6100-000 ·", "4010 -"
    .replace(/\(\s*[\d][\d\-.]*\s*\)/g, ' ') // an account number in brackets
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Which category a label goes to. `corrections` holds the broker's own
 * choices ({ normalised label: category id }); `section` is the side the
 * line sits under in the file, when the file says. Returns
 * { category, how: 'yours'|'rule'|'review', why, candidates }.
 */
export function matchLabel(label, { section = null, corrections = {} } = {}) {
  const key = normalizeLabel(label);
  if (corrections && Object.prototype.hasOwnProperty.call(corrections, key) && CATEGORY[corrections[key]]) {
    return { category: corrections[key], how: 'yours', why: 'your choice for this label', candidates: [corrections[key]] };
  }
  if (BARE_MANAGEMENT.test(key)) return { category: null, how: 'review', why: 'a management fee: the property manager’s (operating) or the owner’s (below the line)?', candidates: ['management', 'owner'] };
  let hits = CATEGORIES.filter((c) => c.rules.some((re) => re.test(key)) && !(c.unless && c.unless.test(key)));
  // a specific category wins over a catch-all, and base rent over "other income"
  const level = Math.min(...hits.map((c) => c.generic || 0));
  hits = hits.filter((c) => (c.generic || 0) === level);
  // where the file says which part of the statement a line is in, a category on the other side doesn't fit
  const fits = section ? hits.filter((c) => c.side === section || (section === 'expense' && c.side === 'below')) : hits;
  if (fits.length === 1) return { category: fits[0].id, how: 'rule', why: section && hits.length > 1 ? `the only fit under ${SIDES[section].toLowerCase()}` : 'its wording', candidates: [fits[0].id] };
  if (!hits.length) return { category: null, how: 'review', why: 'no category fits its wording', candidates: [] };
  if (!fits.length) return { category: null, how: 'review', why: `its wording fits ${hits.map((c) => c.label.toLowerCase()).join(' or ')}, but it sits under ${SIDES[section].toLowerCase()}`, candidates: hits.map((c) => c.id) };
  return { category: null, how: 'review', why: `its wording fits ${fits.map((c) => c.label.toLowerCase()).join(' and ')}`, candidates: fits.map((c) => c.id) };
}

/* -------------------------------------------------------------- numbers */

/** An amount as a statement writes it: "$1,250", "(1,250)", "1,250-", "–" (zero). NaN when the text isn't an amount. */
export function amountOf(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (v === null || v === undefined) return NaN;
  let s = String(v).trim();
  if (!s) return NaN;
  if (/^[-–—]+$/.test(s)) return 0;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }
  s = s.replace(/[$,\s]/g, '');
  if (/^-/.test(s)) { neg = !neg; s = s.slice(1); }
  if (!/^\d*\.?\d+$/.test(s)) return NaN;
  const n = Number(s);
  return neg ? -n : n;
}
const cents = (x) => Math.round(x * 100) / 100;

/* --------------------------------------------------------------- months */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n) => String(n).padStart(2, '0');
const year4 = (y) => (y < 100 ? 2000 + y : y);

/**
 * A column heading read as a month: { iso: 'YYYY-MM' } for a dated month,
 * { index } for "Month 3" or "Period 3", or null.
 */
export function monthOf(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim().toLowerCase();
  let m = /^(\d{4})-(\d{2})(-\d{2})?$/.exec(s); // an ISO date (a date cell, as read) or "2025-01"
  if (m && +m[2] >= 1 && +m[2] <= 12) return { iso: `${m[1]}-${m[2]}` };
  m = /^([a-z]{3,9})\.?[\s\-/']*(\d{2}|\d{4})$/.exec(s); // "Jan-25", "January 2025", "Jan '25"
  if (m) { const i = MONTHS.indexOf(m[1].slice(0, 3)); if (i >= 0 && (m[1].length === 3 || m[1].startsWith(MONTHS[i]))) return { iso: `${year4(+m[2])}-${pad(i + 1)}` }; }
  m = /^(\d{1,2})[/\-.](\d{2}|\d{4})$/.exec(s); // "01/2025", "1-25"
  if (m && +m[1] >= 1 && +m[1] <= 12) return { iso: `${year4(+m[2])}-${pad(+m[1])}` };
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s); // "1/31/2025": the month it ends
  if (m && +m[1] >= 1 && +m[1] <= 12) return { iso: `${year4(+m[3])}-${pad(+m[1])}` };
  m = /^(month|mo|period|p)\.?\s*(\d{1,2})$/.exec(s);
  if (m && +m[2] >= 1 && +m[2] <= 12) return { index: +m[2] };
  return null;
}
const TOTAL_HEAD = /^(total|totals|t-?12|ttm|trailing( 12| twelve)?( months?)?|annual|year total|ytd|12 months?)\b/i;

/** "Jan 2025" for "2025-01". */
export const monthLabel = (iso) => (/^\d{4}-\d{2}$/.test(iso || '') ? `${MONTHS[+iso.slice(5) - 1].replace(/^./, (c) => c.toUpperCase())} ${iso.slice(0, 4)}` : String(iso || ''));

/* ------------------------------------------------------------- reading */

const SUBTOTAL = /^(total|subtotal|sub total|net operating|net income|noi\b|effective gross|egi\b|gross (operating )?income\b|cash flow|income before)/;
/** @type {[string, RegExp][]} */
const STATED = [
  ['noi', /^(net operating income|noi)\b/],
  ['egi', /^(effective gross (income|revenue)|egi|total (operating )?(income|revenue|receipts)|gross (operating )?income)\b/],
  ['opex', /^total (operating )?expenses?\b|^total opex\b/],
];
/** @type {[Side, RegExp][]} */
const HEADING = [
  ['income', /\b(income|revenues?|receipts)\b/],
  ['below', /\b(below the line|non ?operating|capital|after noi|debt service|other (items|expenses) not in noi)\b/],
  ['expense', /\b(expenses?|expenditures?|costs?)\b/],
];

/**
 * Read a statement from a sheet's rows ([{ r, cells }], as sheetread.js gives
 * them). Returns { months, monthCols, totalCol, labelCol, lines, stated,
 * subtotals, sections } or throws with what was missing.
 */
export function readStatement(rows, { corrections = {}, sheet = '' } = {}) {
  // 1. the heading row: the first, in the top 40, with three or more months
  let head = null;
  for (const row of rows.slice(0, 40)) {
    const ms = row.cells.map(monthOf);
    const n = ms.filter(Boolean).length;
    if (n >= 3) { head = { row, ms }; break; }
  }
  // a statement with only an annual column: the first row with a Total heading
  if (!head) {
    for (const row of rows.slice(0, 40)) {
      if (row.cells.some((c) => typeof c === 'string' && TOTAL_HEAD.test(c.trim()))) { head = { row, ms: row.cells.map(() => null) }; break; }
    }
  }
  if (!head) throw new Error(`No months or total column were found${sheet ? ` on “${sheet}”` : ''}: a T-12 needs a row of month headings (Jan 2025, 01/2025 …) or a Total column.`);
  const monthCols = [];
  head.ms.forEach((m, c) => { if (m) monthCols.push({ c, ...m }); });
  // dated months in order; "Month 1…12" by their number
  const months = monthCols.map((m) => m.iso || `M${pad(m.index)}`);
  let totalCol = head.row.cells.findIndex((c, i) => i > (monthCols.length ? monthCols[monthCols.length - 1].c : -1) && typeof c === 'string' && TOTAL_HEAD.test(c.trim()));
  if (totalCol < 0) totalCol = head.row.cells.findIndex((c) => typeof c === 'string' && TOTAL_HEAD.test(c.trim()));
  if (totalCol < 0) totalCol = null;
  const numCols = [...monthCols.map((m) => m.c), ...(totalCol !== null ? [totalCol] : [])];
  const firstNum = Math.min(...numCols);

  // 2. the label column: left of the numbers, the one with the most words; an account-number column beside it is kept
  const body = rows.filter((x) => x.r > head.row.r);
  let labelCol = 0; let best = -1; let accountCol = null;
  for (let c = 0; c < firstNum; c++) {
    let words = 0; let codes = 0;
    for (const x of body) {
      const v = x.cells[c];
      if (typeof v === 'string' && /[a-z]{3}/i.test(v)) words += 1;
      else if (v !== null && v !== undefined && /^[\d][\d\-.]*$/.test(String(v).trim())) codes += 1;
    }
    if (words > best) { best = words; labelCol = c; }
    if (codes > body.length / 3) accountCol = c;
  }
  if (accountCol === labelCol) accountCol = null;

  // 3. lines, headings and subtotals, top to bottom
  const lines = []; const subtotals = []; const stated = {}; const sections = [];
  let section = null; let sinceMark = [];
  let afterNoi = false;
  for (const x of body) {
    const raw = x.cells[labelCol];
    const label = raw === null || raw === undefined ? '' : String(raw).trim();
    const account = accountCol !== null && x.cells[accountCol] !== null && x.cells[accountCol] !== undefined ? String(x.cells[accountCol]).trim() : '';
    const vals = monthCols.map((m) => amountOf(x.cells[m.c]));
    const tot = totalCol !== null ? amountOf(x.cells[totalCol]) : NaN;
    const hasNum = vals.some(Number.isFinite) || Number.isFinite(tot);
    const key = normalizeLabel(label);
    if (!label && !hasNum) continue;
    if (!hasNum) {
      // a heading: which part of the statement follows
      const h = HEADING.find(([, re]) => re.test(key));
      if (h) { section = h[0]; sections.push({ r: x.r, label, side: section }); sinceMark = []; }
      continue;
    }
    if (!label) continue; // numbers with no label: a total row without words is not guessed at
    const months12 = vals.map((v) => (Number.isFinite(v) ? v : 0));
    const sum = cents(months12.reduce((s, v) => s + v, 0));
    const total = monthCols.length ? sum : (Number.isFinite(tot) ? tot : 0);
    if (SUBTOTAL.test(key)) {
      const st = STATED.find(([, re]) => re.test(key));
      const value = Number.isFinite(tot) ? tot : total;
      if (st && stated[st[0]] === undefined) stated[st[0]] = { r: x.r, label, value };
      else subtotals.push({ r: x.r, label, value, covers: sinceMark.map((l) => l.id) });
      if (st && st[0] === 'noi') { afterNoi = true; section = 'below'; }
      else if (st && st[0] === 'egi' && section === 'income') section = 'expense';
      else if (st && st[0] === 'opex') section = afterNoi ? 'below' : 'expense';
      sinceMark = [];
      continue;
    }
    const line = {
      id: `L${x.r}`, r: x.r, account, label, key,
      section: afterNoi ? 'below' : section,
      months: months12.map(cents),
      total: cents(total),
      fileTotal: Number.isFinite(tot) && monthCols.length ? cents(tot) : null,
    };
    const m = matchLabel(label, { section: line.section, corrections });
    Object.assign(line, { category: m.category, how: m.how, why: m.why, candidates: m.candidates });
    lines.push(line);
    sinceMark.push(line);
  }
  if (!lines.length) throw new Error('No statement lines were found under the month headings.');
  return { sheet, months, labelCol, accountCol, totalCol, monthCols: monthCols.map((m) => m.c), lines, stated, subtotals, sections, headRow: head.row.r };
}

/**
 * The file's sign conventions turned into the analysis's: income positive,
 * reductions negative, expenses positive as costs. Decided for the whole
 * file from the sides its lines are in: where most expense lines are
 * negative, the file writes expenses negative, and so on. Returns a copy.
 */
export function normalizeSigns(st) {
  const side = (l) => (l.category ? CATEGORY[l.category].side : l.section);
  const majorityNegative = (ls) => { const xs = ls.filter((l) => l.total !== 0); return xs.length > 0 && xs.filter((l) => l.total < 0).length > xs.length / 2; };
  const expenseLike = st.lines.filter((l) => side(l) === 'expense' || side(l) === 'below');
  const reductions = st.lines.filter((l) => l.category && CATEGORY[l.category].reduces);
  const flipExpenses = majorityNegative(expenseLike);
  // reductions written as positive amounts under income ("Less: vacancy  12,000") are made negative
  const flipReductions = reductions.length > 0 && !majorityNegative(reductions);
  const out = { ...st, signs: { expensesNegative: flipExpenses, reductionsPositive: flipReductions } };
  out.lines = st.lines.map((l) => {
    const s = side(l);
    let f = 1;
    if ((s === 'expense' || s === 'below') && flipExpenses) f = -1;
    if (l.category && CATEGORY[l.category].reduces && flipReductions) f = -1;
    return f === 1 ? l : { ...l, months: l.months.map((v) => cents(-v) || 0), total: cents(-l.total) || 0, fileTotal: l.fileTotal === null ? null : cents(-l.fileTotal) || 0, signFlipped: true };
  });
  // what the file states is compared the same way
  out.stated = Object.fromEntries(Object.entries(st.stated).map(([k, v]) => [k, { ...v, value: k === 'opex' && flipExpenses ? cents(-v.value) : v.value }]));
  return out;
}

/* ---------------------------------------------------------- the totals */

/** What the statement adds up to, from its lines as they are now categorised. Lines still to review count in no category. */
export function statementTotals(t) {
  const by = Object.fromEntries(CATEGORIES.map((c) => [c.id, 0]));
  let unassigned = 0;
  for (const l of t.lines) {
    if (l.category && by[l.category] !== undefined) by[l.category] = cents(by[l.category] + l.total);
    else unassigned = cents(unassigned + l.total);
  }
  const sum = (side) => cents(CATEGORIES.filter((c) => c.side === side).reduce((s, c) => s + by[c.id], 0));
  const egi = sum('income'); const opex = sum('expense'); const below = sum('below');
  return { by, egi, opex, below, taxes: by.taxes, noi: cents(egi - opex), unassigned, months: t.months.length };
}

/**
 * What the statement's own numbers say that doesn't add up, and what is
 * missing: [{ id, kind, text, amount }]. `id` is stable, so "seen" can be kept.
 */
export function statementChecks(t) {
  const out = [];
  const T = statementTotals(t);
  const money = (x) => `$${Math.round(Math.abs(x)).toLocaleString('en-US')}`;
  const n = t.months.length;
  if (n && n < 12) out.push({ id: 'months', kind: 'partial', text: `Only ${n} month${n === 1 ? '' : 's'} (${monthLabel(t.months[0])} to ${monthLabel(t.months[n - 1])}): the totals are for those months and are not scaled up to a year.`, amount: Math.abs(T.noi) });
  if (!n) out.push({ id: 'months', kind: 'partial', text: 'No monthly columns: only the annual total was read.', amount: Math.abs(T.noi) });
  const off = t.lines.filter((l) => l.fileTotal !== null && Math.abs(l.fileTotal - l.total) > 1);
  if (off.length) out.push({ id: 'linetotals', kind: 'sumTotal', text: `${off.length} line${off.length === 1 ? '’s' : 's’'} months don’t add up to the file’s Total column (${off.slice(0, 3).map((l) => `${l.label}: months ${money(l.total)}, Total ${money(l.fileTotal)}`).join('; ')}${off.length > 3 ? '; …' : ''}). The months are used.`, amount: off.reduce((s, l) => s + Math.abs(l.fileTotal - l.total), 0) });
  if (!T.unassigned) {
    for (const [k, label] of [['egi', 'effective gross income'], ['opex', 'operating expenses'], ['noi', 'NOI']]) {
      const s = t.stated[k];
      if (s && Math.abs(Math.abs(s.value) - Math.abs(T[k])) > 1) out.push({ id: `stated.${k}`, kind: 'stated', text: `The file states ${label} of ${money(s.value)} (row ${s.r}); its lines add up to ${money(T[k])}.`, amount: Math.abs(Math.abs(s.value) - Math.abs(T[k])) });
    }
  }
  const byId = new Map(t.lines.map((l) => [l.id, l]));
  for (const s of t.subtotals) {
    const ls = s.covers.map((id) => byId.get(id)).filter(Boolean);
    if (!ls.length) continue;
    const sum = cents(ls.reduce((a, l) => a + l.total, 0));
    if (Math.abs(Math.abs(sum) - Math.abs(s.value)) > 1) out.push({ id: `sub.${s.r}`, kind: 'stated', text: `“${s.label}” (row ${s.r}) is ${money(s.value)}; the ${ls.length} line${ls.length === 1 ? '' : 's'} above it add up to ${money(sum)}.`, amount: Math.abs(Math.abs(sum) - Math.abs(s.value)) });
  }
  return out;
}

/**
 * The whole import: rows → the statement as the deal keeps it.
 * { file, sheet, importedAt, months, lines, stated, subtotals, signs, seen: {} }.
 */
export function importStatement(rows, { file = '', sheet = '', corrections = {}, now = Date.now() } = {}) {
  const st = normalizeSigns(readStatement(rows, { corrections, sheet }));
  return { file, sheet, importedAt: now, months: st.months, lines: st.lines, stated: st.stated, subtotals: st.subtotals, signs: st.signs, headRow: st.headRow, seen: {} };
}

/** Of several sheets, the one that reads as a statement with the most lines: { sheet, statement } or throws the first sheet's reason. */
export function bestSheet(grids, opts = {}) {
  let best = null; let firstErr = null;
  for (const g of grids) {
    try {
      const s = importStatement(g.rows, { ...opts, sheet: g.sheet });
      if (!best || s.lines.length > best.lines.length) best = s;
    } catch (e) { if (!firstErr) firstErr = e; }
  }
  if (!best) throw firstErr || new Error('No statement was found in that file.');
  return best;
}

/** Re-apply the rules and the broker's corrections to the lines not yet decided by hand (after a correction is remembered). */
export function rematch(t, corrections) {
  return { ...t, lines: t.lines.map((l) => (l.how === 'you' ? l : { ...l, ...pick(matchLabel(l.label, { section: l.section, corrections })) })) };
}
const pick = (m) => ({ category: m.category, how: m.how, why: m.why, candidates: m.candidates });

/** The lines still waiting for a category. */
export const openLines = (t) => (t && t.lines ? t.lines.filter((l) => !l.category) : []);
/** The statement's checks not yet marked seen. */
export const openChecks = (t) => (t ? statementChecks(t).filter((c) => !(t.seen && t.seen[c.id])) : []);

/** What the analysis reads of a deal's T-12 (impact.js analysisInput): its totals, and how many months they cover. */
export function t12ForAnalysis(t) {
  if (!t || !Array.isArray(t.lines)) return null;
  const T = statementTotals(t);
  return { noi: T.noi, egi: T.egi, opex: T.opex, taxes: T.taxes, months: T.months, from: t.months[0] || null, to: t.months[t.months.length - 1] || null, unassigned: T.unassigned };
}

/**
 * File a line under a category, as the broker chose (in place): the line,
 * and with `sameLabel` every other line with the same normalised label not
 * already decided by hand. Returns the lines changed.
 */
export function fileLine(t, lineId, category, { sameLabel = true } = {}) {
  const line = t.lines.find((l) => l.id === lineId);
  if (!line || !CATEGORY[category]) return [];
  const changed = t.lines.filter((l) => l === line || (sameLabel && l.key === line.key && l.how !== 'you'));
  for (const l of changed) Object.assign(l, { category, how: 'you', why: 'your choice', candidates: [category] });
  return changed;
}
/** A check marked seen (in place): it stays in the statement, and leaves the Review Queue. */
export function markSeen(t, checkId) {
  t.seen = { ...(t.seen || {}), [checkId]: true };
}
/** The months a statement covers, in words: "Jan 2025 to Dec 2025 (12 months)". */
export function periodText(t) {
  const n = t.months.length;
  if (!n) return 'annual total only';
  return `${monthLabel(t.months[0])} to ${monthLabel(t.months[n - 1])} (${n} month${n === 1 ? '' : 's'})`;
}
