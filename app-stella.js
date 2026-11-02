/*!
 * app-stella.js  -  glue between stella-voice.js and the Abhi Farming Calculator.
 * Load order in index.html:  stella-voice.js  ->  app-stella.js  (both at the end of <body>).
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------
   * 0. SETTINGS - the only things you normally edit
   * ------------------------------------------------------------------ */
  var PROXY_URL = null;              // e.g. 'https://your-server.example/stella' (keeps the key off the device)
  var DEFAULT_KEY = '';              // keep EMPTY on a public GitHub repo; the key is typed once on the phone instead
  var KEY_STORE = 'stella.geminiKey';
  var LONG_PRESS_MS = 900;           // hold the mic button this long to change / clear the key

  var $ = function (id) { return document.getElementById(id); };

  /* ------------------------------------------------------------------
   * 1. Make sure stella-voice.js loaded; initialise global.Stella
   * ------------------------------------------------------------------ */
  var micBtn = $('stellaMic');
  var Stella = window.Stella;

  if (!Stella) {
    console.error('[Stella] stella-voice.js did not load - check the <script src> path.');
    if (micBtn) micBtn.style.display = 'none';
    return;
  }
  if (!Stella.isSupported()) {
    // e.g. Firefox, or a WebView without speech recognition. Typed testing still works.
    var st = $('voiceStatus');
    if (st) st.textContent = 'Voice not supported in this browser - use Chrome.';
    if (micBtn) micBtn.style.display = 'none';
  }

  if (PROXY_URL) Stella.config.GEMINI_ENDPOINT = PROXY_URL;
  Stella.config.SPEECH_LANG = 'hi-IN';   // Hindi + Hinglish; use 'en-US' for English-only speech

  /* ------------------------------------------------------------------
   * 2. Gemini API key management (stored on this device only)
   * ------------------------------------------------------------------ */
  function getKey() {
    try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; }
  }
  function saveKey(k) {
    try { if (k) localStorage.setItem(KEY_STORE, k); else localStorage.removeItem(KEY_STORE); } catch (e) { /* storage blocked */ }
  }

  // Returns true when Stella has a usable key (or a proxy). Asks once if none is saved.
  function ensureKey() {
    if (PROXY_URL) return true;
    var key = getKey() || DEFAULT_KEY;
    if (!key) {
      key = (window.prompt('Paste your Gemini API key. It is saved only on this device.') || '').trim();
      if (!key) return false;
      saveKey(key);
    }
    Stella.config.GEMINI_API_KEY = key;
    return true;
  }

  function changeKey() {
    var key = window.prompt('New Gemini API key (leave empty to delete the saved key):', '');
    if (key === null) return;                 // cancelled
    key = key.trim();
    saveKey(key);
    Stella.config.GEMINI_API_KEY = key || 'YOUR_GEMINI_API_KEY';
    var st = $('voiceStatus');
    if (st) st.textContent = key ? 'Gemini key updated' : 'Gemini key removed';
  }

  /* ------------------------------------------------------------------
   * 3. Mic button (tap = on/off, hold = change key)
   * ------------------------------------------------------------------ */
  function paintMic() {
    if (!micBtn) return;
    var on = Stella.isListening();
    micBtn.classList.toggle('on', on);
    micBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  if (micBtn) {
    var pressTimer = null, longPressed = false;

    micBtn.addEventListener('pointerdown', function () {
      longPressed = false;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(function () { longPressed = true; changeKey(); }, LONG_PRESS_MS);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) {
      micBtn.addEventListener(ev, function () { clearTimeout(pressTimer); });
    });

    micBtn.addEventListener('click', function () {
      if (longPressed) { longPressed = false; return; }
      if (Stella.isListening()) { Stella.stop(); paintMic(); return; }
      if (!ensureKey()) return;
      Stella.start();                         // must run inside this tap (browser mic rule)
      paintMic();
    });

    // Stella reports every state change here; also catches "mic blocked" turning listening off.
    document.addEventListener('stella:status', paintMic);
  }

  /* ------------------------------------------------------------------
   * 4. Small helpers
   * ------------------------------------------------------------------ */
  function say(msg, type) {
    var el = $('voiceStatus');
    if (el) el.textContent = msg;
    document.dispatchEvent(new CustomEvent('stella:status', { detail: { message: msg, type: type || 'ok' } }));
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  // 90 minutes -> 1h 30m ; 1.5 hours -> 1h 30m. The app only accepts minutes/seconds 0-59.
  function splitHMS(h, m, s) {
    var t = Math.round((Number(h) || 0) * 3600 + (Number(m) || 0) * 60 + (Number(s) || 0));
    return { h: Math.floor(t / 3600), m: Math.floor((t % 3600) / 60), s: t % 60, total: t };
  }

  function hmsText(t) {
    return Math.floor(t / 3600) + 'h ' + Math.floor((t % 3600) / 60) + 'm ' + (t % 60) + 's';
  }

  function rupees(n) {
    return '\u20B9' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Seconds the auto-timer has been running, or null if it is not running.
  // Reads the same saved start time the Start button writes (key 'autoDiff.start').
  function runningSeconds() {
    try {
      var s = JSON.parse(localStorage.getItem('autoDiff.start') || 'null');
      if (s && typeof s.ts === 'number') return Math.max(0, Math.floor((Date.now() - s.ts) / 1000));
    } catch (e) { /* ignore */ }
    return null;
  }

  function clickIfEnabled(id) {
    var b = $(id);
    if (b && !b.disabled) { b.click(); return true; }
    return false;
  }

  function setCostFields(t, rate) {
    $('costHours').value = pad2(t.h);
    $('costMinutes').value = pad2(t.m);
    $('costSeconds').value = pad2(t.s);
    if (rate !== null && rate !== undefined) $('costRate').value = rate;
  }

  /* ------------------------------------------------------------------
   * 5. Action router targets (stella-voice.js calls these by name)
   *    Existing app functions used: switchTab, resetTab1, resetShifts, resetCost3,
   *    addAnotherShift, calculateTotalHours, calculateCost3
   * ------------------------------------------------------------------ */
  window.StellaHandlers = {

    /* ---- timer control ---- */
    handleStartTimer: function () {
      switchTab(1);
      if (clickIfEnabled('autoStartBtn')) say('Timer started', 'ok');
      else say('Timer is already running', 'info');
    },

    handleStopTimer: function () {
      switchTab(1);
      if (clickIfEnabled('autoStopBtn')) say('Timer stopped', 'ok');   // app fills End time + calculates
      else say('No timer is running', 'info');
    },

    handleReset: function () {
      if (runningSeconds() !== null &&
          !window.confirm('The timer is running. Reset everything anyway?')) {
        say('Reset cancelled', 'info');
        return;
      }
      resetTab1();      // also stops the auto-timer (the app wraps resetTab1)
      resetShifts();
      resetCost3();
      say('Everything cleared', 'ok');
    },

    handleGetDuration: function () {
      var secs = runningSeconds();
      if (secs !== null) {
        switchTab(1);
        say('Elapsed: ' + hmsText(secs), 'ok');
        return;
      }
      var box = $('result1');
      if (box && box.style.display === 'block') {
        say('Last duration: ' + $('durationOutput').textContent, 'ok');
      } else {
        say('No timer is running', 'info');
      }
    },

    handleGetTotal: function () {
      var secs = runningSeconds();
      if (secs === null) { say('No timer is running, so there are no earnings yet', 'info'); return; }
      var rate = Number($('costRate').value);
      if (!rate || rate < 0) { say('Set a rate first - say "rate 500 kar do"', 'info'); return; }
      say('Earned so far: ' + rupees((secs / 3600) * rate) + ' (' + hmsText(secs) + ' at ' + rupees(rate) + '/hour)', 'ok');
    },

    /* ---- calculations ---- */
    handleSetRate: function (rate) {
      $('costRate').value = rate;
      $('costRate').dispatchEvent(new Event('input', { bubbles: true }));   // lets the cost tab refresh itself
      say('Rate set to ' + rupees(rate) + ' per hour', 'ok');
    },

    handleAddHours: function (durations) {
      switchTab(2);
      resetShifts();                                   // a voice "add" is a fresh sum
      for (var i = 1; i < durations.length; i++) addAnotherShift();

      var rows = document.querySelectorAll('#shiftContainer .shift-row');
      var grand = 0;
      durations.forEach(function (d, i) {
        var t = splitHMS(d.hours, d.minutes, d.seconds);
        grand += t.total;
        rows[i].querySelector('.shift-hours').value = pad2(t.h);
        rows[i].querySelector('.shift-minutes').value = pad2(t.m);
        rows[i].querySelector('.shift-seconds').value = pad2(t.s);
      });
      calculateTotalHours();
      say('Total of ' + durations.length + ' shift' + (durations.length === 1 ? '' : 's') + ': ' + hmsText(grand), 'ok');
    },

    handleCalculateCost: function (rate, hours, minutes, seconds) {
      var t = splitHMS(hours, minutes, seconds);
      if (t.total <= 0) { say('Say how much time to calculate, e.g. "2 ghante 20 minute"', 'info'); return; }

      var useRate = rate;
      if (useRate === null) {                          // no rate spoken -> fall back to the rate already typed in
        var existing = Number($('costRate').value);
        if (existing > 0) useRate = existing;
      }
      if (useRate === null || useRate === undefined) {
        say('I need a rate per hour - say it together, e.g. "500 rupees per hour"', 'info');
        return;
      }
      switchTab(3);
      setCostFields(t, useRate);
      calculateCost3();
      say('Cost: ' + rupees((t.total / 3600) * useRate), 'ok');
    },

    /* ---- settings ---- */
    handleChangeSetting: function (type, value) {
      var v = String(value || '').toLowerCase();

      if (type === 'theme') {
        var dark = /dark|night|raat|\u0921\u093E\u0930\u094D\u0915|\u0915\u093E\u0932\u093E/.test(v);
        var light = /light|day|white|\u0932\u093E\u0907\u091F|\u0938\u092B\u093C\u0947\u0926|\u0938\u092B\u0947\u0926/.test(v);
        if (!dark && !light) { say('Theme "' + value + '" not recognised - say dark or light', 'info'); return; }
        window.__stellaTheme = dark ? 'dark' : 'light';   // read by the optional one-line patch in the auto dark-mode script
        document.documentElement.classList.toggle('dark-mode', dark);
        say((dark ? 'Dark' : 'Light') + ' theme on', 'ok');
        return;
      }

      if (type === 'language') {
        // The app UI is English-only, so "language" switches the voice-recognition language.
        if (/hindi|\u0939\u093F\u0902\u0926\u0940|hinglish/.test(v)) {
          Stella.setLanguage('hi-IN'); say('Listening in Hindi / Hinglish', 'ok');
        } else if (/english|angrezi|\u0905\u0902\u0917\u094D\u0930\u0947\u091C\u093C\u0940/.test(v)) {
          Stella.setLanguage('en-US'); say('Listening in English', 'ok');
        } else {
          say('Language "' + value + '" is not available - try Hindi or English', 'info');
        }
      }
    }
    // handleUnknown is not overridden: stella-voice.js shows "Sorry, I did not understand ..."
  };

  paintMic();
})();
