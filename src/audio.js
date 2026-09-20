/*
 * audio.js: additive synth engine (shell code)
 * One sine oscillator per partial per note. Glide uses setTargetAtTime.
 */
window.SP = window.SP || {};

SP.audio = (function () {
  let ctx = null;
  let master = null;
  let volume = 0.6;
  const voices = new Map(); // midi -> { out, oscs[], gains[] }

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(comp);
      comp.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function running() {
    return !!ctx && ctx.state === 'running';
  }

  function makeVoice(count) {
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(master);
    const oscs = [];
    const gains = [];
    for (let i = 0; i < count; i++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const g = ctx.createGain();
      g.gain.value = 0;
      o.connect(g);
      g.connect(out);
      o.start();
      oscs.push(o);
      gains.push(g);
    }
    return { out, oscs, gains };
  }

  function release(v) {
    const t = ctx.currentTime;
    v.out.gain.cancelScheduledValues(t);
    v.out.gain.setTargetAtTime(0, t, 0.06);
    setTimeout(() => {
      v.oscs.forEach((o) => o.stop());
      v.out.disconnect();
    }, 700);
  }

  /** notes: [{ midi, freqs, amps }], glideSec >= 0 */
  function render(notes, glideSec) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const nyquist = ctx.sampleRate / 2;
    const byMidi = new Map(notes.map((n) => [n.midi, n]));

    for (const [midi, v] of voices) {
      const n = byMidi.get(midi);
      if (!n || n.freqs.length !== v.oscs.length) {
        release(v);
        voices.delete(midi);
      }
    }

    const level = 0.5 / Math.sqrt(Math.max(1, notes.length));
    for (const note of notes) {
      let v = voices.get(note.midi);
      const fresh = !v;
      if (fresh) {
        v = makeVoice(note.freqs.length);
        voices.set(note.midi, v);
      }
      const sum = note.amps.reduce((a, b) => a + b, 0) || 1;
      note.freqs.forEach((f, i) => {
        const p = v.oscs[i].frequency;
        p.cancelScheduledValues(t);
        if (fresh || glideSec <= 0.001) {
          p.setValueAtTime(f, t);
        } else {
          p.setValueAtTime(p.value, t);
          p.setTargetAtTime(f, t, glideSec / 4); // ~98% there after glideSec
        }
        // Partials at or above Nyquist would alias: silence them.
        const a = f < nyquist * 0.95 ? note.amps[i] / sum : 0;
        v.gains[i].gain.setTargetAtTime(a, t, 0.02);
      });
      v.out.gain.cancelScheduledValues(t);
      v.out.gain.setTargetAtTime(level, t, fresh ? 0.012 : 0.05);
    }
  }

  /** Suspend the context, used when the listening test takes over. */
  function suspend() {
    if (ctx && ctx.state === 'running') ctx.suspend();
  }

  function setVolume(x) {
    volume = x;
    if (master) master.gain.setTargetAtTime(x, ctx.currentTime, 0.03);
  }

  return { ensure, running, render, setVolume, suspend };
})();
