# HANDOFF: Suspectra

Read this first. It's written for Claude Code (or any assistant) picking up this repo, and for Jonas.

## What this is

A browser instrument. Notes stay in 12-TET, but each note's overtones move to fit whatever chord is sounding, so the chord becomes as consonant as possible. Knobs control how far toward the optimum the sound goes (Consonance), how fast it moves (Glide), the base sound's tilt (Brightness), and the objective (Mode: Smooth = minimize roughness, Fused = snap onto one shared harmonic series).

It's also a research project for ECE 401 office hours (Prof. Mark Hasegawa-Johnson, Fall 2026) and a portfolio piece.

**Research question:** can chord-aware overtone adaptation make 12-TET chords measurably smoother, and what does it cost in pitch clarity and audible artifacts?

## Ground rule for assistants

**`src/dissonance.js` is Jonas's own work.** `pair` and `total` were written by him on 2026-09-17. Do not rewrite them; review and explain instead.

**`src/optimizer.js` was written by Claude on 2026-09-18**, at Jonas's request and after the confirmation below, from a method the two of them worked through beforehand. Say so if anyone asks who wrote what.

You may:
- explain the math (Plomp & Levelt 1965; Sethares' curve fit; gradient descent, coordinate descent, multi-start, simulated annealing), with equations in prose or LaTeX, not code
- review his code, point to bugs, and explain failing checks
- write new checks in `src/tests.js`
- build anything in the shell: UI, audio, views, Web Worker plumbing, MIDI, plotting, export

If he explicitly asks for an implementation of one of these functions, confirm once that he wants to give up authorship of that file, then proceed.

## Run it

No build step, no server, no dependencies. Open `index.html` in Chrome (double-click works). Web MIDI works from a local file in Chrome.

Single-file build (for sharing or hosting): `python tools/build_single.py` → `dist/Suspectra.html`.

Hosting: push to GitHub and enable GitHub Pages on the repo root; `index.html` is the entry point.

## Layout

| File | Owner | What it does |
|---|---|---|
| `src/dissonance.js` | **Jonas** | `pair(f1, a1, f2, a2)` and `total(notes, { interNoteOnly })` |
| `src/optimizer.js` | Claude, for Jonas | `optimize(notes, params)`: coordinate descent (Smooth) and a shared harmonic series (Fused) |
| `src/timbre.js` | shell | Eleven base sounds, including two formant-based voices, and the Brightness tilt |
| `src/audio.js` | shell | Web Audio additive synth: one sine per partial, glide via `setTargetAtTime`, partials at or above Nyquist silenced |
| `src/views.js` | shell | Canvas: overtone spectrum (log Hz) and dissonance curve with 12-TET semitone markers |
| `src/tests.js` | shell | Contract checks. The panel is gone; run `SP.tests.run()` in the console |
| `src/app.js` | shell | State, keyboard (C3–C5), controls, MIDI, mode hotkeys, staging the next chord |
| `src/style.css` | shell | Theme tokens (dark only, same design brief as Sonokinetic) |

Plain scripts on a global `SP` namespace (no ES modules) so the page runs from `file://`.

## Contracts

Units: Hz and linear amplitude. A note is `{ freqs: number[], amps: number[] }`, with `freqs[0]` the fundamental.

**`SP.dissonance.pair(f1, a1, f2, a2)`**: roughness of two sines. At least 0, symmetric, ≈0 for identical frequencies, peaks at a small separation (checked: 10–60 Hz apart near 440 Hz), under 10% of peak an octave apart, and grows with amplitude.

**`SP.dissonance.total(notes, { interNoteOnly = true })`**: sum of `pair` over partial pairs. With `interNoteOnly`, only pairs from different notes count, so a lone note scores 0. Check: a 3:2 fifth scores lower than a tritone.

**`SP.optimizer.optimize(notes, params)`**
- `notes`: `[{ midi, f0, freqs, amps }]`, base harmonic timbre
- `params`: `{ mode: 'smooth' | 'fused', maxShift: 0.45, dissonance: SP.dissonance }`
- returns `number[][]`, one frequency list per note, same lengths
- rules: `freqs[0] === f0`; overtone `i` stays within `[(i+1-maxShift)·f0, (i+1+maxShift)·f0]`; order preserved; never rougher than the input

The app blends: `shown = base · (optimum / base)^consonance`. Both modules set `implemented: true`, which is what makes the app call into them.

Performance: `optimize` runs on every note toggle, on the main thread. Target under 100 ms for 4–6 notes × 8 partials. If it's slower, move it to a Web Worker (shell work, fine for assistants to build).

## Suggested order for Jonas

1. `pair`, then `total`. Run checks. The Dissonance curve panel draws itself once `dissonance.implemented = true`; that plot, with 12-TET semitones marked, is the Sep 24 office-hours artifact.
2. `optimize` in Smooth mode. Start with local descent from the harmonic positions and see that it barely moves; then add multi-start or annealing to find the deep minima. Expect shifts of hundreds of cents on some chords.
3. Fused mode: find a common fundamental for the chord (e.g., via a rational approximation of the 12-TET ratios) and snap partials to its multiples within maxShift.

## Ideas queue (shell side, when asked)

- Web Worker for the optimizer
- Show per-partial cents shifts on hover
- Export a WAV of the current chord; "A/B" button to flip Consonance 0 ↔ current
- Chord-progression player (a MIDI file or a typed list) for listening tests
- Offline render of beat measurements (short-time energy) for the ECE 401 week-10 comparison

## Background

- Plomp & Levelt (1965), Tonal consonance and critical bandwidth. JASA.
- Sethares (1993), Local consonance and the relationship between timbre and scale. JASA.
- Sethares, Tuning, Timbre, Spectrum, Scale (Springer).
- Sethares (2002), Real-time adaptive tunings using Max. Adapts pitches with fixed timbre; this project is the mirror image (fixed pitches, adaptive timbre).
- Sethares et al., Spectral tools for Dynamic Tonality and audio morphing. Computer Music Journal. Maps timbre to a chosen tuning, not to the sounding chord.
- McDermott, Lehr & Oxenham (2010), Individual differences reveal the basis of consonance. Current Biology. Harmonicity vs. roughness; motivates the two modes.
