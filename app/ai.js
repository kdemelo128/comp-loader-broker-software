/* ai.js -- talking to the firm's Comp Loader AI server (server/ in this
 * repository). The page itself holds no API key: it holds the server's
 * address and an access token the firm issues, kept on this device. Nothing
 * is sent unless the broker has turned AI on and confirmed the send. */

import { kvGet, kvSet } from './store.js';

const KEY = 'ai.settings';
const DEFAULTS = { url: '', token: '', enabled: false };

export async function getSettings() { return { ...DEFAULTS, ...((await kvGet(KEY)) || {}) }; }
export async function saveSettings(s) { return kvSet(KEY, { ...DEFAULTS, ...s, url: String(s.url || '').trim().replace(/\/+$/, '') }); }
export const isReady = (s) => !!(s && s.enabled && s.url && s.token);

export class AiUnavailable extends Error {}

async function request(path, body, { timeoutMs = 240000, method = 'POST' } = {}) {
  const s = await getSettings();
  if (!isReady(s)) throw new AiUnavailable('AI is off. Turn it on under AI settings, with your firm’s server address and access token.');
  if (!/^https:\/\//.test(s.url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(s.url)) throw new AiUnavailable('The AI server address must start with https://.');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let r;
  try {
    r = await fetch(`${s.url}${path}`, {
      method, signal: ctl.signal,
      headers: { Authorization: `Bearer ${s.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'The AI server took too long to answer.' : 'The AI server could not be reached (check the address, and that you are online).');
  } finally { clearTimeout(timer); }
  let j = null;
  try { j = await r.json(); } catch { /* not JSON */ }
  if (!r.ok) throw new Error((j && j.message) || `The AI server answered ${r.status}.`);
  return j;
}

export const health = () => request('/api/health', null, { method: 'GET', timeoutMs: 15000 });
export const extract = (documents, fields) => request('/api/extract', { documents, fields });
export const assist = (question, facts, history) => request('/api/assist', { question, facts, history }, { timeoutMs: 120000 });
export const transcribe = (audio) => request('/api/transcribe', audio, { timeoutMs: 600000 });
export const meeting = (transcript, fields) => request('/api/meeting', { transcript, fields });

/** Bytes to base64 without blowing the stack on large files. */
export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
