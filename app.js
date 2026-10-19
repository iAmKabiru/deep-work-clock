(() => {
  'use strict';

  /* ================= Helpers ================= */
  const $ = (s) => document.querySelector(s);
  const pad = (n) => String(n).padStart(2, '0');
  const clampInt = (v, min, max) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
  };

  const els = {
    root: document.documentElement,
    clock: $('#clock'),
    clockText: $('#clock-text'),
    setter: $('#setter'),
    hours: $('#hours'),
    minutes: $('#minutes'),
    toggle: $('#toggle'),
    reset: $('#reset'),
    fullscreen: $('#fullscreen'),
    date: $('#date'),
    status: $('#status'),
    swatches: [...document.querySelectorAll('[data-theme-btn]')]
  };

  /* ================= State + storage ================= */
  const KEY = 'deepwork.v1';
  const THEMES = ['amber', 'white', 'green'];
  const MAX_MINUTES = 99 * 60 + 59;

  const state = {
    theme: 'amber',
    durationMin: 90,
    status: 'idle',      // idle | running | paused | done
    endAt: 0,            // epoch ms, valid while running
    remainingMs: 90 * 60000 // valid while paused
  };

  const Store = {
    load() {
      try {
        const s = JSON.parse(localStorage.getItem(KEY));
        if (!s || typeof s !== 'object') return;
        if (THEMES.includes(s.theme)) state.theme = s.theme;
        state.durationMin = clampInt(s.durationMin, 0, MAX_MINUTES);
        state.remainingMs = state.durationMin * 60000;
        if (s.status === 'running' && Number.isFinite(s.endAt)) {
          state.status = 'running';
          state.endAt = s.endAt;
        } else if (s.status === 'paused' && Number.isFinite(s.remainingMs)) {
          state.status = 'paused';
          state.remainingMs = Math.min(Math.max(0, s.remainingMs), state.durationMin * 60000);
        } else if (s.status === 'done') {
          state.status = 'done';
        }
      } catch (_) { /* storage unavailable or corrupt: use defaults */ }
    },
    save() {
      try {
        localStorage.setItem(KEY, JSON.stringify({
          theme: state.theme,
          durationMin: state.durationMin,
          status: state.status,
          endAt: state.endAt,
          remainingMs: state.remainingMs
        }));
      } catch (_) { /* ignore */ }
    }
  };

  /* ================= Seven-segment display ================= */
  const Display = (() => {
    const NS = 'http://www.w3.org/2000/svg';
    const T = 5; // half segment thickness
    const H = (x1, x2, y) => [[x1, y], [x1 + T, y - T], [x2 - T, y - T], [x2, y], [x2 - T, y + T], [x1 + T, y + T]];
    const V = (x, y1, y2) => [[x, y1], [x + T, y1 + T], [x + T, y2 - T], [x, y2], [x - T, y2 - T], [x - T, y1 + T]];
    const SHAPES = {
      a: H(8, 48, 5), b: V(51, 8, 47), c: V(51, 53, 92), d: H(8, 48, 95),
      e: V(5, 53, 92), f: V(5, 8, 47), g: H(8, 48, 50)
    };
    const MAP = {
      0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg',
      5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg'
    };
    const DIGIT_X = [0, 66, 162, 228];
    const digits = [];
    let last = '';

    const el = (name, attrs) => {
      const n = document.createElementNS(NS, name);
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      return n;
    };

    function build() {
      const svg = el('svg', { viewBox: '-10 0 294 100', 'aria-hidden': 'true', focusable: 'false' });
      const g = el('g', { transform: 'skewX(-5)' });
      DIGIT_X.forEach((x) => {
        const segs = {};
        const dg = el('g', { transform: `translate(${x} 0)` });
        for (const k in SHAPES) {
          segs[k] = el('polygon', { class: 'seg', points: SHAPES[k].map((p) => p.join(',')).join(' ') });
          dg.appendChild(segs[k]);
        }
        g.appendChild(dg);
        digits.push(segs);
      });
      [30, 65].forEach((y) => g.appendChild(el('rect', { class: 'dot on', x: 137, y, width: 10, height: 10, rx: 1 })));
      svg.appendChild(g);
      els.clock.appendChild(svg);
    }

    function show(hh, mm) {
      const str = pad(hh) + pad(mm);
      if (str === last) return;
      last = str;
      digits.forEach((segs, i) => {
        const lit = MAP[str[i]];
        for (const k in segs) segs[k].classList.toggle('on', lit.includes(k));
      });
    }
    return { build, show };
  })();

  /* ================= Wake lock ================= */
  const WakeLock = (() => {
    let sentinel = null;
    let pending = false;
    const supported = 'wakeLock' in navigator;

    async function acquire() {
      if (!supported || sentinel || pending || document.visibilityState !== 'visible') return;
      pending = true;
      try {
        const s = await navigator.wakeLock.request('screen');
        if (state.status !== 'running') { s.release().catch(() => {}); return; }
        sentinel = s;
        s.addEventListener('release', () => { if (sentinel === s) sentinel = null; });
      } catch (_) { sentinel = null; /* denied, low battery, or unsupported context */ }
      finally { pending = false; }
    }
    function release() {
      if (sentinel) { sentinel.release().catch(() => {}); sentinel = null; }
    }
    return { acquire, release };
  })();

  /* ================= Countdown ================= */
  const durationMs = () => state.durationMin * 60000;
  let timerId = 0;

  function remaining() {
    switch (state.status) {
      case 'running': return Math.max(0, state.endAt - Date.now());
      case 'paused': return state.remainingMs;
      case 'done': return 0;
      default: return durationMs();
    }
  }

  function announce(msg) { els.status.textContent = msg; }

  function render() {
    const rem = remaining();
    const mins = Math.ceil(rem / 60000); // shows the minute still in progress
    const hh = Math.floor(mins / 60);
    const mm = mins % 60;
    Display.show(hh, mm);

    els.root.dataset.status = state.status;
    els.clockText.textContent = `${hh} hours ${mm} minutes`;

    const labels = { idle: 'Start', done: 'Start', running: 'Pause', paused: 'Resume' };
    els.toggle.textContent = labels[state.status];
    els.toggle.disabled = state.status === 'idle' && state.durationMin === 0;
    els.reset.disabled = state.status === 'idle';

    const locked = state.status === 'running' || state.status === 'paused';
    els.setter.inert = locked;
    const dh = Math.floor(state.durationMin / 60), dm = state.durationMin % 60;
    if (document.activeElement !== els.hours) els.hours.value = pad(dh);
    if (document.activeElement !== els.minutes) els.minutes.value = pad(dm);

    document.title = locked ? `${pad(hh)}:${pad(mm)} · Deep Work` : 'Deep Work';
    els.swatches.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeBtn === state.theme)));
    els.root.dataset.theme = state.theme;
  }

  function schedule() {
    clearTimeout(timerId);
    if (state.status !== 'running') return;
    const rem = remaining();
    if (rem <= 0) { finish(); return; }
    // Wake exactly when the displayed minute will change.
    const k = Math.ceil(rem / 60000);
    timerId = setTimeout(tick, rem - 60000 * (k - 1) + 20);
  }

  function tick() {
    if (state.status !== 'running') return;
    if (remaining() <= 0) finish();
    else { render(); schedule(); }
  }

  function finish() {
    clearTimeout(timerId);
    state.status = 'done';
    state.remainingMs = 0;
    WakeLock.release();
    render();
    Store.save();
    announce('Countdown complete');
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  }

  function start() {
    if (state.durationMin === 0) return;
    state.remainingMs = durationMs();
    state.endAt = Date.now() + state.remainingMs;
    state.status = 'running';
    afterChange('Started');
  }
  function pause() {
    state.remainingMs = remaining();
    state.status = 'paused';
    afterChange('Paused');
  }
  function resume() {
    state.endAt = Date.now() + state.remainingMs;
    state.status = 'running';
    afterChange('Resumed');
  }
  function reset() {
    state.status = 'idle';
    state.remainingMs = durationMs();
    afterChange('Reset');
  }

  function afterChange(message) {
    render();
    schedule();
    Store.save();
    if (state.status === 'running') WakeLock.acquire(); else WakeLock.release();
    if (message) announce(message);
  }

  function onToggle() {
    if (state.status === 'running') pause();
    else if (state.status === 'paused') resume();
    else if (!els.toggle.disabled) start();
  }

  /* ================= Duration setter ================= */
  function onSetterInput() {
    const h = clampInt(els.hours.value, 0, 99);
    const m = clampInt(els.minutes.value, 0, 59);
    state.durationMin = h * 60 + m;
    state.remainingMs = durationMs();
    state.status = 'idle';
    render();
    Store.save();
  }
  function normalizeSetter() {
    els.hours.value = pad(clampInt(els.hours.value, 0, 99));
    els.minutes.value = pad(clampInt(els.minutes.value, 0, 59));
  }

  /* ================= Theme ================= */
  function setTheme(name) {
    if (!THEMES.includes(name)) return;
    state.theme = name;
    render();
    Store.save();
  }

  /* ================= Fullscreen ================= */
  const Fullscreen = (() => {
    const supported = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
    const active = () => document.fullscreenElement || document.webkitFullscreenElement;
    function toggle() {
      if (!supported) return;
      if (active()) {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      } else {
        const el = document.documentElement;
        const req = el.requestFullscreen || el.webkitRequestFullscreen;
        try { Promise.resolve(req.call(el)).catch(() => {}); } catch (_) { /* ignore */ }
      }
    }
    function sync() {
      const on = !!active();
      els.fullscreen.setAttribute('aria-pressed', String(on));
      els.fullscreen.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Enter fullscreen');
    }
    function init() {
      if (!supported) return;
      els.fullscreen.hidden = false;
      els.fullscreen.addEventListener('click', toggle);
      document.addEventListener('fullscreenchange', sync);
      document.addEventListener('webkitfullscreenchange', sync);
    }
    return { init, toggle, supported };
  })();

  /* ================= Date footer ================= */
  const DateFooter = (() => {
    const fmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    let id = 0;
    function update() {
      const now = new Date();
      els.date.textContent = fmt.format(now);
      els.date.dateTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      clearTimeout(id);
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
      id = setTimeout(update, midnight - now);
    }
    return { update };
  })();

  /* ================= Wiring ================= */
  function init() {
    Store.load();
    Display.build();

    // Recover a countdown that was running during a reload.
    if (state.status === 'running' && remaining() <= 0) {
      state.status = 'done';
      state.remainingMs = 0;
      Store.save();
    }

    els.toggle.addEventListener('click', onToggle);
    els.reset.addEventListener('click', reset);
    els.swatches.forEach((b) => b.addEventListener('click', () => setTheme(b.dataset.themeBtn)));
    [els.hours, els.minutes].forEach((i) => {
      i.addEventListener('input', onSetterInput);
      i.addEventListener('change', () => { onSetterInput(); normalizeSetter(); });
      i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { i.blur(); normalizeSetter(); } });
      i.addEventListener('focus', () => i.select());
    });

    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'BUTTON') return;
      if (e.code === 'Space') { e.preventDefault(); onToggle(); }
      else if (e.key === 'r' || e.key === 'R') { if (!els.reset.disabled) reset(); }
      else if (e.key === 'f' || e.key === 'F') Fullscreen.toggle();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      DateFooter.update();
      if (state.status === 'running') {
        if (remaining() <= 0) finish(); else { render(); schedule(); WakeLock.acquire(); }
      }
    });

    Fullscreen.init();
    DateFooter.update();
    render();
    if (state.status === 'running') { schedule(); WakeLock.acquire(); }

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
    }
  }

  init();
})();
