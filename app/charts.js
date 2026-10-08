/* charts.js -- native Excel charts, written as DrawingML.
 *
 * ExcelJS cannot write charts, so these parts are generated here and attached
 * to the package by package.js. Each chart reads live cell ranges (so it moves
 * when a comp is edited) and carries a cache of the current values (so it draws
 * before Excel recalculates, in Protected View and in previews).
 *
 * Marks follow the comp set's palette: sale comps blue, listings orange -- the
 * same two hues the loader uses on screen, validated for colour-blind contrast. */

const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XDR = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';

const esc = (s) => String(s ?? '')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

const INK = '404040';
const GRID = 'E3E7EE';

const txPr = (size = 900, color = INK, bold = false) => `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size}" b="${bold ? 1 : 0}">`
  + `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Arial"/></a:defRPr></a:pPr>`
  + '<a:endParaRPr lang="en-US"/></a:p></c:txPr>';

const titleXml = (text) => '<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1">'
  + '<a:solidFill><a:srgbClr val="1F3864"/></a:solidFill><a:latin typeface="Arial"/></a:defRPr></a:pPr>'
  + `<a:r><a:rPr lang="en-US" sz="1200" b="1"><a:solidFill><a:srgbClr val="1F3864"/></a:solidFill><a:latin typeface="Arial"/></a:rPr>`
  + `<a:t>${esc(text)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;

const strCache = (values) => `<c:strCache><c:ptCount val="${values.length}"/>${
  values.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join('')}</c:strCache>`;

// a missing point is omitted from the cache, which Excel draws as a gap
const numCache = (values, format = 'General') => `<c:numCache><c:formatCode>${esc(format)}</c:formatCode>`
  + `<c:ptCount val="${values.length}"/>${
    values.map((v, i) => (isNum(v) ? `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>` : '')).join('')}</c:numCache>`;

const gridlines = `<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="${GRID}"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>`;
const axisLine = '<c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="BFC9D9"/></a:solidFill></a:ln></c:spPr>';
const noLine = '<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>';

const wrap = (body) => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + `<c:chartSpace xmlns:c="${C}" xmlns:a="${A}" xmlns:r="${R}">`
  + '<c:date1904 val="0"/><c:roundedCorners val="0"/>'
  + `<c:chart>${body}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>`
  + '<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>'
  + `${txPr()}</c:chartSpace>`;

/** Ranked horizontal bars: one comp per bar, the highest $/SF at the top. */
function barChart(spec) {
  const { cat, val, color } = spec;
  return wrap(`${titleXml(spec.title)}<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>`
    + '<c:barChart><c:barDir val="bar"/><c:grouping val="clustered"/><c:varyColors val="0"/>'
    + '<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>$/SF</c:v></c:tx>'
    + `<c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>`
    + '<c:invertIfNegative val="0"/>'
    + `<c:dLbls><c:numFmt formatCode="${esc(val.format)}" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>`
    + `${txPr(800)}<c:dLblPos val="outEnd"/><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/>`
    + '<c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>'
    + `<c:cat><c:strRef><c:f>${esc(cat.ref)}</c:f>${strCache(cat.values)}</c:strRef></c:cat>`
    + `<c:val><c:numRef><c:f>${esc(val.ref)}</c:f>${numCache(val.values, val.format)}</c:numRef></c:val>`
    + '</c:ser><c:gapWidth val="45"/><c:axId val="50010"/><c:axId val="50020"/></c:barChart>'
    // categories run top to bottom in rank order; the value axis stays at the bottom
    + '<c:catAx><c:axId val="50010"/><c:scaling><c:orientation val="maxMin"/></c:scaling><c:delete val="0"/>'
    + '<c:axPos val="l"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/>'
    + `<c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${axisLine}${txPr(800)}<c:crossAx val="50020"/>`
    + '<c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>'
    + `<c:valAx><c:axId val="50020"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>${gridlines}`
    + `<c:numFmt formatCode="${esc(val.format)}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/>`
    + `<c:tickLblPos val="nextTo"/>${noLine}${txPr(800)}<c:crossAx val="50010"/><c:crosses val="max"/><c:crossBetween val="between"/></c:valAx>`
    + '</c:plotArea>');
}

/** $/SF against sale date, with Excel's own linear trendline. */
function scatterChart(spec) {
  const { x, y, color } = spec;
  const pts = x.values.filter((v, i) => isNum(v) && isNum(y.values[i]));
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const pad = Math.max(30, (hi - lo) * 0.06);
  // a scatter reads position, not length, so the $/SF axis can start near the
  // data instead of at zero -- that is what makes the spread visible
  const ys = y.values.filter(isNum);
  const yStep = 100;
  const yLo = Math.max(0, Math.floor((Math.min(...ys) * 0.85) / yStep) * yStep);
  const yHi = Math.ceil((Math.max(...ys) * 1.08) / yStep) * yStep;
  return wrap(`${titleXml(spec.title)}<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>`
    + '<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>'
    + '<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>Sale $/SF</c:v></c:tx>'
    + '<c:spPr><a:ln w="19050"><a:noFill/></a:ln></c:spPr>'
    + `<c:marker><c:symbol val="circle"/><c:size val="8"/><c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`
    + '<a:ln w="19050"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:marker>'
    + '<c:trendline><c:name>Linear trend</c:name><c:spPr><a:ln w="15875"><a:solidFill><a:srgbClr val="7F8A99"/></a:solidFill>'
    + '<a:prstDash val="dash"/></a:ln></c:spPr><c:trendlineType val="linear"/><c:dispRSqr val="0"/><c:dispEq val="0"/></c:trendline>'
    + `<c:xVal><c:numRef><c:f>${esc(x.ref)}</c:f>${numCache(x.values, x.format)}</c:numRef></c:xVal>`
    + `<c:yVal><c:numRef><c:f>${esc(y.ref)}</c:f>${numCache(y.values, y.format)}</c:numRef></c:yVal>`
    + '<c:smooth val="0"/></c:ser><c:axId val="60010"/><c:axId val="60020"/></c:scatterChart>'
    + `<c:valAx><c:axId val="60010"/><c:scaling><c:orientation val="minMax"/><c:max val="${Math.ceil(hi + pad)}"/>`
    + `<c:min val="${Math.floor(lo - pad)}"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>`
    + `<c:numFmt formatCode="${esc(x.format)}" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/>`
    + `<c:tickLblPos val="low"/>${axisLine}${txPr(800)}<c:crossAx val="60020"/><c:crosses val="min"/><c:crossBetween val="midCat"/></c:valAx>`
    + `<c:valAx><c:axId val="60020"/><c:scaling><c:orientation val="minMax"/><c:max val="${yHi}"/><c:min val="${yLo}"/></c:scaling>`
    + `<c:delete val="0"/><c:axPos val="l"/>${gridlines}`
    + `<c:numFmt formatCode="${esc(y.format)}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/>`
    + `<c:tickLblPos val="nextTo"/>${noLine}${txPr(800)}<c:crossAx val="60010"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx>`
    + '</c:plotArea>');
}

/** The drawing that places each chart on the sheet, anchored to cells. */
function drawingXml(specs) {
  const anchors = specs.map((s, i) => '<xdr:twoCellAnchor editAs="oneCell">'
    + `<xdr:from><xdr:col>${s.from.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${s.from.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>`
    + `<xdr:to><xdr:col>${s.to.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${s.to.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>`
    + `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Chart ${i + 1}" descr="${esc(s.title)}"/>`
    + '<xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>'
    + `<a:graphic><a:graphicData uri="${C}"><c:chart xmlns:c="${C}" r:id="rId${i + 1}"/></a:graphicData></a:graphic>`
    + '</xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>').join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + `<xdr:wsDr xmlns:xdr="${XDR}" xmlns:a="${A}" xmlns:r="${R}">${anchors}</xdr:wsDr>`;
}

/** Everything package.js needs to attach: chart parts, the drawing, its rels. */
export function chartParts(specs) {
  const charts = specs.map((s) => (s.type === 'scatter' ? scatterChart(s) : barChart(s)));
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + specs.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${R}/chart" Target="../charts/chart${i + 1}.xml"/>`).join('')
    + '</Relationships>';
  return { charts, drawing: drawingXml(specs), drawingRels: rels };
}
