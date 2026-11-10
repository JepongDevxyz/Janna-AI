'use strict';
/* Luna — Janna AI's pet companion (web edition).
   A living little star cat: she idles, watches Janna think, celebrates
   finished answers, naps when ignored, and loves being petted.
   Activates only on the web edition (window.__JANNA_WEB__); the desktop
   app keeps its original companion console in luna.js. */
(function () {
  if (!window.__JANNA_WEB__) return;

  var STORE = 'janna-luna-v1';
  var data = { pets: 0, day: '' };
  try { data = Object.assign(data, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch { /* fresh */ }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(data)); } catch { /* ignore */ } }
  function today() { return new Date().toISOString().slice(0, 10); }
  if (data.day !== today()) { data.day = today(); data.pets = 0; save(); }

  var LINES = {
    pet: ['Mrrp! That tickles ✦', 'Purr purr… more pets please', 'Hehe! Luna loves you ♥', '✦ sparkle sparkle ✦', 'That is the spot!', 'Luna is happy now ♥'],
    greet: ['Hi hi! Luna is here ✦', 'Mrrp! Ready when you are', 'Luna kept your seat warm'],
    done: ['Yay! Tapos na! ✦', 'We did it! ♥', 'Answer delivered, purrfect'],
    wake: ['Mrrp? Oh, you are back!', 'Luna woke up for you ✦'],
    sleep: ['Zzz… Luna is napping']
  };
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  var mood = 'idle';           // idle | thinking | busy | done | happy | sleep
  var bubble = null, bubbleTimer = 0, idleTimer = 0, greeted = false;

  function fab() { return document.getElementById('companionButton'); }
  function setMood(next) {
    mood = next;
    var f = fab(); if (!f) return;
    f.dataset.mood = next;
    f.title = 'Luna · ' + next[0].toUpperCase() + next.slice(1);
  }
  function say(text, ms) {
    var f = fab(); if (!f || !text) return;
    if (!bubble) {
      bubble = document.createElement('div');
      bubble.className = 'luna-bubble';
      bubble.setAttribute('role', 'status');
      document.body.appendChild(bubble);
    }
    bubble.innerHTML = '';
    var span = document.createElement('span'); span.textContent = text; bubble.appendChild(span);
    var chat = document.createElement('button'); chat.type = 'button'; chat.className = 'luna-bubble-btn'; chat.textContent = 'Chat';
    chat.onclick = function (e) { e.stopPropagation(); hideBubble(); document.getElementById('navLuna')?.click(); };
    var panel = document.createElement('button'); panel.type = 'button'; panel.className = 'luna-bubble-btn'; panel.textContent = 'Luna';
    panel.onclick = function (e) { e.stopPropagation(); hideBubble(); openDrawer('companion'); };
    bubble.append(chat, panel);
    bubble.classList.add('show');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(hideBubble, ms || 3400);
  }
  function hideBubble() { if (bubble) bubble.classList.remove('show'); }
  function burst() {
    var f = fab(); if (!f) return;
    var r = f.getBoundingClientRect();
    for (var i = 0; i < 6; i++) {
      var s = document.createElement('span');
      s.className = 'luna-spark';
      s.textContent = i % 2 ? '♥' : '✦';
      s.style.left = Math.max(4, Math.min(window.innerWidth - 22, r.left + r.width / 2 + (Math.random() * 56 - 28))) + 'px';
      s.style.top = (r.top - 4) + 'px';
      s.style.animationDelay = (Math.random() * 0.15) + 's';
      document.body.appendChild(s);
      setTimeout(function (el) { el.remove(); }, 1100, s);
    }
  }
  function pet() {
    wake(false);
    data.pets++; save();
    setMood('happy'); burst();
    say(pick(LINES.pet));
    setTimeout(function () { if (mood === 'happy') setMood('idle'); }, 1200);
    armIdle();
  }
  function wake(announce) {
    if (mood === 'sleep') { setMood('idle'); if (announce) say(pick(LINES.wake)); }
  }
  function armIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () { setMood('sleep'); say(pick(LINES.sleep), 5000); }, 75000);
  }

  /* --- mood bridge: app.js already reports run states via lunaSetState --- */
  var STATES = ['idle', 'thinking', 'researching', 'coding', 'checking', 'writing', 'done'];
  window.lunaSetState = function (next) {
    if (!STATES.includes(next)) return;
    if (next === 'done') {
      setMood('done'); burst();
      if (Math.random() < 0.6) say(pick(LINES.done));
      setTimeout(function () { if (mood === 'done') setMood('idle'); }, 2600);
    } else if (next === 'idle') {
      if (mood !== 'happy' && mood !== 'sleep') setMood('idle');
    } else {
      setMood(next === 'thinking' ? 'thinking' : 'busy');
    }
    armIdle();
  };
  window.refreshLuna = async function () {
    var f = fab();
    if (f) {
      var img = f.querySelector('img');
      if (img && !img.src.includes('/luna/')) { img.src = '/luna/luna-384.png'; img.alt = 'Luna, your pet companion'; }
      var badge = f.querySelector('.luna-unread'); if (badge) badge.hidden = true;
    }
    return { members: [{ id: 'luna', name: 'Luna', role: 'Pet companion', avatar: '/luna/luna-384.png', description: 'Your little star cat.' }], selected: 'luna', monitoring: false, unread: [] };
  };

  /* --- Luna panel (replaces the engineering console on web) --- */
  window.drawLuna = async function () {
    var root = document.getElementById('drawerBody'); if (!root) return;
    root.replaceChildren();
    var hero = document.createElement('div'); hero.className = 'luna-stage';
    var img = document.createElement('img'); img.src = '/luna/luna.png'; img.alt = 'Luna, the star cat'; img.className = 'luna-stage-img';
    hero.appendChild(img); root.appendChild(hero);
    var eyebrow = document.createElement('p'); eyebrow.className = 'luna-section-label'; eyebrow.textContent = 'JANNA · LUNA';
    var heading = document.createElement('h3'); heading.className = 'luna-name'; heading.textContent = 'Luna';
    var desc = document.createElement('p'); desc.className = 'muted';
    desc.textContent = 'Your little star cat. She lives in Janna, watches over your chats, celebrates finished answers, and naps when things get quiet. Pet her — she loves it.';
    var stats = document.createElement('p'); stats.className = 'luna-stats';
    stats.textContent = 'Mood: ' + mood + ' · Pets today: ' + data.pets;
    var petBtn = document.createElement('button'); petBtn.type = 'button'; petBtn.className = 'action-btn luna-pet-btn'; petBtn.textContent = 'Pet Luna';
    petBtn.onclick = function () { img.classList.remove('luna-stage-happy'); void img.offsetWidth; img.classList.add('luna-stage-happy'); pet(); stats.textContent = 'Mood: happy · Pets today: ' + data.pets; };
    var chatBtn = document.createElement('button'); chatBtn.type = 'button'; chatBtn.className = 'luna-ask'; chatBtn.textContent = 'Chat with Luna';
    chatBtn.onclick = async function () { closeDrawer(); document.getElementById('navLuna')?.click(); document.getElementById('prompt')?.focus(); };
    root.append(eyebrow, heading, desc, stats, petBtn, chatBtn);
  };

  /* --- wire up once the DOM exists --- */
  function init() {
    var f = fab(); if (!f) return;
    var img = f.querySelector('img');
    if (img) { img.src = '/luna/luna-384.png'; img.alt = 'Luna, your pet companion'; }
    f.setAttribute('aria-label', 'Luna, your pet companion');
    setMood('idle');
    f.onclick = null; // Luna owns the button on web: a tap is a pet, not a drawer
    f.addEventListener('click', function (e) { e.stopPropagation(); e.preventDefault(); pet(); });
    document.addEventListener('pointerdown', function () { wake(true); armIdle(); }, { passive: true });
    armIdle();
    setTimeout(function () { if (!greeted) { greeted = true; say(pick(LINES.greet), 4200); } }, 2500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
