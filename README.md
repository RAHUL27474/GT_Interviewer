# GT_Interviewer

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Claude API

Candidates register with their details and resume, then take a **video interview**: an AI interviewer reads each question aloud and the candidate answers on camera. Claude writes the questions from the job description and resume, then grades the transcribed answers. HR sees ranked results and can watch every answer on a dashboard.

## Setup

```bash
npm install
cp .env.example .env     # then set ANTHROPIC_API_KEY and ADMIN_PASSWORD
npm run dev              # development, http://localhost:3000
# or
npm run build && npm start
```

| Page | URL |
|---|---|
| 1. Registration | `/` (link to one job with `/?job=<job-id>`) |
| 2. Video interview | `/interview/<id>` (applicants are sent here after registering) |
| Staff dashboard (HR and Manager) | `/admin` |

## Roles

| | Applicant | HR | Manager | Super Admin |
|---|---|---|---|---|
| Sign in | No, uses their private interview link | Email + password | Email + password | Email + password |
| View candidates, scores, videos and proctoring; download resumes; export CSV | | ✅ | ✅ | ✅ |
| Allow re-interview, re-run AI evaluation | | ✅ | ✅ | ✅ |
| Create, edit and delete jobs and salary budgets | | ✅ | ✅ | ✅ |
| Delete candidates | | | ✅ | ✅ |
| Team: create and manage **HR** accounts | | | ✅ | ✅ |
| Team: create and manage **Manager** and **Super Admin** accounts | | | | ✅ |

On a fresh install, the first account is a **Super Admin**, created from `SUPER_ADMIN_EMAIL` + `ADMIN_PASSWORD` in `.env`. They add everyone else under **Team**. There is always at least one active Super Admin, and nobody can change their own role or deactivate themselves. Passwords are stored hashed (scrypt). Sessions last 12 hours and are signed with `SESSION_SECRET`. Deactivating someone or resetting their password signs them out immediately. An account that stays **deactivated for more than 15 days is deleted automatically** (`ACCOUNT_DELETE_AFTER_DAYS`, checked hourly); reactivating it before then cancels the countdown. After 5 failed sign-ins, that email is locked for 10 minutes.

## Project layout

```
app/
  page.tsx                  Registration page (server component, loads open jobs)
  interview/[id]/page.tsx   Interview page
  admin/page.tsx            HR dashboard (login, or candidates + jobs)
  api/                      Route handlers: register, answer, admin/*
components/                 React client components (form, interview, dashboard)
lib/
  claude.ts                 Question generation and answer grading (Claude API)
  scoring.ts                Scoring rules: edit the numbers here
  store.ts                  Records: PostgreSQL (lib/db/postgres.ts) or JSON files (lib/db/json.ts)
  files.ts                  Files: S3-compatible bucket or the local data/ folder
  auth.ts                   Admin cookie session
config/jobs.seed.json       Starting jobs (copied to data/jobs.json on first run)
```

## Flow

1. **Registration**: position, name, email, phone, experience, current and expected CTC (₹ LPA), joining timeline, resume (PDF, DOCX or TXT). Claude reads the resume and job description and writes `QUESTION_COUNT` questions: about 70% from the job description, 30% probing resume claims that matter for the role.
2. **Video interview** (Chrome or Edge, desktop):
   - The candidate turns on the camera and microphone and checks the mic level meter.
   - For each question, the AI interviewer reads it aloud (browser text-to-speech). The candidate gets `PREP_SECONDS` of thinking time, then recording starts automatically.
   - The answer is recorded on video for up to `MINUTES_PER_QUESTION`, and the browser's speech recognition writes a live transcript.
   - Each answer's video, transcript and 3 small webcam snapshots are uploaded before the next question. There are no retakes, and tab switches are counted.
3. **Evaluation**: runs in the background after the last answer, using Next's `after()`. Claude scores each transcript 0–10 against the job description, ignoring speech-recognition errors and accent. It also checks the snapshots and flags clear issues such as no face or a second person. These proctoring flags are shown to HR and don't affect the score. If the server restarts mid-grade, `instrumentation.ts` resumes it.

The browser's speech recognition is free but not perfect. If a transcript looks wrong, HR can watch the video, and it helps to always watch the videos of shortlisted candidates.

## Live proctoring

Runs in the candidate's browser (`components/interview/useProctor.ts`). Google MediaPipe checks the camera about 3 times a second, and browser events are watched. Each problem shows the candidate a warning and is logged with a timestamp, question number and snapshot. HR sees an integrity rating (Low / Medium / High risk) and a timeline. Flags never change the score. Event weights are in `lib/proctoring.ts`.

| Check | Rule |
|---|---|
| Face missing | No face for more than 3 s |
| More than one person | 2+ faces for more than 1 s |
| Different person | Face recognition (face-api) enrolls the candidate at the start; a different face for ~4.5 s |
| Looking away | Head turned or tilted for more than 3 s |
| Phone in view | Detected in 2 checks in a row |
| Left window / tab | Window blur or tab hidden |
| Fullscreen / tab | Required. Leaving the tab or fullscreen gives a warning with a countdown; see the rule below |
| Typing | Keys pressed while recording (answers are spoken) |
| Copy | Copy, cut and right-click are blocked |
| Second monitor | Detected at start (Chrome/Edge) |
| Screen sharing stopped | Blocking "share again" overlay; each re-share is saved as a new recording part |

**Camera rules** (`MAX_LOOK_AWAY_WARNINGS`, `SECOND_PERSON_GRACE_SECONDS`):
- **Looking away:** head turned away for 3 seconds or more counts once. The first 2 times are warnings, and the 3rd ends the interview.
- **Another person on camera:** the first time starts a 5-second countdown, and the interview ends if they're still visible at 0. Any second appearance ends it immediately.
- **Different person in the candidate's place:** same as above, but the countdown only stops when the original candidate's face is recognised again.

A look-away only counts again after the candidate has looked back for 2 seconds or more, so one long glance counts once.

**Leaving rule** (`MAX_WARNINGS`, `AWAY_GRACE_SECONDS`): the first 2 times a candidate leaves the tab or window or exits fullscreen, they get a warning with a 10-second countdown. Leaving a 3rd time, or staying away longer than 10 seconds, **submits the interview as it is**, and they're told to contact HR for a re-interview. Switching tabs also exits fullscreen, which counts as one violation that ends only when they're back in fullscreen.

**Setup is enforced in order** before "Start interview" unlocks: camera and mic plus face detected → **share the entire screen** (windows and tabs are rejected) → **enter fullscreen**.

**Screen recording** covers the whole interview, including thinking time, at about 2 MB per minute. It's uploaded in 10-second chunks (`/api/interview/[id]/screen`), so an interrupted interview keeps its recording up to that point. HR watches it in the candidate panel.

## Interrupted interviews

An interview **can't be resumed**. If the candidate refreshes, closes the tab, reopens the link, or loses connection for `HEARTBEAT_TIMEOUT_SECONDS` (default 90), it is **submitted as it is**. Unanswered questions score 0, and the candidate is told to contact `HR_CONTACT` for a re-interview. In the dashboard, HR clicks **Allow re-interview**, which archives the attempt and issues new questions on the same link, then **Copy interview link** to send it to the candidate.

## Scoring (`lib/scoring.ts`)

| Part | Range | Rule |
|---|---|---|
| Interview | 0 to 70 | Average answer score (0–10) × 7 |
| Joining date | −10 to +15 | Immediate +15, 15 days +10, 30 days +5, 60 days 0, 90 days −5, 90+ days −10 |
| Salary | −15 to +15 | Compares expected CTC with the job budget: +15 at or below the minimum, falling to +5 at the maximum; up to 10% over is 0, up to 25% over is −5, more is −10. A hike over current CTC above 30% adds −2, above 50% adds −5. |
| **Total** | **−25 to 100** | Strong Hire ≥ 75, Hire ≥ 60, Maybe ≥ 45, otherwise Reject |

Each job's salary budget is set in the dashboard's Jobs tab and is never sent to applicants.

## Data

Two settings decide where data lives; both are optional for local testing:

| | Set | Not set (local testing) |
|---|---|---|
| Records: candidates, jobs, staff | `DATABASE_URL`: PostgreSQL (Neon, Supabase, Railway…). Tables are created on first start. | JSON files in `data/` |
| Files: resumes, answer videos, snapshots, screen recordings | `S3_BUCKET` + `S3_ENDPOINT` / keys: any S3-compatible bucket (Cloudflare R2, AWS S3…). Keep it private. | `data/resumes/`, `data/videos/<candidate-id>/` |

Answer video is about 5 MB per minute and screen recording about 2 MB per minute, so budget roughly 30–40 MB of storage per completed interview.

**Moving local data to the cloud:** fill in `DATABASE_URL` (and the `S3_*` settings) in `.env`, then run `npm run migrate`. It copies jobs, staff accounts, candidates and all files; running it again skips candidates already copied. The local `data/` folder is left untouched.

With both set, the app keeps nothing on its own disk, so it runs on any Node host and on several servers at once (updates lock the database row).
#   G T _ I n t e r v i e w e r  
 