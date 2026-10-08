/* package.js -- final pass over the .xlsx package.
 *
 * ExcelJS writes a correct workbook but leaves two things in the ZIP that the
 * OPC spec does not want and that Excel has been known to offer to "repair":
 * explicit directory entries, and no sheet marked as the selected tab. This
 * rewrites the archive without the directory entries and selects the first
 * sheet. It also attaches the chart parts ExcelJS cannot write itself. */

const enc = new TextEncoder();
const dec = new TextDecoder();
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Resolve a relationship target against the part that owns it. */
function resolve(owner, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = owner.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : null;
};

/** The worksheet part behind a tab name, read from workbook.xml and its rels. */
function sheetPath(files, name) {
  const wb = dec.decode(files['xl/workbook.xml']);
  const rels = dec.decode(files['xl/_rels/workbook.xml.rels']);
  const xmlName = name.replace(/&/g, '&amp;');
  for (const tag of wb.match(/<sheet\b[^>]*>/g) || []) {
    if (attr(tag, 'name') !== xmlName) continue;
    const rid = attr(tag, 'r:id');
    for (const rel of rels.match(/<Relationship\b[^>]*>/g) || []) {
      if (attr(rel, 'Id') === rid) return resolve('xl/workbook.xml', attr(rel, 'Target'));
    }
  }
  return null;
}

function attachCharts(files, { sheet, parts }) {
  const ws = sheetPath(files, sheet);
  if (!ws) throw new Error(`no "${sheet}" tab to attach charts to`);
  const base = ws.split('/').pop();
  const relsPath = `xl/worksheets/_rels/${base}.rels`;

  parts.charts.forEach((xml, i) => { files[`xl/charts/chart${i + 1}.xml`] = enc.encode(xml); });
  files['xl/drawings/drawing1.xml'] = enc.encode(parts.drawing);
  files['xl/drawings/_rels/drawing1.xml.rels'] = enc.encode(parts.drawingRels);

  // the sheet points at the drawing through its own relationships
  let rels = files[relsPath] ? dec.decode(files[relsPath])
    : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  const used = new Set((rels.match(/Id="([^"]+)"/g) || []).map((m) => m.slice(4, -1)));
  let n = 1;
  while (used.has(`rIdDrawing${n}`)) n++;
  const rid = `rIdDrawing${n}`;
  rels = rels.replace('</Relationships>',
    `<Relationship Id="${rid}" Type="${REL_NS}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`);
  files[relsPath] = enc.encode(rels);

  // <drawing> sits after the page setup and before any legacy drawing, table
  // parts or extensions, as the worksheet schema orders them
  let xml = dec.decode(files[ws]);
  if (!/\sxmlns:r=/.test(xml.slice(0, 600))) {
    xml = xml.replace('<worksheet ', `<worksheet xmlns:r="${REL_NS}" `);
  }
  const tag = `<drawing r:id="${rid}"/>`;
  const before = ['<legacyDrawing', '<legacyDrawingHF', '<picture', '<oleObjects', '<controls',
    '<webPublishItems', '<tableParts', '<extLst', '</worksheet>'];
  const at = before.map((t) => xml.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  files[ws] = enc.encode(xml.slice(0, at) + tag + xml.slice(at));

  // every new part needs a declared content type
  let ct = dec.decode(files['[Content_Types].xml']);
  const add = [`<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`,
    ...parts.charts.map((_, i) => `<Override PartName="/xl/charts/chart${i + 1}.xml" `
      + 'ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>')];
  ct = ct.replace('</Types>', `${add.join('')}</Types>`);
  files['[Content_Types].xml'] = enc.encode(ct);
}

export function cleanPackage(fflate, buffer, { charts = null } = {}) {
  const files = fflate.unzipSync(new Uint8Array(buffer));
  for (const name of Object.keys(files)) if (name.endsWith('/')) delete files[name];

  if (charts) attachCharts(files, charts);

  const first = 'xl/worksheets/sheet1.xml';
  if (files[first]) {
    const xml = dec.decode(files[first]);
    if (!xml.includes('tabSelected=')) {
      // the first "<sheetView" in the file is the <sheetViews> container, so
      // match only the element that has attributes after it
      const patched = xml.replace(/<sheetView(\s)/, '<sheetView tabSelected="1"$1');
      if (patched !== xml) files[first] = enc.encode(patched);
    }
  }

  // [Content_Types].xml first, by convention
  const out = {};
  out['[Content_Types].xml'] = files['[Content_Types].xml'];
  for (const name of Object.keys(files)) if (name !== '[Content_Types].xml') out[name] = files[name];
  return fflate.zipSync(out, { level: 6 });
}
