/* ExamSim – login, registration and password reset with Supabase.
   Loaded BEFORE js/app.js (and js/admin.js). It shows the sign-in screen,
   and only when someone is signed in does it start the page's own code
   through ExamAuth.onSignedIn(start).                                    */
(function () {
  'use strict';

  const cfg = window.SUPABASE_CONFIG || {};
  const APP_NAME = (window.APP_CONFIG && window.APP_CONFIG.name) || 'ExamSim';
  const $app = document.getElementById('app');
  // Read the link type BEFORE Supabase tidies the address bar.
  const linkType = (location.hash + '&' + location.search).match(/type=([a-z_]+)/);
  const arrivedFromResetLink = !!(linkType && linkType[1] === 'recovery');

  const h = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Folder of the current page, e.g. https://name.github.io/exam-simulator/
  const siteUrl = () => location.origin + location.pathname.replace(/[^/]*$/, '');

  let client = null;
  let entered = false;
  let recoveryMode = arrivedFromResetLink;
  const waiting = [];

  const ExamAuth = {
    enabled: true,
    client: null,
    user: null,
    profile: null,
    /** Run fn once the person is signed in (straight away if they already are). */
    onSignedIn(fn) { if (entered) fn(); else waiting.push(fn); },
    isAdmin() { return !!(this.profile && this.profile.role === 'admin'); },
    isStaff() { return !!(this.profile && (this.profile.role === 'admin' || this.profile.role === 'trainer')); },
    displayName() {
      if (!this.user) return '';
      return (this.profile && this.profile.full_name) || this.user.email || '';
    },
    async signOut() {
      try { if (client) await client.auth.signOut(); } catch (e) { /* ignore */ }
      location.replace(siteUrl());
    },
    /** Save one finished exam to the attempts table. Returns { error }. */
    async saveAttempt(r) {
      if (!client || !this.user) return { error: { message: 'Not signed in' } };
      const row = {
        exam_id: String(r.examId),
        exam_title: r.examTitle || null,
        mode: r.mode === 'practice' ? 'practice' : 'exam',
        total_questions: r.total,
        correct: r.correct,
        percent: r.percent,
        passing_score: r.passingScore,
        passed: !!r.passed,
        time_used_seconds: Math.round(r.timeUsed || 0),
        time_limit_seconds: r.timeLimit ? Math.round(r.timeLimit) : null,
        time_up: !!r.timeUp,
        domains: (r.domains || []).map((d) => ({ key: d.key, name: d.name, correct: d.correct, total: d.total, percent: d.percent }))
      };
      try {
        const { error } = await client.from('attempts').insert(row);
        return { error: error || null };
      } catch (e) {
        return { error: { message: e.message || String(e) } };
      }
    }
  };
  window.ExamAuth = ExamAuth;

  // ------------------------------------------------------------ screens
  function shell(inner) {
    $app.innerHTML = `<header class="appbar"><span class="appbar__brand"><img class="appbar__logoimg" src="assets/team-academy-logo.png" alt="Team Academy"></span></header>
      <main class="page auth-page">${inner}</main>`;
  }

  function messageScreen(title, body, withSignOut) {
    shell(`<section class="card auth-card">
      <h1 class="card__title">${h(title)}</h1>
      <p class="muted">${body}</p>
      ${withSignOut ? '<div class="card__actions card__actions--start"><button class="btn btn--secondary" id="auth-signout">Sign out</button></div>' : ''}
    </section>`);
    const b = document.getElementById('auth-signout');
    if (b) b.addEventListener('click', () => ExamAuth.signOut());
  }

  const views = {
    signin: {
      title: 'Sign in',
      fields: `
        <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required></label>
        <label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required></label>`,
      button: 'Sign in',
      links: '<button type="button" class="link-btn" data-view="forgot">Forgot password?</button>'
    },
    signup: {
      title: 'Create your account',
      fields: `
        <label class="field"><span>Full name</span><input name="full_name" type="text" autocomplete="name" maxlength="120" required></label>
        <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required></label>
        <label class="field"><span>Password <small class="muted">(at least 8 characters)</small></span><input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
        <label class="field"><span>Confirm password</span><input name="password2" type="password" autocomplete="new-password" minlength="8" required></label>`,
      button: 'Create account',
      links: ''
    },
    forgot: {
      title: 'Reset your password',
      intro: 'Enter the email you registered with. We will send you a link to choose a new password.',
      fields: '<label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required></label>',
      button: 'Send reset link',
      links: '<button type="button" class="link-btn" data-view="signin">Back to sign in</button>'
    },
    reset: {
      title: 'Choose a new password',
      fields: `
        <label class="field"><span>New password <small class="muted">(at least 8 characters)</small></span><input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
        <label class="field"><span>Confirm new password</span><input name="password2" type="password" autocomplete="new-password" minlength="8" required></label>`,
      button: 'Save new password',
      links: ''
    }
  };

  function authScreen(view, note) {
    const v = views[view];
    const tabs = (view === 'signin' || view === 'signup') ? `
      <div class="segmented auth-tabs" role="tablist">
        <button type="button" role="tab" data-view="signin" class="${view === 'signin' ? 'is-on' : ''}" aria-selected="${view === 'signin'}">Sign in</button>
        <button type="button" role="tab" data-view="signup" class="${view === 'signup' ? 'is-on' : ''}" aria-selected="${view === 'signup'}">Register</button>
      </div>` : '';
    shell(`<section class="card auth-card">
      ${tabs}
      <h1 class="card__title">${v.title}</h1>
      ${v.intro ? `<p class="muted">${v.intro}</p>` : ''}
      <form id="auth-form" class="auth-form" novalidate>
        ${v.fields}
        <p id="auth-msg" class="auth-msg" role="alert" ${note ? '' : 'hidden'}>${note ? h(note.text) : ''}</p>
        <button class="btn btn--primary btn--large" type="submit">${v.button}</button>
      </form>
      <div class="auth-links">${v.links}</div>
    </section>
    <p class="muted small auth-foot">Your name, email and exam scores are stored so your trainer can follow your progress.</p>`);
    if (note) document.getElementById('auth-msg').className = 'auth-msg is-' + note.kind;
    $app.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => authScreen(b.dataset.view)));
    document.getElementById('auth-form').addEventListener('submit', (e) => { e.preventDefault(); submit(view, e.target); });
    const first = $app.querySelector('#auth-form input');
    if (first) first.focus();
    document.title = `${v.title} – ${APP_NAME}`;
  }

  function say(kind, text) {
    const m = document.getElementById('auth-msg');
    if (!m) return;
    m.hidden = false; m.className = 'auth-msg is-' + kind; m.textContent = text;
  }

  function friendly(error) {
    const msg = (error && error.message) || String(error);
    if (/invalid login credentials/i.test(msg)) return 'Email or password is not correct.';
    if (/email not confirmed/i.test(msg)) return 'Please confirm your email first. Check your inbox (and spam folder) for the link.';
    if (/already registered|already been registered/i.test(msg)) return 'An account with this email already exists. Sign in instead, or reset your password.';
    if (/signups? not allowed|signup_disabled/i.test(msg)) return 'New registrations are switched off. Contact Team Academy.';
    if (/rate limit|too many/i.test(msg)) return 'Too many attempts. Please wait a few minutes and try again.';
    if (/failed to fetch|network/i.test(msg)) return 'Cannot reach the server. Check your internet connection.';
    return msg;
  }

  async function submit(view, form) {
    const f = Object.fromEntries(new FormData(form).entries());
    const email = (f.email || '').trim();
    const btn = form.querySelector('button[type="submit"]');
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

    if (view !== 'reset' && !validEmail) return say('error', 'Please enter a valid email address.');
    if (view === 'signin' && !f.password) return say('error', 'Please enter your password.');
    if (view === 'signup' && !(f.full_name || '').trim()) return say('error', 'Please enter your full name.');
    if (view === 'signup' || view === 'reset') {
      if ((f.password || '').length < 8) return say('error', 'The password must have at least 8 characters.');
      if (f.password !== f.password2) return say('error', 'The two passwords do not match.');
    }

    btn.disabled = true;
    say('info', 'Please wait…');
    try {
      if (view === 'signin') {
        const { data, error } = await client.auth.signInWithPassword({ email, password: f.password });
        if (error) throw error;
        await enter(data.user);
      } else if (view === 'signup') {
        const { data, error } = await client.auth.signUp({
          email, password: f.password,
          options: { data: { full_name: f.full_name.trim() }, emailRedirectTo: siteUrl() }
        });
        if (error) throw error;
        if (data.session) await enter(data.user);
        else authScreen('signin', { kind: 'ok', text: 'Account created. We have emailed you a confirmation link: open it, then sign in here.' });
      } else if (view === 'forgot') {
        const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: siteUrl() });
        if (error) throw error;
        authScreen('signin', { kind: 'ok', text: 'If an account exists for that email, a reset link is on its way. Check your inbox and spam folder.' });
      } else if (view === 'reset') {
        const { data, error } = await client.auth.updateUser({ password: f.password });
        if (error) throw error;
        recoveryMode = false;
        history.replaceState(null, '', siteUrl());
        if (entered) { location.replace(siteUrl()); return; }
        await enter(data.user);
      }
    } catch (err) {
      say('error', friendly(err));
      btn.disabled = false;
    }
  }

  // ------------------------------------------------------------ sign-in
  async function enter(user) {
    if (recoveryMode) return authScreen('reset');
    ExamAuth.user = user;
    const { data: profile, error } = await client.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (error) {
      return messageScreen('Could not load your account',
        `The database answered: <code>${h(error.message)}</code>. If you are setting up the site, check that <code>supabase/setup.sql</code> was run in Supabase.`, true);
    }
    if (!profile) {
      return messageScreen('Account not ready',
        'Your login works, but your profile is missing. The administrator should run <code>supabase/setup.sql</code> again, then you can sign in.', true);
    }
    if (!profile.is_active) {
      return messageScreen('Account blocked', 'Your account has been blocked. Please contact Team Academy.', true);
    }
    ExamAuth.profile = profile;
    if (entered) return;
    entered = true;
    waiting.splice(0).forEach((fn) => fn());
  }

  async function init() {
    const { data, error } = await client.auth.getSession();
    if (error) return authScreen('signin', { kind: 'error', text: friendly(error) });
    if (recoveryMode && data.session) return authScreen('reset');
    if (data.session) return enter(data.session.user);
    authScreen('signin');
  }

  // ------------------------------------------------------------ start
  const notConfigured = !cfg.url || !cfg.publishableKey || /PASTE_/.test(String(cfg.url) + String(cfg.publishableKey));
  if (notConfigured) {
    messageScreen('Login is not connected yet',
      'Open <code>js/supabase-config.js</code> and paste your Supabase Project URL and publishable key (setup guide, step 5).', false);
    return;
  }
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    messageScreen('Could not load the login service', 'Check your internet connection, then reload the page.', false);
    return;
  }

  client = window.supabase.createClient(cfg.url, cfg.publishableKey);
  ExamAuth.client = client;

  client.auth.onAuthStateChange((event) => {
    // Keep this callback quick: Supabase advises against awaiting other calls inside it.
    if (event === 'PASSWORD_RECOVERY') { recoveryMode = true; setTimeout(() => authScreen('reset'), 0); }
  });

  init().catch((err) => authScreen('signin', { kind: 'error', text: friendly(err) }));
})();
