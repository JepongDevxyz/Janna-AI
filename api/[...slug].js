// Janna AI — web edition backend (Vercel serverless, Node runtime).
// Mirrors Fable AI's shape: static web UI + one API function + cloud model
// providers with ROTATIONAL key pools (Jepong's standing rule, 2026-11-04):
// every request shuffles the provider's key pool and, on a key-level failure
// (401/403/429), walks the rest of that pool before giving up. No silent
// cross-provider substitution: the picked model answers, or an honest error.
//
// The desktop (Python) backend remains the full local workspace. This function
// implements the web subset: bootstrap/status/models, the canonical run
// stream (POST /api/run, schema v1 SSE — same protocol as janna/server.py),
// and honest "desktop only" answers for local-machine features.

export const config = { maxDuration: 60 };

const APP_VERSION = '1.6.0-web.1';
const SYSTEM_PROMPT =
  'You are Janna AI, a helpful AI assistant in the Janna AI workspace by Jepong Devxyz. ' +
  'Always write in the same language the user used: Tagalog in, Tagalog out; English in, English out. ' +
  'HOW YOU ANSWER — follow this style: ' +
  '(1) Answer directly first: give the answer, formula or definition up front; never open with a clarifying question — follow-up questions, if any, go at the very end. ' +
  '(2) Show your reasoning: for math, logic and procedures, break the work into labelled steps (Step 1, Step 2, ...), put each calculation on its own line, carry one worked example all the way through, and finish with a clearly marked line like **Final answer: ...** plus a quick check when you can. ' +
  '(3) Structure with Markdown: short headings for sections, bullets for lists, numbered steps for procedures, and a Markdown table for comparisons, pros and cons, prices and schedules. ' +
  '(4) Use bold lead-ins for key terms, step names, verdicts and takeaways (for example **My recommendation:**, **Remember:**, **In short:**). ' +
  '(5) Code: give the working code block first, then a short step-by-step "How it works" breakdown; when fixing a bug, state the cause in one bold sentence first, then the corrected code. ' +
  '(6) Match the requested format EXACTLY — one sentence, a word limit, a table, one quiz question at a time (ask it and stop, do not reveal the answer) — with no extra intro or padding when the format is tight; short simple requests get short plain answers with no headings. ' +
  '(7) Adapt depth and tone to the audience named (a child gets a simple analogy and everyday words; an expert gets full technical detail). ' +
  '(8) Close helpfully: a one-line summary or takeaway, a recommendation when a choice is involved, or an offer to go deeper — never a generic "let me know if you need anything". ' +
  '(9) Fill small gaps with sensible specifics — a concrete example, typical prices, and Philippine local context with peso (₱) amounts when the user is in the Philippines — instead of asking about every detail. ' +
  '(10) Emoji sparingly: at most one or two in a title or opening for light, lifestyle or creative topics; none in formal, technical or math answers. ' +
  '(11) For step-by-step problems, use exactly this shape: a bold **Step 1:** line saying what you are doing, then the calculation on its own line, then **Step 2:** and so on, and end with the line **Final answer: <the result>**. For comparisons, after the table add a closing line that starts with **My recommendation:** and gives your verdict. ' +
  'Answer in the user\'s language. If you do not know something, say so instead of inventing it.';

// ---------- key pools (rotational by default) ----------
function keyPool(envName) {
  const raw = process.env[envName] || '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}
function shuffled(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- model catalog ----------
function catalog() {
  const rows = [
    { id: 'janna-cloud', label: 'Janna Cloud', note: 'Free cloud model · no setup, works anywhere', model_class: 'Janna Cloud', cloud: true, provider: 'pollinations', model: process.env.JANNA_FREE_MODEL || 'openai-fast' },
  ];
  if (keyPool('GROQ_API_KEYS').length)
    rows.push({ id: 'groq-llama-3.3-70b', label: 'Llama 3.3 70B · Groq', note: 'Fast cloud model via Groq', model_class: 'Janna Cloud', cloud: true, provider: 'groq', model: 'llama-3.3-70b-versatile' });
  if (keyPool('GEMINI_API_KEYS').length)
    rows.push({ id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash · Google', note: 'Cloud model via Google AI', model_class: 'Janna Cloud', cloud: true, provider: 'gemini', model: 'gemini-2.5-flash' });
  if (keyPool('OPENROUTER_API_KEYS').length)
    rows.push({ id: 'openrouter-llama-3.3-70b', label: 'Llama 3.3 70B · OpenRouter', note: 'Cloud model via OpenRouter', model_class: 'Janna Cloud', cloud: true, provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct' });
  if (keyPool('MISTRAL_API_KEYS').length)
    rows.push({ id: 'mistral-small', label: 'Mistral Small · Mistral', note: 'Cloud model via Mistral', model_class: 'Janna Cloud', cloud: true, provider: 'mistral', model: 'mistral-small-latest' });
  if (keyPool('COHERE_API_KEYS').length)
    rows.push({ id: 'cohere-command-a', label: 'Command A · Cohere', note: 'Cloud model via Cohere', model_class: 'Janna Cloud', cloud: true, provider: 'cohere', model: 'command-a-03-2025' });
  if (keyPool('APINEX_API_KEYS').length) {
    // APInex free tier (live-probed 2026-11-10): real answers, exact model
    // echo, shared 15 requests/minute across the key. Claude Opus 4.6 is
    // listed free but actually subscription-gated (HTTP 402) and Jev 1.13 is
    // a decision-endpoint model (HTTP 400 on chat) — neither is wired.
    rows.push({ id: 'apinex-gemini-3.8-flash', label: 'Gemini 3.8 Flash', note: 'Cloud model via APInex', model_class: 'Janna Cloud', cloud: true, provider: 'apinex', model: 'free/gemini-3.8-flash' });
    rows.push({ id: 'apinex-gpt-6-luna', label: 'GPT-6 Luna', note: 'Cloud model via APInex', model_class: 'Janna Cloud', cloud: true, provider: 'apinex', model: 'free/gpt-6-luna' });
    rows.push({ id: 'apinex-kimi-k3', label: 'Kimi K3', note: 'Cloud model via APInex', model_class: 'Janna Cloud', cloud: true, provider: 'apinex', model: 'free/kimi-k3' });
    rows.push({ id: 'apinex-muse-spark-1.3', label: 'Muse Spark 1.3', note: 'Cloud model via APInex', model_class: 'Janna Cloud', cloud: true, provider: 'apinex', model: 'free/muse-spark-1.3' });
  }
  return rows;
}

const DEFAULT_SETTINGS = {
  figma_enabled: false, forge_enabled: false, browser_enabled: false, personality: 'precise',
  theme: 'rose', speed: 'standard', effort: 'balanced', refine_reports: false,
  autonomy_passes: 8, research_mode: 'auto', github_research: true, model_failover: true,
  language: 'auto', show_progress: true, show_citations: true, verify_generated_code: true,
  repair_generated_html: true, repair_generated_code: true, send_on_enter: true, voice_output: false,
};

const LUNA_MEMBERS = [
  { id: 'luna', name: 'Luna', role: 'Pet companion', description: 'Your little star cat — she keeps you company, celebrates finished work, and loves pets.', avatar: '/luna/luna-384.png' },
];
const LUNA_PROMPT = 'You are Luna, a sweet and playful pet companion inside the Janna AI app: a little indigo star cat with a golden crescent moon on her forehead. Chat warmly in the user\'s language, with gentle pet-like charm — an occasional soft "mrrp" or purr, never excessive and never in the way of the answer. You are also a capable assistant: answer directly and helpfully, show simple labelled steps when a task has steps, use a small table for comparisons, end with a clear final answer or takeaway line, and match any format the user asks for exactly. Keep replies friendly and reasonably concise unless detail is needed.';

// ---------- provider calls ----------
// OpenAI-compatible streaming chat. Walks the shuffled key pool on key-level
// failures that happen BEFORE the first token; once tokens flow, the stream
// is committed to that key.
async function* openAIStream({ baseUrl, keys, model, messages, extraHeaders = {} }) {
  const pool = keys.length ? shuffled(keys) : [null];
  let lastError = null;
  for (const key of pool) {
    let response;
    try {
      response = await fetch(baseUrl + '/chat/completions', { signal: AbortSignal.timeout(180000),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(key ? { Authorization: 'Bearer ' + key } : {}),
          ...extraHeaders,
        },
        body: JSON.stringify({ model, messages, stream: true }),
      });
    } catch (e) {
      lastError = e;
      continue;
    }
    if (!response.ok || !response.body) {
      lastError = new Error('Provider HTTP ' + response.status);
      if ([401, 403, 429].includes(response.status)) continue; // key-level: walk pool
      throw lastError;
    }
    // Stream SSE deltas.
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content || json.choices?.[0]?.message?.content || '';
          if (delta) yield delta;
        } catch { /* keepalive / partial frame */ }
      }
    }
    return;
  }
  throw lastError || new Error('All provider keys failed');
}

function buildAwareness(body, row) {
  const c = body.context;
  if (!c || typeof c !== 'object') return '';
  const modelList = catalog().map((r) => r.label + ' (' + r.note + ')').join('; ');
  const lines = [];
  lines.push('WHAT YOU KNOW — facts about yourself, this app and this user. Use them to answer questions about Janna AI, the app, or the user accurately; do not recite them unprompted.');
  lines.push('You are Janna AI, the web edition at ai.janna-official.tech, made by Jepong Devxyz. There is no account or sign-in: chats, settings and your memory of the user are stored only in this user\'s browser on this device.');
  lines.push('Plan: Free. Janna Cloud is completely free — no account, no payment, and there are no paid tiers or subscriptions in this app.');
  lines.push('Models the user can pick in this app: ' + modelList + '. You are currently answering as ' + row.label + '.');
  lines.push('Features in this app: chat, with each conversation saved in the sidebar; Luna, a star-cat pet companion the user can tap to pet, plus a separate Luna chat; about 90 color themes (default Rose, dark Velvet) under Settings - Themes; Settings sections: General, Themes, Personalization, How hard Janna works, Checking answers, Web research, Tools and connections, On-device control, Data controls (Export data, Import data, Clear all chats, Clear memory); microphone voice input; file attachments (you can read attached text files; you cannot view images); and a memory of the user (below).');
  lines.push('Desktop app only (NOT in this web edition): Janna Pro 1.1 and Janna Lite 1.1 local models, Work mode with project files and coding tools, and phone pairing. If the user asks for those, say they run in the Janna AI desktop app.');
  lines.push('Your limits in this web edition: you cannot see images, cannot browse or search the web, and cannot run code or edit the user\'s files.');
  lines.push('This user\'s usage in this app: ' + (c.chats || 0) + ' conversations and ' + (c.messages || 0) + ' messages in total. Current conversation: "' + String(c.currentTitle || 'New chat').slice(0, 80) + '". Current theme: ' + (c.theme || 'rose') + '. Luna pets today: ' + (c.lunaPets || 0) + '.');
  if (Array.isArray(c.facts) && c.facts.length) {
    lines.push('Things you remember about this user (saved in this app, across all their chats):');
    for (const f of c.facts.slice(0, 30)) lines.push('- ' + String(f).slice(0, 140));
  } else {
    lines.push('You have no saved facts about this user yet. When they say "tandaan mo ..." or "remember ...", the fact is saved automatically — confirm warmly when that happens.');
  }
  if (Array.isArray(c.others) && c.others.length) {
    lines.push('Previous conversations in this app (other chats, most recent first) — you know these; refer to them when the user mentions another chat:');
    for (const o of c.others) lines.push('- "' + String(o.title || 'New chat').slice(0, 60) + '"' + (o.when ? ' (' + o.when + ')' : '') + (o.first ? ' — starts with: "' + o.first + '"' : '') + (o.last ? ' — latest message: "' + o.last + '"' : ''));
  }
  return lines.join('\n').slice(0, 6000);
}

async function pollinationsText({ model, messages }) {
  const response = await fetch('https://text.pollinations.ai/', { signal: AbortSignal.timeout(180000),
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages }),
  });
  if (!response.ok) throw new Error('Free cloud model HTTP ' + response.status);
  return await response.text();
}

async function* providerStream(row, messages) {
  switch (row.provider) {
    case 'pollinations': {
      const text = await pollinationsText({ model: row.model, messages });
      // Emit as word-ish chunks so the UI streams naturally.
      const parts = text.match(/\S+\s*/g) || [text];
      for (const p of parts) yield p;
      return;
    }
    case 'groq':
      yield* openAIStream({ baseUrl: 'https://api.groq.com/openai/v1', keys: keyPool('GROQ_API_KEYS'), model: row.model, messages });
      return;
    case 'gemini':
      yield* openAIStream({ baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keys: keyPool('GEMINI_API_KEYS'), model: row.model, messages });
      return;
    case 'openrouter':
      yield* openAIStream({ baseUrl: 'https://openrouter.ai/api/v1', keys: keyPool('OPENROUTER_API_KEYS'), model: row.model, messages, extraHeaders: { 'X-Title': 'Janna AI' } });
      return;
    case 'mistral':
      yield* openAIStream({ baseUrl: 'https://api.mistral.ai/v1', keys: keyPool('MISTRAL_API_KEYS'), model: row.model, messages });
      return;
    case 'cohere':
      yield* openAIStream({ baseUrl: 'https://api.cohere.ai/compatibility/v1', keys: keyPool('COHERE_API_KEYS'), model: row.model, messages });
      return;
    case 'apinex':
      yield* openAIStream({ baseUrl: 'https://api.apinex.bond/v1', keys: keyPool('APINEX_API_KEYS'), model: row.model, messages });
      return;
    default:
      throw new Error('Unknown provider for model ' + row.id);
  }
}

// ---------- HTTP helpers ----------
function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}
const desktopOnly = (res, what) =>
  json(res, 400, { error: (what || 'This feature') + ' runs on the Janna AI desktop app (local PC) and is not available in the web version.' });

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString('utf-8');
  try { return JSON.parse(text || '{}'); } catch { return {}; }
}

// ---------- the run stream (canonical schema v1, same as desktop) ----------
const activeRuns = new Map();

async function handleRun(req, res) {
  const body = await readBody(req);
  const sessionId = String(body.session_id || 'web-session');
  const prompt = String(body.prompt || '').trim();
  const rows = catalog();
  const row = rows.find((r) => r.id === body.model) || rows[0];
  const runId = 'run-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  let seq = 0;
  let stopped = false;
  let stopResolve = null;
  let resEnded = false;
  let fullText = '';
  let thinkTimer = null;
  const stopWait = new Promise((r) => { stopResolve = r; });
  // Ending the response cannot wait for the provider: an async generator's
  // return() only lands after its pending await settles, so a stop during a
  // slow upstream call must close the stream directly from here.
  const finishStopped = () => {
    if (resEnded) return;
    stopped = true;
    try { emit({ type: 'done', text: fullText, model_used: row.id, run_state: 'stopped', metrics: {} }); } catch { /* closed */ }
    resEnded = true;
    if (thinkTimer) clearTimeout(thinkTimer);
    clearInterval(keepalive);
    try { res.end(); } catch { /* closed */ }
    if (stopResolve) stopResolve();
  };
  activeRuns.set(runId, { requestStop() { finishStopped(); } });

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const emit = (payload) => {
    if (resEnded) return;
    seq += 1;
    const event = { schema_version: 1, session_id: sessionId, run_id: runId, seq, event_id: runId + ':' + seq, payload };
    res.write('id: ' + event.event_id + '\ndata: ' + JSON.stringify(event) + '\n\n');
  };
  const keepalive = setInterval(() => { try { res.write(': keepalive\n\n'); } catch { /* closed */ } }, 5000);

  try {
    emit({ type: 'start', mode: 'chat' });
    if (body.mode === 'agent')
      emit({ type: 'notice', message: 'Work mode (project files and coding tools) runs in the desktop app. Answering here in chat mode.' });
    if (!prompt) throw new Error('Message is empty.');

    const history = Array.isArray(body.messages) ? body.messages : [];
    const messages = [{ role: 'system', content: body.companion === 'luna' ? LUNA_PROMPT : SYSTEM_PROMPT }];
    for (const m of history.slice(-20)) {
      if (m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content)
        messages.push({ role: m.role, content: m.content.slice(0, 24000) });
    }
    let userContent = prompt;
    for (const a of Array.isArray(body.attachments) ? body.attachments : []) {
      if (a && a.text) userContent += '\n\n[Attached file: ' + String(a.name || 'file') + ']\n' + String(a.text).slice(0, 12000);
      else if (a && a.kind === 'image') userContent += '\n\n[An image was attached, but this web model cannot view images.]';
    }
    messages.push({ role: 'user', content: userContent });
    const awareBlock = buildAwareness(body, row);
    if (awareBlock) messages[0].content += '\n\n' + awareBlock;

    const chainT = ' ' + String(body.prompt || '').toLowerCase() + ' ';
    const chain = /```/.test(String(body.prompt || '')) || /\b(code|function|bug|error|debug|script|python|javascript|typescript|html|css|compile|syntax)\b/.test(chainT)
      ? ['Reading your code', 'Working on the solution', 'Writing the answer']
      : /\d/.test(chainT) && /(\+|-|\*|\/|%|percent|plus|minus|times|divided|solve|calculate|compute|area|perimeter|how much|how many|total|sum|average)/.test(chainT)
      ? ['Analyzing the problem', 'Working through the steps', 'Writing the answer']
      : /\bvs\b|versus|compare|comparison|difference between|which is better|alin ang mas/.test(chainT)
      ? ['Comparing the options', 'Weighing the trade-offs', 'Writing the answer']
      : /\b(plan|plano|itinerary|schedule|routine|essay|story|poem|write a)\b/.test(chainT)
      ? ['Planning the outline', 'Organizing the details', 'Writing the answer']
      : ['Analyzing your question', 'Thinking through the problem', 'Writing the answer'];
    emit({ type: 'progress', stage: 'analysis', message: chain[0] });
    thinkTimer = setTimeout(() => { if (!resEnded && !stopped) emit({ type: 'progress', stage: 'thinking', message: chain[1] }); }, 2500);
    let full = '';
    let firstAt = 0;
    const started = Date.now();
    const streamIt = providerStream(row, messages)[Symbol.asyncIterator]();
    while (true) {
      const step = await Promise.race([streamIt.next(), stopWait.then(() => ({ stopped: true }))]);
      if (stopped || step.stopped || step.done) { try { await streamIt.return(); } catch { /* already closed */ } break; }
      const chunk = step.value;
      if (!firstAt) { firstAt = Date.now(); if (thinkTimer) { clearTimeout(thinkTimer); thinkTimer = null; } emit({ type: 'first_token', milliseconds: firstAt - started }); emit({ type: 'progress', stage: 'writing', message: chain[2] }); }
      full += chunk;
      fullText = full;
      emit({ type: 'delta', text: chunk });
    }
    if (stopped) return; // finishStopped already closed the stream
    if (!full.trim()) throw new Error('The model returned an empty answer. Try again.');
    const seconds = Math.max(0.001, (Date.now() - started) / 1000);
    emit({
      type: 'done', text: full, model_used: row.id, run_state: 'completed',
      metrics: { tokens_per_second: Math.max(1, Math.round(full.split(/\s+/).length / seconds)), time_to_first_token_ms: firstAt ? firstAt - started : null },
    });
  } catch (e) {
    emit({ type: 'error', message: String(e && e.message || e || 'Run failed') });
  } finally {
    activeRuns.delete(runId);
    if (thinkTimer) clearTimeout(thinkTimer);
    clearInterval(keepalive);
    if (!resEnded) { resEnded = true; try { res.end(); } catch { /* closed */ } }
  }
}

// ---------- main handler ----------
export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  const method = req.method || 'GET';
  const rows = catalog();

  try {
    if (method === 'GET' && path === '/api/bootstrap') {
      return json(res, 200, {
        token: 'web', version: APP_VERSION, projects: [], active_project: null,
        sessions: [], models: rows.map((r) => r.id), model_catalog: rows,
        library: [], cline_installed: false,
        languages: [{ id: 'auto', name: 'Automatic', english: 'Automatic', speech: '', dir: 'ltr', chrome: 'english' },
                    { id: 'en', name: 'English', english: 'English', speech: 'en', dir: 'ltr', chrome: 'full' }],
        pro: null, agentInstalled: false, busy: [], settings: { ...DEFAULT_SETTINGS },
        remote: false, profile: { id: 'web-guest', label: 'Guest workspace', kind: 'guest' }, research_connectors: {},
      });
    }
    if (method === 'GET' && path === '/api/remote-info')
      return json(res, 200, { remote: false, pair_required: false, remote_enabled: false });
    if (method === 'GET' && path === '/api/status')
      return json(res, 200, { ollama: true, models: rows.map((r) => r.id), openCode: false, busy: [], gpu: null, gpu_scheduler: null });
    if (method === 'GET' && path === '/api/models')
      return json(res, 200, { models: rows.map((r) => r.id), model_catalog: rows, pro: null });
    if (method === 'GET' && path.startsWith('/api/reasoning/'))
      return json(res, 200, { verified: false, vision: false, levels: ['default'] });
    if (method === 'GET' && path === '/api/luna')
      return json(res, 200, { name: 'Luna', model: 'Janna Cloud', members: LUNA_MEMBERS, selected: 'luna', unread: [], busy_sessions: [], notifications: [], goals: [], tasks: [] });
    if (method === 'GET' && path.startsWith('/api/luna/avatar/')) {
      const id = path.split('/').pop();
      const member = LUNA_MEMBERS.find((m) => m.id === id) || LUNA_MEMBERS[0];
      return json(res, 200, { src: member.avatar });
    }
    if (method === 'GET' && path === '/api/connections')
      return json(res, 200, { github: { connected: false, status: 'Not connected in the web version' }, figma: { connected: false, status: 'Not connected in the web version' } });
    if (method === 'GET' && path === '/api/host/readiness')
      return json(res, 200, { web: true, ready: true, checks: [] });
    if (method === 'GET' && path === '/api/research/providers')
      return json(res, 200, {});
    if (method === 'GET' && path === '/api/profile')
      return json(res, 200, { profile: { id: 'web-guest', label: 'Guest workspace', kind: 'guest' }, discord_available: false, redirect_uri: '' });
    if (method === 'POST' && path === '/api/run') return await handleRun(req, res);
    if (method === 'POST' && path === '/api/luna/select') return json(res, 200, { ok: true });
    if (method === 'POST' && path === '/api/stop') {
      const b = await readBody(req);
      const active = activeRuns.get(String(b.run_id || ''));
      if (active) { active.requestStop(); return json(res, 200, { stop_requested: true, message: 'Stop requested. The current run is ending.' }); }
      return json(res, 200, { stop_requested: false, message: 'That run already finished.' });
    }

    if (path.startsWith('/api/')) return desktopOnly(res, 'This feature');
    return json(res, 404, { error: 'Not found' });
  } catch (e) {
    return json(res, 500, { error: 'Web service error: ' + String(e && e.message || e) });
  }
}
