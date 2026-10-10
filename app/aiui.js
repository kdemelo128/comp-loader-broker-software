/* aiui.js -- the AI screens: settings, reading documents, the deal
 * assistant, and transcribing voice notes into reviewed notes.
 *
 * The rule throughout: AI proposes, the broker decides. A figure read by AI
 * is checked against the document's own text (reconcile.js) before it is
 * shown, against the deal's current figure, and is written only when the
 * broker ticks it and taps Apply. Nothing is sent anywhere until AI is
 * turned on and the send is confirmed. */

import * as ai from './ai.js';
import { buildFacts } from './aifacts.js';
import { normalizeValue, verifyQuote, reconcile, sameValue } from './reconcile.js';
import { el, toast, actionSheet, getPdfjs, money0, money2, pct, int, niceDate, copyText } from './kit.js';

const ok = (x) => typeof x === 'number' && Number.isFinite(x);
const MAX_SEND = 28 * 1024 * 1024;   // the server accepts 40 MB of JSON; base64 adds a third

const show = (kind, v) => {
  if (v === null || v === undefined || v === '') return '—';
  if (kind === 'money') return money0(v);
  if (kind === 'money2') return money2(v);
  if (kind === 'pct') return pct(v);
  if (kind === 'int') return int(v);
  return String(v);
};
const STATUS = {
  verified: ['Passage checked', 'chip-good'],
  'other-page': ['Found on another page', 'chip-accent'],
  'value-not-in-quote': ['Figure not in the passage', 'chip-warn'],
  'not-found': ['Passage not in the document', 'chip-bad'],
  unchecked: ['Can’t be checked (scan)', 'chip-warn'],
};
const btn = (cls, text, fn) => { const b = el('button', `btn ${cls}`.trim(), text); b.type = 'button'; if (fn) b.addEventListener('click', fn); return b; };

/* ------------------------------------------------------------- settings */

export async function openAiSettings(api) {
  const s = await ai.getSettings();
  const save = btn('', 'Save');
  const test = btn('btn-gray', 'Test connection');
  const body = api.sheetOpen({ eyebrow: 'AI', title: 'AI settings', sub: 'Reading documents, the deal assistant and transcription run on your firm’s Zlatura AI server.', foot: [test, save] });
  const p = el('p', 'hint');
  p.textContent = 'When AI is on, the documents, questions or recordings you choose are sent to the server below, which passes them to Anthropic’s API (and recordings to the speech service it is set up with). Nothing is sent without your confirming each time. The app holds no API key: only this server’s address and the access token your firm gives you, kept on this device.';
  body.appendChild(p);
  const form = el('div', 'grid-form');
  form.style.padding = '12px 0 0';
  const field = (id, label, type, value, ph) => {
    const f = el('div', 'field wide');
    const l = el('label', null, label);
    const i = el('input');
    i.id = id; i.type = type; i.value = value || ''; i.placeholder = ph || ''; i.autocomplete = 'off';
    l.htmlFor = id;
    f.append(l, i);
    form.appendChild(f);
    return i;
  };
  const url = field('ai-url', 'Server address', 'url', s.url, 'https://ai.yourfirm.com');
  const token = field('ai-token', 'Access token', 'password', s.token, 'from your firm');
  const sw = el('label', 'chk');
  const on = el('input');
  on.type = 'checkbox'; on.id = 'ai-enabled'; on.checked = !!s.enabled;
  sw.append(on, document.createTextNode(' Turn AI on for this device'));
  body.append(form, sw);
  const status = el('p', 'hint-sm');
  status.id = 'ai-status';
  status.setAttribute('role', 'status');
  body.appendChild(status);
  const current = () => ({ url: url.value, token: token.value.trim(), enabled: on.checked });
  save.addEventListener('click', async () => {
    toast((await ai.saveSettings(current())) ? (on.checked ? 'AI is on for this device.' : 'AI is off.') : 'This device would not save the settings.');
    api.sheetClose();
  });
  test.addEventListener('click', async () => {
    status.textContent = 'Checking…';
    await ai.saveSettings({ ...current(), enabled: true });
    try {
      const h = await ai.health();
      status.textContent = `Connected. Document reading and the assistant: ${h.ai ? `on (${h.model})` : 'off (the server has no API key)'}. Transcription: ${h.transcription ? 'on' : 'off (no speech service set up)'}.`;
    } catch (e) { status.textContent = e.message; }
    await ai.saveSettings(current());
  });
}

async function ready(api) {
  const s = await ai.getSettings();
  if (ai.isReady(s)) return s;
  const v = await actionSheet('AI is off', [{ label: 'AI settings…', sub: 'Your firm’s AI server address and access token', value: 'go', primary: true }]);
  if (v === 'go') openAiSettings(api);
  return null;
}
const host = (s) => { try { return new URL(s.url).host; } catch { return s.url; } };

/* ------------------------------------------------------ reading documents */

async function pdfText(api, bytes) {
  const pdfjs = await getPdfjs();
  return api.pdfPages(pdfjs, bytes.slice(0));
}

/**
 * h: { api, deal(), fields: [{ key, label, kind }], apply(entries, note) }.
 * Choose documents, confirm the send, then review what came back.
 */
export async function readWithAi(h, files) {
  const s = await ready(h.api);
  if (!s) return;
  files = [...files];
  if (!files.length) return;
  const bad = files.filter((f) => !/\.(pdf|txt|csv|md)$/i.test(f.name));
  if (bad.length) { toast(`${bad.map((f) => f.name).join(', ')}: AI reads PDFs and plain text (TXT, CSV). Save a spreadsheet as CSV first.`, null, 7000); return; }
  const size = files.reduce((t, f) => t + f.size, 0);
  if (size > MAX_SEND) { toast(`These come to ${(size / 1048576).toFixed(1)} MB; send ${Math.round(MAX_SEND / 1048576)} MB or less at a time.`, null, 7000); return; }
  const go = await actionSheet(`Send ${files.length} document${files.length === 1 ? '' : 's'} to ${host(s)}?`, [
    { label: 'Send and read', sub: `${(size / 1048576).toFixed(1)} MB to your firm’s AI server and on to Anthropic’s API. Figures come back for you to check; the deal is not changed until you apply them.`, value: 'yes', primary: true },
  ]);
  if (go !== 'yes') return;
  const docs = [];
  const texts = [];
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (/\.pdf$/i.test(f.name)) {
      let pages = [];
      try { pages = await pdfText(h.api, bytes); } catch { pages = []; }
      texts.push(pages);
      docs.push({ name: f.name, mediaType: 'application/pdf', data: ai.toBase64(bytes) });
    } else {
      const text = new TextDecoder().decode(bytes);
      texts.push([text]);
      docs.push({ name: f.name, mediaType: 'text/plain', text });
    }
  }
  const body = h.api.sheetOpen({ eyebrow: 'AI', title: 'Reading the documents', sub: files.map((f) => f.name).join(', ') });
  body.appendChild(el('p', 'hint', 'This can take a minute for a long OM.'));
  let out;
  try {
    out = await ai.extract(docs, h.fields.map(({ key, label, kind }) => ({ key, label, kind })));
  } catch (e) {
    body.textContent = '';
    body.appendChild(el('p', 'warn-text', e.message));
    return;
  }
  reviewExtraction(h, out, { files: files.map((f) => f.name), texts });
}

/** The review: every figure, checked against its passage and the deal. Exported for tests. */
export function assessExtraction(h, out, { files, texts }) {
  const d = h.deal();
  const kinds = Object.fromEntries(h.fields.map((f) => [f.key, f.kind]));
  return (out.fields || []).map((f) => {
    const kind = kinds[f.key];
    const value = normalizeValue(kind, f.value);
    const pages = texts[f.document] || [];
    const check = pages.length && pages.some((p) => p && p.trim()) ? verifyQuote(pages, f.page, f.quote, value, kind)
      : { status: 'unchecked', page: null, note: 'This document has no text layer (a scan), so the passage can’t be checked: compare it with the page yourself.' };
    const cur = d.figures[f.key];
    const has = cur !== null && cur !== undefined && cur !== '';
    const agrees = has && sameValue(kind, cur, value);
    const conflict = (out.conflicts || []).find((c) => c.key === f.key);
    const readings = conflict ? conflict.readings.map((r) => ({ key: f.key, value: normalizeValue(kind, r.value), source: { label: `${files[r.document] || 'document'}${r.page ? ` p.${r.page}` : ''}`, quote: r.quote } })) : [];
    const rec = conflict ? reconcile(readings, kinds).find((x) => x.key === f.key) : null;
    return {
      key: f.key, label: (h.fields.find((x) => x.key === f.key) || {}).label || f.key, kind, raw: f.value, value, doc: files[f.document] || '', page: check.page || f.page,
      quote: f.quote, basis: f.basis, period: f.period, confidence: f.confidence, note: f.note, check, current: has ? cur : null, agrees, conflict: rec,
      // ticked to start only when the passage checks out and nothing is overwritten
      preselect: value !== null && check.status === 'verified' && (!has || agrees) && !(rec && rec.status === 'conflict'),
      usable: value !== null && check.status !== 'not-found',
    };
  });
}

function reviewExtraction(h, out, meta) {
  const rows = assessExtraction(h, out, meta);
  const apply = btn('', 'Apply selected');
  apply.id = 'ai-apply';
  const cancel = btn('btn-gray', 'Discard', () => h.api.sheetClose());
  const body = h.api.sheetOpen({ eyebrow: `AI · ${out.model || ''}`, title: 'Check what was read', sub: `${rows.length} figure${rows.length === 1 ? '' : 's'} from ${meta.files.join(', ')}. Tick the ones to put in the deal.`, foot: [cancel, apply] });
  const picks = new Map();
  if (!rows.length) body.appendChild(el('p', 'hint', 'No figures for this deal’s fields were found in these documents.'));
  const list = el('div', 'ai-rows');
  for (const r of rows) {
    const row = el('div', 'ai-row');
    row.dataset.key = r.key;
    const top = el('label', 'ai-row-top');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = r.preselect;
    cb.disabled = !r.usable;
    cb.setAttribute('aria-label', `Use ${r.label}`);
    picks.set(r.key, [cb, r]);
    const name = el('span', 'ai-label', r.label);
    const val = el('b', 'ai-value', r.value === null ? `${r.raw} (unreadable)` : show(r.kind, r.value));
    top.append(cb, name, val);
    row.appendChild(top);
    const [st, cls] = STATUS[r.check.status];
    const tags = el('div', 'ai-tags');
    tags.appendChild(el('span', `chip ${cls}`, st));
    tags.appendChild(el('span', 'chip chip-plain', `${r.doc}${r.page ? ` p.${r.page}` : ''}`));
    if (r.basis === 'calculated') tags.appendChild(el('span', 'chip chip-warn', 'calculated in the document'));
    if (r.period) tags.appendChild(el('span', 'chip chip-plain', r.period));
    if (r.confidence !== 'high') tags.appendChild(el('span', 'chip chip-plain', `${r.confidence} confidence`));
    row.appendChild(tags);
    row.appendChild(el('div', 'snippet', r.quote));
    const cmp = !r.usable ? 'Can’t be applied: there is no passage in the document to back it.'
      : r.current === null ? 'The deal has no figure here yet.'
      : r.agrees ? `Agrees with the deal’s ${show(r.kind, r.current)}.` : `The deal has ${show(r.kind, r.current)}: applying replaces it (the old figure is kept as an alternative reading).`;
    row.appendChild(el('p', `hint-sm${!r.usable || (r.current !== null && !r.agrees) ? ' warn-text' : ''}`, cmp));
    if (r.check.note) row.appendChild(el('p', 'hint-sm warn-text', r.check.note));
    if (r.conflict && r.conflict.status === 'conflict') {
      row.appendChild(el('p', 'hint-sm warn-text', `The documents disagree: ${r.conflict.groups.map((g) => `${show(r.kind, g.value)} (${g.readings.map((x) => x.source.label).join(', ')})`).join(' vs ')}.`));
    }
    if (r.note) row.appendChild(el('p', 'hint-sm', r.note));
    list.appendChild(row);
  }
  body.appendChild(list);
  if (out.notes && out.notes.length) {
    const n = el('section');
    n.appendChild(el('h3', null, 'Also noted'));
    const ul = el('ul', 'ps-list');
    for (const t of out.notes) ul.appendChild(el('li', null, t));
    n.appendChild(ul);
    body.appendChild(n);
  }
  body.appendChild(el('p', 'hint-sm', 'AI reading can be wrong. “Passage checked” means the quoted words are on that page and contain the figure; it does not mean the figure is the right one for this field.'));
  apply.addEventListener('click', () => {
    const chosen = [...picks.values()].filter(([cb]) => cb.checked).map(([, r]) => r);
    if (!chosen.length) { toast('Nothing ticked: tick the figures to use.'); return; }
    const d = h.deal();
    d.ai ||= { extractions: [] };
    (d.ai.extractions ||= []).push({
      at: Date.now(), model: out.model || null, files: meta.files,
      fields: rows.map((r) => ({ key: r.key, value: r.value, doc: r.doc, page: r.page, quote: r.quote, status: r.check.status, applied: chosen.includes(r) })),
      notes: out.notes || [],
    });
    h.apply(chosen.map((r) => ({ key: r.key, value: r.value, source: { ai: true, via: 'document', doc: r.doc, page: r.page, line: r.quote, verified: r.check.status === 'verified', status: r.check.status, confidence: r.confidence === 'high' ? 'high' : r.confidence === 'medium' ? 'medium' : 'low', model: out.model || null } })));
    h.api.sheetClose();
    toast(`${chosen.length} figure${chosen.length === 1 ? '' : 's'} applied, each marked as read by AI with its page.`);
  });
}

/* ------------------------------------------------------------ assistant */

/** h: { api, deal(), fields, context() -> { m, scenario, rrSum, comps, issues }, touch() } */
export async function openAssistant(h) {
  const s = await ready(h.api);
  if (!s) return;
  const d = h.deal();
  d.aiChat ||= [];
  const ask = btn('', 'Ask');
  ask.id = 'ai-ask';
  const clear = btn('btn-gray', 'Clear', () => { d.aiChat = []; h.touch(); draw(); });
  const body = h.api.sheetOpen({ eyebrow: 'AI', title: 'Ask about this deal', sub: 'Answers use only this deal’s figures, rent roll, scenario and comps, and say which ones.', foot: [clear, ask] });
  const log = el('div', 'ai-chat');
  log.setAttribute('aria-live', 'polite');
  const box = el('textarea', 'ai-q');
  box.id = 'ai-question';
  box.rows = 2;
  box.placeholder = 'e.g. What does the debt look like if the anchor tenant leaves?';
  box.setAttribute('aria-label', 'Your question');
  body.append(log, box);
  const draw = () => {
    log.textContent = '';
    if (!d.aiChat.length) log.appendChild(el('p', 'hint-sm', `Sent with each question: the deal’s figures with their sources (${host(s)}, then Anthropic’s API).`));
    for (const t of d.aiChat) {
      const q = el('div', 'ai-msg q');
      q.textContent = t.q;
      log.appendChild(q);
      const a = el('div', 'ai-msg a');
      if (t.error) { a.classList.add('warn-text'); a.textContent = t.error; } else {
        a.appendChild(el('p', null, t.answer));
        if (t.cited && t.cited.length) {
          const c = el('details', 'ai-cites');
          c.appendChild(el('summary', null, `Based on ${t.cited.length} fact${t.cited.length === 1 ? '' : 's'}`));
          const ul = el('ul');
          for (const f of t.cited) ul.appendChild(el('li', null, `${f.label}: ${f.value} — ${f.source}`));
          c.appendChild(ul);
          a.appendChild(c);
        } else a.appendChild(el('p', 'hint-sm warn-text', 'No deal figure was cited for this answer.'));
        if (t.unknown && t.unknown.length) a.appendChild(el('p', 'hint-sm', `Not in the deal: ${t.unknown.join('; ')}.`));
        if (t.invalid) a.appendChild(el('p', 'hint-sm warn-text', 'The answer cited facts that do not exist; treat it with care.'));
      }
      log.appendChild(a);
    }
    log.scrollTop = log.scrollHeight;
  };
  draw();
  ask.addEventListener('click', async () => {
    const q = box.value.trim();
    if (!q) return;
    ask.disabled = true;
    const facts = buildFacts({ deal: d, fields: h.fields, ...h.context() });
    const history = d.aiChat.filter((t) => !t.error).slice(-4).flatMap((t) => [{ role: 'user', content: t.q }, { role: 'assistant', content: t.answer }]);
    const turn = { q, at: Date.now() };
    try {
      const r = await ai.assist(q, facts, history);
      turn.answer = r.answer;
      turn.cited = (r.citations || []).map((id) => facts.find((f) => f.id === id)).filter(Boolean);
      turn.unknown = r.unknown || [];
      turn.invalid = !!(r.invalidCitations && r.invalidCitations.length);
      turn.model = r.model || null;
      box.value = '';
    } catch (e) { turn.error = e.message; }
    d.aiChat.push(turn);
    if (d.aiChat.length > 50) d.aiChat.splice(0, d.aiChat.length - 50);
    h.touch();
    ask.disabled = false;
    draw();
  });
}

/* ------------------------------------------------- transcripts and notes */

const clock = (t) => (ok(t) ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}` : '');

/** Transcribe a voice note, after confirming the send; then open the transcript. */
export async function transcribeNote(h, note) {
  const s = await ready(h.api);
  if (!s) return;
  const go = await actionSheet(`Send “${note.name}” for transcription?`, [
    { label: 'Send and transcribe', sub: `The recording goes to ${host(s)} and the speech service it uses. The transcript comes back for you to check and correct.`, value: 'yes', primary: true },
  ]);
  if (go !== 'yes') return;
  toast('Transcribing…', null, 60000);
  try {
    const bytes = new Uint8Array(await note.blob.arrayBuffer());
    if (bytes.length > MAX_SEND) throw new Error('This recording is too long to send in one piece.');
    const r = await ai.transcribe({ name: `${note.name}.${/webm/.test(note.blob.type) ? 'webm' : /ogg/.test(note.blob.type) ? 'ogg' : 'm4a'}`, mediaType: note.blob.type, data: ai.toBase64(bytes) });
    note.transcript = { text: r.text, segments: r.segments || [], language: r.language, at: Date.now(), edited: false, reviewed: false };
    h.touch();
    toast('Transcript ready: check it against the recording.');
    openTranscript(h, note);
  } catch (e) { toast(e.message, null, 7000); }
}

export function openTranscript(h, note) {
  const t = note.transcript;
  const save = btn('btn-gray', 'Save');
  const notesBtn = btn('', 'Make notes');
  notesBtn.id = 'ai-make-notes';
  const body = h.api.sheetOpen({ eyebrow: 'Voice note', title: note.name, sub: `Transcribed ${niceDate(t.at)}${t.edited ? ', corrected by hand' : ''}. Recognition makes mistakes, above all with figures and names: correct them here.`, foot: [save, notesBtn] });
  const au = el('audio');
  au.controls = true;
  au.preload = 'none';
  au.src = URL.createObjectURL(note.blob);
  au.style.width = '100%';
  body.appendChild(au);
  if (t.segments && t.segments.length) {
    const seg = el('details', 'ai-segs');
    seg.appendChild(el('summary', null, `${t.segments.length} timed segments (tap a time to play from there)`));
    for (const sgm of t.segments) {
      const p = el('p');
      const b = el('button', 'btn-plain btn-sm', clock(sgm.start));
      b.type = 'button';
      b.addEventListener('click', () => { au.currentTime = sgm.start; au.play().catch(() => {}); });
      p.append(b, document.createTextNode(` ${sgm.text}`));
      seg.appendChild(p);
    }
    body.appendChild(seg);
  }
  const ta = el('textarea', 'ai-transcript');
  ta.id = 'ai-transcript';
  ta.rows = 10;
  ta.value = t.text;
  ta.setAttribute('aria-label', 'Transcript');
  body.appendChild(ta);
  const keep = () => { if (ta.value !== t.text) { t.text = ta.value; t.edited = true; } t.reviewed = true; h.touch(); };
  save.addEventListener('click', () => { keep(); toast('Transcript saved.'); h.api.sheetClose(); });
  notesBtn.addEventListener('click', async () => {
    keep();
    notesBtn.disabled = true;
    try {
      const r = await ai.meeting(t.text, h.fields.map(({ key, label }) => ({ key, label })));
      note.notes = { ...r, at: Date.now() };
      h.touch();
      openNotes(h, note);
    } catch (e) { toast(e.message, null, 7000); notesBtn.disabled = false; }
  });
  if (note.notes) body.appendChild(btn('btn-gray btn-sm', 'Open the notes made earlier', () => openNotes(h, note)));
}

/** The notes from a transcript: summary, decisions, action items, and deal facts to review. Exported for tests. */
export function assessNoteFacts(h, note) {
  const kinds = Object.fromEntries(h.fields.map((f) => [f.key, f.kind]));
  const d = h.deal();
  return (note.notes.dealFacts || []).map((f) => {
    const kind = kinds[f.key];
    const value = normalizeValue(kind, f.value);
    const check = verifyQuote(note.transcript.text, null, f.quote, value, kind);
    const cur = d.figures[f.key];
    const has = cur !== null && cur !== undefined && cur !== '';
    return { ...f, kind, value, check, current: has ? cur : null, agrees: has && sameValue(kind, cur, value), label: (h.fields.find((x) => x.key === f.key) || {}).label || f.key };
  });
}

export function openNotes(h, note) {
  const n = note.notes;
  const facts = assessNoteFacts(h, note);
  const apply = btn('', 'Apply ticked figures');
  apply.id = 'ai-notes-apply';
  const copy = btn('btn-gray', 'Copy notes');
  const body = h.api.sheetOpen({ eyebrow: `Notes · ${note.name}`, title: 'Call notes', sub: 'Written from the transcript. Check the figures before using them.', foot: [copy, apply] });
  const sec = (title, items, fmt) => {
    if (!items || !items.length) return;
    const s = el('section');
    s.appendChild(el('h3', null, title));
    const ul = el('ul', 'ps-list');
    for (const it of items) ul.appendChild(el('li', null, fmt ? fmt(it) : it));
    s.appendChild(ul);
    body.appendChild(s);
  };
  body.appendChild(el('p', null, n.summary));
  sec('Decisions', n.decisions);
  sec('Action items', n.actionItems, (a) => `${a.task}${a.owner ? ` — ${a.owner}` : ''}${a.due ? `, by ${a.due}` : ''}`);
  sec('To confirm', n.questions);
  if (n.actionItems && n.actionItems.length && h.addTasks) {
    const tb = btn('btn-gray btn-sm', `Add ${n.actionItems.length} action item${n.actionItems.length === 1 ? '' : 's'} to the deal’s next steps`);
    tb.id = 'ai-notes-tasks';
    tb.addEventListener('click', async () => {
      tb.disabled = true;
      try { await h.addTasks(n.actionItems, `call notes, ${note.name}`); toast('Added to the deal’s next steps.'); } catch (e) { toast(e.message); tb.disabled = false; }
    });
    body.appendChild(tb);
  }
  const picks = [];
  if (facts.length) {
    const s = el('section');
    s.appendChild(el('h3', null, 'Figures mentioned'));
    for (const f of facts) {
      const row = el('div', 'ai-row');
      const top = el('label', 'ai-row-top');
      const cb = el('input');
      cb.type = 'checkbox';
      // a figure said aloud is never ticked to start: the broker chooses
      cb.checked = false;
      cb.disabled = f.value === null || f.check.status === 'not-found';
      cb.setAttribute('aria-label', `Use ${f.label}`);
      picks.push([cb, f]);
      top.append(cb, el('span', 'ai-label', f.label), el('b', 'ai-value', f.value === null ? f.value : show(f.kind, f.value)));
      row.appendChild(top);
      const tags = el('div', 'ai-tags');
      tags.appendChild(el('span', `chip ${f.check.status === 'verified' ? 'chip-good' : 'chip-bad'}`, f.check.status === 'verified' ? 'In the transcript' : 'Not found in the transcript'));
      if (f.speakerCertainty !== 'firm') tags.appendChild(el('span', 'chip chip-warn', f.speakerCertainty));
      row.appendChild(tags);
      row.appendChild(el('div', 'snippet', f.quote));
      row.appendChild(el('p', 'hint-sm', f.current === null ? 'The deal has no figure here yet.' : f.agrees ? 'Agrees with the deal.' : `The deal has ${show(f.kind, f.current)}.`));
      s.appendChild(row);
    }
    body.appendChild(s);
  }
  apply.disabled = !facts.length;
  apply.addEventListener('click', () => {
    const chosen = picks.filter(([cb]) => cb.checked).map(([, f]) => f);
    if (!chosen.length) { toast('Tick the figures to put in the deal.'); return; }
    h.apply(chosen.map((f) => ({ key: f.key, value: f.value, source: { ai: true, via: 'voice note', doc: note.name, page: null, line: f.quote, verified: f.check.status === 'verified', status: f.check.status, confidence: f.speakerCertainty === 'firm' ? 'medium' : 'low' } })));
    h.api.sheetClose();
    toast(`${chosen.length} figure${chosen.length === 1 ? '' : 's'} applied from the call, marked as said on “${note.name}”.`);
  });
  copy.addEventListener('click', async () => {
    const text = [n.summary, '', ...(n.decisions || []).map((x) => `Decision: ${x}`), ...(n.actionItems || []).map((a) => `To do: ${a.task}${a.owner ? ` (${a.owner})` : ''}${a.due ? `, by ${a.due}` : ''}`), ...(n.questions || []).map((q) => `To confirm: ${q}`)].join('\n');
    toast((await copyText(text)) ? 'Notes copied.' : 'The browser blocked copying here.');
  });
}
