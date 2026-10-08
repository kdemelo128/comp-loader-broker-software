/* layout.js -- rebuild fixed-width, column-preserving text from PDF text items.
 *
 * The CoStar parser reads labelled fields by their column gaps ("Cap Rate" and
 * its value are separated by two or more spaces). pdftotext -layout produces
 * that; pdf.js gives positioned fragments instead. This module turns fragments
 * back into the same shape.
 *
 * The contract the parser depends on, in order of importance:
 *   1. items that sit on one visual line end up on one text line
 *   2. a visible horizontal gap becomes TWO OR MORE spaces
 *   3. adjacent words stay separated by exactly one space
 *   4. leading indent is proportional to the distance from the page's left edge
 * Column positions are therefore approximate; gap classification is not.
 */

const WS = /^[\s ]*$/;

// Characters per point, estimated from the glyph widths actually on the page.
// Space-only fragments are excluded: pdf.js reports their width as the size of
// the gap they stand for, not the width of a space glyph.
export function charWidth(items) {
  const w = [];
  for (const it of items) {
    const s = it.str || '';
    if (s.length < 3 || WS.test(s) || !it.width) continue;
    w.push(it.width / s.length);
  }
  if (!w.length) return 5;
  w.sort((a, b) => a - b);
  const cw = w[Math.floor(w.length / 2)];
  return cw > 0.5 ? cw : 5;
}

function lineOf(it) {
  // transform = [a, b, c, d, e, f]; e,f is the baseline origin.
  const t = it.transform;
  return { x: t[4], y: t[5], w: it.width || 0, h: it.height || Math.abs(t[3]) || 8, s: it.str };
}

/** Group fragments into visual lines, then render each as fixed-width text. */
export function layoutPage(items, viewportHeight) {
  const frags = [];
  for (const raw of items) {
    if (!raw || typeof raw.str !== 'string') continue;
    if (raw.str === '') continue;
    const f = lineOf(raw);
    if (WS.test(f.s)) continue;            // spacing fragment: the gap is implied by x
    frags.push(f);
  }
  if (!frags.length) return '';

  const cw = charWidth(items);
  let left = Infinity;
  for (const f of frags) if (f.x < left) left = f.x;   // no spread: a dense page can exceed the argument limit

  // bucket by baseline, top of page first
  frags.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const f of frags) {
    const last = lines[lines.length - 1];
    const tol = Math.max(1.8, 0.28 * (f.h || 8));
    if (last && Math.abs(last.y - f.y) <= tol) {
      last.items.push(f);
      last.y = (last.y * (last.items.length - 1) + f.y) / last.items.length;
    } else {
      lines.push({ y: f.y, items: [f] });
    }
  }

  const out = [];
  let prevY = null;
  for (const ln of lines) {
    ln.items.sort((a, b) => a.x - b.x);

    // blank lines between rows keep paragraph structure readable, and the
    // parser's section headings rely on standing alone.
    if (prevY !== null) {
      const h = ln.items[0].h || 8;
      const blanks = Math.min(3, Math.max(0, Math.round((prevY - ln.y) / (h * 1.35)) - 1));
      for (let i = 0; i < blanks; i++) out.push('');
    }
    prevY = ln.y;

    let text = ' '.repeat(Math.max(0, Math.round((ln.items[0].x - left) / cw)));
    let endX = ln.items[0].x;
    for (let i = 0; i < ln.items.length; i++) {
      const it = ln.items[i];
      if (i > 0) {
        const gap = it.x - endX;
        let n;
        if (gap < 0.3 * cw) n = 0;
        else if (gap <= 1.15 * cw) n = 1;
        else n = Math.max(2, Math.round(gap / cw));
        text += ' '.repeat(n);
      }
      text += it.s;
      endX = it.x + it.w;
    }
    out.push(text.replace(/\s+$/, ''));
  }
  return out.join('\n');
}
