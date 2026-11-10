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
  function summary(s) { return { id: s.id, title: s.title, project_id: s.project_id || null, updated: s.updated || 0, pinned: !!s.pinned, archived: !!s.archived, msgs: (s.messages || []).length }; }

  var nativeFetch = window.fetch.bind(window);

  function findSession(id) { return loadSessions().find(function (s) { return s.id === id; }); }

  function appendExchange(sessionId, prompt, assistantText, errorMessage, activity, attached) {
    var list = loadSessions();
    var s = list.find(function (x) { return x.id === sessionId; });
    if (!s) return;
    s.messages = s.messages || [];
    if (prompt) { var um = { role: 'user', content: prompt }; if (Array.isArray(attached) && attached.length) um.attached = attached; s.messages.push(um); }
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
  function memoryOn() { return loadSettings().memory_enabled !== false; }
  function captureMemory(prompt) {
    if (!memoryOn()) return;
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
  function buildContext(current, promptText) {
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
    var kbVault = loadVault();
    var kbGraph = buildGraph();
    var kbCtx = loadCtxFile();
    return { facts: memoryOn() ? loadMemory().map(function (f) { return f.text; }) : [], chats: sessions.length, messages: totalMsgs, others: others, currentTitle: current ? (current.title || 'New chat') : 'New chat', theme: st.theme || 'rose', lunaPets: lunaPets, vault: { count: kbVault.length, titles: kbVault.slice(0, 40).map(function (n) { return n.title || 'Untitled'; }), matched: matchedNotes(promptText) }, contextFile: kbCtx, graph: { topics: kbGraph.topics } };
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

  function tapRunStream(response, sessionId, prompt, attached) {
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
                else if (p.type === 'done') { var act = actSteps.length ? { steps: actSteps.slice(0, 12), seconds: Math.max(1, Math.round((Date.now() - actStart) / 1000)) } : null; appendExchange(sessionId, prompt, typeof p.text === 'string' ? p.text : '', '', act, attached); recorded = true; if (queueFor(sessionId).length) scheduleDrain(sessionId); }
                else if (p.type === 'error') { appendExchange(sessionId, prompt, '', p.message || 'Run failed', null, attached); recorded = true; }
                else if (p.type === 'recovery') { appendExchange(sessionId, prompt, '', p.message || 'Outcome unknown', null, attached); recorded = true; }
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
    if (path === '/api/sessions/update' && method === 'POST') {
      var upd = {};
      try { upd = JSON.parse((init && init.body) || '{}'); } catch { /* empty */ }
      var ulist = loadSessions(); var us = ulist.find(function (x) { return x.id === upd.session_id; });
      if (!us) return Promise.resolve(jsonResponse({ error: 'session not found' }, 404));
      if (typeof upd.title === 'string' && upd.title.trim()) us.title = upd.title.trim().slice(0, 120);
      if (typeof upd.pinned === 'boolean') us.pinned = upd.pinned;
      if (typeof upd.archived === 'boolean') us.archived = upd.archived;
      saveSessions(ulist);
      return Promise.resolve(jsonResponse(summary(us)));
    }
    if (path === '/api/sessions/search' && method === 'GET') {
      var q = '';
      try { q = (new URL(url, location.origin).searchParams.get('q') || '').toLowerCase(); } catch { /* none */ }
      if (!q) return Promise.resolve(jsonResponse({ results: [] }));
      var hits = [];
      loadSessions().forEach(function (ss) {
        if (hits.length >= 25) return;
        var inTitle = (ss.title || '').toLowerCase().includes(q);
        var inBody = (ss.messages || []).some(function (m) { return (m.content || '').toLowerCase().includes(q); });
        if (inTitle || inBody) hits.push(summary(ss));
      });
      return Promise.resolve(jsonResponse({ results: hits }));
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
      return Promise.resolve(jsonResponse({ format: 'janna-web-profile', version: 1, exported_at: new Date().toISOString(), sessions: loadSessions(), settings: loadSettings(), memory: loadMemory(), vault: loadVault(), contextFile: loadCtxFile() }));
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
      if (Array.isArray(imp.vault) && imp.vault.length) { var cv = loadVault(); imp.vault.forEach(function (n) { if (n && n.id && !cv.some(function (x) { return x.id === n.id; })) cv.push(n); }); saveVault(cv); }
      if (imp.contextFile && (imp.contextFile.about || imp.contextFile.rules)) { var lc = loadCtxFile(); if (!lc.about && !lc.rules) saveCtxFile(imp.contextFile); }
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
      runBody.context = buildContext(sess, runBody.prompt);
      if (sess && Array.isArray(sess.messages))
        runBody.messages = sess.messages.filter(function (m) { return m && (m.role === 'user' || m.role === 'assistant'); }).map(function (m) { return { role: m.role, content: m.content }; });
        if (sess && sess.purpose === 'luna') runBody.companion = 'luna';
      var shrinkRunImages = function () {
        var list = Array.isArray(runBody.attachments) ? runBody.attachments : [];
        var jobs = list.filter(function (a) { return a && a.kind === 'image' && a.data && a.data.length > 900000; }).map(function (a) {
          return new Promise(function (resolve) {
            try {
              var img = new Image();
              img.onload = function () {
                try {
                  var scale = Math.min(1, 1568 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
                  var w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
                  var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
                  var cx = cv.getContext('2d'); cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, w, h); cx.drawImage(img, 0, 0, w, h);
                  var url = cv.toDataURL('image/jpeg', 0.85);
                  if (url && url.indexOf(',') > 0) { a.data = url.split(',')[1]; a.mime = 'image/jpeg'; }
                } catch (e) { /* keep the original image */ }
                resolve();
              };
              img.onerror = function () { resolve(); };
              var mime0 = a.mime || (/\.png$/i.test(a.name || '') ? 'image/png' : /\.webp$/i.test(a.name || '') ? 'image/webp' : 'image/jpeg');
              img.src = 'data:' + mime0 + ';base64,' + a.data;
            } catch (e) { resolve(); }
          });
        });
        return Promise.all(jobs);
      };
      return shrinkRunImages().then(function () {
        var newInit = Object.assign({}, init, { body: JSON.stringify(runBody) });
        return nativeFetch(input, newInit).then(function (response) {
          return tapRunStream(response, runBody.session_id, runBody.prompt, (Array.isArray(runBody.attachments) ? runBody.attachments : []).map(function (a) { return { kind: a && a.kind === 'image' ? 'image' : 'file', name: String((a && a.name) || 'file').slice(0, 80) }; }));
        });
      });
    }

    return nativeFetch(input, init);
  };


  // --- Janna's own knowledge system (web edition): a notes vault (her
  // Obsidian), a personal context file (her ICM: About me + standing
  // preferences), and a knowledge graph over notes + facts + chats (her
  // Graphify). Everything lives in this browser's localStorage. ---
  var VAULTKEY = 'janna-web-vault-v1';
  function loadVault() { try { var v = JSON.parse(localStorage.getItem(VAULTKEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
  function saveVault(list) { try { localStorage.setItem(VAULTKEY, JSON.stringify((list || []).slice(0, 200))); } catch { /* ignore */ } }
  var CTXKEY = 'janna-web-context-v1';
  function loadCtxFile() { try { var c = JSON.parse(localStorage.getItem(CTXKEY) || '{}'); return { about: String(c.about || ''), rules: String(c.rules || '') }; } catch { return { about: '', rules: '' }; } }
  function saveCtxFile(c) { try { localStorage.setItem(CTXKEY, JSON.stringify({ about: String(c.about || '').slice(0, 4000), rules: String(c.rules || '').slice(0, 4000) })); } catch { /* ignore */ } }
  var STOPW = {};
  'the,a,an,and,or,of,to,in,on,for,with,that,this,it,is,are,was,were,be,been,my,your,about,from,into,how,what,when,where,which,who,why,can,could,should,would,will,just,like,ang,ng,sa,na,ay,ko,mo,niya,ako,ikaw,siya,namin,natin,nila,ito,iyan,iyon,mga,pag,para,daw,rin,din,lang,nga,not,but,you,me,we,he,she,they,them,his,her,its,our,their,have,has,had,does,did,all,any,more,most,other,over,under,very,too,also,then,than,one,two,get,got,make,made,use,used,using,way,ways,thing,things'.split(',').forEach(function (w) { STOPW[w] = 1; });
  function wordFreq(text) {
    var m = String(text || '').toLowerCase().match(/[a-zà-ÿ][a-zà-ÿ0-9'-]{3,}/g) || [];
    var f = {};
    m.forEach(function (w) { if (!STOPW[w]) f[w] = (f[w] || 0) + 1; });
    return f;
  }
  function buildGraph() {
    var items = [];
    loadVault().forEach(function (n) { items.push({ id: 'n:' + n.id, kind: 'note', label: clipText(n.title || 'Untitled', 32), text: ((n.title || '') + ' ' + (n.tags || []).join(' ') + ' ' + (n.body || '')) }); });
    loadMemory().forEach(function (f, i) { items.push({ id: 'f:' + i, kind: 'fact', label: clipText(f.text, 32), text: String(f.text || '') }); });
    loadSessions().slice(0, 14).forEach(function (s) {
      var first = ''; var msgs = s.messages || [];
      for (var i = 0; i < msgs.length; i++) if (msgs[i].role === 'user') { first = msgs[i].content || ''; break; }
      items.push({ id: 'c:' + s.id, kind: 'chat', label: clipText(s.title || 'New chat', 32), text: ((s.title || '') + ' ' + first) });
    });
    var freq = {};
    var perItem = items.map(function (it) { var f = wordFreq(it.text); Object.keys(f).forEach(function (w) { freq[w] = (freq[w] || 0) + f[w]; }); return f; });
    var topics = Object.keys(freq).filter(function (w) { return freq[w] >= 2; }).sort(function (a, b) { return freq[b] - freq[a]; }).slice(0, 14);
    if (topics.length < 3) {
      var extra = Object.keys(freq).sort(function (a, b) { return freq[b] - freq[a]; });
      for (var e = 0; e < extra.length && topics.length < 6; e++) if (topics.indexOf(extra[e]) < 0) topics.push(extra[e]);
    }
    var nodes = topics.map(function (w) { return { id: 't:' + w, kind: 'topic', label: w, degree: 0 }; });
    var edges = [];
    items.slice(0, 30).forEach(function (it, ii) {
      nodes.push({ id: it.id, kind: it.kind, label: it.label, degree: 0 });
      topics.forEach(function (w) { if (perItem[ii][w]) { edges.push([it.id, 't:' + w]); } });
    });
    var byId = {};
    nodes.forEach(function (n) { byId[n.id] = n; });
    edges.forEach(function (ed) { if (byId[ed[0]]) byId[ed[0]].degree++; if (byId[ed[1]]) byId[ed[1]].degree++; });
    var topTopics = topics.slice().sort(function (a, b) { return (byId['t:' + b].degree || 0) - (byId['t:' + a].degree || 0); }).slice(0, 8);
    return { nodes: nodes, edges: edges, topics: topTopics, counts: { notes: loadVault().length, facts: loadMemory().length, chats: loadSessions().length } };
  }
  function matchedNotes(promptText) {
    var vault = loadVault();
    if (!vault.length) return [];
    var clip = function (n) { return { title: n.title || 'Untitled', body: clipText(n.body || '', 900) }; };
    if (vault.length <= 5) return vault.map(clip);
    var pf = wordFreq(promptText || '');
    var scored = vault.map(function (n) {
      var score = 0;
      var tf = wordFreq(n.title || ''), gf = wordFreq((n.tags || []).join(' ')), bf = wordFreq(n.body || '');
      Object.keys(pf).forEach(function (w) { if (tf[w]) score += 3; if (gf[w]) score += 2; if (bf[w]) score += 1; });
      return { n: n, score: score };
    }).filter(function (x) { return x.score > 0; }).sort(function (a, b) { return b.score - a.score; }).slice(0, 3);
    return scored.map(function (x) { return clip(x.n); });
  }

  // --- Knowledge panel UI (Notes / Context / Graph) ---
  var kbState = { tab: 'notes', editingId: null, query: '', delArm: false, clearArm: false };
  function kbEl(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function kbStyles() {
    if (document.getElementById('kbStyle')) return;
    var st = document.createElement('style'); st.id = 'kbStyle';
    st.textContent = '.kb-row{display:flex;align-items:center;gap:6px;padding:6px 10px;flex-wrap:wrap}.kb-row-label{font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin-right:2px}.kb-row button{background:var(--chip);color:var(--ink);border:1px solid var(--line);border-radius:999px;padding:4px 11px;font-size:12px;cursor:pointer}'
      + '.kb-panel{position:fixed;inset:0;z-index:190;background:rgba(20,8,14,.42);display:flex;align-items:center;justify-content:center;padding:14px}.kb-card{background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:18px;width:min(700px,96vw);max-height:88vh;overflow:auto;padding:16px;box-shadow:0 18px 50px rgba(0,0,0,.25)}'
      + '.kb-head{display:flex;align-items:center;gap:10px;margin-bottom:10px}.kb-head strong{font-size:17px;margin-right:auto}.kb-tabs{display:flex;gap:6px}.kb-tabs button{background:var(--chip);color:var(--ink);border:1px solid var(--line);border-radius:999px;padding:5px 13px;font-size:13px;cursor:pointer}.kb-tabs button.on{background:var(--accent);color:#fff;border-color:transparent}.kb-x{background:none;border:none;color:var(--muted);font-size:19px;cursor:pointer;padding:4px 8px}'
      + '.kb-input,.kb-area{width:100%;box-sizing:border-box;background:var(--chip);color:var(--ink);border:1px solid var(--line);border-radius:10px;padding:9px 11px;font:inherit;font-size:14px;margin:0 0 8px}.kb-area{min-height:110px;resize:vertical}.kb-area.tall{min-height:170px}'
      + '.kb-btn{background:var(--accent);color:#fff;border:none;border-radius:999px;padding:7px 16px;font-size:13px;cursor:pointer}.kb-btn.ghost{background:var(--chip);color:var(--ink);border:1px solid var(--line)}.kb-btn.danger{background:#c0392b;color:#fff}.kb-note{border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin:0 0 8px;cursor:pointer;background:transparent;text-align:left;width:100%;color:var(--ink);font:inherit}.kb-note b{display:block;font-size:14px}.kb-note span{color:var(--muted);font-size:12px}.kb-note p{margin:4px 0 0;font-size:13px;color:var(--ink);opacity:.85}'
      + '.kb-label{font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin:12px 0 5px}.kb-status{font-size:12px;color:var(--muted);min-height:16px;margin-top:6px}.kb-fact{font-size:13px;padding:5px 0;border-bottom:1px solid var(--line)}.kb-detail{font-size:13px;color:var(--ink);margin-top:8px;min-height:18px}.kb-counts{font-size:12px;color:var(--muted);margin-bottom:6px}';
    document.head.appendChild(st);
  }
  function openKb(tab) {
    kbStyles();
    kbState.tab = tab || 'notes';
    var panel = document.getElementById('kbPanel');
    if (!panel) { panel = buildKbPanel(); document.body.appendChild(panel); }
    panel.hidden = false;
    renderKb();
  }
  function closeKb() { var p = document.getElementById('kbPanel'); if (p) p.hidden = true; }
  function buildKbPanel() {
    var panel = kbEl('div', 'kb-panel'); panel.id = 'kbPanel';
    var card = kbEl('div', 'kb-card');
    var head = kbEl('div', 'kb-head');
    head.appendChild(kbEl('strong', null, 'Knowledge'));
    var tabs = kbEl('div', 'kb-tabs');
    [['notes', 'Notes'], ['context', 'Context'], ['graph', 'Graph']].forEach(function (t) {
      var b = kbEl('button', null, t[1]); b.setAttribute('data-kbtab', t[0]);
      b.onclick = function () { kbState.tab = t[0]; renderKb(); };
      tabs.appendChild(b);
    });
    head.appendChild(tabs);
    var x = kbEl('button', 'kb-x', '×'); x.setAttribute('aria-label', 'Close'); x.onclick = closeKb;
    head.appendChild(x);
    card.appendChild(head);
    var body = kbEl('div'); body.id = 'kbBody';
    card.appendChild(body);
    panel.appendChild(card);
    panel.addEventListener('click', function (e) { if (e.target === panel) closeKb(); });
    return panel;
  }
  function renderKb() {
    var panel = document.getElementById('kbPanel'); if (!panel) return;
    panel.querySelectorAll('[data-kbtab]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-kbtab') === kbState.tab); });
    var body = document.getElementById('kbBody'); body.innerHTML = '';
    if (kbState.tab === 'notes') renderKbNotes(body);
    else if (kbState.tab === 'context') renderKbContext(body);
    else renderKbGraph(body);
  }
  function renderKbNotes(body) {
    var bar = kbEl('div'); bar.style.display = 'flex'; bar.style.gap = '8px';
    var search = kbEl('input', 'kb-input'); search.placeholder = 'Search notes…'; search.value = kbState.query; search.style.flex = '1';
    search.oninput = function () { kbState.query = search.value; renderKbNotesList(listBox); };
    var add = kbEl('button', 'kb-btn', 'New note');
    add.onclick = function () { kbState.editingId = null; renderKbNoteEditor(body); };
    bar.appendChild(search); bar.appendChild(add);
    body.appendChild(bar);
    var listBox = kbEl('div');
    body.appendChild(listBox);
    renderKbNotesList(listBox);
  }
  function renderKbNotesList(listBox) {
    listBox.innerHTML = '';
    var q = kbState.query.toLowerCase();
    var notes = loadVault().filter(function (n) { return !q || ((n.title || '') + ' ' + (n.body || '') + ' ' + (n.tags || []).join(' ')).toLowerCase().includes(q); })
      .sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); });
    if (!notes.length) { listBox.appendChild(kbEl('p', 'kb-status', q ? 'No notes match your search.' : 'No notes yet. Create your first note — Janna can read and use everything in this vault.')); return; }
    notes.forEach(function (n) {
      var item = kbEl('button', 'kb-note');
      item.appendChild(kbEl('b', null, n.title || 'Untitled'));
      item.appendChild(kbEl('span', null, (n.tags || []).join(', ') + ((n.tags || []).length ? ' · ' : '') + new Date(n.updated || Date.now()).toLocaleDateString()));
      item.appendChild(kbEl('p', null, clipText(n.body || '', 120)));
      item.onclick = function () { kbState.editingId = n.id; renderKbNoteEditor(document.getElementById('kbBody')); };
      listBox.appendChild(item);
    });
  }
  function renderKbNoteEditor(body) {
    body.innerHTML = '';
    var existing = kbState.editingId ? loadVault().find(function (n) { return n.id === kbState.editingId; }) : null;
    var back = kbEl('button', 'kb-btn ghost', '← All notes'); back.onclick = function () { renderKb(); };
    body.appendChild(back);
    body.appendChild(kbEl('div', 'kb-label', existing ? 'Edit note' : 'New note'));
    var title = kbEl('input', 'kb-input'); title.placeholder = 'Title'; title.value = existing ? (existing.title || '') : '';
    var tags = kbEl('input', 'kb-input'); tags.placeholder = 'Tags, comma separated'; tags.value = existing ? (existing.tags || []).join(', ') : '';
    var text = kbEl('textarea', 'kb-area tall'); text.placeholder = 'Write the note in Markdown…'; text.value = existing ? (existing.body || '') : '';
    var status = kbEl('div', 'kb-status');
    var row = kbEl('div'); row.style.display = 'flex'; row.style.gap = '8px'; row.style.marginTop = '6px';
    var save = kbEl('button', 'kb-btn', 'Save note');
    save.onclick = function () {
      var vault = loadVault();
      var rec = { id: existing ? existing.id : 'note-' + Math.random().toString(36).slice(2, 10), title: title.value.trim() || 'Untitled', tags: tags.value.split(',').map(function (t) { return t.trim(); }).filter(Boolean).slice(0, 8), body: text.value, updated: Date.now() };
      if (existing) { var ix = vault.findIndex(function (n) { return n.id === existing.id; }); if (ix >= 0) vault[ix] = rec; } else vault.unshift(rec);
      saveVault(vault);
      kbState.editingId = rec.id;
      status.textContent = 'Saved. Janna can use this note now.';
    };
    row.appendChild(save);
    if (existing) {
      var del = kbEl('button', 'kb-btn danger', 'Delete');
      del.onclick = function () {
        if (!kbState.delArm) { kbState.delArm = true; del.textContent = 'Tap again to delete'; setTimeout(function () { kbState.delArm = false; del.textContent = 'Delete'; }, 2600); return; }
        saveVault(loadVault().filter(function (n) { return n.id !== existing.id; }));
        kbState.delArm = false; kbState.editingId = null; renderKb();
      };
      row.appendChild(del);
    }
    body.appendChild(title); body.appendChild(tags); body.appendChild(text); body.appendChild(row); body.appendChild(status);
  }
  function renderKbContext(body) {
    var cf = loadCtxFile();
    body.appendChild(kbEl('p', 'kb-counts', 'Your context file — Janna reads this at the start of every conversation, the way a good assistant reads your file before working.'));
    body.appendChild(kbEl('div', 'kb-label', 'About me'));
    var about = kbEl('textarea', 'kb-area'); about.placeholder = 'Who you are, your work, your projects, what matters to you…'; about.value = cf.about;
    body.appendChild(about);
    body.appendChild(kbEl('div', 'kb-label', 'How Janna should work'));
    var rules = kbEl('textarea', 'kb-area'); rules.placeholder = 'Standing preferences — e.g. "Keep answers short", "Always explain code in simple terms"…'; rules.value = cf.rules;
    body.appendChild(rules);
    var status = kbEl('div', 'kb-status');
    var save = kbEl('button', 'kb-btn', 'Save context file');
    save.onclick = function () { saveCtxFile({ about: about.value, rules: rules.value }); status.textContent = 'Saved. Janna will use this in every chat.'; };
    body.appendChild(save); body.appendChild(status);
    var facts = loadMemory();
    body.appendChild(kbEl('div', 'kb-label', 'Facts Janna remembers (' + facts.length + ')'));
    if (!facts.length) body.appendChild(kbEl('p', 'kb-status', 'Nothing saved yet. Say "remember …" or "tandaan mo …" in any chat.'));
    facts.forEach(function (f) { body.appendChild(kbEl('div', 'kb-fact', '• ' + f.text)); });
    if (facts.length) {
      var clr = kbEl('button', 'kb-btn ghost', 'Clear all facts');
      clr.style.marginTop = '8px';
      clr.onclick = function () {
        if (!kbState.clearArm) { kbState.clearArm = true; clr.textContent = 'Tap again to clear all'; setTimeout(function () { kbState.clearArm = false; clr.textContent = 'Clear all facts'; }, 2600); return; }
        saveMemory([]); kbState.clearArm = false; renderKb();
      };
      body.appendChild(clr);
    }
  }
  function renderKbGraph(body) {
    var g = buildGraph();
    body.appendChild(kbEl('p', 'kb-counts', g.counts.notes + ' notes · ' + g.counts.facts + ' remembered facts · ' + g.counts.chats + ' chats → ' + g.nodes.length + ' nodes, ' + g.edges.length + ' connections. Tap any dot to see what it is.'));
    var detail = kbEl('div', 'kb-detail', g.topics.length ? 'Center topics: ' + g.topics.join(', ') : 'Add notes and chats and the graph will grow.');
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 380 380'); svg.setAttribute('width', '100%');
    var cx = 190, cy = 190;
    var pos = {};
    var topics = g.nodes.filter(function (n) { return n.kind === 'topic'; });
    var items = g.nodes.filter(function (n) { return n.kind !== 'topic'; });
    topics.forEach(function (n, i) { var a = (i / Math.max(1, topics.length)) * Math.PI * 2 - Math.PI / 2; pos[n.id] = { x: cx + Math.cos(a) * 74, y: cy + Math.sin(a) * 74, a: a }; });
    var perTopic = {};
    items.forEach(function (n, i) {
      var link = g.edges.find(function (e) { return e[0] === n.id; });
      var base = link && pos[link[1]] ? pos[link[1]].a : (i / Math.max(1, items.length)) * Math.PI * 2;
      var slot = perTopic[link ? link[1] : 'none'] = (perTopic[link ? link[1] : 'none'] || 0) + 1;
      var a = base + (slot - 1) * 0.34;
      pos[n.id] = { x: cx + Math.cos(a) * 152, y: cy + Math.sin(a) * 152, a: a };
    });
    g.edges.forEach(function (e) {
      if (!pos[e[0]] || !pos[e[1]]) return;
      var ln = document.createElementNS(NS, 'line');
      ln.setAttribute('x1', pos[e[0]].x); ln.setAttribute('y1', pos[e[0]].y); ln.setAttribute('x2', pos[e[1]].x); ln.setAttribute('y2', pos[e[1]].y);
      ln.setAttribute('stroke', 'var(--line)'); ln.setAttribute('stroke-width', '1');
      svg.appendChild(ln);
    });
    var colors = { topic: 'var(--accent)', note: '#3f9e58', fact: '#d9930d', chat: '#7a6fd0' };
    g.nodes.forEach(function (n) {
      var p = pos[n.id]; if (!p) return;
      var grp = document.createElementNS(NS, 'g'); grp.style.cursor = 'pointer';
      var c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', p.x); c.setAttribute('cy', p.y); c.setAttribute('r', n.kind === 'topic' ? 9 : 6);
      c.setAttribute('fill', colors[n.kind] || 'var(--accent)');
      var t = document.createElementNS(NS, 'text');
      t.setAttribute('x', p.x); t.setAttribute('y', p.y - (n.kind === 'topic' ? 14 : 11)); t.setAttribute('text-anchor', 'middle');
      t.setAttribute('style', 'font-size:9px;fill:var(--ink)');
      t.textContent = n.label.length > 18 ? n.label.slice(0, 17) + '…' : n.label;
      grp.appendChild(c); grp.appendChild(t);
      grp.addEventListener('click', function () {
        detail.textContent = (n.kind === 'topic' ? 'Topic' : n.kind === 'note' ? 'Note' : n.kind === 'fact' ? 'Remembered fact' : 'Chat') + ': ' + n.label + (n.degree ? ' — ' + n.degree + ' connection' + (n.degree === 1 ? '' : 's') : '');
      });
      svg.appendChild(grp);
    });
    body.appendChild(svg);
    body.appendChild(detail);
  }
  function injectKnowledge() {
    if (document.getElementById('kbRow')) return true;
    var anchor = document.querySelector('aside.sidebar .local-state');
    if (!anchor) return false;
    kbStyles();
    var row = kbEl('div', 'kb-row'); row.id = 'kbRow';
    row.appendChild(kbEl('span', 'kb-row-label', 'Knowledge'));
    [['notes', 'Notes'], ['context', 'Context'], ['graph', 'Graph']].forEach(function (t) {
      var b = kbEl('button', null, t[1]);
      b.onclick = function () { openKb(t[0]); };
      row.appendChild(b);
    });
    anchor.after(row);
    return true;
  }
  var kbTries = 0;
  var kbTimer = setInterval(function () { if (injectKnowledge() || ++kbTries > 40) clearInterval(kbTimer); }, 400);

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
