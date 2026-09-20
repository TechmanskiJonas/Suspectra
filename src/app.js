/*
 * app.js: state, controls, keyboard, MIDI (shell code)
 *
 * Two parameter sets exist at once: `state`, which is sounding, and `staged`,
 * the chord being prepared. The controls and the keyboard edit `staged` while
 * `state` keeps playing, until the staged chord is played or discarded.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const LOW = 48, HIGH = 72; // C3..C5

  // Everything a chord carries with it. Volume and the MIDI key mode are
  // monitoring controls and stay outside.
  const PARAMS = ['consonance', 'glide', 'brightness', 'partials', 'mode', 'preset'];

  const state = {
    active: new Set([60, 64, 67]),
    consonance: 100,
    glide: 250,
    brightness: 55,
    partials: 8,
    mode: 'off',
    preset: 'organ',
  };

  let volume = 60;
  let midiMode = 'hold';
  let staged = null;   // parameters and notes waiting to be played
  let punch = null;    // 'smooth' or 'fused' while its hotkey is held
  let last = { base: [], shown: [] };
  const syncers = [];  // control refreshers, run when the edited set changes

  const editing = () => staged || state;
  const liveMode = () => punch || state.mode;

  function snapshot(src) {
    const copy = { active: new Set(src.active) };
    for (const k of PARAMS) copy[k] = src[k];
    return copy;
  }

  // ---------------------------------------------------------------- keyboard
  const BLACK = new Set([1, 3, 6, 8, 10]);
  function buildKeyboard() {
    const kb = $('keyboard');
    const whites = [];
    for (let m = LOW; m <= HIGH; m++) if (!BLACK.has(m % 12)) whites.push(m);
    kb.style.setProperty('--whites', whites.length);
    for (let m = LOW; m <= HIGH; m++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = BLACK.has(m % 12) ? 'key black' : 'key white';
      b.dataset.midi = m;
      b.setAttribute('aria-label', SP.views.noteName(m));
      if (BLACK.has(m % 12)) {
        b.style.setProperty('--pos', whites.indexOf(m - 1) + 1);
      } else if (m % 12 === 0) {
        const tag = document.createElement('span');
        tag.textContent = SP.views.noteName(m);
        b.appendChild(tag);
      }
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        SP.audio.ensure();
        toggle(m);
      });
      b.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          SP.audio.ensure();
          toggle(m);
        }
      });
      kb.appendChild(b);
    }
  }

  function toggle(m, on) {
    const set = editing().active;
    const want = on === undefined ? !set.has(m) : on;
    if (want) set.add(m); else set.delete(m);
    update();
  }

  function paintKeys() {
    const shown = editing().active;
    document.querySelectorAll('.key').forEach((k) => {
      const m = Number(k.dataset.midi);
      const on = shown.has(m);
      k.setAttribute('aria-pressed', on);
      k.classList.toggle('sounding', state.active.has(m));
      k.style.setProperty('--note', on ? SP.views.noteColor(m) : 'transparent');
    });
  }

  // ---------------------------------------------------------------- engine
  function compute(p, active, mode) {
    const midis = [...active].sort((a, b) => a - b);
    const base = midis.map((m) => ({ midi: m, ...SP.timbre.base(m, p.partials, p.preset, p.brightness / 100) }));

    let optimum = base.map((n) => n.freqs.slice());
    let note = mode === 'off' ? 'off' : '';
    if (mode !== 'off' && SP.optimizer.implemented && base.length > 1) {
      const input = base.map((n) => ({ midi: n.midi, f0: n.freqs[0], freqs: n.freqs.slice(), amps: n.amps.slice() }));
      const t0 = performance.now();
      try {
        const r = SP.optimizer.optimize(input, { mode, maxShift: 0.45, dissonance: SP.dissonance });
        const ok = Array.isArray(r) && r.length === base.length
          && r.every((f, k) => f.length === base[k].freqs.length && f.every((v) => v > 0 && isFinite(v)));
        if (ok) optimum = r;
        note = ok ? `${Math.round(performance.now() - t0)} ms` : 'wrong shape, ignored';
        const series = SP.optimizer.lastSeries;
        if (ok && series) note = `${series.integers.join(':')} · F ${series.F.toFixed(1)} Hz`;
      } catch (e) {
        note = `error: ${e.message}`;
      }
    }

    const c = p.consonance / 100;
    const shown = base.map((n, k) => ({
      midi: n.midi,
      amps: n.amps,
      freqs: n.freqs.map((f, i) => f * Math.pow(optimum[k][i] / f, c)),
    }));
    return { base, shown, note };
  }

  function readouts(view) {
    const { base, shown, note } = view;
    let maxShift = 0;
    shown.forEach((n, k) => n.freqs.forEach((f, i) => {
      maxShift = Math.max(maxShift, Math.abs(1200 * Math.log2(f / base[k].freqs[i])));
    }));
    $('shiftOut').textContent = `${Math.round(maxShift)}¢`;

    if (SP.dissonance.implemented && base.length > 1) {
      const before = SP.dissonance.total(base);
      const after = SP.dissonance.total(shown);
      const pct = before > 0 ? Math.round((1 - after / before) * 100) : 0;
      $('roughOut').textContent = `${before.toFixed(3)} → ${after.toFixed(3)}`;
      $('roughPct').textContent = before > 0 ? `${pct >= 0 ? '−' : '+'}${Math.abs(pct)}%` : '';
    } else {
      $('roughOut').textContent = '–';
      $('roughPct').textContent = '';
    }
    $('chordOut').textContent = base.length ? base.map((n) => SP.views.noteName(n.midi)).join(' · ') : 'silence';
    $('optOut').textContent = base.length > 1 ? (note || '–') : '–';
  }

  function drawCurve() {
    const p = editing();
    const samples = [];
    if (SP.dissonance.implemented) {
      const a = SP.timbre.base(60, p.partials, p.preset, p.brightness / 100);
      for (let ct = 0; ct <= 1200; ct += 4) {
        const r = Math.pow(2, ct / 1200);
        samples.push({ cents: ct, d: SP.dissonance.total([a, { freqs: a.freqs.map((f) => f * r), amps: a.amps }]) });
      }
    }
    SP.views.curve($('curve'), samples, SP.dissonance.implemented);
  }

  function update() {
    const live = compute(state, state.active, liveMode());
    SP.audio.render(live.shown, state.glide / 1000);

    // While a chord is staged the display previews it, and the old one plays on.
    const view = staged ? compute(staged, staged.active, staged.mode) : live;
    last = view;
    SP.views.spectrum($('spectrum'), view.base, view.shown);
    paintKeys();
    readouts(view);
    syncMode();
    document.body.classList.toggle('staging', !!staged);
    $('soundBtn').textContent = SP.audio.running() ? 'Sound on' : 'Start sound';
    $('soundBtn').setAttribute('aria-pressed', SP.audio.running());
  }

  // ---------------------------------------------------------------- controls
  function bindRange(id, key, fmt, redrawCurve) {
    const el = $(id);
    const out = $(id + 'Val');
    const sync = () => { el.value = editing()[key]; out.textContent = fmt(editing()[key]); };
    sync();
    syncers.push(sync);
    el.addEventListener('input', () => {
      editing()[key] = Number(el.value);
      out.textContent = fmt(editing()[key]);
      update();
      if (redrawCurve) drawCurve();
    });
  }

  function bindControls() {
    bindRange('consonance', 'consonance', (v) => `${v}%`);
    bindRange('glide', 'glide', (v) => (v === 0 ? 'instant' : `${v} ms`));
    bindRange('brightness', 'brightness', (v) => `${v}%`, true);
    bindRange('partials', 'partials', (v) => String(v), true);

    const vol = $('volume');
    const volOut = $('volumeVal');
    vol.value = volume;
    volOut.textContent = `${volume}%`;
    vol.addEventListener('input', () => {
      volume = Number(vol.value);
      volOut.textContent = `${volume}%`;
      SP.audio.setVolume(volume / 100);
    });

    const preset = $('preset');
    Object.entries(SP.timbre.presets).forEach(([k, p]) => {
      const o = document.createElement('option');
      o.value = k;
      o.textContent = p.label;
      preset.appendChild(o);
    });
    const syncPreset = () => { preset.value = editing().preset; };
    syncPreset();
    syncers.push(syncPreset);
    preset.addEventListener('change', () => { editing().preset = preset.value; update(); drawCurve(); });

    document.querySelectorAll('input[name="mode"]').forEach((r) => {
      r.addEventListener('change', () => { if (r.checked) { editing().mode = r.value; update(); } });
    });
    syncers.push(syncMode);

    $('soundBtn').addEventListener('click', () => { SP.audio.ensure(); setTimeout(update, 60); });
    $('clearBtn').addEventListener('click', () => { editing().active.clear(); update(); });
    $('stageBtn').addEventListener('click', stage);
    $('playBtn').addEventListener('click', play);
    $('cancelBtn').addEventListener('click', cancel);
    $('midiBtn').addEventListener('click', connectMidi);
    $('midiMode').addEventListener('change', (e) => { midiMode = e.target.value; });
  }

  /** Radio buttons follow the edited chord; a held hotkey is marked separately. */
  function syncMode() {
    const shown = staged ? staged.mode : state.mode;
    document.querySelectorAll('input[name="mode"]').forEach((r) => { r.checked = r.value === shown; });
    document.querySelectorAll('.seg label').forEach((l) => {
      const v = l.querySelector('input').value;
      l.classList.toggle('punched', !staged && punch === v);
    });
  }

  function syncAll() {
    syncers.forEach((f) => f());
  }

  // ---------------------------------------------------------------- staging
  function stage() {
    staged = snapshot(state);
    syncAll();
    update();
    drawCurve();
  }

  function play() {
    if (!staged) return;
    state.active = new Set(staged.active);
    for (const k of PARAMS) state[k] = staged[k];
    staged = null;
    syncAll();
    SP.audio.ensure();
    update();
    drawCurve();
  }

  function cancel() {
    staged = null;
    syncAll();
    update();
    drawCurve();
  }

  // ---------------------------------------------------------------- views
  /** The instrument and the listening test are two views of one page. */
  function showView(name) {
    document.body.dataset.view = name;
    document.querySelectorAll('nav.nav .tab').forEach((t) => t.classList.toggle('on', t.dataset.view === name));
    $('viewInstrument').classList.toggle('on', name === 'instrument');
    $('viewListening').classList.toggle('on', name === 'listening');
    closeInfo();
    // Silence the instrument so it cannot sound under a trial.
    if (name === 'listening') SP.audio.suspend();
    if (location.hash.slice(1) !== name) history.replaceState(null, '', name === 'instrument' ? location.pathname : '#listening');
  }

  function bindViews() {
    document.querySelectorAll('nav.nav .tab').forEach((t) => {
      t.addEventListener('click', () => showView(t.dataset.view));
    });
    window.addEventListener('hashchange', () => showView(location.hash === '#listening' ? 'listening' : 'instrument'));
    if (location.hash === '#listening') showView('listening');
  }

  const onInstrument = () => document.body.dataset.view === 'instrument';

  // ---------------------------------------------------------------- hotkeys
  function bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!onInstrument()) return;   // 1 and 2 answer trials on the other view
      if (e.key === '1' || e.key === '2') {
        const want = e.key === '1' ? 'smooth' : 'fused';
        if (punch !== want) { punch = want; update(); }
      } else if (e.key === 'Enter' && staged) {
        e.preventDefault();
        play();
      } else if (e.key === 'Escape') {
        if (staged) cancel(); else closeInfo();
      }
    });
    const release = (key) => {
      const mode = key === '1' ? 'smooth' : 'fused';
      if (punch === mode) { punch = null; update(); }
    };
    window.addEventListener('keyup', (e) => { if (e.key === '1' || e.key === '2') release(e.key); });
    window.addEventListener('blur', () => { if (punch) { punch = null; update(); } });
  }

  // ---------------------------------------------------------------- info
  const INFO = {
    mode: {
      title: 'Mode',
      body: `<p><b>Off</b> keeps every partial on the harmonic series.</p>
        <p><b>Smooth</b> places the partials at the positions that minimise the roughness of the
        chord, measured with the Plomp and Levelt curve as fitted by Sethares.</p>
        <p><b>Fused</b> approximates the fundamentals as whole-number multiples of a common frequency
        F and places every partial on that shared series. The Optimizer readout shows the whole
        numbers and F.</p>
        <p>Every partial stays within 0.45 of its own harmonic number, and fundamentals never move.</p>
        <p>Hold <kbd>1</kbd> for Smooth or <kbd>2</kbd> for Fused. Releasing returns to the mode
        selected here.</p>`,
    },
    consonance: {
      title: 'Consonance',
      body: `<p>Blends each partial between its base position and the optimizer's, evenly in cents:
        <i>shown = base · (optimum / base)<sup>c</sup></i>.</p>
        <p>0 is the base instrument. 100 is the optimizer's arrangement.</p>`,
    },
    glide: {
      title: 'Glide',
      body: `<p>The time partials take to reach new frequencies after a change.</p>
        <p>Notes held through a change glide. Notes switched on start at their new positions.</p>`,
    },
    next: {
      title: 'Next chord',
      body: `<p><b>Set next chord</b> copies the current chord and its settings into a staging area.
        The keyboard and the controls then edit the staged chord, the current chord keeps sounding,
        and the display shows the staged one.</p>
        <p><b>Play it</b> (<kbd>Enter</kbd>) applies the staged notes and settings together.
        <b>Cancel</b> (<kbd>Esc</kbd>) discards them.</p>
        <p>Staged settings are Consonance, Glide, Brightness, Partials, Base sound and Mode. Volume
        and the MIDI key mode stay live.</p>`,
    },
  };

  let popover = null;
  function closeInfo() {
    if (popover) { popover.remove(); popover = null; }
  }

  function openInfo(button) {
    const item = INFO[button.dataset.info];
    if (!item) return;
    const wasOpen = popover && popover.dataset.key === button.dataset.info;
    closeInfo();
    if (wasOpen) return;

    popover = document.createElement('div');
    popover.className = 'popover';
    popover.dataset.key = button.dataset.info;
    popover.innerHTML = `<h3>${item.title}</h3>${item.body}`;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'popclose';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', closeInfo);
    popover.appendChild(close);
    document.body.appendChild(popover);

    const r = button.getBoundingClientRect();
    const width = popover.offsetWidth;
    const left = Math.min(Math.max(8, r.left + window.scrollX - width / 2), window.innerWidth - width - 8);
    popover.style.left = `${left}px`;
    popover.style.top = `${r.bottom + window.scrollY + 8}px`;
    popover.addEventListener('click', (e) => e.stopPropagation());
  }

  function bindInfo() {
    document.querySelectorAll('[data-info]').forEach((b) => {
      b.addEventListener('click', (e) => { e.stopPropagation(); openInfo(b); });
    });
    document.addEventListener('click', closeInfo);
  }

  // ---------------------------------------------------------------- MIDI
  async function connectMidi() {
    const status = $('midiStatus');
    if (!navigator.requestMIDIAccess) {
      status.textContent = 'This browser has no Web MIDI. Use Chrome or Edge.';
      return;
    }
    try {
      const access = await navigator.requestMIDIAccess();
      const hook = () => {
        const names = [];
        access.inputs.forEach((input) => {
          names.push(input.name);
          input.onmidimessage = (msg) => {
            const [st, note, vel] = msg.data;
            const type = st & 0xf0;
            if (note < LOW || note > HIGH) return;
            SP.audio.ensure();
            if (type === 0x90 && vel > 0) toggle(note, midiMode === 'latch' ? !editing().active.has(note) : true);
            else if ((type === 0x80 || (type === 0x90 && vel === 0)) && midiMode === 'hold') toggle(note, false);
          };
        });
        status.textContent = names.length ? `Listening: ${names.join(', ')} (C3–C5)` : 'No MIDI inputs found. Plug in the keyboard and connect again.';
      };
      hook();
      access.onstatechange = hook;
    } catch (e) {
      status.textContent = 'MIDI access was blocked here. Open index.html locally in Chrome to use your keyboard.';
    }
  }

  // ---------------------------------------------------------------- boot
  buildKeyboard();
  bindControls();
  bindKeys();
  bindInfo();
  bindViews();
  SP.experiment.boot();
  update();
  drawCurve();
  const ro = new ResizeObserver(() => { SP.views.spectrum($('spectrum'), last.base, last.shown); drawCurve(); });
  ro.observe($('spectrum'));
  ro.observe($('curve'));
})();
