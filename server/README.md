# Comp Loader AI server

The Comp Loader app is a static page: anyone can read its code, so it can't
hold an API key. This small server holds the keys and does the AI work for the
app:

| Endpoint | What it does |
|---|---|
| `POST /api/extract` | Reads figures out of PDFs or text (OM, rent roll, T-12, lease) with Claude. Each figure comes back with the verbatim passage it was read from, which the app checks against the document before showing it. |
| `POST /api/assist` | Answers a question about one deal from the facts the app sends (figures and their sources), citing the facts it used. |
| `POST /api/transcribe` | Sends a recording to a speech-to-text service and returns the transcript with timings. |
| `POST /api/meeting` | Turns a transcript into a summary, decisions, action items and figures mentioned, each with the words that support it. |
| `GET /api/health` | Says whether AI and transcription are set up (never the keys). |

Nothing is logged or stored: no documents, questions, recordings or answers.
The model is `claude-opus-5-5` (set `AI_MODEL` to change it), asked for
structured JSON, with Anthropic's server-side fallback turned on
(`fallbacks: "default"`) so a request the model declines on safety grounds is
retried on the recommended fallback model rather than failing.

## Running it

Needs Node 20 or later.

```sh
cd server
npm ci
APP_TOKEN="$(openssl rand -hex 24)" \
ALLOWED_ORIGINS="https://yourname.github.io" \
ANTHROPIC_API_KEY="sk-ant-..." \
STT_URL="https://api.openai.com/v1/audio/transcriptions" STT_API_KEY="..." \
npm start
```

| Variable | |
|---|---|
| `APP_TOKEN` | Required, 16+ characters. Give it to the brokers who may use the server; they enter it under **AI settings** in the app. Change it to cut everyone off. |
| `ALLOWED_ORIGINS` | The site the app is served from (comma separated). Browsers on any other site are refused. |
| `ANTHROPIC_API_KEY` | For extraction, the assistant and meeting notes. |
| `STT_URL`, `STT_API_KEY`, `STT_MODEL` | Optional. Any speech service with an OpenAI-compatible `/audio/transcriptions` endpoint (OpenAI, Groq, or a self-hosted Whisper server). `STT_MODEL` defaults to `whisper-1`. |
| `PORT` | Default 8787. |
| `MAX_BODY_MB` | Largest request, default 40 (a 28 MB PDF after base64). |

Put it behind HTTPS (any host that runs Node: a small VM, Render, Fly.io, a
container service). The app refuses a plain `http://` address except
`localhost`.

Keep keys in the host's secret settings or an `.env` file outside the
repository (`.env` is in `.gitignore`); never in the app.

## What leaves the device

Only what a broker sends, each time after confirming: the documents chosen
for reading, a question with the deal's figures, or a recording. The server
passes them to Anthropic's API (and recordings to the speech service) and
returns the answer. Check that this fits your firm's confidentiality
obligations (offering memoranda are usually under an NDA) and the providers'
data terms before turning it on.

## Tests

```sh
npm test
```

The tests run the server and the real Anthropic SDK against a local stand-in
for the Messages API: the request shape (model, structured output, fallbacks,
documents), the token and origin checks, refusals, cut-off answers, upstream
errors (whose bodies are never passed on), size limits, and transcription.
They do not call a live model; that needs a key and is not part of the suite.
`tests/e2e/ai-flow.mjs` drives the app in a browser against this server the
same way.
