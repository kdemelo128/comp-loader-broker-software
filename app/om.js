/* om.js -- read the numbers out of an offering memorandum.
 *
 * Offering memoranda have no standard layout. Each broker's marketing team
 * sets out the same facts differently: a label and its value side by side
 * ("Asking Price   $4,950,000"), a big figure with its caption underneath, a
 * sentence ("offered at $4,950,000, a 6.25% cap rate"), or a financial table
 * with a Current and a Pro Forma column. So this module does not look for a
 * layout. It looks for labels, takes the value nearest each one in any of
 * those arrangements, and scores every candidate:
 *
 *   - by how specific the label is ("Asking Price" beats "Price"),
 *   - by where it sits (an Investment Summary or the first few pages beat
 *     page 31's demographics),
 *   - by agreement (the same price printed on three pages is more likely
 *     right than a figure printed once).
 *
 * Every value keeps the page and line it came from, and the runners-up are
 * kept too, so the person checking the OM on site can see exactly where a
 * number came from and swap it for another with one tap. Nothing is
 * inferred silently: a figure worked out from others (NOI from price and cap
 * rate, say) is marked as derived by deal.js, not passed off as read.
 *
 * Input is page text from layout.js, where a visible gap is two or more
 * spaces, so a line splits into the cells a reader sees. */

/* ------------------------------------------------------------ the cells */

/** A line split at its visible gaps: [{ text, start, end }] by character column. */
export function splitCells(line) {
  const cells = [];
  const re = /\S+(?: \S+)*/g;
  let m;
  while ((m = re.exec(line))) cells.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  return cells;
}

/* --------------------------------------------------------------- values */

const NUM = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)`;
const SCALE = { k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, mil: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9 };

const toNum = (s) => Number(String(s).replace(/,/g, ''));

/** A dollar amount: "$4,950,000", "$4.95M", "4,950,000", "$(12,400)". */
export function parseMoney(s) {
  const m = new RegExp(String.raw`(\(|-\s?)?\$?\s?${NUM}\s*(billion|million|thousand|mil|mm|bn|[kmb])?(?![a-z])`, 'i').exec(s);
  if (!m) return null;
  let v = toNum(m[2]);
  if (m[3]) v *= SCALE[m[3].toLowerCase()] || 1;
  // a bare number with no dollar sign, no separator and no scale is too
  // easily a year, a suite or a page number to count as money
  if (!/\$/.test(m[0]) && !/,/.test(m[2]) && !m[3] && v < 10000) return null;
  if (m[1]) v = -v;
  return Number.isFinite(v) ? v : null;
}

/** A percentage: "6.25%", "6.25 %". With `bare`, also "6.25" (a cap-rate row with no sign). */
export function parsePct(s, bare = false) {
  let m = /(-?\d{1,3}(?:\.\d+)?)\s?%/.exec(s);
  if (!m && bare) m = /^\s*(\d{1,2}\.\d{1,3})\s*$/.exec(s);
  return m ? Number(m[1]) : null;
}

/** An area in SF. Acres are converted; `acresByDefault` reads a bare small number as acres. */
export function parseArea(s, acresByDefault = false) {
  const m = new RegExp(String.raw`${NUM}\s*(acres?|ac\b|±?\s?sf\b|s\.f\.|sq\.?\s?f(?:ee)?t\.?|square feet|rsf\b|gsf\b|nsf\b|gla\b)?`, 'i').exec(s);
  if (!m) return null;
  const v = toNum(m[1]);
  const unit = (m[2] || '').toLowerCase();
  if (/^ac/.test(unit)) return { sf: v * 43560, acres: v };
  if (!unit && acresByDefault && v < 1000) return { sf: v * 43560, acres: v };
  return { sf: v, acres: null };
}

export function parseYear(s) {
  const m = /\b(1[7-9]\d\d|20\d\d)\b/.exec(s);
  return m ? Number(m[1]) : null;
}

export function parseInt0(s) {
  const m = new RegExp(String.raw`^\s*\(?${NUM}`).exec(s);
  if (!m) return null;
  const v = toNum(m[1]);
  return Number.isInteger(v) ? v : null;
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const fullYear = (y) => (y < 100 ? (y < 70 ? 2000 + y : 1900 + y) : y);

/** A lease date as OMs print one: 12/31/2029, 12/31/29, 12/2029, 12/29, Dec-29, Dec 2029, 2029, MTM. */
export function parseDate(s) {
  const t = String(s).trim();
  if (/^(mtm|month[- ]to[- ]month)$/i.test(t)) return { mtm: true, date: null };
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(t);
  if (m) return { date: new Date(Date.UTC(fullYear(+m[3]), +m[1] - 1, +m[2])) };
  m = /^(\d{1,2})[/-](\d{2}|\d{4})$/.exec(t);
  if (m && +m[1] >= 1 && +m[1] <= 12) {
    const y = fullYear(+m[2]);
    return { date: new Date(Date.UTC(y, +m[1], 0)) };               // the end of that month
  }
  m = /^([A-Za-z]{3,9})\.?[-\s']+(\d{2}|\d{4})$/.exec(t);
  const mon = m ? (MONTHS[m[1].slice(0, 4).toLowerCase()] ?? MONTHS[m[1].slice(0, 3).toLowerCase()]) : undefined;
  if (mon !== undefined) return { date: new Date(Date.UTC(fullYear(+m[2]), mon + 1, 0)) };
  m = /^(19|20)\d\d$/.exec(t);
  if (m) return { date: new Date(Date.UTC(+t, 11, 31)) };
  return null;
}

/* ------------------------------------------------------------- the fields */

/* Each field: its kind, the labels that introduce it (most specific first,
 * with a weight), words that send a match elsewhere or nowhere, and a
 * plausible range. `pre` patterns catch a value printed BEFORE its words,
 * as prose does ("a 6.25% cap rate", "100% leased"). */
const PROFORMA = /\b(pro[- ]?forma|stabili[sz]ed|projected|year\s*(?:2|3|5|10)|budget|underwritten|market rent|upside|post[- ])/i;
const NOT_CURRENT = /\b(exit|terminal|residual|reversion|market cap|average cap|submarket|comps?\b|comparable)/i;

export const FIELDS = {
  price: {
    label: 'Asking price', kind: 'money', min: 50000, max: 5e9,
    labels: [
      [/\b(asking|offering|list(?:ing)?|purchase|sale|sales|investment)\s+price\b(?!\s*(?:per|\/|psf))/i, 3],
      [/\boffered (?:for sale )?(?:at|for)\b/i, 2.5],
      [/^(?:total\s+)?price\b(?!\s*(?:per|\/|psf|range))/i, 2],
      [/\bpricing\b(?!\s*(?:per|\/|psf|guidance\s+per))/i, 1],
    ],
    skip: /\b(per\s+(?:sf|unit|key|bed|acre|door)|\/\s*(?:sf|unit|key)|psf|land price|price per)\b/i,
  },
  price_psf: {
    label: 'Price per SF (stated)', kind: 'money', min: 1, max: 20000, smallMoney: true,
    labels: [[/\bprice\s*(?:per|\/)\s*(?:sf|sq\.?\s?f(?:oo|ee)?t|square foot|rsf|gsf|nsf)\b|\bprice\s*psf\b/i, 3]],
  },
  price_unit: {
    label: 'Price per unit (stated)', kind: 'money', min: 1000, max: 50e6,
    labels: [[/\bprice\s*(?:per|\/)\s*(?:unit|door|key|bed)\b/i, 3]],
  },
  noi: {
    label: 'NOI (in place)', kind: 'money', min: 1000, max: 1e9,
    labels: [
      [/\b(?:in[- ]place|current|actual|year\s*1|t-?12|trailing)\s+(?:net operating income|noi)\b/i, 3.5],
      [/\bnet operating income\b|\bnoi\b/i, 3],
    ],
    skip: /\b(per\s+(?:sf|unit)|\/\s*(?:sf|unit)|psf|margin|growth|%)\b/i,
    divert: [PROFORMA, 'noi_pf'],
  },
  noi_pf: {
    label: 'NOI (pro forma)', kind: 'money', min: 1000, max: 1e9,
    labels: [[/\b(?:pro[- ]?forma|stabili[sz]ed|projected|year\s*2)\s+(?:net operating income|noi)\b/i, 3]],
  },
  cap: {
    label: 'Cap rate (stated)', kind: 'pct', min: 1, max: 20,
    labels: [
      [/\b(?:in[- ]place|current|going[- ]in|year\s*1|actual)\s+cap(?:italization)?(?:\s+rate)?\b/i, 3.5],
      [/\bcap(?:italization)?\s+rate\b/i, 3],
      [/^cap\b/i, 2],
    ],
    pre: [/(\d{1,2}(?:\.\d{1,3})?)\s?%\s*(?:in[- ]place\s+|going[- ]in\s+|current\s+)?cap(?:italization)?\s+rate/i],
    skip: NOT_CURRENT,
    divert: [PROFORMA, 'cap_pf'],
  },
  cap_pf: {
    label: 'Cap rate (pro forma)', kind: 'pct', min: 1, max: 20,
    labels: [[/\b(?:pro[- ]?forma|stabili[sz]ed|projected|year\s*2)\s+cap(?:italization)?(?:\s+rate)?\b/i, 3]],
  },
  bsf: {
    label: 'Building SF', kind: 'area', min: 300, max: 10e6,
    labels: [
      [/\b(?:net\s+)?rentable\s+(?:building\s+)?(?:area|sf|square\s+f(?:ee|oo)t(?:age)?)\b|\brba\b|\bnra\b/i, 3],
      [/\b(?:gross\s+)?building\s+(?:area|size|sf|square\s+f(?:ee|oo)t(?:age)?)\b|\bgba\b|\bgla\b|\bgross leasable area\b/i, 3],
      [/\b(?:total\s+)?(?:square\s+f(?:ee|oo)t(?:age)?|sq\.?\s?ft\.?|rsf)\b/i, 2],
      [/^(?:building|size)\b/i, 1],
    ],
    pre: [/(\d{1,3}(?:,\d{3})+)\s*(?:rentable\s+|gross\s+|net rentable\s+)?(?:square feet|sq\.?\s?ft\.?|rsf|sf)\b(?![^.]{0,25}\b(?:lot|land|site|parcel|acre))/i],
    skip: /\b(land|lot|site|parcel|per\s+sf|\$\s*\/|psf|price|rent|vacant|available|leased|occupied|retail sf|office sf|floor plate|typical floor)\b/i,
  },
  lot: {
    label: 'Land area', kind: 'land', min: 300, max: 1e9,
    labels: [[/\b(?:land|lot|site|parcel)\s+(?:area|size|sf|acreage|square\s+f(?:ee|oo)t(?:age)?)\b|\bacreage\b|\b(?:land|lot|site)\b(?=\s*(?:\(|:|$))/i, 3]],
    skip: /\b(price|per|\$\s*\/|psf|coverage|ratio)\b/i,
  },
  units: {
    label: 'Units', kind: 'int', min: 1, max: 5000,
    labels: [[/\b(?:number of|total|# of|no\.? of)\s+(?:apartment\s+|residential\s+|rental\s+)?units\b|^units\b|^unit count\b|^apartment units\b/i, 3]],
    skip: /\b(per\s+unit|\/\s*unit|price|rent|avg|average|retail units|vacant|sf)\b/i,
  },
  year: {
    label: 'Year built', kind: 'year', min: 1700, max: new Date().getFullYear() + 3,
    labels: [[/\byear\s+built\b|\bbuilt\s+in\b|\bconstructed\b|^built\b|\byear\s+(?:of\s+)?construction\b/i, 3]],
  },
  renovated: {
    label: 'Year renovated', kind: 'year', min: 1700, max: new Date().getFullYear() + 3,
    labels: [[/\b(?:year\s+)?renovated\b|\brenovation\b/i, 2]],
  },
  occ: {
    label: 'Occupancy', kind: 'pct', min: 0, max: 100,
    labels: [[/\b(?:current\s+|physical\s+|economic\s+)?(?:occupancy|occupied|percent leased|% leased|leased)\b/i, 3]],
    pre: [/(\d{1,3}(?:\.\d+)?)\s?%\s*(?:occupied|leased|occupancy)\b/i],
    skip: /\b(pro[- ]?forma|stabili[sz]ed|market|submarket|average|avg|vacancy|projected)\b/i,
  },
  gross: {
    label: 'Gross income (EGI)', kind: 'money', min: 1000, max: 2e9,
    labels: [
      [/\beffective gross (?:income|revenue)\b|\begi\b/i, 3],
      [/\btotal (?:gross |rental |operating )?(?:income|revenue)\b|\bgross (?:operating |rental )?(?:income|revenue)\b/i, 2.5],
    ],
    // potential rent at full occupancy is not effective income: it has its own field
    skip: /\b(per\s+(?:sf|unit)|\/\s*(?:sf|unit)|psf|growth|%|multiplier|potential)\b/i,
    divert: [PROFORMA, null],
  },
  gpr: {
    label: 'Gross potential rent', kind: 'money', min: 1000, max: 2e9,
    labels: [[/\bgross potential (?:rent|rental income|income|revenue)\b|\bgpr\b|\bpotential gross (?:income|rent|revenue)\b|\bpgi\b/i, 3]],
    skip: /\b(per\s+(?:sf|unit)|\/\s*(?:sf|unit)|psf|growth|%)\b/i,
    divert: [PROFORMA, null],
  },
  opex: {
    label: 'Operating expenses', kind: 'money', min: 100, max: 1e9,
    labels: [[/\btotal (?:operating )?expenses\b|\btotal opex\b|^operating expenses\b|^expenses\b/i, 3]],
    skip: /\b(per\s+(?:sf|unit)|\/\s*(?:sf|unit)|psf|ratio|%|recover|reimburs)\b/i,
    divert: [PROFORMA, null],
  },
  taxes: {
    label: 'Real estate taxes', kind: 'money', min: 100, max: 1e8,
    labels: [[/\b(?:real estate|property|re)\s+tax(?:es)?\b/i, 3]],
    skip: /\b(per\s+(?:sf|unit)|\/\s*(?:sf|unit)|psf|rate|assess|abatement|%)\b/i,
    divert: [PROFORMA, null],
  },
  stories: {
    label: 'Stories', kind: 'int', min: 1, max: 150,
    labels: [[/\b(?:stories|storeys|floors|number of floors|levels)\b/i, 2]],
    skip: /\b(per|sf|typical|plate)\b/i,
  },
  parking: {
    label: 'Parking', kind: 'text',
    labels: [[/^parking\b/i, 2]],
  },
  zoning: {
    label: 'Zoning', kind: 'text',
    labels: [[/^zoning\b|^zone\b|^zoned\b/i, 3]],
  },
  tenant: {
    label: 'Tenant', kind: 'text',
    labels: [[/^(?:tenant|lessee|tenant name)\b(?!\s*(?:mix|improvements?|reimburse|roster|overview))/i, 3]],
  },
  guarantor: {
    label: 'Guarantor', kind: 'text',
    labels: [[/^(?:lease\s+)?guarant(?:or|y)\b/i, 3]],
  },
  lease_type: {
    label: 'Lease type', kind: 'text',
    labels: [[/^lease\s+type\b|^lease\s+structure\b|^expense structure\b/i, 3]],
  },
  lease_exp: {
    label: 'Lease expiration', kind: 'text',
    labels: [[/^(?:lease\s+)?(?:expiration|expires|end date|term(?:ination)? date)\b|^lease\s+exp/i, 3]],
  },
  term_left: {
    label: 'Term remaining', kind: 'text',
    labels: [[/^(?:remaining\s+(?:lease\s+)?term|lease\s+term\s+remaining|term\s+remaining|years\s+remaining)\b/i, 3]],
  },
  increases: {
    label: 'Rent increases', kind: 'text',
    labels: [[/^(?:rent(?:al)?\s+(?:increases|escalations?|bumps)|escalations?|increases)\b/i, 3]],
  },
  options: {
    label: 'Renewal options', kind: 'text',
    labels: [[/^(?:renewal\s+)?options?\b(?!\s*to\s+purchase)/i, 2]],
  },
};

/* Field order matters where labels overlap: the specific forms (price per SF,
 * pro forma NOI) are tried before the general ones on the same cell. */
const ORDER = ['price_psf', 'price_unit', 'noi_pf', 'cap_pf', 'price', 'noi', 'cap', 'bsf', 'lot', 'units',
  'year', 'renovated', 'occ', 'gpr', 'gross', 'opex', 'taxes', 'stories', 'parking', 'zoning', 'tenant', 'guarantor',
  'lease_type', 'lease_exp', 'term_left', 'increases', 'options'];

const SUMMARY = /(executive|investment|offering|property|financial|deal|pricing)\s+(summary|highlights|overview)|the offering|offering terms|pricing\s*(?:&|and)\s*financ|financial analysis|key facts|at a glance/i;
const FINANCIALS = /operating (statement|history|summary)|income statement|income\s*(?:&|and)\s*expense|cash flow|pro ?forma|t-?12|trailing twelve|rent roll/i;
const DEMOGRAPHICS = /demographic|population|household income|traffic counts?|daytime population|median income|employers/i;

function readValue(F, s, labelText) {
  switch (F.kind) {
    case 'money': {
      let v = parseMoney(s);
      if (v === null && F.smallMoney) {
        const m = /\$\s?(\d+(?:\.\d+)?)/.exec(s);
        v = m ? Number(m[1]) : null;
      }
      return v;
    }
    case 'pct': return parsePct(s, true);
    case 'area': {
      const a = parseArea(s);
      return a ? a.sf : null;
    }
    case 'land': {
      const a = parseArea(s, /\bacre|\(ac\)|\bac\b/i.test(labelText || ''));
      return a ? a.sf : null;
    }
    case 'year': return parseYear(s);
    case 'int': return parseInt0(s);
    case 'text': {
      const t = s.replace(/^[\s:–—-]+/, '').trim();
      return t && t.length <= 80 && !/^\d{1,3}$/.test(t) ? t : null;
    }
    default: return null;
  }
}

const plausible = (F, v) => v !== null && v !== undefined
  && (F.kind === 'text' || (typeof v === 'number' && Number.isFinite(v) && v >= F.min && v <= F.max));

/* A cell that is, by and large, a value (not a sentence that contains one). */
function valueCell(F, cell) {
  const v = readValue(F, cell.text, '');
  if (!plausible(F, v)) return null;
  if (F.kind === 'text') return null;
  const digits = cell.text.replace(/[^\d$%.,]/g, '').length;
  return digits / cell.text.length >= 0.45 || cell.text.length <= 14 ? v : null;
}

/** Every labelled value in the document, scored. */
function candidates(pages) {
  const out = [];
  pages.forEach((page, pi) => {
    const lines = page.split('\n');
    const grid = lines.map(splitCells);
    const pageBonus = (pi < 4 ? 1 : 0) + (SUMMARY.test(page) ? 2 : 0) - (DEMOGRAPHICS.test(page) && !SUMMARY.test(page) ? 2 : 0);
    const finBonus = FINANCIALS.test(page) ? 1 : 0;

    // an operating statement with a Pro Forma column: the column headings
    // that say so, carried down to the rows beneath them
    const pfCols = [];
    let cur = null;
    let since = 0;
    grid.forEach((cells, li) => {
      const heads = cells.filter((c) => c.text.length <= 40 && PROFORMA.test(c.text) && !/\d{4,}|\$/.test(c.text.replace(/\b(?:19|20)\d\d\b/g, '')));
      if (heads.length && cells.length >= 2) { cur = heads; since = 0; } else if (cur && ++since > 40) cur = null;
      pfCols[li] = cur;
    });
    const inPf = (li, c) => !!pfCols[li] && pfCols[li].some((h) => c.start <= h.end + 4 && c.end >= h.start - 4);

    grid.forEach((cells, li) => {
      cells.forEach((cell, ci) => {
        const prose = cell.text.length > 70;
        const taken = new Set();
        for (const key of ORDER) {
          const F = FIELDS[key];
          // a value written before its words, as prose does
          for (const re of F.pre || []) {
            const m = re.exec(cell.text);
            if (!m) continue;
            const v = toNum(m[1]);
            if (plausible(F, v) && !(F.skip && F.skip.test(cell.text.replace(m[0], '')))) {
              out.push({ key, value: v, page: pi + 1, line: lines[li].trim(), score: 2 + pageBonus });
            }
          }
          let hit = null;
          let weight = 0;
          for (const [re, w] of F.labels) {
            const m = re.exec(cell.text);
            if (m) { hit = m; weight = w; break; }
          }
          if (!hit) continue;
          // the same label can't introduce two fields: "Price per SF" is not also "Price"
          if (taken.has(hit.index)) continue;
          const labelText = cell.text.slice(0, hit.index + hit[0].length);
          if (F.skip && F.skip.test(labelText)) continue;
          let target = key;
          if (F.divert && F.divert[0].test(cell.text)) {
            if (!F.divert[1]) continue;
            target = F.divert[1];
          }
          const TF = FIELDS[target];
          taken.add(hit.index);

          // 1. after the label, in the same cell ("Asking Price: $4,950,000")
          let v = null;
          const rest = cell.text.slice(hit.index + hit[0].length);
          if (/\S/.test(rest.replace(/^[\s:()-]+/, '')) && !(TF.kind === 'text' && rest.length > 80)) {
            const r = readValue(TF, rest.replace(/^\s*\([^)]*\)/, ''), labelText);
            if (plausible(TF, r) && (TF.kind !== 'text' || /^\s*[:–—-]/.test(rest))) v = r;
          }
          // a word in a table header is not a label with a value beside it
          if (TF.kind === 'text' && v === null && cells.length > 3 && !/:\s*$/.test(labelText + rest.slice(0, 2))) continue;
          // 2. the next cells on the line ("Asking Price      $4,950,000")
          let vk = -1;
          for (let k = ci + 1; v === null && k < Math.min(cells.length, ci + 3); k++) {
            const r = readValue(TF, cells[k].text, labelText);
            if (plausible(TF, r)) { v = r; vk = k; }
            if (TF.kind === 'text') break;
          }
          // in a Current / Pro Forma statement the in-place figure is the one
          // outside the Pro Forma column, and the one inside it is the pro forma NOI
          if (vk >= 0 && pfCols[li] && TF.kind === 'money') {
            let pfVal = null;
            if (inPf(li, cells[vk])) {
              pfVal = v;
              v = null;
              for (let k = ci + 1; k < cells.length; k++) {
                if (k === vk || inPf(li, cells[k])) continue;
                const r = readValue(TF, cells[k].text, labelText);
                if (plausible(TF, r)) { v = r; break; }
              }
            } else {
              for (let k = vk + 1; k < cells.length; k++) {
                if (!inPf(li, cells[k])) continue;
                const r = readValue(TF, cells[k].text, labelText);
                if (plausible(TF, r)) { pfVal = r; break; }
              }
            }
            if (pfVal !== null && target === 'noi') {
              out.push({ key: 'noi_pf', value: pfVal, page: pi + 1, line: lines[li].trim().replace(/\s{2,}/g, '   '), score: weight + pageBonus + finBonus });
            }
            if (v === null) continue;
          }
          // 3. a figure stacked above or below its caption, in the same column
          if (v === null && TF.kind !== 'text' && !prose) {
            for (const d of [1, -1, 2, -2]) {
              const row = grid[li + d];
              if (!row) continue;
              const under = row.find((c) => c.end >= cell.start - 4 && c.start <= cell.end + 4);
              if (!under) continue;
              const r = valueCell(TF, under);
              if (r !== null) { v = r; break; }
            }
          }
          if (v === null) continue;
          if (TF.kind === 'text' && SUMMARY.test(v)) continue;
          const score = weight + pageBonus + (['noi', 'noi_pf', 'gross', 'opex', 'taxes'].includes(target) ? finBonus : 0)
            - (prose ? 1 : 0);
          out.push({ key: target, value: v, page: pi + 1, line: lines[li].trim().replace(/\s{2,}/g, '   '), score });
        }
      });
    });
  });
  return out;
}

/** The best value for each field, with the runners-up. */
function choose(cands) {
  const by = {};
  for (const c of cands) (by[c.key] ||= []).push(c);
  const fields = {};
  for (const [key, list] of Object.entries(by)) {
    const F = FIELDS[key];
    const groups = new Map();
    for (const c of list) {
      const id = F.kind === 'text' ? String(c.value).toLowerCase() : (F.kind === 'pct' ? c.value.toFixed(2) : Math.round(c.value));
      const g = groups.get(id);
      if (!g) groups.set(id, { ...c, count: 1, best: c.score });
      else {
        g.count += 1;
        if (c.score > g.best) Object.assign(g, { page: c.page, line: c.line, best: c.score });
      }
    }
    const ranked = [...groups.values()]
      .map((g) => ({ ...g, score: g.best + Math.min(2, 0.75 * (g.count - 1)) }))
      .sort((a, b) => b.score - a.score || a.page - b.page);
    const [top, ...rest] = ranked;
    fields[key] = {
      value: top.value, page: top.page, line: top.line, count: top.count,
      confidence: top.score >= 5 ? 'high' : top.score >= 3.5 ? 'medium' : 'low',
      alts: rest.slice(0, 4).map((g) => ({ value: g.value, page: g.page, line: g.line })),
    };
  }
  return fields;
}

/* ------------------------------------------------------- address and type */

const STREET = /\b(\d{1,6}(?:\s?[-–]\s?\d{1,6})?[A-Z]?\s+(?:[NSEW]\.?\s+)?(?:(?:[A-Z][A-Za-z'.]*|\d+(?:st|nd|rd|th))\s+){0,4}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Place|Pl|Court|Ct|Pike|Highway|Hwy|Parkway|Pkwy|Terrace|Ter|Circle|Cir|Square|Sq|Plaza|Row|Alley|Turnpike|Tpke)\.?(?:\s+(?:NW|NE|SW|SE|N|S|E|W)\b)?)/;
const PLACE = /\b([A-Z][A-Za-z.' -]{1,30}),\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b/;

function addressOf(pages) {
  const tally = new Map();
  pages.slice(0, 6).forEach((p, pi) => {
    for (const line of p.split('\n')) {
      const s = STREET.exec(line);
      if (!s) continue;
      const street = s[1].replace(/\s+/g, ' ').trim();
      if (/^(19|20)\d\d\s/.test(street) && !/\d\s?[-–]\s?\d/.test(street)) continue;   // "2019 Main Street" is too often a year
      const pl = PLACE.exec(line.slice(s.index + s[0].length)) || null;
      const k = street.toLowerCase();
      const t = tally.get(k) || { street, place: null, n: 0, page: pi + 1, line: line.trim() };
      t.n += pi === 0 ? 2 : 1;
      if (pl && !t.place) t.place = { city: pl[1].trim(), state: pl[2], zip: pl[3] };
      tally.set(k, t);
    }
  });
  const best = [...tally.values()].sort((a, b) => b.n - a.n)[0];
  if (!best) return {};
  let place = best.place;
  if (!place) {
    for (const p of pages.slice(0, 4)) {
      const m = PLACE.exec(p);
      if (m) { place = { city: m[1].trim(), state: m[2], zip: m[3] }; break; }
    }
  }
  const src = { page: best.page, line: best.line, confidence: best.n >= 3 ? 'high' : 'medium', alts: [] };
  const out = { address: { value: best.street, ...src } };
  if (place) {
    out.city = { value: place.city, ...src };
    out.state = { value: place.state, ...src };
    out.zip = { value: place.zip, ...src };
  }
  return out;
}

const TYPES = [
  ['Multifamily', /\b(multi-?family|apartments?|residential units)\b/gi],
  ['Retail', /\b(retail|shopping center|storefront|restaurant|qsr)\b/gi],
  ['Office', /\b(office)\b/gi],
  ['Medical office', /\b(medical office|mob|healthcare|clinic)\b/gi],
  ['Industrial', /\b(industrial|warehouse|flex|distribution|logistics)\b/gi],
  ['Mixed use', /\b(mixed[- ]use)\b/gi],
  ['Land', /\b(development site|land sale|vacant land|entitled|by-right)\b/gi],
  ['Hospitality', /\b(hotel|hospitality|motel)\b/gi],
  ['Self storage', /\b(self[- ]storage)\b/gi],
];

function typeOf(pages) {
  const text = pages.slice(0, 8).join('\n');
  const scores = TYPES.map(([t, re]) => [t, (text.match(re) || []).length]).sort((a, b) => b[1] - a[1]);
  if (!scores[0][1]) return {};
  const netLease = /\b(single[- ]tenant|net[- ]lease|nnn|absolute net)\b/i.test(text);
  const v = scores[0][0] === 'Retail' && netLease ? 'Retail (net lease)' : scores[0][0];
  return { ptype: { value: v, page: null, line: 'from the words the OM uses most', confidence: 'low', alts: [] } };
}

/* --------------------------------------------------------------- rent roll */

const HEAD = {
  tenant: /\b(tenant|lessee|occupant|tenant name)\b/i,
  suite: /\b(suite|ste|unit|space|floor)\b/i,
  sf: /\b(sf|rsf|nra|gla|sq\.?\s?ft|square\s+f(?:ee|oo)t|size|area)\b/i,
  start: /\b(start|commence|commencement|begin|from|lease\s+start)\b/i,
  end: /\b(exp|expiration|expires|end|to|lxd|led|term(?:ination)?)\b/i,
  psf: /(\bpsf\b|\/\s?sf|per\s+sf|rent\s*\/\s*sf|\$\s*\/\s*sf|rate)/i,
  monthly: /\b(monthly|month|\/mo|per month)\b/i,
  annual: /\b(annual|yearly|\/yr|per year|base rent|total rent|rent)\b/i,
};

export function headerColumns(cells) {
  const cols = [];
  const used = new Set();
  for (const c of cells) {
    let key = null;
    // order decides ties: "Rent/SF" is psf, "Monthly Rent" monthly, "Lease Exp." end
    for (const k of ['tenant', 'psf', 'monthly', 'end', 'start', 'sf', 'suite', 'annual']) {
      if (!used.has(k) && HEAD[k].test(c.text)) { key = k; break; }
    }
    if (key) { used.add(key); cols.push({ key, start: c.start, end: c.end, mid: (c.start + c.end) / 2 }); }
  }
  return used.has('tenant') && cols.length >= 3 && (used.has('sf') || used.has('annual') || used.has('psf')) ? cols : null;
}

/** Combine a two-line header ("Lease" over "Expiration") into one row of cells. */
export function mergeHeader(a, b) {
  if (!b || !b.length || b.some((c) => /\d/.test(c.text))) return a;
  const out = a.map((c) => ({ ...c }));
  for (const c of b) {
    const over = out.find((x) => x.start <= c.end + 1 && c.start <= x.end + 1);
    if (over) {
      over.text = `${over.text} ${c.text}`;
      over.start = Math.min(over.start, c.start);
      over.end = Math.max(over.end, c.end);
    } else out.push({ ...c });
  }
  return out.sort((x, y) => x.start - y.start);
}

const TOTAL = /^\s*(total|totals|subtotal|grand total|occupied|vacant total|average|summary)\b/i;

function readRentRow(cells, cols) {
  const row = { tenant: null, suite: null, sf: null, start: null, end: null, endText: null, mtm: false, annual: null, monthly: null, psf: null };
  // each cell goes to the header column whose centre is nearest
  const slots = new Map();
  for (const c of cells) {
    const mid = (c.start + c.end) / 2;
    let best = null;
    for (const col of cols) {
      const d = Math.abs(col.mid - mid) - (c.start <= col.end && col.start <= c.end ? 4 : 0);
      if (!best || d < best.d) best = { col, d };
    }
    const prev = slots.get(best.col.key);
    if (!prev || best.d < prev.d) slots.set(best.col.key, { text: c.text, d: best.d });
  }
  for (const [key, { text }] of slots) {
    if (key === 'tenant' || key === 'suite') row[key] = text;
    else if (key === 'start' || key === 'end') {
      const d = parseDate(text);
      if (d) {
        if (key === 'end') { row.end = d.date; row.mtm = !!d.mtm; row.endText = text; }
        else row.start = d.date;
      }
    } else if (key === 'sf') {
      const n = parseInt0(text.replace(/\s*(sf|rsf)$/i, ''));
      if (n !== null && n > 0 && n < 5e6) row.sf = n;
    } else {
      const n = /\$?\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/.exec(text);
      if (n) row[key] = toNum(n[1]);
    }
  }
  if (!row.tenant) {
    const first = cells[0];
    if (first && !/^\$?\d/.test(first.text)) row.tenant = first.text;
  }
  return row;
}

export function rentRoll(pages) {
  const rows = [];
  let page = null;
  pages.forEach((p, pi) => {
    const grid = p.split('\n').map(splitCells);
    for (let i = 0; i < grid.length; i++) {
      if (grid[i].length < 3) continue;
      // a header can run over two lines ("Lease" over "Expiration"): take whichever reading finds more columns
      const one = headerColumns(grid[i]);
      const two = headerColumns(mergeHeader(grid[i], grid[i + 1]));
      const head = two && (!one || two.length > one.length) ? two : one;
      if (!head) continue;
      const skipNext = head === two && grid[i + 1] && grid[i + 1].length > 0;
      let blank = 0;
      for (let j = i + (skipNext ? 2 : 1); j < grid.length; j++) {
        const cells = grid[j];
        if (!cells.length) { if (++blank > 2) break; continue; }
        blank = 0;
        if (TOTAL.test(cells[0].text)) break;
        if (headerColumns(cells)) break;
        const hasNum = cells.some((c) => /\d/.test(c.text));
        if (!hasNum) { if (/vacant/i.test(cells[0].text)) rows.push({ tenant: cells[0].text, vacant: true, sf: null }); continue; }
        const r = readRentRow(cells, head);
        if (!r.tenant && !r.suite) continue;
        r.vacant = /\bvacant\b|\bavailable\b/i.test(`${r.tenant} ${r.suite}`);
        if (r.annual === null && r.monthly !== null) r.annual = r.monthly * 12;
        if (r.annual === null && r.psf !== null && r.sf) r.annual = r.psf * r.sf;
        if (r.psf === null && r.annual && r.sf) r.psf = r.annual / r.sf;
        // a monthly figure printed in the annual column would put rent at a twelfth;
        // a psf below $1 a year is the tell
        if (r.annual && r.sf && r.annual / r.sf < 1.2 && r.monthly === null) {
          r.monthly = r.annual; r.annual *= 12; r.psf = r.annual / r.sf;
        }
        if (!r.sf && !r.annual) continue;
        // a stray line that lines up with the columns: too small to be a lease, or a label
        if ((r.sf !== null && r.sf < 100 && !r.annual) || /^(subject property|total|average|median)\b/i.test(r.tenant || '')) continue;
        rows.push(r);
      }
      if (rows.length) { page = pi + 1; return; }
    }
  });
  return rows.length ? { rows, page } : null;
}

/* ------------------------------------------------------------------ main */

/** Read an OM: `pages` is page text from layout.js. */
export function readOm(pages) {
  const text = pages.join('\n');
  const fields = { ...choose(candidates(pages)), ...addressOf(pages), ...typeOf(pages) };
  // land and building printed in acres, say, both come back in SF; keep acres for display
  if (fields.lot) fields.lot.acres = Math.round((fields.lot.value / 43560) * 1000) / 1000;
  const unpriced = !fields.price && /\b(unpriced|call for (?:offers|pricing)|price upon request|best and final|bid process|call broker|market bid|subject to offer)\b/i.test(text);
  return {
    fields,
    rentRoll: rentRoll(pages),
    unpriced,
    pages: pages.length,
    chars: text.replace(/\s+/g, '').length,
  };
}
