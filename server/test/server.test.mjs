/* The AI server end to end, through the real Anthropic SDK, against a local
 * stand-in for the Messages API (no key, no network). It checks what is sent
 * (model, fallbacks, structured output, documents) and how answers, refusals
 * and failures come back. A live model call is not part of these tests. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import Anthropic from '@anthropic-ai/sdk';
import { handler, config, transcribe } from '../index.mjs';

let mock; let mockUrl; let app; let appUrl;
const seen = [];
let reply = () => ({});

const message = (json, stop = 'end_turn') => ({
  id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: stop, stop_sequence: null,
  content: json === null ? [] : [{ type: 'text', text: typeof json === 'string' ? json : JSON.stringify(json) }],
  usage: { input_tokens: 10, output_tokens: 10 },
});

before(async () => {
  mock = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const body = JSON.parse(b || '{}');
      seen.push({ url: req.url, headers: req.headers, body });
      const r = reply(body);
      res.writeHead(r.status || 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(r.body ?? r));
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  mockUrl = `http://127.0.0.1:${mock.address().port}`;
  const client = new Anthropic({ apiKey: 'sk-test-not-real', baseURL: mockUrl, maxRetries: 0 });
  const cfg = config({ APP_TOKEN: 'test-token-0123456789', ALLOWED_ORIGINS: 'https://app.example', ANTHROPIC_API_KEY: 'sk-test-not-real' });
  cfg.stt = { url: `${mockUrl}/stt`, key: 'stt-key', model: 'whisper-1' };
  app = http.createServer(handler(cfg, client));
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  appUrl = `http://127.0.0.1:${app.address().port}`;
});
after(() => { mock.close(); app.close(); });

const post = (path, body, { token = 'test-token-0123456789', origin } = {}) => fetch(appUrl + path, {
  method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(origin ? { origin } : {}) }, body: JSON.stringify(body),
});

test('refuses a missing or wrong token, and other sites', async () => {
  assert.equal((await post('/api/assist', {}, { token: null })).status, 401);
  assert.equal((await post('/api/assist', {}, { token: 'wrong' })).status, 401);
  const r = await post('/api/assist', {}, { origin: 'https://evil.example' });
  assert.equal(r.status, 403);
  const pre = await fetch(`${appUrl}/api/extract`, { method: 'OPTIONS', headers: { origin: 'https://app.example' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), 'https://app.example');
});

test('health says what is configured and never the key', async () => {
  const r = await fetch(`${appUrl}/api/health`, { headers: { authorization: 'Bearer test-token-0123456789' } });
  const j = await r.json();
  assert.deepEqual(j, { ok: true, ai: true, transcription: true, model: 'claude-opus-5-5' });
  assert.ok(!JSON.stringify(j).includes('sk-test'));
});

test('extract: sends the PDF as a document with the schema and fallbacks, and filters the answer', async () => {
  seen.length = 0;
  reply = () => message({
    fields: [
      { key: 'price', value: '$6,450,000', document: 0, page: 1, quote: 'Asking Price $6,450,000', basis: 'stated', period: null, confidence: 'high', note: null },
      { key: 'made_up', value: '1', document: 0, page: 1, quote: 'x', basis: 'stated', period: null, confidence: 'low', note: null },
      { key: 'noi', value: '$393,450', document: 7, page: 2, quote: 'NOI $393,450', basis: 'stated', period: null, confidence: 'high', note: null },
    ],
    conflicts: [], notes: ['Rent roll dated June 2026.'],
  });
  const r = await post('/api/extract', { documents: [{ name: 'om.pdf', mediaType: 'application/pdf', data: Buffer.from('%PDF-1.4 test').toString('base64') }], fields: [{ key: 'price', label: 'Asking price', kind: 'money' }, { key: 'noi', label: 'NOI', kind: 'money' }] });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j.fields.map((f) => f.key), ['price'], 'unknown keys and documents that do not exist are dropped');
  const req = seen[0];
  assert.equal(req.url, '/v1/messages?beta=true');
  assert.equal(req.body.model, 'claude-opus-5-5');
  assert.equal(req.body.fallbacks, 'default');
  assert.match(req.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.equal(req.body.output_config.format.type, 'json_schema');
  assert.equal(req.body.output_config.effort, 'high');
  assert.equal(req.body.thinking, undefined, 'thinking is left to the model default (adaptive)');
  const doc = req.body.messages[0].content[0];
  assert.equal(doc.type, 'document');
  assert.equal(doc.source.media_type, 'application/pdf');
  assert.equal(req.headers['x-api-key'], 'sk-test-not-real');
});

test('assist: citations must be fact ids; invented ones are dropped and reported', async () => {
  reply = () => message({ answer: 'The cap rate on the asking price is 6.10%.', citations: ['f1', 'f9'], unknown: [] });
  const r = await post('/api/assist', { question: 'What is the cap rate?', facts: [{ id: 'f1', label: 'Cap rate', value: '6.10%', source: 'OM p.1' }] });
  const j = await r.json();
  assert.deepEqual(j.citations, ['f1']);
  assert.deepEqual(j.invalidCitations, ['f9']);
  assert.match(seen.at(-1).body.messages.at(-1).content[0].text, /\[f1\] Cap rate: 6\.10%/);
});

test('a refusal, a cut-off answer and bad JSON come back as plain errors', async () => {
  reply = () => message(null, 'refusal');
  let r = await post('/api/assist', { question: 'q', facts: [] });
  assert.equal(r.status, 422);
  assert.equal((await r.json()).error, 'refused');
  reply = () => message('{"answer": "cut', 'max_tokens');
  r = await post('/api/assist', { question: 'q', facts: [] });
  assert.equal((await r.json()).error, 'truncated');
  reply = () => message('not json');
  r = await post('/api/assist', { question: 'q', facts: [] });
  assert.equal((await r.json()).error, 'bad_output');
});

test('upstream failures are mapped without passing their bodies on', async () => {
  reply = () => ({ status: 429, body: { type: 'error', error: { type: 'rate_limit_error', message: 'secret detail' } } });
  const r = await post('/api/assist', { question: 'q', facts: [] });
  assert.equal(r.status, 429);
  const t = await r.text();
  assert.ok(!t.includes('secret detail'));
  reply = () => ({ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } });
  const r2 = await post('/api/assist', { question: 'q', facts: [] });
  assert.equal(r2.status, 502, 'a refused server key is the server’s problem, not the app’s token');
});

test('bad requests and oversized bodies', async () => {
  assert.equal((await post('/api/extract', { documents: [], fields: [] })).status, 400);
  assert.equal((await post('/api/nope', {})).status, 404);
  const small = http.createServer(handler({ ...config({ APP_TOKEN: 'test-token-0123456789', MAX_BODY_MB: '1' }), aiConfigured: true }, {}));
  await new Promise((r) => small.listen(0, '127.0.0.1', r));
  const r = await fetch(`http://127.0.0.1:${small.address().port}/api/extract`, { method: 'POST', headers: { authorization: 'Bearer test-token-0123456789' }, body: 'x'.repeat(2 * 1024 * 1024) }).catch((e) => ({ status: 'reset', e }));
  assert.ok(r.status === 413 || r.status === 'reset');
  small.close();
});

test('AI endpoints say when the server has no key', async () => {
  const bare = http.createServer(handler(config({ APP_TOKEN: 'test-token-0123456789' }), null));
  await new Promise((r) => bare.listen(0, '127.0.0.1', r));
  const r = await fetch(`http://127.0.0.1:${bare.address().port}/api/assist`, { method: 'POST', headers: { authorization: 'Bearer test-token-0123456789' }, body: '{"question":"q","facts":[]}' });
  assert.equal(r.status, 501);
  assert.equal((await r.json()).error, 'not_configured');
  bare.close();
});

test('meeting: deal facts limited to the keys given', async () => {
  reply = () => message({ summary: 'Call with the seller.', decisions: [], actionItems: [{ task: 'Send the T-12', owner: 'Seller', due: null, quote: 'I will send the T-12' }], dealFacts: [{ key: 'occ', value: '92%', quote: 'we are 92% leased', speakerCertainty: 'firm' }, { key: 'other', value: 'x', quote: 'y', speakerCertainty: 'firm' }], questions: [] });
  const r = await post('/api/meeting', { transcript: 'Seller: we are 92% leased. I will send the T-12.', fields: [{ key: 'occ', label: 'Occupancy' }] });
  const j = await r.json();
  assert.deepEqual(j.dealFacts.map((f) => f.key), ['occ']);
  assert.equal(seen.at(-1).body.messages[0].content[0].source.type, 'text');
});

test('transcribe: posts the audio to the speech service and returns segments', async () => {
  let got = null;
  const fake = async (url, init) => {
    got = { url, init };
    return { ok: true, json: async () => ({ text: 'Hello there.', language: 'en', duration: 2.1, segments: [{ start: 0, end: 2.1, text: ' Hello there.' }] }) };
  };
  const out = await transcribe({ url: 'https://stt.example/v1/audio/transcriptions', key: 'k', model: 'whisper-1' }, { name: 'memo.m4a', mediaType: 'audio/mp4', data: Buffer.from('abc').toString('base64') }, fake);
  assert.equal(out.text, 'Hello there.');
  assert.deepEqual(out.segments, [{ start: 0, end: 2.1, text: 'Hello there.' }]);
  assert.equal(got.init.headers.Authorization, 'Bearer k');
  assert.equal(got.init.body.get('model'), 'whisper-1');
  await assert.rejects(() => transcribe(null, { data: 'x' }), /not set up/);
});
