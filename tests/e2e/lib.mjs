/* Shared set-up for the browser workflows: an iPhone-sized Chromium page that
 * records console errors, failed requests and uncaught exceptions. */
import { createRequire } from 'module';

async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* not installed here */ }
  // the Claude Code cloud image ships it globally
  return createRequire('/opt/node-tools/node_modules/')('playwright');
}
const pw = await loadPlaywright();
export const { chromium } = pw.chromium ? pw : pw.default;
export const BASE = process.env.BASE || 'http://localhost:8080/';
export const SHOTS = new URL('./shots/', import.meta.url).pathname;

export async function phone(opts = {}) {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    acceptDownloads: true, ...opts,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));
  return { browser, ctx, page, errors };
}
