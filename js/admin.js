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
  // COURSES: which exams each course unlocks, and who is enrolled (by email)
  let courses = [];
  let courseExams = [];
  let enrollments = [];
  let coursesMissing = '';  // set when setup-courses.sql has not been run yet
  let courseForm = null;    // { isNew, id, name, months, exams: [] } while adding/editing a course
  let enrolDraft = { course: '', emails: '' };
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const fmtDay = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const addMonths = (months) => { const d = new Date(); d.setMonth(d.getMonth() + months); return d; };
  const isActive = (e) => Date.now() >= Date.parse(e.starts_at) && Date.now() < Date.parse(e.expires_at);
  const courseName = (id) => (courses.find((c) => c.id === id) || { name: id }).name;

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('is-out'), 2600);
    setTimeout(() => t.remove(), 3000);
  }

  function header() {
    return `<header class="appbar"><a class="appbar__brand" href="./"><img class="appbar__logoimg" src="assets/team-academy-logo.png" alt="Team Academy"></a>
      <span class="appbar__tag">Admin</span>
      <span class="appbar__user"><span class="appbar__name">${h(AUTH.displayName())} · ${h(AUTH.profile.role)}</span>
      <a class="btn btn--small btn--secondary" href="./">Exams</a>
      <button class="btn btn--small btn--secondary" data-action="sign-out">Sign out</button></span></header>`;
  }

  async function load() {
    const c = AUTH.client;
    const [p, a, x, cs, ce, en] = await Promise.all([
      c.from('profiles').select('*').order('created_at', { ascending: false }),
      c.from('attempts').select('*').order('created_at', { ascending: false }).limit(2000),
      c.from('exams').select('*').order('category').order('title'),
      c.from('courses').select('*').order('name'),
      c.from('course_exams').select('*'),
      c.from('enrollments').select('*').order('created_at', { ascending: false })
    ]);
    const cErr = cs.error || ce.error || en.error;
    coursesMissing = cErr ? cErr.message : '';
    courses = cErr ? [] : (cs.data || []);
    courseExams = cErr ? [] : (ce.data || []);
    enrollments = cErr ? [] : (en.data || []);
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
        ${coursesMissing ? '' : `<td class="cell-wrap small">${h(activeCourseNames(p.email)) || '<span class="muted">–</span>'}</td>`}
        <td class="num">${counts[p.id] || 0}</td><td>${h(fmtDate(last[p.id]))}</td>
        <td class="num">${actions}</td></tr>`;
    }).join('');
    return `<div class="table-wrap"><table class="table">
      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Registered</th>${coursesMissing ? '' : '<th>Courses</th>'}<th class="num">Attempts</th><th>Last attempt</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="9" class="muted">No users match.</td></tr>'}</tbody></table></div>
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
        <td><strong>${h(r.title)}</strong><br><span class="muted small">${h(types)}</span><br><span class="muted small">id: ${h(r.id)}</span>${coursesMissing ? '' : `<br><span class="small">${examCoursesLabel(r.id)}</span>`}</td>
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

  // ---------------------------------------------------------------- COURSES tab
  // Every exam an admin can put in a course: uploaded ones plus the built-in samples.
  function allExams() {
    const list = examRows.map((r) => ({ id: r.id, title: r.title, note: r.published ? '' : 'hidden' }));
    if (!(window.APP_CONFIG && window.APP_CONFIG.showSampleExams === false)) {
      (window.EXAM_BANK || []).forEach((d) => { if (!list.some((x) => x.id === d.id)) list.push({ id: d.id, title: d.title, note: 'built-in sample' }); });
    }
    return list.sort((a, b) => a.title.localeCompare(b.title));
  }
  const coursesOfExam = (examId) => courseExams.filter((l) => l.exam_id === examId).map((l) => courseName(l.course_id));
  function examCoursesLabel(examId) {
    const names = coursesOfExam(examId);
    return names.length ? `Course: ${h(names.join(', '))}` : '<span class="muted">Free for all students (no course)</span>';
  }
  function activeCourseNames(email) {
    const em = String(email || '').toLowerCase();
    return enrollments.filter((e) => e.email === em && isActive(e)).map((e) => courseName(e.course_id)).join(', ');
  }

  function courseFormHtml() {
    const f = courseForm;
    const exams = allExams();
    return `<section class="admin-form" aria-label="${f.isNew ? 'New course' : 'Edit course'}">
      <h3>${f.isNew ? 'New course' : `Edit course: ${h(f.name)}`}</h3>
      <div class="form-grid">
        <label class="field"><span>Course name</span><input id="cf-name" type="text" maxlength="120" value="${h(f.name)}" placeholder="e.g. PMP"></label>
        <label class="field"><span>Code (short, lower case, no spaces)</span><input id="cf-id" type="text" maxlength="50" value="${h(f.id)}" ${f.isNew ? '' : 'readonly'} placeholder="e.g. pmp"></label>
        <label class="field"><span>Access length (months)</span><input id="cf-months" type="number" min="1" max="120" value="${h(f.months)}"></label>
      </div>
      <fieldset class="admin-checks"><legend>Exams in this course</legend>
        ${exams.length ? exams.map((e) => `<label class="check"><input type="checkbox" class="cf-exam" value="${h(e.id)}" ${f.exams.includes(e.id) ? 'checked' : ''}>
          <span>${h(e.title)} <span class="muted small">${h(e.id)}${e.note ? ' · ' + h(e.note) : ''}</span></span></label>`).join('') : '<p class="muted">No exams yet. Upload one on the Exams tab first.</p>'}
      </fieldset>
      <p class="muted small">Exams that are in no course are free for every signed-in student. A change to the access length applies to new enrolments and renewals.</p>
      <div class="card__actions card__actions--start">
        <button class="btn btn--small btn--primary" data-action="course-save">Save course</button>
        <button class="btn btn--small btn--secondary" data-action="course-cancel">Cancel</button>
      </div>
    </section>`;
  }

  function enrolHint() {
    const c = courses.find((x) => x.id === enrolDraft.course);
    return c ? `Access starts today and lasts ${c.access_months} month${c.access_months === 1 ? '' : 's'} (until ${fmtDay(addMonths(c.access_months))}).` : '';
  }

  function coursesTab() {
    const isAdmin = AUTH.isAdmin();
    if (coursesMissing) {
      return `<div class="notice notice--error"><strong>Courses are not set up yet.</strong>
        Run <code>supabase/setup-courses.sql</code> in the Supabase SQL Editor, then click Refresh.<br><span class="small">${h(coursesMissing)}</span></div>`;
    }
    if (!courses.some((c) => c.id === enrolDraft.course)) enrolDraft.course = courses.length ? courses[0].id : '';
    const box = notice ? `<div class="notice notice--${notice.kind}" role="status"><strong>${h(notice.title)}</strong> ${h(notice.text)}
      <button type="button" class="link-btn" data-action="notice-close">Close</button></div>` : '';
    const form = courseForm ? courseFormHtml() : '';
    const enrol = isAdmin && courses.length && !courseForm ? `<section class="admin-form" aria-label="Enrol students">
      <h3>Enrol students</h3>
      <div class="form-grid">
        <label class="field"><span>Course</span><select id="en-course">${courses.map((c) => `<option value="${h(c.id)}" ${c.id === enrolDraft.course ? 'selected' : ''}>${h(c.name)}</option>`).join('')}</select></label>
      </div>
      <label class="field admin-emails"><span>Student emails (one per line, or separated by commas)</span>
        <textarea id="en-emails" rows="4" placeholder="neha02@gmail.com&#10;suba02@gmail.com">${h(enrolDraft.emails)}</textarea></label>
      <p class="muted small"><span id="en-hint">${h(enrolHint())}</span>
        Students who have not registered yet get access as soon as they register with the same email. Enrolling someone again renews their access from today.</p>
      <div class="card__actions card__actions--start"><button class="btn btn--small btn--primary" data-action="enrol">Enrol</button></div>
    </section>` : '';

    const courseRows = courses.map((c) => {
      const links = courseExams.filter((l) => l.course_id === c.id);
      const titles = links.map((l) => (allExams().find((e) => e.id === l.exam_id) || { title: l.exam_id }).title);
      const en = enrollments.filter((e) => e.course_id === c.id);
      return `<tr>
        <td><strong>${h(c.name)}</strong><br><span class="muted small">code: ${h(c.id)}</span></td>
        <td>${c.access_months} month${c.access_months === 1 ? '' : 's'}</td>
        <td class="cell-wrap small">${titles.length ? titles.map(h).join('<br>') : '<span class="muted">No exams yet</span>'}</td>
        <td class="num">${en.filter(isActive).length}${en.length > en.filter(isActive).length ? ` <span class="muted small">(+${en.length - en.filter(isActive).length} ended)</span>` : ''}</td>
        <td class="num admin-actions">${isAdmin ? `<button class="btn btn--small btn--secondary" data-action="course-edit" data-id="${h(c.id)}">Edit</button>
          <button class="btn btn--small btn--ghost" data-action="course-delete" data-id="${h(c.id)}">Delete</button>` : ''}</td></tr>`;
    }).join('');

    const people = Object.fromEntries(profiles.map((p) => [String(p.email || '').toLowerCase(), p]));
    const q = filter.toLowerCase();
    const enRows = enrollments
      .filter((e) => !q || `${e.email} ${(people[e.email] || {}).full_name || ''} ${courseName(e.course_id)}`.toLowerCase().includes(q))
      .sort((a, b) => courseName(a.course_id).localeCompare(courseName(b.course_id)) || a.email.localeCompare(b.email))
      .map((e) => {
        const p = people[e.email]; const on = isActive(e);
        return `<tr>
          <td>${h(e.email)}</td><td>${p ? h(p.full_name) : '<span class="muted">Not registered yet</span>'}</td>
          <td>${h(courseName(e.course_id))}</td><td>${h(fmtDay(e.starts_at))}</td><td>${h(fmtDay(e.expires_at))}</td>
          <td><span class="result-tag ${on ? 'is-pass' : 'is-fail'}">${on ? 'Active' : 'Ended'}</span></td>
          <td class="num admin-actions">${isAdmin ? `<button class="btn btn--small btn--secondary" data-action="enrol-renew" data-course="${h(e.course_id)}" data-email="${h(e.email)}">Renew</button>
            <button class="btn btn--small btn--ghost" data-action="enrol-remove" data-course="${h(e.course_id)}" data-email="${h(e.email)}">Remove</button>` : ''}</td></tr>`;
      }).join('');

    return `${box}${form}${enrol}
      <h3 class="admin-subtitle">Courses</h3>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Course</th><th>Access</th><th>Exams</th><th class="num">Students</th><th></th></tr></thead>
        <tbody>${courseRows || `<tr><td colspan="5" class="muted">No courses yet.${isAdmin ? ' Click <strong>New course</strong> to add one.' : ''}</td></tr>`}</tbody></table></div>
      <h3 class="admin-subtitle">Enrolled students</h3>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Email</th><th>Name</th><th>Course</th><th>Enrolled</th><th>Access until</th><th>Status</th><th></th></tr></thead>
        <tbody>${enRows || `<tr><td colspan="7" class="muted">${enrollments.length ? 'No enrollments match.' : 'Nobody is enrolled yet.'}</td></tr>`}</tbody></table></div>
      <p class="muted small">Students see the exams of their active courses plus any exam that is in no course. Removing or ending access never deletes their past results.</p>`;
  }

  // Keep what the admin types in the course and enrol forms when the page redraws.
  function slug(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50); }
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!courseForm && !t.id.startsWith('en-')) return;
    if (t.id === 'cf-name') {
      courseForm.name = t.value;
      if (courseForm.isNew && !courseForm.idTouched) { courseForm.id = slug(t.value); const idEl = document.getElementById('cf-id'); if (idEl) idEl.value = courseForm.id; }
    }
    if (t.id === 'cf-id') { courseForm.id = t.value.trim().toLowerCase(); courseForm.idTouched = true; }
    if (t.id === 'cf-months') courseForm.months = t.value;
    if (t.id === 'en-emails') enrolDraft.emails = t.value;
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.classList && t.classList.contains('cf-exam') && courseForm) {
      courseForm.exams = courseForm.exams.filter((x) => x !== t.value);
      if (t.checked) courseForm.exams.push(t.value);
    }
    if (t.id === 'en-course') { enrolDraft.course = t.value; const hint = document.getElementById('en-hint'); if (hint) hint.textContent = enrolHint(); }
  });

  function openCourseForm(id) {
    const c = id && courses.find((x) => x.id === id);
    courseForm = c
      ? { isNew: false, id: c.id, name: c.name, months: String(c.access_months), exams: courseExams.filter((l) => l.course_id === c.id).map((l) => l.exam_id) }
      : { isNew: true, id: '', name: '', months: '3', exams: [], idTouched: false };
    notice = null; tab = 'courses'; render();
    const n = document.getElementById('cf-name'); if (n) n.focus();
  }

  async function saveCourse() {
    const f = courseForm; const c = AUTH.client;
    const name = f.name.trim(); const id = f.id.trim(); const months = Number(f.months);
    const bad = !name ? 'Please enter a course name.'
      : !/^[a-z0-9][a-z0-9-]{0,49}$/.test(id) ? 'The code may only use lower-case letters, numbers and dashes (e.g. pmp or python-basics).'
      : !(Number.isInteger(months) && months >= 1 && months <= 120) ? 'Access length must be a whole number of months from 1 to 120.'
      : f.isNew && courses.some((x) => x.id === id) ? `There is already a course with the code "${id}".` : '';
    if (bad) { notice = { kind: 'error', title: 'Course not saved:', text: bad }; return render(); }
    const r1 = f.isNew
      ? await c.from('courses').insert({ id, name, access_months: months })
      : await c.from('courses').update({ name, access_months: months }).eq('id', id);
    if (r1.error) { notice = { kind: 'error', title: 'Course not saved:', text: r1.error.message }; return render(); }
    const r2 = await c.from('course_exams').delete().eq('course_id', id);
    const r3 = !r2.error && f.exams.length ? await c.from('course_exams').insert(f.exams.map((exam_id) => ({ course_id: id, exam_id }))) : { error: null };
    const err = r2.error || r3.error;
    if (err) { notice = { kind: 'error', title: 'Course saved, but its exam list was not:', text: err.message }; return refresh(); }
    courseForm = null;
    notice = { kind: 'ok', title: `Course "${name}" saved.`, text: `${f.exams.length} exam${f.exams.length === 1 ? '' : 's'} in this course.` };
    await refresh();
  }

  async function deleteCourse(id) {
    const c = courses.find((x) => x.id === id); if (!c) return;
    const n = enrollments.filter((e) => e.course_id === id && isActive(e)).length;
    if (!confirm(`Delete the course "${c.name}"?\n\n${n} student${n === 1 ? '' : 's'} with active access will lose access to its exams. The exams themselves are not deleted; any that are in no other course become free for all students.`)) return;
    const { error } = await AUTH.client.from('courses').delete().eq('id', id);
    if (error) { toast(error.message); return; }
    notice = { kind: 'ok', title: `Course "${c.name}" deleted.`, text: '' };
    await refresh();
  }

  async function enrol(courseId, emailsText, quiet) {
    const parts = String(emailsText || '').split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    const valid = [...new Set(parts.filter((x) => EMAIL_RE.test(x)))];
    const invalid = parts.filter((x) => !EMAIL_RE.test(x));
    if (!courseId) { notice = { kind: 'error', title: 'Choose a course first.', text: '' }; return render(); }
    if (!valid.length) { notice = { kind: 'error', title: 'No email addresses found.', text: invalid.length ? `Not email addresses: ${invalid.join(', ')}` : 'Paste one email per line.' }; return render(); }
    const { data, error } = await AUTH.client.rpc('admin_enroll', { p_course_id: courseId, p_emails: valid });
    if (error) { notice = { kind: 'error', title: 'Not enrolled:', text: error.message }; return render(); }
    const row = (Array.isArray(data) ? data[0] : data) || { added: 0, renewed: 0 };
    const c = courses.find((x) => x.id === courseId);
    if (quiet) toast(`Access renewed until ${fmtDay(addMonths(c ? c.access_months : 3))}.`);
    else {
      notice = { kind: 'ok', title: `${courseName(courseId)}:`, text: `${row.added} enrolled, ${row.renewed} renewed (access until ${fmtDay(addMonths(c ? c.access_months : 3))}).`
        + (invalid.length ? ` Not added, not email addresses: ${invalid.join(', ')}` : '') };
      enrolDraft.emails = invalid.join('\n');
    }
    await refresh();
  }

  async function removeEnrollment(courseId, email) {
    if (!confirm(`Remove ${email} from "${courseName(courseId)}"?\n\nThey will no longer see this course's exams. Their past results stay.`)) return;
    const { error } = await AUTH.client.from('enrollments').delete().eq('course_id', courseId).eq('email', email);
    if (error) { toast(error.message); return; }
    toast('Access removed.');
    await refresh();
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
              <button type="button" role="tab" data-action="tab" data-tab="courses" class="${tab === 'courses' ? 'is-on' : ''}">Courses (${courses.length})</button>
            </div>
            <input id="admin-search" class="admin-search" type="search" placeholder="${tab === 'exams' ? 'Search exam title or category' : tab === 'courses' ? 'Search email, name or course' : 'Search name, email or exam'}" value="${h(filter)}" aria-label="Search">
            <button class="btn btn--small btn--secondary" data-action="refresh">Refresh</button>
            ${tab === 'results' ? '<button class="btn btn--small btn--primary" data-action="csv">Export CSV</button>' : ''}
            ${tab === 'exams' ? `<button class="btn btn--small btn--secondary" data-action="template">Download template</button>
              ${AUTH.isAdmin() && !examsMissing ? '<label class="btn btn--small btn--primary file-btn">Upload JSON<input type="file" accept=".json,application/json" id="exam-file" hidden></label>' : ''}` : ''}
            ${tab === 'courses' && AUTH.isAdmin() && !coursesMissing && !courseForm ? '<button class="btn btn--small btn--primary" data-action="course-new">New course</button>' : ''}
          </div>
          ${tab === 'users' ? usersTable() : tab === 'results' ? resultsTable() : tab === 'courses' ? coursesTab() : examsTable()}
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
    if (a === 'tab') { if (tab !== el.dataset.tab) notice = null; tab = el.dataset.tab; render(); }
    if (a === 'refresh') refresh();
    if (a === 'csv') downloadCsv();
    if (a === 'template') saveFile('examsim-template.json', JSON.stringify(window.ExamFormat.template(), null, 2), 'application/json');
    if (a === 'notice-close') { notice = null; render(); }
    if (a === 'exam-publish') { const r = examRows.find((x) => x.id === el.dataset.id); if (r) setPublished(r.id, !r.published); }
    if (a === 'exam-download') { const r = examRows.find((x) => x.id === el.dataset.id); if (r) saveFile(`${r.id}.json`, JSON.stringify(r.definition, null, 2), 'application/json'); }
    if (a === 'exam-delete') deleteExam(el.dataset.id);
    if (a === 'course-new') openCourseForm(null);
    if (a === 'course-edit') openCourseForm(el.dataset.id);
    if (a === 'course-cancel') { courseForm = null; render(); }
    if (a === 'course-save') saveCourse();
    if (a === 'course-delete') deleteCourse(el.dataset.id);
    if (a === 'enrol') enrol(enrolDraft.course, enrolDraft.emails, false);
    if (a === 'enrol-renew') enrol(el.dataset.course, el.dataset.email, true);
    if (a === 'enrol-remove') removeEnrollment(el.dataset.course, el.dataset.email);
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
      $app.innerHTML = `<header class="appbar"><a class="appbar__brand" href="./"><img class="appbar__logoimg" src="assets/team-academy-logo.png" alt="Team Academy"></a></header>
        <main class="page auth-page"><section class="card auth-card"><h1 class="card__title">Admins and trainers only</h1>
        <p class="muted">Your account is a student account. Ask an admin if you need access.</p>
        <div class="card__actions card__actions--start"><a class="btn btn--primary" href="./">Go to exams</a></div></section></main>`;
      return;
    }
    $app.innerHTML = `${header()}<main class="page"><p class="muted">Loading…</p></main>`;
    await refresh();
  });
})();
