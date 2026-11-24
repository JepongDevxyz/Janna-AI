'use strict';
/* Janna AI — Grok-style shell (fresh reset, 2026-11-24).
   Reuses the existing API contract exactly: /api/bootstrap, /api/models,
   /api/run (SSE via JannaRuns), /api/sessions*, /api/settings, /api/stop,
   /api/reasoning/:model, /api/profile/export, /api/memory.
   The backend api/[...slug].js is unchanged.
   No Luna anywhere in this file. No fake Grok data: every control below has
   a real handler, and anything the web backend cannot do is omitted (see
   BUILD-REPORT.md). */
const $ = id => document.getElementById(id);
const state = {
  token: '', remote: false, projects: [], sessions: [], session: null,
  models: [], modelCatalog: [], model: '', modelVision: false,
  settings: {}, languages: [], busy: false, busySessions: [], runId: null,
  stopRequested: false, stream: '', events: [],
  pending: [], isPrivate: false, privateThread: [],
  armedMode: null, armedBeforeResearch: 'auto', showAllChats: false,
  projectFilter: null, localProjects: [], chatProjects: {}, library: [],
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
state.localProjects = loadJSON('janna-web-projects-v1', []);
state.chatProjects = loadJSON('janna-web-chat-projects-v1', {});
state.library = loadJSON('janna-web-library-v1', []);
const saveProjects = () => saveJSON('janna-web-projects-v1', state.localProjects);
const saveChatProjects = () => saveJSON('janna-web-chat-projects-v1', state.chatProjects);
const saveLibrary = () => saveJSON('janna-web-library-v1', state.library);

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
    if (m[0].length === 0) re.lastIndex++;
  }
  out += escapeHTML(code.slice(last));
  return out;
}
function formatMarkdown(value) {
  const source = String(value || '').replace(/\r\n/g, '\n');
  const rows = source.split('\n'), blocks = [], lines = [];
  const languageLabel = x => ({ js: 'JavaScript', ts: 'TypeScript', jsx: 'React JSX', tsx: 'React TSX', html: 'HTML', css: 'CSS', py: 'Python', cs: 'C#', cpp: 'C++', c: 'C', rs: 'Rust', json: 'JSON', sh: 'Shell' }[x] || x.toUpperCase() || 'Code');
  for (let i = 0; i < rows.length; i++) {
    const m = rows[i].match(/^ {0,3}(`{3,}|~{3,})\s*([^\n]*)$/);
    if (!m) { lines.push(escapeHTML(rows[i])); continue; }
    const delimiter = m[1], language = String(m[2] || '').trim().split(/\s+/)[0].replace(/[^a-z0-9#+._-]/gi, '').toLowerCase();
    const body = []; let closed = false;
    while (++i < rows.length) {
      const line = rows[i], end = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
      if (end && end[1][0] === delimiter[0] && end[1].length >= delimiter.length) { closed = true; break; }
      body.push(line);
    }
    const code = body.join('\n').replace(/\n+$/, ''); const index = blocks.length;
    blocks.push({ language, code, closed });
    lines.push(`\uE000${index}\uE001`);
  }
  if (!blocks.length && /^\s*(?:<!doctype html\b|<html\b)/i.test(source)) {
    blocks.push({ language: 'html', code: source.trim(), closed: true }); lines.length = 0; lines.push('\uE0000\uE001');
  }
  const inline = s => {
    const saved = [];
    const protect = html => { const id = saved.length; saved.push(html); return `\uE010${id}\uE011`; };
    const styled = s.replace(/`([^`]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s<>"()]+)\)/g, (_, code, label, url) =>
      protect(code !== undefined ? `<code>${code}</code>` : `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`))
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
    return styled.replace(/\uE010(\d+)\uE011/g, (_, id) => saved[Number(id)] || '');
  };
  const out = [], paragraph = [], items = [];
  function flush() { if (paragraph.length) { out.push('<p>' + paragraph.map(inline).join('<br>') + '</p>'); paragraph.length = 0; } if (items.length) { out.push('<ul>' + items.map(v => '<li>' + inline(v) + '</li>').join('') + '</ul>'); items.length = 0; } }
  const tables = [];
  const splitCells = r => { let s = r.trim(); if (s.startsWith('|')) s = s.slice(1); if (s.endsWith('|')) s = s.slice(0, -1); return s.split('|').map(c => c.trim()); };
  const isSep = r => { if (!r.includes('-')) return false; const cells = splitCells(r); return cells.length > 0 && cells.every(c => /^:?-{1,}:?$/.test(c)); };
  for (let li = 0; li < lines.length; li++) {
    const row = lines[li];
    if (row.includes('|') && li + 1 < lines.length && isSep(lines[li + 1])) {
      const head = splitCells(row); const bodyRows = [];
      let lj = li + 2;
      while (lj < lines.length && lines[lj].includes('|') && lines[lj].trim()) { bodyRows.push(splitCells(lines[lj])); lj++; }
      const th = head.map(c => `<th>${inline(c)}</th>`).join('');
      const tb = bodyRows.map(r => '<tr>' + head.map((_, ci) => `<td>${inline(r[ci] || '')}</td>`).join('') + '</tr>').join('');
      tables.push(`<div class="md-table-wrap"><table class="md-table"><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`);
      lines.splice(li, lj - li, `\uE002${tables.length - 1}\uE003`);
    }
  }
  for (const row of lines) {
    if (!row.trim()) { flush(); continue; }
    if (/^\uE000\d+\uE001$/.test(row)) { flush(); out.push(row); continue; }
    if (/^\uE002\d+\uE003$/.test(row)) { flush(); out.push(row); continue; }
    const heading = row.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { flush(); const level = Math.min(3, heading[1].length + 1); out.push(`<h${level}>${inline(heading[2])}</h${level}>`); continue; }
    const item = row.match(/^\s*[-*]\s+(.+)$/);
    if (item) { if (paragraph.length) flush(); items.push(item[1]); continue; }
    if (items.length) flush(); paragraph.push(row);
  }
  flush();
  const html = out.join('').replace(/\uE000(\d+)\uE001/g, (_, id) => {
    const block = blocks[Number(id)]; if (!block) return '';
    const label = languageLabel(block.language);
    const isHtml = ['html', 'htm'].includes(block.language);
    const extra = isHtml
      ? `<button type="button" class="code-action" data-code-action="preview" data-code-index="${id}" title="Preview this page">Preview</button><button type="button" class="code-action" data-code-action="save" data-code-index="${id}" title="Save to Library">Save</button>`
      : '';
    return `<section class="code-block" data-code-index="${id}"><div class="code-block-header"><span class="code-language">${escapeHTML(label)}</span><span class="code-block-actions"><button type="button" class="code-action" data-code-action="copy" data-code-index="${id}" title="Copy this code">Copy</button>${extra}</span></div><pre tabindex="0"><code>${highlightCode(block.code, block.language)}</code></pre></section>`;
  }).replace(/\uE002(\d+)\uE003/g, (_, id) => tables[Number(id)] || '');
  return { html, blocks };
}
function renderMarkdown(body, value) { const result = formatMarkdown(value); body.innerHTML = result.html; codeByBody.set(body, result.blocks); return result; }
function codeFileName(language) {
  const extension = ({ html: 'html', htm: 'html', js: 'js', mjs: 'mjs', jsx: 'jsx', ts: 'ts', tsx: 'tsx', css: 'css', json: 'json', py: 'py', python: 'py', cs: 'cs', cpp: 'cpp', c: 'c', rs: 'rs', go: 'go', sh: 'sh' }[language] || 'txt');
  return 'janna-code.' + extension;
}

/* ---------- response style (Customize setting) ----------
   The web backend has no style channel: its system prompt is fixed.
   The style is applied by appending a short directive to the prompt SENT
   to the model. The directive is stripped again when rendering history,
   so what you see in the chat is exactly what you typed. */
const STYLE_DIRECTIVES = {
  Concise: 'Answer concisely: short sentences, no extra padding.',
  Formal: 'Answer in a formal, professional tone.',
  Tutor: 'Answer like a patient tutor: explain each step simply and check understanding.',
  Comprehensive: 'Answer comprehensively, with full detail and examples.',
};
function styleDirective() {
  const style = state.settings.response_style || 'Default';
  if (style === 'Custom') { const c = String(state.settings.custom_style || '').trim(); return c ? 'Follow this response style: ' + c : ''; }
  return STYLE_DIRECTIVES[style] || '';
}
const stripStyleDirective = text => String(text || '').replace(/(\n\n\[Response style:[^\]]*\])+\s*$/, '');

/* ---------- voice: dictation + voice conversation mode ---------- */
function speechTag(sample = '') {
  const code = state.settings.language || 'auto';
  const row = (state.languages || []).find(item => item.id === code);
  if (row && row.speech) return row.speech;
  if (code === 'auto') return /\b(?:il|la|questo|sono|posso|grazie)\b/i.test(sample || $('prompt')?.value || '') ? 'it-IT' : (navigator.language || 'en-US');
  return code === 'it' ? 'it-IT' : 'en-US';
}
function voiceSpeak(text) {
  if (state.settings.voice_output !== true || !('speechSynthesis' in window)) return;
  const cleaned = String(text || '').replace(/```[\s\S]*?```/g, ' [code block omitted] ').replace(/[<>{}*_#]/g, '').slice(0, 1700);
  if (!cleaned.trim()) return;
  try { window.speechSynthesis.cancel(); const utter = applyVoicePersona(new SpeechSynthesisUtterance(cleaned)); utter.lang = speechTag(cleaned); window.speechSynthesis.speak(utter); } catch { /* unavailable */ }
}
function voiceDictate() {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Rec) return toast('Microphone dictation is not available in this browser. You can still type.');
  if (state.voiceListening) { try { state.voiceRecognizer?.stop(); } catch { /* ignore */ } return; }
  const recognition = new Rec(); state.voiceRecognizer = recognition;
  recognition.lang = speechTag();
  recognition.interimResults = true; recognition.continuous = false; recognition.maxAlternatives = 1;
  const previous = $('prompt').value; let transcript = '';
  recognition.onresult = e => { transcript = Array.from(e.results).map(r => r[0].transcript).join(' '); $('prompt').value = (previous + ' ' + transcript).trim(); autoGrowPrompt(); syncSendState(); };
  recognition.onerror = e => toast('Voice transcription: ' + String(e.error || 'unavailable') + '. Some browsers require network access.');
  recognition.onend = () => { state.voiceListening = false; $('voiceMic').classList.remove('listening'); $('voiceMic').setAttribute('aria-pressed', 'false'); $('prompt').focus(); };
  try { recognition.start(); state.voiceListening = true; $('voiceMic').classList.add('listening'); $('voiceMic').setAttribute('aria-pressed', 'true'); }
  catch (e) { toast('Microphone could not start: ' + e.message); }
}
/* Grok-style voice picker: the voice list, personality, speed and mic from
   the voice screen's bottom sheet. Personas shape the spoken voice (pitch
   + rate on the device TTS); personality shapes how answers are spoken. */
const VOICE_PERSONAS = [
  { id: 'ara', name: 'Ara', desc: 'Warm and friendly.', pitch: 1.1, rate: 1.0 },
  { id: 'eve', name: 'Eve', desc: 'Energetic and upbeat.', pitch: 1.2, rate: 1.1 },
  { id: 'leo', name: 'Leo', desc: 'Authoritative and strong.', pitch: 0.8, rate: 0.95 },
  { id: 'rex', name: 'Rex', desc: 'Confident and clear.', pitch: 0.9, rate: 1.0 },
  { id: 'sal', name: 'Sal', desc: 'Smooth and balanced.', pitch: 1.0, rate: 1.0 },
  { id: 'gork', name: 'Gork', desc: 'Lazy.', tag: '18+', pitch: 0.7, rate: 0.9 },
  { id: 'cosmo', name: 'Cosmo', desc: 'Bright, curious, and easy to follow.', pitch: 1.25, rate: 1.1 },
  { id: 'celeste', name: 'Celeste', desc: 'Compassionate, confident, and easygoing.', pitch: 1.05, rate: 1.0 },
  { id: 'neil', name: 'Neil', desc: 'Warm, thoughtful, and wise.', pitch: 0.85, rate: 0.95 },
  { id: 'atlas', name: 'Atlas', desc: 'Confident, commanding, and reassuring.', pitch: 0.8, rate: 0.95 },
  { id: 'aurora', name: 'Aurora', desc: 'Serene, steady, and radiant.', pitch: 1.15, rate: 0.95 },
  { id: 'liora', name: 'Liora', desc: 'Calm, grounded, and luminous.', pitch: 1.1, rate: 0.9 },
];
const VOICE_PERSONALITIES = [
  ['Assistant', ''], ['Storyteller', 'Tell it like a story.'],
  ['Kids Story Time', 'Explain it like a bedtime story for a young child, using simple words.'],
  ['Kids Trivia Game', 'Turn your answer into a fun trivia game for kids.'],
  ['Meditation', 'Speak calmly and slowly, like a guided meditation.'],
  ['Conspiracy', 'Answer with a playful conspiracy-theory spin.'],
];
const VOICE_SPEEDS = [['0.5x', 0.5], ['0.75x', 0.75], ['0.9x', 0.9], ['Normal', 1], ['1.1x', 1.1], ['1.25x', 1.25], ['1.5x', 1.5], ['2x', 2]];
function voicePersona() { return VOICE_PERSONAS.find(p => p.id === (state.settings.voice_name || 'ara')) || VOICE_PERSONAS[0]; }
function voiceSpeedRate() { const row = VOICE_SPEEDS.find(s => s[0] === (state.settings.voice_speed || 'Normal')); return row ? row[1] : 1; }
function applyVoicePersona(u) {
  const p = voicePersona();
  try { u.pitch = p.pitch; } catch { /* ignore */ }
  try { u.rate = Math.min(2, Math.max(0.5, p.rate * voiceSpeedRate())); } catch { /* ignore */ }
  return u;
}
function voicePersonalityDirective() {
  const key = state.settings.voice_personality || 'Assistant';
  if (key === 'Custom') { const c = String(state.settings.voice_personality_custom || '').trim(); return c || ''; }
  const row = VOICE_PERSONALITIES.find(p => p[0] === key);
  return row ? row[1] : '';
}
const voiceTalk = { active: false, phase: 'idle', muted: false, recog: null, watch: null, restart: null, quiet: 0, errStrikes: 0, errKind: '', chunkTimer: null, langOverride: '', langRetried: false, stopped: false };
function voiceOverlay() {
  let ov = document.getElementById('voiceOverlay');
  if (ov) return ov;
  ov = document.createElement('div');
  ov.className = 'voice-overlay'; ov.id = 'voiceOverlay'; ov.dataset.phase = 'idle';
  ov.innerHTML = '<div class="voice-top"><button class="voice-orb" id="voiceOrb" type="button" aria-label="Voice orb"></button><div class="voice-status"><div class="voice-caption" id="voiceCaption">I\u2019m listening\u2026</div><div class="voice-sub" id="voiceSub">Just talk to Janna \u2014 she\u2019ll answer out loud.</div></div></div>'
    + '<div class="voice-bar"><button class="voice-plus" id="voicePlusBtn" type="button" title="Back to typing" aria-label="Back to typing"><svg><use href="#i-plus"/></svg></button><button class="voice-name" id="voiceNameBtn" type="button"><span id="voiceNameLabel">Ara \u00b7 Assistant</span><svg><use href="#i-chevron"/></svg></button><span class="voice-bars" id="voiceBars"><i></i><i></i><i></i><i></i></span><button class="voice-ctl" id="voiceMuteBtn" type="button" title="Mute microphone" aria-label="Mute microphone"><svg><use href="#i-mic"/></svg></button><button class="voice-ctl stop" id="voiceCloseBtn" type="button" title="End voice chat" aria-label="End voice chat"><svg><use href="#i-stop"/></svg></button></div>';
  document.body.appendChild(ov);
  ov.querySelector('#voiceCloseBtn').onclick = () => voiceClose();
  ov.querySelector('#voiceMuteBtn').onclick = () => voiceToggleMute();
  ov.querySelector('#voiceOrb').onclick = () => voiceOrbTap();
  ov.querySelector('#voicePlusBtn').onclick = () => { voiceClose(); $('prompt').focus(); };
  ov.querySelector('#voiceNameBtn').onclick = () => voiceToggleSheet();
  ov.addEventListener('click', e => {
    if (e.target.closest('button') || e.target.closest('#voiceSheet')) return;
    voiceToggleSheet(false);
  });
  voiceBuildSheet(ov);
  syncVoiceNameLabel();
  return ov;
}
function syncVoiceNameLabel() {
  const label = document.getElementById('voiceNameLabel'); if (!label) return;
  label.textContent = voicePersona().name + ' \u00b7 ' + (state.settings.voice_personality || 'Assistant');
}
function voiceBuildSheet(ov) {
  const sheet = document.createElement('div');
  sheet.className = 'voice-sheet'; sheet.id = 'voiceSheet'; sheet.hidden = true;
  const handle = el('div', 'voice-sheet-handle');
  const title = el('div', 'voice-sheet-title', 'Voice');
  const list = el('div', 'voice-list'); list.id = 'voiceList';
  sheet.append(handle, title, list);
  const mkRow = (labelText, control) => {
    const row = el('div', 'voice-sheet-row');
    row.append(el('span', '', labelText), control);
    sheet.append(row);
  };
  const persSel = settingsSelect(VOICE_PERSONALITIES.map(p => [p[0], p[0]]).concat([['Custom', 'Custom\u2026']]), state.settings.voice_personality || 'Assistant', async v => {
    if (v === 'Custom') {
      const res = await showDialog({ title: 'Custom personality', text: 'How should Janna speak in voice mode?', fields: [{ name: 'text', value: state.settings.voice_personality_custom || '', placeholder: 'e.g. Speak like a pirate, but kindly' }], okText: 'Save' });
      if (!res || !String(res.text || '').trim()) { persSel.value = state.settings.voice_personality || 'Assistant'; return; }
      persistSettings({ voice_personality: 'Custom', voice_personality_custom: String(res.text).trim() });
    } else await persistSettings({ voice_personality: v });
    syncVoiceNameLabel();
  });
  persSel.id = 'voicePersonalitySel';
  mkRow('Personality', persSel);
  const speedSel = settingsSelect(VOICE_SPEEDS.map(s => [s[0], s[0]]), state.settings.voice_speed || 'Normal', v => persistSettings({ voice_speed: v }));
  speedSel.id = 'voiceSpeedSel';
  mkRow('Speed', speedSel);
  const micSel = document.createElement('select'); micSel.id = 'voiceMicSel';
  const fallback = document.createElement('option'); fallback.value = 'Microphone'; fallback.textContent = 'Microphone'; micSel.append(fallback);
  micSel.onchange = () => persistSettings({ voice_mic_label: micSel.value });
  mkRow('Microphone', micSel);
  ov.append(sheet);
}
function renderVoiceList() {
  const list = document.getElementById('voiceList'); if (!list) return;
  list.replaceChildren();
  const current = state.settings.voice_name || 'ara';
  for (const p of VOICE_PERSONAS) {
    const row = el('button', 'voice-row' + (p.id === current ? ' selected' : ''));
    row.type = 'button';
    const texts = el('div', 'voice-row-texts');
    texts.append(el('div', 'voice-row-name', p.name + (p.tag ? ' ' + p.tag : '')), el('div', 'voice-row-desc', p.desc));
    row.append(texts, el('span', 'voice-check', p.id === current ? '\u2713' : ''));
    row.onclick = async () => { await persistSettings({ voice_name: p.id }); syncVoiceNameLabel(); renderVoiceList(); };
    list.append(row);
  }
}
async function voiceLoadMics() {
  const sel = document.getElementById('voiceMicSel'); if (!sel) return;
  let devices = [];
  try { if (navigator.mediaDevices?.enumerateDevices) devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput'); } catch { /* ignore */ }
  sel.replaceChildren();
  if (devices.length) {
    devices.forEach((d, i) => { const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || 'Microphone ' + (i + 1); sel.append(o); });
    sel.value = state.settings.voice_mic_device || devices[0].deviceId;
    sel.onchange = () => persistSettings({ voice_mic_device: sel.value, voice_mic_label: sel.options[sel.selectedIndex]?.textContent || '' });
  } else {
    for (const label of ['Microphone', 'Speakerphone', 'Headset earpiece']) { const o = document.createElement('option'); o.value = label; o.textContent = label; sel.append(o); }
    sel.value = state.settings.voice_mic_label || 'Microphone';
    sel.onchange = () => persistSettings({ voice_mic_label: sel.value });
  }
}
function voiceToggleSheet(open) {
  const sheet = document.getElementById('voiceSheet'); if (!sheet) return;
  const willOpen = open !== undefined ? open : sheet.hidden;
  sheet.hidden = !willOpen;
  if (willOpen) { renderVoiceList(); voiceLoadMics(); }
}
function voiceSetPhase(phase, caption) {
  voiceTalk.phase = phase;
  const ov = document.getElementById('voiceOverlay'); if (!ov) return;
  ov.dataset.phase = phase;
  if (caption != null) ov.querySelector('#voiceCaption').textContent = caption;
}
function voiceClean(text) {
  return String(text || '').replace(/```[\s\S]*?```/g, ' [code block omitted] ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[<>{}*_#~`>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 1700);
}
function voiceTalkSpeak(text) {
  const clean = voiceClean(text);
  if (!clean || !('speechSynthesis' in window)) { voiceSetPhase('idle', 'My answer is in the chat \u2014 voice isn\u2019t available here.'); return; }
  try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
  const chunks = [];
  for (const part of clean.match(/[^.!?…]+[.!?…]*\s*/g) || [clean]) { const t = part.trim(); if (t) chunks.push(t); }
  const queue = [];
  for (const c of chunks) { if (c.length <= 180) queue.push(c); else for (let i = 0; i < c.length; i += 180) queue.push(c.slice(i, i + 180)); }
  if (!queue.length) queue.push(clean);
  voiceSetPhase('speaking', clean.length > 220 ? clean.slice(0, 220) + '\u2026' : clean);
  let idx = 0;
  const step = () => {
    clearTimeout(voiceTalk.chunkTimer);
    if (!voiceTalk.active || voiceTalk.muted) return;
    if (idx >= queue.length) { voiceListen(); return; }
    const piece = queue[idx++];
    const utter = applyVoicePersona(new SpeechSynthesisUtterance(piece));
    utter.lang = speechTag(piece);
    let advanced = false;
    const advance = () => { if (advanced) return; advanced = true; step(); };
    utter.onend = advance; utter.onerror = advance;
    voiceTalk.chunkTimer = setTimeout(advance, Math.max(5000, piece.length * 110 + 3000));
    try { window.speechSynthesis.speak(utter); } catch { advance(); }
  };
  step();
}
function voiceExtract(elm) {
  const clone = elm.cloneNode(true);
  clone.querySelectorAll('.thinking,.message-actions,pre,button,details').forEach(n => n.remove());
  return clone.textContent.replace(/\s+/g, ' ').trim();
}
function voiceWatchReply(beforeCount) {
  const started = Date.now();
  clearInterval(voiceTalk.watch);
  voiceTalk.watch = setInterval(() => {
    if (!voiceTalk.active) { clearInterval(voiceTalk.watch); return; }
    if (state.busy) return;
    clearInterval(voiceTalk.watch);
    const els = document.querySelectorAll('.message.assistant');
    const elm = els[els.length - 1];
    if (elm && els.length > beforeCount) voiceTalkSpeak(voiceExtract(elm));
    else voiceTalkSpeak('Done \u2014 my answer is in the chat.');
  }, 700);
  setTimeout(() => { clearInterval(voiceTalk.watch); }, 125000);
}
function voiceSubmit(text) {
  const before = document.querySelectorAll('.message.assistant').length;
  voiceSetPhase('thinking', '\u201c' + text + '\u201d');
  const dir = voicePersonalityDirective();
  $('prompt').value = dir ? text + '\n\n[Response style: ' + dir + ']' : text;
  syncSendState();
  send();
  voiceWatchReply(before);
}
function voiceListen() {
  if (!voiceTalk.active || voiceTalk.muted) return;
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Rec) { voiceSetPhase('idle', 'This browser doesn\u2019t support listening. Just type, or close this.'); return; }
  try { voiceTalk.recog?.stop(); } catch { /* ignore */ }
  const recog = new Rec(); voiceTalk.recog = recog;
  recog.lang = voiceTalk.langOverride || speechTag(); recog.interimResults = true; recog.continuous = false; recog.maxAlternatives = 1;
  voiceSetPhase('listening', 'I\u2019m listening\u2026 go ahead.');
  recog.onresult = e => {
    let interim = '', finalText = '';
    for (const r of e.results) { if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript; }
    if (interim) voiceSetPhase('listening', interim);
    if (finalText.trim()) { voiceTalk.quiet = 0; voiceTalk.errStrikes = 0; try { recog.stop(); } catch { /* ignore */ } voiceSubmit(finalText.trim()); }
  };
  recog.onerror = e => {
    const err = String(e.error || '');
    if (err === 'language-not-supported' && !voiceTalk.langRetried) { voiceTalk.langRetried = true; voiceTalk.langOverride = 'en-US'; voiceTalk.errStrikes = 0; }
    else if (err === 'not-allowed' || err === 'service-not-allowed') { voiceSetPhase('idle', 'I can\u2019t hear you \u2014 allow the microphone for Janna, then try again.'); voiceTalk.recog = null; voiceTalk.errStrikes = 0; }
    else if (err === 'no-speech') { voiceTalk.quiet++; }
    else if (err) { voiceTalk.errStrikes = (voiceTalk.errStrikes || 0) + 1; voiceTalk.errKind = err; }
  };
  recog.onend = () => {
    if (voiceTalk.recog !== recog) return;
    if (!voiceTalk.active || voiceTalk.muted || voiceTalk.phase !== 'listening') return;
    clearTimeout(voiceTalk.restart);
    if ((voiceTalk.errStrikes || 0) >= 2) { const k = voiceTalk.errKind || ''; voiceTalk.errStrikes = 0; voiceTalk.stopped = true; voiceSetPhase('idle', k === 'network' ? 'My hearing can\u2019t reach the speech service \u2014 the internet it needs is weak or unavailable. Tap the circle to try again, or just type.' : 'Something\u2019s wrong with my listening (' + k + ') \u2014 tap the circle to try again.'); return; }
    if (voiceTalk.quiet >= 3) { voiceTalk.stopped = true; voiceSetPhase('idle', 'I can\u2019t hear anything \u2014 tap the circle to try again.'); return; }
    voiceTalk.restart = setTimeout(() => { if (!voiceTalk.stopped) voiceListen(); }, 350);
  };
  try { recog.start(); } catch { /* ignore */ }
}
function voiceOrbTap() {
  if (voiceTalk.phase === 'speaking') { clearTimeout(voiceTalk.chunkTimer); try { window.speechSynthesis.cancel(); } catch { /* ignore */ } voiceListen(); }
  else if (voiceTalk.phase === 'listening') { try { voiceTalk.recog?.stop(); } catch { /* ignore */ } voiceSetPhase('idle', 'Paused \u2014 tap the circle to continue.'); }
  else if (voiceTalk.phase === 'idle' && !voiceTalk.muted) { voiceTalk.stopped = false; voiceListen(); }
}
function voiceToggleMute() {
  voiceTalk.muted = !voiceTalk.muted;
  const btn = document.getElementById('voiceMuteBtn'); if (btn) btn.classList.toggle('muted', voiceTalk.muted);
  if (voiceTalk.muted) { clearTimeout(voiceTalk.chunkTimer); try { voiceTalk.recog?.stop(); } catch { /* ignore */ } try { window.speechSynthesis.cancel(); } catch { /* ignore */ } voiceSetPhase('idle', 'Mic is muted \u2014 tap the mic to talk again.'); }
  else { voiceTalk.stopped = false; voiceListen(); }
}
function voiceOpen() {
  voiceOverlay();
  syncVoiceNameLabel();
  voiceTalk.active = true; voiceTalk.muted = false; voiceTalk.quiet = 0; voiceTalk.errStrikes = 0; voiceTalk.stopped = false;
  try { const synth = window.speechSynthesis; if (synth) { synth.getVoices(); const prime = new SpeechSynthesisUtterance(' '); prime.volume = 0; synth.speak(prime); } } catch { /* ignore */ }
  document.body.classList.add('voice-open');
  const btn = document.getElementById('voiceMuteBtn'); if (btn) btn.classList.remove('muted');
  voiceTalk.langOverride = ''; voiceTalk.langRetried = false;
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    voiceSetPhase('idle', 'One moment \u2014 asking for microphone permission\u2026');
    const micId = state.settings.voice_mic_device || '';
    const constraints = micId ? { audio: { deviceId: { exact: micId } } } : { audio: true };
    const ask = c => navigator.mediaDevices.getUserMedia(c).then(stream => {
      stream.getTracks().forEach(t => { try { t.stop(); } catch { /* ignore */ } });
      if (voiceTalk.active && !voiceTalk.muted) voiceListen();
    });
    ask(constraints).catch(err => {
      if (!voiceTalk.active) return;
      if (err && err.name === 'OverconstrainedError') { ask({ audio: true }).catch(() => {}); return; }
      if (err && err.name === 'NotFoundError') { voiceListen(); return; }
      voiceTalk.stopped = true;
      voiceSetPhase('idle', 'The microphone wasn\u2019t allowed. To fix it: tap the lock icon in the address bar \u2192 Permissions \u2192 Microphone \u2192 Allow, then close and reopen this.');
    });
  } else voiceListen();
}
function voiceClose() {
  voiceTalk.active = false;
  clearInterval(voiceTalk.watch); clearTimeout(voiceTalk.restart);
  try { voiceTalk.recog?.stop(); } catch { /* ignore */ }
  try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
  document.body.classList.remove('voice-open');
  document.getElementById('voiceOverlay')?.remove();
}

/* ---------- theme ---------- */
function applyTheme() {
  const mode = state.settings.appearance_mode || 'system';
  const dark = mode === 'dark' || (mode === 'system' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  document.body.dataset.theme = dark ? 'dark' : 'light';
  document.body.classList.toggle('wrap-code', state.settings.wrap_code === true);
  document.body.classList.toggle('reduce-motion', state.settings.reduce_motion === true);
  if (window.syncPhoneChrome) { try { window.syncPhoneChrome(); } catch { /* ignore */ } }
}
function syncDesktopChrome() { applyTheme(); }

/* ---------- models ---------- */
function modelRecord(id) { return state.modelCatalog.find(m => m.id === id) || { id, label: id, note: 'Cloud model', model_class: 'Janna Cloud' }; }
function modelLabel(id) { return modelRecord(id).label || id; }
function rememberModelChoice() { try { if (state.model) localStorage.setItem('janna-selected-model', state.model); } catch { /* ignore */ } }
function renderModelOptions(models) {
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
function shortModelLabel(id) { if (id === 'janna-cloud') return 'Janna'; return (modelLabel(id) || id).split(' ').slice(0, 2).join(' '); }
function syncModelPicker() {
  const label = $('modelPickerLabel');
  if (label) label.textContent = state.model ? shortModelLabel(state.model) : 'Choose a model';
}
async function refreshNativeLevels() {
  state.modelVision = false;
  if (!state.model) return;
  try { const r = await api('/api/reasoning/' + encodeURIComponent(state.model)); state.modelVision = r.vision === true; }
  catch { /* vision unknown: treat as no vision */ }
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
  const groups = [['Janna Cloud', r => r.id === 'janna-cloud'], ['APInex', r => r.id.startsWith('apinex-')], ['Other cloud models', r => r.id !== 'janna-cloud' && !r.id.startsWith('apinex-')]];
  for (const [name, pred] of groups) {
    const rows = state.modelCatalog.filter(r => state.models.includes(r.id) && pred(r));
    if (!rows.length) continue;
    p.append(el('div', 'model-picker-group', name));
    for (const row of rows) {
      const item = el('button', 'model-picker-item');
      item.type = 'button'; item.setAttribute('role', 'radio'); item.setAttribute('aria-checked', String(row.id === state.model));
      const radio = el('span', 'radio');
      const texts = el('div', 'mp-texts');
      texts.append(el('strong', '', row.label));
      const note = row.note || (row.vision ? 'Can see images' : '');
      if (note) texts.append(el('small', '', note + (row.vision ? ' · Sees images' : '')));
      item.append(radio, texts);
      if (row.id === state.model) { const c = el('span', 'mp-check'); c.innerHTML = '<svg><use href="#i-check"/></svg>'; item.append(c); }
      item.onclick = () => chooseModel(row.id);
      p.append(item);
    }
  }
  const foot = el('div', 'model-picker-foot');
  foot.append(document.createTextNode('Free \u2014 all models included. No account, no paid tiers.'));
  p.append(foot);
  p.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
}

/* ---------- attachments ---------- */
function downscaleImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, 1568 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
        const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const cx = cv.getContext('2d'); cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, w, h); cx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        cv.toBlob(blob => { if (!blob) { reject(new Error('Could not shrink the image')); return; } resolve(new File([blob], (file.name || 'photo').replace(/\.[a-z0-9]+$/i, '') + '.jpg', { type: 'image/jpeg' })); }, 'image/jpeg', 0.85);
      } catch (err) { URL.revokeObjectURL(url); reject(err); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read the image')); };
    img.src = url;
  });
}
function fileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error || new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}
function renderPending() {
  const tray = $('attachmentTray'); if (!tray) return;
  tray.replaceChildren();
  tray.hidden = !state.pending.length;
  for (const item of state.pending) {
    const chip = el('span', 'attachment-chip');
    if (item.kind === 'image' && item.file) { const img = document.createElement('img'); img.alt = ''; img.src = URL.createObjectURL(item.file); chip.append(img); }
    chip.append(document.createTextNode(item.name + ' \u00b7 ' + (item.kind === 'image' ? (state.modelVision ? 'image' : 'image, pixels not sent') : 'log')));
    chip.append(button('Remove', () => { state.pending = state.pending.filter(row => row !== item); renderPending(); }));
    tray.append(chip);
  }
  syncSendState();
}
async function handleFiles(files) {
  for (const file of files) {
    if (state.pending.length >= 4) { toast('Attach at most 4 files.'); break; }
    const name = file.name || 'attachment';
    const image = /\.(png|jpe?g|webp)$/i.test(name) || ['image/png', 'image/jpeg', 'image/webp'].includes(file.type);
    try {
      if (image) {
        if (/\.(svg|gif)$/i.test(name)) { toast(name + ' is not a PNG, JPEG, or WebP.'); continue; }
        let useFile = file, useName = name;
        if (file.size > 1200000) {
          if (window.__JANNA_WEB__) { const small = await downscaleImageFile(file).catch(() => null); if (!small) { toast(name + ' could not be shrunk to fit.'); continue; } useFile = small; useName = small.name; }
          else { toast(name + ' is over 1.2 MB.'); continue; }
        }
        if (state.pending.filter(item => item.kind === 'image').length >= 2) { toast('Attach at most 2 images.'); continue; }
        const data = await fileBase64(useFile);
        state.pending.push({ kind: 'image', name: useName, data, file: useFile });
        if (!state.modelVision) toast(name + ' stays on this device. This model has not advertised vision, so its pixels will not be sent.');
      } else {
        if (file.size > 180000) { toast(name + ' is over 180,000 characters.'); continue; }
        const text = await file.text();
        if (text.includes('\u0000')) { toast(name + ' is not a text file.'); continue; }
        state.pending.push({ kind: 'log', name, text });
      }
    } catch (err) { toast(err.message || 'Could not read ' + name); }
  }
  renderPending();
}

/* ---------- suggestions & modes ----------
   Only modes Janna can really do. "Create an image" and "Check email and
   calendar" are omitted (see BUILD-REPORT.md). */
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
let suggestionRot = null;
function suggestRotation() {
  if (suggestionRot !== null) return suggestionRot;
  let rot = 0;
  try { rot = Number(localStorage.getItem('janna-suggest-rot-v1') || '0') || 0; localStorage.setItem('janna-suggest-rot-v1', String(rot + 1)); } catch { /* ignore */ }
  suggestionRot = rot;
  return rot;
}
function renderSuggestions() {
  const list = $('suggestList');
  list.replaceChildren();
  if (state.isPrivate) { list.hidden = true; return; }
  list.hidden = false;
  if (state.settings.show_suggestions === false) { list.hidden = true; return; }
  if (!state.armedMode) {
    const rot = suggestRotation();
    // Grok keeps slot 1 fixed ("Create an image"); Janna can't do that, so
    // slot 1 is fixed on "Search the web" and slots 2-3 rotate the rest.
    const rest = MODE_ORDER.filter(k => k !== 'search');
    const order = ['search', rest[rot % rest.length], rest[(rot + 1) % rest.length]];
    for (const key of order) {
      const m = MODES[key];
      const row = el('button', 'suggest-row');
      row.type = 'button';
      row.innerHTML = `<svg><use href="#i-${m.icon}"/></svg><span>${escapeHTML(m.label)}</span>`;
      row.onclick = () => armMode(key);
      list.append(row);
    }
    return;
  }
  const m = MODES[state.armedMode];
  const back = el('button', 'suggest-row suggest-back');
  back.type = 'button'; back.textContent = '\u2190 All suggestions';
  back.onclick = () => disarmMode();
  list.append(back);
  for (const p of m.prompts) {
    const row = el('button', 'suggest-row');
    row.type = 'button';
    row.innerHTML = `<svg><use href="#i-${m.icon}"/></svg><span>${escapeHTML(p)}</span>`;
    row.onclick = () => {
      if (m.sendOnTap) { $('prompt').value = p; syncSendState(); send(); }
      else { $('prompt').value = (m.templatePrefix || '') + p + (m.templatePrefix ? ' web app' : ''); autoGrowPrompt(); syncSendState(); $('prompt').focus(); }
    };
    list.append(row);
  }
}
function armMode(key) {
  const m = MODES[key]; if (!m) return;
  state.armedMode = key;
  if (key === 'search') {
    state.armedBeforeResearch = state.settings.research_mode || 'auto';
    if (state.settings.research_mode !== 'always') persistSettings({ research_mode: 'always' });
  }
  renderModeChip();
  $('prompt').placeholder = m.placeholder;
  renderSuggestions();
}
function disarmMode() {
  if (state.armedMode === 'search' && state.settings.research_mode === 'always') persistSettings({ research_mode: state.armedBeforeResearch || 'auto' });
  state.armedMode = null;
  renderModeChip();
  $('prompt').placeholder = 'Ask anything\u2026';
  renderSuggestions();
}
function renderModeChip() {
  const row = $('modeChipRow');
  row.replaceChildren();
  if (!state.armedMode) { row.hidden = true; return; }
  const m = MODES[state.armedMode];
  const chip = el('button', 'mode-chip');
  chip.type = 'button';
  chip.innerHTML = `<span class="chip-x">\u2715</span> ${escapeHTML(m.chip)}`;
  chip.onclick = () => disarmMode();
  row.append(chip);
  row.hidden = false;
}

/* ---------- composer helpers ---------- */
function autoGrowPrompt() {
  const t = $('prompt'); t.style.height = 'auto'; t.style.height = Math.min(160, t.scrollHeight) + 'px';
}
function syncSendState() {
  const c = $('composer'); if (!c) return;
  // Send shows when there is text OR an attachment (Grok: Send only appears
  // once there is something to send); empty means waveform only.
  const empty = !$('prompt').value.trim() && !state.pending.length;
  c.classList.toggle('is-empty', empty);
  $('send').classList.toggle('active', !empty);
}
function updateBusy() {
  const busy = state.busy;
  $('composer').classList.toggle('is-busy', busy);
  $('stop').hidden = !busy;
  $('stop').disabled = state.stopRequested;
  $('prompt').disabled = false;
  $('prompt').placeholder = busy ? 'Queue instructions for the next step\u2026' : (state.armedMode ? MODES[state.armedMode].placeholder : 'Ask anything\u2026');
  $('modelPickerBtn').disabled = busy;
  if (busy) closeModelPicker();
  statusBadge();
}
function statusBadge() {
  const ok = !!state.models.length;
  $('sidebarDot').classList.toggle('offline', !ok);
  $('sidebarState').textContent = state.busy ? 'Working\u2026' : ok ? 'Cloud \u00b7 Ready' : 'Cloud \u00b7 Offline';
}

/* ---------- thinking display (matches styles.css .thinking structure) ---------- */
const think = { el: null, timer: null, start: 0 };
function thinkingEl() {
  if (think.el) return think.el;
  const wrap = $('messages'); if (!wrap) return null;
  const item = el('div', 'thinking');
  const head = el('button', 'thinking-head');
  head.type = 'button';
  head.innerHTML = '<span class="think-spinner"></span><span class="think-title">Working for 1s</span><span class="think-clock">1s</span><svg class="think-chevron"><use href="#i-chevron"/></svg>';
  const body = el('div', 'think-body');
  body.append(el('ul', 'think-steps'));
  item.append(head, body);
  head.onclick = () => item.classList.toggle('collapsed');
  wrap.appendChild(item);
  think.el = item;
  return item;
}
function startThinking() {
  const item = thinkingEl();
  if (!item) return;
  item.hidden = false;
  item.classList.remove('collapsed', 'done');
  item.querySelector('.think-title').textContent = 'Working for 1s';
  item.querySelector('.think-clock').textContent = '1s';
  item.querySelector('.think-steps').replaceChildren();
  think.start = Date.now();
  clearInterval(think.timer);
  think.timer = setInterval(() => {
    const secs = Math.max(1, Math.round((Date.now() - think.start) / 1000));
    const text = 'Working for ' + fmtDur(secs);
    item.querySelector('.think-title').textContent = text;
    item.querySelector('.think-clock').textContent = fmtDur(secs);
  }, 1000);
  scrollThreadToBottom();
}
function stopThinking() {
  clearInterval(think.timer);
  if (think.el) {
    const secs = fmtDur((Date.now() - think.start) / 1000);
    think.el.classList.add('done', 'collapsed');
    think.el.querySelector('.think-title').textContent = 'Thought for ' + secs;
    think.el.querySelector('.think-clock').textContent = secs;
  }
}
function addProgressStep(text) {
  const item = thinkingEl();
  if (!item) return;
  const steps = item.querySelector('.think-steps');
  steps.querySelectorAll('li').forEach(li => li.classList.remove('is-current'));
  const li = el('li', 'is-current', text);
  steps.append(li);
  scrollThreadToBottom();
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
    item.append(bubble);
    // Grok: no persistent Edit/Copy pills under your bubble — tap the bubble
    // to edit it inline. The pager below appears only on edited messages.
    bubble.onclick = () => { if (!state.busy) startEdit(item, message, session); };
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
    item.append(actions);
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
  const pager = item.querySelector('.version-pager');
  if (bubble) bubble.hidden = true;
  if (pager) pager.hidden = true;
  const area = el('div', 'edit-area');
  const ta = document.createElement('textarea');
  ta.value = currentVersionText(message); ta.rows = 1; ta.setAttribute('aria-label', 'Edit message');
  area.append(ta);
  const row = el('div', 'edit-actions');
  const cancel = button('Cancel', () => renderConversation(session));
  const copy = button('Copy', async () => { toast((await copyCodeText(ta.value)) ? 'Copied' : 'Copy failed'); });
  const sendBtn = button('Send', async () => {
    // Editing an earlier message forks the thread: everything after it is
    // replaced by the new answer (Grok's branch behaviour). Never do that
    // silently — ask first, and keep the editor open if she says no.
    const text = ta.value.trim();
    if (!text || text === currentVersionText(message)) { renderConversation(session); return; }
    const list = session.messages || [];
    const idx = list.indexOf(message);
    // Only later *user* turns are at risk: the edited message's own answer
    // is always regenerated, so editing the last user message asks nothing.
    const after = idx >= 0 ? list.slice(idx + 1).filter(m => m.role === 'user').length : 0;
    if (after > 0) {
      const ok = await confirmDialog('Edit this message?', `There ${after === 1 ? 'is 1 more exchange' : `are ${after} more exchanges`} after this one. Editing will remove ${after === 1 ? 'it' : 'them'} and start a new answer from here.`, 'Edit anyway');
      if (!ok) return;
    }
    finishEdit(message, session, ta.value);
  });
  cancel.classList.add('edit-pill'); copy.classList.add('edit-pill'); sendBtn.classList.add('edit-pill', 'edit-send');
  row.append(cancel, copy, sendBtn);
  area.append(row);
  item.append(area);
  autoGrowEdit(ta);
  ta.addEventListener('input', () => autoGrowEdit(ta));
  ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
}
async function finishEdit(message, session, newText) {
  const text = String(newText || '').trim();
  renderConversation(session); // exit edit mode first
  if (!text || text === currentVersionText(message)) return;
  if (state.busy) return;
  const list = session.messages || [];
  const idx = list.indexOf(message);
  if (idx < 0) return;
  // v1 is the original text + the reply that followed it; the edit becomes
  // the next version. Everything after the edited message is replaced by
  // the new answer, like Grok's < 2 / 2 > flow.
  if (!Array.isArray(message.versions)) {
    const next = list[idx + 1];
    message.versions = [{ text: message.content || '', response: (next && next.role === 'assistant') ? next : null }];
    message.version = 0;
  }
  message.versions.push({ text, response: null });
  message.version = message.versions.length - 1;
  message.content = text;
  list.splice(idx + 1);
  renderConversation(session);
  const history = list.slice(0, idx).map(m => ({ role: m.role, content: stripStyleDirective(currentVersionText(m) || '') }));
  await runStream(session, text, history, messageAttachments(message), state.isPrivate, { msg: message, index: idx });
}
async function switchVersion(message, session, i) {
  if (!Array.isArray(message.versions)) return;
  const n = Math.max(0, Math.min(message.versions.length - 1, i));
  if (n === (message.version || 0)) return;
  message.version = n;
  message.content = message.versions[n].text;
  const list = session.messages || [];
  const idx = list.indexOf(message);
  const next = list[idx + 1];
  if (next && next.role === 'assistant' && message.versions[n].response) next.content = message.versions[n].response.content || '';
  renderConversation(session);
  try { await api('/api/sessions/update', { session_id: session.id, messages: list }); } catch { /* switch still shows locally */ }
}
function renderFollowUps() {
  // Grok shows no follow-up chips under an answer; keep the wrap hidden.
  const wrap = $('followUps');
  wrap.replaceChildren();
  wrap.hidden = true;
}
function renderConversation(session) {
  think.el = null; clearInterval(think.timer);
  $('messages').replaceChildren();
  const empty = !session || !(session.messages || []).length;
  $('welcome').hidden = !empty;
  $('messages').hidden = empty;
  $('composerDock').hidden = empty;
  const slot = empty ? $('welcomeComposerSlot') : $('composerHome');
  if (slot) slot.append($('composer'));
  const title = (session && findSession(session.id)?.title) || session?.title || '';
  $('threadTitle').textContent = title || 'New chat';
  $('threadTitlePill').hidden = !session || empty;
  if (session) {
    for (const msg of session.messages || []) $('messages').append(createMessageNode(msg, session));
  }
  renderFollowUps();
  renderProjects(); renderRecents();
  scrollThreadToBottom();
}
function scrollThreadToBottom() {
  if (state.settings.auto_scroll === false) return;
  const t = $('thread');
  if (t) t.scrollTop = t.scrollHeight;
}

/* ---------- sessions / sidebar ---------- */
function findSession(id) { return state.sessions.find(s => s.id === id); }
function visibleChats() {
  let list = state.sessions.filter(s => !s.archived);
  if (state.projectFilter) list = list.filter(s => state.chatProjects[s.id] === state.projectFilter);
  return list;
}
function renderRecents() {
  const list = $('sessionList'); list.replaceChildren();
  const chats = visibleChats();
  const shown = state.showAllChats ? chats : chats.slice(0, 8);
  for (const s of shown) {
    const row = el('div', 'side-row');
    if (state.session && s.id === state.session.id) row.classList.add('active');
    const label = el('button', 'side-row-label', (s.pinned ? 'Pinned \u00b7 ' : '') + (s.title || 'New chat'));
    label.onclick = () => openSession(s.id);
    const more = el('button', 'side-row-menu');
    more.type = 'button'; more.setAttribute('aria-label', 'Chat actions');
    more.innerHTML = '<svg><use href="#i-dots"/></svg>';
    more.onclick = e => { e.stopPropagation(); openChatMenu(s, more); };
    row.append(label, more);
    list.append(row);
  }
  const moreBtn = $('showMoreChats');
  moreBtn.hidden = chats.length <= 8;
  moreBtn.textContent = state.showAllChats ? 'Show less' : 'Show more';
  if (!chats.length) list.append(el('div', 'empty-state', state.projectFilter ? 'No chats in this project yet.' : 'No chats yet. Start a new chat.'));
}
function renderProjects() {
  const list = $('projectList'); list.replaceChildren();
  if (!state.localProjects.length) { list.append(el('div', 'empty-state', 'No projects yet.')); return; }
  for (const p of state.localProjects) {
    const row = el('div', 'side-row');
    const count = state.sessions.filter(s => state.chatProjects[s.id] === p.id).length;
    const label = el('button', 'side-row-label' + (state.projectFilter === p.id ? ' project-filter' : ''), p.name + ' \u00b7 ' + count);
    label.type = 'button';
    label.onclick = () => { state.projectFilter = state.projectFilter === p.id ? null : p.id; renderProjects(); renderRecents(); };
    row.append(label);
    list.append(row);
  }
}
async function openSession(id) {
  if (state.busy) return; // the adapter's queue drain also calls this; stay silent
  closeSidebar();
  const sess = findSession(id);
  if (sess && (sess.messages || []).length) { state.session = sess; state.isPrivate = false; syncPrivate(); renderConversation(state.session); return; }
  try {
    const data = await api('/api/session/' + encodeURIComponent(id));
    state.session = data.session || data || null;
    if (state.session) { const i = state.sessions.findIndex(s => s.id === state.session.id); if (i >= 0) state.sessions[i] = state.session; else state.sessions.unshift(state.session); }
    state.isPrivate = false; syncPrivate();
    renderConversation(state.session);
  } catch (e) { toast(e.message); }
}
async function newSession() {
  if (state.busy) return;
  try {
    const data = await api('/api/sessions', { project_id: null });
    const sess = data.session || data;
    if (sess && sess.id) { state.session = sess; state.sessions.unshift(state.session); state.isPrivate = false; syncPrivate(); renderConversation(state.session); }
  } catch (e) { toast(e.message); }
}
function newChat() { if (state.busy) { toast('Finish the current answer first.'); return; } closeSidebar(); state.session = null; state.isPrivate = false; syncPrivate(); state.privateThread = []; renderConversation(null); $('prompt').focus(); }
async function renameChat(session) {
  const res = await showDialog({ title: 'Rename chat', fields: [{ name: 'name', value: session.title || 'New chat' }], okText: 'Rename' });
  if (!res || !String(res.name).trim()) return;
  try { await api('/api/sessions/update', { session_id: session.id, title: String(res.name).trim() }); refreshBootstrap(); } catch (e) { toast(e.message); }
}
async function deleteChat(session) {
  const ok = await confirmDialog('Delete this chat?', 'This chat will be deleted from your history. This can\u2019t be undone.', 'Delete');
  if (!ok) return;
  try { await api('/api/sessions/delete', { session_id: session.id }); if (state.session?.id === session.id) { state.session = null; } refreshBootstrap(); } catch (e) { toast(e.message); }
}
async function archiveChat(session) {
  try { await api('/api/sessions/update', { session_id: session.id, archived: true }); if (state.session?.id === session.id) state.session = null; refreshBootstrap(); } catch (e) { toast(e.message); }
}
async function pinChat(session) {
  try { await api('/api/sessions/update', { session_id: session.id, pinned: !session.pinned }); refreshBootstrap(); } catch (e) { toast(e.message); }
}
async function shareChat(session) {
  const lines = ['# ' + (session.title || 'New chat'), ''];
  for (const m of session.messages || []) lines.push('**' + (m.role === 'assistant' ? 'Janna' : 'You') + ':** ' + stripStyleDirective(m.content || ''), '');
  const ok = await copyCodeText(lines.join('\n'));
  toast(ok ? 'Conversation copied as Markdown' : 'Copy failed');
}

/* ---------- sidebar & header ---------- */
function openSidebar() { $('sidebar').classList.add('open'); const s = $('mobileScrim'); s.hidden = false; s.classList.add('visible'); }
function closeSidebar() { $('sidebar').classList.remove('open'); const s = $('mobileScrim'); s.classList.remove('visible'); s.hidden = true; $('accountMenu').hidden = true; }
function syncPrivate() {
  const c = $('composer');
  c.classList.toggle('private-mode', state.isPrivate);
  $('privateToggle').setAttribute('aria-pressed', String(state.isPrivate));
  $('welcomeH1').textContent = state.isPrivate ? 'What\u2019s on your mind today?' : 'What\u2019s on the agenda today?';
  $('privateNote').hidden = !state.isPrivate;
  if (state.isPrivate) { state.armedMode = null; renderModeChip(); $('prompt').placeholder = 'Ask anything\u2026'; }
  renderSuggestions();
}
function togglePrivate() {
  state.isPrivate = !state.isPrivate;
  if (state.isPrivate) { state.session = null; state.privateThread = []; renderConversation(null); toast('Private mode \u2014 this chat won\u2019t be saved.'); }
  syncPrivate();
}

/* ---------- menus (context popovers) ---------- */
let openMenuEl = null;
let menuOpenedAt = 0;
function closeMenus() { if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; } }
function showMenu(anchor, items) {
  closeMenus();
  menuOpenedAt = Date.now();
  const menu = el('div', 'menu-pop');
  menu.setAttribute('role', 'menu');
  for (const it of items) {
    if (it === 'sep') { menu.append(el('div', 'menu-divider')); continue; }
    if (it.group) { menu.append(el('div', 'menu-group', it.group)); continue; }
    const b = el('button', it.danger ? 'danger' : '');
    b.type = 'button';
    if (it.icon) b.innerHTML = '<svg><use href="#i-' + it.icon + '"/></svg>';
    b.append(document.createTextNode(it.label));
    if (it.sub) b.append(el('span', 'menu-sub', it.sub));
    if (it.disabled) { b.disabled = true; }
    b.onclick = () => { closeMenus(); it.onClick && it.onClick(); };
    menu.append(b);
  }
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth || 220;
  let x = Math.min(r.left, window.innerWidth - w - 8); if (x < 8) x = 8;
  menu.style.left = x + 'px';
  menu.style.top = (r.bottom + 6) + 'px';
  const h = menu.offsetHeight || 200;
  if (r.bottom + 6 + h > window.innerHeight) menu.style.top = Math.max(8, r.top - h - 6) + 'px';
  openMenuEl = menu;
  return menu;
}
function openChatMenu(session, anchor) {
  showMenu(anchor, [
    { label: session.pinned ? 'Unpin' : 'Pin', onClick: () => pinChat(session) },
    { label: 'Rename', onClick: () => renameChat(session) },
    { label: 'Share', onClick: () => shareChat(session) },
    { label: 'Add to Project', onClick: () => openProjectPicker(session, anchor) },
    'sep',
    { label: 'Archive', onClick: () => archiveChat(session) },
    { label: 'Delete', danger: true, onClick: () => deleteChat(session) },
  ]);
}
function openProjectPicker(session, anchor) {
  const items = state.localProjects.map(p => ({ label: (state.chatProjects[session.id] === p.id ? '\u2713 ' : '') + p.name, onClick: () => { state.chatProjects[session.id] = p.id; saveChatProjects(); renderProjects(); renderRecents(); toast('Added to ' + p.name); } }));
  items.push({ label: 'New project\u2026', onClick: () => createProject(session.id) });
  items.push('sep', { label: 'Remove from project', onClick: () => { delete state.chatProjects[session.id]; saveChatProjects(); renderProjects(); renderRecents(); }, disabled: !state.chatProjects[session.id] });
  showMenu(anchor, items);
}
async function createProject(chatId) {
  const res = await showDialog({ title: 'New project', text: 'Projects group related chats in your sidebar.', fields: [{ name: 'name', placeholder: 'Project name' }], okText: 'Create' });
  if (!res || !String(res.name).trim()) return;
  const p = { id: uid('proj'), name: String(res.name).trim(), created: Math.floor(Date.now() / 1000) };
  state.localProjects.unshift(p); saveProjects(); renderProjects();
  if (chatId) { state.chatProjects[chatId] = p.id; saveChatProjects(); renderRecents(); }
  toast('Project created: ' + p.name);
}
function openMessageMenu(message, session, anchor) {
  const items = [
    { label: 'Branch in new chat', onClick: () => branchMessage(message) },
    { label: 'Share', onClick: () => shareChat(session || state.session) },
    { label: 'Export to PDF', onClick: () => window.print() },
    { label: 'Copy Conversation ID', onClick: async () => { const id = session?.id || state.session?.id || ''; toast((await copyCodeText(id)) ? 'Conversation ID copied' : 'Copy failed'); } },
    'sep',
    { label: 'Send feedback', onClick: () => openFeedback(session?.id || state.session?.id) },
  ];
  showMenu(anchor || $('composer'), items);
}
async function branchMessage(message) {
  const text = stripStyleDirective(message.content || '');
  newChat();
  $('prompt').value = text; autoGrowPrompt(); syncSendState();
  toast('Branched into a new chat \u2014 press send when ready.');
}

/* ---------- right pane (app preview; scripts always off — the shell's
   iframe sandbox has no allow-scripts, so generated pages preview safely) ---------- */
function openRightPane() { $('rightPane').hidden = false; $('rightPaneToggle').setAttribute('aria-expanded', 'true'); }
function closeRightPane() { $('rightPane').hidden = true; $('rightPaneToggle').setAttribute('aria-expanded', 'false'); }
function previewHtml(code, name = 'Preview') {
  state.rightPaneCode = code; state.rightPaneName = name;
  const safe = String(code).replace(/<script[\s\S]*?<\/script>/gi, '');
  const frame = $('rightPaneFrame');
  frame.srcdoc = safe;
  frame.hidden = false;
  $('rightPaneSourceView').hidden = true;
  $('rightPaneSourceView').textContent = '';
  document.querySelector('.right-pane-empty').hidden = true;
  $('rightPanePreview').hidden = false;
  $('rightPaneName').textContent = name;
  openRightPane();
}
function clearPreview() {
  state.rightPaneCode = null; state.rightPaneName = '';
  $('rightPaneFrame').removeAttribute('srcdoc');
  $('rightPaneFrame').hidden = false;
  $('rightPaneSourceView').hidden = true;
  $('rightPaneSourceView').textContent = '';
  document.querySelector('.right-pane-empty').hidden = false;
  $('rightPanePreview').hidden = true;
  $('rightPaneName').textContent = 'preview.html';
}
async function saveCodeToLibrary(code, language) {
  const name = codeFileName(language);
  const text = String(code || '');
  const entry = { id: uid('lib'), name, kind: language === 'html' || language === 'htm' ? 'app' : 'file', kindLabel: language === 'html' || language === 'htm' ? 'App' : 'Code', text, size: text.length, created: Math.floor(Date.now() / 1000) };
  state.library.unshift(entry); saveLibrary(); renderLibrary();
  toast('Saved to Library as ' + name);
}

/* ---------- library ---------- */
function libraryUsageBytes() {
  try { return (localStorage.getItem('janna-web-library-v1') || '').length; } catch { return 0; }
}
function renderLibraryTabs() {
  const tabs = $('libraryTabs');
  tabs.replaceChildren();
  for (const t of ['All', 'Media', 'Projects', 'Apps', 'Files']) {
    const b = el('button', 'palette-tab' + (state.libraryTab === t ? ' active' : ''));
    b.type = 'button'; b.textContent = t; b.dataset.tab = t;
    b.onclick = () => { state.libraryTab = t; renderLibraryTabs(); renderLibrary(); };
    tabs.append(b);
  }
}
function renderLibrary() {
  const list = $('libraryBody'); list.replaceChildren();
  const q = state.libraryQuery.toLowerCase();
  let items = state.library.filter(it => !q || (it.name || '').toLowerCase().includes(q));
  if (state.librarySort === 'name') items = [...items].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  else items = [...items].sort((a, b) => (b.created || 0) - (a.created || 0));
  if (state.libraryTab === 'Media') items = items.filter(it => it.kind === 'image');
  else if (state.libraryTab === 'Apps') items = items.filter(it => it.kind === 'app');
  else if (state.libraryTab === 'Files') items = items.filter(it => it.kind === 'file');
  else if (state.libraryTab === 'Projects') {
    for (const p of state.localProjects) {
      const row = el('div', 'library-item');
      const main = el('button', 'lib-main');
      main.type = 'button';
      main.innerHTML = `<svg><use href="#i-book"/></svg><span class="lib-texts"><strong>${escapeHTML(p.name)}</strong><small>${state.sessions.filter(s => state.chatProjects[s.id] === p.id).length} chats</small></span>`;
      main.onclick = () => { state.projectFilter = p.id; renderProjects(); renderRecents(); closeLibrary(); toast('Showing chats in ' + p.name); };
      row.append(main);
      list.append(row);
    }
    if (!state.localProjects.length) {
      const empty = el('div', 'library-empty');
      empty.innerHTML = '<strong>No projects yet</strong>Create one from the sidebar.';
      list.append(empty);
    }
    return;
  }
  if (!items.length) {
    const empty = el('div', 'library-empty');
    empty.innerHTML = '<strong>Your library is empty</strong>Upload a file to keep it here.';
    list.append(empty);
    return;
  }
  for (const it of items) {
    const row = el('div', 'library-item');
    const main = el('button', 'lib-main');
    main.type = 'button';
    const icon = it.kind === 'image' ? 'image' : it.kind === 'app' ? 'panel' : 'file';
    main.innerHTML = `<svg><use href="#i-${icon}"/></svg><span class="lib-texts"><strong>${escapeHTML(it.name)}</strong><small>${escapeHTML(it.kindLabel || it.kind)} \u00b7 ${timeAgo(it.created)}</small></span>`;
    main.onclick = () => openLibraryItem(it);
    const del = el('button', 'lib-del');
    del.type = 'button'; del.setAttribute('aria-label', 'Delete ' + it.name);
    del.innerHTML = '<svg><use href="#i-close"/></svg>';
    del.onclick = () => removeLibraryItem(it);
    row.append(main, del);
    list.append(row);
  }
}
function openLibraryItem(it) {
  closeLibrary();
  if (it.kind === 'app') { previewHtml(it.text || '', it.name); return; }
  if (it.kind === 'image' && it.data) {
    const mime = /\.png$/i.test(it.name) ? 'image/png' : /\.webp$/i.test(it.name) ? 'image/webp' : 'image/jpeg';
    const a = document.createElement('a');
    a.href = 'data:' + mime + ';base64,' + it.data;
    a.download = it.name;
    a.click();
    toast('Downloading ' + it.name);
    return;
  }
  showDialog({ title: it.name, text: String(it.text || '').slice(0, 2000), okText: 'Close', showCancel: false });
}
async function removeLibraryItem(it) {
  const ok = await confirmDialog('Remove from library?', it.name + ' will be removed from your library.', 'Remove');
  if (!ok) return;
  state.library = state.library.filter(row => row !== it); saveLibrary(); renderLibrary();
}
function openLibrary() { renderLibraryTabs(); renderLibrary(); $('libraryView').hidden = false; }
function closeLibrary() { $('libraryView').hidden = true; }
async function addFilesToLibrary(files) {
  for (const file of files) {
    const name = file.name || 'file';
    const isImage = /\.(png|jpe?g|webp)$/i.test(name);
    try {
      if (isImage) {
        const small = file.size > 1200000 ? await downscaleImageFile(file).catch(() => null) : file;
        const use = small || file;
        const data = await fileBase64(use);
        if (data.length > 280000) { toast(name + ' is too large to keep in the library.'); continue; }
        state.library.unshift({ id: uid('lib'), name, kind: 'image', kindLabel: 'Image', data, size: data.length, created: Math.floor(Date.now() / 1000) });
      } else {
        if (file.size > 180000) { toast(name + ' is too large to keep in the library.'); continue; }
        const text = await file.text();
        if (text.includes('\u0000')) { toast(name + ' is not a text file.'); continue; }
        const kind = /\.html?$/i.test(name) ? 'app' : 'file';
        state.library.unshift({ id: uid('lib'), name, kind, kindLabel: kind === 'app' ? 'App' : 'File', text, size: text.length, created: Math.floor(Date.now() / 1000) });
      }
    } catch (e) { toast(e.message); }
  }
  saveLibrary(); renderLibrary();
  toast('Added to Library');
}

/* ---------- plus menu ---------- */
function closePlusMenu() { const m = $('plusMenu'); if (m) m.hidden = true; $('plusBtn').setAttribute('aria-expanded', 'false'); }
function openPlusMenu() {
  const m = $('plusMenu'), btn = $('plusBtn');
  if (!m.hidden) { closePlusMenu(); return; }
  closeModelPicker();
  m.replaceChildren();
  const researchOn = state.settings.research_mode === 'always';
  const addRow = (icon, label, hint, onClick) => {
    const b = el('button', 'plus-menu-row');
    b.type = 'button';
    b.innerHTML = `<svg><use href="#i-${icon}"/></svg><span>${escapeHTML(label)}</span>${hint ? `<span class="plus-menu-state">${escapeHTML(hint)}</span>` : ''}`;
    b.onclick = () => { closePlusMenu(); onClick(); };
    m.append(b);
  };
  addRow('upload', 'Upload a file', 'png, jpg, webp, txt, code', () => $('attachment').click());
  addRow('file', 'Recent', 'Files from your library', () => openLibrary());
  addRow('book', 'Project', 'Add this chat to a project', () => { if (state.session) openProjectPicker(state.session, btn); else createProject(); });
  addRow('external', 'Add connector', 'Tavily, GitHub, Figma', () => openToolsPanel());
  m.append(el('div', 'plus-menu-divider'));
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
}

/* ---------- send / stream / queue / stop ---------- */
function queueInput() {
  const text = $('prompt').value.trim();
  if (!text && !state.pending.length) return;
  const session = state.session;
  if (!session) { toast('Wait for the current answer, then send.'); return; }
  const directive = styleDirective();
  const sentText = text + (directive ? '\n\n[Response style: ' + directive + ']' : '');
  api('/api/run/update', { session_id: session.id, text: sentText, attachments: state.pending.map(a => a.kind === 'image' ? { kind: 'image', name: a.name, data: a.data } : { kind: 'log', name: a.name, text: a.text }) })
    .then(() => {
      $('prompt').value = ''; autoGrowPrompt(); syncSendState();
      session.messages = session.messages || [];
      session.messages.push({ role: 'user', content: sentText });
      renderConversation(session);
      toast('Queued \u2014 it will run after this answer.');
    })
    .catch(e => toast(e.message));
}
async function send() {
  if (state.busy) { queueInput(); return; }
  const text = $('prompt').value.trim();
  if (!text && !state.pending.length) return;
  closeMenus(); closeModelPicker(); closePlusMenu();
  const directive = styleDirective();
  const sentText = text + (directive ? '\n\n[Response style: ' + directive + ']' : '');
  if (state.isPrivate) { await sendPrivate(text, sentText); return; }
  if (!state.session) { await newSession(); if (!state.session) return; }
  const session = state.session;
  const attachments = state.pending; state.pending = []; renderPending();
  const userMsg = { role: 'user', content: sentText };
  if (attachments.length === 1 && attachments[0].kind === 'image') { userMsg.kind = 'image'; userMsg.data = attachments[0].data; userMsg.name = attachments[0].name; }
  else if (attachments.length === 1 && attachments[0].kind === 'log') { userMsg.kind = 'log'; userMsg.name = attachments[0].name; }
  else if (attachments.length > 1) userMsg.attached = attachments.map(a => ({ kind: a.kind, name: a.name }));
  const history = (session.messages || []).slice(-20).map(m => ({ role: m.role, content: stripStyleDirective(m.content || '') }));
  session.messages = session.messages || [];
  session.messages.push(userMsg);
  $('prompt').value = ''; autoGrowPrompt(); syncSendState();
  renderConversation(session);
  await streamRun(session, sentText, history, attachments);
}
async function sendPrivate(text, sentText) {
  const attachments = state.pending; state.pending = []; renderPending();
  const userMsg = { role: 'user', content: sentText };
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
      else if (kind === 'reconnecting') addProgressStep('Reconnecting\u2026 ' + (msg || ''));
    });
    for await (const ev of gen) {
      if (ev.run_id) state.runId = ev.run_id;
      if (ev.type === 'progress') { if (ev.message) addProgressStep(ev.message); }
      else if (ev.type === 'first_token') stopThinking();
      else if (ev.type === 'delta') {
        state.stream += ev.text || '';
        renderMarkdown(body, state.stream);
        scrollThreadToBottom();
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
    const am = { role: 'assistant', content: finalText };
    state.privateThread.push(am);
    if (edit && edit.msg && Array.isArray(edit.msg.versions)) edit.msg.versions[edit.msg.version].response = am;
    renderConversation({ id: 'private', title: 'Private chat', messages: state.privateThread });
    if (!errorMessage && state.settings.voice_output === true) voiceSpeak(finalText);
    return;
  }
  session.messages = session.messages || [];
  const am = { role: 'assistant', content: finalText };
  session.messages.push(am);
  if (edit && edit.msg && Array.isArray(edit.msg.versions)) edit.msg.versions[edit.msg.version].response = am;
  renderConversation(session);
  if (errorMessage) toast(errorMessage);
  else {
    if (state.settings.voice_output === true) voiceSpeak(finalText);
    if (state.settings.browser_notifications === true && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification('Janna AI', { body: finalText.slice(0, 140) }); } catch { /* ignore */ }
    }
  }
  refreshBootstrap(true);
  // The adapter titles a chat from its first prompt in storage; the
  // in-memory session keeps 'New chat' until this sync runs.
  const freshTitle = state.session && findSession(state.session.id);
  if (freshTitle && freshTitle.title) { state.session.title = freshTitle.title; $('threadTitle').textContent = freshTitle.title; }
  // NOTE: queued follow-ups are drained by the web-adapter itself (it posts
  // the next queued item to /api/run and calls openSession when it finishes),
  // so the app must NOT re-send them here — that would run them twice.
}
async function stopRun() {
  if (!state.busy) return;
  state.stopRequested = true;
  $('stop').disabled = true;
  const sid = state.isPrivate ? null : state.session?.id;
  try {
    if (sid) await api('/api/stop', { session_id: sid, run_id: state.runId });
  } catch (e) { toast(e.message); }
}

/* ---------- command palette ---------- */
function openPalette() {
  $('palette').hidden = false;
  $('paletteInput').value = '';
  $('paletteInput').focus();
  renderPalette();
}
function closePalette() { $('palette').hidden = true; }
function renderPalette() {
  const q = $('paletteInput').value.trim().toLowerCase();
  const list = $('paletteBody');
  list.replaceChildren();
  const tab = state.paletteTab;
  const addSection = (title, rows) => {
    if (!rows.length) return;
    list.append(el('div', 'palette-group', title));
    for (const r of rows) {
      const b = el('button', 'palette-item');
      b.type = 'button';
      b.innerHTML = `<svg><use href="#i-${r.icon || 'search'}"/></svg><span>${escapeHTML(r.label)}</span>${r.kbd ? `<kbd>${escapeHTML(r.kbd)}</kbd>` : r.meta ? `<span class="palette-item-meta">${escapeHTML(r.meta)}</span>` : ''}`;
      b.onclick = () => { closePalette(); r.onClick(); };
      list.append(b);
    }
  };
  if (tab === 'All' || tab === 'Apps') {
    addSection(tab === 'All' ? 'Actions' : 'Apps', [
      { label: 'New Chat', kbd: 'Ctrl J', icon: 'plus', onClick: () => newChat() },
      { label: 'New Project', meta: '', icon: 'book', onClick: () => createProject() },
      { label: 'Open settings', kbd: 'Ctrl ,', icon: 'settings', onClick: () => openSettings('account') },
    ].filter(r => !q || r.label.toLowerCase().includes(q)));
  }
  if (tab === 'All' || tab === 'Imagine') {
    addSection('Imagine', [
      { label: 'Make a website', meta: 'Apps', icon: 'spark', onClick: () => { armMode('apps'); $('prompt').focus(); } },
      { label: 'Design a presentation', meta: 'Slides', icon: 'book', onClick: () => { armMode('presentation'); $('prompt').focus(); } },
    ].filter(r => !q || r.label.toLowerCase().includes(q)));
  }
  if ((tab === 'All' || tab === 'Files') && !q) {
    addSection('Files', state.library.slice(0, 5).map(it => ({ label: it.name, meta: it.kindLabel || it.kind, icon: 'file', onClick: () => openLibraryItem(it) })));
  }
  if (tab === 'Automations') {
    list.append(el('div', 'palette-empty', 'Janna has no automations yet.'));
  }
  if ((tab === 'All' || tab === 'Files') && q) {
    addSection('Files', state.library.filter(it => (it.name || '').toLowerCase().includes(q)).map(it => ({ label: it.name, meta: it.kindLabel || it.kind, icon: 'file', onClick: () => openLibraryItem(it) })));
  }
  if (tab === 'All') {
    const chats = visibleChats().filter(s => !q || (s.title || '').toLowerCase().includes(q) || (s.messages || []).some(m => (m.content || '').toLowerCase().includes(q)));
    addSection('Chats', chats.slice(0, 8).map(s => ({ label: s.title || 'New chat', meta: timeAgo(s.updated), icon: 'search', onClick: () => openSession(s.id) })));
  }
  if (!list.childNodes.length) list.append(el('div', 'palette-empty', 'No results for \u201c' + $('paletteInput').value.trim() + '\u201d'));
}
function renderPaletteTabs() {
  const tabs = $('paletteTabs');
  tabs.replaceChildren();
  for (const t of ['All', 'Imagine', 'Apps', 'Automations', 'Files']) {
    const b = el('button', 'palette-tab' + (state.paletteTab === t ? ' active' : ''));
    b.type = 'button'; b.textContent = t;
    b.onclick = () => { state.paletteTab = t; renderPaletteTabs(); renderPalette(); };
    tabs.append(b);
  }
}

/* ---------- settings ---------- */
const SETTINGS_SECTIONS = [
  { id: 'account', label: 'Account' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'behavior', label: 'Behavior' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'personality', label: 'Customize' },
  { id: 'connectors', label: 'Connect Apps' },
  { id: 'data', label: 'Data Controls' },
];
function openSettings(section = 'account') {
  closeSidebar();
  const overlay = $('settingsView');
  overlay.hidden = false;
  const nav = $('settingsNav'); nav.replaceChildren();
  for (const s of SETTINGS_SECTIONS) {
    const b = el('button', 'settings-nav-item' + (s.id === section ? ' active' : ''));
    b.type = 'button'; b.textContent = s.label;
    b.onclick = () => renderSettingsBody(s.id);
    nav.append(b);
  }
  $('settingsSearch').value = '';
  renderSettingsBody(section);
  try { const u = new URL(location.href); u.searchParams.set('_s', section); history.replaceState(null, '', u); } catch { /* ignore */ }
}
function closeSettings() {
  $('settingsView').hidden = true;
  try { const u = new URL(location.href); u.searchParams.delete('_s'); history.replaceState(null, '', u); } catch { /* ignore */ }
}
function settingsRow({ label, hint = '', control }) {
  const row = el('div', 'settings-row');
  const texts = el('div', 'settings-row-texts');
  texts.append(el('strong', '', label));
  if (hint) texts.append(el('p', '', hint));
  row.append(texts, control);
  return row;
}
function settingsSelect(options, value, onChange) {
  const sel = document.createElement('select');
  for (const [v, l] of options) { const o = document.createElement('option'); o.value = v; o.textContent = l; sel.append(o); }
  sel.value = value;
  sel.onchange = () => onChange(sel.value);
  return sel;
}
function settingsToggle(checked, onChange) {
  const t = document.createElement('input');
  t.type = 'checkbox'; t.checked = !!checked;
  t.setAttribute('aria-label', 'Toggle setting');
  t.onchange = () => onChange(t.checked);
  return t;
}
function renderSettingsBody(section) {
  const body = $('settingsBody');
  body.replaceChildren();
  document.querySelectorAll('#settingsNav .settings-nav-item').forEach(b => b.classList.toggle('active', b.textContent === (SETTINGS_SECTIONS.find(s => s.id === section)?.label || '')));
  const h = title => body.append(el('h2', '', title));
  const applySearch = () => {
    const q = $('settingsSearch').value.trim().toLowerCase();
    body.querySelectorAll('.settings-row').forEach(r => { r.hidden = !q || r.textContent.toLowerCase().includes(q); });
  };
  if (section === 'account') {
    h('Account');
    body.append(settingsRow({ label: 'Workspace', hint: 'Guest workspace \u2014 no account, no sign-in', control: el('span', 'settings-value', 'Guest') }));
    body.append(settingsRow({ label: 'Plan', hint: 'Janna AI is free. Every model is included.', control: el('span', 'settings-value', 'Free') }));
    body.append(settingsRow({ label: 'Language', hint: 'Language for answers and voice', control: settingsSelect((state.languages || []).map(l => [l.id, l.name]), state.settings.language || 'en', v => persistSettings({ language: v })) }));
  } else if (section === 'appearance') {
    h('Appearance');
    body.append(settingsRow({ label: 'Theme', hint: 'Light, Dark, or follow your device', control: settingsSelect([['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], state.settings.appearance_mode || 'system', v => persistSettings({ appearance_mode: v })) }));
    body.append(settingsRow({ label: 'Wrap Long Code Blocks', hint: 'Wrap code lines instead of scrolling sideways', control: settingsToggle(state.settings.wrap_code === true, v => persistSettings({ wrap_code: v })) }));
    body.append(settingsRow({ label: 'Reduce motion', hint: 'Turn off animations', control: settingsToggle(state.settings.reduce_motion === true, v => persistSettings({ reduce_motion: v })) }));
    body.append(settingsRow({ label: 'Show suggestions', hint: 'Suggestion rows and follow-up chips', control: settingsToggle(state.settings.show_suggestions !== false, v => persistSettings({ show_suggestions: v })) }));
  } else if (section === 'behavior') {
    h('Behavior');
    body.append(settingsRow({ label: 'Require Ctrl+Enter to Submit', hint: 'Enter inserts a new line instead of sending', control: settingsToggle(state.settings.require_ctrl_enter === true, v => persistSettings({ require_ctrl_enter: v })) }));
    body.append(settingsRow({ label: 'Auto-Scroll', hint: 'Follow new answers as they stream in', control: settingsToggle(state.settings.auto_scroll !== false, v => persistSettings({ auto_scroll: v })) }));
  } else if (section === 'notifications') {
    h('Notifications');
    body.append(settingsRow({ label: 'Browser Notifications', hint: 'Notify when an answer finishes while the tab is hidden', control: settingsToggle(state.settings.browser_notifications === true, async v => {
      if (v && 'Notification' in window) {
        const perm = await Notification.requestPermission().catch(() => 'denied');
        if (perm !== 'granted') { toast('Browser notifications were not allowed.'); renderSettingsBody('notifications'); return; }
      }
      persistSettings({ browser_notifications: v });
    }) }));
    body.append(el('p', 'settings-note', 'No email notifications \u2014 Janna has no account or email address to send to.'));
  } else if (section === 'personality') {
    h('Customize');
    const styles = [['Default', 'Default'], ['Concise', 'Concise'], ['Formal', 'Formal'], ['Tutor', 'Tutor'], ['Comprehensive', 'Comprehensive'], ['Custom', 'Custom']];
    body.append(settingsRow({ label: 'Response style', hint: 'How Janna answers. Applied to each prompt sent to the model.', control: settingsSelect(styles, state.settings.response_style || 'Default', v => { persistSettings({ response_style: v }); renderSettingsBody('personality'); }) }));
    if ((state.settings.response_style || 'Default') === 'Custom') {
      const ta = document.createElement('textarea');
      ta.value = state.settings.custom_style || '';
      ta.placeholder = 'Describe how Janna should answer\u2026';
      ta.onchange = () => persistSettings({ custom_style: ta.value });
      body.append(settingsRow({ label: 'Custom instruction', hint: 'Your own style instruction', control: ta }));
    }
  } else if (section === 'connectors') {
    h('Connect Apps');
    body.append(el('p', 'settings-note', 'Your apps \u2014 0 connected'));
    const search = document.createElement('input');
    search.type = 'search'; search.placeholder = 'Search apps'; search.setAttribute('aria-label', 'Search apps');
    body.append(search);
    const list = el('div', 'connectors-list');
    const rows = [
      { name: 'GitHub', status: 'Not connected in the web version' },
      { name: 'Figma', status: 'Not connected in the web version' },
      { name: 'Tavily (web search)', status: 'No search key saved' },
    ];
    const renderRows = () => {
      list.replaceChildren();
      const q = search.value.trim().toLowerCase();
      for (const r of rows.filter(r => !q || r.name.toLowerCase().includes(q))) {
        const row = el('div', 'connector-row');
        row.append(el('strong', '', r.name), el('small', '', r.status));
        list.append(row);
      }
      if (!list.childNodes.length) list.append(el('div', 'empty-state', 'No apps match your search.'));
    };
    search.oninput = renderRows;
    renderRows();
    body.append(list);
    const addBtn = button('Add a custom connector', () => openToolsPanel());
    addBtn.classList.add('text-btn');
    body.append(addBtn);
    body.append(el('p', 'settings-note', 'The web edition keeps connections local to this browser. GitHub and Figma sign-in are desktop-only features.'));
  } else if (section === 'data') {
    h('Data Controls');
    body.append(settingsRow({ label: 'Personalize With Conversation History', hint: 'Janna remembers facts from your chats to answer better', control: settingsToggle(state.settings.memory_enabled !== false, v => persistSettings({ memory_enabled: v })) }));
    body.append(settingsRow({ label: 'File Storage', hint: 'Local files in your Library', control: el('span', 'settings-value', Math.round(libraryUsageBytes() / 1024) + ' KB used in this browser') }));
    const archived = state.sessions.filter(s => s.archived);
    body.append(settingsRow({ label: 'Deleted Conversations', hint: archived.length ? archived.length + ' archived conversation(s)' : 'No archived conversations', control: button('View', () => showArchived()) }));
    body.append(settingsRow({ label: 'Delete All Conversations', hint: 'Deletes every chat in your history', control: button('Delete all', async () => {
      const ok = await confirmDialog('Delete all conversations?', 'Every chat in your history will be deleted. This can\u2019t be undone.', 'Delete all');
      if (!ok) return;
      try { await api('/api/sessions/clear'); state.session = null; refreshBootstrap(); renderConversation(null); toast('All conversations deleted.'); } catch (e) { toast(e.message); }
    }) }));
    body.append(settingsRow({ label: 'Export Account Data', hint: 'Download your chats, settings and memory as JSON', control: button('Export', async () => {
      try {
        const data = await api('/api/profile/export');
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'janna-data.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        toast('Export downloaded.');
      } catch (e) { toast(e.message); }
    }) }));
    body.append(settingsRow({ label: 'Clear Cache', hint: 'Clears the offline cache and reloads', control: button('Clear cache', async () => {
      try { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))); } catch { /* no cache */ }
      location.reload();
    }) }));
  }
  $('settingsSearch').oninput = applySearch;
}
async function showArchived() {
  const archived = state.sessions.filter(s => s.archived);
  if (!archived.length) { toast('No archived conversations.'); return; }
  const lines = archived.map(s => '\u2022 ' + (s.title || 'New chat')).join('\n');
  const ok = await showDialog({ title: 'Archived conversations', text: lines + '\n\nRestore the most recent one?', okText: 'Restore latest', cancelText: 'Close' });
  if (!ok) return;
  const latest = [...archived].sort((a, b) => (b.updated || 0) - (a.updated || 0))[0];
  try { await api('/api/sessions/update', { session_id: latest.id, archived: false }); refreshBootstrap(); toast('Restored: ' + (latest.title || 'New chat')); } catch (e) { toast(e.message); }
}

/* ---------- tools panel (connectors) ---------- */
async function openToolsPanel() {
  const res = await showDialog({
    title: 'Add a custom connector',
    text: 'Tavily powers web search. GitHub and Figma sign-in are desktop-only on the web edition.',
    fields: [{ name: 'tavily', placeholder: 'Tavily API key (optional)' }],
    okText: 'Save', cancelText: 'Close',
  });
  if (!res) return;
  const key = String(res.tavily || '').trim();
  if (!key) { toast('No key entered.'); return; }
  try {
    await api('/api/research/providers', { provider: 'tavily', api_key: key });
    toast('Tavily key saved.');
  } catch (e) { toast(e.message); }
}

/* ---------- account menu (static shell menu), help, feedback ---------- */
function toggleAccountMenu() {
  const m = $('accountMenu');
  m.hidden = !m.hidden;
}
function openHelp() {
  showDialog({
    title: 'Help \u2014 Janna AI',
    text: 'Ask Janna anything in the composer. Tap + to attach a file or an image. Use the model picker to switch between the 16 free models. Private mode (header) keeps a chat out of your history. Your chats, projects and library live only in this browser \u2014 nothing is sent anywhere except the model provider when you send a message. Shortcuts: Ctrl+K search, Ctrl+J new chat, Ctrl+, settings.',
    okText: 'Close', showCancel: false,
  });
}
async function openFeedback(sessionId) {
  const res = await showDialog({
    title: 'Send feedback',
    text: 'Tell us what worked or what went wrong. Feedback is stored only in this browser.',
    fields: [{ name: 'text', type: 'textarea', placeholder: 'Your feedback\u2026' }],
    okText: 'Send feedback',
  });
  if (!res || !String(res.text).trim()) return;
  const all = loadJSON('janna-web-feedback-v1', []);
  all.unshift({ session_id: sessionId || null, text: String(res.text).trim(), created: Math.floor(Date.now() / 1000) });
  saveJSON('janna-web-feedback-v1', all);
  toast('Thanks \u2014 feedback saved.');
}
function openLegal(kind) {
  const text = kind === 'terms'
    ? 'Janna AI is a free chat app. Chats, projects and files are stored only in this browser. When you send a message, the text (and any attached file you chose to send) goes to the selected model provider so it can answer. There is no account, no payment and no tracking.'
    : 'Privacy: Janna AI has no account system. Your chats stay in this browser unless you export them. Model providers receive the messages you send. Private mode chats are never saved to history. You can delete all conversations or clear the cache from Settings \u2192 Data Controls.';
  showDialog({ title: kind === 'terms' ? 'Terms of Service' : 'Privacy Policy', text, okText: 'Close', showCancel: false });
}

/* ---------- bootstrap ---------- */
let reconnectTimer = null;
async function initialConnection() {
  try {
    const info = await api('/api/remote-info');
    state.remote = info.remote === true;
    const saved = (() => { try { return localStorage.getItem('janna-pair-token') || ''; } catch { return ''; } })();
    if (state.remote) state.token = info.pair_required === true ? saved : 'web';
    else state.token = 'web';
    if (state.remote && info.pair_required === true && !state.token) {
      const res = await showDialog({ title: 'Pair this device', text: 'Enter the pairing code shown on your computer.', fields: [{ name: 'code', placeholder: 'Pairing code' }], okText: 'Pair' });
      if (!res || !String(res.code).trim()) return;
      const pair = await api('/api/pair', { code: String(res.code).trim() });
      state.token = pair.token || ''; saveLocalToken();
    }
  } catch { state.token = 'web'; }
}
async function refreshBootstrap(keepSession) {
  try {
    const b = await api('/api/bootstrap');
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
      // summaries carry no messages; keep the in-memory session in that case
    }
    renderRecents(); renderProjects(); renderLibrary(); renderSuggestions(); syncPrivate();
    statusBadge();
  } catch (e) {
    toast('Could not reach Janna. ' + e.message);
    statusBadge();
  }
}
function reconnectCheck() {
  try { refreshBootstrap(true); } catch { /* next cycle */ }
}
function initializeWorkspace() {
  const params = new URLSearchParams(location.search);
  const open = params.get('s');
  const settingsSection = params.get('_s');
  if (settingsSection) openSettings(settingsSection);
  if (open) openSession(open);
}
function bindEvents() {
  const prompt = $('prompt');
  prompt.addEventListener('input', () => { autoGrowPrompt(); syncSendState(); });
  prompt.addEventListener('keydown', e => {
    const ctrlEnter = state.settings.require_ctrl_enter === true;
    if (e.key === 'Enter' && !e.shiftKey) {
      if (ctrlEnter && !(e.ctrlKey || e.metaKey)) return; // insert newline
      e.preventDefault();
      send();
    }
  });
  prompt.addEventListener('paste', e => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); handleFiles(files); }
  });
  $('send').onclick = () => send();
  $('stop').onclick = () => stopRun();
  $('plusBtn').onclick = () => openPlusMenu();
  $('modelPickerBtn').onclick = () => openModelPicker();
  $('voiceMic').onclick = () => voiceDictate();
  $('voiceModeBtn').onclick = () => voiceOpen();
  $('attachment').onchange = e => { handleFiles([...e.target.files]); e.target.value = ''; };
  $('sidebarToggle').onclick = () => {
    // Desktop (>=1024px): the sidebar is a static column, so .open has no
    // visible effect there — collapse it instead. Phone: overlay open/close.
    if (matchMedia('(min-width:1024px)').matches) { document.body.classList.toggle('sidebar-hidden'); return; }
    $('sidebar').classList.contains('open') ? closeSidebar() : openSidebar();
  };
  $('mobileScrim').onclick = () => closeSidebar();
  $('newChat').onclick = () => newChat();
  $('chatsPlus').onclick = () => newChat();
  $('navLibrary').onclick = () => { closeSidebar(); openLibrary(); };
  $('newProjectBtn').onclick = () => createProject();
  $('profileOpen').onclick = () => toggleAccountMenu();
  $('amSettings').onclick = () => { $('accountMenu').hidden = true; openSettings('account'); };
  $('amHelp').onclick = () => { $('accountMenu').hidden = true; openHelp(); };
  $('sidebarSettings').onclick = () => openSettings('account');
  $('projectsHead').onclick = e => { if (e.target.closest('.side-head-dots')) return; $('projectsSection').classList.toggle('collapsed'); };
  $('chatsHead').onclick = e => { if (e.target.closest('.side-head-dots') || e.target.closest('.side-head-plus')) return; $('chatsSection').classList.toggle('collapsed'); };
  $('projectsDots').onclick = e => { e.stopPropagation(); showMenu(e.currentTarget, [{ label: 'New project', icon: 'plus', onClick: () => createProject() }]); };
  $('chatsDots').onclick = e => {
    e.stopPropagation();
    showMenu(e.currentTarget, [
      { label: 'New chat', icon: 'plus', onClick: () => newChat() },
      { label: 'Show archived', icon: 'archive', onClick: () => showArchived() },
      'sep',
      { label: 'Delete all conversations', icon: 'trash', danger: true, onClick: async () => {
        const ok = await confirmDialog('Delete all conversations?', 'Every chat in your history will be deleted. This can\u2019t be undone.', 'Delete all');
        if (!ok) return;
        try { await api('/api/sessions/clear'); state.session = null; refreshBootstrap(); renderConversation(null); toast('All conversations deleted.'); } catch (err) { toast(err.message); }
      } },
    ]);
  };
  $('showMoreChats').onclick = () => { state.showAllChats = !state.showAllChats; renderRecents(); };
  $('headerSearch').onclick = () => openPalette();
  $('privateToggle').onclick = () => togglePrivate();
  $('rightPaneToggle').onclick = () => { $('rightPane').hidden ? openRightPane() : closeRightPane(); };
  $('rightPaneHide').onclick = () => closeRightPane();
  $('rightPaneNewTab').onclick = () => clearPreview();
  $('appPreviewRow').onclick = () => {
    if (state.rightPaneCode) { $('rightPanePreview').hidden = false; document.querySelector('.right-pane-empty').hidden = true; }
    else toast('No preview yet \u2014 generate a page or open a file.');
  };
  $('openFileRow').onclick = () => $('previewFileInput').click();
  $('previewFileInput').onchange = async e => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    if (!/\.html?$/i.test(file.name)) { toast('Only .html files can be previewed here.'); return; }
    previewHtml(await file.text(), file.name);
  };
  $('rightPaneCopy').onclick = async () => { if (!state.rightPaneCode) return; toast((await copyCodeText(state.rightPaneCode)) ? 'Preview code copied' : 'Copy failed'); };
  $('rightPaneDownload').onclick = () => {
    if (!state.rightPaneCode) return;
    const blob = new Blob([state.rightPaneCode], { type: 'text/html' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = state.rightPaneName || 'preview.html'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  $('rightPaneSource').onclick = () => {
    if (!state.rightPaneCode) return;
    const view = $('rightPaneSourceView'), frame = $('rightPaneFrame');
    if (view.hidden) { view.textContent = state.rightPaneCode; view.hidden = false; frame.hidden = true; }
    else { view.hidden = true; view.textContent = ''; frame.hidden = false; }
  };
  $('libraryClose').onclick = () => closeLibrary();
  $('libraryUpload').onclick = () => $('libraryFileInput').click();
  $('libraryFileInput').onchange = e => { addFilesToLibrary([...e.target.files]); e.target.value = ''; };
  $('librarySearch').oninput = e => { state.libraryQuery = e.target.value; renderLibrary(); };
  $('libraryViewOptions').onclick = () => {
    state.librarySort = state.librarySort === 'name' ? 'date' : 'name';
    renderLibrary();
    toast(state.librarySort === 'name' ? 'Library sorted by name' : 'Library sorted by newest first');
  };
  $('paletteClose').onclick = () => closePalette();
  $('paletteInput').oninput = () => renderPalette();
  $('settingsClose').onclick = () => closeSettings();
  $('termsLink').onclick = () => openLegal('terms');
  $('privacyLink').onclick = () => openLegal('privacy');
  $('convMenuBtn').onclick = e => {
    const s = state.session;
    if (!s) return;
    showMenu(e.currentTarget, [
      { label: 'Share', icon: 'share', onClick: () => shareChat(s) },
      { label: s.pinned ? 'Unpin' : 'Pin', icon: 'pin', onClick: () => pinChat(s) },
      { label: 'Rename', icon: 'edit', onClick: () => renameChat(s) },
      { label: 'Add to Project', icon: 'book', onClick: () => openProjectPicker(s, e.currentTarget) },
      { label: 'Send Feedback', icon: 'feedback', onClick: () => openFeedback(s.id) },
      { label: 'Copy Conversation ID', icon: 'copy', onClick: async () => { toast((await copyCodeText(s.id)) ? 'Conversation ID copied' : 'Copy failed'); } },
      { label: 'Open in new tab', icon: 'external', onClick: () => window.open(location.pathname + '?s=' + encodeURIComponent(s.id), '_blank') },
      'sep',
      { label: 'Archive', icon: 'archive', onClick: () => archiveChat(s) },
      { label: 'Delete', icon: 'trash', danger: true, onClick: () => deleteChat(s) },
    ]);
  };
  $('messages').addEventListener('click', async e => {
    const actionBtn = e.target.closest('[data-code-action]');
    if (!actionBtn) return;
    const body = actionBtn.closest('.message-body');
    const blocks = codeByBody.get(body) || [];
    const block = blocks[Number(actionBtn.dataset.codeIndex)];
    if (!block) return;
    if (actionBtn.dataset.codeAction === 'copy') toast((await copyCodeText(block.code)) ? 'Code copied' : 'Copy failed');
    else if (actionBtn.dataset.codeAction === 'preview') previewHtml(block.code, codeFileName(block.language));
    else if (actionBtn.dataset.codeAction === 'save') saveCodeToLibrary(block.code, block.language);
  });
  document.addEventListener('click', e => {
    // The click that opened a menu bubbles up here in the same task; don't
    // let it close the menu it just opened.
    if (openMenuEl && !openMenuEl.contains(e.target) && Date.now() - menuOpenedAt > 50) closeMenus();
    if (!$('modelPicker').hidden && !e.target.closest('#modelPicker') && !e.target.closest('#modelPickerBtn')) closeModelPicker();
    if (!$('plusMenu').hidden && !e.target.closest('#plusMenu') && !e.target.closest('#plusBtn')) closePlusMenu();
    if (!$('accountMenu').hidden && !e.target.closest('#accountMenu') && !e.target.closest('#profileOpen')) $('accountMenu').hidden = true;
  });
  document.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); $('palette').hidden ? openPalette() : closePalette(); }
    else if (mod && e.key.toLowerCase() === 'j') { e.preventDefault(); newChat(); }
    else if (mod && e.key === ',') { e.preventDefault(); $('settingsView').hidden ? openSettings('account') : closeSettings(); }
    else if (mod && e.key.toLowerCase() === 'o' && !$('rightPane').hidden) { e.preventDefault(); $('previewFileInput').click(); }
    else if (e.key === 'Escape') { const sheet = document.getElementById('voiceSheet'); if (sheet && !sheet.hidden) { voiceToggleSheet(false); return; } if (document.getElementById('voiceOverlay')) { voiceClose(); return; } closeMenus(); closeModelPicker(); closePlusMenu(); $('accountMenu').hidden = true; if (!$('palette').hidden) closePalette(); else if (!$('settingsView').hidden) closeSettings(); else if (!$('libraryView').hidden) closeLibrary(); else closeSidebar(); }
  });
  window.addEventListener('online', () => reconnectCheck());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) reconnectCheck(); });
  window.addEventListener('resize', () => syncDesktopChrome());
  if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme());
  reconnectTimer = setInterval(reconnectCheck, 10000);
}
document.addEventListener('DOMContentLoaded', async () => {
  bindEvents();
  renderPaletteTabs();
  renderProjects();
  renderRecents();
  renderLibrary();
  renderSuggestions();
  renderModeChip();
  syncPrivate();
  autoGrowPrompt();
  syncSendState();
  updateBusy();
  await initialConnection();
  await refreshBootstrap();
  renderConversation(state.session);
  initializeWorkspace();
});
