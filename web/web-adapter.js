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
  var hosted = /(^|\.)vercel\.app$/.test(host) || /(^|\.)jepong-devxyz\.com$/.test(host) || /(^|\.)janna-official\.tech$/.test(host) || host === 'janna-ai.vercel.app';
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

  function appendExchange(sessionId, prompt, assistantText, errorMessage, activity) {
    var list = loadSessions();
    var s = list.find(function (x) { return x.id === sessionId; });
    if (!s) return;
    s.messages = s.messages || [];
    if (prompt) s.messages.push({ role: 'user', content: prompt });
    if (assistantText) { var am = { role: 'assistant', content: assistantText }; if (activity && activity.steps && activity.steps.length) am.activity = activity; s.messages.push(am); }
    else if (errorMessage) s.messages.push({ role: 'assistant', content: '\u26a0\ufe0f ' + errorMessage });
    if ((!s.title || s.title === 'New chat') && prompt) s.title = prompt.slice(0, 60);
    s.updated = Math.floor(Date.now() / 1000);
    saveSessions(list);
  }

  // Observe the run stream as it flows past and persist the exchange the
  // moment the terminal frame arrives — synchronously, before the app
  // re-reads the session and re-renders the conversation.
  // --- Janna's memory of the user + awareness context (her order: Janna
  // must know the previous chats, the whole app, and the user's plan/usage,
  // the way Muse does) ---
  var MEMKEY = 'janna-web-memory-v1';
  function loadMemory() { try { return JSON.parse(localStorage.getItem(MEMKEY) || '[]'); } catch { return []; } }
  function saveMemory(list) { try { localStorage.setItem(MEMKEY, JSON.stringify((list || []).slice(-30))); } catch { /* ignore */ } }
  function captureMemory(prompt) {
    if (!prompt) return;
    var facts = loadMemory();
    var add = function (text) {
      text = String(text || '').trim().replace(/\s+/g, ' ');
      if (text.length < 3 || text.length > 140) return;
      if (facts.some(function (f) { return f.text.toLowerCase() === text.toLowerCase(); })) return;
      facts.push({ text: text, at: Date.now() });
    };
    var m;
    if ((m = prompt.match(/(?:tandaan mo|remember(?: that)?|note that)[:\s]+(.+)/i))) add(m[1].replace(/[.\s]+$/, ''));
    if ((m = prompt.match(/(?:my name is|pangalan ko ay|ako si)\s+([A-Za-z][A-Za-z .'-]{1,40})/i))) add("The user's name is " + m[1].trim());
    if ((m = prompt.match(/(?:call me|tawagin mo akong)\s+([A-Za-z][A-Za-z .'-]{1,40})/i))) add('The user wants to be called ' + m[1].trim());
    saveMemory(facts);
  }
  function clipText(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '\u2026' : s; }
  function buildContext(current) {
    var sessions = loadSessions();
    var totalMsgs = 0;
    sessions.forEach(function (x) { totalMsgs += (x.messages || []).length; });
    var others = sessions.filter(function (x) { return !current || x.id !== current.id; }).slice(0, 6).map(function (x) {
      var msgs = (x.messages || []).filter(function (mm) { return mm && (mm.role === 'user' || mm.role === 'assistant'); });
      var firstUser = null;
      for (var i = 0; i < msgs.length; i++) if (msgs[i].role === 'user') { firstUser = msgs[i]; break; }
      var last = msgs[msgs.length - 1];
      return { title: x.title || 'New chat', when: x.updated ? new Date(x.updated * 1000).toISOString().slice(0, 10) : '', first: firstUser ? clipText(firstUser.content, 130) : '', last: last ? clipText(last.content, 130) : '' };
    });
    var lunaPets = 0;
    try { var lj = JSON.parse(localStorage.getItem('janna-luna-v1') || '{}'); if (lj && typeof lj.pets === 'number') lunaPets = lj.pets; } catch (e) { /* ignore */ }
    var st = loadSettings();
    return { facts: loadMemory().map(function (f) { return f.text; }), chats: sessions.length, messages: totalMsgs, others: others, currentTitle: current ? (current.title || 'New chat') : 'New chat', theme: st.theme || 'rose', lunaPets: lunaPets };
  }

  // --- queued follow-up messages (the app's "queue for the next step") ---
  var QUEUE_KEY = 'janna-web-queue-v1';
  var draining = {};
  function loadQueue() { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '{}'); } catch { return {}; } }
  function saveQueue(q) { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch { /* ignore */ } }
  function queueFor(sid) { var q = loadQueue(); return Array.isArray(q[sid]) ? q[sid] : []; }
  function scheduleDrain(sessionId) { setTimeout(function () { drainQueue(sessionId); }, 900); }
  function drainQueue(sessionId) {
    if (!sessionId || draining[sessionId]) return;
    var items = queueFor(sessionId);
    if (!items.length) return;
    var sess = findSession(sessionId);
    if (!sess) { var q0 = loadQueue(); delete q0[sessionId]; saveQueue(q0); return; }
    draining[sessionId] = true;
    var item = items[0];
    var q = loadQueue(); q[sessionId] = items.slice(1); if (!q[sessionId].length) delete q[sessionId]; saveQueue(q);
    var body = { session_id: sessionId, prompt: item.text, mode: 'chat', messages: (sess.messages || []).filter(function (m) { return m && (m.role === 'user' || m.role === 'assistant'); }).map(function (m) { return { role: m.role, content: m.content }; }) };
    if (sess.purpose === 'luna') body.companion = 'luna';
    window.fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.text(); })
      .catch(function () { /* the tap records errors as exchanges */ })
      .then(function () {
        draining[sessionId] = false;
        try {
          if (typeof state !== 'undefined' && state.session === sessionId && !state.busy && typeof openSession === 'function') openSession(sessionId);
        } catch { /* app not ready */ }
        if (queueFor(sessionId).length) scheduleDrain(sessionId);
      });
  }

  function tapRunStream(response, sessionId, prompt) {
    if (!response.body || typeof TransformStream === 'undefined') return response;
    var decoder = new TextDecoder();
    var buffer = '', recorded = false;
    var actSteps = [], actStart = Date.now();
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
                if (p.type === 'progress' && p.message) { if (actSteps[actSteps.length - 1] !== p.message) actSteps.push(p.message); }
                else if (p.type === 'done') { var act = actSteps.length ? { steps: actSteps.slice(0, 12), seconds: Math.max(1, Math.round((Date.now() - actStart) / 1000)) } : null; appendExchange(sessionId, prompt, typeof p.text === 'string' ? p.text : '', '', act); recorded = true; if (queueFor(sessionId).length) scheduleDrain(sessionId); }
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
      var dq = loadQueue(); if (dq[del.session_id]) { delete dq[del.session_id]; saveQueue(dq); }
      return Promise.resolve(jsonResponse({ ok: true }));
    }
    if (path === '/api/sessions/clear' && method === 'POST') {
      saveSessions([]);
      saveQueue({});
      return Promise.resolve(jsonResponse({ ok: true }));
    }
    if (path.startsWith('/api/session/') && method === 'GET') {
      var sid = decodeURIComponent(path.slice('/api/session/'.length));
      var found = findSession(sid);
      if (!found) return Promise.resolve(jsonResponse({ error: 'Conversation not found.' }, 404));
      return Promise.resolve(jsonResponse(Object.assign({}, found, { runs: [], inputs: queueFor(sid), goals: [] })));
    }
    if (path === '/api/luna/chat' && method === 'POST') {
      var kn = Math.floor(Date.now() / 1000);
      var ks = { id: 'web-luna-' + Math.random().toString(36).slice(2, 10), title: 'Luna chat', purpose: 'luna', project_id: null, created: kn, updated: kn, messages: [], events: [] };
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

    if (path === '/api/memory' && method === 'GET')
      return Promise.resolve(jsonResponse({ facts: loadMemory() }));
    if (path === '/api/memory/clear' && method === 'POST') {
      saveMemory([]);
      return Promise.resolve(jsonResponse({ ok: true }));
    }

    // --- profile transfer: export/import work on the browser's own data ---
    if (path === '/api/profile/select' && method === 'POST')
      return Promise.resolve(jsonResponse({ ok: true }));
    if (path === '/api/profile/export' && method === 'GET')
      return Promise.resolve(jsonResponse({ format: 'janna-web-profile', version: 1, exported_at: new Date().toISOString(), sessions: loadSessions(), settings: loadSettings(), memory: loadMemory() }));
    if (path === '/api/profile/import' && method === 'POST') {
      var imp = {};
      try { imp = JSON.parse((init && init.body) || '{}'); } catch { /* empty */ }
      var incoming = Array.isArray(imp.sessions) ? imp.sessions : (Array.isArray(imp.conversations) ? imp.conversations : []);
      var existing = loadSessions();
      var seen = {};
      existing.forEach(function (x) { seen[x.id] = true; });
      var added = 0;
      incoming.forEach(function (x) { if (x && x.id && !seen[x.id]) { existing.push(x); seen[x.id] = true; added++; } });
      if (added) saveSessions(existing);
      var notes = 0;
      if (imp.settings && typeof imp.settings === 'object') { saveSettings(Object.assign({}, imp.settings, loadSettings())); notes = 1; }
      if (Array.isArray(imp.memory) && imp.memory.length) { var cur = loadMemory(); imp.memory.forEach(function (f) { if (f && f.text && !cur.some(function (x) { return x.text === f.text; })) cur.push(f); }); saveMemory(cur); }
      return Promise.resolve(jsonResponse({ imported: { conversations: added, notes: notes } }));
    }

    // --- project preflight: the web version has no PC folders ---
    if (path === '/api/project/preflight' && method === 'POST')
      return Promise.resolve(jsonResponse({ needs_project: false }));

    // --- saved-run activity: web runs are not persisted server-side ---
    if (/^\/api\/runs\/[^/]+\/activity$/.test(path) && method === 'GET')
      return Promise.resolve(jsonResponse({ state: 'completed', events: [] }));

    // --- queued follow-ups: store locally; the tap drains them after the run ---
    if (path === '/api/run/update' && method === 'POST') {
      var qb = {};
      try { qb = JSON.parse((init && init.body) || '{}'); } catch { /* empty */ }
      if (!qb.session_id || !qb.prompt) return Promise.resolve(jsonResponse({ error: 'Queued message needs a session and text.' }, 400));
      var qq = loadQueue(); var list = Array.isArray(qq[qb.session_id]) ? qq[qb.session_id] : [];
      list.push({ id: 'q-' + Math.random().toString(36).slice(2, 9), text: String(qb.prompt), state: 'queued' });
      qq[qb.session_id] = list; saveQueue(qq);
      return Promise.resolve(jsonResponse({ queued: list.length }));
    }
    if (path === '/api/run/input/edit' && method === 'POST') {
      var eb = {};
      try { eb = JSON.parse((init && init.body) || '{}'); } catch { /* empty */ }
      var eq = loadQueue(); var elist = Array.isArray(eq[eb.session_id]) ? eq[eb.session_id] : [];
      if (eb.text == null) elist = elist.filter(function (x) { return x.id !== eb.input_id; });
      else elist.forEach(function (x) { if (x.id === eb.input_id) x.text = String(eb.text); });
      eq[eb.session_id] = elist; saveQueue(eq);
      return Promise.resolve(jsonResponse({ ok: true }));
    }

    // --- run: inject local history; tap the stream to persist the exchange ---
    if (path === '/api/run' && method === 'POST') {
      var runBody = {};
      try { runBody = JSON.parse((init && init.body) || '{}'); } catch { /* empty */ }
      var sess = runBody.session_id ? findSession(runBody.session_id) : null;
      captureMemory(runBody.prompt);
      runBody.context = buildContext(sess);
      if (sess && Array.isArray(sess.messages))
        runBody.messages = sess.messages.filter(function (m) { return m && (m.role === 'user' || m.role === 'assistant'); }).map(function (m) { return { role: m.role, content: m.content }; });
        if (sess.purpose === 'luna') runBody.companion = 'luna';
      var newInit = Object.assign({}, init, { body: JSON.stringify(runBody) });
      return nativeFetch(input, newInit).then(function (response) {
        return tapRunStream(response, runBody.session_id, runBody.prompt);
      });
    }

    return nativeFetch(input, init);
  };

  // --- service worker self-heal: when a new shell takes over, reload once
  // so updates actually reach this device in a single visit ---
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      try {
        if (sessionStorage.getItem('janna-sw-reloaded')) return;
        sessionStorage.setItem('janna-sw-reloaded', '1');
      } catch { /* private mode */ }
      location.reload();
    });
    if (navigator.serviceWorker.getRegistration) {
      navigator.serviceWorker.getRegistration().then(function (r) { if (r) r.update().catch(function () {}); }).catch(function () {});
    }
  }
})();
