/* The lease projection for the screens, worked out off the main thread.
 *
 * Screens ask with projectionLater(rr, opts), a promise of the projection's
 * summary (years, start, notes), computed in a module worker; they draw
 * everything else at once and fill the projection in when it arrives.
 * projectionNow(rr, opts) gives a result already worked out for exactly this
 * rent roll, or null, so a redraw with nothing changed needs no wait.
 * projectionSync(rr, opts) computes on the main thread for one-off work a
 * person asked for (exports, the brief); it shares the same results.
 *
 * Results are kept for the last few distinct inputs, keyed by the rent roll's
 * content, so a stale answer can never be shown for a changed rent roll. If a
 * worker can't be started (an old browser), the work runs on the main thread
 * after the screen has drawn. */
import { project, projectionSummary } from './lease.js';

const KEEP = 8;
const done = new Map(); // key -> summary, oldest first
const running = new Map(); // key -> promise
const waiting = new Map(); // job id -> { resolve, reject }
let worker = null;
let noWorker = false;
let next = 1;

const keyOf = (rr, opts) => JSON.stringify([rr.settings || null, rr.leases || [], opts || {}]);

function remember(key, result) {
  done.delete(key);
  done.set(key, result);
  while (done.size > KEEP) done.delete(done.keys().next().value);
}

function startWorker() {
  if (worker || noWorker) return worker;
  try {
    worker = new Worker(new URL('./projector-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const { id, result, error } = e.data || {};
      const w = waiting.get(id);
      if (!w) return;
      waiting.delete(id);
      if (error) w.reject(new Error(error)); else w.resolve(result);
    };
    worker.onerror = (e) => {
      // the worker didn't load (or died): finish what was asked on the main thread
      e.preventDefault();
      worker = null;
      noWorker = true;
      for (const [, w] of waiting) w.fallback();
      waiting.clear();
    };
  } catch {
    worker = null;
    noWorker = true;
  }
  return worker;
}

/** The summary for exactly this rent roll if it has been worked out, else null. */
export function projectionNow(rr, opts = {}) {
  const key = keyOf(rr, opts);
  if (!done.has(key)) return null;
  const r = done.get(key);
  remember(key, r);
  return r;
}

/** The summary, worked out on the main thread now (for exports and other one-off work). */
export function projectionSync(rr, opts = {}) {
  const key = keyOf(rr, opts);
  if (done.has(key)) return done.get(key);
  const r = projectionSummary(project(rr, opts));
  remember(key, r);
  return r;
}

/** A promise of the summary, worked out in the worker. */
export function projectionLater(rr, opts = {}) {
  const key = keyOf(rr, opts);
  if (done.has(key)) return Promise.resolve(done.get(key));
  if (running.has(key)) return running.get(key);
  // a copy of the rent roll as it is now: later edits don't reach a job already sent
  const input = structuredClone({ settings: rr.settings, leases: rr.leases || [] });
  const local = () => new Promise((resolve, reject) => setTimeout(() => {
    try { resolve(projectionSummary(project(input, opts))); } catch (e) { reject(e); }
  }, 0));
  const w = startWorker();
  const p = (w ? new Promise((resolve, reject) => {
    const id = next++;
    waiting.set(id, { resolve, reject, fallback: () => local().then(resolve, reject) });
    try { w.postMessage({ id, rr: input, opts }); } catch { waiting.delete(id); local().then(resolve, reject); }
  }) : local()).then((r) => { remember(key, r); running.delete(key); return r; }, (e) => { running.delete(key); throw e; });
  running.set(key, p);
  return p;
}
