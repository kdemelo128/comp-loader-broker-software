/* pdftext.js -- page text extraction, shared by the browser app and the test
 * harness. `pdfjs` is injected so the browser uses its own bundled copy. */
import { layoutPage } from './layout.js';

/* CoStar's PDF generator writes a broken ToUnicode map for the apostrophe in
 * some font subsets: the glyph resolves to a capital letter, so "property's"
 * extracts as "propertyBs". The letter it lands on varies by subset (B, E, M
 * have all been seen), and poppler drops the character to a space instead.
 *
 * The letter can't be identified from one word -- "REITs" and "LLCs" have the
 * same shape -- so it is identified per document from repeated evidence: a
 * letter only counts as the stand-in if it appears at least twice wedged
 * between a lowercase letter and a contraction ending. "REITs" never votes
 * (its T follows a capital) and "MacArthur" never votes ("rthur" is not a
 * contraction ending), so neither is touched. */
const SUFFIX = '(?:s|t|re|ve|ll|d|m)';

function apostropheGlyphs(text) {
  const marked = [];
  for (let i = 65; i <= 90; i++) {
    const L = String.fromCharCode(i);
    const votes = text.match(new RegExp(`[a-z]${L}${SUFFIX}\\b`, 'g'));
    if (votes && votes.length >= 1) marked.push(L);
  }
  return marked;
}

export function repairApostrophes(pages) {
  const marked = apostropheGlyphs(pages.join('\n'));
  if (!marked.length) return pages;
  const res = marked.map((L) => new RegExp(`([A-Za-z.])${L}(?=${SUFFIX}\\b)`, 'g'));
  return pages.map((p) => res.reduce((s, re) => s.replace(re, '$1’'), p));
}

/** Page text of a PDF. `onPage(done, total)` reports progress on a long document. */
export async function pdfPages(pdfjs, data, opts = {}) {
  const { onPage, ...docOpts } = opts;
  const doc = await pdfjs.getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: false,
    ...docOpts,
  }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    if (onPage) onPage(i, doc.numPages);
    const page = await doc.getPage(i);
    const tc = await page.getTextContent({ includeMarkedContent: false });
    pages.push(layoutPage(tc.items, page.getViewport({ scale: 1 }).height));
    page.cleanup();
  }
  await doc.destroy();
  return repairApostrophes(pages);
}
