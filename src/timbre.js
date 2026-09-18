/*
 * timbre.js: base sounds (shell code)
 * Each preset shapes a harmonic spectrum; Brightness tilts the whole thing.
 * A shape is a function of the harmonic number, and of the partial's frequency
 * for the presets built out of fixed formants.
 */
window.SP = window.SP || {};

SP.timbre = (function () {
  /** Sum of resonances at fixed frequencies, which is how vowels keep their
   *  colour as the pitch changes. Each entry is [centre Hz, half-width Hz]. */
  function formants(hz, peaks) {
    let v = 0.04;
    for (let i = 0; i < peaks.length; i++) {
      const d = (hz - peaks[i][0]) / peaks[i][1];
      v += 1 / (1 + d * d);
    }
    return v;
  }

  const presets = {
    organ:    { label: 'Organ',     shape: (n) => ([1, 2, 4, 8].includes(n) ? 1 : [3, 6].includes(n) ? 0.75 : 0.35) },
    reed:     { label: 'Reed',      shape: (n) => (n % 2 ? 1 : 0.3) },
    saw:      { label: 'Saw',       shape: () => 1 },
    square:   { label: 'Square',    shape: (n) => (n % 2 ? 1 : 0) },
    clarinet: { label: 'Clarinet',  shape: (n) => (n % 2 ? (n > 7 ? 0.4 : 1) : 0.12) },
    brass:    { label: 'Brass',     shape: (n) => Math.exp(-((n - 4) * (n - 4)) / 16) + 0.25 },
    strings:  { label: 'Strings',   shape: (n) => ([1, 0.85, 0.95, 0.6, 0.75, 0.5, 0.45, 0.4][n - 1] || 0.3) },
    flute:    { label: 'Flute',     shape: (n) => (n === 1 ? 1 : n === 2 ? 0.45 : 0.18) },
    voiceAh:  { label: 'Voice "ah"', shape: (n, hz) => formants(hz, [[730, 90], [1090, 110], [2440, 160]]) },
    voiceOo:  { label: 'Voice "oo"', shape: (n, hz) => formants(hz, [[300, 60], [870, 90], [2240, 160]]) },
    glass:    { label: 'Glass',     shape: (n) => ([1, 3, 5, 9].includes(n) ? 1 : n % 2 ? 0.3 : 0.05) },
  };

  function midiToHz(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  /** brightness 0..1: 0 = dark (steep rolloff), 1 = bright (almost flat). */
  function amps(presetKey, count, brightness, f0) {
    const preset = presets[presetKey] || presets.organ;
    const tilt = 2.2 - 2.0 * brightness;
    const raw = [];
    for (let n = 1; n <= count; n++) raw.push(preset.shape(n, n * f0) * Math.pow(n, -tilt));
    const max = Math.max.apply(null, raw);
    return raw.map((a) => (max > 0 ? a / max : 0));
  }

  /** Harmonic note in 12-TET: { freqs, amps }. */
  function base(midi, count, presetKey, brightness) {
    const f0 = midiToHz(midi);
    const freqs = [];
    for (let n = 1; n <= count; n++) freqs.push(n * f0);
    return { freqs, amps: amps(presetKey, count, brightness, f0) };
  }

  return { presets, midiToHz, amps, base };
})();
