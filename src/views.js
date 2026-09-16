/*
 * views.js: canvas drawing (shell code)
 */
window.SP = window.SP || {};

SP.views = (function () {
  const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  const FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5]; // circle-of-fifths order

  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function noteName(midi) {
    return NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
  }

  /** Neighbouring keys on the circle of fifths get neighbouring hues. */
  function noteColor(midi) {
    const pos = FIFTHS.indexOf(((midi % 12) + 12) % 12);
    return `hsl(${(pos * 30 + 15) % 360} ${cssVar('--note-s') || '42%'} ${cssVar('--note-l') || '66%'})`;
  }

  function prep(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, r.width, r.height);
    return { c, w: r.width, h: r.height };
  }

  const font = (size, family) => `${size}px ${cssVar(family)}`;

  /** base, shown: [{ midi, freqs, amps }] in the same order. */
  function spectrum(canvas, base, shown) {
    const { c, w, h } = prep(canvas);
    const L = 34, R = 10, T = 12, B = 24;
    const fmin = 60, fmax = 8000;
    const x = (f) => L + (Math.log(f / fmin) / Math.log(fmax / fmin)) * (w - L - R);
    const y = (a) => {
      const db = 20 * Math.log10(Math.max(a, 1e-4));
      return h - B - Math.max(0, 1 + db / 48) * (h - B - T);
    };

    c.font = font(11, '--mono');
    c.lineWidth = 1;
    c.strokeStyle = cssVar('--grid');
    c.fillStyle = cssVar('--ink-3');
    c.textAlign = 'center';
    [100, 200, 500, 1000, 2000, 5000].forEach((f) => {
      const X = x(f);
      c.beginPath(); c.moveTo(X, T); c.lineTo(X, h - B); c.stroke();
      c.fillText(f >= 1000 ? f / 1000 + 'k' : String(f), X, h - 7);
    });
    [0, -24].forEach((db) => {
      const Y = y(Math.pow(10, db / 20));
      c.beginPath(); c.moveTo(L, Y); c.lineTo(w - R, Y); c.stroke();
    });
    c.textAlign = 'right';
    c.fillText('0 dB', L - 4, y(1) + 4);
    c.fillText('−24', L - 4, y(Math.pow(10, -24 / 20)) + 4);
    c.textAlign = 'left';
    c.fillText('Hz', 2, h - 7);

    c.strokeStyle = cssVar('--rule');
    c.beginPath(); c.moveTo(L, h - B + 0.5); c.lineTo(w - R, h - B + 0.5); c.stroke();

    if (!shown.length) {
      c.fillStyle = cssVar('--ink-3');
      c.textAlign = 'center';
      c.font = font(14, '--sans');
      c.fillText('Turn on a few notes below', w / 2, h / 2);
      return;
    }

    const ghost = cssVar('--ghost');
    shown.forEach((note, k) => {
      const col = noteColor(note.midi);
      note.freqs.forEach((f, i) => {
        const f0 = base[k].freqs[i];
        if (f < fmin || f > fmax) return;
        const X = x(f), X0 = x(f0), Y = y(note.amps[i]);
        if (Math.abs(X - X0) > 0.75) {
          c.strokeStyle = ghost;
          c.setLineDash([2, 3]);
          c.beginPath(); c.moveTo(X0, Y); c.lineTo(X0, h - B); c.stroke();
          c.setLineDash([]);
          c.strokeStyle = col;
          c.globalAlpha = 0.55;
          c.beginPath(); c.moveTo(X0, Y); c.lineTo(X, Y); c.stroke();
          c.globalAlpha = 1;
        }
        c.strokeStyle = col;
        c.lineWidth = i === 0 ? 2.5 : 1.6;
        c.beginPath(); c.moveTo(X, Y); c.lineTo(X, h - B); c.stroke();
        c.lineWidth = 1;
        c.fillStyle = col;
        c.beginPath(); c.arc(X, Y, i === 0 ? 3.2 : 2.2, 0, Math.PI * 2); c.fill();
      });
    });
  }

  /** samples: [{ cents, d }] over 0..1200. */
  function curve(canvas, samples, implemented) {
    const { c, w, h } = prep(canvas);
    const L = 12, R = 12, T = 22, B = 26;
    const x = (ct) => L + (ct / 1200) * (w - L - R);

    c.font = font(11, '--mono');
    c.lineWidth = 1;

    // 12-TET semitone markers
    c.strokeStyle = cssVar('--grid-strong');
    for (let s = 0; s <= 12; s++) {
      const X = x(s * 100);
      c.beginPath(); c.moveTo(X, T); c.lineTo(X, h - B); c.stroke();
    }

    c.fillStyle = cssVar('--ink-3');
    c.textAlign = 'center';
    [[0, 'P1'], [300, 'm3'], [400, 'M3'], [500, 'P4'], [700, 'P5'], [900, 'M6'], [1200, 'P8']].forEach(([ct, name]) => c.fillText(name, x(ct), h - 7));
    c.textAlign = 'left';
    c.fillText('Cents above the lower note · lines = 12-TET semitones', L, 13);

    c.strokeStyle = cssVar('--rule');
    c.beginPath(); c.moveTo(L, h - B + 0.5); c.lineTo(w - R, h - B + 0.5); c.stroke();

    const max = Math.max(0, ...samples.map((s) => s.d));
    if (!implemented || !(max > 0)) {
      const msg = implemented ? 'Your dissonance function returned 0 everywhere' : 'Write dissonance.js to draw this curve';
      c.font = font(13, '--sans');
      const tw = c.measureText(msg).width + 24;
      c.fillStyle = cssVar('--card');
      c.fillRect(w / 2 - tw / 2, (T + h - B) / 2 - 12, tw, 24);
      c.fillStyle = cssVar('--ink-3');
      c.textAlign = 'center';
      c.fillText(msg, w / 2, (T + h - B) / 2 + 4);
      return;
    }
    const y = (d) => h - B - (d / max) * (h - B - T - 4);
    c.beginPath();
    samples.forEach((s, i) => (i ? c.lineTo(x(s.cents), y(s.d)) : c.moveTo(x(s.cents), y(s.d))));
    c.lineTo(x(1200), h - B); c.lineTo(x(0), h - B); c.closePath();
    c.fillStyle = cssVar('--accent-fill');
    c.fill();
    c.beginPath();
    samples.forEach((s, i) => (i ? c.lineTo(x(s.cents), y(s.d)) : c.moveTo(x(s.cents), y(s.d))));
    c.strokeStyle = cssVar('--accent');
    c.lineWidth = 2;
    c.stroke();
  }

  return { spectrum, curve, noteName, noteColor };
})();
