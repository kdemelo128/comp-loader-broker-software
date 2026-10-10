/* ai.mjs -- what the Zlatura AI server asks Claude, and how it checks the
 * answer before it goes back to the app.
 *
 * Every call returns structured JSON against a schema, so the app never
 * parses prose. Every figure the model reports carries the words it read it
 * from; the app checks those words against the document text before it
 * shows the figure as verified, and nothing reaches a deal until the broker
 * accepts it. The model is told to leave a field empty rather than guess. */

export const MODEL = process.env.AI_MODEL || 'claude-opus-5-5';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** A refusal or truncated answer, said plainly; the app shows the message. */
export class AiError extends Error {
  constructor(message, status = 502, code = 'ai_error') { super(message); this.status = status; this.code = code; }
}

const nullable = (type) => ({ anyOf: [{ type }, { type: 'null' }] });
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

/* ------------------------------------------------------------ extraction */

const EXTRACT_SCHEMA = obj({
  fields: {
    type: 'array',
    items: obj({
      key: { type: 'string' },
      value: { type: 'string' },
      document: { type: 'integer' },
      page: nullable('integer'),
      quote: { type: 'string' },
      basis: { type: 'string', enum: ['stated', 'calculated'] },
      period: nullable('string'),
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      note: nullable('string'),
    }),
  },
  conflicts: {
    type: 'array',
    items: obj({ key: { type: 'string' }, readings: { type: 'array', items: obj({ value: { type: 'string' }, document: { type: 'integer' }, page: nullable('integer'), quote: { type: 'string' } }) }, note: { type: 'string' } }),
  },
  notes: { type: 'array', items: { type: 'string' } },
});

const EXTRACT_SYSTEM = `You read commercial real estate documents (offering memoranda, rent rolls, operating statements, leases) for a broker, and report figures exactly as the documents print them.

Rules:
- Report a field only when a document prints it. Never estimate, infer from market knowledge, or fill a gap. Leave a field out rather than guess.
- "value" is the figure as printed, with its units (e.g. "$6,450,000", "6.10%", "10,000 SF", "2027-03-31").
- "quote" is the shortest verbatim run of text from the document that contains the figure, copied character for character so it can be found by search. No paraphrase, no ellipses.
- "document" is the 0-based index of the document; "page" is the 1-based PDF page, or null for a text document.
- "basis" is "stated" when printed; "calculated" only when the document itself shows the arithmetic (then say so in "note").
- "period" names the period a figure covers when the document says (e.g. "T-12 ending 2026-06", "Pro forma year 1").
- If documents give different values for the same field, report the one from the most authoritative source in "fields" (operating statement over marketing summary, rent roll over summary) and list every reading in "conflicts".
- Use only the field keys given. Put anything else worth the broker's attention in "notes", briefly.`;

/**
 * documents: [{ name, mediaType: 'application/pdf' | 'text/plain', data (base64) | text }]
 * fields: [{ key, label, kind }] -- the deal fields the app can take.
 */
export async function extract(client, { documents, fields }) {
  if (!Array.isArray(documents) || !documents.length) throw new AiError('Send at least one document.', 400, 'bad_request');
  if (!Array.isArray(fields) || !fields.length) throw new AiError('Send the fields to look for.', 400, 'bad_request');
  const content = [];
  documents.forEach((d, i) => {
    if (d.mediaType === 'application/pdf' && typeof d.data === 'string') {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: d.data }, title: `Document ${i}: ${String(d.name || '').slice(0, 200)}` });
    } else if (typeof d.text === 'string') {
      content.push({ type: 'document', source: { type: 'text', media_type: 'text/plain', data: d.text }, title: `Document ${i}: ${String(d.name || '').slice(0, 200)}` });
    } else throw new AiError(`Document ${i} is neither a PDF nor text.`, 400, 'bad_request');
  });
  const list = fields.map((f) => `- ${f.key}: ${f.label}${f.kind ? ` (${f.kind})` : ''}`).join('\n');
  content.push({ type: 'text', text: `Field keys to report:\n${list}\n\nReport the figures these ${documents.length} document(s) print for these fields.` });
  const out = await call(client, { system: EXTRACT_SYSTEM, content, schema: EXTRACT_SCHEMA, maxTokens: 16000 });
  // keep only fields asked for and documents that exist
  const keys = new Set(fields.map((f) => f.key));
  out.fields = (out.fields || []).filter((f) => keys.has(f.key) && f.document >= 0 && f.document < documents.length);
  out.conflicts = (out.conflicts || []).filter((c) => keys.has(c.key));
  return out;
}

/* ------------------------------------------------------------- assistant */

const ASSIST_SCHEMA = obj({
  answer: { type: 'string' },
  citations: { type: 'array', items: { type: 'string' } },
  unknown: { type: 'array', items: { type: 'string' } },
});

const ASSIST_SYSTEM = `You answer a commercial real estate broker's questions about one deal, using only the facts provided.

Rules:
- Each fact has an id. Use only those facts. Every number in your answer must come from a fact or be arithmetic on facts that you show.
- List in "citations" the ids of every fact you used.
- If the facts do not answer the question, say so in the answer and list what is missing in "unknown". Do not use outside market knowledge, comparable sales or rates that are not in the facts.
- Facts marked "assumption" or "scenario" are the broker's assumptions, not documents: say so when you rely on them.
- Be brief and plain: a few sentences, or a short list.`;

/** facts: [{ id, label, value, source }]; history: [{ role, content }] of earlier turns. */
export async function assist(client, { question, facts, history = [] }) {
  if (typeof question !== 'string' || !question.trim()) throw new AiError('Ask a question.', 400, 'bad_request');
  if (!Array.isArray(facts)) throw new AiError('Send the deal facts.', 400, 'bad_request');
  const factText = facts.map((f) => `[${f.id}] ${f.label}: ${f.value}${f.source ? ` (source: ${f.source})` : ''}`).join('\n');
  const prior = history.slice(-8).filter((h) => (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string');
  const content = [{ type: 'text', text: `Deal facts:\n${factText}\n\nQuestion: ${question.trim()}` }];
  const out = await call(client, { system: ASSIST_SYSTEM, content, prior, schema: ASSIST_SCHEMA, maxTokens: 8000 });
  const ids = new Set(facts.map((f) => f.id));
  const bad = (out.citations || []).filter((c) => !ids.has(c));
  out.citations = (out.citations || []).filter((c) => ids.has(c));
  if (bad.length) out.invalidCitations = bad;
  return out;
}

/* ----------------------------------------------------- meeting and notes */

const MEETING_SCHEMA = obj({
  summary: { type: 'string' },
  decisions: { type: 'array', items: { type: 'string' } },
  actionItems: { type: 'array', items: obj({ task: { type: 'string' }, owner: nullable('string'), due: nullable('string'), quote: { type: 'string' } }) },
  dealFacts: { type: 'array', items: obj({ key: { type: 'string' }, value: { type: 'string' }, quote: { type: 'string' }, speakerCertainty: { type: 'string', enum: ['firm', 'approximate', 'hearsay'] } }) },
  questions: { type: 'array', items: { type: 'string' } },
});

const MEETING_SYSTEM = `You turn a transcript of a broker's call, meeting or site visit into notes.

Rules:
- Use only what the transcript says. Never add figures, names or dates it does not contain.
- Every action item and deal fact carries "quote": a verbatim run of the transcript (copied exactly) that supports it.
- "dealFacts" uses only the field keys given. "speakerCertainty" is "approximate" for "about", "roughly", "around"; "hearsay" when the speaker reports what someone else said.
- Transcripts contain recognition errors: when a figure is garbled or ambiguous, leave it out and add a question instead.
- "questions" lists what the broker should confirm.`;

export async function meeting(client, { transcript, fields = [] }) {
  if (typeof transcript !== 'string' || !transcript.trim()) throw new AiError('Send a transcript.', 400, 'bad_request');
  const list = fields.map((f) => `- ${f.key}: ${f.label}`).join('\n');
  const content = [
    { type: 'document', source: { type: 'text', media_type: 'text/plain', data: transcript }, title: 'Transcript' },
    { type: 'text', text: `Field keys for dealFacts:\n${list || '(none)'}\n\nWrite the notes.` },
  ];
  const out = await call(client, { system: MEETING_SYSTEM, content, schema: MEETING_SCHEMA, maxTokens: 12000 });
  const keys = new Set(fields.map((f) => f.key));
  out.dealFacts = (out.dealFacts || []).filter((f) => keys.has(f.key));
  return out;
}

/* ------------------------------------------------------------ the call */

async function call(client, { system, content, prior = [], schema, maxTokens }) {
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    // effort is set explicitly: reading figures accurately is worth the thought
    output_config: { effort: 'high', format: { type: 'json_schema', schema } },
    system,
    messages: [...prior, { role: 'user', content }],
  });
  if (res.stop_reason === 'refusal') throw new AiError('The model declined this request.', 422, 'refused');
  if (res.stop_reason === 'max_tokens') throw new AiError('The answer was cut off: try fewer or shorter documents.', 502, 'truncated');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    const out = JSON.parse(text);
    out.model = res.model;
    return out;
  } catch {
    throw new AiError('The model returned something that is not the expected JSON.', 502, 'bad_output');
  }
}
