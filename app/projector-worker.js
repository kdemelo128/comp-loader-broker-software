/* The lease projection, run in a module worker so a long rent roll never
 * freezes the page. One message in ({ id, rr, opts }), one out
 * ({ id, result } or { id, error }); the result is the projection's summary. */
import { project, projectionSummary } from './lease.js';

self.onmessage = (e) => {
  const { id, rr, opts } = e.data || {};
  try {
    self.postMessage({ id, result: projectionSummary(project(rr, opts)) });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
