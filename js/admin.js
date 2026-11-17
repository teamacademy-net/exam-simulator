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
  const fmtMin = (sec) => (sec == null ? '' : `${Math.round(sec / 60)} min`);

  let profiles = [];
  let attempts = [];
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
    const [p, a] = await Promise.all([
      c.from('profiles').select('*').order('created_at', { ascending: false }),
      c.from('attempts').select('*').order('created_at', { ascending: false }).limit(2000)
    ]);
    if (p.error) throw p.error;
    if (a.error) throw a.error;
    profiles = p.data || [];
    attempts = a.data || [];
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
        <td><span class="result-tag ${a.passed ? 'is-pass' : 'is-fail'}">${a.passed ? 'Pass' : 'Fail'}</span></td>
        <td class="num">${h(fmtMin(a.time_used_seconds))}${a.time_up ? ' (time up)' : ''}</td>
        <td>${(a.domains || []).map((d) => `${h(d.name)} ${d.percent}%`).join(' · ')}</td></tr>`;
    }).join('');
    return `<div class="table-wrap"><table class="table">
      <thead><tr><th>Date</th><th>Name</th><th>Email</th><th>Exam</th><th>Mode</th><th class="num">Score</th><th>Result</th><th class="num">Time used</th><th>By domain</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="9" class="muted">No results yet.</td></tr>'}</tbody></table></div>`;
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
            </div>
            <input id="admin-search" class="admin-search" type="search" placeholder="Search name, email or exam" value="${h(filter)}" aria-label="Search">
            <button class="btn btn--small btn--secondary" data-action="refresh">Refresh</button>
            ${tab === 'results' ? '<button class="btn btn--small btn--primary" data-action="csv">Export CSV</button>' : ''}
          </div>
          ${tab === 'users' ? usersTable() : resultsTable()}
        </section>
      </main>`;
    const s = document.getElementById('admin-search');
    s.addEventListener('input', () => { filter = s.value; render(); });
    if (keepFocus) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    document.title = `Admin – ${APP_NAME}`;
  }

  function downloadCsv() {
    const people = byId();
    const cols = ['date', 'name', 'email', 'exam_id', 'exam_title', 'mode', 'percent', 'correct', 'total_questions', 'passed', 'time_used_minutes', 'time_up'];
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [cols.join(',')].concat(filteredAttempts().map((a) => {
      const p = people[a.user_id] || {};
      return [a.created_at, p.full_name, p.email, a.exam_id, a.exam_title, a.mode, a.percent, a.correct, a.total_questions,
        a.passed, a.time_used_seconds == null ? '' : Math.round(a.time_used_seconds / 60), a.time_up].map(esc).join(',');
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
