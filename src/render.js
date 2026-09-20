/*
 * render.js: offline stimulus rendering (shell code)
 *
 * A trial plays a buffer that was synthesised before the run started, so every
 * presentation of a condition is the same samples, and nothing in the audio
 * path depends on the optimizer finishing in time.
 *
 * Synthesis is a direct sum of sines rather than Web Audio nodes, which keeps
 * a render reproducible across machines and browsers. Phases come from a
 * seeded generator, so coincident partials sum the same way every time.
 */
window.SP = window.SP || {};

SP.render = (function () {
  const DEFAULTS = { sampleRate: 48000, seconds: 3, fade: 0.03, phaseSeed: 1 };

  /** mulberry32, chosen because it repeats exactly across runs. */
  function seeded(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * The partials a condition asks for, as the instrument would sound them.
   * cond: { midis, partials, preset, brightness, consonance, mode, maxShift }
   */
  function partialsFor(cond) {
    const midis = [...cond.midis].sort((a, b) => a - b);
    const mode = cond.mode || 'off';
    const maxShift = typeof cond.maxShift === 'number' ? cond.maxShift : 0.45;
    const base = midis.map((m) => ({ midi: m, ...SP.timbre.base(m, cond.partials, cond.preset, cond.brightness / 100) }));

    let optimum = base.map((n) => n.freqs.slice());
    if (mode !== 'off' && base.length > 1 && SP.optimizer.implemented) {
      const input = base.map((n) => ({ midi: n.midi, f0: n.freqs[0], freqs: n.freqs.slice(), amps: n.amps.slice() }));
      optimum = SP.optimizer.optimize(input, { mode, maxShift, dissonance: SP.dissonance });
    }

    const c = (typeof cond.consonance === 'number' ? cond.consonance : 0) / 100;
    return base.map((n, k) => ({
      midi: n.midi,
      amps: n.amps,
      freqs: n.freqs.map((f, i) => f * Math.pow(optimum[k][i] / f, c)),
      baseFreqs: n.freqs.slice(),
    }));
  }

  /**
   * Render one condition to mono samples. Partial gains follow the instrument:
   * each note's partials sum to one, and the chord is divided by the square
   * root of the note count. Anything at or above 0.45 of the sample rate is
   * dropped rather than allowed to alias.
   */
  function renderChord(cond, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const fs = o.sampleRate;
    const n = Math.round(fs * (cond.seconds || o.seconds));
    const out = new Float32Array(n);
    const notes = partialsFor(cond);
    const rand = seeded(typeof cond.phaseSeed === 'number' ? cond.phaseSeed : o.phaseSeed);
    const voice = 1 / Math.sqrt(Math.max(1, notes.length));
    const laid = [];

    for (const note of notes) {
      const sum = note.amps.reduce((a, b) => a + b, 0) || 1;
      for (let i = 0; i < note.freqs.length; i++) {
        const f = note.freqs[i];
        const a = voice * note.amps[i] / sum;
        const phase = rand() * 2 * Math.PI;
        if (!(f > 0) || f >= fs * 0.45 || a <= 0) continue;
        const w = 2 * Math.PI * f / fs;
        for (let t = 0; t < n; t++) out[t] += a * Math.sin(w * t + phase);
        laid.push({ midi: note.midi, harmonic: i + 1, freq: f, amp: a, baseFreq: note.baseFreqs[i] });
      }
    }

    const fade = Math.max(1, Math.round((cond.fade || o.fade) * fs));
    for (let t = 0; t < fade; t++) {
      const w = 0.5 - 0.5 * Math.cos(Math.PI * t / fade);
      out[t] *= w;
      out[n - 1 - t] *= w;
    }

    return { samples: out, sampleRate: fs, partials: laid, notes };
  }

  /** Wrap samples for playback through an AudioContext. */
  function toBuffer(ctx, samples, fs) {
    const buf = ctx.createBuffer(1, samples.length, fs);
    buf.copyToChannel(samples, 0);
    return buf;
  }

  /** WAV bytes, for exporting a stimulus set or checking it in another tool. */
  function toWav(samples, fs) {
    const n = samples.length;
    const buf = new ArrayBuffer(44 + n * 2);
    const view = new DataView(buf);
    const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); view.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, fs, true); view.setUint32(28, fs * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    str(36, 'data'); view.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  return { renderChord, partialsFor, toBuffer, toWav, seeded, DEFAULTS };
})();
