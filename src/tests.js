/*
 * tests.js: contract checks for your two modules (shell code)
 * Each check returns true, or a string explaining what went wrong.
 * Checks for a module you haven't written yet show as "waiting".
 */
window.SP = window.SP || {};

SP.tests = {
  run() {
    const D = SP.dissonance;
    const O = SP.optimizer;
    const results = [];

    const check = (group, name, ready, fn) => {
      if (!ready) return results.push({ group, name, status: 'waiting', note: '' });
      try {
        const r = fn();
        results.push({ group, name, status: r === true ? 'pass' : 'fail', note: r === true ? '' : String(r) });
      } catch (e) {
        results.push({ group, name, status: 'fail', note: e.message });
      }
    };

    const d = D.implemented;
    check('dissonance', 'Identical sines have no roughness', d, () => Math.abs(D.pair(440, 1, 440, 1)) < 1e-6 || `got ${D.pair(440, 1, 440, 1)}`);
    check('dissonance', 'pair() is symmetric', d, () => Math.abs(D.pair(440, 1, 470, 0.5) - D.pair(470, 0.5, 440, 1)) < 1e-9 || 'pair(a, b) differs from pair(b, a)');
    check('dissonance', 'Roughness is never negative', d, () => {
      for (let df = 0; df <= 600; df += 5) if (D.pair(300, 1, 300 + df, 1) < -1e-9) return `negative at ${df} Hz apart`;
      return true;
    });
    check('dissonance', 'Roughness peaks at a small separation (10–60 Hz apart near 440 Hz)', d, () => {
      let best = 0, at = 0;
      for (let df = 1; df <= 300; df++) {
        const v = D.pair(440, 1, 440 + df, 1);
        if (v > best) { best = v; at = df; }
      }
      return (best > 0 && at >= 10 && at <= 60) || `peak at ${at} Hz apart`;
    });
    check('dissonance', 'Roughness fades an octave apart (<10% of peak)', d, () => {
      let peak = 0;
      for (let df = 1; df <= 300; df++) peak = Math.max(peak, D.pair(440, 1, 440 + df, 1));
      const far = D.pair(440, 1, 880, 1);
      return (peak > 0 && far < 0.1 * peak) || `an octave apart is ${Math.round((far / peak) * 100)}% of peak`;
    });
    check('dissonance', 'Louder partials are rougher', d, () => D.pair(440, 1, 465, 1) > D.pair(440, 0.3, 465, 0.3) || 'amplitude has no effect');
    check('dissonance', 'A single note scores 0 (between-notes only)', d, () => {
      const v = D.total([SP.timbre.base(60, 8, 'saw', 0.6)], { interNoteOnly: true });
      return Math.abs(v) < 1e-9 || `got ${v}`;
    });
    check('dissonance', 'A fifth (3:2) is smoother than a tritone', d, () => {
      const a = SP.timbre.base(60, 8, 'saw', 0.6);
      const up = (r) => ({ freqs: a.freqs.map((f) => f * r), amps: a.amps });
      const fifth = D.total([a, up(1.5)]);
      const tritone = D.total([a, up(Math.SQRT2)]);
      return fifth < tritone || `fifth ${fifth.toFixed(3)} vs tritone ${tritone.toFixed(3)}`;
    });

    const o = O.implemented;
    const chord = [60, 64, 67].map((m) => {
      const b = SP.timbre.base(m, 8, 'organ', 0.6);
      return { midi: m, f0: b.freqs[0], freqs: b.freqs, amps: b.amps };
    });
    let out = null;
    const params = { mode: 'smooth', maxShift: 0.45, dissonance: D };
    check('optimizer', 'Returns one frequency list per note, same lengths', o, () => {
      out = O.optimize(chord.map((n) => ({ ...n, freqs: n.freqs.slice() })), params);
      return (Array.isArray(out) && out.length === chord.length && out.every((f, k) => f.length === chord[k].freqs.length)) || 'shape does not match the input';
    });
    check('optimizer', 'Fundamentals do not move', o, () => (out && out.every((f, k) => Math.abs(f[0] - chord[k].f0) < 1e-6)) || 'a fundamental moved');
    check('optimizer', 'Overtones stay in order', o, () => (out && out.every((f) => f.every((v, i) => i === 0 || v > f[i - 1]))) || 'two overtones crossed');
    check('optimizer', 'Overtones stay inside maxShift', o, () =>
      (out && out.every((f, k) => f.every((v, i) => Math.abs(v / chord[k].f0 - (i + 1)) <= params.maxShift + 1e-9))) || 'an overtone moved past maxShift');
    check('optimizer', 'Result is no rougher than the plain chord', o && d, () => {
      const before = D.total(chord);
      const after = D.total(chord.map((n, k) => ({ freqs: out[k], amps: n.amps })));
      return after <= before + 1e-9 || `rougher: ${before.toFixed(3)} → ${after.toFixed(3)}`;
    });

    return results;
  },
};
