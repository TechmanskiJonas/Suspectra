/*
 * experiment.js: the listening-test runner (shell code)
 *
 * Order of operations, which is also the order of the cards on the page:
 *   1. load a protocol
 *   2. render every condition it uses, match the loudness, measure the result
 *   3. run the trials blind, with the condition behind each button hidden
 *   4. export the responses and the stimulus measurements as CSV
 *
 * No synthesis happens during a trial, since everything a listener hears was
 * rendered and measured in step 2.
 */
window.SP = window.SP || {};

SP.experiment = (function () {
  const $ = (id) => document.getElementById(id);

  const run = {
    protocol: null,
    built: null,
    stimuli: new Map(),   // condition id -> { samples, buffer, loudness, check, beats }
    responses: [],
    index: 0,
    trialShownAt: 0,
    plays: [],
    ctx: null,
    source: null,
    participant: '',
  };

  const show = (id, on) => { $(id).style.display = on ? '' : 'none'; };
  const fmt = (v, digits) => (v === null || v === undefined || !isFinite(v) ? '–' : v.toFixed(digits === undefined ? 1 : digits));

  // ---------------------------------------------------------------- protocol
  function loadProtocol(obj, source) {
    run.protocol = obj;
    run.built = SP.protocol.build(obj);
    run.stimuli.clear();
    run.responses = [];
    const p = run.built.protocol;
    $('protoName').textContent = p.name || '(unnamed)';
    $('protoSource').textContent = source || '';
    $('protoFacts').textContent = [
      `task ${p.task}`,
      `${run.built.conditionsUsed.length} conditions`,
      `${run.built.trials.length} trials`,
      `${run.built.trials.filter((t) => t.kind === 'catch').length} catch`,
      `seed ${p.seed}`,
      `${p.targetLufs} LUFS`,
      `${p.seconds || 3} s`,
    ].join(' · ');
    $('question').textContent = p.question || '';
    show('prepareRow', true);
    $('prepareBtn').disabled = false;
    $('startBtn').disabled = true;
    show('checkCard', false);
    show('trialCard', false);
    show('resultsCard', false);
  }

  async function loadFromUrl(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    loadProtocol(await res.json(), url);
  }

  function loadFromFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        loadProtocol(JSON.parse(reader.result), file.name);
      } catch (e) {
        $('protoFacts').textContent = `could not read ${file.name}: ${e.message}`;
      }
    };
    reader.readAsText(file);
  }

  // ---------------------------------------------------------------- stimuli
  async function prepare() {
    const p = run.built.protocol;
    const ctx = audioContext();
    const rows = [];
    $('prepareBtn').disabled = true;
    show('checkCard', true);
    $('checkBody').innerHTML = '';

    for (let i = 0; i < run.built.conditionsUsed.length; i++) {
      const cond = run.built.conditionsUsed[i];
      $('prepareStatus').textContent = `rendering ${i + 1} of ${run.built.conditionsUsed.length}`;
      await new Promise((r) => setTimeout(r, 0));   // let the status paint

      const rendered = SP.render.renderChord(cond, { sampleRate: ctx.sampleRate });
      const matched = SP.loudness.normalize(rendered.samples, rendered.sampleRate, p.targetLufs);
      const check = SP.analysis.verifyPartials(matched.samples, rendered.sampleRate, rendered.partials, { tolCents: 5 });
      // Two bands: slow beating, which is audible as swelling, and the faster
      // fluctuation that the roughness model is built around.
      const slow = SP.analysis.beats(matched.samples, rendered.sampleRate, { minHz: 0.3, maxHz: 8 });
      const fast = SP.analysis.beats(matched.samples, rendered.sampleRate, { minHz: 8, maxHz: 40 });
      const beat = { slow, fast, rateHz: slow.rateHz, depthDb: slow.depthDb };

      run.stimuli.set(cond.id, {
        cond,
        samples: matched.samples,
        sampleRate: rendered.sampleRate,
        buffer: SP.render.toBuffer(ctx, matched.samples, rendered.sampleRate),
        loudness: matched,
        check,
        beat,
        partials: rendered.partials,
      });
      rows.push(cond.id);
      renderCheckRow(cond, run.stimuli.get(cond.id));
    }

    $('prepareStatus').textContent = run.participant
      ? `${rows.length} stimuli ready`
      : `${rows.length} stimuli ready, name the participant to start`;
    $('startBtn').disabled = !run.participant;
  }

  function renderCheckRow(cond, s) {
    const tr = document.createElement('tr');
    const cells = [
      cond.id,
      cond.midis.length,
      `${cond.mode}${cond.mode === 'off' ? '' : ' ' + cond.consonance}`,
      fmt(s.loudness.before),
      fmt(s.loudness.gainDb) + (s.loudness.limited ? ' *' : ''),
      fmt(s.loudness.after),
      fmt(s.loudness.peakDbfs),
      `${s.check.matched}/${s.check.total}`,
      fmt(s.check.worstCents, 2),
      s.beat.slow.rateHz ? fmt(s.beat.slow.rateHz, 2) : '–',
      s.beat.fast.rateHz ? fmt(s.beat.fast.rateHz, 1) : '–',
      fmt(s.beat.depthDb, 1),
    ];
    cells.forEach((v, i) => {
      const td = document.createElement('td');
      td.textContent = v;
      if (i > 2) td.className = 'num';
      tr.appendChild(td);
    });
    if (s.check.matched < s.check.total) tr.classList.add('bad');
    $('checkBody').appendChild(tr);
  }

  // ---------------------------------------------------------------- playback
  function audioContext() {
    if (!run.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      run.ctx = new AC();
    }
    if (run.ctx.state === 'suspended') run.ctx.resume();
    return run.ctx;
  }

  function stop() {
    if (run.source) {
      try { run.source.stop(); } catch (e) { /* already ended */ }
      run.source = null;
    }
  }

  function play(slot) {
    const trial = run.built.trials[run.index];
    if (!trial) return;
    const id = trial.stimuli[slot];
    const s = run.stimuli.get(id);
    if (!s) return;
    const ctx = audioContext();
    stop();
    const src = ctx.createBufferSource();
    src.buffer = s.buffer;
    src.connect(ctx.destination);
    src.start();
    run.source = src;
    run.plays[slot] = (run.plays[slot] || 0) + 1;
    document.querySelectorAll('.playbtn').forEach((b, i) => b.classList.toggle('on', i === slot));
    src.onended = () => { document.querySelectorAll('.playbtn').forEach((b) => b.classList.remove('on')); };
  }

  // ---------------------------------------------------------------- trials
  function start() {
    audioContext();
    run.index = 0;
    run.responses = [];
    show('trialCard', true);
    show('resultsCard', false);
    show('checkCard', false);
    document.body.classList.add('running');
    showTrial();
  }

  function showTrial() {
    const p = run.built.protocol;
    const trial = run.built.trials[run.index];
    if (!trial) return finish();

    run.plays = [];
    run.trialShownAt = performance.now();
    $('progress').textContent = `Trial ${run.index + 1} of ${run.built.trials.length}`;
    $('progressBar').style.width = `${(run.index / run.built.trials.length) * 100}%`;

    const plays = $('playRow');
    plays.innerHTML = '';
    trial.stimuli.forEach((id, slot) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'playbtn';
      b.textContent = trial.stimuli.length === 1 ? 'Play' : `Sound ${slot + 1}`;
      b.addEventListener('click', () => play(slot));
      plays.appendChild(b);
    });

    const answers = $('answerRow');
    answers.innerHTML = '';
    p.choices.forEach((choice, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'answer';
      b.innerHTML = `${choice} <kbd>${i + 1}</kbd>`;
      b.addEventListener('click', () => answer(i));
      answers.appendChild(b);
    });

    $('question').textContent = p.question || '';
    play(0);
  }

  function answer(choiceIndex) {
    const p = run.built.protocol;
    const trial = run.built.trials[run.index];
    if (!trial) return;
    run.responses.push({
      trial: trial.index,
      kind: trial.kind,
      catchKind: trial.catchKind || '',
      rep: trial.rep,
      stimuli: trial.stimuli.slice(),
      choiceIndex,
      choice: p.choices[choiceIndex],
      rtMs: Math.round(performance.now() - run.trialShownAt),
      plays: trial.stimuli.map((_, i) => run.plays[i] || 0),
      at: new Date().toISOString(),
    });
    stop();
    run.index += 1;
    showTrial();
  }

  function finish() {
    stop();
    document.body.classList.remove('running');
    show('trialCard', false);
    show('checkCard', true);
    show('resultsCard', true);
    $('progressBar').style.width = '100%';

    const p = run.built.protocol;
    const byCondition = new Map();
    run.responses.forEach((r) => {
      r.stimuli.forEach((id) => {
        if (!byCondition.has(id)) byCondition.set(id, []);
        byCondition.get(id).push(r.choiceIndex);
      });
    });

    const body = $('resultsBody');
    body.innerHTML = '';
    run.built.conditionsUsed.forEach((c) => {
      const answers = byCondition.get(c.id) || [];
      const counts = p.choices.map((_, i) => answers.filter((a) => a === i).length);
      const tr = document.createElement('tr');
      [c.id, c.label || '', answers.length, counts.join(' / ')].forEach((v, i) => {
        const td = document.createElement('td');
        td.textContent = v;
        if (i > 1) td.className = 'num';
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });

    const catches = run.responses.filter((r) => r.kind === 'catch');
    const repeats = new Map();
    run.responses.forEach((r) => {
      const key = r.stimuli.join('+');
      if (!repeats.has(key)) repeats.set(key, []);
      repeats.get(key).push(r.choiceIndex);
    });
    let agree = 0, pairs = 0;
    repeats.forEach((list) => {
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) { pairs++; if (list[i] === list[j]) agree++; }
    });
    $('resultsFacts').textContent = [
      `${run.responses.length} responses`,
      `${catches.length} catch trials`,
      pairs ? `repeat agreement ${Math.round((agree / pairs) * 100)}%` : 'no repeats',
      `median RT ${median(run.responses.map((r) => r.rtMs))} ms`,
    ].join(' · ');
  }

  function median(xs) {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    return Math.round(s[Math.floor(s.length / 2)]);
  }

  // ---------------------------------------------------------------- export
  function csvEscape(v) {
    const s = String(v === null || v === undefined ? '' : v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function download(name, rows) {
    const text = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function responsesCsv() {
    const p = run.built.protocol;
    const rows = [['participant', 'protocol', 'seed', 'task', 'trial', 'kind', 'catch_kind', 'repetition',
      'stimulus_1', 'stimulus_2', 'label_1', 'label_2', 'response_index', 'response', 'rt_ms', 'plays_1', 'plays_2', 'timestamp']];
    const labelOf = (id) => {
      const c = run.built.conditionsUsed.find((x) => x.id === id);
      return c ? (c.label || '') : '';
    };
    run.responses.forEach((r) => rows.push([
      run.participant, p.name, p.seed, p.task, r.trial, r.kind, r.catchKind, r.rep,
      r.stimuli[0] || '', r.stimuli[1] || '', labelOf(r.stimuli[0]), r.stimuli[1] ? labelOf(r.stimuli[1]) : '',
      r.choiceIndex, r.choice, r.rtMs, r.plays[0] || 0, r.plays[1] || 0, r.at,
    ]));
    download(`suspectra-responses-${stamp()}.csv`, rows);
  }

  function stimuliCsv() {
    const rows = [['condition', 'label', 'midis', 'mode', 'consonance', 'partials_per_note',
      'lufs_before', 'gain_db', 'gain_limited', 'lufs_after', 'peak_dbfs',
      'partials_expected', 'partials_matched', 'worst_cents', 'beat_slow_hz', 'beat_fast_hz', 'beat_depth_db']];
    run.stimuli.forEach((s, id) => rows.push([
      id, s.cond.label || '', s.cond.midis.join(' '), s.cond.mode, s.cond.consonance, s.cond.partials,
      s.loudness.before.toFixed(2), s.loudness.gainDb.toFixed(2), s.loudness.limited ? 'yes' : 'no',
      s.loudness.after.toFixed(2), s.loudness.peakDbfs.toFixed(2),
      s.check.total, s.check.matched, isFinite(s.check.worstCents) ? s.check.worstCents.toFixed(3) : '',
      s.beat.slow.rateHz ? s.beat.slow.rateHz.toFixed(3) : '',
      s.beat.fast.rateHz ? s.beat.fast.rateHz.toFixed(3) : '',
      s.beat.depthDb.toFixed(2),
    ]));
    download(`suspectra-stimuli-${stamp()}.csv`, rows);
  }

  function wavZipHint() {
    // One file at a time, which avoids a zip dependency.
    const trial = run.built.conditionsUsed[0];
    const s = run.stimuli.get(trial.id);
    if (!s) return;
    const url = URL.createObjectURL(SP.render.toWav(s.samples, s.sampleRate));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${trial.id}.wav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  // ---------------------------------------------------------------- wiring
  function boot() {
    $('participant').addEventListener('input', (e) => {
      run.participant = e.target.value.trim();
      $('startBtn').disabled = !run.participant || !run.stimuli.size;
    });
    $('protoPick').addEventListener('change', (e) => {
      loadFromUrl(e.target.value).catch((err) => { $('protoFacts').textContent = err.message; });
    });
    $('protoFile').addEventListener('change', (e) => { if (e.target.files[0]) loadFromFile(e.target.files[0]); });
    $('prepareBtn').addEventListener('click', prepare);
    $('startBtn').addEventListener('click', start);
    $('responsesBtn').addEventListener('click', responsesCsv);
    $('stimuliBtn').addEventListener('click', stimuliCsv);
    $('wavBtn').addEventListener('click', wavZipHint);

    window.addEventListener('keydown', (e) => {
      if (document.body.dataset.view !== 'listening') return;
      if (!document.body.classList.contains('running')) return;
      const trial = run.built && run.built.trials[run.index];
      if (!trial) return;
      if (e.key === ' ') { e.preventDefault(); play(0); return; }
      const n = Number(e.key);
      if (!n) return;
      if (trial.stimuli.length === 2 && (e.shiftKey || e.altKey)) { play(n - 1); return; }
      if (n <= run.built.protocol.choices.length) answer(n - 1);
    });

    loadFromUrl($('protoPick').value).catch((err) => {
      $('protoFacts').textContent = `Open the page over a local server to load the bundled protocol, or choose a file. (${err.message})`;
    });
  }

  return { boot, loadProtocol, prepare, start, run };
})();
