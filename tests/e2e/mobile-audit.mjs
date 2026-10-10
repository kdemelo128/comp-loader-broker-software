import { phone, BASE, SHOTS } from './lib.mjs';
const F = new URL('./files/', import.meta.url).pathname;
for (const width of [320, 375, 390, 430]) {
  const { browser, page, errors } = await phone({ viewport: { width, height: 800 } });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.setInputFiles('#file', F + 'costar-comps.pdf');
  await page.waitForFunction(() => document.querySelectorAll('#sales-table tbody tr').length > 0);
  await page.click('.tab[data-view="deal"] >> visible=true');
  await page.setInputFiles('#om-file', F + 'om-retail.pdf');
  await page.waitForSelector('#deal-tiles .tile');
  await page.setInputFiles('#photo-file', [F + 'photo0.jpg', F + 'photo1.jpg']);
  await page.waitForTimeout(1500);
  for (const v of ['home', 'comps', 'deal', 'tools', 'settings']) {
    await page.click(`.tab[data-view="${v}"] >> visible=true`);
    await page.waitForTimeout(300);
    const res = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const over = [];
      const small = [];
      const tiny = [];
      for (const e of document.querySelectorAll('#app *')) {
        const r = e.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const cs = getComputedStyle(e);
        if (cs.visibility === 'hidden') continue;
        // something sticking out of the viewport that is not inside a scroller
        let p = e.parentElement; let scroller = false;
        while (p) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') { scroller = true; break; } p = p.parentElement; }
        if (!scroller && (r.right > vw + 1 || r.left < -1)) over.push(`${e.tagName}.${e.className}`.slice(0, 50) + ` ${Math.round(r.left)}-${Math.round(r.right)}`);
        if (e.matches('button, a, input, select, textarea, label[for], [role=button]') && (r.height < 30 || r.width < 30) && !e.matches('input[type=checkbox].tog')) small.push(`${e.tagName}.${e.className}[${e.getAttribute('aria-label') || e.textContent.trim().slice(0, 20)}] ${Math.round(r.width)}x${Math.round(r.height)}`);
        if (e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(cs.fontSize) < 11) tiny.push(`${e.tagName}.${e.className} ${cs.fontSize} "${e.textContent.trim().slice(0, 25)}"`);
      }
      return { scrollW: document.documentElement.scrollWidth, vw, over: [...new Set(over)].slice(0, 8), small: [...new Set(small)].slice(0, 12), tiny: [...new Set(tiny)].slice(0, 8) };
    });
    console.log(`${width} ${v}: scrollWidth ${res.scrollW}/${res.vw}`);
    if (res.over.length) console.log('   overflow:', res.over);
    if (res.small.length) console.log('   small targets:', res.small);
    if (res.tiny.length) console.log('   tiny text:', res.tiny);
    if (width === 375) await page.screenshot({ path: `${SHOTS}m375-${v}.png`, fullPage: true });
  }
  if (errors.length) console.log('errors', errors);
  await browser.close();
}
