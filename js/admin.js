/* ExamSim – admin page: registered users and saved results.
   Admins can change roles and block/unblock users; trainers can view only.
   Everything here is enforced again by the database rules in supabase/setup.sql. */
(function () {
  'use strict';

  const AUTH = window.ExamAuth;
  const APP_NAME = (window.APP_CONFIG && window.APP_CONFIG.name) || 'ExamSim';
  const $app = document.getElementById('app');
  const h = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (d) => (d ? new Date(d).toLocaleString() : '');
  const pad = (n) => String(n).padStart(2, '0');
  // Time as h:mm:ss (total time used, and average per question)
  const fmtClock = (sec) => {
    if (sec == null) return '';
    sec = Math.max(0, Math.round(sec));
    return `${Math.floor(sec / 3600)}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`;
  };
  const avgPerQ = (a) => (a.time_used_seconds == null || !a.total_questions ? null : a.time_used_seconds / a.total_questions);
  const noPassMark = (a) => a.passing_score == null;   // practice-only exams have no pass mark

  let profiles = [];
  let attempts = [];
  let examRows = [];
  let examsMissing = '';   // set when the exams table has not been created yet
  let notice = null;       // { kind: 'error' | 'ok', title, text } shown above the exams table
  let tab = 'users';
  let filter = '';

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('is-out'), 2600);
    setTimeout(() => t.remove(), 3000);
  }

  function header() {
    return `<header class="appbar"><a class="appbar__brand" href="./"><span class="appbar__logo" aria-hidden="true">✓</span><span>${h(APP_NAME)}</span></a>
      <span class="appbar__tag">Admin</span>
      <span class="appbar__user"><span class="appbar__name">${h(AUTH.displayName())} · ${h(AUTH.profile.role)}</span>
      <a class="btn btn--small btn--secondary" href="./">Exams</a>
      <button class="btn btn--small btn--secondary" data-action="sign-out">Sign out</button></span></header>`;
  }

  async function load() {
    const c = AUTH.client;
    const [p, a, x] = await Promise.all([
      c.from('profiles').select('*').order('created_at', { ascending: false }),
      c.from('attempts').select('*').order('created_at', { ascending: false }).limit(2000),
      c.from('exams').select('*').order('category').order('title')
    ]);
    if (p.error) throw p.error;
    if (a.error) throw a.error;
    profiles = p.data || [];
    attempts = a.data || [];
    examsMissing = x.error ? x.error.message : '';
    examRows = x.error ? [] : (x.data || []);
  }

  const byId = () => Object.fromEntries(profiles.map((p) => [p.id, p]));

  function stats() {
    const since = Date.now() - 30 * 864e5;
    const exams = attempts.filter((a) => a.mode === 'exam');
    const passRate = exams.length ? Math.round((exams.filter((a) => a.passed).length / exams.length) * 100) : null;
    const activeUsers = new Set(attempts.filter((a) => Date.parse(a.created_at) >= since).map((a) => a.user_id)).size;
    return `<div class="stats">
      <div><strong>${profiles.length}</strong><span>Registered users</span></div>
      <div><strong>${activeUsers}</strong><span>Took an exam in the last 30 days</span></div>
      <div><strong>${attempts.length}</strong><span>Saved attempts</span></div>
      <div><strong>${passRate == null ? '–' : passRate + '%'}</strong><span>Pass rate (exam mode)</span></div>
    </div>`;
  }

  function usersTable() {
    const isAdmin = AUTH.isAdmin();
    const counts = {}; const last = {};
    attempts.forEach((a) => { counts[a.user_id] = (counts[a.user_id] || 0) + 1; if (!last[a.user_id]) last[a.user_id] = a.created_at; });
    const q = filter.toLowerCase();
    const rows = profiles.filter((p) => !q || `${p.full_name} ${p.email} ${p.role}`.toLowerCase().includes(q)).map((p) => {
      const me = p.id === AUTH.user.id;
      const roleCell = isAdmin && !me
        ? `<select class="admin-select" data-action="role" data-id="${h(p.id)}" aria-label="Role for ${h(p.email)}">
            ${['student', 'trainer', 'admin'].map((r) => `<option value="${r}" ${p.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select>`
        : h(p.role);
      const actions = isAdmin && !me
        ? `<button class="btn btn--small ${p.is_active ? 'btn--secondary' : 'btn--primary'}" data-action="toggle-active" data-id="${h(p.id)}">${p.is_active ? 'Block' : 'Unblock'}</button>`
        : '';
      return `<tr>
        <td>${h(p.full_name) || '<span class="muted">(no name)</span>'}${me ? ' <span class="pill">you</span>' : ''}</td>
        <td>${h(p.email)}</td><td>${roleCell}</td>
        <td><span class="result-tag ${p.is_active ? 'is-pass' : 'is-fail'}">${p.is_active ? 'Active' : 'Blocked'}</span></td>
        <td>${h(fmtDate(p.created_at))}</td>
        <td class="num">${counts[p.id] || 0}</td><td>${h(fmtDate(last[p.id]))}</td>
        <td class="num">${actions}</td></tr>`;
    }).join('');
    return `<div class="table-wrap"><table class="table">
      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Registered</th><th class="num">Attempts</th><th>Last attempt</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="8" class="muted">No users match.</td></tr>'}</tbody></table></div>
      <p class="muted small">To delete an account completely, or to send someone a password-reset email, use the Supabase dashboard: Authentication → Users.</p>`;
  }

  function examsTable() {
    const isAdmin = AUTH.isAdmin();
    if (examsMissing) {
      return `<div class="notice notice--error"><strong>The exams table is not set up yet.</strong>
        Run <code>supabase/setup-exams.sql</code> in the Supabase SQL Editor, then click Refresh.<br><span class="small">${h(examsMissing)}</span></div>`;
    }
    const q = filter.toLowerCase();
    const counts = {};
    attempts.forEach((a) => { counts[a.exam_id] = (counts[a.exam_id] || 0) + 1; });
    const rows = examRows.filter((r) => !q || `${r.title} ${r.category} ${r.id} ${r.level}`.toLowerCase().includes(q)).map((r) => {
      let types = '';
      try { types = window.ExamFormat.typeSummary(window.ExamFormat.normalize(r.definition)); } catch (e) { types = 'File has errors'; }
      return `<tr>
        <td><strong>${h(r.title)}</strong><br><span class="muted small">${h(types)}</span><br><span class="muted small">id: ${h(r.id)}</span></td>
        <td>${h(r.category)}${r.level ? `<br><span class="muted small">${h(r.level)}</span>` : ''}</td>
        <td class="num">${r.question_count}</td>
        <td><span class="result-tag ${r.published ? 'is-pass' : 'is-fail'}">${r.published ? 'Published' : 'Hidden'}</span><br><span class="muted small">${h(fmtDate(r.updated_at))}</span></td>
        <td class="num">${counts[r.id] || 0}</td>
        <td class="num admin-actions">
          ${isAdmin ? `<button class="btn btn--small ${r.published ? 'btn--secondary' : 'btn--primary'}" data-action="exam-publish" data-id="${h(r.id)}">${r.published ? 'Hide' : 'Publish'}</button>` : ''}
          <button class="btn btn--small btn--secondary" data-action="exam-download" data-id="${h(r.id)}">Download</button>
          ${isAdmin ? `<button class="btn btn--small btn--ghost" data-action="exam-delete" data-id="${h(r.id)}">Delete</button>` : ''}
        </td></tr>`;
    }).join('');
    const box = notice ? `<div class="notice notice--${notice.kind}" role="status"><strong>${h(notice.title)}</strong> ${h(notice.text)}
      <button type="button" class="link-btn" data-action="notice-close">Close</button></div>` : '';
    return `${box}<div class="table-wrap"><table class="table table--exams">
      <thead><tr><th>Exam</th><th>Category</th><th class="num">Questions</th><th>Status</th><th class="num">Attempts</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6" class="muted">${examRows.length ? 'No exams match.' : 'No exams uploaded yet. Click Upload JSON to add one.'}</td></tr>`}</tbody></table></div>
      <p class="muted small">New uploads start <strong>Hidden</strong>: open the Exams page to try them, then click <strong>Publish</strong>.
      Uploading a file with the same <code>id</code> replaces that exam and keeps its status.</p>`;
  }

  function filteredAttempts() {
    const people = byId(); const q = filter.toLowerCase();
    return attempts.filter((a) => {
      const p = people[a.user_id] || {};
      return !q || `${p.full_name} ${p.email} ${a.exam_title} ${a.exam_id}`.toLowerCase().includes(q);
    });
  }

  function resultsTable() {
    const people = byId();
    const rows = filteredAttempts().map((a) => {
      const p = people[a.user_id] || {};
      return `<tr><td>${h(fmtDate(a.created_at))}</td><td>${h(p.full_name)}</td><td>${h(p.email)}</td>
        <td>${h(a.exam_title || a.exam_id)}</td><td>${a.mode === 'practice' ? 'Practice' : 'Exam'}</td>
        <td class="num">${a.percent}%</td>
        <td>${noPassMark(a) ? '<span class="muted">–</span>' : `<span class="result-tag ${a.passed ? 'is-pass' : 'is-fail'}">${a.passed ? 'Pass' : 'Fail'}</span>`}</td>
        <td class="num">${h(fmtClock(a.time_used_seconds))}${a.time_up ? ' (time up)' : ''}</td>
        <td class="num">${h(fmtClock(avgPerQ(a)))}</td>
        <td class="cell-wrap small">${(a.domains || []).map((d) => `${h(d.name)} ${d.percent}%`).join(' · ')}</td></tr>`;
    }).join('');
    return `<div class="table-wrap"><table class="table">
      <thead><tr><th>Date</th><th>Name</th><th>Email</th><th>Exam</th><th>Mode</th><th class="num">Score</th><th>Result</th><th class="num">Total time</th><th class="num">Avg / question</th><th>By domain</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="10" class="muted">No results yet.</td></tr>'}</tbody></table></div>`;
  }

  function render() {
    const keepFocus = document.activeElement && document.activeElement.id === 'admin-search';
    $app.innerHTML = `${header()}
      <main class="page">
        <section><h1>Users and results</h1></section>
        ${stats()}
        <section class="card">
          <div class="admin-bar">
            <div class="segmented" role="tablist">
              <button type="button" role="tab" data-action="tab" data-tab="users" class="${tab === 'users' ? 'is-on' : ''}">Users (${profiles.length})</button>
              <button type="button" role="tab" data-action="tab" data-tab="results" class="${tab === 'results' ? 'is-on' : ''}">Results (${attempts.length})</button>
              <button type="button" role="tab" data-action="tab" data-tab="exams" class="${tab === 'exams' ? 'is-on' : ''}">Exams (${examRows.length})</button>
            </div>
            <input id="admin-search" class="admin-search" type="search" placeholder="${tab === 'exams' ? 'Search exam title or category' : 'Search name, email or exam'}" value="${h(filter)}" aria-label="Search">
            <button class="btn btn--small btn--secondary" data-action="refresh">Refresh</button>
            ${tab === 'results' ? '<button class="btn btn--small btn--primary" data-action="csv">Export CSV</button>' : ''}
            ${tab === 'exams' ? `<button class="btn btn--small btn--secondary" data-action="template">Download template</button>
              ${AUTH.isAdmin() && !examsMissing ? '<label class="btn btn--small btn--primary file-btn">Upload JSON<input type="file" accept=".json,application/json" id="exam-file" hidden></label>' : ''}` : ''}
          </div>
          ${tab === 'users' ? usersTable() : tab === 'results' ? resultsTable() : examsTable()}
        </section>
      </main>`;
    const s = document.getElementById('admin-search');
    s.addEventListener('input', () => { filter = s.value; render(); });
    if (keepFocus) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    const ef = document.getElementById('exam-file');
    if (ef) ef.addEventListener('change', () => { const f = ef.files && ef.files[0]; ef.value = ''; if (f) uploadExam(f); });
    document.title = `Admin – ${APP_NAME}`;
  }

  function downloadCsv() {
    const people = byId();
    const cols = ['date', 'name', 'email', 'exam_id', 'exam_title', 'mode', 'percent', 'correct', 'total_questions', 'passed', 'time_used_minutes', 'time_up', 'total_time', 'avg_time_per_question'];
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [cols.join(',')].concat(filteredAttempts().map((a) => {
      const p = people[a.user_id] || {};
      return [a.created_at, p.full_name, p.email, a.exam_id, a.exam_title, a.mode, a.percent, a.correct, a.total_questions,
        noPassMark(a) ? '' : a.passed, a.time_used_seconds == null ? '' : Math.round(a.time_used_seconds / 60), a.time_up,
        fmtClock(a.time_used_seconds), fmtClock(avgPerQ(a))].map(esc).join(',');
    }));
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `examsim-results-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  async function updateUser(id, changes) {
    const { error } = await AUTH.client.rpc('admin_update_user', Object.assign({ target_id: id }, changes));
    if (error) { toast(error.message); return; }
    const p = profiles.find((x) => x.id === id);
    if (p) { if (changes.new_role) p.role = changes.new_role; if (changes.new_active != null) p.is_active = changes.new_active; }
    toast('Saved.');
    render();
  }

  function saveFile(name, text, type) {
    const blob = new Blob([text], { type });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = name;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  async function uploadExam(file) {
    let def; let ex;
    try { def = JSON.parse(await file.text()); } catch (e) {
      notice = { kind: 'error', title: `"${file.name}" is not valid JSON.`, text: `${e.message}. Check for a missing comma, quote or bracket near that position.` };
      return render();
    }
    try { ex = window.ExamFormat.normalize(def); } catch (e) {
      notice = { kind: 'error', title: `Please fix "${file.name}" and upload it again:`, text: e.message };
      return render();
    }
    const existing = examRows.find((r) => r.id === ex.id);
    const summary = `${ex.questions.length} questions: ${window.ExamFormat.typeSummary(ex)}`;
    const ok = confirm(existing
      ? `Replace "${existing.title}" with this file (${summary})?\n\nIt stays ${existing.published ? 'published' : 'hidden'}.`
      : `Upload "${ex.title}" (${summary}) to the "${ex.category}" category?\n\nIt stays hidden from students until you click Publish.`);
    if (!ok) return;
    const row = { id: ex.id, title: ex.title, category: ex.category, level: ex.level || null, question_count: ex.questions.length,
      definition: def, updated_at: new Date().toISOString(), updated_by: AUTH.user.id };
    if (!existing) row.published = false;
    const { error } = await AUTH.client.from('exams').upsert(row, { onConflict: 'id' });
    if (error) { notice = { kind: 'error', title: 'Upload failed:', text: error.message }; return render(); }
    notice = { kind: 'ok', title: existing ? 'Exam replaced.' : 'Exam uploaded (hidden).', text: existing ? '' : 'Try it from the Exams page, then click Publish.' };
    tab = 'exams';
    await refresh();
  }

  async function setPublished(id, value) {
    const { error } = await AUTH.client.from('exams').update({ published: value, updated_at: new Date().toISOString(), updated_by: AUTH.user.id }).eq('id', id);
    if (error) { toast(error.message); return; }
    const r = examRows.find((x) => x.id === id); if (r) r.published = value;
    toast(value ? 'Published: students can see it now.' : 'Hidden from students.');
    render();
  }

  async function deleteExam(id) {
    const r = examRows.find((x) => x.id === id);
    if (!r || !confirm(`Delete "${r.title}"?\n\nStudents' past results stay. Download the file first if you may need it again.`)) return;
    const { error } = await AUTH.client.from('exams').delete().eq('id', id);
    if (error) { toast(error.message); return; }
    examRows = examRows.filter((x) => x.id !== id);
    toast('Deleted.');
    render();
  }

  async function refresh() {
    try { await load(); render(); } catch (e) { toast('Could not load: ' + (e.message || e)); }
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled || el.tagName === 'SELECT') return;
    const a = el.dataset.action;
    if (a === 'sign-out') { e.preventDefault(); AUTH.signOut(); }
    if (a === 'tab') { tab = el.dataset.tab; render(); }
    if (a === 'refresh') refresh();
    if (a === 'csv') downloadCsv();
    if (a === 'template') saveFile('examsim-template.json', JSON.stringify(window.ExamFormat.template(), null, 2), 'application/json');
    if (a === 'notice-close') { notice = null; render(); }
    if (a === 'exam-publish') { const r = examRows.find((x) => x.id === el.dataset.id); if (r) setPublished(r.id, !r.published); }
    if (a === 'exam-download') { const r = examRows.find((x) => x.id === el.dataset.id); if (r) saveFile(`${r.id}.json`, JSON.stringify(r.definition, null, 2), 'application/json'); }
    if (a === 'exam-delete') deleteExam(el.dataset.id);
    if (a === 'toggle-active') {
      const p = profiles.find((x) => x.id === el.dataset.id);
      if (p && (p.is_active ? confirm(`Block ${p.email}? They will not be able to take exams until unblocked.`) : true)) {
        updateUser(p.id, { new_active: !p.is_active });
      }
    }
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.action === 'role') updateUser(el.dataset.id, { new_role: el.value });
  });

  AUTH.onSignedIn(async () => {
    if (!AUTH.isStaff()) {
      $app.innerHTML = `<header class="appbar"><a class="appbar__brand" href="./"><span class="appbar__logo" aria-hidden="true">✓</span><span>${h(APP_NAME)}</span></a></header>
        <main class="page auth-page"><section class="card auth-card"><h1 class="card__title">Admins and trainers only</h1>
        <p class="muted">Your account is a student account. Ask an admin if you need access.</p>
        <div class="card__actions card__actions--start"><a class="btn btn--primary" href="./">Go to exams</a></div></section></main>`;
      return;
    }
    $app.innerHTML = `${header()}<main class="page"><p class="muted">Loading…</p></main>`;
    await refresh();
  });
})();
