/*
 * dissonance.js: YOURS TO WRITE
 * ------------------------------------------------------------------
 * The app calls these two functions. Replace the bodies, then set
 * `implemented: true`. Open "Checks" in the app to test your work.
 *
 * Background reading:
 *   - Plomp & Levelt (1965), "Tonal consonance and critical bandwidth", JASA.
 *   - Sethares, "Tuning, Timbre, Spectrum, Scale" (Springer). The appendix
 *     gives a closed-form curve fit to Plomp & Levelt's data.
 *
 * Conventions used everywhere in the app:
 *   frequencies in Hz, amplitudes linear (the loudest partial of a note is 1).
 *   A "note" is { freqs: number[], amps: number[] } with freqs[0] = fundamental.
 */
window.SP = window.SP || {};

SP.dissonance = {
  // Flip to true once pair() and total() are real.
  implemented: false,

  /**
   * Roughness of two sine partials sounding together.
   * Must be: >= 0, symmetric in its arguments, ~0 when f1 === f2,
   * peak at a small separation, fade when the partials are far apart,
   * and grow with amplitude.
   */
  pair(f1, a1, f2, a2) {
    return 0; // TODO
  },

  /**
   * Total roughness of a set of notes: sum of pair() over pairs of partials.
   * opts.interNoteOnly (default true): count only pairs whose partials belong
   * to DIFFERENT notes, so a single note on its own scores 0 and keeps its
   * base timbre.
   */
  total(notes, opts = {}) {
    const interNoteOnly = opts.interNoteOnly !== false;
    return 0; // TODO
  },
};
