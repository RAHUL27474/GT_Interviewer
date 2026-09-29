# GT_Interviewer

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Claude API (Gemini and Hugging Face for testing)

HR creates a job in the dashboard, and the app makes a **Google Form** for it. HR shares the form link. When someone applies, the app picks up the response within a minute, reads their resume from the link they pasted, and the AI writes their interview questions. **30 minutes later** the applicant is emailed a login and a random password, and has **24 hours** to start the **video interview**: an AI interviewer reads each question aloud and the candidate answers on camera. The AI then grades the transcribed answers. HR sees ranked results and can watch every answer on the dashboard.

## Setup

```bash
npm install
cp .env.example .env     # then set ANTHROPIC_API_KEY and ADMIN_PASSWORD
npm run dev              # development, http://localhost:3000
# or
npm run build && npm start

npm test                 # automated tests (no keys or network needed)
npm run typecheck
```

Every setting is explained in `.env.example`. The AI is Claude when `ANTHROPIC_API_KEY` is set; otherwise Gemini (`GEMINI_API_KEY`) or Hugging Face (`HF_TOKEN`) for testing, or a no-AI mock mode when no key is set. The server logs which AI, speech-to-text, database, file storage and email it is using when it starts.

| Page | URL |
|---|---|
| 1. Application | The job's Google Form (link in the dashboard's Jobs tab) |
| 2. Candidate login | `/` (email + the password from the interview email) |
| 3. Video interview | `/interview/<id>` (candidates land here after logging in) |
| Staff dashboard (HR and Manager) | `/admin` |

## Google Forms setup

Done once, by whoever manages the company Google account. Until it's done, the app runs but no applications come in.

1. Go to [console.cloud.google.com](https://console.cloud.google.com), sign in with the Google account that should own the job forms, and create a project (e.g. "AI Interviewer").
2. **APIs & Services → Library**: enable **Google Forms API** and **Gmail API**.
3. **Google Auth Platform → Branding** (the OAuth consent screen): app name, support email. **Audience**: choose **Internal** for a Google Workspace account, or **External** for a personal Gmail.
   - External (personal Gmail): add the account under **Test users**, then click **Publish app**. If the app stays in "Testing", Google expires the connection every 7 days. When connecting, Google warns that the app is unverified: click **Advanced → Go to (app name)**. That's expected for an app only you use.
4. **Clients → Create client → Web application**. Under **Authorized redirect URIs** add `http://localhost:3000/api/admin/google/callback` for local testing, and `https://<your domain>/api/admin/google/callback` for the live site.
5. Put the **Client ID** and **Client secret** into `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Also set `APP_URL` and a fixed `SESSION_SECRET` (the saved connection is encrypted with it). Restart the app.
6. Sign in to `/admin` as a Manager or Super Admin → **Jobs** → **Connect Google**, and tick every permission on Google's screen.

**Switching accounts later** (for example from a personal Gmail to the company account): forms stay owned by the account that created them, and the app reads them as whichever account is connected. So before switching, open each open job's form in the old account (**Edit in Google Forms → ⋮ → Add collaborators**) and add the new account as an editor. Then click **Switch account** in the Jobs tab and connect the new one. New jobs' forms are created in the new account. A form the new account can't open shows "Problem reading responses" on its job.

## Applications and interview logins

- **Creating a job** with "Create a Google Form" ticked makes a form with the job description and these questions: name, phone, experience, city, current and expected CTC, joining time, resume link and LinkedIn. Google collects and checks the email address itself. Edit the job and the form's title and description follow; close or delete the job and the form stops taking responses. You can restyle the form in Google Forms, but don't delete or re-type its questions, or the app can't match the answers.
- **Every minute** the app reads new responses of open jobs (`FORM_POLL_SECONDS`). Each becomes a candidate. The resume is downloaded from the pasted link: Google Drive and Google Docs sharing links work when shared as "Anyone with the link"; any other direct `https://` link to a PDF or Word file works too. If the resume can't be read, the questions come from the job description only, and the dashboard says why. Responses that can't be used (no valid email, or the same email already applied for that job) are listed under the job.
- **`INVITE_DELAY_MINUTES` (30) after applying**, the candidate is emailed the login page, their email and a random 10-character password. It's sent from the connected account's Gmail, or through SMTP if that's set.
- **They must start within `INTERVIEW_ACCESS_HOURS` (24)** of that email. The login page and interview page show the deadline; afterwards the password stops working and the dashboard shows **Expired**. Once started, the interview runs to the end normally.
- **In the candidate panel** HR sees where the invite stands (scheduled, sent, failed, expired) and can click **Send new login details**, which makes a new password (the old one stops working) and a fresh 24-hour window. If the email can't be sent, the password is shown to HR once, to pass on by phone or WhatsApp.
- Passwords are stored hashed, the same way as staff passwords, and repeated wrong attempts lock that email for 10 minutes.

## Roles

| | Applicant | HR | Manager | Super Admin |
|---|---|---|---|---|
| Sign in | Email + the password emailed after applying, for the interview only | Email + password | Email + password | Email + password |
| View candidates, scores, videos and proctoring; download resumes; export CSV | | ✅ | ✅ | ✅ |
| Allow re-interview, re-run AI evaluation | | ✅ | ✅ | ✅ |
| Create, edit and delete jobs (and their Google Forms) and salary budgets | | ✅ | ✅ | ✅ |
| Delete candidates | | | ✅ | ✅ |
| Connect or switch the Google account | | | ✅ | ✅ |
| Team: create and manage **HR** accounts | | | ✅ | ✅ |
| Team: create and manage **Manager** and **Super Admin** accounts | | | | ✅ |

On a fresh install, the first account is a **Super Admin**, created from `SUPER_ADMIN_EMAIL` + `ADMIN_PASSWORD` in `.env`. They add everyone else under **Team**. There is always at least one active Super Admin, and nobody can change their own role or deactivate themselves. Passwords are stored hashed (scrypt). Sessions last 12 hours and are signed with `SESSION_SECRET`. Deactivating someone or resetting their password signs them out immediately. An account that stays **deactivated for more than 15 days is deleted automatically** (`ACCOUNT_DELETE_AFTER_DAYS`, checked hourly); reactivating it before then cancels the countdown. After 5 failed sign-ins, that email is locked for 10 minutes.

## Project layout

```
app/
  page.tsx                  Registration page (server component, loads open jobs)
  interview/[id]/page.tsx   Interview page
  admin/page.tsx            HR dashboard (login, or candidates + jobs)
  api/                      Route handlers: register, interview/*, admin/*, health
components/                 React client components (form, interview, dashboard)
lib/
  ai/                       Question generation, grading and speech-to-text (index.ts has the prompts;
                            claude.ts, gemini.ts, hf.ts and mock.ts are the providers)
  scoring.ts                Scoring rules: edit the numbers here
  proctoring.ts             Proctoring event weights and the integrity rating
  store.ts                  Records: PostgreSQL (lib/db/postgres.ts) or JSON files (lib/db/json.ts)
  files.ts                  Files: S3-compatible bucket or the local data/ folder
  email.ts                  Login-details and HR emails (Gmail or SMTP)
  google.ts                 Google account connection (OAuth) and API calls
  google-forms.ts           Creating job forms and reading their responses
  intake.ts                 Form responses -> candidates (runs every minute)
  resume-link.ts            Safe download of resumes from pasted links
  access.ts                 Candidate passwords, invite emails, the 24-hour window
  auth.ts                   Staff accounts and cookie sessions
config/jobs.seed.json       Starting jobs (copied in on first run)
tests/                      Automated tests (npm test)
```

## Flow

1. **Application** (Google Form, see above): the AI reads the resume and job description and writes `QUESTION_COUNT` questions: about 70% from the job description, 30% probing resume claims that matter for the role (all from the job description if the resume couldn't be read). The login email follows 30 minutes later.
2. **Video interview** (laptop or desktop; see [Browsers](#browsers)), after logging in:
   - The candidate turns on the camera and microphone and checks the mic level meter.
   - For each question, the AI interviewer reads it aloud (browser text-to-speech). The candidate gets `PREP_SECONDS` of thinking time, then recording starts automatically.
   - The answer is recorded on video for up to `MINUTES_PER_QUESTION`, and the browser's speech recognition writes a live transcript.
   - Each answer's video, transcript and 3 small webcam snapshots are uploaded before the next question. There are no retakes, and tab switches are counted.
3. **Evaluation**: runs in the background after the last answer, using Next's `after()`. First each answer video is transcribed again on the server (see below). Then the AI scores each transcript 0–10 against the job description, ignoring speech-recognition errors and accent. It also checks the snapshots and flags clear issues such as no face or a second person. These proctoring flags are shown to HR and don't affect the score. If the server restarts mid-grade, `instrumentation.ts` resumes it. When grading finishes (or fails), `HR_NOTIFY_EMAILS` get an email.

**Speech-to-text** (`SPEECH_TO_TEXT`): the browser's live transcript is free but often inaccurate, so before grading the server re-transcribes each answer video with **Gemini** (when `GEMINI_API_KEY` is set) or **Whisper** on Hugging Face (when `HF_TOKEN` is set). This works with every AI provider, including Claude, which can't listen to audio itself. The dashboard labels each transcript with its source; if server transcription fails for an answer, the browser transcript is kept. Set `SPEECH_TO_TEXT=off` to use only the browser's. Whatever the source, HR should watch the videos of shortlisted candidates.

### Browsers

The interview needs a **laptop or desktop**: phones and tablets can't share their entire screen, so they're turned away with a message to switch device. **Chrome and Edge** are recommended and fully supported, including the second-monitor check. **Firefox** has no built-in speech recognition, so it is allowed only when server speech-to-text is on (it is with a Gemini key or HF token). Safari and Firefox pass the same feature checks but have not been tested as thoroughly as Chrome and Edge.

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

An interview **can't be resumed**. If the candidate refreshes, closes the tab, reopens the link, or loses connection for `HEARTBEAT_TIMEOUT_SECONDS` (default 90), it is **submitted as it is**. Unanswered questions score 0, and the candidate is told to contact `HR_CONTACT` for a re-interview. In the dashboard, HR clicks **Allow re-interview**, which archives the attempt, issues new questions, and immediately emails a new password with a fresh 24-hour window (or shows it to HR if the email fails).

## Email

Emails go out from the connected Google account's Gmail. To send from another mailbox instead, set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM` (any provider: Zoho Mail `smtp.zoho.in` port 465, Microsoft 365, Amazon SES, Brevo…). `APP_URL` must be set so emails can link to the login page. Personal Gmail can send about 500 emails a day; Google Workspace about 2,000.

| When | Who gets it |
|---|---|
| `INVITE_DELAY_MINUTES` after applying | The candidate: login page, email, password, the deadline to start, and what they need |
| HR clicks **Send new login details** or **Allow re-interview** | The candidate: a new password and a new deadline |
| An interview is graded, or grading fails | Everyone in `HR_NOTIFY_EMAILS`: name, role, recommendation and total, with a dashboard link |

A failed login email is retried every 10 minutes and shown as **Email failed** on the dashboard. A mail problem never blocks grading.

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

## Deployment

**Docker (one server):** `docker compose up -d --build` runs the app and PostgreSQL together, reading settings from `.env` (set `POSTGRES_PASSWORD` there too). Files stay on the app's `app-data` volume unless `S3_BUCKET` is set. Put a reverse proxy with HTTPS in front (Caddy, Nginx, or your host's load balancer): browsers only allow camera and screen sharing on HTTPS.

**Docker (managed database):** with `DATABASE_URL` and `S3_BUCKET` pointing at hosted services, run just the image:

```bash
docker build -t ai-interviewer .
docker run -d -p 3000:3000 --env-file .env --restart unless-stopped ai-interviewer
```

**Without Docker:** any Node 22.9+ host (Railway, Render, a VPS): `npm ci && npm run build && npm start`.

`GET /api/health` returns 200 when the app can read its database; the Docker image uses it as its health check.

**Backups:**
- Hosted PostgreSQL (Neon, Supabase, Railway) and S3/R2 buckets have their own backups or versioning; turn them on.
- Docker Compose database: `docker compose exec db pg_dump -U interviewer interviewer > backup.sql`, run daily (for example from cron) and copied off the server.
- Local files (no `S3_BUCKET`): back up the `app-data` volume, or the `data/` folder outside Docker.
- Answer videos are deleted automatically `MEDIA_RETENTION_DAYS` after each interview (default 15), so the file store stays small; resumes, transcripts and scores are kept.
