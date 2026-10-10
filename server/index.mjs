/* The Zlatura AI server: a small HTTP service that holds the API keys the
 * static app must never carry, and does three things for it: reads figures
 * out of documents, answers questions about a deal from its facts, and
 * transcribes and summarizes audio.
 *
 *   ANTHROPIC_API_KEY  required for /api/extract, /api/assist, /api/meeting
 *   APP_TOKEN          required: the app sends it as "Authorization: Bearer ..."
 *   ALLOWED_ORIGINS    the app's origin(s), comma separated (e.g. https://you.github.io)
 *   STT_URL            optional: an OpenAI-compatible /audio/transcriptions endpoint
 *   STT_API_KEY, STT_MODEL (default whisper-1)
 *   AI_MODEL           default claude-opus-5-5
 *   PORT               default 8787
 *   MAX_BODY_MB        default 40
 *   RATE_PER_MIN       AI requests a minute per client address, default 20
 *
 * No request body, document or transcript is logged or stored. */

import http from 'node:http';
import { timingSafeEqual, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { extract, assist, meeting, AiError, MODEL } from './ai.mjs';

export function config(env = process.env) {
  return {
    token: env.APP_TOKEN || '',
    origins: (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
    aiConfigured: !!(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN),
    stt: env.STT_URL ? { url: env.STT_URL, key: env.STT_API_KEY || '', model: env.STT_MODEL || 'whisper-1' } : null,
    maxBody: Math.max(1, Number(env.MAX_BODY_MB) || 40) * 1024 * 1024,
    ratePerMin: Math.max(1, Number(env.RATE_PER_MIN) || 20),
    port: Number(env.PORT) || 8787,
  };
}

const digest = (s) => createHash('sha256').update(String(s)).digest();
const tokenOk = (got, want) => !!want && timingSafeEqual(digest(got), digest(want));

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(JSON.stringify(body));
}

function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new AiError('That is larger than this server accepts.', 413, 'too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new AiError('The request is not valid JSON.', 400, 'bad_request')); }
    });
    req.on('error', reject);
  });
}

/** Speech to text through an OpenAI-compatible endpoint (OpenAI, Groq, a self-hosted Whisper server...). */
export async function transcribe(stt, { name, mediaType, data }, fetchImpl = fetch) {
  if (!stt) throw new AiError('Transcription is not set up on this server (STT_URL).', 501, 'not_configured');
  if (typeof data !== 'string' || !data) throw new AiError('Send the audio.', 400, 'bad_request');
  const form = new FormData();
  form.append('file', new Blob([Buffer.from(data, 'base64')], { type: mediaType || 'application/octet-stream' }), name || 'audio.m4a');
  form.append('model', stt.model);
  form.append('response_format', 'verbose_json');
  const r = await fetchImpl(stt.url, { method: 'POST', headers: stt.key ? { Authorization: `Bearer ${stt.key}` } : {}, body: form });
  if (!r.ok) throw new AiError(`The transcription service answered ${r.status}.`, 502, 'stt_error');
  const j = await r.json();
  const segments = Array.isArray(j.segments) ? j.segments.map((s) => ({ start: s.start, end: s.end, text: String(s.text || '').trim() })) : [];
  return { text: String(j.text || segments.map((s) => s.text).join(' ')).trim(), segments, language: j.language || null, duration: j.duration ?? null };
}

/** A fixed one-minute window per client: enough for a broker, not for a leaked token run in a loop. */
export function limiter(perMin, now = () => Date.now()) {
  const seen = new Map();
  return (key) => {
    const t = now();
    let w = seen.get(key);
    if (!w || t - w.start >= 60000) { w = { start: t, n: 0 }; seen.set(key, w); }
    w.n += 1;
    if (seen.size > 5000) for (const [k, v] of seen) if (t - v.start >= 60000) seen.delete(k);
    return w.n <= perMin ? 0 : Math.ceil((w.start + 60000 - t) / 1000);
  };
}

/**
 * The request handler. `client` is an Anthropic client (or a stand-in in
 * tests); `deps.fetch` is used for the speech service.
 */
export function handler(cfg, client, deps = {}) {
  const limit = limiter(cfg.ratePerMin || 20, deps.now);
  return async (req, res) => {
    const origin = req.headers.origin;
    const cors = origin && cfg.origins.includes(origin)
      ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Max-Age': '600' }
      : {};
    if (origin && !cors['Access-Control-Allow-Origin']) { send(res, 403, { error: 'origin_not_allowed', message: 'This server does not accept requests from that site.' }); return; }
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!tokenOk(auth, cfg.token)) { send(res, 401, { error: 'unauthorized', message: 'The access token is missing or wrong.' }, cors); return; }
    const path = new URL(req.url, 'http://x').pathname;
    try {
      if (req.method === 'GET' && path === '/api/health') {
        send(res, 200, { ok: true, ai: cfg.aiConfigured, transcription: !!cfg.stt, model: cfg.aiConfigured ? MODEL : null }, cors);
        return;
      }
      if (req.method !== 'POST') { send(res, 404, { error: 'not_found' }, cors); return; }
      const wait = limit(req.socket.remoteAddress || 'unknown');
      if (wait) { send(res, 429, { error: 'rate_limited', message: `Too many requests: try again in ${wait} seconds.` }, { ...cors, 'Retry-After': String(wait) }); return; }
      const body = await readJson(req, cfg.maxBody);
      const needAi = () => { if (!cfg.aiConfigured || !client) throw new AiError('AI is not set up on this server (ANTHROPIC_API_KEY).', 501, 'not_configured'); };
      let out;
      if (path === '/api/extract') { needAi(); out = await extract(client, body); }
      else if (path === '/api/assist') { needAi(); out = await assist(client, body); }
      else if (path === '/api/meeting') { needAi(); out = await meeting(client, body); }
      else if (path === '/api/transcribe') out = await transcribe(cfg.stt, body, deps.fetch);
      else { send(res, 404, { error: 'not_found' }, cors); return; }
      send(res, 200, out, cors);
    } catch (e) {
      if (e instanceof AiError) { send(res, e.status, { error: e.code, message: e.message }, cors); return; }
      // SDK errors carry a status; never pass their bodies on (they can echo request details)
      const status = typeof e?.status === 'number' ? e.status : 500;
      const message = status === 429 ? 'The AI service is busy: try again in a minute.'
        : status === 401 || status === 403 ? 'The server’s AI key was refused.'
          : status >= 500 ? 'The AI service had a problem: try again.' : 'The AI request failed.';
      console.error(`[${new Date().toISOString()}] ${path} failed: ${status} ${e?.name || 'Error'}`);
      send(res, status >= 400 && status < 600 ? (status === 401 || status === 403 ? 502 : status) : 500, { error: 'upstream', message }, cors);
    }
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const cfg = config();
  if (!cfg.token || cfg.token.length < 16) { console.error('Set APP_TOKEN to a long random string (16+ characters).'); process.exit(1); }
  if (!cfg.origins.length) console.warn('ALLOWED_ORIGINS is empty: browsers on any other site will be refused.');
  let client = null;
  if (cfg.aiConfigured) { const { default: Anthropic } = await import('@anthropic-ai/sdk'); client = new Anthropic(); }
  http.createServer(handler(cfg, client)).listen(cfg.port, () => {
    console.log(`Zlatura AI server on :${cfg.port} -- AI ${cfg.aiConfigured ? `on (${MODEL})` : 'off'}, transcription ${cfg.stt ? 'on' : 'off'}`);
  });
}
