/*
 * optimizer.js: overtone placement
 * ------------------------------------------------------------------
 * Finds the overtone positions that make the current chord as consonant as
 * possible. This is what plays when the Consonance knob is at 100%.
 * The app blends between the base sound and the result:
 *     shown = base * (optimum / base) ^ consonance
 * and the Glide knob controls how fast the sound moves to the new positions.
 *
 * Input
 *   notes:  [{ midi, f0, freqs: number[], amps: number[] }, ...]
 *           freqs[i] = (i + 1) * f0 for the base (harmonic) timbre.
 *   params: {
 *     mode: 'smooth' | 'fused',
 *     maxShift: 0.45,
 *        overtone i may sit anywhere in [(i + 1 - maxShift) * f0, (i + 1 + maxShift) * f0]
 *     dissonance: SP.dissonance
 *   }
 *
 * Output
 *   number[][]: one frequency list per note, same lengths as the input.
 *   freqs[0] stays exactly f0, overtones stay in order and inside their range,
 *   and in Smooth mode the result is never rougher than the input.
 *
 * Smooth mode is coordinate descent: one partial moves at a time, and its whole
 * range is searched rather than stepped through. Seen from a single partial the
 * objective is a row of narrow valleys, one centred on each partial of the other
 * notes, with cusped floors and flat ground between them, so a gradient step
 * either stalls on the flat ground or oscillates around a floor.
 *
 * Fused mode is a different objective and involves no search. Harmonicity and
 * roughness disagree in general, so Fused mode may score worse on
 * dissonance.total than the plain chord.
 */
window.SP = window.SP || {};

SP.optimizer = (function () {
  const MAX_SWEEPS = 8;        // coordinate-descent passes over every partial
  const TIME_BUDGET_MS = 60;   // no new sweep starts after this
  const MIN_GAIN = 1e-12;      // improvements below this are floating-point noise
  const POLISH_STEPS = 3;      // refinements around the winning grid point
  const FUSED_MAX_N1 = 40;     // largest denominator tried for the common fundamental
  const FUSED_TOL_CENTS = 20;  // accept the first F that fits every note this closely

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  /** A note's fundamental, falling back to its first partial. */
  function fundamental(note) {
    return typeof note.f0 === 'number' && note.f0 > 0 ? note.f0 : note.freqs[0];
  }

  /**
   * Every partial of every note except k, at its current position. These are the
   * only partials that the partials of note k can be rough against, since
   * dissonance.total counts pairs drawn from different notes. Their frequencies
   * are also where the valleys sit.
   */
  function foreignPartials(notes, out, k) {
    const freqs = [];
    const amps = [];
    for (let l = 0; l < notes.length; l++) {
      if (l === k) continue;
      for (let j = 0; j < out[l].length; j++) {
        freqs.push(out[l][j]);
        amps.push(notes[l].amps[j]);
      }
    }
    return { freqs, amps };
  }

  /** Roughness between one partial at x and all of the foreign partials. */
  function rowCost(x, amp, foreign, pair) {
    let sum = 0;
    for (let t = 0; t < foreign.freqs.length; t++) {
      sum += pair(x, amp, foreign.freqs[t], foreign.amps[t]);
    }
    return sum;
  }

  /**
   * Best position for one partial inside [lo, hi], everything else held fixed.
   * The row cost is smooth except for a kink at each foreign partial, so its
   * minimum is at a kink, at an end of the range, or at a smooth stationary
   * point between kinks. The candidate list covers the first two exactly and
   * the third by grid then refinement. Only strict improvements are taken,
   * which is what keeps the whole method monotone.
   */
  function searchPartial(current, amp, lo, hi, foreign, pair, grid) {
    const currentCost = rowCost(current, amp, foreign, pair);
    let bestX = current;
    let bestCost = currentCost;

    const consider = (x) => {
      const xx = x < lo ? lo : x > hi ? hi : x;
      const cost = rowCost(xx, amp, foreign, pair);
      if (cost < bestCost - MIN_GAIN) {
        bestCost = cost;
        bestX = xx;
      }
    };

    consider(lo);
    consider(hi);
    for (let t = 0; t < foreign.freqs.length; t++) {
      const f = foreign.freqs[t];
      if (f > lo && f < hi) consider(f);   // coincidence, the floor of a valley
    }
    const step = (hi - lo) / grid;
    for (let g = 1; g < grid; g++) consider(lo + g * step);

    let delta = step;
    for (let r = 0; r < POLISH_STEPS; r++) {
      delta /= 3;
      consider(bestX - delta);
      consider(bestX + delta);
    }

    return { x: bestX, gain: currentCost - bestCost };
  }

  /**
   * One pass over every overtone of every note. Partials of the same note never
   * interact here, so one snapshot of the other notes serves for all of note k,
   * and the drop in the objective is exactly the sum of the row drops.
   */
  function sweep(notes, out, maxShift, pair, grid) {
    let gain = 0;
    for (let k = 0; k < notes.length; k++) {
      const foreign = foreignPartials(notes, out, k);
      const f0 = fundamental(notes[k]);
      for (let i = 1; i < out[k].length; i++) {
        const lo = (i + 1 - maxShift) * f0;
        const hi = (i + 1 + maxShift) * f0;
        const found = searchPartial(out[k][i], notes[k].amps[i], lo, hi, foreign, pair, grid);
        if (found.gain > MIN_GAIN) {
          out[k][i] = found.x;
          gain += found.gain;
        }
      }
    }
    return gain;
  }

  /** Sweep until a pass stops paying for itself, or the time budget runs out. */
  function smooth(notes, out, maxShift, D) {
    const pair = (f1, a1, f2, a2) => D.pair(f1, a1, f2, a2);
    let partials = 0;
    for (let k = 0; k < notes.length; k++) partials += out[k].length;
    // Finer search for small chords, coarser for large ones, to hold the budget.
    const grid = Math.max(12, Math.min(40, Math.round(960 / partials)));

    const started = now();
    for (let s = 0; s < MAX_SWEEPS; s++) {
      if (sweep(notes, out, maxShift, pair, grid) <= MIN_GAIN) break;
      if (now() - started > TIME_BUDGET_MS) break;
    }
    return out;
  }

  /**
   * Fused mode. Approximate the chord's fundamentals as small integer multiples
   * n_k of one common fundamental F, then put harmonic n of note k on that
   * note's own sub-series, at n * n_k * F. Every partial in the chord then lies
   * on one harmonic series. The fundamentals stay in 12-TET, so each note ends
   * up a few cents away from its own overtones.
   */
  /**
   * Smallest n1 whose series holds every interval in the chord, scored on the
   * error of the intervals between notes rather than the error of each note
   * against the lowest one. Two notes each 15 cents off in opposite directions
   * are 30 cents apart, and a mistuned interval is what a listener hears: its
   * partials, which used to nearly coincide, end up one step of the series
   * apart and beat at F Hz.
   */
  function fusedSeries(f0s) {
    const lowest = Math.min.apply(null, f0s);
    let best = null;
    for (let n1 = 1; n1 <= FUSED_MAX_N1; n1++) {
      const ints = f0s.map((f) => Math.max(1, Math.round(n1 * f / lowest)));
      let worst = 0;
      for (let k = 0; k < f0s.length; k++) {
        for (let l = k + 1; l < f0s.length; l++) {
          const err = Math.abs(1200 * Math.log2((ints[l] / ints[k]) / (f0s[l] / f0s[k])));
          if (err > worst) worst = err;
        }
      }
      if (!best || worst < best.worst) best = { n1, ints, worst };
      if (worst <= FUSED_TOL_CENTS) break;
    }
    return { n1: best.n1, ints: best.ints, worst: best.worst, F: lowest / best.n1 };
  }

  function fused(notes, out, maxShift) {
    const f0s = notes.map(fundamental);
    const series = fusedSeries(f0s);
    const F = series.F;
    api.lastSeries = { integers: series.ints.slice(), F, worstCents: series.worst };

    for (let k = 0; k < notes.length; k++) {
      const f0 = f0s[k];
      const nk = series.ints[k];
      for (let i = 1; i < out[k].length; i++) {
        const lo = (i + 1 - maxShift) * f0;
        const hi = (i + 1 + maxShift) * f0;
        const target = (i + 1) * nk * F;
        out[k][i] = target < lo ? lo : target > hi ? hi : target;
      }
    }
    return out;
  }

  function optimize(notes, params) {
    const out = notes.map((n) => n.freqs.slice());
    const opts = params || {};
    const maxShift = typeof opts.maxShift === 'number' ? opts.maxShift : 0.45;
    const D = opts.dissonance || SP.dissonance;
    api.lastSeries = null;

    // A lone note has nothing to be rough against, and no dissonance function
    // means no objective to descend.
    if (notes.length < 2) return out;
    if (opts.mode === 'fused') return fused(notes, out, maxShift);
    if (!D || !D.implemented) return out;

    smooth(notes, out, maxShift, D);

    // Coordinate descent only accepts improvements, so this should never fire.
    // It is here because the contract is a promise about the returned chord.
    const before = D.total(notes.map((n) => ({ freqs: n.freqs, amps: n.amps })));
    const after = D.total(out.map((freqs, k) => ({ freqs, amps: notes[k].amps })));
    if (!(after <= before)) return notes.map((n) => n.freqs.slice());

    return out;
  }

  // lastSeries carries the Fused solution back to the app for display:
  // { integers, F, worstCents }, or null after a Smooth run.
  const api = { implemented: true, optimize, lastSeries: null };
  return api;
})();
