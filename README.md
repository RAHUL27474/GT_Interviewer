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
| HR dashboard | `/admin` |

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
  store.ts                  JSON-file storage in data/
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

## Scoring (`lib/scoring.ts`)

| Part | Range | Rule |
|---|---|---|
| Interview | 0 to 70 | Average answer score (0–10) × 7 |
| Joining date | −10 to +15 | Immediate +15, 15 days +10, 30 days +5, 60 days 0, 90 days −5, 90+ days −10 |
| Salary | −15 to +15 | Compares expected CTC with the job budget: +15 at or below the minimum, falling to +5 at the maximum; up to 10% over is 0, up to 25% over is −5, more is −10. A hike over current CTC above 30% adds −2, above 50% adds −5. |
| **Total** | **−25 to 100** | Strong Hire ≥ 75, Hire ≥ 60, Maybe ≥ 45, otherwise Reject |

Each job's salary budget is set in the dashboard's Jobs tab and is never sent to applicants.

## Data

Everything is stored in `data/`: `candidates.json`, `jobs.json`, `resumes/` and `videos/<candidate-id>/` (about 5 MB per minute of answer video). Back this folder up. The JSON store needs a normal Node server (`npm start`, a VPS, or Docker). On serverless hosting such as Vercel, swap `lib/store.ts` for a database.
