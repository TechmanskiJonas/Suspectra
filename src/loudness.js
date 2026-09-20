/*
 * loudness.js: ITU-R BS.1770-4 integrated loudness (shell code)
 *
 * Stimuli that differ in level are compared on level, so a listening test
 * requires them matched.
 *
 * K-weighting is two biquads, a high shelf and a high pass, with the constants
 * from the recommendation. Loudness is the gated mean square of the weighted
 * signal: 400 ms blocks at 75% overlap, an absolute gate at -70 LUFS, then a
 * relative gate 10 LU below the mean of what survived.
 *
 * Channel weights are 1.0 per channel, so a mono signal reads about 3 LU below
 * the same signal carried on two channels. Matching is relative, so a constant
 * offset does not matter as long as every stimulus is measured the same way.
 */
window.SP = window.SP || {};

SP.loudness = (function () {
  const SHELF = { f0: 1681.974450955533, G: 3.999843853973347, Q: 0.7071752369554196 };
  const HPF = { f0: 38.13547087602444, Q: 0.5003270373238773 };

  /** RBJ high shelf, normalised so a0 = 1. */
  function highShelf(fs) {
    const A = Math.pow(10, SHELF.G / 40);
    const w0 = 2 * Math.PI * SHELF.f0 / fs;
    const c = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * SHELF.Q);
    const s = 2 * Math.sqrt(A) * alpha;
    const a0 = (A + 1) - (A - 1) * c + s;
    return {
      b0: A * ((A + 1) + (A - 1) * c + s) / a0,
      b1: -2 * A * ((A - 1) + (A + 1) * c) / a0,
      b2: A * ((A + 1) + (A - 1) * c - s) / a0,
      a1: 2 * ((A - 1) - (A + 1) * c) / a0,
      a2: ((A + 1) - (A - 1) * c - s) / a0,
    };
  }

  /** RBJ high pass, normalised so a0 = 1. */
  function highPass(fs) {
    const w0 = 2 * Math.PI * HPF.f0 / fs;
    const c = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * HPF.Q);
    const a0 = 1 + alpha;
    return {
      b0: (1 + c) / 2 / a0,
      b1: -(1 + c) / a0,
      b2: (1 + c) / 2 / a0,
      a1: -2 * c / a0,
      a2: (1 - alpha) / a0,
    };
  }

  function biquad(x, f) {
    const y = new Float32Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let n = 0; n < x.length; n++) {
      const v = f.b0 * x[n] + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
      x2 = x1; x1 = x[n];
      y2 = y1; y1 = v;
      y[n] = v;
    }
    return y;
  }

  /** K-weighted copy of one channel. */
  function kWeight(samples, fs) {
    return biquad(biquad(samples, highShelf(fs)), highPass(fs));
  }

  /**
   * Integrated loudness in LUFS. `channels` is one Float32Array or an array of
   * them. Signals shorter than one 400 ms block fall back to an ungated
   * measurement, which is what short stimuli need.
   */
  function integrated(channels, fs) {
    const chans = (channels instanceof Float32Array ? [channels] : channels).map((c) => kWeight(c, fs));
    const block = Math.round(0.4 * fs);
    const step = Math.round(0.1 * fs);
    const n = chans[0].length;

    const meanSquare = (from, to) => chans.map((c) => {
      let sum = 0;
      for (let i = from; i < to; i++) sum += c[i] * c[i];
      return sum / (to - from);
    });

    const level = (z) => -0.691 + 10 * Math.log10(z.reduce((a, b) => a + b, 0) || 1e-30);

    if (n < block) return level(meanSquare(0, n));

    const blocks = [];
    for (let start = 0; start + block <= n; start += step) blocks.push(meanSquare(start, start + block));

    const loud = blocks.map(level);
    const abs = blocks.filter((_, i) => loud[i] > -70);
    if (!abs.length) return -Infinity;

    const mean = (list) => list[0].map((_, ch) => list.reduce((a, b) => a + b[ch], 0) / list.length);
    const relGate = level(mean(abs)) - 10;
    const kept = abs.filter((_, i) => level(abs[i]) > relGate);
    return level(mean(kept.length ? kept : abs));
  }

  /** Peak sample as dBFS, to catch a match that would clip. */
  function peakDbfs(channels) {
    const chans = channels instanceof Float32Array ? [channels] : channels;
    let peak = 0;
    for (const c of chans) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]));
    return 20 * Math.log10(peak || 1e-30);
  }

  /**
   * Scale a signal to a target loudness, in place on a copy. Returns the new
   * samples, the measured loudness before and after, the gain applied, and
   * whether the gain had to be held back to keep the peak under `ceilingDb`.
   */
  function normalize(samples, fs, targetLufs, ceilingDb) {
    const ceiling = typeof ceilingDb === 'number' ? ceilingDb : -1;
    const before = integrated(samples, fs);
    let gainDb = targetLufs - before;
    const headroom = ceiling - peakDbfs(samples);
    const limited = gainDb > headroom;
    if (limited) gainDb = headroom;
    const gain = Math.pow(10, gainDb / 20);
    const out = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) out[i] = samples[i] * gain;
    return { samples: out, before, after: integrated(out, fs), gainDb, limited, peakDbfs: peakDbfs(out) };
  }

  return { integrated, peakDbfs, normalize, kWeight };
})();
