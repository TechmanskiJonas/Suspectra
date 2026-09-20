/*
 * protocol.js: a listening test as data (shell code)
 *
 * An experiment is a JSON file holding conditions, a task, repetitions, catch
 * trials and a seed, so a new design is written as a new protocol file.
 *
 * Shape:
 * {
 *   "name": "...",
 *   "task": "single" | "ab",
 *   "question": "...",
 *   "choices": ["...", "..."],         // single: the answers; ab: the two verdicts
 *   "seed": 20260918,
 *   "repetitions": 2,
 *   "targetLufs": -23,
 *   "seconds": 3,
 *   "defaults": { partials, preset, brightness, consonance, mode, maxShift },
 *   "conditions": [{ "id", "label", "midis": [..], ...overrides }],
 *   "pairs": [["a", "b"], ...],        // ab only; "allPairs" builds them all
 *   "catch": { "kind": "repeat" | "identical", "count": 4 }
 * }
 *
 * `label` appears in the exported data and is never shown in the runner.
 */
window.SP = window.SP || {};

SP.protocol = (function () {
  function seeded(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(list, rand) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
  }

  /** Fill in every condition from `defaults`, and fail loudly on a bad file. */
  function validate(p) {
    const problems = [];
    if (!p || typeof p !== 'object') problems.push('protocol is not an object');
    if (!p.conditions || !p.conditions.length) problems.push('no conditions');
    if (p.task !== 'single' && p.task !== 'ab') problems.push(`task must be "single" or "ab", got ${JSON.stringify(p.task)}`);
    if (!Array.isArray(p.choices) || p.choices.length < 2) problems.push('choices needs at least two entries');
    const ids = new Set();
    (p.conditions || []).forEach((c, i) => {
      if (!c.id) problems.push(`condition ${i} has no id`);
      if (ids.has(c.id)) problems.push(`duplicate condition id ${c.id}`);
      ids.add(c.id);
      if (!Array.isArray(c.midis) || !c.midis.length) problems.push(`condition ${c.id} has no midis`);
    });
    if (p.task === 'ab' && p.pairs && p.pairs !== 'allPairs') {
      p.pairs.forEach((pair, i) => {
        if (!Array.isArray(pair) || pair.length !== 2) problems.push(`pair ${i} is not two ids`);
        else pair.forEach((id) => { if (!ids.has(id)) problems.push(`pair ${i} names unknown condition ${id}`); });
      });
    }
    if (problems.length) throw new Error(problems.join('; '));

    const defaults = Object.assign(
      { partials: 8, preset: 'organ', brightness: 55, consonance: 0, mode: 'off', maxShift: 0.45 },
      p.defaults || {}
    );
    const conditions = p.conditions.map((c) => Object.assign({}, defaults, c, {
      seconds: c.seconds || p.seconds || 3,
      phaseSeed: typeof c.phaseSeed === 'number' ? c.phaseSeed : (p.seed || 1),
    }));
    return Object.assign({}, p, {
      seed: p.seed || 1,
      repetitions: p.repetitions || 1,
      targetLufs: typeof p.targetLufs === 'number' ? p.targetLufs : -23,
      conditions,
    });
  }

  /**
   * Expand a protocol into the trial list. Order is shuffled with the seed, so
   * the same file and seed give the same run, and a different seed gives a
   * different order with the same content. In `ab` trials the side each
   * condition lands on is drawn per trial.
   */
  function build(protocolIn) {
    const p = validate(protocolIn);
    const rand = seeded(p.seed);
    const items = [];

    if (p.task === 'single') {
      for (let rep = 0; rep < p.repetitions; rep++) {
        for (const c of p.conditions) items.push({ kind: 'test', rep, stimuli: [c.id] });
      }
    } else {
      let pairs = p.pairs;
      if (!pairs || pairs === 'allPairs') {
        pairs = [];
        for (let i = 0; i < p.conditions.length; i++) {
          for (let j = i + 1; j < p.conditions.length; j++) pairs.push([p.conditions[i].id, p.conditions[j].id]);
        }
      }
      for (let rep = 0; rep < p.repetitions; rep++) {
        for (const pair of pairs) items.push({ kind: 'test', rep, stimuli: pair.slice() });
      }
    }

    // Catch trials. "identical" asks for a verdict between one stimulus and
    // itself. "repeat" presents a condition again, so the two answers can be
    // compared for consistency.
    const c = p.catch || {};
    const count = c.count || 0;
    for (let i = 0; i < count; i++) {
      const pick = p.conditions[Math.floor(rand() * p.conditions.length)];
      if (p.task === 'ab' && (c.kind || 'identical') === 'identical') {
        items.push({ kind: 'catch', catchKind: 'identical', rep: 0, stimuli: [pick.id, pick.id] });
      } else {
        items.push({ kind: 'catch', catchKind: 'repeat', rep: 0, stimuli: p.task === 'ab' ? [pick.id, pick.id] : [pick.id] });
      }
    }

    const trials = shuffle(items, rand).map((t, i) => {
      const stimuli = t.stimuli.length === 2 && rand() < 0.5 ? [t.stimuli[1], t.stimuli[0]] : t.stimuli.slice();
      return Object.assign({}, t, { index: i + 1, stimuli });
    });

    const used = new Set();
    trials.forEach((t) => t.stimuli.forEach((id) => used.add(id)));
    return {
      protocol: p,
      trials,
      conditionsUsed: p.conditions.filter((c2) => used.has(c2.id)),
    };
  }

  return { build, validate, seeded, shuffle };
})();
