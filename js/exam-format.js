/* ExamSim – the question-bank format, shared by the exam page and the admin page.
   ExamFormat.normalize(json) checks an exam file and returns a clean exam object,
   or throws an Error that says which question is wrong and why.

   Question types:
     single     – multiple choice, one answer         (answer: "b")
     multiple   – multiple choice, several answers     (answer: ["a", "c"])
     truefalse  – True / False                         (answer: true)
     match      – match each item to an answer         (pairs: [["item", "answer"], ...])
                  also used for Yes/No statements       (pairs: [["statement", "Yes"], ...])
     order      – put steps in the right sequence       (steps: ["first", "second", ...])

   Code and images (any text: question, options, justification, match pairs, order steps):
     ```python            a code block (any language name, or none); spacing is kept exactly
     print("hi")
     ```
     `x = 1`              inline code
     ![alt text](images/powerbi/q1.png)   an image (a file in the site, or a web address starting https://)
   Shortcuts: "image" / "imageAlt" on a question, { "text": "...", "image": "..." } as an option,
   "explanationImage" / "explanationImageAlt" for the justification.  */
(function () {
  'use strict';

  const TYPE_ALIASES = {
    single: 'single', mcq: 'single', 'multiple-choice': 'single',
    multiple: 'multiple', 'multiple-response': 'multiple', multi: 'multiple',
    truefalse: 'truefalse', 'true-false': 'truefalse', tf: 'truefalse', boolean: 'truefalse',
    match: 'match', matching: 'match', 'drag-drop': 'match', yesno: 'match', 'yes-no': 'match',
    order: 'order', ordering: 'order', sequence: 'order', sort: 'order'
  };
  const TYPE_LABELS = { single: 'Multiple choice', multiple: 'Multiple response', truefalse: 'True/False', match: 'Match', order: 'Order' };

  const str = (v) => (v == null ? '' : String(v)).trim();

  // ---- CODE AND IMAGES ---------------------------------------------------------------
  const FENCE = /```[A-Za-z0-9_+#.-]*[ \t]*\n?([\s\S]*?)\n?```/g;
  const IMG_MD = /!\[([^\]\n]*)\]\(([^)\s]*)\)/g;
  const BAD_IMG = 'must be a file in the site such as images/powerbi/q1.png, or a web address starting with https:// (no spaces)';
  // Image addresses allowed: https:// web addresses, or a file path inside the site (png, jpg, gif, webp, svg).
  function safeImageSrc(src) {
    src = str(src);
    if (/^https:\/\/[^\s"'<>`\\]+$/i.test(src)) return src;
    if (/^(\.\/)?[A-Za-z0-9_-][A-Za-z0-9_\-./]*\.(png|jpe?g|gif|webp|svg)$/i.test(src) && !src.includes('..') && !src.includes('//')) return src;
    return '';
  }
  // Text without formatting marks, for drop-down lists and screen readers.
  function plainText(v) {
    return String(v == null ? '' : v)
      .replace(FENCE, '$1')
      .replace(IMG_MD, (m, alt) => (str(alt) ? `[image: ${str(alt)}]` : '[image]'))
      .replace(/`([^`\n]+)`/g, '$1');
  }
  // Turns an "image" field into the ![alt](path) form used inside text.
  function imageMd(src, alt, where, field) {
    const ok = safeImageSrc(src);
    if (!ok) throw new Error(`${where}: "${field}" ${BAD_IMG}. Found: "${src}".`);
    return `![${String(alt == null ? '' : alt).replace(/[[\]\n]/g, ' ').trim()}](${ok})`;
  }
  // Checks code blocks are closed and every image address is allowed.
  function checkRich(value, where, part) {
    const s = String(value == null ? '' : value);
    if ((s.match(/```/g) || []).length % 2) throw new Error(`${where}: a code block in the ${part} is not closed. Add a line with \`\`\` after the code.`);
    const outsideCode = s.replace(FENCE, '');
    let m; IMG_MD.lastIndex = 0;
    while ((m = IMG_MD.exec(outsideCode))) {
      if (!safeImageSrc(m[2])) throw new Error(`${where}: the image "${m[2]}" in the ${part} ${BAD_IMG}.`);
    }
  }

  function normalizeQuestion(q, n) {
    const where = `Question ${n}${q && q.id != null ? ` (id "${q.id}")` : ''}`;
    if (!q || typeof q !== 'object') throw new Error(`${where}: is not an object.`);
    if (!str(q.text)) throw new Error(`${where}: missing "text".`);
    const rawType = str(q.type).toLowerCase();
    let type = rawType ? TYPE_ALIASES[rawType] : (q.pairs ? 'match' : q.steps ? 'order' : null);
    if (rawType && !type) throw new Error(`${where}: unknown "type" "${q.type}". Use single, multiple, truefalse, match or order.`);
    let text = String(q.text);
    if (str(q.image)) text += '\n\n' + imageMd(q.image, q.imageAlt, where, 'image');
    let explanation = q.explanation ? String(q.explanation) : '';
    if (str(q.explanationImage)) explanation += (explanation ? '\n\n' : '') + imageMd(q.explanationImage, q.explanationImageAlt, where, 'explanationImage');
    checkRich(text, where, 'question text');
    checkRich(explanation, where, 'justification');
    const base = { domain: str(q.domain) || 'general', text, explanation, fixedOrder: !!q.fixedOrder };

    if (type === 'truefalse') {
      let a = q.answer;
      if (typeof a === 'string') a = a.trim().toLowerCase();
      if (a === true || a === 'true' || a === 't' || a === 'a') a = 'a';
      else if (a === false || a === 'false' || a === 'f' || a === 'b') a = 'b';
      else throw new Error(`${where}: a truefalse question needs "answer": true or false.`);
      return Object.assign(base, { type: 'single', subtype: 'truefalse', fixedOrder: true,
        options: [{ id: 'a', text: 'True' }, { id: 'b', text: 'False' }], answer: [a] });
    }

    if (type === 'match') {
      if (!Array.isArray(q.pairs) || q.pairs.length < 2) throw new Error(`${where}: a match question needs at least 2 "pairs", like [["item", "answer"], ...].`);
      const items = []; const targets = []; const answer = [];
      const targetId = (text) => {
        let t = targets.find((x) => x.text === text);
        if (!t) { t = { id: 't' + (targets.length + 1), text }; targets.push(t); }
        return t.id;
      };
      q.pairs.forEach((p, k) => {
        const left = Array.isArray(p) ? str(p[0]) : p && str(p.item != null ? p.item : p.left);
        const right = Array.isArray(p) ? str(p[1]) : p && str(p.match != null ? p.match : p.right);
        if (!left || !right) throw new Error(`${where}: pair ${k + 1} needs two texts, like ["item", "answer"].`);
        checkRich(left, where, `pair ${k + 1}`); checkRich(right, where, `pair ${k + 1}`);
        if (items.some((x) => x.text === left)) throw new Error(`${where}: the item "${left}" appears twice.`);
        items.push({ id: 'i' + (k + 1), text: left });
        answer.push(targetId(right));
      });
      (Array.isArray(q.distractors) ? q.distractors : []).forEach((d) => { if (str(d)) targetId(str(d)); });
      if (targets.length < 2) throw new Error(`${where}: a match question needs at least 2 different answers (add "distractors" if needed).`);
      return Object.assign(base, { type: 'match', items, targets, answer, options: [] });
    }

    if (type === 'order') {
      if (!Array.isArray(q.steps) || q.steps.length < 2) throw new Error(`${where}: an order question needs at least 2 "steps", listed in the correct order.`);
      const items = q.steps.map((s, k) => {
        if (!str(s)) throw new Error(`${where}: step ${k + 1} is empty.`);
        checkRich(s, where, `step ${k + 1}`);
        return { id: 's' + (k + 1), text: str(s) };
      });
      if (new Set(items.map((x) => x.text)).size !== items.length) throw new Error(`${where}: two steps have the same text.`);
      return Object.assign(base, { type: 'order', items, answer: items.map((x) => x.id), options: [] });
    }

    // single / multiple choice
    if (!Array.isArray(q.options) || q.options.length < 2) throw new Error(`${where}: needs at least 2 "options".`);
    const options = q.options.map((o, j) => {
      const L = String.fromCharCode(65 + j);
      if (typeof o === 'string') return { id: String.fromCharCode(97 + j), text: o };
      let t = String(o && o.text != null ? o.text : '');
      if (o && str(o.image)) t += (str(t) ? '\n' : '') + imageMd(o.image, o.imageAlt != null ? o.imageAlt : str(t) || `Option ${L}`, where, `image of option ${L}`);
      return { id: String(o && o.id != null ? o.id : String.fromCharCode(97 + j)), text: t };
    });
    if (options.some((o) => !str(o.text))) throw new Error(`${where}: one of the "options" is empty.`);
    options.forEach((o, j) => checkRich(o.text, where, `option ${String.fromCharCode(65 + j)}`));
    const ids = options.map((o) => o.id);
    const answer = (Array.isArray(q.answer) ? q.answer : [q.answer]).filter((a) => a != null && a !== '').map((a) => String(a).trim());
    if (!answer.length || answer.some((a) => !ids.includes(a))) {
      throw new Error(`${where}: "answer" must use the option letters ${ids.join(', ')}.`);
    }
    if (new Set(answer).size !== answer.length) throw new Error(`${where}: the same answer is listed twice.`);
    if (type === 'single' && answer.length > 1) throw new Error(`${where}: type "single" can only have one answer; use "multiple".`);
    if (type === 'multiple' && answer.length < 2) throw new Error(`${where}: type "multiple" needs at least two answers.`);
    return Object.assign(base, { type: answer.length > 1 ? 'multiple' : 'single', options, answer });
  }

  function normalize(def) {
    if (!def || typeof def !== 'object' || Array.isArray(def)) throw new Error('The file does not contain an exam object { ... }.');
    if (!str(def.id) || !str(def.title)) throw new Error('The exam needs an "id" and a "title".');
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(str(def.id))) throw new Error('The exam "id" may only use letters, numbers, dots, dashes and underscores (no spaces).');
    if (!Array.isArray(def.questions) || !def.questions.length) throw new Error('The exam needs a non-empty "questions" array.');
    const seen = new Set();
    const questions = def.questions.map((q, i) => {
      const n = i + 1;
      const nq = normalizeQuestion(q, n);
      nq.id = String(q.id != null ? q.id : n);
      if (seen.has(nq.id)) throw new Error(`Question ${n}: duplicate id "${nq.id}".`);
      seen.add(nq.id);
      return nq;
    });
    const domains = def.domains && typeof def.domains === 'object' ? def.domains : {};
    const pass = def.passingScore == null ? 65 : Number(def.passingScore);
    if (!(pass >= 1 && pass <= 100)) throw new Error('"passingScore" must be a number from 1 to 100.');
    if (def.durationMinutes != null && !(Number(def.durationMinutes) > 0)) throw new Error('"durationMinutes" must be a number above 0.');
    return {
      id: str(def.id),
      title: str(def.title),
      category: str(def.category) || 'Other',
      level: str(def.level),
      provider: str(def.provider),
      description: str(def.description),
      durationMinutes: Number(def.durationMinutes) || Math.max(1, Math.round(questions.length * 1.3)),
      // true = practice examination only: no time limit, no pass mark, submit each answer to see the justification
      practiceOnly: def.practiceOnly === true || str(def.practiceOnly).toLowerCase() === 'true',
      passingScore: pass,
      shuffleQuestions: def.shuffleQuestions !== false,
      shuffleOptions: def.shuffleOptions !== false,
      breaks: Array.isArray(def.breaks)
        ? def.breaks.filter((b) => b && Number(b.afterQuestion) > 0).map((b) => ({ afterQuestion: Number(b.afterQuestion), minutes: Number(b.minutes) || 10 }))
        : [],
      domains,
      instructions: Array.isArray(def.instructions) ? def.instructions.map(String) : [],
      questions
    };
  }

  /** "8 Multiple choice · 2 Match · 2 Order" */
  function typeSummary(exam) {
    const c = {};
    exam.questions.forEach((q) => { const t = q.subtype || q.type; c[t] = (c[t] || 0) + 1; });
    return Object.keys(TYPE_LABELS).filter((t) => c[t]).map((t) => `${c[t]} ${TYPE_LABELS[t]}`).join(' · ');
  }

  function template() {
    return {
      id: 'powerbi-dax-basics',
      title: 'Power BI – DAX Basics Quiz',
      category: 'Power BI',
      level: 'Beginner',
      provider: 'Team Academy',
      description: 'Short quiz on core DAX ideas. Shown on the exam card.',
      durationMinutes: 20,
      passingScore: 70,
      shuffleQuestions: true,
      shuffleOptions: true,
      domains: { dax: 'DAX', model: 'Data modelling' },
      questions: [
        { id: 'q1', type: 'single', domain: 'dax', text: 'Which DAX function changes the filter context of a calculation?',
          options: ['SUM', 'CALCULATE', 'RELATED', 'FORMAT'], answer: 'b',
          explanation: 'CALCULATE evaluates an expression in a modified filter context.' },
        { id: 'q2', type: 'multiple', domain: 'model', text: 'Which TWO steps reduce the size of an imported model? (Select two.)',
          options: ['Remove columns no report uses', 'Turn on Auto date/time for every table', 'Split date-time columns into date and time', 'Add a calculated column for each measure'],
          answer: ['a', 'c'], explanation: 'Fewer columns and lower cardinality mean better compression.' },
        { id: 'q3', type: 'truefalse', domain: 'model', text: 'A calculated column is recalculated every time a user changes a slicer.',
          answer: false, explanation: 'Calculated columns are computed at refresh time, not when filters change.' },
        { id: 'q4', type: 'match', domain: 'dax', text: 'Match each DAX function to what it does.',
          pairs: [['CALCULATE', 'Evaluates an expression in a modified filter context'], ['FILTER', 'Returns a table with only the rows that meet a condition'],
            ['ALL', 'Returns all rows of a table, ignoring filters']],
          distractors: ['Converts text to a number'], explanation: 'Each value may be used once, more than once, or not at all.' },
        { id: 'q5', type: 'match', domain: 'model', fixedOrder: true, text: 'For each statement, select Yes if it is true. Otherwise, select No.',
          pairs: [['A star schema keeps facts and dimensions in separate tables.', 'Yes'], ['A slicer change re-runs calculated columns.', 'No']] },
        { id: 'q6', type: 'order', domain: 'model', text: 'Put the steps to build and share a report in the correct order.',
          steps: ['Connect to the data source', 'Clean and shape the data in Power Query', 'Create relationships and measures', 'Build the visuals', 'Publish to a workspace'] }
      ]
    };
  }

  window.ExamFormat = { normalize, typeSummary, template, TYPE_LABELS, safeImageSrc, plainText };
})();
