/* Janna AI — web edition adapter.
   Active ONLY on the hosted web deployment (Vercel / janna domain). On the
   desktop app (localhost, LAN or Tailscale pairing) it does nothing at all.

   The desktop backend keeps chats on the PC. The web version is stateless,
   so — like Fable AI's guest mode — conversations and settings live in this
   browser (localStorage), while /api/run streams from the cloud backend.
   This adapter serves the stateful session APIs locally and lets everything
   else pass through to the real API. */
(function () {
  'use strict';
  var host = location.hostname || '';
  var hosted = /(^|\.)vercel\.app$/.test(host) || /(^|\.)jepong-devxyz\.com$/.test(host) || host === 'janna-ai.vercel.app';
  if (!hosted) return;
  window.__JANNA_WEB__ = true;

  var SKEY = 'janna-web-sessions-v1';
  var SETKEY = 'janna-web-settings-v1';

  function loadSessions() {
    try { return JSON.parse(localStorage.getItem(SKEY) || '[]'); } catch { return []; }
  }
  function saveSessions(list) {
    try { localStorage.setItem(SKEY, JSON.stringify(list)); } catch { /* full/blocked: keep in-memory only */ }
  }
  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETKEY) || '{}'); } catch { return {}; }
  }
  function saveSettings(s) {
    try { localStorage.setItem(SETKEY, JSON.stringify(s)); } catch { /* ignore */ }
  }
  function jsonResponse(obj, status) {
    return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
  function summary(s) { return { id: s.id, title: s.title, project_id: s.project_id || null, updated: s.updated || 0 }; }

  var nativeFetch = window.fetch.bind(window);

  function findSession(id) { return loadSessions().find(function (s) { return s.id === id; }); }

  function appendExchange(sessionId, prompt, assistantText, errorMessage) {
    var list = loadSessions();
    var s = list.find(function (x) { return x.id === sessionId; });
    if (!s) return;
    s.messages = s.messages || [];
    if (prompt) s.messages.push({ role: 'user', content: prompt });
    if (assistantText) s.messages.push({ role: 'assistant', content: assistantText });
    else if (errorMessage) s.messages.push({ role: 'assistant', content: '\u26a0\ufe0f ' + errorMessage });
    if ((!s.title || s.title === 'New chat') && prompt) s.title = prompt.slice(0, 60);
    s.updated = Math.floor(Date.now() / 1000);
    saveSessions(list);
  }

  // Observe the run stream as it flows past and persist the exchange the
  // moment the terminal frame arrives — synchronously, before the app
  // re-reads the session and re-renders the conversation.
  function tapRunStream(response, sessionId, prompt) {
    if (!response.body || typeof TransformStream === 'undefined') return response;
    var decoder = new TextDecoder();
    var buffer = '', recorded = false;
    var tap = new TransformStream({
      transform: function (chunk, controller) {
        try {
          buffer += decoder.decode(chunk, { stream: true });
          var cut;
          while ((cut = buffer.indexOf('\n\n')) >= 0) {
            var frame = buffer.slice(0, cut); buffer = buffer.slice(cut + 2);
            var lines = frame.split('\n');
            for (var i = 0; i < lines.length; i++) {
              if (!lines[i].startsWith('data:') || recorded) continue;
              try {
                var event = JSON.parse(lines[i].slice(5).trim());
                var p = event.payload || event;
                if (p.type === 'done') { appendExchange(sessionId, prompt, typeof p.text === 'string' ? p.text : '', ''); recorded = true; }
                else if (p.type === 'error') { appendExchange(sessionId, prompt, '', p.message || 'Run failed'); recorded = true; }
                else if (p.type === 'recovery') { appendExchange(sessionId, prompt, '', p.message || 'Outcome unknown'); recorded = true; }
              } catch { /* partial frame */ }
            }
          }
        } catch { /* never break the app's stream */ }
        controller.enqueue(chunk);
      }
    });
    var headers = new Headers(response.headers);
    return new Response(response.body.pipeThrough(tap), { status: response.status, statusText: response.statusText, headers: headers });
  }

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var path = '';
    try { path = new URL(url, location.origin).pathname; } catch { path = url; }
    var method = ((init && init.method) || (typeof input !== 'string' && input && input.method) || 'GET').toUpperCase();

    // --- bootstrap: merge local sessions + settings into the server reply ---
    if (path === '/api/bootstrap' && method === 'GET') {
      return nativeFetch(input, init).then(function (r) {
        return r.json().then(function (b) {
          b.sessions = loadSessions().map(summary);
          var saved = loadSettings();
          b.settings = Object.assign({}, b.settings || {}, saved);
          return jsonResponse(b);
        }).catch(function () { return r; });
      });
    }

    // --- sessions (local) ---
    if (path === '/api/sessions' && method === 'POST') {
      var body = {};
      try { body = JSON.parse((init && init.body) || '{}'); } catch { /* empty */ }
      var now = Math.floor(Date.now() / 1000);
      var session = { id: 'web-' + Math.random().toString(36).slice(2, 10) + now.toString(36), title: 'New chat', project_id: body.project_id || null, created: now, updated: now, messages: [], events: [] };
      var list = loadSessions(); list.unshift(session); saveSessions(list);
      return Promise.resolve(jsonResponse(session));
    }
    if (path === '/api/sessions/delete' && method === 'POST') {
      var del = {};
      try { del = JSON.parse((init && init.body) || '{}'); } catch { /* empty */ }
      saveSessions(loadSessions().filter(function (s) { return s.id !== del.session_id; }));
      return Promise.resolve(jsonResponse({ ok: true }));
    }
    if (path.startsWith('/api/session/') && method === 'GET') {
      var sid = decodeURIComponent(path.slice('/api/session/'.length));
      var found = findSession(sid);
      if (!found) return Promise.resolve(jsonResponse({ error: 'Conversation not found.' }, 404));
      return Promise.resolve(jsonResponse(Object.assign({}, found, { runs: [], inputs: [], goals: [] })));
    }
    if (path === '/api/kage/chat' && method === 'POST') {
      var kn = Math.floor(Date.now() / 1000);
      var ks = { id: 'web-kage-' + Math.random().toString(36).slice(2, 10), title: 'Kage chat', purpose: 'kage', project_id: null, created: kn, updated: kn, messages: [], events: [] };
      var kl = loadSessions(); kl.unshift(ks); saveSessions(kl);
      return Promise.resolve(jsonResponse(ks));
    }

    // --- settings (local) ---
    if (path === '/api/settings' && method === 'POST') {
      var patch = {};
      try { patch = JSON.parse((init && init.body) || '{}'); } catch { /* empty */ }
      var merged = Object.assign({}, loadSettings(), patch);
      saveSettings(merged);
      return Promise.resolve(jsonResponse({ settings: merged }));
    }

    // --- project preflight: the web version has no PC folders ---
    if (path === '/api/project/preflight' && method === 'POST')
      return Promise.resolve(jsonResponse({ needs_project: false }));

    // --- saved-run activity: web runs are not persisted server-side ---
    if (/^\/api\/runs\/[^/]+\/activity$/.test(path) && method === 'GET')
      return Promise.resolve(jsonResponse({ state: 'completed', events: [] }));

    // --- run: inject local history; tap the stream to persist the exchange ---
    if (path === '/api/run' && method === 'POST') {
      var runBody = {};
      try { runBody = JSON.parse((init && init.body) || '{}'); } catch { /* empty */ }
      var sess = runBody.session_id ? findSession(runBody.session_id) : null;
      if (sess && Array.isArray(sess.messages))
        runBody.messages = sess.messages.filter(function (m) { return m && (m.role === 'user' || m.role === 'assistant'); }).map(function (m) { return { role: m.role, content: m.content }; });
      var newInit = Object.assign({}, init, { body: JSON.stringify(runBody) });
      return nativeFetch(input, newInit).then(function (response) {
        return tapRunStream(response, runBody.session_id, runBody.prompt);
      });
    }

    return nativeFetch(input, init);
  };
})();
