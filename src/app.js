/*
 * app.js: wiring (shell code)
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const LOW = 48, HIGH = 72; // C3..C5

  const state = {
    active: new Set([60, 64, 67]),
    consonance: 100,
    glide: 250,
    brightness: 55,
    partials: 8,
    mode: 'smooth',
    preset: 'organ',
    volume: 60,
    midiMode: 'hold',
  };

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
        const leftWhite = whites.indexOf(m - 1);
        b.style.setProperty('--pos', leftWhite + 1);
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
    const want = on === undefined ? !state.active.has(m) : on;
    if (want) state.active.add(m); else state.active.delete(m);
    update();
  }
  function paintKeys() {
    document.querySelectorAll('.key').forEach((k) => {
      const m = Number(k.dataset.midi);
      const on = state.active.has(m);
      k.setAttribute('aria-pressed', on);
      k.style.setProperty('--note', on ? SP.views.noteColor(m) : 'transparent');
    });
  }

  // ---------------------------------------------------------------- engine
  let last = { base: [], shown: [] };
  let optimizerNote = '';

  function compute() {
    const midis = [...state.active].sort((a, b) => a - b);
    const bright = state.brightness / 100;
    const base = midis.map((m) => ({ midi: m, ...SP.timbre.base(m, state.partials, state.preset, bright) }));

    let optimum = base.map((n) => n.freqs.slice());
    optimizerNote = SP.optimizer.implemented ? '' : 'Not written yet';
    if (SP.optimizer.implemented && base.length > 1) {
      const input = base.map((n) => ({ midi: n.midi, f0: n.freqs[0], freqs: n.freqs.slice(), amps: n.amps.slice() }));
      const t0 = performance.now();
      try {
        const r = SP.optimizer.optimize(input, { mode: state.mode, maxShift: 0.45, dissonance: SP.dissonance });
        const ok = Array.isArray(r) && r.length === base.length && r.every((f, k) => f.length === base[k].freqs.length && f.every((v) => v > 0 && isFinite(v)));
        if (ok) optimum = r;
        optimizerNote = ok ? `${Math.round(performance.now() - t0)} ms per chord` : 'Returned the wrong shape; ignored';
      } catch (e) {
        optimizerNote = `Error: ${e.message}`;
      }
    }

    const c = state.consonance / 100;
    const shown = base.map((n, k) => ({
      midi: n.midi,
      amps: n.amps,
      freqs: n.freqs.map((f, i) => f * Math.pow(optimum[k][i] / f, c)),
    }));
    return { base, shown };
  }

  function readouts(base, shown) {
    let maxShift = 0;
    shown.forEach((n, k) => n.freqs.forEach((f, i) => { maxShift = Math.max(maxShift, Math.abs(1200 * Math.log2(f / base[k].freqs[i]))); }));
    $('shiftOut').textContent = `${Math.round(maxShift)}¢`;

    if (SP.dissonance.implemented && base.length > 1) {
      const before = SP.dissonance.total(base);
      const after = SP.dissonance.total(shown);
      const pct = before > 0 ? Math.round((1 - after / before) * 100) : 0;
      $('roughOut').textContent = `${before.toFixed(3)} → ${after.toFixed(3)}`;
      $('roughPct').textContent = before > 0 ? `${pct >= 0 ? '−' : '+'}${Math.abs(pct)}%` : '';
    } else {
      $('roughOut').textContent = SP.dissonance.implemented ? '–' : 'needs dissonance.js';
      $('roughPct').textContent = '';
    }
    $('chordOut').textContent = base.length ? base.map((n) => SP.views.noteName(n.midi)).join(' · ') : 'silence';
    $('optStatus').textContent = optimizerNote;
    $('dissStatus').textContent = SP.dissonance.implemented ? 'Written' : 'Not written yet';
    $('dissChip').dataset.state = SP.dissonance.implemented ? 'ok' : 'todo';
    $('optChip').dataset.state = SP.optimizer.implemented ? (optimizerNote.startsWith('Error') || optimizerNote.startsWith('Returned') ? 'bad' : 'ok') : 'todo';
  }

  function drawCurve() {
    const samples = [];
    if (SP.dissonance.implemented) {
      const a = SP.timbre.base(60, state.partials, state.preset, state.brightness / 100);
      for (let ct = 0; ct <= 1200; ct += 4) {
        const r = Math.pow(2, ct / 1200);
        samples.push({ cents: ct, d: SP.dissonance.total([a, { freqs: a.freqs.map((f) => f * r), amps: a.amps }]) });
      }
    }
    SP.views.curve($('curve'), samples, SP.dissonance.implemented);
  }

  function update() {
    const { base, shown } = compute();
    last = { base, shown };
    SP.audio.render(shown, state.glide / 1000);
    SP.views.spectrum($('spectrum'), base, shown);
    paintKeys();
    readouts(base, shown);
    $('soundBtn').textContent = SP.audio.running() ? 'Sound on' : 'Start sound';
    $('soundBtn').setAttribute('aria-pressed', SP.audio.running());
  }

  // ---------------------------------------------------------------- controls
  function bindRange(id, key, fmt, redrawCurve) {
    const el = $(id);
    const out = $(id + 'Val');
    el.value = state[key];
    const show = () => { out.textContent = fmt(state[key]); };
    show();
    el.addEventListener('input', () => {
      state[key] = Number(el.value);
      show();
      if (key === 'volume') { SP.audio.setVolume(state.volume / 100); return; }
      update();
      if (redrawCurve) drawCurve();
    });
  }

  function bindControls() {
    bindRange('consonance', 'consonance', (v) => `${v}%`);
    bindRange('glide', 'glide', (v) => (v === 0 ? 'instant' : `${v} ms`));
    bindRange('brightness', 'brightness', (v) => `${v}%`, true);
    bindRange('partials', 'partials', (v) => String(v), true);
    bindRange('volume', 'volume', (v) => `${v}%`);

    const preset = $('preset');
    Object.entries(SP.timbre.presets).forEach(([k, p]) => {
      const o = document.createElement('option');
      o.value = k; o.textContent = p.label;
      preset.appendChild(o);
    });
    preset.value = state.preset;
    preset.addEventListener('change', () => { state.preset = preset.value; update(); drawCurve(); });

    document.querySelectorAll('input[name="mode"]').forEach((r) => {
      r.checked = r.value === state.mode;
      r.addEventListener('change', () => { if (r.checked) { state.mode = r.value; update(); } });
    });

    $('soundBtn').addEventListener('click', () => { SP.audio.ensure(); setTimeout(update, 60); });
    $('clearBtn').addEventListener('click', () => { state.active.clear(); update(); });
    $('checksBtn').addEventListener('click', runChecks);
    $('midiBtn').addEventListener('click', connectMidi);
    $('midiMode').addEventListener('change', (e) => { state.midiMode = e.target.value; });
  }

  // ---------------------------------------------------------------- checks
  function runChecks() {
    const list = $('checks');
    list.innerHTML = '';
    SP.tests.run().forEach((r) => {
      const li = document.createElement('li');
      li.dataset.status = r.status;
      const mark = document.createElement('span');
      mark.className = 'mark';
      mark.textContent = r.status === 'pass' ? '✓' : r.status === 'fail' ? '✗' : '○';
      const text = document.createElement('span');
      const g = document.createElement('b');
      g.textContent = r.group;
      text.append(g, ' ' + r.name);
      if (r.note) {
        const em = document.createElement('em');
        em.textContent = r.note;
        text.appendChild(em);
      }
      li.append(mark, text);
      list.appendChild(li);
    });
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
            if (type === 0x90 && vel > 0) toggle(note, state.midiMode === 'latch' ? !state.active.has(note) : true);
            else if ((type === 0x80 || (type === 0x90 && vel === 0)) && state.midiMode === 'hold') toggle(note, false);
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
  update();
  drawCurve();
  runChecks();
  const ro = new ResizeObserver(() => { SP.views.spectrum($('spectrum'), last.base, last.shown); drawCurve(); });
  ro.observe($('spectrum'));
  ro.observe($('curve'));
})();
