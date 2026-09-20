/*
 * analysis.js: measurement of rendered stimuli (shell code)
 *
 * Two jobs, both of which use tools from ECE 401:
 *   verifyPartials  windowed spectrum, peak picking, and a comparison against
 *                   the frequencies the optimizer asked for (weeks 8 and 9)
 *   beats           short-time energy, then the rate of its slowest strong
 *                   fluctuation (week 10)
 *
 * verifyPartials is a check on the synthesis, and beats gives a measurement
 * of the slow beating between 12-TET fifths.
 */
window.SP = window.SP || {};

SP.analysis = (function () {
  /** In-place iterative radix-2 FFT on split real and imaginary arrays. */
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const ur = re[i + k], ui = im[i + k];
          const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
          const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k] = ur + vr; im[i + k] = ui + vi;
          re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
          const nr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = nr;
        }
      }
    }
  }

  function hann(n) {
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
    return w;
  }

  const nextPow2 = (n) => Math.pow(2, Math.ceil(Math.log2(n)));

  /**
   * Magnitude spectrum of one Hann-windowed frame taken from the middle of the
   * signal. A 2^16 frame at 48 kHz is 1.37 s long, which resolves partials
   * about 1 Hz apart.
   */
  function spectrum(samples, fs, opts) {
    const o = opts || {};
    const size = Math.min(nextPow2(o.size || 131072), nextPow2(samples.length));
    const start = Math.max(0, Math.floor((samples.length - size) / 2));
    const w = hann(size);
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    for (let i = 0; i < size; i++) re[i] = (samples[start + i] || 0) * w[i];
    fft(re, im);
    const half = size / 2;
    const mag = new Float64Array(half);
    for (let i = 0; i < half; i++) mag[i] = Math.hypot(re[i], im[i]) * 2 / size;
    return { mag, binHz: fs / size, size };
  }

  /**
   * Peaks of a magnitude spectrum, with a parabolic fit across the three bins
   * around each maximum so the estimate beats the bin spacing.
   */
  function peaks(spec, opts) {
    const o = opts || {};
    const floor = (o.floor || 0.001) * Math.max.apply(null, Array.from(spec.mag));
    const found = [];
    for (let i = 1; i < spec.mag.length - 1; i++) {
      const y1 = spec.mag[i - 1], y2 = spec.mag[i], y3 = spec.mag[i + 1];
      if (y2 <= y1 || y2 < y3 || y2 < floor) continue;
      const denom = y1 - 2 * y2 + y3;
      const delta = denom === 0 ? 0 : 0.5 * (y1 - y3) / denom;
      found.push({ freq: (i + delta) * spec.binHz, amp: y2 - 0.25 * (y1 - y3) * delta });
    }
    return found.sort((a, b) => b.amp - a.amp).slice(0, o.limit || 200).sort((a, b) => a.freq - b.freq);
  }

  /**
   * Compare what was rendered against what was asked for. Each expected
   * partial is matched to the nearest peak, and reported with its error in
   * cents. `tolCents` decides what counts as found.
   */
  function verifyPartials(samples, fs, expected, opts) {
    const o = opts || {};
    const tol = o.tolCents || 10;
    const spec = spectrum(samples, fs, o);
    const found = peaks(spec, o);
    const rows = expected.map((p) => {
      let best = null, bestErr = Infinity;
      for (const q of found) {
        const err = Math.abs(1200 * Math.log2(q.freq / p.freq));
        if (err < bestErr) { bestErr = err; best = q; }
      }
      return { expected: p.freq, measured: best ? best.freq : null, cents: best ? bestErr : null, ok: !!best && bestErr <= tol };
    });
    return {
      rows,
      binHz: spec.binHz,
      matched: rows.filter((r) => r.ok).length,
      total: rows.length,
      worstCents: rows.reduce((a, r) => Math.max(a, r.cents === null ? Infinity : r.cents), 0),
      peaksFound: found.length,
    };
  }

  /** Short-time energy in dB, one value per hop. */
  function shortTimeEnergy(samples, fs, opts) {
    const o = opts || {};
    const frame = Math.round((o.frameMs || 10) / 1000 * fs);
    const hop = Math.round((o.hopMs || 2.5) / 1000 * fs);
    const out = [];
    for (let start = 0; start + frame <= samples.length; start += hop) {
      let sum = 0;
      for (let i = start; i < start + frame; i++) sum += samples[i] * samples[i];
      out.push(10 * Math.log10(sum / frame + 1e-20));
    }
    return { db: out, rate: fs / hop, frameMs: o.frameMs || 10, hopMs: o.hopMs || 2.5 };
  }

  /**
   * Rate of the strongest fluctuation of the energy envelope, searched between
   * `minHz` and `maxHz`. The envelope is detrended and windowed, so what comes
   * back is modulation rate rather than overall level.
   */
  function beats(samples, fs, opts) {
    const o = opts || {};
    const env = shortTimeEnergy(samples, fs, o);
    // Trim both ends, since the fades are level changes rather than beating.
    const skip = Math.round(env.rate * (o.skipS || 0.15));
    const x = env.db.slice(skip, Math.max(skip, env.db.length - skip));
    if (x.length < 16) return { rateHz: null, depthDb: 0, envelope: env };
    const mean = x.reduce((a, b) => a + b, 0) / x.length;
    const size = nextPow2(x.length);
    const w = hann(x.length);
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    for (let i = 0; i < x.length; i++) re[i] = (x[i] - mean) * w[i];
    fft(re, im);
    const binHz = env.rate / size;
    // ceil, so a coarse envelope spectrum never reports a rate below minHz
    const lo = Math.max(1, Math.ceil((o.minHz || 0.3) / binHz));
    const hi = Math.min(size / 2 - 1, Math.ceil((o.maxHz || 40) / binHz));
    if (lo > hi) return { rateHz: null, periodS: null, depthDb: 0, envelope: env };
    let best = lo, bestMag = -1;
    for (let i = lo; i <= hi; i++) {
      const m = Math.hypot(re[i], im[i]);
      if (m > bestMag) { bestMag = m; best = i; }
    }
    const sorted = [...x].sort((a, b) => a - b);
    const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    return {
      rateHz: best * binHz,
      periodS: 1 / (best * binHz),
      depthDb: pct(0.95) - pct(0.05),
      envelope: env,
    };
  }

  return { spectrum, peaks, verifyPartials, shortTimeEnergy, beats, fft };
})();
