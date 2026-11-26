'use strict';
/* Janna AI — Grok-style shell, v68 fresh rebuild (2026-11-26).
   Reuses the existing API contract exactly: /api/bootstrap, /api/models,
   /api/run (SSE via JannaRuns), /api/sessions*, /api/settings, /api/stop,
   /api/profile/export, /api/memory. (Vision comes from the /api/models
   catalog, not /api/reasoning/:model — that route 404s live.)
   The backend api/[...slug].js is unchanged.
   v68 (grok-spec.md §14, review #3): no persistent "Thought for" line and
   no message queue — the live header is just "Thinking" + "Planning next
   moves"; the running composer keeps "Ask anything..." with a black square
   Stop; automation "Add" creates immediately like Grok's; example projects
   and Connect Apps use the full descriptions observed on grok.com.
   No Luna anywhere in this file. No fake Grok data: every control below has
   a real handler, and anything the web backend cannot do is omitted. */
const $ = id => document.getElementById(id);
const state = {
  token: '', remote: false, projects: [], sessions: [], session: null,
  models: [], modelCatalog: [], model: '', modelVision: false, booted: false,
  modelsKnown: false, bootFailed: false,
  settings: {}, languages: [], busy: false, busySessions: [], runId: null,
  stopRequested: false, stream: '', events: [],
  pending: [], isPrivate: false, privateThread: [],
  armedMode: null, armedBeforeResearch: 'auto', showAllChats: false,
  projectFilter: null, localProjects: [], chatProjects: {}, library: [], customSkills: [], unread: {},
  voiceRecognizer: null, voiceListening: false, paletteTab: 'All',
  libraryTab: 'All', libraryQuery: '', librarySort: 'date', rightPaneCode: null, rightPaneName: '',
};
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const button = (text, click, kind = 'text-btn') => { const b = el('button', kind, text); b.type = 'button'; b.onclick = click; return b; };
const escapeHTML = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = (message, delay = 6000) => { const t = $('toast'); if (!t) return; t.textContent = message; t.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => t.hidden = true, delay); };
const fmtDur = s => { s = Math.max(1, Math.round(Number(s) || 0)); return s >= 60 ? Math.floor(s / 60) + 'm ' + (s % 60) + 's' : s + 's'; };
const timeAgo = ts => {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - (ts || 0));
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 86400 * 7) return Math.floor(s / 86400) + 'd ago';
  return new Date(ts * 1000).toLocaleDateString();
};
const uid = p => p + '-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/* ---------- local storage: projects, chat→project map, library, feedback ---------- */
function loadJSON(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v ?? fallback; } catch { return fallback; } }
function saveJSON(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* full/blocked: in-memory only */ } }

/* ---------- composer draft: typed-but-unsent text survives a refresh ----------
   Drafts are keyed by session ('new' when no chat is open, 'private' in
   private mode). Saved on input (debounced), restored when the chat opens,
   cleared the moment the message is sent. Attachments can't persist (File
   objects), so only the text is kept. */
const DRAFT_KEY = 'janna-web-draft-v1';
function draftSessionKey() { return state.isPrivate ? 'private' : (state.session ? state.session.id : 'new'); }
function saveDraftNow() {
  try {
    const drafts = loadJSON(DRAFT_KEY, {});
    const key = draftSessionKey();
    const v = $('prompt') ? $('prompt').value : '';
    if (v.trim()) drafts[key] = v; else delete drafts[key];
    saveJSON(DRAFT_KEY, drafts);
  } catch { /* ignore */ }
}
let draftTimer = null;
function saveDraftSoon() { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraftNow, 300); }
function restoreDraft() {
  try {
    const v = loadJSON(DRAFT_KEY, {})[draftSessionKey()] || '';
    const t = $('prompt');
    if (t && !t.value && v) { t.value = v; autoGrowPrompt(); syncSendState(); }
  } catch { /* ignore */ }
}
function clearDraft() { try { const d = loadJSON(DRAFT_KEY, {}); delete d[draftSessionKey()]; saveJSON(DRAFT_KEY, d); } catch { /* ignore */ } }

/* ---------- white top toast (Grok's mic-denied card) ----------
   The dark bottom toast stays for ordinary notices; permission denials get
   Grok's white top card with an X and auto-dismiss, optionally with an
   action button (e.g. a Settings link). */
function topToast(text, action) {
  const wrap = document.createElement('div');
  wrap.className = 'top-toast';
  wrap.setAttribute('role', 'status');
  const warn = el('span', 'top-toast-warn', '\u26a0\ufe0f');
  const body = el('span', 'top-toast-text', text);
  wrap.append(warn, body);
  if (action && action.label) {
    const b = el('button', 'top-toast-action', action.label);
    b.type = 'button';
    b.onclick = () => { wrap.remove(); action.onClick && action.onClick(); };
    wrap.append(b);
  }
  const x = el('button', 'top-toast-close', '\u2715');
  x.type = 'button'; x.setAttribute('aria-label', 'Dismiss');
  x.onclick = () => wrap.remove();
  wrap.append(x);
  document.body.append(wrap);
  setTimeout(() => wrap.remove(), 6000);
  return wrap;
}
state.localProjects = loadJSON('janna-web-projects-v1', []);
state.chatProjects = loadJSON('janna-web-chat-projects-v1', {});
state.savedAutomations = loadJSON('janna-web-automations-v1', []);
state.library = loadJSON('janna-web-library-v1', []);
state.customSkills = loadJSON('janna-web-skills-v1', []);
state.unread = loadJSON('janna-web-unread-v1', {});
const saveProjects = () => saveJSON('janna-web-projects-v1', state.localProjects);
const saveChatProjects = () => saveJSON('janna-web-chat-projects-v1', state.chatProjects);
const saveAutomations = () => saveJSON('janna-web-automations-v1', state.savedAutomations);
const saveLibrary = () => saveJSON('janna-web-library-v1', state.library);
const saveCustomSkills = () => saveJSON('janna-web-skills-v1', state.customSkills);
const saveUnread = () => saveJSON('janna-web-unread-v1', state.unread);

/* ---------- local message feedback (real, local-only) ----------
   The adapter exposes no feedback API, so thumbs up/down are stored in
   this browser, keyed by session + a hash of the message text. */
const feedbackStore = loadJSON('janna-web-msg-feedback-v1', {});
function feedbackKey(sessionId, content) { let h = 0; const s = String(sessionId || '') + '|' + String(content || ''); for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0; return 'm' + (h >>> 0).toString(36); }
function getFeedback(sessionId, content) { return feedbackStore[feedbackKey(sessionId, content)] || ''; }
function saveFeedback(sessionId, content, value) { const k = feedbackKey(sessionId, content); if (feedbackStore[k] === value) delete feedbackStore[k]; else feedbackStore[k] = value; saveJSON('janna-web-msg-feedback-v1', feedbackStore); }

/* ---------- API ---------- */
async function api(path, data = null) {
  const headers = { 'X-Janna-Token': state.token };
  const opt = { headers };
  if (data !== null) { opt.method = 'POST'; headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(data); }
  if (data === null) opt.signal = AbortSignal.timeout(15000);
  const r = await fetch(path, opt);
  let result = {};
  try { result = await r.json(); } catch { /* empty */ }
  if (!r.ok) { const error = new Error(result.error || `Request failed (${r.status})`); error.status = r.status; throw error; }
  return result;
}
function saveLocalToken() { if (state.remote && state.token) { try { localStorage.setItem('janna-pair-token', state.token); } catch { /* ignore */ } } }
async function persistSettings(partial) {
  try { const r = await api('/api/settings', partial); state.settings = r.settings; applyTheme(); return r.settings; }
  catch (e) { toast(e.message); return state.settings; }
}

/* ---------- generic dialog (never window.alert/confirm/prompt) ---------- */
function showDialog({ title = '', text = '', fields = [], okText = 'OK', cancelText = 'Cancel', danger = false, showCancel = true }) {
  return new Promise(resolve => {
    const overlay = $('appDialog'), titleEl = $('appDialogTitle'), textEl = $('appDialogText'),
      fieldsEl = $('appDialogFields'), okBtn = $('appDialogOk'), cancelBtn = $('appDialogCancel');
    titleEl.textContent = title; textEl.textContent = text; textEl.hidden = !text;
    fieldsEl.replaceChildren();
    const inputs = {};
    for (const f of fields) {
      if (f.type === 'textarea') {
        const ta = document.createElement('textarea'); ta.placeholder = f.placeholder || ''; ta.value = f.value || '';
        ta.setAttribute('aria-label', f.label || f.name); fieldsEl.append(ta); inputs[f.name] = ta;
      } else {
        const input = document.createElement('input'); input.type = f.type || 'text'; input.placeholder = f.placeholder || '';
        input.value = f.value || ''; input.setAttribute('aria-label', f.label || f.name); fieldsEl.append(input); inputs[f.name] = input;
      }
    }
    okBtn.textContent = okText; okBtn.classList.toggle('danger-btn', !!danger);
    cancelBtn.hidden = !showCancel; cancelBtn.textContent = cancelText;
    overlay.hidden = false;
    const first = fieldsEl.querySelector('input,textarea'); if (first) setTimeout(() => first.focus(), 40);
    const close = value => { overlay.hidden = true; okBtn.onclick = null; cancelBtn.onclick = null; overlay.onclick = null; resolve(value); };
    okBtn.onclick = () => { const out = {}; for (const k in inputs) out[k] = inputs[k].value; close(fields.length ? out : true); };
    cancelBtn.onclick = () => close(null);
    overlay.onclick = e => { if (e.target === overlay) close(null); };
  });
}
const confirmDialog = (title, text, okText = 'Delete') => showDialog({ title, text, okText, danger: true });

/* ---------- copy ---------- */
async function copyCodeText(value) {
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(value); return true; } } catch { /* fall through */ }
  const text = document.createElement('textarea'); text.value = value; text.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.append(text); text.focus(); text.select();
  try { return !!document.execCommand('copy'); } finally { text.remove(); }
}

/* ---------- Markdown (dependency-free, offline) + small built-in highlighter ---------- */
const codeByBody = new WeakMap();
const HIGHLIGHT_KEYWORDS = ['const','let','var','function','return','if','else','elif','for','while','do','switch','case','break','continue','class','extends','import','from','export','new','typeof','instanceof','in','of','try','catch','finally','throw','async','await','def','lambda','True','False','None','and','or','not','with','as','pass','raise','int','str','float','bool','void','public','private','protected','static','struct','enum','impl','fn','mut','pub','use','mod','match','echo','require','local','end','then','until','repeat','select','insert','update','delete','create','table','where','join','group','order','by','print'];
function highlightCode(code, lang) {
  const l = String(lang || '').toLowerCase();
  const slash = /^(js|javascript|ts|typescript|jsx|tsx|java|c|cpp|cs|csharp|go|rust|rs|php|swift|kotlin|css|scss|json|html|xml)$/.test(l);
  const hash = /^(py|python|sh|bash|shell|rb|ruby|yml|yaml|toml)$/.test(l);
  const html = /^(html|xml|svg)$/.test(l);
  const parts = [];
  if (html) parts.push('<!--[\\s\\S]*?-->');
  if (slash) parts.push('\\/\\/[^\\n]*', '\\/\\*[\\s\\S]*?\\*\\/');
  if (hash) parts.push('#[^\\n]*');
  if (!slash && !hash && !html) parts.push('\\/\\/[^\\n]*', '#[^\\n]*');
  parts.push('"(?:[^"\\\\\\n]|\\\\.)*"', "'(?:[^'\\\\\\n]|\\\\.)*'", '`(?:[^`\\\\]|\\\\.)*`');
  parts.push('\\b\\d[\\d_]*(?:\\.\\d+)?\\b');
  parts.push('[A-Za-z_$][\\w$]*(?=\\()');
  parts.push('\\b(?:' + HIGHLIGHT_KEYWORDS.join('|') + ')\\b');
  const re = new RegExp('(' + parts.join('|') + ')', 'g');
  let out = '', last = 0, m;
  const clsFor = tok => {
    if (/^(\/\/|\/\*|#|<!--)/.test(tok)) return 'tok-com';
    if (/^["'`]/.test(tok)) return 'tok-str';
    if (/^\d/.test(tok)) return 'tok-num';
    if (HIGHLIGHT_KEYWORDS.includes(tok)) return 'tok-kw';
    return 'tok-fn';
  };
  while ((m = re.exec(code))) {
    if (m.index > last) out += escapeHTML(code.slice(last, m.index));
    out += '<span class="' + clsFor(m[0]) + '">' + escapeHTML(m[0]) + '</span>';
    last = m.index + m[0].length;
  }
  if (last < code.length) out += escapeHTML(code.slice(last));
  return out;
}

/* ---------- Markdown rendering ---------- */
function codeFileName(lang) {
  const map = { js: 'script.js', javascript: 'script.js', ts: 'script.ts', typescript: 'script.ts', py: 'main.py', python: 'main.py', html: 'index.html', css: 'style.css', json: 'data.json', sh: 'script.sh', bash: 'script.sh', go: 'main.go', rs: 'main.rs', rust: 'main.rs', java: 'Main.java', c: 'main.c', cpp: 'main.cpp', cs: 'Program.cs', rb: 'main.rb', ruby: 'main.rb', php: 'index.php', sql: 'query.sql', xml: 'data.xml', yaml: 'config.yaml', yml: 'config.yaml', md: 'notes.md' };
  return map[String(lang || '').toLowerCase()] || ((lang || 'code') + '.txt');
}
function formatMarkdown(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0, buf = [];
  const flush = () => { if (buf.length) { blocks.push({ type: 'text', text: buf.join('\n') }); buf = []; } };
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^```(\S*)\s*$/);
    if (fence) {
      flush();
      const lang = fence[1] || '';
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) { code.push(lines[i]); i++; }
      const closed = i < lines.length;
      blocks.push({ type: 'code', lang, code: code.join('\n'), closed });
      i++;
      continue;
    }
    buf.push(line);
    i++;
  }
  flush();
  const html = blocks.map(b => {
    if (b.type === 'code') {
      const lang = b.lang || 'code';
      const logo = (lang || 'c').slice(0, 2).toUpperCase();
      const numbered = b.code.split('\n').map((_, n) => n + 1).join('\n');
      return `<div class="code-block"><div class="code-block-header"><span class="code-logo">${escapeHTML(logo)}</span><span class="code-language">${escapeHTML(lang)}</span><span class="code-block-actions"><button type="button" class="code-action" data-code-copy>Copy</button></span></div><div class="code-scroll"><div class="code-gutter" aria-hidden="true">${escapeHTML(numbered)}</div><pre><code>${highlightCode(b.code, lang)}</code></pre></div></div>`;
    }
    return inlineMarkdown(b.text);
  }).join('');
  return { html, blocks };
}
function inlineMarkdown(text) {
  const esc = escapeHTML(text);
  // Code spans are literal: pull them out first so link/bold/italic
  // replacements never run inside them, then restore them at the end.
  const codes = [];
  const withCode = esc.replace(/`([^`\n]+)`/g, (m, c) => {
    codes.push(c);
    return '\u0000' + (codes.length - 1) + '\u0000';
  });
  const withLinks = withCode.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (m, t, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`);
  const withBold = withLinks.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
  const withItalic = withBold.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');
  const restored = withItalic.replace(/\u0000(\d+)\u0000/g, (m, i) => `<code>${codes[+i]}</code>`);
  const paras = restored.split(/\n{2,}/).map(p => {
    const trimmed = p.trim();
    if (!trimmed) return '';
    const ls = trimmed.split('\n');
    const isList = ls.every(l => /^[-*]\s+/.test(l) || /^\d+[.)]\s+/.test(l));
    if (isList) {
      const items = ls.map(l => `<li>${l.replace(/^[-*]\s+/, '').replace(/^\d+[.)]\s+/, '')}</li>`).join('');
      return `<ul>${items}</ul>`;
    }
    if (/^#{1,3}\s+/.test(ls[0])) {
      const level = ls[0].match(/^#+/)[0].length;
      return `<h${level}>${ls[0].replace(/^#+\s+/, '')}</h${level}>` + (ls.length > 1 ? `<p>${ls.slice(1).join('<br>')}</p>` : '');
    }
    if (ls.length > 1 && ls.every(l => l.includes('|'))) {
      const rows = ls.filter(l => l.trim().startsWith('|'));
      const cells = r => r.split('|').filter(c => c.trim() !== '').map(c => c.trim());
      const head = cells(rows[0]);
      const bodyRows = rows.slice(1).filter(r => !/^[\s|:.-]+$/.test(r));
      const thead = `<tr>${head.map(c => `<th>${c}</th>`).join('')}</tr>`;
      const tbody = bodyRows.map(r => `<tr>${cells(r).map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
      return `<div class="md-table-wrap"><div class="md-table-head"><span>Table</span><button type="button" class="table-copy-btn" data-table-copy>Copy</button></div><div class="md-table-scroll"><table><thead>${thead}</thead><tbody>${tbody}</tbody></table></div></div>`;
    }
    return `<p>${ls.join('<br>')}</p>`;
  });
  return paras.filter(Boolean).join('');
}
function renderMarkdown(container, text) {
  if (!container) return;
  container.innerHTML = formatMarkdown(text || '').html;
  container.querySelectorAll('[data-code-copy]').forEach(btn => {
    btn.onclick = async () => {
      const pre = btn.closest('.code-block')?.querySelector('pre');
      const raw = pre ? pre.textContent : '';
      const ok = await copyCodeText(raw);
      btn.textContent = ok ? 'Copied' : 'Copy failed';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    };
  });
  container.querySelectorAll('[data-table-copy]').forEach(btn => {
    btn.onclick = async () => {
      const table = btn.closest('.md-table-wrap')?.querySelector('table');
      if (!table) return;
      const rows = [...table.querySelectorAll('tr')].map(tr => [...tr.querySelectorAll('th,td')].map(c => c.textContent).join('\t')).join('\n');
      const ok = await copyCodeText(rows);
      btn.textContent = ok ? 'Copied' : 'Copy failed';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    };
  });
  container.querySelectorAll('.code-block').forEach(block => {
    const code = block.querySelector('code');
    if (code) codeByBody.set(block, code.textContent);
  });
}

/* ---------- theme ---------- */
function applyTheme() {
  const mode = state.settings.appearance_mode || 'system';
  const custom = state.settings.custom_theme;
  let theme = 'light';
  if (mode === 'dark') theme = 'dark';
  else if (mode === 'light') theme = 'light';
  else if (custom) theme = custom;
  else if (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) theme = 'dark';
  document.body.dataset.theme = theme;
  document.body.classList.toggle('reduce-motion', state.settings.reduce_motion === true);
  document.body.classList.toggle('wrap-code', state.settings.wrap_code === true);
  if (typeof window.syncPhoneChrome === 'function') { try { window.syncPhoneChrome(); } catch { /* ignore */ } }
}

/* ---------- models ---------- */
const SHORT_MODEL_LABELS = { 'janna-cloud': 'Janna', 'apinex-gemini-3.8-flash': 'Gemini 3.8', 'apinex-gpt-6-luna': 'GPT-6 Luna', 'apinex-kimi-k3': 'Kimi K3', 'apinex-muse-spark-1.3': 'Muse Spark', 'apinex-deepseek-v4-flash': 'DeepSeek V4', 'apinex-deepseek-v4-pro': 'DeepSeek Pro', 'apinex-deepseek-v4.1-flash': 'DeepSeek 4.1', 'apinex-gemini-4-hydrogen': 'Gemini 4', 'apinex-glm-5.3': 'GLM 5.3', 'apinex-glm-5.3-flash': 'GLM Flash', 'apinex-hy4': 'HY4', 'apinex-hy4-flash': 'HY4 Flash', 'apinex-mimo-v2.6-pro': 'MiMo V2.6', 'apinex-minimax-m3.1-flash': 'MiniMax M3', 'apinex-qwen-3.8-max': 'Qwen 3.8' };
function modelLabel(id) {
  const row = state.modelCatalog.find(m => m.id === id);
  if (row) return row.label || row.name || id;
  return id;
}
function shortModelLabel(id) { return SHORT_MODEL_LABELS[id] || (modelLabel(id) || id).split(' ').slice(0, 2).join(' '); }
function syncModelPicker() {
  const label = $('modelPickerLabel');
  if (label) label.textContent = state.model ? shortModelLabel(state.model) : 'Choose a model';
}
function rememberModelChoice() {
  try { localStorage.setItem('janna-selected-model', state.model || ''); } catch { /* ignore */ }
}
async function refreshNativeLevels() {
  state.modelVision = false;
  if (!state.model) return;
  // Vision comes from the /api/models catalog (already loaded) — the old
  // /api/reasoning/:model call 404s live (Vercel only routes single-segment
  // /api paths to the catch-all), so it always reported "no vision" and
  // every image attach warned its pixels would not be sent.
  const row = state.modelCatalog.find(m => m.id === state.model);
  state.modelVision = !!(row && row.vision);
  renderPending();
}
function chooseModel(id) {
  if (!id || !state.models.includes(id)) return;
  state.model = id; rememberModelChoice(); syncModelPicker(); closeModelPicker(); refreshNativeLevels();
}
function closeModelPicker() { const p = $('modelPicker'); if (p) p.hidden = true; $('modelPickerBtn').setAttribute('aria-expanded', 'false'); }
function openModelPicker() {
  const p = $('modelPicker'), btn = $('modelPickerBtn');
  if (!p || !state.models.length) { toast('No models available yet.'); return; }
  if (!p.hidden) { closeModelPicker(); return; }
  closePlusMenu();
  p.replaceChildren();
  const head = el('div', 'model-picker-group', 'Models');
  p.append(head);
  for (const id of state.models) {
    const row = state.modelCatalog.find(m => m.id === id) || {};
    const item = el('button', 'model-picker-item');
    item.type = 'button';
    item.setAttribute('aria-checked', state.model === id ? 'true' : 'false');
    item.innerHTML = `<span class="radio"></span><span class="mp-texts"><strong>${escapeHTML(shortModelLabel(id))}</strong><small>${escapeHTML(row.label || row.name || id)}${row.vision ? ' · Vision' : ''}</small></span>${state.model === id ? '<span class="mp-check"><svg><use href="#i-check"/></svg></span>' : ''}`;
    item.onclick = () => chooseModel(id);
    p.append(item);
  }
  const foot = el('div', 'model-picker-foot');
  foot.innerHTML = `All models are <strong>free</strong> — no sign-in, no limits.`;
  p.append(foot);
  p.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
}

/* ---------- suggestion modes + rotating topics ---------- */
const MODES = {
  search: { label: 'Search the web', icon: 'globe', chip: 'Web search', placeholder: 'Search the web.',
    prompts: ['What\u2019s in the news today?', 'What\u2019s new in AI this week?', 'Find things to do this weekend', 'Compare the latest flagship phones', 'Get a morning brief every day', 'Get a daily AI news digest', 'Get a daily market report'], sendOnTap: true },
  apps: { label: 'Make a website', icon: 'spark', chip: 'Apps', placeholder: 'Describe what to build...',
    prompts: ['Landing page', 'Game', 'Kanban board', 'Revenue dashboard', 'Education', 'Portfolio site', 'Event page', 'Booking site'], sendOnTap: false, templatePrefix: 'Build a ' },
  writing: { label: 'Write or edit', icon: 'edit', chip: 'Writing', placeholder: 'Describe what to write...',
    prompts: ['Improve your X post', 'Help me write an email', 'Proofread my writing', 'Write a document'], sendOnTap: false },
  presentation: { label: 'Design a presentation', icon: 'book', chip: 'Presentation', placeholder: 'Describe your presentation...',
    prompts: ['Outline a presentation about a new product', 'Make slides for a school project', 'Create a pitch deck outline'], sendOnTap: false },
};
const MODE_ORDER = ['search', 'apps', 'writing', 'presentation'];
/* Topic prompts that rotate with the modes (Grok's pool, 2026-11-26
   review #3). Tapping one sends it as a question — except "Create an
   image", which pre-fills the composer like Grok's "imagine skill"
   (Janna cannot generate images, so nothing is sent). */
const TOPIC_SUGGESTIONS = [
  { label: 'Explore prime factorization techniques', icon: 'spark' },
  { label: 'Compare TypeScript and Python', icon: 'edit' },
  { label: 'Check email and calendar', icon: 'globe' },
  { label: 'Analyze COP31 fossil fuel debates', icon: 'globe' },
  { label: 'Check font size', icon: 'spark' },
  { label: 'Create an image', icon: 'image', prefill: 'Create an image of ' },
];
let suggestionRot = null;
function suggestRotation() {
  if (suggestionRot !== null) return suggestionRot;
  let rot = 0;
  try { rot = Number(localStorage.getItem('janna-suggest-rot-v1') || '0') || 0; localStorage.setItem('janna-suggest-rot-v1', String(rot + 1)); } catch { /* ignore */ }
  suggestionRot = rot;
  return rot;
}
/* Autocomplete (Grok): while typing on home, the 3 static suggestion
   rows are replaced by completion rows — typed part darker, remainder
   grey. Janna has no completion backend, so the honest equivalent is
   matching the local suggestion pool (topic prompts + mode prompts)
   against the typed text. Clearing restores the static rows. */
function renderAutocomplete() {
  const list = $('suggestList');
  if (!list || $('welcome').hidden) return;
  const q = $('prompt').value.trim().toLowerCase();
  if (state.isPrivate || state.armedMode || !q) { renderSuggestions(); return; }
  const pool = [];
  for (const t of TOPIC_SUGGESTIONS) pool.push({ label: t.label, icon: t.icon });
  for (const k of MODE_ORDER) for (const p of (MODES[k].prompts || [])) pool.push({ label: p, icon: MODES[k].icon });
  const hits = pool.filter(c => c.label.toLowerCase().includes(q)).slice(0, 3);
  if (!hits.length) { renderSuggestions(); return; }
  list.replaceChildren(); list.hidden = false;
  for (const h of hits) {
    const row = el('button', 'suggest-row');
    row.type = 'button';
    const i = h.label.toLowerCase().indexOf(q);
    const before = escapeHTML(h.label.slice(0, i));
    const match = escapeHTML(h.label.slice(i, i + q.length));
    const after = escapeHTML(h.label.slice(i + q.length));
    row.innerHTML = `<svg><use href="#i-${h.icon}"/></svg><span><span class="ac-rest">${before}</span><span class="ac-match">${match}</span><span class="ac-rest">${after}</span></span>`;
    row.onclick = () => { $('prompt').value = h.label; autoGrowPrompt(); syncSendState(); $('prompt').focus(); renderSuggestions(); };
    list.append(row);
  }
}
function renderSuggestions() {
  const list = $('suggestList');
  list.replaceChildren();
  if (state.isPrivate) { list.hidden = true; return; }
  list.hidden = false;
  if (state.settings.show_suggestions === false) { list.hidden = true; return; }
  if (!state.armedMode) {
    const rot = suggestRotation();
    // Grok rotates ALL THREE rows per load (review #3) from a pool of
    // modes and topic prompts — no slot is fixed.
    const pool = MODE_ORDER.map(k => ({ mode: k })).concat(TOPIC_SUGGESTIONS.map(t => ({ topic: t })));
    const picked = [];
    for (let n = 0; n < 3; n++) picked.push(pool[(rot * 3 + n) % pool.length]);
    for (const pick of picked) {
      const row = el('button', 'suggest-row');
      row.type = 'button';
      if (pick.mode) {
        const mode = MODES[pick.mode];
        row.innerHTML = `<svg><use href="#i-${mode.icon}"/></svg><span>${escapeHTML(mode.label)}</span>`;
        row.onclick = () => armMode(pick.mode);
      } else {
        const topic = pick.topic;
        row.innerHTML = `<svg><use href="#i-${topic.icon}"/></svg><span>${escapeHTML(topic.label)}</span>`;
        row.onclick = () => {
          if (topic.prefill) {
            $('prompt').value = topic.prefill;
            autoGrowPrompt(); syncSendState(); $('prompt').focus();
            return;
          }
          $('prompt').value = topic.label;
          autoGrowPrompt(); syncSendState();
          send();
        };
      }
      list.append(row);
    }
    return;
  }
  // Armed mode: show that mode's prompts instead of the rotating rows.
  const mode = MODES[state.armedMode];
  const back = el('button', 'suggest-row suggest-back');
  back.type = 'button';
  back.innerHTML = `<span>\u2039 ${escapeHTML(mode.label)}</span>`;
  back.onclick = () => disarmMode();
  list.append(back);
  for (const prompt of (mode.prompts || [])) {
    const row = el('button', 'suggest-row');
    row.type = 'button';
    row.innerHTML = `<svg><use href="#i-${mode.icon}"/></svg><span>${escapeHTML(prompt)}</span>`;
    row.onclick = () => {
      const text = (mode.templatePrefix || '') + prompt;
      $('prompt').value = text;
      autoGrowPrompt(); syncSendState();
      if (mode.sendOnTap) send();
      else $('prompt').focus();
    };
    list.append(row);
  }
}
function armMode(key) {
  if (!MODES[key]) return;
  state.armedMode = key;
  const chipRow = $('modeChipRow');
  chipRow.replaceChildren();
  const chip = el('button', 'mode-chip');
  chip.type = 'button';
  chip.innerHTML = `<span>${escapeHTML(MODES[key].chip)}</span><span class="chip-x">\u00d7</span>`;
  chip.onclick = () => disarmMode();
  chipRow.append(chip);
  chipRow.hidden = false;
  $('prompt').placeholder = MODES[key].placeholder;
  renderSuggestions();
  $('prompt').focus();
}
function disarmMode() {
  state.armedMode = null;
  $('modeChipRow').hidden = true;
  $('modeChipRow').replaceChildren();
  $('prompt').placeholder = 'Ask anything\u2026';
  renderSuggestions();
}
function styleDirective() {
  const v = state.settings.response_style;
  if (!v || v === 'default') return '';
  return v;
}
function stripStyleDirective(text) {
  return String(text || '').replace(/\n\n\[Response style: [^\]]+\]$/, '');
}

/* ---------- thinking display, v68 (grok-spec §14, review #3) ----------
   The LIVE header only: "Thinking" + the single step "Planning next
   moves" with a dotted spinner. No timer, no seconds, no step rotation,
   no invented steps — and NO persistent "Thought for Xs" line after the
   reply (Grok shows none on Fast replies in all three fresh probes).
   first_token removes the header; the run's completion removes it too. */
const think = { el: null };
function thinkingEl() {
  if (think.el) return think.el;
  const wrap = $('messages'); if (!wrap) return null;
  const item = el('div', 'thinking');
  const head = el('div', 'thinking-head');
  head.innerHTML = '<span class="think-spinner"></span><span class="think-title">Thinking</span>';
  const body = el('div', 'think-body');
  const steps = el('ul', 'think-steps');
  steps.append(el('li', 'is-current', 'Planning next moves'));
  body.append(steps);
  item.append(head, body);
  wrap.appendChild(item);
  think.el = item;
  return item;
}
function startThinking() {
  const item = thinkingEl();
  if (!item) return;
  item.hidden = false;
  scrollThreadToBottom();
}
function stopThinking() {
  if (think.el) { think.el.remove(); think.el = null; }
}
function scrollThreadToBottom() {
  const thread = $('thread');
  if (thread) thread.scrollTop = thread.scrollHeight;
}
function scrollToBottomIfNear() {
  const thread = $('thread');
  if (!thread) return;
  if (thread.scrollHeight - thread.scrollTop - thread.clientHeight < 220) thread.scrollTop = thread.scrollHeight;
}

/* ---------- messages ---------- */
function createMessageNode(message, session) {
  const role = message.role || 'user';
  const item = el('div', 'message ' + (role === 'assistant' ? 'assistant' : 'user'));
  if (role === 'user') {
    const content = stripStyleDirective(currentVersionText(message));
    const bubble = el('div', 'user-bubble');
    bubble.append(document.createTextNode(content));
    if (message.kind === 'image' && message.data) { const img = document.createElement('img'); img.src = 'data:image/jpeg;base64,' + message.data; img.alt = ''; img.className = 'attachment-preview'; bubble.append(img); }
    if (message.kind === 'log') bubble.append(el('div', 'muted', (message.name || 'log') + ' \u00b7 ' + (message.content || '').length + ' characters'));
    if (Array.isArray(message.attached)) for (const a of message.attached) bubble.append(el('div', 'muted', (a.kind === 'image' ? 'Image' : 'File') + ': ' + (a.name || 'file')));
    // Grok: Edit/Copy are hidden until you tap the bubble, then icon-only
    // buttons appear to the LEFT of the bubble on the same baseline.
    // A branched copy (grok's Branch) has Copy only, no Edit.
    const row = el('div', 'user-row');
    const uActions = el('div', 'message-actions user-actions');
    if (!message.branched) {
      const uEdit = button('Edit', () => { if (!state.busy) { item.classList.remove('show-user-actions'); startEdit(item, message, session); } });
      uEdit.classList.add('message-action'); uEdit.innerHTML = '<svg><use href="#i-edit"/></svg>'; uEdit.title = 'Edit';
      uActions.append(uEdit);
    }
    const uCopy = button('Copy', async () => { item.classList.remove('show-user-actions'); toast((await copyCodeText(currentVersionText(message))) ? 'Copied' : 'Copy failed'); });
    uCopy.classList.add('message-action'); uCopy.innerHTML = '<svg><use href="#i-copy"/></svg>'; uCopy.title = 'Copy';
    uActions.append(uCopy);
    row.append(uActions, bubble);
    item.append(row);
    bubble.onclick = () => {
      if (state.busy) return;
      document.querySelectorAll('.message.user.show-user-actions').forEach(n => { if (n !== item) n.classList.remove('show-user-actions'); });
      item.classList.toggle('show-user-actions');
    };
    if (Array.isArray(message.versions) && message.versions.length > 1) {
      const pager = el('div', 'version-pager');
      const prev = button('\u2039', () => switchVersion(message, session, (message.version || 0) - 1));
      const label = el('span', '', ((message.version || 0) + 1) + ' / ' + message.versions.length);
      const next = button('\u203a', () => switchVersion(message, session, (message.version || 0) + 1));
      prev.disabled = (message.version || 0) <= 0;
      next.disabled = (message.version || 0) >= message.versions.length - 1;
      pager.append(prev, label, next);
      item.append(pager);
    }
  } else {
    const content = el('div', 'message-body');
    item.append(content);
    renderMarkdown(content, message.content || '');
    const feedback = getFeedback(session?.id, message.content || '');
    const actions = el('div', 'message-actions');
    const copyBtn = button('Copy', async () => { toast((await copyCodeText(message.content || '')) ? 'Copied' : 'Copy failed'); });
    copyBtn.classList.add('message-action'); copyBtn.innerHTML = '<svg><use href="#i-copy"/></svg>'; copyBtn.title = 'Copy';
    const like = button('Like', () => { saveFeedback(session?.id, message.content || '', 'up'); like.classList.toggle('voted', getFeedback(session?.id, message.content || '') === 'up'); dislike.classList.remove('voted'); toast('Thanks for the feedback'); });
    like.classList.add('message-action'); like.innerHTML = '<svg><use href="#i-thumb-up"/></svg>'; like.title = 'Like';
    const dislike = button('Dislike', () => { saveFeedback(session?.id, message.content || '', 'down'); dislike.classList.toggle('voted', getFeedback(session?.id, message.content || '') === 'down'); like.classList.remove('voted'); toast('Thanks for the feedback'); });
    dislike.classList.add('message-action'); dislike.innerHTML = '<svg><use href="#i-thumb-down"/></svg>'; dislike.title = 'Dislike';
    const more = button('More', () => openMessageMenu(message, session, more));
    more.classList.add('message-action'); more.innerHTML = '<svg><use href="#i-dots"/></svg>'; more.title = 'More actions';
    actions.append(copyBtn, like, dislike, more);
    // Grok's branched copy has no assistant action bar.
    if (!message.branched) item.append(actions);
    // A reply cut short by a refresh keeps its partial text, marked as
    // interrupted — it is never silently presented as finished.
    if (message.pending) item.append(el('div', 'muted interrupted-note', 'Interrupted \u2014 this reply stopped here. Send a follow-up to continue.'));
    if (feedback === 'up') like.classList.add('voted');
    if (feedback === 'down') dislike.classList.add('voted');
  }
  return item;
}
/* ---------- message versions: Grok-style inline edit ---------- */
function currentVersionText(msg) {
  if (Array.isArray(msg.versions) && msg.versions.length) {
    const i = Math.max(0, Math.min(msg.version || 0, msg.versions.length - 1));
    return msg.versions[i].text;
  }
  return msg.content || '';
}
function messageAttachments(message) {
  if (message.kind === 'image' && message.data) return [{ kind: 'image', name: message.name || 'image', data: message.data }];
  if (message.kind === 'log') return [{ kind: 'log', name: message.name || 'log', text: message.content || '' }];
  if (Array.isArray(message.attached)) return message.attached.map(a => ({ kind: a.kind, name: a.name }));
  return [];
}
function autoGrowEdit(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 240) + 'px'; }
function startEdit(item, message, session) {
  if (state.busy) { toast('Finish the current answer first.'); return; }
  if (item.querySelector('.edit-area')) return;
  const bubble = item.querySelector('.user-bubble');
  if (!bubble) return;
  bubble.hidden = true;
  const area = el('div', 'edit-area');
  const ta = document.createElement('textarea');
  ta.value = currentVersionText(message);
  ta.setAttribute('aria-label', 'Edit message');
  ta.oninput = () => autoGrowEdit(ta);
  const actions = el('div', 'edit-actions');
  const cancel = el('button', 'edit-pill', 'Cancel');
  cancel.type = 'button';
  cancel.onclick = () => finishEdit(item, message, session, null);
  const sendBtn = el('button', 'edit-pill edit-send', 'Send');
  sendBtn.type = 'button';
  sendBtn.onclick = () => finishEdit(item, message, session, ta.value);
  actions.append(cancel, sendBtn);
  area.append(ta, actions);
  item.append(area);
  autoGrowEdit(ta);
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}
async function finishEdit(item, message, session, newText) {
  const area = item.querySelector('.edit-area');
  if (area) area.remove();
  const bubble = item.querySelector('.user-bubble');
  if (bubble) bubble.hidden = false;
  if (newText === null) return;
  const text = String(newText || '').trim();
  if (!text || text === currentVersionText(message)) return;
  if (!session || state.isPrivate) {
    // Private threads have no stored session: re-run in place.
    const idx = state.privateThread.indexOf(message);
    if (idx >= 0) {
      state.privateThread = state.privateThread.slice(0, idx);
      const sentText = text + (styleDirective() ? '\n\n[Response style: ' + styleDirective() + ']' : '');
      const userMsg = { role: 'user', content: sentText, ts: Date.now() };
      state.privateThread.push(userMsg);
      renderConversation({ id: 'private', title: 'Private chat', messages: state.privateThread });
      const history = state.privateThread.slice(0, -1).map(m => ({ role: m.role, content: stripStyleDirective(m.content || '') }));
      await streamRunPrivate(sentText, history, []);
    }
    return;
  }
  const messages = session.messages || [];
  const index = messages.indexOf(message);
  if (index < 0) return;
  // Grok's < n / n > flow (restored from v67 — the v68 rewrite dropped
  // it, so an edit re-ran but the bubble kept showing the old text):
  // v1 is the original text + the reply that followed it; the edit
  // becomes the next version; everything after is replaced by the new
  // answer.
  if (!Array.isArray(message.versions)) {
    const next = messages[index + 1];
    message.versions = [{ text: message.content || '', response: (next && next.role === 'assistant') ? next : null }];
    message.version = 0;
  }
  message.versions.push({ text, response: null });
  message.version = message.versions.length - 1;
  message.content = text;
  messages.splice(index + 1);
  renderConversation(session);
  const sentText = text + (styleDirective() ? '\n\n[Response style: ' + styleDirective() + ']' : '');
  const history = messages.slice(0, index).map(m => ({ role: m.role, content: stripStyleDirective(m.content || '') }));
  await runStream(session, sentText, history, [], false, { index, msg: message });
}
function switchVersion(message, session, next) {
  if (!Array.isArray(message.versions)) return;
  const i = Math.max(0, Math.min(next, message.versions.length - 1));
  message.version = i;
  message.content = message.versions[i].text;
  const messages = session?.messages || [];
  const idx = messages.indexOf(message);
  if (idx >= 0) {
    const resp = message.versions[i].response;
    if (resp) messages[idx + 1] = resp;
    else messages.splice(idx + 1, 1);
  }
  if (session) {
    api('/api/sessions/update', { session_id: session.id, messages: session.messages }).catch(() => { /* line still shows locally */ });
    renderConversation(session);
  }
}
function branchMessage(message, session) {
  if (!session) return;
  const messages = session.messages || [];
  const idx = messages.indexOf(message);
  if (idx < 0) return;
  // Grok's Branch: an unsaved stripped copy at grok.com/ whose top-bar
  // pill is the question. Here the branch is a real session titled with
  // the question, marked branched (no assistant action bar, user toolbar
  // Copy-only), with the messages up to and including this one.
  const clone = messages.slice(0, idx + 1).map(m => {
    const c = { ...m };
    if (c.role === 'assistant') c.branched = true;
    if (c.role === 'user') c.branched = true;
    return c;
  });
  // The title is the QUESTION (the user message just before this reply),
  // not the reply text — grok's branched thread pill shows the question.
  // (v68 took messages[idx], the reply itself, so a branch of "Hi" was
  // titled with the answer instead of "Hi".)
  let uIdx = -1;
  for (let i = idx - 1; i >= 0; i--) if (messages[i].role === 'user') { uIdx = i; break; }
  const question = (uIdx >= 0 ? stripStyleDirective(currentVersionText(messages[uIdx])) : '') || 'Branched chat';
  newSession({ title: question.slice(0, 120), messages: clone, branched: true }).then(s => {
    if (s) { toast('Branched into a new chat'); }
  });
}
/* ---------- message "more" menu (Grok's exact list) ---------- */
function openMessageMenu(message, session, anchor) {
  const items = [
    { label: 'Branch in new chat', icon: 'i-chat', onClick: () => branchMessage(message, session) },
    { label: 'Share', icon: 'i-share', onClick: () => shareConversation(session) },
    { label: 'Read aloud', icon: 'i-play', onClick: () => readAloud(message) },
    { label: 'Export to PDF', icon: 'i-printer', onClick: () => exportPdf(session) },
    { label: 'Report message', icon: 'i-feedback', onClick: () => openFeedback(message, 'report') },
  ];
  const at = messageAt(message, session);
  showMenu(anchor, items, at ? { header: at } : {});
}
function messageAt(message, session) {
  // Grok's More sheet header is the message timestamp ("Yesterday 2:41 AM").
  const ts = message && message.ts;
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const startOf = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const day = startOf(d), today = startOf(now), yesterday = today - 86400000;
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const time = h + ':' + m + ' ' + ap;
  if (day === today) return 'Today ' + time;
  if (day === yesterday) return 'Yesterday ' + time;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() + ' ' + time;
}
function shareConversation(session) {
  if (!session) { toast('Nothing to share yet.'); return; }
  const md = (session.messages || []).map(m => (m.role === 'user' ? 'You: ' : 'Janna: ') + stripStyleDirective(currentVersionText(m))).join('\n\n');
  copyCodeText(md).then(ok => toast(ok ? 'Copied conversation as text. Shared links are not available in the web version.' : 'Copy failed'));
}
function exportPdf(session) {
  toast('Generating PDF\u2026');
  setTimeout(() => window.print(), 300);
}
function readAloud(message) {
  const bar = $('readAloudBar');
  if (!bar) return;
  bar.hidden = false;
  readAloudState.text = message.content || '';
  readAloudState.idx = 0;
  voiceSpeak(readAloudState.text);
}
const readAloudState = { text: '', idx: 0, voice: 'Ara', rate: 1 };
function hideReadAloudBar() {
  const bar = $('readAloudBar');
  if (bar) bar.hidden = true;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}
/* ---------- follow-up pills (Grok): two next questions under the reply,
   generated by a background model call. Ephemeral — they are NOT persisted
   (v62), because Grok regenerates them per reply. ---------- */
async function generateFollowUps(session, assistantMsg) {
  if (!session || state.settings.show_suggestions === false) return;
  if (state.isPrivate) return;
  const wrap = $('followUps');
  if (!wrap) return;
  wrap.hidden = true;
  wrap.replaceChildren();
  const prompt = 'Based on this conversation, suggest exactly two short follow-up questions the user might ask next. One per line, no numbering, no quotes.\n\nConversation:\n' + (session.messages || []).slice(-6).map(m => (m.role === 'user' ? 'User: ' : 'Janna: ') + stripStyleDirective(m.content || '')).join('\n');
  let text = '';
  try {
    const body = { session_id: session.id, model: state.model, prompt, background: true, messages: [] };
    for await (const ev of JannaRuns.subscribe(body, state.token)) {
      if (ev.type === 'delta') text += ev.text || '';
      else if (ev.type === 'done') text = ev.text || text;
    }
  } catch { return; }
  const lines = text.split('\n').map(l => l.trim().replace(/^[-*•\d.)\s]+/, '')).filter(l => l.length > 2 && l.length < 90).slice(0, 2);
  if (!lines.length) return;
  // Only show pills for the latest reply — a slow background call must
  // not attach pills to a conversation the user already left.
  if (!state.session || state.session.id !== session.id) return;
  wrap.replaceChildren();
  lines.forEach((line, i) => {
    const chip = el('button', 'follow-chip' + (i === 0 ? ' primary' : ''));
    chip.type = 'button';
    chip.innerHTML = `<span class="follow-play">\u25b6</span><span>${escapeHTML(line)}</span>`;
    chip.onclick = () => { $('prompt').value = line; autoGrowPrompt(); syncSendState(); send(); };
    wrap.append(chip);
  });
  wrap.hidden = false;
}
/* ---------- conversation rendering + top bar ---------- */
function findSession(id) { return state.sessions.find(s => s.id === id) || (state.session && state.session.id === id ? state.session : null); }
function renderConversation(session) {
  const messagesEl = $('messages');
  const welcomeEl = $('welcome');
  const dock = $('composerDock');
  const composer = $('composer');
  const isHome = !session || !(session.messages || []).length;
  if (isHome) {
    welcomeEl.hidden = false;
    messagesEl.hidden = true;
    messagesEl.replaceChildren();
    dock.hidden = true;
    $('welcomeComposerSlot').append(composer);
    $('aiDisclaimer').hidden = false;
    $('followUps').hidden = true;
    hideReadAloudBar();
  } else {
    welcomeEl.hidden = true;
    messagesEl.hidden = false;
    messagesEl.replaceChildren();
    dock.hidden = false;
    $('composerHome').append(composer);
    $('aiDisclaimer').hidden = true;
    for (const m of (session.messages || [])) messagesEl.append(createMessageNode(m, session));
    scrollThreadToBottom();
  }
  syncTopbar(session);
  syncPrivate();
}
function syncTopbar(session) {
  const homeCentre = $('homeCentre');
  const pill = $('threadTitlePill');
  const inThread = session && (session.messages || []).length > 0;
  if (inThread) {
    homeCentre.hidden = true;
    pill.hidden = false;
    $('threadTitle').textContent = session.title || 'New chat';
  } else {
    homeCentre.hidden = false;
    pill.hidden = true;
  }
}
function syncPrivate() {
  const h1 = $('welcomeH1');
  const note = $('privateNote');
  const composer = $('composer');
  const toggle = $('privateToggle');
  toggle.setAttribute('aria-pressed', state.isPrivate ? 'true' : 'false');
  composer.classList.toggle('private-mode', state.isPrivate);
  if (state.isPrivate) {
    h1.textContent = "What's on your mind today?";
    note.hidden = false;
  } else {
    h1.textContent = "What's on the agenda today?";
    note.hidden = true;
  }
  renderSuggestions();
}

/* ---------- sidebar / sessions ---------- */
function sessionTitle(s) { return s.title || 'New chat'; }
function renderSidebar() {
  const list = $('sessionList');
  list.replaceChildren();
  const visible = state.sessions.filter(s => !s.archived);
  const pinned = visible.filter(s => s.pinned);
  const rest = visible.filter(s => !s.pinned);
  const ordered = [...pinned, ...rest];
  const shown = state.showAllChats ? ordered : ordered.slice(0, 6);
  for (const s of shown) {
    const row = el('div', 'side-row' + (state.session && state.session.id === s.id ? ' active' : '') + (state.unread[s.id] ? ' unread' : ''));
    const label = el('button', 'side-row-label', sessionTitle(s));
    label.type = 'button';
    label.title = sessionTitle(s);
    label.onclick = () => openSession(s.id);
    const menu = el('button', 'side-row-menu');
    menu.type = 'button';
    menu.innerHTML = '<svg><use href="#i-dots"/></svg>';
    menu.title = 'Conversation options';
    menu.setAttribute('aria-label', 'Conversation options');
    menu.onclick = e => { e.stopPropagation(); openRowMenu(s, menu); };
    row.append(label, menu);
    list.append(row);
  }
  const more = $('showMoreChats');
  more.hidden = ordered.length <= 6;
  if (!more.hidden) more.textContent = state.showAllChats ? 'Show less' : 'Show more';
  renderProjects();
}
function renderProjects() {
  const list = $('projectList');
  if (!list) return;
  list.replaceChildren();
  for (const p of state.localProjects) {
    const row = el('div', 'side-row' + (state.projectFilter === p.id ? ' active' : ''));
    const icon = el('span', 'side-row-icon');
    icon.innerHTML = projectIconSvg(p);
    const label = el('button', 'side-row-label' + (state.projectFilter === p.id ? ' project-filter' : ''), p.name || 'Untitled Project');
    label.type = 'button';
    label.onclick = () => {
      state.projectFilter = state.projectFilter === p.id ? null : p.id;
      renderSidebar();
    };
    row.append(icon, label);
    list.append(row);
  }
}
function openRowMenu(session, anchor) {
  const items = [
    { label: session.pinned ? 'Unpin' : 'Pin', icon: 'i-pin', onClick: () => pinChat(session) },
    { label: 'Rename', icon: 'i-edit', onClick: () => renameChat(session) },
    { label: state.unread[session.id] ? 'Mark as Read' : 'Mark as Unread', icon: 'i-chat', onClick: () => toggleUnread(session) },
    { label: 'Archive', icon: 'i-archive', onClick: () => archiveChat(session) },
    { label: 'Delete', icon: 'i-trash', danger: true, onClick: () => deleteChat(session) },
  ];
  showMenu(anchor, items);
}
async function pinChat(session) {
  try {
    await api('/api/sessions/update', { session_id: session.id, pinned: !session.pinned });
    session.pinned = !session.pinned;
    renderSidebar();
  } catch (e) { toast(e.message); }
}
async function renameChat(session) {
  const res = await showDialog({ title: 'Rename chat', fields: [{ name: 'title', value: sessionTitle(session) }], okText: 'Save' });
  if (!res || !String(res.title || '').trim()) return;
  try {
    await api('/api/sessions/update', { session_id: session.id, title: String(res.title).trim() });
    session.title = String(res.title).trim();
    renderSidebar();
    if (state.session && state.session.id === session.id) $('threadTitle').textContent = session.title;
  } catch (e) { toast(e.message); }
}
function toggleUnread(session) {
  if (state.unread[session.id]) delete state.unread[session.id];
  else state.unread[session.id] = Date.now();
  saveUnread();
  renderSidebar();
}
async function archiveChat(session) {
  try {
    await api('/api/sessions/update', { session_id: session.id, archived: true });
    session.archived = true;
    if (state.session && state.session.id === session.id) newChat();
    renderSidebar();
  } catch (e) { toast(e.message); }
}
async function deleteChat(session) {
  const res = await confirmDialog('Delete chat?', '"' + sessionTitle(session) + '" will be deleted. This cannot be undone.');
  if (!res) return;
  try {
    await api('/api/sessions/delete', { session_id: session.id });
    state.sessions = state.sessions.filter(s => s.id !== session.id);
    if (state.session && state.session.id === session.id) newChat();
    renderSidebar();
    toast('Chat deleted');
  } catch (e) { toast(e.message); }
}
async function newSession(opts = {}) {
  try {
    const created = await api('/api/sessions', { project_id: opts.project_id || null });
    const s = { ...created, title: opts.title || created.title || 'New chat', messages: opts.messages || [], branched: !!opts.branched };
    if (opts.title) {
      try { await api('/api/sessions/update', { session_id: s.id, title: opts.title, messages: s.messages }); } catch { /* title still shows locally */ }
    }
    state.sessions.unshift(s);
    state.session = s;
    state.isPrivate = false;
    renderSidebar();
    renderConversation(s);
    restoreDraft();
    return s;
  } catch (e) { toast(e.message); return null; }
}
function newChat() {
  state.session = null;
  state.isPrivate = false;
  state.privateThread = [];
  renderSidebar();
  renderConversation(null);
  renderSuggestions();
  restoreDraft();
  $('prompt').focus();
}
async function openSession(id) {
  if (state.busy) { toast('Finish the current answer first.'); return; }
  try {
    const full = await api('/api/session/' + encodeURIComponent(id));
    state.session = full;
    state.isPrivate = false;
    delete state.unread[id];
    saveUnread();
    renderSidebar();
    renderConversation(full);
    restoreDraft();
    closeSidebar();
  } catch (e) { toast(e.message); }
}
function openSidebar() { $('sidebar').classList.add('open'); $('mobileScrim').hidden = false; $('mobileScrim').classList.add('visible'); }
function closeSidebar() { $('sidebar').classList.remove('open'); $('mobileScrim').hidden = true; $('mobileScrim').classList.remove('visible'); }

/* ---------- generic pop-up menu (anchored, closes on outside tap) ---------- */
let openMenuEl = null;
function showMenu(anchor, items, opts = {}) {
  closeMenus();
  // The document outside-click handler exempts [data-menu-anchor] — mark
  // this anchor so the very click that opened the menu doesn't close it
  // again on its way up to document. (v67 used a 50ms grace period
  // instead; the v68 handler dropped it without marking any anchor, so
  // every anchored menu — message More, dots, conv menu, automation
  // pills — closed the instant it opened.)
  if (anchor && anchor.setAttribute) anchor.setAttribute('data-menu-anchor', '');
  const menu = el('div', 'menu-pop');
  menu.setAttribute('role', 'menu');
  if (opts.header) {
    const g = el('div', 'menu-group', opts.header);
    menu.append(g);
  }
  for (const item of items) {
    if (item.divider) { menu.append(el('div', 'menu-divider')); continue; }
    const b = el('button', item.danger ? 'danger' : '');
    b.type = 'button';
    b.innerHTML = `<svg><use href="#${item.icon || 'i-dots'}"/></svg><span>${escapeHTML(item.label)}</span>${item.sub ? `<span class="menu-sub">${escapeHTML(item.sub)}</span>` : ''}`;
    b.onclick = () => { closeMenus(); item.onClick && item.onClick(); };
    menu.append(b);
  }
  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  const mw = Math.min(280, window.innerWidth - 24);
  let left = Math.min(rect.left, window.innerWidth - mw - 12);
  left = Math.max(12, left);
  let top = rect.bottom + 6;
  menu.style.left = left + 'px';
  menu.style.minWidth = mw + 'px';
  const mh = menu.offsetHeight;
  if (top + mh > window.innerHeight - 12) top = Math.max(12, rect.top - mh - 6);
  menu.style.top = top + 'px';
  openMenuEl = menu;
  return menu;
}
function closeMenus() {
  if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; }
  const am = $('accountMenu');
  if (am) am.hidden = true;
}

/* ---------- command palette ---------- */
function openPalette() {
  const pal = $('palette');
  pal.hidden = false;
  $('paletteInput').value = '';
  renderPaletteTabs();
  renderPalette();
  setTimeout(() => $('paletteInput').focus(), 30);
}
function closePalette() { $('palette').hidden = true; }
function renderPaletteTabs() {
  const tabs = $('paletteTabs');
  tabs.replaceChildren();
  for (const t of ['All', 'Imagine', 'Apps', 'Automations', 'Files']) {
    const b = el('button', 'palette-tab' + (state.paletteTab === t ? ' active' : ''), t);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.onclick = () => { state.paletteTab = t; $('paletteInput').value = ''; renderPaletteTabs(); renderPalette(); };
    tabs.append(b);
  }
}
function paletteChats(query) {
  const q = (query || '').toLowerCase();
  return state.sessions.filter(s => !s.archived && (!q || (s.title || '').toLowerCase().includes(q)
    || (s.messages || []).some(m => (m.content || '').toLowerCase().includes(q))));
}
function renderPalette() {
  const body = $('paletteBody');
  body.replaceChildren();
  const q = $('paletteInput').value.trim();
  const tab = state.paletteTab;
  const empty = text => { const d = el('div', 'palette-empty', text); body.append(d); };
  if (tab === 'Imagine') { empty('Nothing generated in Imagine yet.'); return; }
  if (tab === 'Apps') {
    const apps = state.library.filter(f => f.kind === 'app');
    if (!apps.length) { empty('No apps yet. Apps you build with Janna will show up here.'); return; }
    for (const a of apps) {
      const item = el('button', 'palette-item');
      item.type = 'button';
      item.innerHTML = `<svg><use href="#i-panel"/></svg><span>${escapeHTML(a.name || 'App')}</span>`;
      item.onclick = () => { closePalette(); openLibraryItem(a); };
      body.append(item);
    }
    return;
  }
  if (tab === 'Automations') {
    const autos = state.savedAutomations || [];
    if (!autos.length) { empty('No automations yet. Schedule Janna to run on its own and they will show up here.'); return; }
    for (const a of autos) {
      const item = el('button', 'palette-item');
      item.type = 'button';
      item.innerHTML = `<svg><use href="#i-bolt"/></svg><span>${escapeHTML(a.name || 'Automation')}</span><span class="palette-item-meta">${escapeHTML(a.trigger ? (a.trigger.cadence + ' ' + a.trigger.time) : '')}</span>`;
      item.onclick = () => { closePalette(); openAutomationDetail(a.name, a); };
      body.append(item);
    }
    return;
  }
  if (tab === 'Files') {
    const files = state.library.filter(f => f.kind !== 'app');
    const hits = q ? files.filter(f => (f.name || '').toLowerCase().includes(q.toLowerCase())) : files;
    if (!hits.length) { empty(q ? `No matches for \u201c${q}\u201d.` : 'No files yet.'); return; }
    for (const f of hits) {
      const item = el('button', 'palette-item');
      item.type = 'button';
      item.innerHTML = `<svg><use href="#i-file"/></svg><span>${escapeHTML(f.name || 'File')}</span>`;
      item.onclick = () => { closePalette(); openLibraryItem(f); };
      body.append(item);
    }
    return;
  }
  // All tab: actions first (Grok), then chats.
  if (!q) {
    const group = el('div', 'palette-group', 'Actions');
    body.append(group);
    const actions = [
      { label: 'New Chat', meta: 'Ctrl J', icon: 'i-plus-circle', onClick: () => { closePalette(); newChat(); } },
      { label: 'New Project', icon: 'i-folder', onClick: () => { closePalette(); openProjectDialog(); } },
      { label: 'New Automation', icon: 'i-bolt', onClick: () => { closePalette(); openSettings('automations'); } },
      { label: 'Open settings', meta: 'Ctrl ,', icon: 'i-settings', onClick: () => { closePalette(); openSettings('account'); } },
    ];
    for (const a of actions) {
      const item = el('button', 'palette-item');
      item.type = 'button';
      item.innerHTML = `<svg><use href="#${a.icon}"/></svg><span>${escapeHTML(a.label)}</span>${a.meta ? `<kbd>${escapeHTML(a.meta)}</kbd>` : ''}`;
      item.onclick = a.onClick;
      body.append(item);
    }
    const modes = el('div', 'palette-group', 'Imagine');
    body.append(modes);
    for (const k of ['apps', 'presentation']) {
      const mode = MODES[k];
      const item = el('button', 'palette-item');
      item.type = 'button';
      item.innerHTML = `<svg><use href="#i-${mode.icon}"/></svg><span>${escapeHTML(mode.label)}</span>`;
      item.onclick = () => { closePalette(); armMode(k); };
      body.append(item);
    }
  }
  const chats = paletteChats(q);
  if (chats.length) {
    const group = el('div', 'palette-group', q ? `${chats.length} conversation${chats.length === 1 ? '' : 's'} found` : 'Chats');
    body.append(group);
    for (const s of chats.slice(0, 12)) {
      const item = el('button', 'palette-item');
      item.type = 'button';
      item.innerHTML = `<svg><use href="#i-chat"/></svg><span>${escapeHTML(sessionTitle(s))}</span><span class="palette-item-meta">${escapeHTML(timeAgo(s.updated))}</span>`;
      item.onclick = () => { closePalette(); openSession(s.id); };
      body.append(item);
    }
    if (q) {
      const ask = el('button', 'palette-item');
      ask.type = 'button';
      ask.innerHTML = `<svg><use href="#i-spark"/></svg><span>Ask Janna \u201c${escapeHTML(q)}\u201d</span>`;
      ask.onclick = () => { closePalette(); newChat(); $('prompt').value = q; autoGrowPrompt(); syncSendState(); send(); };
      body.append(ask);
    }
  } else if (q) {
    empty(`No matches for \u201c${q}\u201d.`);
    const ask = el('button', 'palette-item');
    ask.type = 'button';
    ask.innerHTML = `<svg><use href="#i-spark"/></svg><span>Ask Janna \u201c${escapeHTML(q)}\u201d</span>`;
    ask.onclick = () => { closePalette(); newChat(); $('prompt').value = q; autoGrowPrompt(); syncSendState(); send(); };
    body.append(ask);
  }
}

/* ---------- composer state ---------- */
function autoGrowPrompt() {
  const t = $('prompt');
  if (!t) return;
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 160) + 'px';
}
function syncSendState() {
  const t = $('prompt');
  const hasText = !!t.value.trim() || state.pending.length > 0;
  const composer = $('composer');
  composer.classList.toggle('is-empty', !hasText);
  $('send').classList.toggle('active', hasText);
  saveDraftSoon();
  if ($('welcome').hidden === false) renderAutocomplete();
}
function updateBusy() {
  const busy = state.busy;
  const composer = $('composer');
  composer.classList.toggle('is-busy', busy);
  $('stop').hidden = !busy;
  $('stop').disabled = state.stopRequested;
  $('prompt').disabled = false;
  // Grok while running: the placeholder stays "Ask anything...", the mic
  // and voice buttons stay visible, and Send is replaced by the black
  // square Stop. There is no queue — typed text simply stays in the box.
  $('prompt').placeholder = state.armedMode ? MODES[state.armedMode].placeholder : 'Ask anything\u2026';
  $('modelPickerBtn').disabled = busy;
  if (busy) closeModelPicker();
  statusBadge();
}
function statusBadge() {
  const ok = !!state.models.length;
  const failed = state.booted && state.bootFailed;
  $('sidebarDot').classList.toggle('offline', (state.modelsKnown && !ok) || failed);
  // Before the first bootstrap settles the honest label is "Connecting…":
  // an empty model list at boot means "not loaded yet", never "offline".
  $('sidebarState').textContent = state.busy ? 'Working\u2026' : !state.booted ? 'Connecting\u2026' : failed ? 'Cloud \u00b7 Offline' : !state.modelsKnown ? 'Connecting\u2026' : ok ? 'Cloud \u00b7 Ready' : 'Cloud \u00b7 Offline';
}

/* ---------- send / stream / stop (no queue — Grok has none) ---------- */
async function send() {
  // While a run is in flight the Send button is replaced by Stop, so this
  // can only be reached by Enter: typed text stays in the box, like Grok.
  if (state.busy) return;
  const text = $('prompt').value.trim();
  if (!text && !state.pending.length) return;
  clearDraft();
  closeMenus(); closeModelPicker(); closePlusMenu();
  const directive = styleDirective();
  const sentText = text + (directive ? '\n\n[Response style: ' + directive + ']' : '');
  if (state.isPrivate) { await sendPrivate(text, sentText); return; }
  if (!state.session) { await newSession(); if (!state.session) return; }
  const session = state.session;
  const isFirst = !(session.messages || []).length;
  const attachments = state.pending; state.pending = []; renderPending();
  const userMsg = { role: 'user', content: sentText, ts: Date.now() };
  if (attachments.length === 1 && attachments[0].kind === 'image') { userMsg.kind = 'image'; userMsg.data = attachments[0].data; userMsg.name = attachments[0].name; }
  else if (attachments.length === 1 && attachments[0].kind === 'log') { userMsg.kind = 'log'; userMsg.name = attachments[0].name; }
  else if (attachments.length > 1) userMsg.attached = attachments.map(a => ({ kind: a.kind, name: a.name }));
  const history = (session.messages || []).slice(-20).map(m => ({ role: m.role, content: stripStyleDirective(m.content || '') }));
  session.messages = session.messages || [];
  session.messages.push(userMsg);
  $('prompt').value = ''; autoGrowPrompt(); syncSendState();
  renderConversation(session);
  await streamRun(session, sentText, history, attachments);
  // Summary title (Grok generates one): ask the model 1.5s after the first
  // message so the real title lands while the reply is still streaming.
  if (isFirst) setTimeout(() => requestTitle(session, text), 1500);
}
async function sendPrivate(text, sentText) {
  clearDraft();
  const attachments = state.pending; state.pending = []; renderPending();
  const userMsg = { role: 'user', content: sentText, ts: Date.now() };
  if (attachments.length === 1 && attachments[0].kind === 'image') { userMsg.kind = 'image'; userMsg.data = attachments[0].data; userMsg.name = attachments[0].name; }
  else if (attachments.length === 1 && attachments[0].kind === 'log') { userMsg.kind = 'log'; userMsg.name = attachments[0].name; }
  else if (attachments.length > 1) userMsg.attached = attachments.map(a => ({ kind: a.kind, name: a.name }));
  const history = state.privateThread.slice(-20).map(m => ({ role: m.role, content: stripStyleDirective(m.content || '') }));
  state.privateThread.push(userMsg);
  $('prompt').value = ''; autoGrowPrompt(); syncSendState();
  renderConversation({ id: 'private', title: 'Private chat', messages: state.privateThread });
  await streamRunPrivate(sentText, history, attachments);
}
function streamBody(sessionId, prompt, history, attachments, edit) {
  const body = {
    session_id: sessionId, model: state.model, prompt, messages: history,
    attachments: attachments.map(a => a.kind === 'image' ? { kind: 'image', name: a.name, data: a.data } : { kind: 'log', name: a.name, text: a.text }),
  };
  // An edit re-runs from that message: the adapter versions the stored
  // message instead of appending a duplicate one.
  if (edit && typeof edit.index === 'number') body.edit_of = edit.index;
  return body;
}
async function streamRun(session, prompt, history, attachments) {
  return runStream(session, prompt, history, attachments, false);
}
async function streamRunPrivate(prompt, history, attachments) {
  return runStream({ id: uid('private'), title: 'Private chat', messages: state.privateThread }, prompt, history, attachments, true);
}
async function runStream(session, prompt, history, attachments, isPrivate, edit) {
  state.busy = true; state.stopRequested = false; state.stream = '';
  updateBusy();
  const streamNode = el('div', 'message assistant streaming');
  const body = el('div', 'message-body');
  streamNode.append(body);
  $('messages').append(streamNode);
  startThinking();
  let doneText = '', errorMessage = '';
  try {
    const gen = JannaRuns.subscribe(streamBody(session.id, prompt, history, attachments, edit), state.token, (kind, id, msg) => {
      if (kind === 'connected' && id) state.runId = id;
    });
    for await (const ev of gen) {
      if (ev.run_id) state.runId = ev.run_id;
      if (ev.type === 'progress') { /* live header stays "Thinking / Planning next moves" — the backend's generic step labels are not shown */ }
      else if (ev.type === 'first_token') stopThinking();
      else if (ev.type === 'delta') {
        state.stream += ev.text || '';
        renderMarkdown(body, state.stream);
        scrollToBottomIfNear();
      }
      else if (ev.type === 'done') { doneText = ev.text || state.stream; state.stream = doneText; }
      else if (ev.type === 'error') errorMessage = ev.message || 'Run failed';
    }
  } catch (e) { errorMessage = e.message || 'Run failed'; }
  stopThinking();
  state.busy = false; state.runId = null; updateBusy();
  const finalText = errorMessage ? '\u26a0\ufe0f ' + errorMessage : (doneText || state.stream);
  streamNode.remove();
  if (isPrivate) {
    const am = { role: 'assistant', content: finalText, ts: Date.now() };
    state.privateThread.push(am);
    if (edit && edit.msg && Array.isArray(edit.msg.versions)) edit.msg.versions[edit.msg.version].response = am;
    renderConversation({ id: 'private', title: 'Private chat', messages: state.privateThread });
    if (!errorMessage && state.settings.voice_output === true) voiceSpeak(finalText);
    return;
  }
  session.messages = session.messages || [];
  const am = { role: 'assistant', content: finalText, ts: Date.now() };
  session.messages.push(am);
  if (edit && edit.msg && Array.isArray(edit.msg.versions)) edit.msg.versions[edit.msg.version].response = am;
  renderConversation(session);
  if (errorMessage) toast(errorMessage);
  else {
    if (state.settings.voice_output === true) voiceSpeak(finalText);
    if (state.settings.browser_notifications === true && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification('Janna AI', { body: finalText.slice(0, 140) }); } catch { /* ignore */ }
    }
    // Follow-up pills (Grok): ask the model for two next questions in the
    // background; they render under the reply and are ephemeral.
    generateFollowUps(session, am);
  }
  refreshBootstrap(true);
  // The adapter titles a chat from its first prompt in storage; the
  // in-memory session keeps 'New chat' until this sync runs.
  const freshTitle = state.session && findSession(state.session.id);
  if (freshTitle && freshTitle.title) { state.session.title = freshTitle.title; $('threadTitle').textContent = freshTitle.title; }
}
async function stopRun() {
  if (!state.busy) return;
  state.stopRequested = true;
  $('stop').disabled = true;
  const sid = state.isPrivate ? null : state.session?.id;
  try {
    if (state.runId) await api('/api/stop', { run_id: state.runId });
    else if (sid) await api('/api/stop', { session_id: sid });
  } catch { /* the stream abort below still ends the run */ }
  state.stream += '\n\n_Stopped._';
}
async function requestTitle(session, text) {
  if (!session || (session.title && session.title !== 'New chat')) return;
  try {
    const body = { session_id: session.id, model: state.model, prompt: 'Give this conversation a very short title (at most 6 words, no quotes, no punctuation at the end).\n\nFirst message: ' + text, background: true, messages: [] };
    let out = '';
    for await (const ev of JannaRuns.subscribe(body, state.token)) {
      if (ev.type === 'delta') out += ev.text || '';
      else if (ev.type === 'done') out = ev.text || out;
    }
    const title = out.split('\n')[0].trim().replace(/^["'\u201c]|["'\u201d]$/g, '').slice(0, 60);
    if (title.length > 2 && state.session && state.session.id === session.id) {
      session.title = title;
      try { await api('/api/sessions/update', { session_id: session.id, title }); } catch { /* title still shows locally */ }
      $('threadTitle').textContent = title;
      renderSidebar();
    }
  } catch { /* title stays the prompt fallback */ }
}

/* ---------- attachments ---------- */
function renderPending() {
  const tray = $('attachmentTray');
  tray.replaceChildren();
  if (!state.pending.length) { tray.hidden = true; syncSendState(); return; }
  tray.hidden = false;
  for (const a of state.pending) {
    const chip = el('span', 'attachment-chip');
    if (a.kind === 'image' && a.data) { const img = document.createElement('img'); img.src = 'data:image/jpeg;base64,' + a.data; img.alt = ''; chip.append(img); }
    chip.append(document.createTextNode(a.name || 'file'));
    const x = el('button', '', '\u00d7');
    x.type = 'button';
    x.onclick = () => { state.pending = state.pending.filter(p => p !== a); renderPending(); };
    chip.append(x);
    tray.append(chip);
  }
  syncSendState();
}
async function fileBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('Could not read ' + file.name));
    r.readAsDataURL(file);
  });
}
async function downscaleImageFile(file) {
  try {
    const data = await fileBase64(file);
    const img = new Image();
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = 'data:' + (file.type || 'image/jpeg') + ';base64,' + data; });
    const scale = Math.min(1, 1568 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    if (scale >= 1) return { kind: 'image', name: file.name, data };
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(img.naturalWidth * scale));
    cv.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const cx = cv.getContext('2d');
    cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, cv.width, cv.height);
    cx.drawImage(img, 0, 0, cv.width, cv.height);
    const url = cv.toDataURL('image/jpeg', 0.85);
    return { kind: 'image', name: file.name, data: url.split(',')[1] };
  } catch { return null; }
}
async function handleFiles(files) {
  const list = [...(files || [])];
  if (!list.length) return;
  for (const file of list) {
    if (file.type.startsWith('image/')) {
      const img = await downscaleImageFile(file);
      if (img) state.pending.push(img);
      else toast('Could not read ' + file.name);
    } else if (file.size > 400000) {
      toast(file.name + ' is too large to send (400 KB max for text files).');
    } else {
      try {
        const text = await file.text();
        state.pending.push({ kind: 'log', name: file.name, text });
      } catch { toast('Could not read ' + file.name); }
    }
  }
  if (!state.modelVision && state.pending.some(a => a.kind === 'image')) {
    toast('This model may not see image pixels — its vision flag is off in the catalog.');
  }
  renderPending();
}

/* ---------- "+" menu (Grok's exact order + Skills submenu) ---------- */
function closePlusMenu() { const m = $('plusMenu'); if (m) m.hidden = true; $('plusBtn').setAttribute('aria-expanded', 'false'); $('plusScrim').hidden = true; }
function openPlusMenu() {
  const m = $('plusMenu'), btn = $('plusBtn');
  if (!m.hidden) { closePlusMenu(); return; }
  closeModelPicker();
  m.replaceChildren();
  const handle = el('div', 'plus-menu-handle');
  m.append(handle);
  const upload = el('button', 'plus-menu-row');
  upload.type = 'button';
  upload.innerHTML = '<svg><use href="#i-upload"/></svg><span>Upload a file</span>';
  upload.onclick = () => { closePlusMenu(); $('attachment').click(); };
  m.append(upload);
  const projectsRow = el('button', 'plus-menu-row');
  projectsRow.type = 'button';
  projectsRow.innerHTML = '<svg><use href="#i-folder"/></svg><span>Projects</span><span class="plus-menu-state">\u203a</span>';
  projectsRow.onclick = () => { closePlusMenu(); openProjectPicker(); };
  m.append(projectsRow);
  m.append(el('div', 'plus-menu-divider'));
  const skillsRow = el('button', 'plus-menu-row');
  skillsRow.type = 'button';
  skillsRow.innerHTML = '<svg><use href="#i-spark"/></svg><span>Skills</span><span class="plus-menu-state">\u203a</span>';
  const skillsSub = el('div', 'plus-menu-sub');
  skillsSub.hidden = true;
  for (const [id, label] of FILE_SKILLS) {
    const b = el('button', 'plus-menu-row');
    b.type = 'button';
    b.innerHTML = `<svg><use href="#i-file"/></svg><span>${escapeHTML(label)}</span>`;
    b.onclick = () => { closePlusMenu(); $('prompt').value = 'Create a ' + label.toLowerCase() + ' for me: '; autoGrowPrompt(); syncSendState(); $('prompt').focus(); };
    skillsSub.append(b);
  }
  for (const s of state.customSkills) {
    const b = el('button', 'plus-menu-row');
    b.type = 'button';
    b.innerHTML = `<svg><use href="#i-spark"/></svg><span>${escapeHTML(s.name)}</span>`;
    b.onclick = () => { closePlusMenu(); $('prompt').value = s.instruction + ' '; autoGrowPrompt(); syncSendState(); $('prompt').focus(); };
    skillsSub.append(b);
  }
  const manage = el('button', 'plus-menu-row');
  manage.type = 'button';
  manage.innerHTML = '<svg><use href="#i-settings"/></svg><span>Manage skills</span>';
  manage.onclick = () => { closePlusMenu(); openSettings('skills'); };
  skillsSub.append(manage);
  skillsRow.onclick = () => { skillsSub.hidden = !skillsSub.hidden; };
  m.append(skillsRow, skillsSub);
  const connector = el('button', 'plus-menu-row');
  connector.type = 'button';
  connector.innerHTML = '<svg><use href="#i-plus"/></svg><span>Add connector</span>';
  connector.onclick = () => { closePlusMenu(); openSettings('connectors'); };
  m.append(connector);
  const filesRow = el('button', 'plus-menu-row');
  filesRow.type = 'button';
  filesRow.innerHTML = '<svg><use href="#i-file"/></svg><span>Files</span><span class="plus-menu-state">\u203a</span>';
  const filesSub = el('div', 'plus-menu-sub');
  filesSub.hidden = true;
  if (!state.library.length) {
    const e = el('div', 'plus-menu-empty', 'No files yet. Upload one from the Library.');
    filesSub.append(e);
  }
  for (const f of state.library.slice(0, 8)) {
    const b = el('button', 'plus-menu-row');
    b.type = 'button';
    b.innerHTML = `<svg><use href="#i-file"/></svg><span>${escapeHTML(f.name || 'File')}</span>`;
    b.onclick = () => { closePlusMenu(); openLibraryItem(f); };
    filesSub.append(b);
  }
  filesRow.onclick = () => { filesSub.hidden = !filesSub.hidden; };
  m.append(filesRow, filesSub);
  m.append(el('div', 'plus-menu-divider'));
  const researchOn = state.settings.research_mode === 'always';
  const research = el('button', 'plus-menu-row');
  research.type = 'button';
  research.innerHTML = `<svg><use href="#i-globe"/></svg><span>Web research</span><span class="plus-menu-state">${researchOn ? 'On \u2014 always' : 'Auto'}</span>`;
  research.onclick = () => {
    const next = state.settings.research_mode === 'always' ? 'auto' : 'always';
    persistSettings({ research_mode: next });
    closePlusMenu();
    toast(next === 'always' ? 'Web research always on' : 'Web research back to auto');
  };
  m.append(research);
  m.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  // Dim the page behind the sheet on mobile (Grok dims it too).
  if (matchMedia('(max-width:700px)').matches) { const sc = $('plusScrim'); if (sc) sc.hidden = false; }
}

/* ---------- projects (Grok's New Project picker, review #2): 64 icons in
   an 8x8 grid + 8 colours. Inline stroke SVGs in the same style as the
   shell sprite (24x24, stroke currentColor, width 1.65). ---------- */
const PROJECT_ICONS = [
  ['folder', 'Folder', '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'],
  ['flag', 'Flag', '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>'],
  ['home', 'Home', '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>'],
  ['star', 'Star', '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>'],
  ['heart', 'Heart', '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>'],
  ['globe', 'Globe', '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>'],
  ['unlock', 'Unlock', '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>'],
  ['smile', 'Smile', '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/>'],
  ['shield', 'Shield', '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'],
  ['bell', 'Bell', '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>'],
  ['mail', 'Mail', '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><path d="M22 6l-10 7L2 6"/>'],
  ['phone', 'Phone', '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>'],
  ['user', 'User', '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'],
  ['stethoscope', 'Stethoscope', '<path d="M4 3v5a7 7 0 0 0 14 0V3"/><path d="M11 15v1a5 5 0 0 0 10 0v-3"/><circle cx="21" cy="9" r="1.8"/>'],
  ['calendar', 'Calendar', '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'],
  ['clock', 'Clock', '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'],
  ['hourglass', 'Hourglass', '<path d="M5 22h14M5 2h14M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>'],
  ['sun', 'Sun', '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>'],
  ['moon', 'Moon', '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'],
  ['monitor', 'Monitor', '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>'],
  ['umbrella', 'Umbrella', '<path d="M23 12a11.05 11.05 0 0 0-22 0zm-5 7a3 3 0 0 1-6 0v-7"/>'],
  ['leaf', 'Leaf', '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>'],
  ['bug', 'Bug', '<path d="M12 3a5 5 0 0 1 5 5v8a5 5 0 0 1-10 0V8a5 5 0 0 1 5-5z"/><path d="M9 3l1 2M15 3l-1 2M8 21l-2-2M16 21l2-2M7 9h10M7 13h10"/>'],
  ['flask', 'Flask', '<path d="M10 2v6L4.5 18a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 8V2"/><path d="M8.5 2h7M7 16h10"/>'],
  ['rocket', 'Rocket', '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>'],
  ['plane', 'Plane', '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>'],
  ['car', 'Car', '<path d="M3 13l1.5-4.5A2 2 0 0 1 6.4 7h11.2a2 2 0 0 1 1.9 1.5L21 13v5a1 1 0 0 1-1 1h-1"/><path d="M3 13v5a1 1 0 0 0 1 1h1"/><circle cx="7.5" cy="18" r="1.8"/><circle cx="16.5" cy="18" r="1.8"/><path d="M9.3 18h5.4"/>'],
  ['camera', 'Camera', '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'],
  ['video', 'Video', '<path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>'],
  ['music', 'Music', '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'],
  ['headphones', 'Headphones', '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>'],
  ['microscope', 'Microscope', '<path d="M9 2h6"/><path d="M12 2v6"/><path d="M8 21h8"/><path d="M12 8l4.5 6.5a3.5 3.5 0 0 1-3 5.5h-3a3.5 3.5 0 0 1-3-5.5z"/><path d="M12 21v-1"/>'],
  ['archive', 'Archive', '<rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>'],
  ['book', 'Book', '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>'],
  ['zap', 'Zap', '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'],
  ['wrench', 'Wrench', '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'],
  ['note', 'Note', '<path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5z"/><path d="M15 3v6h6M9 13h6M9 17h4"/>'],
  ['scale', 'Scale', '<path d="M12 3v18M5 7h14M7 21h10"/><path d="M5 7l-2.5 6a3 3 0 0 0 5 0zM19 7l-2.5 6a3 3 0 0 0 5 0z"/>'],
  ['film', 'Film', '<rect x="2" y="2" width="20" height="20" rx="2.18"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5"/>'],
  ['palette', 'Palette', '<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 1.5-2.5-.5-1.5.5-2.5 2-2.5H17a4 4 0 0 0 4-4c0-5-4-9-9-9z"/><path d="M8 10h.01M12 7h.01M16 10h.01"/>'],
  ['cpu', 'CPU', '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/>'],
  ['calculator', 'Calculator', '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8"/><path d="M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>'],
  ['laptop', 'Laptop', '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M2 20h20"/>'],
  ['briefcase', 'Briefcase', '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>'],
  ['clipboard', 'Clipboard', '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 12h6M9 16h6"/>'],
  ['building', 'Building', '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>'],
  ['flame', 'Flame', '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>'],
  ['play', 'Play', '<polygon points="5 3 19 12 5 21 5 3"/>'],
  ['database', 'Database', '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>'],
  ['shirt', 'Shirt', '<path d="M20.38 3.46L16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>'],
  ['gem', 'Gem', '<path d="M6 3h12l4 6-10 13L2 9z"/><path d="M11 3L8 9l4 13 4-13-3-6M2 9h20"/>'],
  ['gamepad', 'Gamepad', '<path d="M17.32 5H6.68a4 4 0 0 0-3.98 3.59L2 17a2 2 0 0 0 3.35 1.47L8 15h8l2.65 3.47A2 2 0 0 0 22 17l-.7-8.41A4 4 0 0 0 17.32 5z"/><path d="M6 12h4M8 10v4M15 13h.01M18 11h.01"/>'],
  ['chef', 'Chef Hat', '<path d="M17 21a1 1 0 0 0 1-1v-5.35c0-.46.32-.84.73-1.04a4 4 0 0 0-2.13-7.59 5 5 0 0 0-9.19 0 4 4 0 0 0-2.13 7.59c.41.2.73.58.73 1.04V20a1 1 0 0 0 1 1z"/><path d="M6 17h12"/>'],
  ['dollar', 'Dollar', '<path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'],
  ['tag', 'Tag', '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><path d="M7 7h.01"/>'],
  ['gradcap', 'Graduation Cap', '<path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1.66 2.69 3 6 3s6-1.34 6-3v-5"/><path d="M22 10v6"/>'],
  ['pin', 'Pin', '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>'],
  ['compass', 'Compass', '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>'],
  ['code', 'Code', '<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>'],
  ['box', 'Box', '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/>'],
  ['sparkles', 'Sparkles', '<path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3z"/><path d="M19 3l.9 2.6 2.6.9-2.6.9L19 10l-.9-2.6-2.6-.9 2.6-.9z"/>'],
  ['key', 'Key', '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>'],
  ['bulb', 'Lightbulb', '<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.4 1 2.3h6c0-.9.4-1.8 1-2.3A7 7 0 0 0 12 2z"/>'],
  ['bookmark', 'Bookmark', '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>'],
];
const PROJECT_COLORS = [
  ['default', 'Default color', ''],
  ['blue', 'Blue', '#1f7aec'],
  ['orange', 'Orange', '#f97316'],
  ['pink', 'Pink', '#ec4899'],
  ['purple', 'Purple', '#8b5cf6'],
  ['teal', 'Teal', '#14b8a6'],
  ['red', 'Red', '#ef4444'],
  ['green', 'Green', '#22c55e'],
];
/* Example projects (Grok's Library Projects tab — FULL card texts, review #3
   2026-11-26; v67 used the truncated narrow-view texts). */
const EXAMPLE_PROJECTS = [
  { name: 'Legal Document Reviewer', desc: 'Get expert analysis of U.S. legal documents' },
  { name: 'Cover Letter Writer', desc: 'Craft tailored cover letters that align your experience with the job description' },
  { name: 'Writing Assistant', desc: 'Polish and improve any text for clarity, conciseness, and style.' },
  { name: 'Fitness Advice', desc: 'Plan workouts, nutrition, and fitness goals with evidence-based guidance' },
];
function projectIconSvg(p) {
  const found = PROJECT_ICONS.find(i => i[0] === (p && p.icon)) || PROJECT_ICONS[0];
  const col = (PROJECT_COLORS.find(c => c[0] === (p && p.color)) || PROJECT_COLORS[0])[2];
  return `<svg viewBox="0 0 24 24" fill="none" stroke="${col || 'currentColor'}" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${found[2]}</svg>`;
}
function inlineIcon(id) {
  const found = PROJECT_ICONS.find(i => i[0] === id) || PROJECT_ICONS[0];
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${found[2]}</svg>`;
}
function createProject(chatId) { openProjectDialog(chatId); }
function openProjectPicker() {
  const items = [{ label: 'Create Project', icon: 'i-plus', onClick: () => openProjectDialog() }];
  for (const p of state.localProjects) {
    items.push({ label: p.name || 'Untitled Project', icon: 'i-folder', onClick: () => { state.projectFilter = p.id; renderSidebar(); } });
  }
  showMenu($('plusBtn'), items, { header: 'Projects' });
}
function openProjectDialog(chatId, prefill) {
  closeMenus();
  const overlay = el('div', 'dialog-overlay');
  const card = el('div', 'dialog-card proj-dialog');
  const draft = { icon: 'folder', color: 'default', name: 'Untitled Project', about: '', files: [] };
  if (prefill) Object.assign(draft, prefill);
  const closeBtn = el('button', 'icon-button proj-close');
  closeBtn.type = 'button';
  closeBtn.innerHTML = '<svg><use href="#i-close"/></svg>';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.onclick = () => overlay.remove();
  const iconRow = el('div', 'proj-icon-row');
  const tile = el('button', 'proj-icon-tile');
  tile.type = 'button';
  tile.innerHTML = projectIconSvg(draft);
  tile.title = 'Choose an icon and color';
  const tileLabel = el('button', 'text-btn');
  tileLabel.type = 'button';
  tileLabel.textContent = 'Choose an icon and color';
  const picker = el('div', 'proj-icon-picker');
  picker.hidden = true;
  const colors = el('div', 'proj-colors');
  for (const [id, label, hex] of PROJECT_COLORS) {
    const c = el('button', 'proj-color' + (draft.color === id ? ' selected' : ''));
    c.type = 'button';
    c.title = label;
    c.style.background = hex || 'var(--chip)';
    c.onclick = () => {
      draft.color = id;
      colors.querySelectorAll('.proj-color').forEach(x => x.classList.remove('selected'));
      c.classList.add('selected');
      tile.innerHTML = projectIconSvg(draft);
    };
    colors.append(c);
  }
  const icons = el('div', 'proj-icons');
  for (const [id, label, svg] of PROJECT_ICONS) {
    const b = el('button', 'proj-icon' + (draft.icon === id ? ' selected' : ''));
    b.type = 'button';
    b.title = label;
    b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${svg}</svg>`;
    b.onclick = () => {
      draft.icon = id;
      icons.querySelectorAll('.proj-icon').forEach(x => x.classList.remove('selected'));
      b.classList.add('selected');
      tile.innerHTML = projectIconSvg(draft);
    };
    icons.append(b);
  }
  picker.append(colors, icons);
  const togglePicker = () => { picker.hidden = !picker.hidden; };
  tile.onclick = togglePicker;
  tileLabel.onclick = togglePicker;
  iconRow.append(tile, tileLabel);
  const title = document.createElement('input');
  title.className = 'proj-title';
  title.value = draft.name;
  title.placeholder = 'Untitled Project';
  title.setAttribute('aria-label', 'Project name');
  const about = document.createElement('textarea');
  about.className = 'proj-about';
  about.value = draft.about;
  about.placeholder = "What's this project about?";
  about.setAttribute('aria-label', 'What is this project about?');
  const addFolder = el('button', 'proj-add-folder');
  addFolder.type = 'button';
  addFolder.innerHTML = '<span>Add Folder</span><small>Attach files from your Library</small>';
  const folderInput = document.createElement('input');
  folderInput.type = 'file';
  folderInput.multiple = true;
  folderInput.hidden = true;
  folderInput.onchange = () => {
    const names = [...folderInput.files].map(f => f.name);
    draft.files = draft.files.concat(names);
    addFolder.querySelector('span').textContent = draft.files.length ? `${draft.files.length} file${draft.files.length === 1 ? '' : 's'} attached` : 'Add Folder';
    handleFiles(folderInput.files);
  };
  addFolder.onclick = () => folderInput.click();
  const create = el('button', 'proj-create', 'Create');
  create.type = 'button';
  create.onclick = () => {
    draft.name = title.value.trim() || 'Untitled Project';
    draft.about = about.value.trim();
    const project = { id: uid('proj'), name: draft.name, icon: draft.icon, color: draft.color, about: draft.about, files: draft.files, created: Date.now() };
    state.localProjects.unshift(project);
    saveProjects();
    if (chatId) state.chatProjects[chatId] = project.id;
    saveChatProjects();
    overlay.remove();
    renderSidebar();
    toast('Project created: ' + project.name);
  };
  card.append(closeBtn, iconRow, picker, title, about, addFolder, create);
  overlay.append(card);
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  document.body.append(overlay);
  setTimeout(() => title.focus(), 40);
}
function createExampleProject(ex) {
  const existing = state.localProjects.find(p => p.name === ex.name);
  if (existing) { state.projectFilter = existing.id; renderSidebar(); closeLibrary(); return; }
  const project = { id: uid('proj'), name: ex.name, icon: 'folder', color: 'default', about: ex.desc, files: [], created: Date.now() };
  state.localProjects.unshift(project);
  saveProjects();
  state.projectFilter = project.id;
  renderSidebar();
  closeLibrary();
  toast('Project created: ' + ex.name);
}

/* ---------- Library ---------- */
function openLibrary() { $('libraryView').hidden = false; renderLibrary(); }
function closeLibrary() { $('libraryView').hidden = true; }
function libraryUsageBytes() { return state.library.reduce((n, f) => n + (f.size || 0), 0); }
function addFilesToLibrary(files) {
  for (const f of [...files]) {
    state.library.unshift({ id: uid('file'), name: f.name, size: f.size || 0, kind: 'file', created: Date.now() });
  }
  saveLibrary();
}
function renderLibrary() {
  const list = $('libraryBody');
  const tab = state.libraryTab;
  $('libraryUpload').textContent = tab === 'apps' ? 'Create app' : 'Upload files';
  // Tabs: All / Media / Projects / Apps / Files (Grok).
  $('libraryTabs').replaceChildren();
  for (const t of ['all', 'media', 'projects', 'apps', 'files']) {
    const b = el('button', 'tab' + (t === tab ? ' active' : ''));
    b.type = 'button';
    b.textContent = t[0].toUpperCase() + t.slice(1);
    b.onclick = () => { state.libraryTab = t; renderLibrary(); };
    $('libraryTabs').append(b);
  }
  const q = (state.libraryQuery || '').toLowerCase();
  let items = state.library.filter(f => !q || (f.name || '').toLowerCase().includes(q));
  if (state.librarySort === 'name') items = [...items].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  else if (state.librarySort === 'oldest') items = [...items].reverse();
  if (tab === 'apps') items = items.filter(f => f.kind === 'app');
  else if (tab === 'files') items = items.filter(f => f.kind !== 'app');
  else if (tab === 'media') items = items.filter(f => f.kind === 'image');
  list.replaceChildren();
  if (tab === 'projects') {
    const head = el('div', 'library-section-head');
    const empty = el('div', 'empty-state');
    const icon = el('span', 'lib-icon');
    icon.innerHTML = '<svg><use href="#i-folder"/></svg>';
    const h = el('h3', '', 'Get started by creating a new project');
    const p = el('p', '', 'Projects help you set common instructions and attach files for conversations.');
    const nb = el('button', 'primary-pill', 'New project');
    nb.type = 'button';
    nb.onclick = () => openProjectDialog();
    empty.append(icon, h, p, nb);
    head.append(empty);
    const exHead = el('h3', 'lib-example-head', 'Example projects');
    const grid = el('div', 'lib-example-grid');
    for (const ex of EXAMPLE_PROJECTS) {
      const card = el('button', 'lib-example-card');
      card.type = 'button';
      const doc = el('span', 'lib-example-doc');
      doc.innerHTML = `<span class="lib-example-doc-title">${escapeHTML(ex.name)}</span><span class="lib-example-doc-lines"></span>`;
      card.append(doc);
      card.append(el('span', 'lib-example-title', ex.name));
      card.append(el('span', 'lib-example-desc', ex.desc));
      card.onclick = () => createExampleProject(ex);
      grid.append(card);
    }
    list.append(head, exHead, grid);
    return;
  }
  const texts = {
    all: ['Your library is empty', 'Upload files to keep them within reach.'],
    media: ['No media yet', 'Upload images, videos, or audio to see them here.'],
    apps: ['No apps yet', 'Create an app with Grok to see it here.'],
    files: ['No files yet', 'Upload files to see them here.'],
  };
  if (!items.length) {
    const [title, sub] = texts[tab] || texts.all;
    const empty = el('div', 'empty-state');
    empty.append(el('h3', '', title), el('p', '', sub));
    list.append(empty);
    return;
  }
  for (const f of items) {
    const row = el('button', 'library-row');
    row.type = 'button';
    row.innerHTML = `<svg><use href="#i-file"/></svg><span class="library-name">${escapeHTML(f.name || 'File')}</span><span class="library-meta">${f.size ? Math.round(f.size / 1024) + ' KB' : ''}</span>`;
    row.onclick = () => openLibraryItem(f);
    list.append(row);
  }
}
function openLibraryItem(f) {
  if (f.kind === 'app' && f.url) { openRightPane(f.name, f.url); return; }
  toast('File saved in this browser: ' + (f.name || 'File'));
}

/* ---------- skills ---------- */
const FILE_SKILLS = [
  ['docx', 'Word document (.docx)'],
  ['pdf', 'PDF document (.pdf)'],
  ['pptx', 'Presentation (.pptx)'],
  ['xlsx', 'Spreadsheet (.xlsx)'],
];
async function addCustomSkill() {
  const res = await showDialog({ title: 'New skill', text: 'Give the skill a short instruction, for example "Write in the voice of a travel writer".', fields: [{ name: 'instruction', placeholder: 'Skill instruction' }], okText: 'Create skill' });
  if (!res || !res.instruction || !res.instruction.trim()) return;
  const name = res.instruction.trim();
  state.customSkills.unshift({ name, instruction: name });
  saveSkills();
  renderSettingsBody();
}

/* ---------- automations ----------
   Grok semantics (review #3): clicking Add on a catalog card CREATES the
   automation immediately — opening the detail and pressing Cancel still
   created "Morning Brief" on the account. Janna matches that: Add creates
   it right away (stored locally), Cancel only goes back, Save updates it.
   Janna cannot RUN automations — Save says so in a toast. */
const AUTOMATIONS = [
  { section: 'Featured', items: [
    { name: 'Custom', desc: 'Create your own automation from scratch' },
    { name: 'Morning Brief', desc: 'Start the day with headlines, market moves, and your weather.' },
    { name: 'Daily Stock Tracker', desc: 'Prices, sentiment, and catalysts for your watchlist every day.' },
    { name: 'AI News Digest', desc: 'Model releases, research, and funding that actually matter.' },
    { name: 'Daily Planner', desc: 'A realistic plan for today with focus blocks and quick wins.' },
    { name: 'Weekly Review', desc: 'Wrap the week: what you did, loose ends, and next priorities.' },
  ] },
  { section: 'News', items: [
    { name: 'X Trends Digest', desc: 'The five most interesting conversations on X right now.' },
  ] },
  { section: 'Productivity', items: [
    { name: 'Email Auto-Responder', desc: 'Draft replies to routine emails as they arrive.' },
    { name: 'Task Extractor', desc: 'Pull tasks out of your messages into a list.' },
  ] },
  { section: 'Finance', items: [
    { name: 'Earnings Calendar', desc: 'Upcoming earnings and what to watch.' },
    { name: 'Portfolio News Scan', desc: 'News that moves your holdings.' },
  ] },
  { section: 'Research', items: [
    { name: 'Competitor Watch', desc: 'Track what your competitors shipped this week.' },
    { name: 'Paper Watch', desc: 'New papers worth reading in your field.' },
    { name: 'Weekend Deep Dive', desc: 'One deep topic, explored properly.' },
  ] },
  { section: 'Lifestyle', items: [
    { name: 'Workout Coach', desc: 'A daily plan that fits your schedule.' },
    { name: 'Meal Planner', desc: 'Plan the week\u2019s meals and shopping list.' },
    { name: 'Language Practice', desc: 'A little practice every day.' },
  ] },
];
/* Grok's exact Morning Brief instructions (review #2/3). Other catalog
   automations have no observed instruction text, so they start empty. */
const AUTOMATION_INSTRUCTIONS = {
  'Morning Brief': 'Put together my morning brief: the top world, business, and tech headlines from the last 24 hours with one-line summaries, any major overnight market moves, and today\u2019s weather for my location. End with one story worth reading in depth and why. Keep the whole thing scannable.',
};
function automationIcon(name) {
  const inner = name === 'Morning Brief'
    ? '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>'
    : '<path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3z"/><path d="M19 3l.9 2.6 2.6.9-2.6.9L19 10l-.9-2.6-2.6-.9 2.6-.9z"/>';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}
function createAutomation(name) {
  const catalog = AUTOMATIONS.flatMap(s => s.items).find(a => a.name === name);
  const a = {
    id: uid('auto'), name, created: Date.now(),
    cadence: 'Daily', time: '7:30 AM',
    instructions: AUTOMATION_INSTRUCTIONS[name] || '',
    model: state.model, notify: 'Email + App',
    connectors: [], skills: [],
  };
  state.savedAutomations.unshift(a);
  saveAutomations();
  toast('Automation created: ' + name);
  return a;
}
function removeAutomation(id) {
  state.savedAutomations = state.savedAutomations.filter(a => a.id !== id);
  saveAutomations();
}
function openAutomationDetail(name, existing) {
  const a = existing || createAutomation(name);
  openSettings('automations');
  const body = $('settingsBody');
  body.replaceChildren();
  const back = el('button', 'settings-back', '\u2190 Automations');
  back.type = 'button';
  back.onclick = () => openSettings('automations');
  const head = el('div', 'auto-detail-head');
  const iconTile = el('button', 'auto-icon-tile');
  iconTile.type = 'button';
  iconTile.innerHTML = automationIcon(a.name);
  iconTile.title = 'Change icon';
  const iconGrid = el('div', 'auto-icon-picker');
  iconGrid.hidden = true;
  for (const [id] of PROJECT_ICONS) {
    const b = el('button', 'proj-icon');
    b.type = 'button';
    b.innerHTML = inlineIcon(id);
    b.onclick = () => { a.icon = id; iconTile.innerHTML = a.icon ? inlineIcon(a.icon) : automationIcon(a.name); iconGrid.hidden = true; };
    iconGrid.append(b);
  }
  iconTile.onclick = () => { iconGrid.hidden = !iconGrid.hidden; };
  const nameWrap = el('div', 'auto-name-wrap');
  const nameInput = document.createElement('input');
  nameInput.className = 'auto-name';
  nameInput.value = a.name;
  nameInput.setAttribute('aria-label', 'Automation name');
  nameInput.onchange = () => { a.name = nameInput.value.trim() || a.name; saveAutomations(); };
  const changeIcon = el('button', 'text-btn');
  changeIcon.type = 'button';
  changeIcon.textContent = 'Change icon';
  changeIcon.onclick = () => { iconGrid.hidden = !iconGrid.hidden; };
  nameWrap.append(nameInput, changeIcon);
  head.append(iconTile, nameWrap);
  body.append(back, el('h2', 'auto-crumb', 'Automations \u203a ' + a.name), head, iconGrid);
  const trigHead = el('h3', 'auto-section-head', 'Triggers');
  const trig = el('div', 'auto-trigger');
  const clock = el('span', 'auto-clock');
  clock.innerHTML = '<svg><use href="#i-clock"/></svg>';
  const cadence = el('button', 'auto-pill');
  cadence.type = 'button';
  cadence.textContent = a.cadence + ' \u2304';
  cadence.onclick = () => showMenu(cadence, ['Daily', 'Weekdays', 'Weekly', 'Monthly'].map(c => ({ label: c, onClick: () => { a.cadence = c; cadence.textContent = c + ' \u2304'; saveAutomations(); } })));
  const at = el('span', 'auto-at', 'at');
  const timePill = el('button', 'auto-pill');
  timePill.type = 'button';
  timePill.textContent = a.time;
  timePill.onclick = () => {
    const input = document.createElement('input');
    input.className = 'auto-time-input';
    input.value = a.time;
    input.onchange = () => { a.time = input.value.trim() || '7:30 AM'; timePill.textContent = a.time; saveAutomations(); };
    timePill.replaceWith(input);
    input.focus();
  };
  const removeTrig = el('button', 'icon-button auto-remove-trigger');
  removeTrig.type = 'button';
  removeTrig.innerHTML = '<svg><use href="#i-trash"/></svg>';
  removeTrig.title = 'Remove trigger';
  removeTrig.onclick = () => { a.cadence = ''; a.time = ''; trig.replaceChildren(); trig.append(el('button', 'auto-pill', 'Add trigger')); saveAutomations(); };
  trig.append(clock, cadence, at, timePill, removeTrig);
  const instrHead = el('h3', 'auto-section-head', 'Instructions');
  const instr = document.createElement('textarea');
  instr.className = 'auto-instructions';
  instr.value = a.instructions;
  instr.setAttribute('aria-label', 'Instructions');
  instr.onchange = () => { a.instructions = instr.value; saveAutomations(); };
  const toolbar = el('div', 'auto-toolbar');
  const attach = el('button', 'auto-tool');
  attach.type = 'button';
  attach.innerHTML = '<svg><use href="#i-plus"/></svg><span>Attach</span>';
  attach.onclick = () => $('attachment').click();
  const conn = el('button', 'auto-tool');
  conn.type = 'button';
  conn.innerHTML = `<span>Connectors ${a.connectors.length}</span>`;
  conn.onclick = () => showMenu(conn, [{ label: 'No connectors available', disabled: true, onClick: () => {} }]);
  const sk = el('button', 'auto-tool');
  sk.type = 'button';
  sk.innerHTML = `<span>Skills ${a.skills.length}</span>`;
  sk.onclick = () => showMenu(sk, [
    ...FILE_SKILLS.map(([id, label]) => ({ label, checked: a.skills.includes(id), onClick: () => { const i = a.skills.indexOf(id); if (i >= 0) a.skills.splice(i, 1); else a.skills.push(id); saveAutomations(); } })),
    ...state.customSkills.map(s => ({ label: s.name, checked: a.skills.includes(s.name), onClick: () => { const i = a.skills.indexOf(s.name); if (i >= 0) a.skills.splice(i, 1); else a.skills.push(s.name); saveAutomations(); } })),
  ]);
  const modelPill = el('button', 'auto-tool');
  modelPill.type = 'button';
  modelPill.textContent = shortModelLabel(a.model) + ' \u2304';
  modelPill.onclick = () => showMenu(modelPill, state.models.map(m => ({ label: shortModelLabel(m.id), checked: m.id === a.model, onClick: () => { a.model = m.id; modelPill.textContent = shortModelLabel(m.id) + ' \u2304'; saveAutomations(); } })));
  toolbar.append(attach, conn, sk, modelPill);
  const notifHead = el('h3', 'auto-section-head', 'Notification');
  const notif = el('button', 'auto-pill notif');
  notif.type = 'button';
  notif.textContent = '\uD83D\uDD14 ' + a.notify + ' \u2304';
  notif.onclick = () => showMenu(notif, ['Email + App', 'App only'].map(n => ({ label: n, onClick: () => { a.notify = n; notif.textContent = '\uD83D\uDD14 ' + n + ' \u2304'; saveAutomations(); } })));
  const bar = el('div', 'auto-save-bar');
  const cancel = el('button', 'auto-cancel', 'Cancel');
  cancel.type = 'button';
  // Grok semantics: Cancel does NOT delete an automation that was created
  // by Add — it only leaves the detail view.
  cancel.onclick = () => openSettings('automations');
  const save = el('button', 'auto-save', 'Save');
  save.type = 'button';
  save.onclick = () => {
    const i = state.savedAutomations.findIndex(x => x.id === a.id);
    if (i >= 0) state.savedAutomations[i] = a; else state.savedAutomations.unshift(a);
    saveAutomations();
    openSettings('automations');
    toast('Automation saved in this browser. Janna can\u2019t run automations yet.');
  };
  bar.append(cancel, save);
  body.append(trigHead, trig, instrHead, instr, toolbar, notifHead, notif, bar);
}

/* ---------- Connect Apps (Grok's Connect Apps list, review #3) ---------- */
/* Recommended rows carry Grok's REAL 2-line descriptions (review #3).
   Other apps keep the category as the grey sub-line — their descriptions
   were never observed, so they are not invented. */
const CONNECT_APPS = {
  recommended: [
    { name: 'Gmail', desc: 'Search inbox, summarize, and draft.', cat: 'Google Workspace' },
    { name: 'Google Drive', desc: 'Find files and answers in your docs.', cat: 'Google Workspace' },
    { name: 'Google Calendar', desc: 'Check your schedule and plan meetings.', cat: 'Google Workspace' },
    { name: 'GitHub', desc: 'Look up code, issues, and pull requests.', cat: 'Developer' },
    { name: 'Finance', desc: 'Securely connect financial accounts', cat: 'Finance' },
    { name: 'Notion', desc: 'Search your pages, docs, and databases.', cat: 'Productivity' },
  ],
  categories: [
    ['Advertising', ['X Ads']],
    ['Analytics', ['Google Cloud BigQuery']],
    ['Apps', ['Expensify', 'Paypal', 'Zapier']],
    ['Developer', ['GitHub', 'Datadog', 'Excalidraw', 'Mixpanel', 'Netlify', 'Vercel']],
    ['Finance', ['Finance', 'Bigdata.com', 'Coinbase', 'Daloopa', 'Finary', 'Interactive Brokers (IBKR)']],
    ['Google Workspace', ['Gmail', 'Google Calendar', 'Google Drive']],
    ['Payments', ['Stripe']],
    ['Productivity', ['Outlook', 'Outlook Calendar', 'Asana', 'Atlassian', 'Calendly', 'Canva']],
    ['Sales', ['HubSpot', 'Meltwater']],
    ['Social Media', ['Buffer', 'Metricool']],
    ['Storage', ['Box']],
  ],
};
const CONNECTOR_CHIPS = ['All', 'Advertising', 'Analytics', 'Apps', 'Developer', 'Finance'];
const CONNECTOR_MORE_CHIPS = ['Google Workspace', 'Payments', 'Productivity', 'Sales', 'Social Media', 'Storage'];
function openConnectorDetail(app) {
  openSettings('connectors');
  const body = $('settingsBody');
  body.replaceChildren();
  const back = el('button', 'settings-back', '\u2190 Connect Apps');
  back.type = 'button';
  back.onclick = () => openSettings('connectors');
  const head = el('div', 'conn-detail-head');
  const tile = el('span', 'conn-tile-lg');
  tile.textContent = (app.name || '?')[0];
  const nameWrap = el('div', 'conn-detail-name');
  nameWrap.append(el('h2', '', app.name));
  nameWrap.append(el('span', 'conn-detail-cat', app.cat || 'Productivity'));
  const connect = el('button', 'primary-pill conn-connect', 'Connect');
  connect.type = 'button';
  connect.onclick = () => toast(app.name + ' can\u2019t be connected in the web version.');
  head.append(tile, nameWrap, connect);
  body.append(back, el('h2', 'conn-crumb', 'Connect Apps \u203a ' + app.name), head);
  if (app.name === 'Gmail') {
    body.append(el('p', 'conn-intro', 'Give Janna access to search your emails.'));
    const about = el('div', 'conn-about');
    about.append(el('h3', '', 'About this Connector'));
    const items = [
      ['Search your emails', 'Search your inbox, summarize unread emails, and find messages from specific people.'],
      ['We never train on your data', 'Janna AI does not train on your Gmail data.'],
      ['Your emails stay in Gmail', 'We don\u2019t store your emails. Janna searches Gmail in real-time when you ask questions.'],
    ];
    for (const [t, d] of items) {
      const row = el('div', 'conn-about-row');
      row.append(el('strong', '', t), el('p', '', d));
      about.append(row);
    }
    body.append(about);
  } else {
    body.append(el('p', 'conn-intro', app.desc || (app.name + ' can\u2019t be connected in the web version.')));
  }
  body.append(el('p', 'conn-disclaimer', 'Third-party connectors are not built or maintained by Janna AI. Use caution when granting access to external services. Review the permissions before connecting. Usage is subject to the Janna AI Privacy Policy.'));
}
function renderConnectors(body, search, chip, connectedOnly) {
  const head = el('div', 'conn-rec-head');
  const appsBtn = el('button', 'primary-pill', 'Your apps \u2014 0 connected \u203a');
  appsBtn.type = 'button';
  appsBtn.onclick = () => renderSettingsBody('connectors', { connectedOnly: !connectedOnly });
  head.append(appsBtn);
  body.append(head);
  if (connectedOnly) {
    body.append(el('div', 'empty-state', 'No apps connected yet.'));
    return;
  }
  const searchBox = document.createElement('input');
  searchBox.className = 'conn-search';
  searchBox.placeholder = 'Search apps';
  searchBox.value = search || '';
  searchBox.oninput = () => renderSettingsBody('connectors', { search: searchBox.value, chip });
  body.append(searchBox);
  const chips = el('div', 'conn-chips');
  for (const c of CONNECTOR_CHIPS) {
    const b = el('button', 'chip' + (chip === c ? ' active' : ''));
    b.type = 'button';
    b.textContent = c;
    b.onclick = () => renderSettingsBody('connectors', { search, chip: c });
    chips.append(b);
  }
  const more = el('button', 'chip');
  more.type = 'button';
  more.textContent = 'More \u2304';
  more.onclick = () => showMenu(more, CONNECTOR_MORE_CHIPS.map(c => ({ label: c, onClick: () => renderSettingsBody('connectors', { search, chip: c }) })));
  chips.append(more);
  body.append(chips);
  const q = (search || '').toLowerCase();
  const matchChip = (cat) => chip === 'All' || cat === chip;
  const renderRow = (app) => {
    const row = el('div', 'connector-row');
    const tile = el('span', 'conn-tile');
    tile.textContent = (app.name || '?')[0];
    const info = el('div', 'conn-info');
    info.append(el('strong', '', app.name));
    info.append(el('span', 'conn-sub', app.desc || app.cat));
    const connect = el('button', 'primary-pill conn-connect', 'Connect');
    connect.type = 'button';
    connect.onclick = () => openConnectorDetail(app);
    row.append(tile, info, connect);
    return row;
  };
  const rec = CONNECT_APPS.recommended.filter(a => (!q || a.name.toLowerCase().includes(q)) && matchChip(a.cat));
  if (rec.length && chip === 'All') {
    const rh = el('div', 'conn-rec-head');
    rh.append(el('h3', '', 'Recommended for you'));
    const viewAll = el('button', 'text-btn');
    viewAll.type = 'button';
    viewAll.textContent = 'View all';
    viewAll.onclick = () => renderSettingsBody('connectors', { search, chip: 'All' });
    rh.append(viewAll);
    body.append(rh);
    for (const a of rec) body.append(renderRow(a));
  }
  for (const [cat, names] of CONNECT_APPS.categories) {
    if (!matchChip(cat)) continue;
    const rows = names.map(n => {
      const rec = CONNECT_APPS.recommended.find(r => r.name === n);
      return { name: n, cat, desc: rec ? rec.desc : cat };
    }).filter(a => !q || a.name.toLowerCase().includes(q));
    if (!rows.length) continue;
    body.append(el('h3', 'conn-cat-head', cat));
    for (const a of rows) body.append(renderRow(a));
  }
  const add = el('button', 'primary-pill conn-add-custom', 'Add a custom connector');
  add.type = 'button';
  add.onclick = () => openToolsPanel();
  body.append(add);
}

/* ---------- settings (Grok's 9 sections, review #2) ---------- */
const SETTING_SECTIONS = ['account', 'appearance', 'behavior', 'notifications', 'customize', 'connectors', 'skills', 'automations', 'data'];
const SETTING_LABELS = {
  account: 'Account', appearance: 'Appearance', behavior: 'Behavior',
  notifications: 'Notifications', customize: 'Customize', connectors: 'Connect Apps',
  skills: 'Skills', automations: 'Automations', data: 'Data Controls',
};
let settingsState = {};
function openSettings(section, opts) {
  closeMenus();
  settingsState = opts || {};
  $('settingsView').hidden = false;
  renderSettingsBody(section || state.settings.section || 'account', opts);
}
function closeSettings() { $('settingsView').hidden = true; }
function renderSettingsBody(section, opts) {
  section = section || state.settings.section || 'account';
  state.settings.section = section;
  settingsState = opts || settingsState;
  const body = $('settingsBody');
  body.replaceChildren();
  const nav = $('settingsNav');
  nav.replaceChildren();
  for (const s of SETTING_SECTIONS) {
    const b = el('button', 'settings-nav-item' + (s === section ? ' active' : ''));
    b.type = 'button';
    b.textContent = SETTING_LABELS[s];
    b.onclick = () => renderSettingsBody(s);
    nav.append(b);
  }
  const st = $('settingsTitle');
  if (st) st.textContent = SETTING_LABELS[section];
  if (section === 'account') {
    const card = el('div', 'settings-card');
    const avatar = el('span', 'settings-avatar avatar');
    avatar.textContent = 'J';
    const who = el('div', 'settings-who');
    who.append(el('strong', '', 'Workspace Guest'), el('span', 'muted', 'No sign-in needed — Janna AI is free.'));
    const plan = el('div', 'settings-plan');
    plan.append(el('span', '', 'Plan: Free'), el('span', 'muted', 'All models are free, no limits.'));
    const lang = el('label', 'settings-row');
    lang.append(el('span', '', 'Language'));
    const sel = document.createElement('select');
    sel.className = 'settings-select';
    sel.setAttribute('aria-label', 'Language');
    for (const l of ['English', 'Tagalog']) {
      const o = document.createElement('option');
      o.value = l; o.textContent = l;
      sel.append(o);
    }
    sel.value = state.settings.language === 'Tagalog' ? 'Tagalog' : 'English';
    sel.onchange = () => persistSettings({ language: sel.value });
    lang.append(sel);
    card.append(avatar, who, plan, lang);
    body.append(card);
    body.append(el('p', 'settings-note', 'Your chats stay in this browser. Clear them any time from Data Controls.'));
  } else if (section === 'appearance') {
    const themeRow = el('div', 'settings-row');
    themeRow.append(el('span', '', 'Theme'));
    const sel = document.createElement('select');
    sel.className = 'settings-select';
    sel.setAttribute('aria-label', 'Theme');
    for (const m of ['system', 'light', 'dark']) {
      const o = document.createElement('option');
      o.value = m; o.textContent = m[0].toUpperCase() + m.slice(1);
      sel.append(o);
    }
    sel.value = state.settings.appearance_mode || 'system';
    sel.onchange = () => { persistSettings({ appearance_mode: sel.value }); applyTheme(); };
    themeRow.append(sel);
    const wrap = el('label', 'settings-row');
    wrap.append(el('span', '', 'Wrap Long Code Blocks'), el('small', 'muted', 'Wrap long lines in code blocks by default'));
    const wrapT = document.createElement('input');
    wrapT.type = 'checkbox'; wrapT.checked = state.settings.wrap_code === true;
    wrapT.onchange = () => { persistSettings({ wrap_code: wrapT.checked }); applyTheme(); };
    wrap.append(wrapT);
    const motion = el('label', 'settings-row');
    motion.append(el('span', '', 'Reduce motion'));
    const motionT = document.createElement('input');
    motionT.type = 'checkbox'; motionT.checked = state.settings.reduce_motion === true;
    motionT.onchange = () => { persistSettings({ reduce_motion: motionT.checked }); applyTheme(); };
    motion.append(motionT);
    const sugg = el('label', 'settings-row');
    sugg.append(el('span', '', 'Show suggestions'), el('small', 'muted', 'Starter prompts on new chats and follow-ups under replies'));
    const suggT = document.createElement('input');
    suggT.type = 'checkbox'; suggT.checked = state.settings.show_suggestions !== false;
    suggT.onchange = () => { persistSettings({ show_suggestions: suggT.checked }); renderSuggestions(); };
    sugg.append(suggT);
    body.append(themeRow, wrap, motion, sugg);
  } else if (section === 'behavior') {
    const rows = [
      ['voice_output', 'Read replies aloud', 'Speak each reply when it finishes.'],
      ['browser_notifications', 'Browser notifications', 'Notify when a reply finishes while the tab is hidden.'],
      ['research_mode', 'Web research', ''],
    ];
    for (const [key, label, sub] of rows) {
      const row = el('div', 'settings-row');
      row.append(el('span', '', label));
      if (sub) row.append(el('small', 'muted', sub));
      if (key === 'research_mode') {
        const sel = document.createElement('select');
        sel.className = 'settings-select';
        sel.setAttribute('aria-label', 'Web research');
        for (const [v, t] of [['auto', 'Auto'], ['always', 'Always']]) {
          const o = document.createElement('option');
          o.value = v; o.textContent = t;
          sel.append(o);
        }
        sel.value = state.settings.research_mode === 'always' ? 'always' : 'auto';
        sel.onchange = () => persistSettings({ research_mode: sel.value });
        row.append(sel);
      } else {
        const t = document.createElement('input');
        t.type = 'checkbox'; t.checked = state.settings[key] === true;
        t.onchange = () => persistSettings({ [key]: t.checked });
        row.append(t);
      }
      body.append(row);
    }
    const voiceRow = el('div', 'settings-row');
    voiceRow.append(el('span', '', 'Voice'), el('small', 'muted', 'Voice mode and read-aloud voice'));
    const vb = el('button', 'primary-pill');
    vb.type = 'button';
    vb.textContent = 'Open voice mode';
    vb.onclick = () => { closeSettings(); openVoiceMode(); };
    voiceRow.append(vb);
    body.append(voiceRow);
  } else if (section === 'notifications') {
    const row = el('div', 'settings-row');
    row.append(el('span', '', 'Browser notifications'), el('small', 'muted', 'Notify when a reply finishes while the tab is hidden.'));
    const t = document.createElement('input');
    t.type = 'checkbox'; t.checked = state.settings.browser_notifications === true;
    t.onchange = async () => {
      if (t.checked && 'Notification' in window && Notification.permission === 'default') {
        try { await Notification.requestPermission(); } catch { /* ignore */ }
      }
      persistSettings({ browser_notifications: t.checked });
    };
    row.append(t);
    body.append(row);
  } else if (section === 'customize') {
    body.append(el('p', 'settings-note', 'Janna AI has no accounts, so there is no per-account name or personality to set. The shell keeps the grok.com layout — Janna AI branding only.'));
    const row = el('div', 'settings-row');
    row.append(el('span', '', 'Show suggestions'));
    const t = document.createElement('input');
    t.type = 'checkbox'; t.checked = state.settings.show_suggestions !== false;
    t.onchange = () => { persistSettings({ show_suggestions: t.checked }); renderSuggestions(); };
    row.append(t);
    body.append(row);
  } else if (section === 'connectors') {
    renderConnectors(body, settingsState.search, settingsState.chip || 'All', settingsState.connectedOnly);
  } else if (section === 'skills') {
    for (const [id, label] of FILE_SKILLS) {
      const row = el('div', 'settings-row');
      row.append(el('span', '', label));
      const b = el('button', 'primary-pill');
      b.type = 'button';
      b.textContent = 'Use';
      b.onclick = () => { closeSettings(); $('prompt').value = 'Create a ' + label.toLowerCase() + ' for me: '; autoGrowPrompt(); syncSendState(); $('prompt').focus(); };
      row.append(b);
      body.append(row);
    }
    for (const s of state.customSkills) {
      const row = el('div', 'settings-row');
      row.append(el('span', '', s.name));
      const b = el('button', 'text-btn');
      b.type = 'button';
      b.textContent = 'Delete';
      b.onclick = () => { state.customSkills = state.customSkills.filter(x => x !== s); saveSkills(); renderSettingsBody('skills'); };
      row.append(b);
      body.append(row);
    }
    const add = el('button', 'primary-pill', 'New skill');
    add.type = 'button';
    add.onclick = addCustomSkill;
    body.append(add);
  } else if (section === 'automations') {
    const search = document.createElement('input');
    search.className = 'auto-search';
    search.placeholder = 'Search automations';
    search.setAttribute('aria-label', 'Search automations');
    search.oninput = () => renderAutomationCatalog(body, search.value, settingsState.cat || 'All');
    body.append(search);
    renderAutomationCatalog(body, '', settingsState.cat || 'All');
  } else if (section === 'data') {
    body.append(el('p', 'settings-note', 'Your chats, projects, automations and files are stored only in this browser.'));
    const clear = el('button', 'danger-pill', 'Clear all chats');
    clear.type = 'button';
    clear.onclick = async () => {
      const ok = await confirmDialog('Clear all chats?', 'This deletes every chat in this browser. It cannot be undone.');
      if (!ok) return;
      try { await api('/api/sessions/clear', {}); } catch { /* local state still clears */ }
      state.sessions = []; state.session = null; state.chatProjects = {}; saveChatProjects();
      renderSidebar(); renderConversation(null); closeSettings();
      toast('All chats cleared.');
    };
    const exportBtn = el('button', 'primary-pill', 'Export all chats');
    exportBtn.type = 'button';
    exportBtn.onclick = async () => {
      try {
        const blob = await api('/api/profile/export', {});
        const text = typeof blob === 'string' ? blob : JSON.stringify(blob, null, 2);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        a.download = 'janna-ai-export.json';
        a.click();
      } catch { toast('Export failed.'); }
    };
    body.append(clear, exportBtn);
    const legal = el('button', 'text-btn');
    legal.type = 'button';
    legal.textContent = 'Your privacy choices';
    legal.onclick = openLegal;
    body.append(legal);
  }
  const foot = el('div', 'settings-foot');
  foot.append(el('span', '', 'Janna AI is free — no Premium, no sign-in.'));
  body.append(foot);
}
function renderAutomationCatalog(body, query, cat) {
  body.querySelectorAll('.auto-cat, .auto-cat-head, .auto-owned, .auto-empty').forEach(n => n.remove());
  const q = (query || '').toLowerCase();
  if (state.savedAutomations.length) {
    const owned = el('div', 'auto-owned');
    owned.append(el('h3', 'auto-cat-head', 'Your automations'));
    for (const a of state.savedAutomations) {
      const row = el('div', 'auto-owned-row');
      row.append(el('span', 'auto-owned-name', a.name));
      row.append(el('span', 'muted', (a.cadence ? a.cadence + ' ' : '') + (a.time || '')));
      const open = el('button', 'text-btn');
      open.type = 'button';
      open.textContent = 'Open';
      open.onclick = () => openAutomationDetail(a.name, a);
      const del = el('button', 'text-btn');
      del.type = 'button';
      del.textContent = 'Remove';
      del.onclick = () => { removeAutomation(a.id); renderSettingsBody('automations'); };
      row.append(open, del);
      owned.append(row);
    }
    body.append(owned);
  }
  const cats = ['All', 'News', 'Productivity', 'Finance', 'Research', 'Lifestyle'];
  const chips = el('div', 'auto-cat auto-chips');
  for (const c of cats) {
    const b = el('button', 'chip' + (cat === c ? ' active' : ''));
    b.type = 'button';
    b.textContent = c;
    b.onclick = () => renderSettingsBody('automations', { cat: c });
    chips.append(b);
  }
  body.append(chips);
  for (const s of AUTOMATIONS) {
    if (cat !== 'All' && s.section !== cat && s.section !== 'Featured') continue;
    const items = s.items.filter(a => !q || a.name.toLowerCase().includes(q) || a.desc.toLowerCase().includes(q));
    if (!items.length) continue;
    body.append(el('h3', 'auto-cat-head', s.section));
    for (const a of items) {
      const row = el('div', 'auto-cat-row');
      row.append(el('span', 'auto-cat-name', a.name));
      row.append(el('span', 'muted', a.desc));
      const add = el('button', 'primary-pill', 'Add');
      add.type = 'button';
      // Grok semantics: Add creates the automation immediately, then
      // opens its detail for editing.
      add.onclick = () => openAutomationDetail(a.name);
      row.append(add);
      body.append(row);
    }
  }
}

/* ---------- account menu (no accounts — Settings + Help only) ---------- */
function renderAccountMenu(view) {
  const menu = $('accountMenu');
  menu.replaceChildren();
  const items = [];
  if (view === 'help') {
    items.push({ label: '\u2039 Help', onClick: () => renderAccountMenu('main') });
    items.push({ label: 'FAQ', onClick: openHelp });
    items.push({ label: 'Community', onClick: () => window.open('https://github.com/JepongDevxyz/Janna-AI', '_blank') });
    items.push({ label: 'Changelog', onClick: openChangelog });
    items.push({ label: 'Send Feedback', onClick: () => openFeedback(null, 'feedback') });
    items.push({ label: 'Shared Links', onClick: openSharedLinks });
  } else {
    items.push({ label: 'Settings', icon: 'i-settings', onClick: () => { menu.hidden = true; openSettings('account'); } });
    items.push({ label: 'Help', icon: 'i-help', chevron: true, onClick: () => renderAccountMenu('help') });
  }
  for (const it of items) {
    const b = el('button', 'account-menu-item');
    b.type = 'button';
    b.innerHTML = `${it.icon ? `<svg><use href="#${it.icon}"/></svg>` : ''}<span>${escapeHTML(it.label)}</span>${it.chevron ? '<span class="account-menu-chevron">\u203a</span>' : ''}`;
    b.onclick = it.onClick;
    menu.append(b);
  }
  menu.hidden = false;
}
function toggleAccountMenu() {
  const menu = $('accountMenu');
  if (menu.hidden) { closeMenus(); renderAccountMenu('main'); }
  else menu.hidden = true;
}
function openHelp() {
  return showDialog({ title: 'Help — Janna AI', text: 'Janna AI is free with no sign-in. Your chats stay in this browser.\n\n\u2022 New chat: tap New chat in the sidebar, or Ctrl+J.\n\u2022 Change model: tap the model chip in the composer.\n\u2022 Voice: tap the microphone to dictate, or the waveform for voice mode.\n\u2022 Projects: keep instructions and files for a conversation.\n\u2022 Library: files you upload stay in this browser.', okText: 'Close', showCancel: false });
}
function openChangelog() {
  showDialog({ title: 'What\u2019s new \u2014 Janna AI',
    text: 'v68 \u2014 Rebuilt from scratch on the grok.com deep review #3: user bubbles never wrap vertically, the live header is just "Thinking" + "Planning next moves" with no timer, no "Thought for" line after replies, the running composer keeps "Ask anything\u2026" with a black square Stop, follow-up pills stack right-aligned, example projects use grok\u2019s full texts, Connect Apps uses grok\u2019s real descriptions, and automation Add creates immediately like grok.\n\nv67 \u2014 New Project dialog with a 64-icon picker, example projects, Automation detail + local save, Connect Apps list + Gmail detail, Help menu, palette empty states.\n\nv66 \u2014 Model picker bottom sheet, jump button inside the composer, thread title pill, private home, read-aloud bar, home autocomplete, code line numbers, Library empty state.\n\nv62 \u2014 Settings in 9 sections, Skills + Automations, all-three rotating suggestions, follow-up pills, sidebar row menu, trimmed reply menu.',
    okText: 'Close', showCancel: false });
}
function openFeedback(message, kind) {
  const wrap = el('div', 'feedback-form');
  const label = el('p', '', kind === 'report' ? 'Report this message:' : 'Tell us what you think:');
  const input = document.createElement('textarea');
  input.placeholder = kind === 'report' ? 'What was wrong with this message?' : 'Your feedback\u2026';
  input.rows = 4;
  const send = el('button', 'primary-pill', 'Send feedback');
  send.type = 'button';
  send.onclick = () => { toast('Thanks for the feedback.'); document.querySelector('.dialog-overlay')?.remove(); };
  wrap.append(label, input, send);
  const overlay = el('div', 'dialog-overlay');
  const card = el('div', 'dialog-card');
  const close = el('button', 'icon-button dialog-close');
  close.type = 'button';
  close.innerHTML = '<svg><use href="#i-close"/></svg>';
  close.onclick = () => overlay.remove();
  card.append(close, el('h2', '', kind === 'report' ? 'Report message' : 'Send feedback'), wrap);
  overlay.append(card);
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  document.body.append(overlay);
}
function openSharedLinks() {
  showDialog({ title: 'Shared Links', text: 'Janna AI has no server-side share links. Use Share in a reply\u2019s More menu to copy a conversation as text instead.', okText: 'Close', showCancel: false });
}
function openLegal() {
  showDialog({ title: 'Your privacy choices', text: 'Janna AI is free with no accounts. Chats, projects, automations and files live only in this browser. Clear them any time from Data Controls. The web version never trains on your chats.', okText: 'Close', showCancel: false });
}
function openToolsPanel() {
  showDialog({ title: 'Add a custom connector', text: 'Custom connectors are not available in the web version. Connect Apps lists the apps Janna knows about.', okText: 'Close', showCancel: false });
}

/* ---------- voice ---------- */
function voiceSpeak(text) {
  if (!('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const plain = String(text || '').replace(/[#*_`>\[\]()]/g, '').slice(0, 4000);
    if (!plain.trim()) return;
    const u = new SpeechSynthesisUtterance(plain);
    const voices = speechSynthesis.getVoices();
    const want = state.settings.voice_name || '';
    const v = voices.find(x => x.name === want) || voices.find(x => x.lang && x.lang.startsWith('en')) || voices[0];
    if (v) u.voice = v;
    const rate = parseFloat(state.settings.voice_rate || '1') || 1;
    u.rate = Math.min(2, Math.max(0.5, rate));
    speechSynthesis.speak(u);
  } catch { /* TTS is best-effort */ }
}
function openVoiceMode() {
  const overlay = $('voiceOverlay');
  overlay.hidden = false;
  const rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!rec) { toast('Voice mode needs a browser with speech recognition.'); overlay.hidden = true; return; }
  const r = new rec();
  r.continuous = true;
  r.interimResults = true;
  r.lang = (state.settings.language || 'English') === 'Tagalog' ? 'fil-PH' : 'en-US';
  r.onresult = e => {
    let final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) final += e.results[i][0].transcript;
    }
    if (final) {
      $('prompt').value = final; autoGrowPrompt(); syncSendState();
      const cap = $('voiceCaption');
      if (cap) cap.textContent = final;
    }
  };
  r.onerror = () => { overlay.hidden = true; toast('Microphone access denied. Check your browser settings.'); };
  r.onend = () => { overlay.hidden = true; };
  state.voiceRecognizer = r;
  try { r.start(); } catch { overlay.hidden = true; }
  $('voiceClose').onclick = () => { try { r.stop(); } catch { /* ignore */ } overlay.hidden = true; };
  $('voiceOrb').onclick = () => { try { r.stop(); } catch { /* ignore */ } overlay.hidden = true; };
  $('voiceSend').onclick = () => { try { r.stop(); } catch { /* ignore */ } overlay.hidden = true; send(); };
}
function startDictation() {
  const rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!rec) { toast('Dictation needs a browser with speech recognition.'); return; }
  if (state.voiceListening) { try { state.voiceRecognizer.stop(); } catch { /* ignore */ } state.voiceListening = false; return; }
  const r = new rec();
  r.continuous = false;
  r.interimResults = false;
  r.lang = (state.settings.language || 'English') === 'Tagalog' ? 'fil-PH' : 'en-US';
  r.onresult = e => {
    const text = e.results[0][0].transcript;
    $('prompt').value = ($('prompt').value ? $('prompt').value + ' ' : '') + text;
    autoGrowPrompt(); syncSendState();
  };
  r.onerror = () => { state.voiceListening = false; toast('Microphone access denied. Check your browser settings.'); };
  r.onend = () => { state.voiceListening = false; };
  state.voiceRecognizer = r;
  state.voiceListening = true;
  try { r.start(); } catch { state.voiceListening = false; }
}

/* ---------- right pane (Grok's "Toggle right pane": opens a pane with
   "Open a file… Ctrl O" — the grid icon is NOT Library) ---------- */
function openRightPane(name, url) {
  const pane = $('rightPane');
  pane.hidden = false;
  if (url) {
    $('rightPaneName').textContent = name || 'Preview';
    state.rightPaneUrl = url;
    $('rightPanePreview').hidden = false;
    $('rightPaneEmpty').hidden = true;
    previewHtml(url);
  } else {
    $('rightPaneName').textContent = '';
    $('rightPanePreview').hidden = true;
    $('rightPaneEmpty').hidden = false;
  }
}
function closeRightPane() { $('rightPane').hidden = true; }
function previewHtml(url) {
  const iframe = $('rightPaneFrame');
  state.rightPaneUrl = url;
  if (iframe) {
    iframe.srcdoc = '';
    iframe.src = url;
  }
}

/* ---------- boot ---------- */
/* ---------- bootstrap (v67 contract: plain /api/* fetches through the
   adapter's patched fetch — there is no window.JannaWeb object) ---------- */
let reconnectTimer = null;
async function initialConnection() {
  try {
    const info = await api('/api/remote-info');
    state.remote = info.remote === true;
    const saved = (() => { try { return localStorage.getItem('janna-pair-token') || ''; } catch { return ''; } })();
    if (state.remote) state.token = info.pair_required === true ? saved : 'web';
    else state.token = 'web';
    // Hosted web is never a remote desktop (the adapter answers
    // remote:false), so there is no pairing flow here.
  } catch { state.token = 'web'; }
}
function modelRecord(id) { return state.modelCatalog.find(m => m.id === id) || { id, label: id, note: 'Cloud model', model_class: 'Janna Cloud' }; }
function renderModelOptions(models) {
  // A local-first bootstrap with no cached catalog yet returns an empty
  // list — that means "not loaded yet", not "no models". Keep the seeded
  // model label instead of blanking it to "Choose a model".
  if (!models || !models.length) { syncModelPicker(); return; }
  state.models = models || [];
  const current = state.model || (() => { try { return localStorage.getItem('janna-selected-model') || ''; } catch { return ''; } })();
  const ordered = [];
  const seen = new Set();
  for (const row of state.modelCatalog) { if (state.models.includes(row.id) && !seen.has(row.id)) { ordered.push(row); seen.add(row.id); } }
  for (const id of state.models) { if (!seen.has(id)) { ordered.push(modelRecord(id)); seen.add(id); } }
  state.model = ordered.some(r => r.id === current) ? current : (ordered[0]?.id || '');
  syncModelPicker();
  refreshNativeLevels();
}
async function refreshBootstrap(force) {
  try {
    const b = await api('/api/bootstrap');
    state.booted = true;
    state.bootFailed = false;
    // A local-first reply with no model list yet means "still loading",
    // not "offline" — the network refresh follows on the event.
    if (b.local !== true || (b.models && b.models.length)) state.modelsKnown = true;
    if (typeof b.token === 'string' && b.token && !state.remote) state.token = b.token;
    state.projects = b.projects || [];
    state.sessions = b.sessions || [];
    state.languages = b.languages || [];
    if (b.settings) state.settings = b.settings;
    if (b.model_catalog) state.modelCatalog = b.model_catalog;
    renderModelOptions(b.models || []);
    applyTheme();
    if (state.session) {
      const fresh = findSession(state.session.id);
      if (fresh && Array.isArray(fresh.messages)) state.session = fresh;
    }
    renderSidebar();
    renderProjects();
    renderLibrary();
    renderSuggestions();
    syncPrivate();
    statusBadge();
  } catch (e) {
    state.booted = true;
    state.bootFailed = true;
    statusBadge();
  }
}
function reconnectCheck() {
  try { refreshBootstrap(true); } catch { /* next cycle */ }
}
function initializeWorkspace() {
  // URL params only (?s=<session id>, ?_s=<settings section>) — the boot
  // sequence lives in the DOMContentLoaded handler below.
  const params = new URLSearchParams(location.search);
  const open = params.get('s');
  const settingsSection = params.get('_s');
  if (settingsSection) openSettings(settingsSection);
  if (open) openSession(open);
}
function bindEvents() {
  const on = (id, ev, fn) => { const n = $(id); if (n) n.addEventListener(ev, fn); };
  const click = (id, fn) => on(id, 'click', fn);
  $('sidebarToggle').onclick = () => { state.sidebarOpen ? closeSidebar() : openSidebar(); };
  $('mobileScrim').onclick = closeSidebar;
  click('newChat', () => { newChat(); });
  click('chatsPlus', () => { newChat(); });
  click('headerSearch', () => openPalette());
  click('navLibrary', () => { closeSidebar(); openLibrary(); });
  $('libraryClose').onclick = closeLibrary;
  $('librarySearch').oninput = e => { state.libraryQuery = e.target.value; renderLibrary(); };
  $('libraryUpload').onclick = () => {
    if (state.libraryTab === 'apps') { $('prompt').value = 'Build an app: '; autoGrowPrompt(); syncSendState(); closeLibrary(); $('prompt').focus(); return; }
    $('libraryFileInput').click();
  };
  $('libraryFileInput').onchange = e => { addFilesToLibrary(e.target.files); renderLibrary(); e.target.value = ''; };
  click('libraryViewOptions', () => {
    state.librarySort = state.librarySort === 'date' ? 'name' : state.librarySort === 'name' ? 'oldest' : 'date';
    renderLibrary();
    toast(state.librarySort === 'name' ? 'Sorted by name' : state.librarySort === 'oldest' ? 'Oldest first' : 'Newest first');
  });
  const togglePrivate = () => { state.isPrivate = !state.isPrivate; renderConversation(state.isPrivate ? { id: 'private', title: 'Private chat', messages: state.privateThread } : state.session); syncPrivate(); };
  $('privateToggle').onclick = togglePrivate;
  click('profileOpen', toggleAccountMenu);
  click('sidebarSettings', () => openSettings('account'));
  click('newProjectBtn', () => openProjectDialog());
  click('projectsDots', () => showMenu($('projectsDots'), [{ label: 'New Project', onClick: () => openProjectDialog() }]));
  click('chatsDots', () => showMenu($('chatsDots'), [
    { label: 'New chat', onClick: newChat },
    { label: 'Clear all chats', danger: true, onClick: () => openSettings('data') },
  ]));
  const toggleSection = (headId, listId, extraId) => {
    const head = $(headId), list = $(listId);
    if (!head || !list) return;
    const collapsed = list.hidden;
    list.hidden = !collapsed;
    if (extraId) { const x = $(extraId); if (x) x.hidden = !collapsed; }
    head.setAttribute('aria-expanded', String(!collapsed));
  };
  click('projectsHead', () => toggleSection('projectsHead', 'projectList', 'newProjectBtn'));
  click('chatsHead', () => toggleSection('chatsHead', 'sessionList', 'showMoreChats'));
  // The Show more/less button is static HTML; renderSidebar only sets its
  // label/visibility — it had no click binding at all, so tapping it did
  // nothing (rig run 2).
  click('showMoreChats', () => { state.showAllChats = !state.showAllChats; renderSidebar(); });
  $('convMenuBtn').onclick = () => showMenu($('convMenuBtn'), [
    { label: 'New chat', onClick: newChat },
    { label: 'Search', onClick: openPalette },
    { label: 'Library', onClick: openLibrary },
    { label: 'Settings', onClick: () => openSettings('account') },
  ]);
  $('rightPaneToggle').onclick = () => { $('rightPane').hidden ? openRightPane() : closeRightPane(); };
  click('rightPaneHide', closeRightPane);
  click('appPreviewRow', () => { if ($('rightPanePreview').hidden) toast('Open a file to preview it here.'); });
  click('openFileRow', () => $('previewFileInput').click());
  $('previewFileInput').onchange = e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    openRightPane(f.name, URL.createObjectURL(f));
    e.target.value = '';
  };
  click('rightPaneCopy', async () => {
    if (!state.rightPaneUrl) return;
    const ok = await copyCodeText(state.rightPaneUrl);
    toast(ok ? 'Copied link' : 'Copy failed');
  });
  click('rightPaneDownload', () => { if (state.rightPaneUrl) window.open(state.rightPaneUrl, '_blank'); });
  click('rightPaneSource', async () => {
    const view = $('rightPaneSourceView'), frame = $('rightPaneFrame');
    if (!view || !frame || !state.rightPaneUrl) return;
    if (view.hidden) {
      try { view.textContent = await (await fetch(state.rightPaneUrl)).text(); } catch { view.textContent = 'Could not load the source.'; }
      view.hidden = false;
      frame.hidden = true;
      $('rightPaneSource').textContent = 'Preview';
    } else {
      view.hidden = true;
      frame.hidden = false;
      $('rightPaneSource').textContent = 'Source';
    }
  });
  click('termsLink', () => showDialog({ title: 'Terms', text: 'Janna AI is free with no sign-in and no limits. Chats stay in this browser. Be kind — don\u2019t use Janna to harm others.', okText: 'Close', showCancel: false }));
  click('privacyLink', openLegal);
  click('privacyChoicesLink', openLegal);
  $('settingsSearch').oninput = e => {
    const q = e.target.value.toLowerCase();
    [...$('settingsNav').children].forEach(b => { b.hidden = !!q && !b.textContent.toLowerCase().includes(q); });
  };
  $('jumpLatest').onclick = () => scrollThreadToBottom();
  $('send').onclick = send;
  $('stop').onclick = stopRun;
  $('plusBtn').onclick = openPlusMenu;
  $('plusScrim').onclick = closePlusMenu;
  $('voiceMic').onclick = startDictation;
  $('voiceModeBtn').onclick = openVoiceMode;
  $('modelPickerBtn').onclick = openModelPicker;
  $('attachment').onchange = e => { handleFiles(e.target.files); e.target.value = ''; };
  $('prompt').addEventListener('input', () => { autoGrowPrompt(); syncSendState(); });
  $('prompt').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!state.busy) send();
      // While busy Enter does nothing — the text stays in the box (Grok).
    }
    if (e.key === 'Escape') { closeMenus(); closeModelPicker(); closePlusMenu(); }
  });
  $('messages').addEventListener('scroll', () => {
    const m = $('messages');
    const nearBottom = m.scrollHeight - m.scrollTop - m.clientHeight < 120;
    $('jumpLatest').hidden = nearBottom;
  });
  $('settingsClose').onclick = closeSettings;
  $('paletteClose').onclick = closePalette;
  $('paletteInput').addEventListener('input', e => { renderPalette(e.target.value); });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); newChat(); }
    if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); openSettings('account'); }
    if (e.key === 'Escape') { closePalette(); closeLibrary(); closeSettings(); closePlusMenu(); closeModelPicker(); }
  });
  // Outside-click handler: closes anchored menus, the model picker and the
  // account menu. A click whose target was DETACHED during its own handler
  // (the Help submenu re-renders #accountMenu via replaceChildren, so the
  // clicked button is no longer connected) must NOT count as "outside" —
  // otherwise tapping Help closes the menu instead of opening the submenu.
  document.addEventListener('click', e => {
    if (!e.target || !e.target.isConnected) return;
    const t = e.target;
    if (!t.closest('#accountMenu') && !t.closest('#profileOpen')) { const m = $('accountMenu'); if (m) m.hidden = true; }
    if (!t.closest('.menu-pop') && !t.closest('[data-menu-anchor]')) closeMenus();
    if (!t.closest('#modelPicker') && !t.closest('#modelPickerBtn')) closeModelPicker();
    if (!t.closest('#plusMenu') && !t.closest('#plusBtn')) closePlusMenu();
  });
}
document.addEventListener('DOMContentLoaded', async () => {
  document.documentElement.classList.add('js');
  applyTheme();
  bindEvents();
  // Instant local first paint: chats + settings live in this browser, so
  // render the cached list before the network bootstrap returns — grok
  // shows history at once instead of an empty list. The local-first
  // bootstrap (web-adapter) replaces these with the same merged list.
  state.sessions = loadJSON('janna-web-sessions-v1', []);
  state.settings = Object.assign({}, state.settings, loadJSON('janna-web-settings-v1', {}));
  try { state.model = localStorage.getItem('janna-selected-model') || ''; } catch { /* ignore */ }
  renderSidebar();
  renderProjects();
  renderLibrary();
  renderSuggestions();
  syncPrivate();
  autoGrowPrompt();
  syncSendState();
  syncModelPicker();
  updateBusy();
  await initialConnection();
  await refreshBootstrap();
  renderConversation(state.session);
  initializeWorkspace();
  // The adapter serves the first bootstrap locally, then refreshes the
  // model list in the background — re-fetch when it lands.
  window.addEventListener('janna-bootstrap-refreshed', () => refreshBootstrap(true));
  window.addEventListener('online', () => reconnectCheck());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) reconnectCheck(); });
  if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme());
  reconnectTimer = setInterval(reconnectCheck, 10000);
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('/sw.js'); } catch { /* offline support is best-effort */ }
  }
});
