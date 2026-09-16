/*
 * timbre.js: base sounds (shell code)
 * Each preset is a harmonic spectrum shape; Brightness tilts it.
 */
window.SP = window.SP || {};

SP.timbre = {
  presets: {
    organ:  { label: 'Organ',  shape: (n) => ([1, 2, 4, 8].includes(n) ? 1 : [3, 6].includes(n) ? 0.75 : 0.35) },
    reed:   { label: 'Reed',   shape: (n) => (n % 2 ? 1 : 0.3) },
    saw:    { label: 'Saw',    shape: () => 1 },
    flute:  { label: 'Flute',  shape: (n) => (n === 1 ? 1 : n === 2 ? 0.45 : 0.18) },
  },

  midiToHz(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  },

  /** brightness 0..1: 0 = dark (steep rolloff), 1 = bright (almost flat). */
  amps(presetKey, count, brightness) {
    const preset = this.presets[presetKey] || this.presets.organ;
    const tilt = 2.2 - 2.0 * brightness;
    const raw = [];
    for (let n = 1; n <= count; n++) raw.push(preset.shape(n) * Math.pow(n, -tilt));
    const max = Math.max(...raw);
    return raw.map((a) => a / max);
  },

  /** Harmonic note in 12-TET: { freqs, amps }. */
  base(midi, count, presetKey, brightness) {
    const f0 = this.midiToHz(midi);
    const freqs = [];
    for (let n = 1; n <= count; n++) freqs.push(n * f0);
    return { freqs, amps: this.amps(presetKey, count, brightness) };
  },
};
