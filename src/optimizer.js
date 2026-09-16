/*
 * optimizer.js: YOURS TO WRITE
 * ------------------------------------------------------------------
 * Finds the overtone positions that make the current chord as consonant as
 * possible. This is what plays when the Consonance knob is at 100%.
 * The app blends between the base sound and your result:
 *     shown = base * (optimum / base) ^ consonance
 * and the Glide knob controls how fast the sound moves to the new positions.
 *
 * Input
 *   notes:  [{ midi, f0, freqs: number[], amps: number[] }, ...]
 *           freqs[i] = (i + 1) * f0 for the base (harmonic) timbre.
 *   params: {
 *     mode: 'smooth' | 'fused',
 *        smooth = minimize roughness (dissonance.total)
 *        fused  = pull every partial onto one shared harmonic series
 *     maxShift: 0.45,
 *        overtone i may sit anywhere in [(i + 1 - maxShift) * f0, (i + 1 + maxShift) * f0],
 *        which keeps overtones in order
 *     dissonance: SP.dissonance
 *   }
 *
 * Output
 *   number[][]: one frequency list per note, same lengths as the input.
 *   Rules (checked in the app): freqs[0] stays exactly f0; overtones stay in
 *   order and inside their maxShift range; the result is never rougher than
 *   the input chord.
 *
 * Notes
 *   - Runs every time a note turns on or off. Aim for well under 100 ms.
 *     If it gets slow, move it into a Web Worker.
 *   - The dissonance landscape has many local minima. A plain gradient step
 *     from the harmonic positions barely moves (try it and see).
 */
window.SP = window.SP || {};

SP.optimizer = {
  implemented: false,

  optimize(notes, params) {
    // Placeholder: return the input unchanged.
    return notes.map((n) => n.freqs.slice()); // TODO
  },
};
