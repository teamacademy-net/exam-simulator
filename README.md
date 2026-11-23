# ExamSim – Computer-Based Exam Simulator

A professional-style exam simulator that students can use in any browser. It mirrors the
experience of a test-centre exam: a timed exam, a review screen, flag for review, strikethrough,
an on-screen calculator, sections with optional breaks, and a score report by domain.

It is a static site (HTML, CSS and JavaScript only), so it can be hosted **free on GitHub Pages**
with no server or database.

## Features

| Area | What students get |
|---|---|
| Pre-exam | Exam overview, candidate name, agreement screen, interface tutorial |
| Modes | **Exam simulation** (timed, no feedback) or **Practice** (untimed, check each answer with explanation) |
| Question types | Single answer and multiple response ("Select two"), scored all-or-nothing |
| Exam tools | Flag for review, strikethrough (right-click or *Strike* button), calculator, text size, keyboard shortcuts |
| Review screen | Complete / Incomplete / Unseen status for every question; *Review all / incomplete / flagged* |
| Sections & breaks | Ending a section locks it; exam clock pauses during breaks |
| Timer | Countdown with 5-minute warning; exam auto-submits when time runs out |
| Results | Pass/fail, score, time used, performance by domain (Above Target → Needs Improvement), full answer review with explanations, print/PDF |
| Persistence | In-progress exams survive page refreshes; attempt history kept in the browser |
| Content | Add exams as files in `/exams`, or import a JSON question bank from the home page |

Keyboard shortcuts: `Alt+N` next, `Alt+P` previous, `Alt+F` flag, `Alt+R` review screen.

## Student login (Supabase)

Students register and sign in with email and password before they see the exams. Each finished
exam is saved to the student's account, and admins and trainers can see every user and result on
`admin.html` (admins can also change roles and block users).

| File | What it does |
|---|---|
| `supabase/setup.sql` | Creates the `profiles` and `attempts` tables and their security rules. Run once in the Supabase SQL Editor. |
| `js/supabase-config.js` | Your Supabase Project URL and **publishable** key. Never put the secret key here. |
| `js/auth.js` | Sign in, register, forgot/reset password, blocked-account screens. |
| `js/admin.js`, `admin.html` | Users and results page for admins and trainers, with CSV export. |

Make yourself admin after registering, in the Supabase SQL Editor:
`update public.profiles set role = 'admin' where email = 'you@example.com';`

Note: login protects accounts and results, but the question files in `/exams` (with their answers)
can still be opened directly by anyone who knows the address. Moving questions and scoring into
Supabase is the next step on the roadmap.

## Question banks (JSON) and question types

Admins upload question banks on **Admin → Exams → Upload JSON** (run `supabase/setup-exams.sql` once first).
New uploads start **Hidden**; try them, then click **Publish**. Students see exams grouped in tabs by `category`
(Power BI, SQL, Python, ...), with a search box.

| Type | Key fields | Example |
|---|---|---|
| `single` | `options`, `answer: "b"` | One correct option |
| `multiple` | `options`, `answer: ["a","c"]` | "Select two" |
| `truefalse` | `answer: true` | True / False |
| `match` | `pairs: [["item","answer"], ...]`, optional `distractors` | Match functions to descriptions; Yes/No statements |
| `order` | `steps: ["first", "second", ...]` (in the correct order) | Put steps in sequence |

Exam fields: `id` (no spaces), `title`, `category`, `level`, `description`, `durationMinutes`, `passingScore`,
`practiceOnly`, `domains`, `questions`.

**Practice-only exams** (`"practiceOnly": true`): no mode choice, no time limit or clock, no pass mark or pass/fail.
Students click **Submit answer** to see Correct/Incorrect, the correct answer and the justification (`explanation`);
the question is then locked. Only submitted answers count. The result shows correct, incorrect and unanswered counts,
total time and average time per question; the answer review lists every question with no filters or flags.
Admins see total time and average per question for every attempt on **Admin → Results**.

**Code and images** (any question type; also in options, justifications, match pairs and order steps):

| You want | Write in the JSON |
|---|---|
| A code block, spacing kept exactly (any language) | ```` ```python ```` on its own line, the code, then ```` ``` ```` on its own line (inside JSON text, line breaks are `\n`) |
| Inline code | `` `x = 1` `` |
| An image under the question | `"image": "images/powerbi/q12.png", "imageAlt": "Sales by region"` |
| An image as an answer option | `{ "text": "Line chart", "image": "images/powerbi/line.png" }` (text is optional) |
| An image in the justification | `"explanationImage": "images/powerbi/q12-answer.png"` |
| An image anywhere in text | `![Short description](images/powerbi/q12.png)` |

Images can be files in this site (upload an `images` folder to GitHub, e.g. `images/powerbi/q12.png`, no spaces in names)
or web addresses starting with `https://`. Students can click **Enlarge image** to see an image full size.
See `samples/code-and-images-demo.json` (images in `images/demo/`) for a working example. See `samples/powerbi-sample.json` (12 questions, every type) and `samples/template-all-types.json`.
Scoring is all-or-nothing per question. Set `showSampleExams: false` in `js/config.js` to hide the two sample exams.

## Run it locally

Double-click `index.html`, or serve the folder:

```bash
python -m http.server 8080
```

Then open http://localhost:8080.

## Deploy to GitHub Pages

### Option A – no Git needed (GitHub website)
1. Sign in at github.com and create a new **public** repository (for example `exam-simulator`).
2. On the new repo page choose **uploading an existing file**, then drag in everything in this folder
   (`index.html`, `README.md`, `.nojekyll`, and the `css`, `js`, `exams` folders). Commit.
3. Go to **Settings → Pages**. Under *Build and deployment* choose **Deploy from a branch**,
   branch **main**, folder **/ (root)**, and save.
4. After a minute your site is live at `https://<your-username>.github.io/exam-simulator/`.

### Option B – with Git
Install Git (https://git-scm.com/download/win), then in this folder:

```bash
git init
git add .
git commit -m "Initial exam simulator"
git branch -M main
git remote add origin https://github.com/<your-username>/exam-simulator.git
git push -u origin main
```

Then enable Pages as in step 3 above.

## Adding your own exams

**For all students (published):** copy `exams/agile-foundations-sample.js`, change the content,
and add a `<script src="exams/your-file.js"></script>` line to `index.html`.

**For one browser (quick test):** on the home page click **Download template**, edit the JSON,
then **Import JSON**.

Exam format:

```js
{
  id: 'unique-id',
  title: 'Exam title',
  provider: 'Your academy',
  description: 'Shown on the exam card',
  durationMinutes: 230,
  passingScore: 65,                 // percent
  shuffleQuestions: true,
  shuffleOptions: true,             // per question, set fixedOrder: true to keep order
  breaks: [{ afterQuestion: 60, minutes: 10 }, { afterQuestion: 120, minutes: 10 }],
  domains: { people: 'People', process: 'Process' },
  instructions: ['Optional bullet points shown in the tutorial'],
  questions: [
    { id: 'q1', domain: 'people', text: 'Question?',
      options: [{ id: 'a', text: '...' }, { id: 'b', text: '...' }],   // or simply ['...', '...'] (ids a, b, c...)
      answer: ['b'],                // two or more ids = multiple response
      explanation: 'Shown in practice mode and on the answer review.' }
  ]
}
```

If a student picks fewer questions than the full exam, the time and break points scale proportionally.

Branding (app name, agreement text, rating bands) lives in `js/config.js`.

## Important notes

- **Use original or licensed content only.** Questions from real certification exams are confidential;
  sharing them ("brain dumps") breaks the candidate agreements of bodies such as PMI and test vendors
  such as Pearson VUE and can get candidates' certifications revoked. The sample questions here were
  written for this project.
- PMP is a registered mark of the Project Management Institute. This project is not affiliated with
  or endorsed by PMI, Pearson VUE or any other certification body.
- This is a **practice** tool. Everything runs in the student's browser, so answers can be found
  in the page source and results are stored only on that device. For graded or high-stakes testing
  you need a back end (student accounts, server-side questions and scoring, results database,
  proctoring) – see *Roadmap*.

## Roadmap ideas

- Student logins and a results dashboard for instructors (e.g. Supabase or Firebase back end)
- Server-side question delivery and scoring so answers are not visible in the browser
- Question types: drag-and-drop, hotspot, fill-in-the-blank
- Larger banks with per-domain weighting (e.g. 180-question full-length simulations)

## Courses: who sees which exams

Run `supabase/setup-courses.sql` once in the Supabase SQL Editor (after `setup.sql` and `setup-exams.sql`).
Then, on **Admin → Courses**:

1. **New course**: a name (e.g. *PMP*), a short code (e.g. `pmp`), the access length (3 months by default) and the exams it unlocks.
2. **Enrol students**: choose the course and paste emails (one per line). Students who have not registered yet
   get access as soon as they register with that email. Enrolling someone again renews their access from today.
3. **Enrolled students**: see who has access until when; **Renew** or **Remove** access.

Rules: a student sees an exam only if it is published and either in **no course** (free for everyone) or in one of
their **active** courses. Trainers and admins see every exam. Removing or ending access never deletes results.
Built-in sample exams can be put in a course too (they are hidden from students who are not enrolled, but their
files are public on GitHub, so use uploaded exams for real question banks).
