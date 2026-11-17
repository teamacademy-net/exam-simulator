/* ExamSim – a computer-based exam simulator (no build step, no server needed). */
(function () {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const APP_NAME = CFG.name || 'ExamSim';
  const KEYS = {
    session: 'examsim.session.v1',
    history: 'examsim.history.v1',
    custom: 'examsim.custom.v1',
    prefs: 'examsim.prefs.v1'
  };

  // ---------------------------------------------------------------- storage
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };

  // ---------------------------------------------------------------- utils
  const $app = document.getElementById('app');
  const h = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rich = (s) => h(s).replace(/\n/g, '<br>');
  const pad = (n) => String(n).padStart(2, '0');
  const letter = (k) => String.fromCharCode(65 + k);
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    return `${Math.floor(sec / 3600)}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`;
  }
  function fmtDuration(sec) {
    const m = Math.round(sec / 60);
    return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
  }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const titleCase = (s) => String(s).replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('is-out'), 2600);
    setTimeout(() => t.remove(), 3000);
  }

  function closeModal() { document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove()); }
  function showModal({ title, body, actions }) {
    closeModal();
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <h2 id="modal-title">${h(title)}</h2><div class="modal__body">${body}</div><div class="modal__actions"></div></div>`;
    const bar = wrap.querySelector('.modal__actions');
    (actions || [{ label: 'OK', primary: true }]).forEach((a) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + (a.primary ? 'btn--primary' : a.danger ? 'btn--danger' : 'btn--secondary');
      b.textContent = a.label;
      b.addEventListener('click', () => { closeModal(); if (a.onClick) a.onClick(); });
      bar.appendChild(b);
    });
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
    document.body.appendChild(wrap);
    const btns = bar.querySelectorAll('button');
    btns[btns.length - 1].focus();
  }

  // ---------------------------------------------------------------- exam bank
  function normalizeExam(def) {
    if (!def || typeof def !== 'object') throw new Error('The file does not contain an exam object.');
    if (!def.id || !def.title) throw new Error('The exam needs an "id" and a "title".');
    if (!Array.isArray(def.questions) || !def.questions.length) throw new Error('The exam needs a non-empty "questions" array.');
    const seen = new Set();
    const questions = def.questions.map((q, i) => {
      const n = i + 1;
      if (!q || !q.text) throw new Error(`Question ${n}: missing "text".`);
      if (!Array.isArray(q.options) || q.options.length < 2) throw new Error(`Question ${n}: needs at least 2 "options".`);
      const options = q.options.map((o, j) => (typeof o === 'string'
        ? { id: String.fromCharCode(97 + j), text: o }
        : { id: String(o.id != null ? o.id : String.fromCharCode(97 + j)), text: String(o.text) }));
      const ids = options.map((o) => o.id);
      const answer = (Array.isArray(q.answer) ? q.answer : [q.answer]).filter((a) => a != null).map(String);
      if (!answer.length || answer.some((a) => !ids.includes(a))) {
        throw new Error(`Question ${n}: "answer" must list option ids (${ids.join(', ')}).`);
      }
      const id = String(q.id != null ? q.id : n);
      if (seen.has(id)) throw new Error(`Question ${n}: duplicate id "${id}".`);
      seen.add(id);
      return {
        id, domain: q.domain || 'general', text: String(q.text), options, answer,
        type: answer.length > 1 ? 'multiple' : 'single',
        explanation: q.explanation || '', fixedOrder: !!q.fixedOrder
      };
    });
    return {
      id: String(def.id),
      title: String(def.title),
      provider: def.provider || '',
      description: def.description || '',
      durationMinutes: Number(def.durationMinutes) || Math.max(1, Math.round(questions.length * 1.3)),
      passingScore: Number(def.passingScore) || 65,
      shuffleQuestions: def.shuffleQuestions !== false,
      shuffleOptions: def.shuffleOptions !== false,
      breaks: Array.isArray(def.breaks)
        ? def.breaks.filter((b) => b && Number(b.afterQuestion) > 0).map((b) => ({ afterQuestion: Number(b.afterQuestion), minutes: Number(b.minutes) || 10 }))
        : [],
      domains: def.domains || {},
      instructions: Array.isArray(def.instructions) ? def.instructions : [],
      questions
    };
  }

  let exams = [];
  function loadExams() {
    exams = [];
    const add = (def, source) => {
      try {
        const ex = normalizeExam(def); ex.source = source;
        exams = exams.filter((e) => e.id !== ex.id); exams.push(ex);
      } catch (err) { console.error(`Exam "${def && def.id}" skipped:`, err.message); }
    };
    (window.EXAM_BANK || []).forEach((d) => add(d, 'built-in'));
    store.get(KEYS.custom, []).forEach((d) => add(d, 'custom'));
  }
  const getExam = (id) => exams.find((e) => e.id === id);
  const domainName = (map, key) => (map && map[key]) || titleCase(key);

  // ---------------------------------------------------------------- state
  let state = null;        // active exam session (persisted)
  let intro = null;        // pre-exam wizard
  let timerId = null;
  let viewing = null;      // { result, filter } when showing a score report

  const prefs = Object.assign({ font: 1 }, store.get(KEYS.prefs, {}));
  const save = () => { if (state) store.set(KEYS.session, state); };
  const stopTimer = () => { if (timerId) { clearInterval(timerId); timerId = null; } };
  const startTimer = () => { stopTimer(); timerId = setInterval(tick, 1000); };

  // SUPABASE: who is signed in, with links to the admin page and Sign out.
  const AUTH = window.ExamAuth || null;
  function userMenu() {
    if (!AUTH || !AUTH.user) return '';
    return `<span class="appbar__user"><span class="appbar__name">${h(AUTH.displayName())}</span>
      ${AUTH.isStaff() ? '<a class="btn btn--small btn--secondary" href="admin.html">Admin</a>' : ''}
      <button class="btn btn--small btn--secondary" data-action="sign-out">Sign out</button></span>`;
  }

  function topbar(extra) {
    return `<header class="appbar"><button class="appbar__brand" data-action="home" aria-label="${h(APP_NAME)} home">
      <span class="appbar__logo" aria-hidden="true">✓</span><span>${h(APP_NAME)}</span></button>
      <span class="appbar__tag">${h(CFG.tagline || '')}</span>${extra || ''}${userMenu()}</header>`;
  }

  // ================================================================ HOME
  function renderHome() {
    stopTimer(); state = null; intro = null; viewing = null;
    closeCalc();
    const saved = store.get(KEYS.session, null);
    const history = store.get(KEYS.history, []);
    const savedExam = saved && saved.questions ? saved : null;

    const resume = savedExam ? `
      <section class="card card--notice">
        <div><h2 class="card__title">Exam in progress</h2>
        <p>${h(savedExam.examTitle)} · ${Object.keys(savedExam.answers).length} of ${savedExam.questions.length} answered ·
        ${savedExam.timeLimit ? fmtTime(savedExam.timeLimit - savedExam.elapsed) + ' remaining' : fmtTime(savedExam.elapsed) + ' elapsed'}</p></div>
        <div class="card__actions"><button class="btn btn--secondary" data-action="discard">Discard</button>
        <button class="btn btn--primary" data-action="resume">Resume exam</button></div>
      </section>` : '';

    const cards = exams.map((e) => {
      const doms = [...new Set(e.questions.map((q) => q.domain))].map((d) => domainName(e.domains, d));
      return `<article class="exam-card">
        <div class="exam-card__top"><span class="pill">${e.source === 'custom' ? 'Imported' : h(e.provider || 'Built-in')}</span></div>
        <h3>${h(e.title)}</h3>
        <p class="muted">${h(e.description)}</p>
        <dl class="facts">
          <div><dt>Questions</dt><dd>${e.questions.length}</dd></div>
          <div><dt>Time</dt><dd>${fmtDuration(e.durationMinutes * 60)}</dd></div>
          <div><dt>Pass mark</dt><dd>${e.passingScore}%</dd></div>
        </dl>
        <p class="domains">${doms.map((d) => `<span class="chip">${h(d)}</span>`).join('')}</p>
        <div class="exam-card__actions">
          ${e.source === 'custom' ? `<button class="btn btn--ghost" data-action="remove-custom" data-id="${h(e.id)}">Remove</button>` : ''}
          <button class="btn btn--primary" data-action="open-exam" data-id="${h(e.id)}">Start</button>
        </div>
      </article>`;
    }).join('') || '<p class="muted">No exams loaded. Import a JSON question bank below.</p>';

    const hist = history.length ? `
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Date</th><th>Exam</th><th>Mode</th><th class="num">Score</th><th>Result</th><th></th></tr></thead>
        <tbody>${history.map((r) => `<tr>
          <td>${h(new Date(r.date).toLocaleString())}</td><td>${h(r.examTitle)}</td>
          <td>${r.mode === 'practice' ? 'Practice' : 'Simulation'}</td>
          <td class="num">${r.percent}%</td>
          <td><span class="result-tag ${r.passed ? 'is-pass' : 'is-fail'}">${r.passed ? 'Pass' : 'Fail'}</span></td>
          <td class="num"><button class="btn btn--small btn--secondary" data-action="view-result" data-id="${h(r.id)}">Report</button></td>
        </tr>`).join('')}</tbody></table></div>
      <button class="btn btn--ghost" data-action="clear-history">Clear history</button>`
      : '<p class="muted">Your completed exams will appear here.</p>';

    $app.innerHTML = `${topbar()}
      <main class="page">
        <section class="hero">
          <h1>Practice like it’s exam day</h1>
          <p>Timed, full-screen exams with a review screen, flag-for-review, strikethrough, an on-screen calculator,
          scheduled breaks and a domain-level score report.</p>
        </section>
        ${resume}
        <section><h2 class="section-title">Available exams</h2><div class="exam-grid">${cards}</div></section>
        <section class="card">
          <h2 class="card__title">Add your own question bank</h2>
          <p class="muted">Import an exam file (.json) written in the ExamSim format. Imported exams are stored only in this browser.
          To publish an exam for all students, add it to the <code>exams</code> folder of the site instead.</p>
          <div class="card__actions card__actions--start">
            <label class="btn btn--primary file-btn">Import JSON<input type="file" accept=".json,application/json" id="import-file" hidden></label>
            <button class="btn btn--secondary" data-action="template">Download template</button>
          </div>
        </section>
        <section><h2 class="section-title">Your attempts</h2>${hist}</section>
      </main>
      <footer class="sitefoot">${h(APP_NAME)} is an independent practice tool and is not affiliated with or endorsed by any certification body or test-delivery provider.</footer>`;

    const fi = document.getElementById('import-file');
    if (fi) fi.addEventListener('change', importFile);
    document.title = `${APP_NAME} – Exam Simulator`;
  }

  function importFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const def = JSON.parse(reader.result);
        const ex = normalizeExam(def);
        const custom = store.get(KEYS.custom, []).filter((d) => String(d.id) !== ex.id);
        custom.push(def);
        if (!store.set(KEYS.custom, custom)) throw new Error('Browser storage is full or unavailable.');
        loadExams(); renderHome();
        toast(`Imported "${ex.title}" (${ex.questions.length} questions).`);
      } catch (err) {
        showModal({ title: 'Could not import exam', body: `<p>${h(err.message)}</p>` });
      }
    };
    reader.readAsText(file);
  }

  function downloadTemplate() {
    const tpl = {
      id: 'my-exam', title: 'My Practice Exam', provider: 'My Academy',
      description: 'Short description shown on the exam card.',
      durationMinutes: 30, passingScore: 70, shuffleQuestions: true, shuffleOptions: true,
      breaks: [{ afterQuestion: 10, minutes: 5 }],
      domains: { d1: 'Domain One', d2: 'Domain Two' },
      instructions: ['Each question has one best answer unless it says "Select two".'],
      questions: [
        { id: 'q1', domain: 'd1', text: 'Single-answer question text?', options: [
          { id: 'a', text: 'Option A' }, { id: 'b', text: 'Option B' }, { id: 'c', text: 'Option C' }, { id: 'd', text: 'Option D' }],
          answer: ['b'], explanation: 'Why B is correct.' },
        { id: 'q2', domain: 'd2', text: 'Multiple-response question text? (Select two.)', options: [
          { id: 'a', text: 'Option A' }, { id: 'b', text: 'Option B' }, { id: 'c', text: 'Option C' }, { id: 'd', text: 'Option D' }],
          answer: ['a', 'c'], explanation: 'Why A and C are correct.' }
      ]
    };
    const blob = new Blob([JSON.stringify(tpl, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'examsim-template.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ================================================================ INTRO WIZARD
  function openExam(id) {
    const ex = getExam(id);
    if (!ex) return toast('Exam not found.');
    if (store.get(KEYS.session, null)) {
      return showModal({
        title: 'Replace exam in progress?',
        body: '<p>You have an unfinished exam. Starting a new one will discard it.</p>',
        actions: [{ label: 'Cancel' }, { label: 'Discard and continue', danger: true, onClick: () => { store.del(KEYS.session); openExam(id); } }]
      });
    }
    const signedInName = AUTH && AUTH.user ? AUTH.displayName() : '';  // SUPABASE
    intro = { examId: id, step: 0, mode: 'exam', count: 'all', candidate: signedInName || store.get(KEYS.prefs, {}).candidate || '', agreed: false };
    renderIntro();
  }

  function readIntroFields() {
    const name = document.getElementById('cand-name');
    if (name) intro.candidate = name.value.trim();
    const mode = document.querySelector('input[name="mode"]:checked');
    if (mode) intro.mode = mode.value;
    const count = document.getElementById('q-count');
    if (count) intro.count = count.value;
    const agree = document.getElementById('agree');
    if (agree) intro.agreed = agree.checked;
  }

  function renderIntro() {
    const ex = getExam(intro.examId);
    const steps = ['Welcome', 'Agreement', 'Tutorial'];
    const stepper = `<ol class="stepper">${steps.map((s, i) => `<li class="${i === intro.step ? 'is-current' : i < intro.step ? 'is-done' : ''}"><span>${i + 1}</span>${s}</li>`).join('')}</ol>`;
    const counts = [10, 25, 50, 100, 150].filter((n) => n < ex.questions.length);
    let body = '';
    if (intro.step === 0) {
      body = `<h1>${h(ex.title)}</h1>
        <p class="muted">${h(ex.description)}</p>
        <dl class="facts facts--wide">
          <div><dt>Questions</dt><dd>${ex.questions.length}</dd></div>
          <div><dt>Time allowed</dt><dd>${fmtDuration(ex.durationMinutes * 60)}</dd></div>
          <div><dt>Passing score</dt><dd>${ex.passingScore}%</dd></div>
          <div><dt>Scheduled breaks</dt><dd>${ex.breaks.length ? ex.breaks.map((b) => `${b.minutes} min after Q${b.afterQuestion}`).join(', ') : 'None'}</dd></div>
        </dl>
        <div class="form-grid">
          <label class="field"><span>Candidate name (optional)</span><input id="cand-name" type="text" maxlength="60" value="${h(intro.candidate)}" autocomplete="name"></label>
          <label class="field"><span>Number of questions</span><select id="q-count">
            <option value="all">All ${ex.questions.length} questions</option>
            ${counts.map((n) => `<option value="${n}" ${String(n) === intro.count ? 'selected' : ''}>${n} random questions</option>`).join('')}
          </select></label>
        </div>
        <fieldset class="mode-pick"><legend>Mode</legend>
          <label class="mode-opt"><input type="radio" name="mode" value="exam" ${intro.mode === 'exam' ? 'checked' : ''}>
            <span><strong>Exam simulation</strong><small>Timed, sections and breaks, no feedback until the end. Like test day.</small></span></label>
          <label class="mode-opt"><input type="radio" name="mode" value="practice" ${intro.mode === 'practice' ? 'checked' : ''}>
            <span><strong>Practice</strong><small>Untimed. Check each answer and read the explanation as you go.</small></span></label>
        </fieldset>`;
    } else if (intro.step === 1) {
      body = `<h1>Candidate agreement</h1>
        <p>Before you begin, please read and accept the following:</p>
        <ul class="agreement">${(CFG.agreement || []).map((t) => `<li>${h(t)}</li>`).join('')}</ul>
        <label class="check"><input type="checkbox" id="agree" ${intro.agreed ? 'checked' : ''}> I have read and accept this agreement.</label>`;
    } else {
      body = `<h1>How the exam works</h1>
        <div class="tutorial">
          <div><h3>Answering</h3><p>Click an option to select it. Questions that say <em>Select two</em> need exactly that many answers.</p></div>
          <div><h3>Strikethrough</h3><p>Right-click an option (or use its <em>Strike</em> button) to cross out answers you have ruled out.</p></div>
          <div><h3>Flag for review</h3><p>Flag any question you want to come back to. Flags are shown on the review screen.</p></div>
          <div><h3>Review screen</h3><p>See every question in the section as Complete, Incomplete or Unseen, and jump straight to any of them.</p></div>
          <div><h3>Sections &amp; breaks</h3><p>Ending a section locks its answers. The exam clock pauses during a break.</p></div>
          <div><h3>Shortcuts</h3><p><kbd>Alt</kbd>+<kbd>N</kbd> next · <kbd>Alt</kbd>+<kbd>P</kbd> previous · <kbd>Alt</kbd>+<kbd>F</kbd> flag · <kbd>Alt</kbd>+<kbd>R</kbd> review</p></div>
        </div>
        ${ex.instructions.length ? `<h3>Exam instructions</h3><ul>${ex.instructions.map((t) => `<li>${h(t)}</li>`).join('')}</ul>` : ''}
        <p class="muted">${intro.mode === 'exam' ? 'The timer starts when you select <strong>Begin exam</strong>.' : 'Practice mode is untimed.'}</p>`;
    }
    const isLast = intro.step === steps.length - 1;
    $app.innerHTML = `${topbar()}
      <main class="page page--narrow">
        ${stepper}
        <section class="card intro">${body}
          <div class="card__actions">
            <button class="btn btn--secondary" data-action="${intro.step === 0 ? 'home' : 'intro-back'}">${intro.step === 0 ? 'Cancel' : 'Back'}</button>
            <button class="btn btn--primary" data-action="${isLast ? 'intro-begin' : 'intro-next'}">${isLast ? 'Begin exam' : 'Next'}</button>
          </div>
        </section>
      </main>`;
    const first = $app.querySelector('.intro input, .intro .btn--primary');
    if (first) first.focus();
  }

  // ================================================================ SESSION
  function buildSession(ex) {
    let qs = ex.shuffleQuestions ? shuffle(ex.questions) : ex.questions.slice();
    const n = intro.count === 'all' ? qs.length : Math.min(qs.length, Number(intro.count));
    qs = qs.slice(0, n).map((q) => ({
      id: q.id, domain: q.domain, text: q.text, type: q.type, answer: q.answer, explanation: q.explanation,
      options: ex.shuffleOptions && !q.fixedOrder ? shuffle(q.options) : q.options
    }));
    const isExam = intro.mode === 'exam';
    const ratio = n / ex.questions.length;
    // Breaks are scaled proportionally when a shorter exam is chosen.
    const breakPoints = isExam
      ? ex.breaks.map((b) => ({ at: Math.round(b.afterQuestion * ratio), minutes: b.minutes }))
        .filter((b) => b.at >= 1 && b.at < n)
        .filter((b, i, arr) => arr.findIndex((x) => x.at === b.at) === i)
        .sort((a, b) => a.at - b.at)
      : [];
    const sections = []; let start = 0;
    breakPoints.forEach((b) => { sections.push({ start, end: b.at - 1 }); start = b.at; });
    sections.push({ start, end: n - 1 });

    return {
      examId: ex.id, examTitle: ex.title, mode: intro.mode, candidate: intro.candidate,
      passingScore: ex.passingScore, domains: ex.domains,
      questions: qs, answers: {}, flagged: [], struck: {}, checked: {}, seen: [],
      current: 0, view: 'question', reviewList: null, reviewLabel: '',
      timeLimit: isExam ? Math.max(60, Math.round(ex.durationMinutes * 60 * ratio)) : 0,
      elapsed: 0, warned: false,
      sections, sectionIndex: 0, breaks: breakPoints.map((b) => ({ minutes: b.minutes })), breakRemaining: 0,
      startedAt: new Date().toISOString()
    };
  }

  function beginExam() {
    readIntroFields();
    const ex = getExam(intro.examId);
    const p = store.get(KEYS.prefs, {}); p.candidate = intro.candidate; store.set(KEYS.prefs, Object.assign(prefs, p));
    state = buildSession(ex);
    intro = null;
    save(); startTimer(); renderSession();
  }

  function resumeSession() {
    state = store.get(KEYS.session, null);
    if (!state) return renderHome();
    startTimer(); renderSession();
  }

  function renderSession() {
    if (!state) return renderHome();
    document.title = `${state.examTitle} – ${APP_NAME}`;
    if (state.view === 'break') return renderBreak();
    if (state.view === 'review') return renderReview();
    return renderQuestion();
  }

  const curSection = () => state.sections[state.sectionIndex];
  const isLastSection = () => state.sectionIndex >= state.sections.length - 1;
  function statusOf(i) {
    const sel = state.answers[i] || [];
    const need = state.questions[i].answer.length;
    if (sel.length >= need) return 'complete';
    if (sel.length > 0 || state.seen.includes(i)) return 'incomplete';
    return 'unseen';
  }
  function timerText() {
    return state.timeLimit
      ? `Time remaining <strong>${fmtTime(state.timeLimit - state.elapsed)}</strong>`
      : `Time elapsed <strong>${fmtTime(state.elapsed)}</strong>`;
  }
  const isLow = () => state.timeLimit && state.timeLimit - state.elapsed <= 300;

  function examHeader(showQ) {
    const s = state;
    return `<header class="exam-top">
      <div class="exam-top__title"><span>${h(s.examTitle)}</span>${s.candidate ? `<span class="exam-top__cand">${h(s.candidate)}</span>` : ''}</div>
      <div class="exam-top__meta">
        ${s.sections.length > 1 ? `<span>Section ${s.sectionIndex + 1} of ${s.sections.length}</span>` : ''}
        ${showQ ? `<span>Question ${s.current + 1} of ${s.questions.length}</span>` : ''}
        <span class="timer ${isLow() ? 'is-low' : ''}" id="timer">${timerText()}</span>
      </div></header>`;
  }

  // ---------------------------------------------------------------- question view
  function renderQuestion() {
    const s = state, i = s.current, q = s.questions[i];
    if (!s.seen.includes(i)) s.seen.push(i);
    const sel = s.answers[i] || [], struck = s.struck[i] || [], flagged = s.flagged.includes(i);
    const checked = s.mode === 'practice' && s.checked[i];
    const sec = curSection();
    const pos = s.reviewList ? s.reviewList.indexOf(i) : -1;
    const atFirst = s.reviewList ? pos <= 0 : i <= sec.start;
    const atLast = s.reviewList ? pos === s.reviewList.length - 1 || pos < 0 : i >= sec.end;
    const multi = q.type === 'multiple';

    const opts = q.options.map((o, k) => {
      const on = sel.includes(o.id), x = struck.includes(o.id);
      let cls = 'option' + (multi ? ' option--multi' : '') + (on ? ' is-selected' : '') + (x ? ' is-struck' : '');
      if (checked) cls += q.answer.includes(o.id) ? ' is-correct' : on ? ' is-wrong' : '';
      return `<div class="${cls}" role="${multi ? 'checkbox' : 'radio'}" aria-checked="${on}" tabindex="0" data-action="select" data-opt="${h(o.id)}">
        <span class="option__control" aria-hidden="true"></span>
        <span class="option__letter">${letter(k)}.</span>
        <span class="option__text">${rich(o.text)}</span>
        ${checked ? '' : `<button type="button" class="option__strike" data-action="strike" data-opt="${h(o.id)}" aria-label="${x ? 'Remove strikethrough from' : 'Strike out'} option ${letter(k)}">${x ? 'Undo' : 'Strike'}</button>`}
      </div>`;
    }).join('');

    let feedback = '';
    if (s.mode === 'practice') {
      if (checked) {
        const ok = sameSet(sel, q.answer);
        const right = q.options.map((o, k) => (q.answer.includes(o.id) ? letter(k) : null)).filter(Boolean).join(', ');
        feedback = `<div class="feedback ${ok ? 'is-ok' : 'is-bad'}" role="status">
          <p class="feedback__head">${ok ? 'Correct' : 'Incorrect'} <span>· Correct answer: ${right}</span></p>
          ${q.explanation ? `<p>${rich(q.explanation)}</p>` : ''}</div>`;
      } else {
        feedback = `<div class="practice-bar"><button class="btn btn--primary" data-action="check" ${sel.length ? '' : 'disabled'}>Check answer</button></div>`;
      }
    }

    $app.innerHTML = `<div class="exam-shell" style="--q-scale:${prefs.font}">
      ${examHeader(true)}
      <div class="exam-toolbar">
        <button class="tool ${flagged ? 'is-on' : ''}" data-action="flag" aria-pressed="${flagged}"><span aria-hidden="true">⚑</span> ${flagged ? 'Flagged for review' : 'Flag for review'}</button>
        <button class="tool" data-action="calc"><span aria-hidden="true">▦</span> Calculator</button>
        <span class="tool-group" role="group" aria-label="Text size">
          <button class="tool" data-action="font-dec" aria-label="Smaller text">A−</button>
          <button class="tool" data-action="font-inc" aria-label="Larger text">A+</button>
        </span>
        ${s.reviewList ? `<span class="review-mode">Reviewing ${h(s.reviewLabel)}: ${pos >= 0 ? pos + 1 : '–'} of ${s.reviewList.length}</span>` : ''}
      </div>
      <main class="question-pane" id="question-pane">
        <div class="question">
          <p class="question__num">Question ${i + 1}${flagged ? ' <span class="flag-badge">⚑ Flagged</span>' : ''}</p>
          <div class="question__text">${rich(q.text)}</div>
          <p class="question__instr">${multi ? `Select ${q.answer.length}.` : 'Select one.'}</p>
          <div class="options" role="${multi ? 'group' : 'radiogroup'}" aria-label="Answer options">${opts}</div>
          ${feedback}
        </div>
      </main>
      <footer class="exam-bottom">
        <button class="btn btn--bar btn--bar-end" data-action="end-section">${isLastSection() ? 'End exam' : 'End section'}</button>
        <div class="exam-bottom__nav">
          <button class="btn btn--bar" data-action="prev" ${atFirst ? 'disabled' : ''}>◀ Previous</button>
          <button class="btn btn--bar" data-action="review">Review screen</button>
          <button class="btn btn--bar btn--bar-primary" data-action="next">${atLast ? 'Review ▶' : 'Next ▶'}</button>
        </div>
      </footer>
    </div>`;
    save();
  }

  function selectOption(optId) {
    const s = state, i = s.current, q = s.questions[i];
    if (s.mode === 'practice' && s.checked[i]) return;
    let sel = (s.answers[i] || []).slice();
    if (q.type === 'multiple') {
      if (sel.includes(optId)) sel = sel.filter((x) => x !== optId);
      else if (sel.length >= q.answer.length) return toast(`Select only ${q.answer.length}. Deselect an option first.`);
      else sel.push(optId);
    } else {
      sel = [optId];
    }
    if (sel.length) s.answers[i] = sel; else delete s.answers[i];
    if (sel.includes(optId) && s.struck[i]) s.struck[i] = s.struck[i].filter((x) => x !== optId);
    renderQuestion();
    const el = $app.querySelector(`.option[data-opt="${CSS.escape(optId)}"]`);
    if (el) el.focus();
  }

  function strikeOption(optId) {
    const s = state, i = s.current;
    if (s.mode === 'practice' && s.checked[i]) return;
    const list = s.struck[i] || [];
    s.struck[i] = list.includes(optId) ? list.filter((x) => x !== optId) : list.concat(optId);
    if (s.struck[i].includes(optId) && s.answers[i]) {
      s.answers[i] = s.answers[i].filter((x) => x !== optId);
      if (!s.answers[i].length) delete s.answers[i];
    }
    renderQuestion();
  }

  function move(dir) {
    const s = state;
    if (s.reviewList) {
      const p = s.reviewList.indexOf(s.current);
      const np = p + dir;
      if (p < 0 || np >= s.reviewList.length) { s.reviewList = null; s.view = 'review'; }
      else if (np >= 0) s.current = s.reviewList[np];
    } else {
      const sec = curSection();
      if (dir > 0 && s.current >= sec.end) s.view = 'review';
      else s.current = Math.min(sec.end, Math.max(sec.start, s.current + dir));
    }
    renderSession();
    const pane = document.getElementById('question-pane'); if (pane) pane.scrollTop = 0;
  }

  // ---------------------------------------------------------------- review screen
  function renderReview() {
    const s = state, sec = curSection();
    const idx = range(sec.start, sec.end);
    const count = (st) => idx.filter((i) => statusOf(i) === st).length;
    const flagged = idx.filter((i) => s.flagged.includes(i)).length;
    const tiles = idx.map((i) => {
      const st = statusOf(i), f = s.flagged.includes(i);
      return `<button class="tile is-${st} ${f ? 'is-flagged' : ''}" data-action="goto" data-index="${i}" aria-label="Question ${i + 1}, ${st}${f ? ', flagged' : ''}">
        <span class="tile__num">${i + 1}</span><span class="tile__st">${titleCase(st)}</span>${f ? '<span class="tile__flag" aria-hidden="true">⚑</span>' : ''}</button>`;
    }).join('');
    $app.innerHTML = `<div class="exam-shell">
      ${examHeader(false)}
      <main class="question-pane">
        <div class="review">
          <h1>Review screen${s.sections.length > 1 ? ` — Section ${s.sectionIndex + 1}` : ''}</h1>
          <p class="muted">Select a question number to go to it, or use the buttons to review a group of questions in order.
          ${s.sections.length > 1 && !isLastSection() ? 'After you end this section you cannot return to it.' : ''}</p>
          <div class="review__stats">
            <div><strong>${count('complete')}</strong><span>Complete</span></div>
            <div><strong>${count('incomplete')}</strong><span>Incomplete</span></div>
            <div><strong>${count('unseen')}</strong><span>Unseen</span></div>
            <div><strong>${flagged}</strong><span>Flagged</span></div>
          </div>
          <div class="review__filters">
            <button class="btn btn--secondary" data-action="review-filter" data-filter="all">Review all</button>
            <button class="btn btn--secondary" data-action="review-filter" data-filter="incomplete">Review incomplete</button>
            <button class="btn btn--secondary" data-action="review-filter" data-filter="flagged">Review flagged</button>
          </div>
          <div class="tiles">${tiles}</div>
        </div>
      </main>
      <footer class="exam-bottom">
        <button class="btn btn--bar btn--bar-end" data-action="end-section">${isLastSection() ? 'End exam' : 'End section'}</button>
        <div class="exam-bottom__nav"><button class="btn btn--bar btn--bar-primary" data-action="return-question">Return to question ${s.current + 1}</button></div>
      </footer>
    </div>`;
    save();
  }

  function reviewFilter(f) {
    const s = state, sec = curSection();
    const idx = range(sec.start, sec.end);
    const list = f === 'flagged' ? idx.filter((i) => s.flagged.includes(i))
      : f === 'incomplete' ? idx.filter((i) => statusOf(i) !== 'complete') : idx;
    if (!list.length) return toast(f === 'flagged' ? 'No flagged questions in this section.' : 'Every question in this section is complete.');
    s.reviewList = list; s.reviewLabel = f; s.current = list[0]; s.view = 'question';
    renderSession();
  }

  function endSection() {
    const s = state, idx = range(curSection().start, curSection().end);
    const inc = idx.filter((i) => statusOf(i) !== 'complete').length;
    const fl = idx.filter((i) => s.flagged.includes(i)).length;
    const last = isLastSection();
    showModal({
      title: last ? 'End the exam?' : 'End this section?',
      body: `<p>This ${last && s.sections.length === 1 ? 'exam' : 'section'} has <strong>${inc}</strong> incomplete and <strong>${fl}</strong> flagged question${fl === 1 ? '' : 's'}.</p>
        <p>${last ? 'Once you end the exam you cannot change any answers, and your exam will be scored.' : 'Once you end this section you cannot return to its questions.'}</p>`,
      actions: [{ label: 'Return to exam' }, { label: last ? 'End exam' : 'End section', danger: true, onClick: () => (last ? finishExam() : startBreak()) }]
    });
  }

  // ---------------------------------------------------------------- breaks
  function startBreak() {
    const b = state.breaks[state.sectionIndex] || { minutes: 10 };
    state.view = 'break'; state.reviewList = null; state.breakRemaining = b.minutes * 60;
    renderSession();
  }
  function renderBreak() {
    const s = state;
    $app.innerHTML = `<div class="exam-shell">
      ${examHeader(false)}
      <main class="question-pane"><div class="break">
        <h1>Optional break</h1>
        <p>Section ${s.sectionIndex + 1} is complete and locked. The exam clock is paused while you are on break.</p>
        <p class="break__clock" id="break-timer">${fmtTime(s.breakRemaining)}</p>
        <p class="muted">Section ${s.sectionIndex + 2} starts automatically when the break time ends.</p>
        <button class="btn btn--primary btn--large" data-action="end-break">Start section ${s.sectionIndex + 2} now</button>
      </div></main>
    </div>`;
    save();
  }
  function endBreak() {
    const s = state;
    s.sectionIndex++; s.current = curSection().start; s.view = 'question'; s.breakRemaining = 0;
    renderSession();
  }

  // ---------------------------------------------------------------- timer
  function tick() {
    const s = state;
    if (!s) return stopTimer();
    if (s.view === 'break') {
      s.breakRemaining--;
      if (s.breakRemaining <= 0) return endBreak();
      const el = document.getElementById('break-timer'); if (el) el.textContent = fmtTime(s.breakRemaining);
    } else {
      s.elapsed++;
      if (s.timeLimit) {
        const rem = s.timeLimit - s.elapsed;
        if (rem <= 300 && !s.warned) { s.warned = true; toast('5 minutes remaining.'); }
        if (rem <= 0) {
          closeModal();
          finishExam({ timeUp: true });
          return showModal({ title: 'Time is up', body: '<p>The exam time has expired. Your answers have been submitted and scored.</p>' });
        }
      }
      const el = document.getElementById('timer');
      if (el) { el.innerHTML = timerText(); el.classList.toggle('is-low', !!isLow()); }
    }
    save();
  }

  // ---------------------------------------------------------------- scoring
  function rating(p) {
    const bands = CFG.ratingBands || [{ min: 0, label: '', cls: 'target' }];
    return bands.find((b) => p >= b.min) || bands[bands.length - 1];
  }

  function finishExam(opts) {
    stopTimer(); closeCalc();
    const s = state;
    const items = s.questions.map((q, i) => {
      const response = s.answers[i] || [];
      return { text: q.text, domain: q.domain, type: q.type, options: q.options, answer: q.answer, response,
        correct: sameSet(response, q.answer), explanation: q.explanation, flagged: s.flagged.includes(i) };
    });
    const correct = items.filter((x) => x.correct).length;
    const percent = Math.round((correct / items.length) * 100);
    const byDomain = {};
    items.forEach((x) => { const d = byDomain[x.domain] || (byDomain[x.domain] = { key: x.domain, correct: 0, total: 0 }); d.total++; if (x.correct) d.correct++; });
    const domains = Object.values(byDomain).map((d) => Object.assign(d, { name: domainName(s.domains, d.key), percent: Math.round((d.correct / d.total) * 100) }));
    const result = {
      id: 'r' + Date.now(), examId: s.examId, examTitle: s.examTitle, mode: s.mode, candidate: s.candidate,
      date: new Date().toISOString(), total: items.length, correct, percent, passingScore: s.passingScore,
      passed: percent >= s.passingScore, timeUsed: s.elapsed, timeLimit: s.timeLimit,
      timeUp: !!(opts && opts.timeUp), domains, items
    };
    const hist = store.get(KEYS.history, []);
    hist.unshift(result);
    store.set(KEYS.history, hist.slice(0, CFG.historyLimit || 25));
    store.del(KEYS.session);
    state = null;
    viewing = { result, filter: null };
    renderResults();
    // SUPABASE: also save the score to the signed-in user's account.
    if (AUTH && AUTH.user) {
      AUTH.saveAttempt(result).then(({ error }) => {
        toast(error ? 'Could not save this result online. It is kept in this browser.' : 'Result saved to your account.');
        if (error && window.console) console.warn('Supabase save failed:', error.message || error);
      });
    }
  }

  // ================================================================ RESULTS
  function renderResults() {
    const r = viewing.result;
    const answered = r.items.filter((x) => x.response.length).length;
    const rows = r.domains.map((d) => {
      const rt = rating(d.percent);
      return `<tr><th scope="row">${h(d.name)}</th><td class="num">${d.correct} / ${d.total}</td>
        <td class="bar-cell"><div class="bar" role="img" aria-label="${d.percent}%"><span class="bar__fill bar__fill--${rt.cls}" style="width:${d.percent}%"></span></div></td>
        <td class="num">${d.percent}%</td><td><span class="rating rating--${rt.cls}">${h(rt.label)}</span></td></tr>`;
    }).join('');
    $app.innerHTML = `${topbar()}
      <main class="page">
        <section class="score ${r.passed ? 'is-pass' : 'is-fail'}">
          <div class="score__main">
            <p class="score__label">${r.mode === 'practice' ? 'Practice result' : 'Exam result'}${r.timeUp ? ' · time expired' : ''}</p>
            <h1>${r.passed ? 'Pass' : 'Did not pass'}</h1>
            <p>${h(r.examTitle)}${r.candidate ? ` · ${h(r.candidate)}` : ''} · ${h(new Date(r.date).toLocaleString())}</p>
          </div>
          <div class="score__num"><strong>${r.percent}%</strong><span>Pass mark ${r.passingScore}%</span></div>
        </section>
        <section class="stats">
          <div><strong>${r.correct} / ${r.total}</strong><span>Correct</span></div>
          <div><strong>${answered}</strong><span>Answered</span></div>
          <div><strong>${r.items.filter((x) => x.flagged).length}</strong><span>Flagged</span></div>
          <div><strong>${fmtTime(r.timeUsed)}</strong><span>${r.timeLimit ? `of ${fmtTime(r.timeLimit)} used` : 'Time spent'}</span></div>
        </section>
        <section class="card">
          <h2 class="card__title">Performance by domain</h2>
          <div class="table-wrap"><table class="table table--domains">
            <thead><tr><th>Domain</th><th class="num">Correct</th><th>Score</th><th class="num">%</th><th>Rating</th></tr></thead>
            <tbody>${rows}</tbody></table></div>
          <p class="muted small">Ratings: ${(CFG.ratingBands || []).map((b) => `${h(b.label)} ≥ ${b.min}%`).join(' · ')}</p>
        </section>
        <div class="actions-row no-print">
          <button class="btn btn--primary" data-action="show-answers">Review answers</button>
          <button class="btn btn--secondary" data-action="retake" data-id="${h(r.examId)}">Retake exam</button>
          <button class="btn btn--secondary" data-action="print">Print / save PDF</button>
          <button class="btn btn--ghost" data-action="home">Home</button>
        </div>
        <div id="answers"></div>
      </main>`;
    window.scrollTo(0, 0);
    document.title = `Score report – ${APP_NAME}`;
  }

  function renderAnswers(filter) {
    const r = viewing.result;
    viewing.filter = filter;
    const pred = {
      all: () => true, incorrect: (x) => !x.correct, correct: (x) => x.correct,
      flagged: (x) => x.flagged, unanswered: (x) => !x.response.length
    }[filter] || (() => true);
    const list = r.items.map((x, i) => ({ x, i })).filter(({ x }) => pred(x));
    const filters = ['all', 'incorrect', 'correct', 'flagged', 'unanswered'];
    const cards = list.map(({ x, i }) => `
      <article class="answer ${x.correct ? 'is-ok' : 'is-bad'}">
        <header class="answer__head"><span>Question ${i + 1} · ${h((r.domains.find((d) => d.key === x.domain) || { name: titleCase(x.domain) }).name)}</span>
          <span class="result-tag ${x.correct ? 'is-pass' : 'is-fail'}">${x.correct ? 'Correct' : x.response.length ? 'Incorrect' : 'Unanswered'}</span>${x.flagged ? '<span class="flag-badge">⚑ Flagged</span>' : ''}</header>
        <div class="question__text">${rich(x.text)}</div>
        <ul class="answer__opts">${x.options.map((o, k) => {
          const isAns = x.answer.includes(o.id), picked = x.response.includes(o.id);
          return `<li class="${isAns ? 'is-correct' : picked ? 'is-wrong' : ''}"><span class="option__letter">${letter(k)}.</span>
            <span>${rich(o.text)}</span>${isAns ? '<span class="tag tag--ok">Correct answer</span>' : ''}${picked ? '<span class="tag">Your answer</span>' : ''}</li>`;
        }).join('')}</ul>
        ${x.explanation ? `<div class="answer__exp"><strong>Explanation.</strong> ${rich(x.explanation)}</div>` : ''}
      </article>`).join('') || '<p class="muted">No questions match this filter.</p>';
    document.getElementById('answers').innerHTML = `
      <section class="answers">
        <h2 class="section-title">Answer review</h2>
        <div class="segmented no-print" role="group" aria-label="Filter answers">${filters.map((f) =>
          `<button class="${f === filter ? 'is-on' : ''}" data-action="answers-filter" data-filter="${f}" aria-pressed="${f === filter}">${titleCase(f)}</button>`).join('')}</div>
        ${cards}
      </section>`;
  }

  // ================================================================ CALCULATOR
  function evaluate(src) {
    const s = src.replace(/\s+/g, '').replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
    let i = 0;
    const num = () => {
      const m = /^(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/i.exec(s.slice(i));
      if (!m) throw new Error('syntax'); i += m[0].length; return parseFloat(m[0]);
    };
    const factor = () => {
      const c = s[i];
      if (c === '-') { i++; return -factor(); }
      if (c === '+') { i++; return factor(); }
      if (c === '(') { i++; const v = expr(); if (s[i] !== ')') throw new Error('syntax'); i++; return v; }
      return num();
    };
    const term = () => { let v = factor(); while (s[i] === '*' || s[i] === '/') { const op = s[i++]; const r = factor(); v = op === '*' ? v * r : v / r; } return v; };
    const expr = () => { let v = term(); while (s[i] === '+' || s[i] === '-') { const op = s[i++]; const r = term(); v = op === '+' ? v + r : v - r; } return v; };
    const v = expr();
    if (i !== s.length || !isFinite(v)) throw new Error('syntax');
    return Math.round(v * 1e10) / 1e10;
  }
  function closeCalc() { const c = document.getElementById('calc'); if (c) c.remove(); }
  function toggleCalc() {
    if (document.getElementById('calc')) return closeCalc();
    const keys = ['C', '⌫', '√', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '(', '0', '.', ')', '='];
    const el = document.createElement('div');
    el.id = 'calc'; el.className = 'calc'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Calculator');
    el.innerHTML = `<div class="calc__head"><span>Calculator</span><button type="button" class="calc__close" aria-label="Close calculator">×</button></div>
      <input class="calc__display" aria-label="Calculator display" autocomplete="off" spellcheck="false">
      <div class="calc__keys">${keys.map((k) => `<button type="button" data-k="${k}" class="${k === '=' ? 'calc__eq' : /[÷×−+√]/.test(k) ? 'calc__op' : ''}">${k}</button>`).join('')}</div>`;
    document.body.appendChild(el);
    const d = el.querySelector('.calc__display');
    const run = (fn) => { try { d.value = String(fn()); } catch (e) { d.value = 'Error'; } };
    el.querySelector('.calc__close').addEventListener('click', closeCalc);
    el.querySelector('.calc__keys').addEventListener('click', (e) => {
      const k = e.target.closest('button') && e.target.closest('button').dataset.k;
      if (!k) return;
      if (d.value === 'Error') d.value = '';
      if (k === 'C') d.value = '';
      else if (k === '⌫') d.value = d.value.slice(0, -1);
      else if (k === '=') run(() => evaluate(d.value || '0'));
      else if (k === '√') run(() => { const v = evaluate(d.value || '0'); if (v < 0) throw new Error('neg'); return Math.round(Math.sqrt(v) * 1e10) / 1e10; });
      else d.value += ({ '÷': '/', '×': '*', '−': '-' })[k] || k;
      d.focus();
    });
    d.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(() => evaluate(d.value || '0')); } e.stopPropagation(); });
    // drag by header
    const head = el.querySelector('.calc__head');
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const r = el.getBoundingClientRect(), ox = e.clientX - r.left, oy = e.clientY - r.top;
      const mv = (ev) => {
        el.style.left = Math.max(0, Math.min(window.innerWidth - r.width, ev.clientX - ox)) + 'px';
        el.style.top = Math.max(0, Math.min(window.innerHeight - r.height, ev.clientY - oy)) + 'px';
        el.style.right = 'auto'; el.style.bottom = 'auto';
      };
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    });
    d.focus();
  }

  // ================================================================ EVENTS
  const actions = {
    home: () => { if (state) { save(); } renderHome(); },
    resume: resumeSession,
    discard: () => showModal({
      title: 'Discard exam in progress?', body: '<p>Your answers for this attempt will be lost.</p>',
      actions: [{ label: 'Cancel' }, { label: 'Discard', danger: true, onClick: () => { store.del(KEYS.session); renderHome(); } }]
    }),
    'open-exam': (el) => openExam(el.dataset.id),
    'remove-custom': (el) => showModal({
      title: 'Remove imported exam?', body: '<p>This removes it from this browser. Your past results stay in your history.</p>',
      actions: [{ label: 'Cancel' }, { label: 'Remove', danger: true, onClick: () => {
        store.set(KEYS.custom, store.get(KEYS.custom, []).filter((d) => String(d.id) !== el.dataset.id)); loadExams(); renderHome();
      } }]
    }),
    template: downloadTemplate,
    'clear-history': () => showModal({
      title: 'Clear all attempts?', body: '<p>This permanently deletes your saved score reports from this browser.</p>',
      actions: [{ label: 'Cancel' }, { label: 'Clear history', danger: true, onClick: () => { store.del(KEYS.history); renderHome(); } }]
    }),
    'view-result': (el) => {
      const r = store.get(KEYS.history, []).find((x) => x.id === el.dataset.id);
      if (r) { viewing = { result: r, filter: null }; renderResults(); }
    },
    'intro-next': () => {
      readIntroFields();
      if (intro.step === 1 && !intro.agreed) return toast('Please accept the agreement to continue.');
      intro.step++; renderIntro();
    },
    'intro-back': () => { readIntroFields(); intro.step--; renderIntro(); },
    'intro-begin': beginExam,
    select: (el) => selectOption(el.dataset.opt),
    strike: (el) => strikeOption(el.dataset.opt),
    flag: () => {
      const i = state.current;
      state.flagged = state.flagged.includes(i) ? state.flagged.filter((x) => x !== i) : state.flagged.concat(i);
      renderQuestion();
    },
    check: () => { state.checked[state.current] = true; renderQuestion(); },
    prev: () => move(-1),
    next: () => move(1),
    review: () => { state.reviewList = null; state.view = 'review'; renderSession(); },
    'return-question': () => { state.view = 'question'; renderSession(); },
    goto: (el) => { state.reviewList = null; state.current = Number(el.dataset.index); state.view = 'question'; renderSession(); },
    'review-filter': (el) => reviewFilter(el.dataset.filter),
    'end-section': endSection,
    'end-break': endBreak,
    calc: toggleCalc,
    'font-inc': () => { prefs.font = Math.min(1.5, +(prefs.font + 0.1).toFixed(1)); store.set(KEYS.prefs, prefs); renderQuestion(); },
    'font-dec': () => { prefs.font = Math.max(0.8, +(prefs.font - 0.1).toFixed(1)); store.set(KEYS.prefs, prefs); renderQuestion(); },
    'show-answers': () => { renderAnswers(viewing.filter || 'all'); document.getElementById('answers').scrollIntoView({ behavior: 'smooth' }); },
    'answers-filter': (el) => renderAnswers(el.dataset.filter),
    retake: (el) => openExam(el.dataset.id),
    print: () => { if (!viewing.filter) renderAnswers('all'); window.print(); },
    'sign-out': () => {
      const out = () => { if (state) { save(); stopTimer(); } AUTH.signOut(); };
      if (state) {
        return showModal({
          title: 'Sign out during an exam?', body: '<p>Your progress is kept in this browser, and you can resume after signing back in.</p>',
          actions: [{ label: 'Cancel' }, { label: 'Sign out', danger: true, onClick: out }]
        });
      }
      out();
    }
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.action];
    if (fn) { e.preventDefault(); fn(el, e); }
  });

  document.addEventListener('contextmenu', (e) => {
    const opt = e.target.closest('.option[data-opt]');
    if (opt && state && state.view === 'question') { e.preventDefault(); strikeOption(opt.dataset.opt); }
  });

  document.addEventListener('keydown', (e) => {
    if (document.querySelector('.modal-backdrop')) return;
    if (e.target.closest && e.target.closest('#calc')) return;
    const opt = e.target.closest && e.target.closest('.option[data-opt]');
    if (opt && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); return selectOption(opt.dataset.opt); }
    if (!state || state.view === 'break' || !e.altKey) return;
    const k = e.key.toLowerCase();
    const map = state.view === 'question'
      ? { n: 'next', p: 'prev', f: 'flag', r: 'review' }
      : { r: 'return-question' };
    if (map[k]) {
      e.preventDefault();
      const btn = $app.querySelector(`[data-action="${map[k]}"]`);
      if (btn && !btn.disabled) actions[map[k]](btn);
    }
  });

  // ---------------------------------------------------------------- boot
  function boot() {
    // SUPABASE: keep each user's in-progress exam and history separate on shared computers.
    if (AUTH && AUTH.user) ['session', 'history', 'custom'].forEach((k) => { KEYS[k] += '.' + AUTH.user.id; });
    loadExams();
    renderHome();
  }
  if (AUTH) AUTH.onSignedIn(boot); else boot();
})();
