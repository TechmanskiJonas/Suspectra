/*
 * dissonance.js: sensory roughness
 * ------------------------------------------------------------------
 * pair() is Sethares's curve fit to the Plomp & Levelt consonance data, with
 * Vassilakis's amplitude weighting. total() sums it over pairs of partials.
 *
 * References:
 *   - Plomp & Levelt (1965), "Tonal consonance and critical bandwidth", JASA.
 *   - Sethares (1993), "Local consonance and the relationship between timbre
 *     and scale", JASA; and "Tuning, Timbre, Spectrum, Scale" (Springer).
 *   - Vassilakis (2001), "Perceptual and physical properties of amplitude
 *     fluctuation and their musical significance", dissertation, UCLA.
 *
 * Conventions used everywhere in the app:
 *   frequencies in Hz, amplitudes linear (the loudest partial of a note is 1).
 *   A "note" is { freqs: number[], amps: number[] } with freqs[0] = fundamental.
 */
window.SP = window.SP || {};

SP.dissonance = {
  // app.js and tests.js check this before using the functions below.
  implemented: true,

  /**
   * Roughness of two sine partials sounding together, in arbitrary units.
   * Symmetric and never negative. Zero at unison, largest when the partials
   * are about a quarter of a critical bandwidth apart, and negligible once
   * they are more than one critical bandwidth apart.
   */
  pair(f1, a1, f2, a2) {
    //A silent partial is never rough. Also keeps 0/0 out of the amplitude term below.
    if (a1 <= 0 || a2 <= 0) return 0;

    //Sethares' formula for roughness of two sine waves, based on Plomp & Levelt (1965).
    const delta = Math.abs(f1 - f2);
    const f_min = Math.min(f1, f2);
    const s = 0.24 / (0.0207 * f_min + 18.96);
    const x = s * delta;
    const g = Math.exp(-3.5 * x) - Math.exp(-5.75 * x);

    //Vassilakis' formula for amplitude scaling
    const a_vas = 0.5 * (a1 * a2) ** 0.1 * ((2 * Math.min(a1, a2))/(a1 + a2)) ** 3.11;
    return g * a_vas;
  },

  /**
   * Total roughness of a set of notes: sum of pair() over pairs of partials.
   * opts.interNoteOnly (default true): count only pairs whose partials belong
   * to DIFFERENT notes, so a single note on its own scores 0 and keeps its
   * base timbre.
   */
  total(notes, opts = {}) {
    const interNoteOnly = opts.interNoteOnly !== false;
    let count = 0;
    for (let k = 0; k < notes.length; k++) {
      for (let l = k + 1; l < notes.length; l++) {
        for (let i = 0; i < notes[k].freqs.length; i++) {
          for (let j = 0; j < notes[l].freqs.length; j++) {
            count += this.pair(
              notes[k].freqs[i], notes[k].amps[i],
              notes[l].freqs[j], notes[l].amps[j]
            );
          }
        }
      }
    }

    if (!interNoteOnly) {
      for (let k = 0; k < notes.length; k++) {
        for (let i = 0; i < notes[k].freqs.length; i++) {
          for (let j = i + 1; j < notes[k].freqs.length; j++) {
            count += this.pair(
              notes[k].freqs[i], notes[k].amps[i],
              notes[k].freqs[j], notes[k].amps[j]
            );
          }
        }
      }
    }

    return count;
  },
};
