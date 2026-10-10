/* The AI features end to end in the browser: the app, the real AI server
 * (server/index.mjs through the real Anthropic SDK), and stand-ins for the
 * Messages API and a speech service. The stand-ins return fixed answers --
 * including an invented passage and a conflict -- so this checks the app's
 * own checks and review, not the model. No live model is called. */
import http from 'node:http';
import { phone, BASE, SHOTS } from './lib.mjs';
import { handler, config } from '../../server/index.mjs';
const { default: Anthropic } = await import('../../server/node_modules/@anthropic-ai/sdk/index.mjs');

const F = new URL('./files/', import.meta.url).pathname;
const R = []; const check = (n, c, d = '') => R.push([c ? 'PASS' : 'FAIL', n, d]);
const calls = [];

// --- the Messages API stand-in: answers by which job the system prompt names
const message = (obj) => ({ id: 'msg_e2e', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null, content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { input_tokens: 1, output_tokens: 1 } });
const EXTRACT = {
  fields: [
    { key: 'price', value: '$6,450,000', document: 0, page: 2, quote: 'Asking Price $6,450,000', basis: 'stated', period: null, confidence: 'high', note: null },
    { key: 'gpr', value: '$468,000', document: 0, page: 4, quote: 'Base Rent $468,000', basis: 'stated', period: 'Current', confidence: 'medium', note: null },
    { key: 'cap', value: '6.25%', document: 0, page: 2, quote: 'Cap Rate 6.25%', basis: 'stated', period: null, confidence: 'high', note: null },
    { key: 'year', value: '1948', document: 0, page: 1, quote: 'Year Built 1948', basis: 'stated', period: null, confidence: 'high', note: null },
    { key: 'noi', value: '$393,450', document: 0, page: 4, quote: 'Net Operating Income $393,450', basis: 'stated', period: 'Current', confidence: 'high', note: null },
  ],
  conflicts: [{ key: 'noi', readings: [{ value: '$393,450', document: 0, page: 4, quote: 'Net Operating Income $393,450' }, { value: '$448,200', document: 0, page: 4, quote: '$448,200' }], note: 'Current and pro forma differ.' }],
  notes: ['The rent roll shows one vacant suite.'],
};
const upstream = http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => { b += c; });
  req.on('end', () => {
    const body = JSON.parse(b || '{}');
    calls.push(body);
    let out;
    if (/report figures exactly/.test(body.system)) out = EXTRACT;
    else if (/answer a commercial real estate broker/.test(body.system)) out = { answer: 'The asking price is $6,450,000 on 12,000 SF, or $537.50 per SF.', citations: ['f1', 'f99'], unknown: [] };
    else out = { summary: 'Call with the seller about occupancy and the T-12.', decisions: [], actionItems: [{ task: 'Send the T-12', owner: 'Seller', due: 'Friday', quote: 'send the T-12 by Friday' }], dealFacts: [{ key: 'occ', value: '95%', quote: 'occupancy is 95 percent now', speakerCertainty: 'approximate' }], questions: ['Is 95% leased or occupied?'] };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(message(out)));
  });
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
const upUrl = `http://127.0.0.1:${upstream.address().port}`;

// --- the real server, with the speech service stood in by a fetch
const cfg = config({ APP_TOKEN: 'e2e-token-0123456789abcdef', ALLOWED_ORIGINS: new URL(BASE).origin, ANTHROPIC_API_KEY: 'sk-e2e-not-real' });
cfg.stt = { url: 'https://stt.invalid/v1/audio/transcriptions', key: '', model: 'whisper-1' };
const fakeStt = async () => ({ ok: true, json: async () => ({ text: 'Seller: occupancy is 95 percent now, roughly. We will send the T-12 by Friday.', language: 'en', segments: [{ start: 0, end: 3.2, text: 'Seller: occupancy is 95 percent now, roughly.' }, { start: 3.2, end: 6, text: 'We will send the T-12 by Friday.' }] }) });
const server = http.createServer(handler(cfg, new Anthropic({ apiKey: 'sk-e2e-not-real', baseURL: upUrl, maxRetries: 0 }), { fetch: fakeStt }));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const aiUrl = `http://127.0.0.1:${server.address().port}`;

const { browser, page, errors } = await phone();
const sheetPick = async (text) => { await page.locator('dialog.action-sheet .action-item', { hasText: text }).first().click(); await page.waitForTimeout(250); };
const menu = async (text) => { await page.click('#deal-root button[aria-label="More deal actions"] >> visible=true'); await sheetPick(text); };

await page.goto(BASE + '#deal', { waitUntil: 'load' });
await page.setInputFiles('#om-file', F + 'om-retail.pdf');
await page.waitForSelector('#deal-tiles .tile');

// AI off: nothing is sent; the app offers the settings
await menu('Ask about this deal');
await page.waitForSelector('dialog.action-sheet');
check('with AI off, asking offers the settings instead of sending', /AI is off/.test(await page.textContent('dialog.action-sheet')) && calls.length === 0);
await sheetPick('AI settings');
await page.waitForSelector('#ai-url');
await page.fill('#ai-url', aiUrl);
await page.fill('#ai-token', 'wrong-token');
await page.click('#sheet-foot button:has-text("Test connection")');
await page.waitForFunction(() => !/Checking/.test(document.querySelector('#ai-status').textContent));
check('a wrong token is refused', /token is missing or wrong/.test(await page.textContent('#ai-status')), await page.textContent('#ai-status'));
await page.fill('#ai-token', 'e2e-token-0123456789abcdef');
await page.click('#sheet-foot button:has-text("Test connection")');
await page.waitForFunction(() => /Connected|reach|answered/.test(document.querySelector('#ai-status').textContent));
check('test connection reports both services', /Connected.*on \(claude-opus-5-5\).*Transcription: on/.test(await page.textContent('#ai-status')), await page.textContent('#ai-status'));
await page.check('#ai-enabled');
await page.click('#sheet-foot button:has-text("Save")');
await page.waitForTimeout(300);

// read the OM with AI
const before = calls.length;
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), menu('Read documents with AI')]);
await chooser.setFiles(F + 'om-retail.pdf');
await page.waitForSelector('dialog.action-sheet');
check('the send is confirmed first, naming the server', /Send 1 document to 127\.0\.0\.1/.test(await page.textContent('dialog.action-sheet')) && calls.length === before);
await sheetPick('Send and read');
await page.waitForSelector('#ai-apply', { timeout: 60000 });
const row = (k) => page.locator(`#sheet-body .ai-row[data-key="${k}"]`);
const state = async (k) => ({ checked: await row(k).locator('input').isChecked(), disabled: await row(k).locator('input').isDisabled(), text: (await row(k).innerText()).replace(/\s+/g, ' ') });
const sentDoc = calls.at(-1).messages[0].content[0];
check('the PDF went to the model as a document', sentDoc.type === 'document' && sentDoc.source.media_type === 'application/pdf');
let s = await state('price');
check('price: passage checked, agrees with the deal, ticked', s.checked && /Passage checked/.test(s.text) && /Agrees with the deal/.test(s.text), s.text);
s = await state('gpr');
check('gross potential rent: checked, deal had none, ticked', s.checked && /no figure here yet/.test(s.text), s.text);
s = await state('cap');
check('an invented passage is caught and cannot be applied', !s.checked && s.disabled && /Passage not in the document/.test(s.text), s.text);
s = await state('year');
check('a passage on another page is flagged and left unticked', !s.checked && !s.disabled && /Found on another page/.test(s.text) && /p\.2/.test(s.text), s.text);
s = await state('noi');
check('documents that disagree are shown and left unticked', !s.checked && /documents disagree/.test(s.text) && /\$448,200/.test(s.text), s.text);
await page.screenshot({ path: `${SHOTS}ai-review.png` });
check('no horizontal overflow in the review', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
await page.click('#ai-apply');
await page.waitForTimeout(400);
const tag = await page.locator('#deal-root .src.ai').allTextContents();
check('a new figure carries an AI tag with its page', tag.join(',') === 'AI p.4', tag.join(','));
check('an agreeing figure keeps its OM source, with the AI reading noted as a confirmation', await page.evaluate(() => [...document.querySelectorAll('#deal-root button.src')].some((b) => /Asking price/.test(b.getAttribute('aria-label')) && /p\.2/.test(b.textContent) && !b.classList.contains('ai'))));
await page.click('#deal-root button.src[aria-label^="Asking price"]');
await page.waitForSelector('#sheet-body h3');
check('the source sheet lists the confirmation', /Also confirmed by.*AI reading: om-retail\.pdf p\.2 \(passage checked\)/s.test(await page.textContent('#sheet-body')));
await page.click('#sheet-close');
check('nothing unticked was applied (the invented cap rate, the conflicting NOI)', /p\.2/.test(await page.locator('#deal-root button.src[aria-label^="Cap rate stated"]').textContent()) && await page.locator('#deal-root .src.ai').count() === 1);

// the assistant
await menu('Ask about this deal');
await page.waitForSelector('#ai-question');
await page.fill('#ai-question', 'What is the price per SF?');
await page.click('#ai-ask');
await page.waitForSelector('#sheet-body .ai-msg.a p');
const ans = (await page.locator('#sheet-body .ai-msg.a').innerText()).replace(/\s+/g, ' ');
check('the answer is shown with its cited fact', /\$537\.50/.test(ans) && /Based on 1 fact/.test(ans), ans);
check('an invented citation is flagged', /cited facts that do not exist/.test(ans));
const facts = calls.at(-1).messages.at(-1).content[0].text;
check('facts sent carry their sources', /\[f1\] Asking price: \$6,450,000 \(source: OM page 2, confirmed by AI reading\)/.test(facts) && /Gross potential rent: \$468,000 \(source: read by AI from om-retail\.pdf p\.4, passage checked\)/.test(facts) && /Rent roll: in-place annual rent: \$468,000/.test(facts), facts.slice(0, 300));
await page.click('#sheet-close');

// a voice note: transcribe, correct, make notes, apply a figure
await page.click('#tab-visit');
await page.setInputFiles('#audio-file', F + 'memo.ogg');
await page.waitForSelector('.voice-row');
await page.locator('.voice-row button', { hasText: 'Transcribe' }).click();
await sheetPick('Send and transcribe');
await page.waitForSelector('#ai-transcript', { timeout: 30000 });
check('transcript shown for checking, with timed segments', /occupancy is 95 percent/.test(await page.inputValue('#ai-transcript')) && await page.locator('#sheet-body .ai-segs p').count() === 2);
await page.fill('#ai-transcript', 'Seller: occupancy is 95 percent now, roughly. We will send the T-12 by Friday. (corrected)');
await page.click('#ai-make-notes');
await page.waitForSelector('#ai-notes-apply');
const notes = (await page.locator('#sheet-body').innerText()).replace(/\s+/g, ' ');
check('notes: summary, action item, question', /Send the T-12 — Seller, by Friday/.test(notes) && /Is 95% leased or occupied/.test(notes), notes.slice(0, 200));
const occ = page.locator('#sheet-body .ai-row').first();
check('a figure said aloud starts unticked and is marked approximate', !(await occ.locator('input').isChecked()) && /approximate/.test(await occ.innerText()) && /In the transcript/.test(await occ.innerText()));
await page.click('#ai-notes-tasks');
await page.waitForTimeout(400);
await occ.locator('input').check();
await page.click('#ai-notes-apply');
await page.waitForTimeout(400);
await page.click('#tab-overview');
await page.waitForTimeout(300);
check('occupancy from the call is applied and tagged', (await page.locator('#deal-root .src.ai').count()) === 2);
const persisted = await page.evaluate(() => new Promise((res) => {
  const rq = indexedDB.open('zlatura');
  rq.onsuccess = () => { const tx = rq.result.transaction('deals'); const g = tx.objectStore('deals').getAll(); g.onsuccess = () => res(g.result.map((d) => ({ ex: (d.ai && d.ai.extractions || []).length, chat: (d.aiChat || []).length, tr: (d.visit.audio || []).filter((a) => a.transcript && a.transcript.edited).length }))); };
}));
await page.waitForTimeout(800);
check('the extraction record, the chat and the corrected transcript are kept with the deal', persisted.some((p) => p.ex === 1 && p.chat === 1 && p.tr === 1), JSON.stringify(persisted));
// a scan has no text layer: its passages can't be checked, so nothing starts ticked
const [ch2] = await Promise.all([page.waitForEvent('filechooser'), menu('Read documents with AI')]);
await ch2.setFiles(F + 'om-scanned.pdf');
await sheetPick('Send and read');
await page.waitForSelector('#ai-apply', { timeout: 60000 });
const scan = await page.$$eval('#sheet-body .ai-row', (rows) => rows.map((r) => ({ t: r.innerText, c: r.querySelector('input').checked, d: r.querySelector('input').disabled })));
check('a scan: every passage marked as not checkable, none ticked, still choosable', scan.length === 5 && scan.every((x) => /Can’t be checked \(scan\)/.test(x.t) && !x.c && !x.d), JSON.stringify(scan.map((x) => [x.c, x.d])));
await page.locator('#sheet-foot button', { hasText: 'Discard' }).click();
await page.waitForTimeout(200);
check('call action items became the deal’s next steps', /Send the T-12 \(Seller\)/.test(await page.textContent('#deal-crm')) && /from call notes/.test(await page.textContent('#deal-crm')));
const txt = await page.locator('#app').innerText();
check('no NaN/undefined/Infinity', !/\b(NaN|undefined|Infinity)\b/.test(txt));
for (const [st, n, d] of R) console.log(st, '|', n, d ? `| ${d}` : '');
console.log('PASS', R.filter((x) => x[0] === 'PASS').length, 'FAIL', R.filter((x) => x[0] === 'FAIL').length, 'errors', errors);
await browser.close();
server.close();
upstream.close();
