# Screening Platform Infrastructure

## Phase 1

- Candidate and job records can use PostgreSQL through `DATABASE_URL`; without it, local development retains the JSON store.
- Resume files, answer videos, proctoring snapshots, and screen-recording chunks use S3-compatible storage when `OBJECT_STORAGE_BUCKET` is set; otherwise they remain under `data/`.
- Resume screening uses a Redis/BullMQ worker when `REDIS_URL` is set. Without Redis, the current local flow processes screening inline.
- Screen recordings are stored as ordered objects in S3 mode and streamed with HTTP Range support for HR playback.
- Existing JSON records and files can be copied to PostgreSQL and object storage with `npm run db:import-json`. The importer preserves the local source files and skips existing database records.

## Round 1 Screening Pipeline

```
apply (resume + contact) ──► screening ──┬─► SHORTLISTED ──► invite ──► details ──► brief ──► device check ──► interview ──► HR decision
                                         ├─► HR_REVIEW   ──► awaiting_screening ──► HR dashboard
                                         └─► NOT_SHORTLISTED ──► awaiting_screening ──► HR dashboard
```

The scorer is the Python model in `../src/resume_screening`, not an LLM judge. It
runs as a resident process (`scripts/screening_bridge.py`) speaking newline-delimited
JSON on stdin/stdout, wrapped by `lib/screening-engine.ts`. The model is loaded once
per process because loading `all-MiniLM-L6-v2` costs several seconds; spawning per
request would add that to every candidate. The handle is cached on `globalThis` so
the web app and the worker each keep one bridge.

| Piece | File | Role |
| --- | --- | --- |
| Python bridge | `scripts/screening_bridge.py` | Resume text extraction (with OCR), embeddings, skill coverage, dimension scores |
| Bridge client | `lib/screening-engine.ts` | Spawn/reuse, request correlation, timeouts, graceful shutdown |
| Orchestration | `lib/screening.ts` | Bridge first, LLM judge as fallback, three-state decision |
| Report shape | `lib/types.ts` | `ResumeScreeningReport`, `ScreeningScores` |
| Record upgrade | `lib/store.ts` | `upgradeScreening`, for reports written before this existed |
| Admin view | `components/admin/ResumeScreeningPanel.tsx` | Score breakdown and evidence |
| Candidate view | `components/interview/ResumeScreenWaiting.tsx` | Outcome only, never the score |

### The apply form asks for the least that can run screening

`POST /api/register` takes a job, a name, an email, a phone and a resume. Nothing
else. Experience, location, LinkedIn, current and expected CTC, and joining date are
collected **after** the shortlist, on step 1 of 3, by `lib/profile.ts`'s
`parseDetailsForm`.

The reason is not a shorter form. Someone who is not going to be interviewed should
not have handed over their compensation to find out, and the fields that carry real
weight — salary and joining, worth 30 of the 100 points in `lib/scoring.ts` — change
nothing for a candidate who never reaches the interview. Scoring still works: the
interview only opens once `profileComplete` is true, so by the time an answer is
graded every input is real.

`CandidateProfile` keeps all nine fields typed and non-null, so a record written at
apply time is a complete, ordinary record with `profileComplete: false` and zeros and
empty strings. Nothing downstream has to learn about a half-filled record; `/admin`
already renders `–` for each of those fields until the flag flips.

`parseApplicationDetails` lower-cases the email, and the duplicate check keys on
email + job alone. Keying it on `profileComplete` would have let someone apply,
wait, and apply again with the same address while their first application sat in the
queue.

### The three steps between a shortlist and the interview

| Step | Route | Component | Holds |
| --- | --- | --- | --- |
| Invite | `/interview/[id]` | `ShortlistInvite.tsx` | Role, duration, focus areas, deadline, "before you begin", the CTA |
| 1 of 3 | `/interview/[id]/details` | `DetailsStep.tsx` | Contact (prefilled) plus the fields screening could not ask for |
| 2 of 3 | `/interview/[id]/brief` | `InterviewBrief.tsx` | Duration, topics, the recording disclosure, the refresh warning |
| 3 of 3 | `/interview/[id]/round-2` | `DeviceCheck` in `VideoInterview.tsx` | Camera, face, microphone, whole screen, fullscreen |

`/interview/[id]` is the router for all four experiences. It branches on
`candidate.status` and redirects rather than conditionally rendering, so a
bookmark, an emailed link or a refresh tomorrow lands on the screen that matches the
current state rather than a stale view of it.

Two structural choices in that table are load-bearing:

- **The device check lives inside the interview page, not on a route of its own.**
  Screen-share and camera streams do not survive a navigation. A separate `/setup`
  page would ask for permissions twice and drop the screen share on the Continue
  click. Keeping it in the same client component that records means the stream the
  candidate just approved is the one that gets used. The `3/3` indicator is inside
  that component, so it appears during the check and disappears once the interview
  starts.
- **`lib/invite.ts` holds the copy, not the components.** The words a candidate reads
  are a policy decision, and `lib/invite.test.ts` asserts what they must never
  contain: no score, no threshold, no outcome label, and no promise of typing. The
  interview is spoken only, so copy that offered a keyboard would be a lie the
  candidate discovers with the timer running.

Focus areas are derived from the job description's own requirements and
responsibilities, capped at `INTERVIEW_TOPICS_MAX`, trimmed at a word boundary, and
falling back to the role title. The screening report's `requiredSkills` is a last
resort: those are lowercased matcher tokens, and `aws css express git` on an
invitation reads like a search query rather than a description of the conversation
the candidate is about to have. It is never the first choice.

Contact details are prefilled on step 1; years of experience is not. The resume
extractor read a 2020–2025 resume as "2 years", and that number is scored — a wrong
default that looks like a real answer is worth up to 20 points of a candidate's own
score, and a candidate skims a prefilled field.

### Five weighted dimensions

`required_skills 40% · experience 20% · projects 15% · semantic 15% · education 10%`

Required skills and semantic fit come from the Python model. The other three are
derived from the parsed resume fields and what the job description states.

**A dimension the job description says nothing about scores neutral (60), not zero.**
Coverage of an empty required-skill list computes as 0/0, which reads as "matched
none of the required skills" and would dock 40 weighted points for the vagueness of
the posting rather than for anything the candidate did. This applies to required
skills, experience, education and projects alike, and the report carries an
`engineNotes` entry so a reviewer knows to discount the number.

### Thresholds

`RESUME_SCREEN_PASS_SCORE` defaults to **75**, not the upstream model's 90. Cosine
similarity between a resume and a job description for genuinely related professional
text lands around 0.6-0.75, which rescales to roughly 80-88, so a 90 cut-off would
reject effectively every real candidate. The review floor defaults to 50.

### What the model must not decide

Nothing is ever auto-rejected. Every candidate reaches one of the three states, and
both non-advancing states land in the HR queue with the full breakdown. Name, age,
gender, nationality and college prestige are excluded from every dimension: the
education dimension compares degree *level* only, never institution name.

### Degradation

The bridge is an enhancement, never a dependency. If the interpreter, the venv or the
script is missing, every call resolves to `null` and `lib/screening.ts` falls back to
the LLM judge in `lib/ai`. A candidate is never blocked from applying because a local
model is not installed. Set `SCREENING_BRIDGE_ENABLED=false` to always use the LLM.
Reports record which engine produced them (`engine: bridge | llm | mock`).

The bridge receives resume *bytes*, not text, so scanned PDFs are OCR'd. The Node app
has no OCR of its own.

## Notifications

Three messages, all via an HTTP email API (Resend or SendGrid — no extra dependency):

| Event | To | When |
| --- | --- | --- |
| `application_received` | Candidate | Immediately after they apply |
| `interview_ready` | Candidate | Once the candidate is shortlisted and the invite link works |
| `awaiting_hr_review` | HR | Candidate held, or screening errored |

`interview_ready` fires when the candidate reaches `profile_pending`, not when they
submit details. The link in that mail is the invitation, and it is live from that
moment, so sending it later would mean the email arrives after the link is already
the only way back in. The invitation shows a "we also sent this to your email" note
only when the notification record says the send actually succeeded, so a missing
mail provider does not leave the page promising mail that never went out.

Rules the implementation enforces, each with a test in `scripts/test-notify.ts`:

- **A mail failure never fails screening or registration.** The attempt is recorded on
  the candidate either way, so a failed send is visible in the admin drawer and can be
  followed up by hand.
- **Nothing is ever sent to reject a candidate.** A not-shortlisted applicant receives
  only the acknowledgement; HR still decides. There is no rejection template.
- **No score ever reaches a candidate.** The waiting page and the candidate mails show
  an outcome, not a grade.
- **The interview link is only mailed when an interview is actually open.** Otherwise
  the candidate receives a link to a page saying "under review". HR overriding the model
  counts as open, so those candidates are told too.
- **Everything is off by default** until `NOTIFY_EMAIL_PROVIDER` is set, so a fresh
  checkout sends nothing and cannot fail a registration.

## Careers page and job syndication

The job records in `data/jobs.json` were already the single source of truth for
the application form, so the careers page is a second read of that same file
rather than a separate CMS. Everything the outside world sees about a role is
derived from it in `lib/careers.ts`.

| Surface | File | Feeds |
| --- | --- | --- |
| Listing | `app/careers/page.tsx` | `ItemList` + `Organization` JSON-LD |
| Role detail | `app/careers/[id]/page.tsx` | `JobPosting` JSON-LD |
| RSS 2.0 | `app/careers/feed.xml/route.ts` | Most aggregators, and Slack/Teams link previews |
| JSON Feed 1.1 | `app/careers/jobs.json/route.ts` | Self-hostable feed readers |
| Discovery | `app/sitemap.ts`, `app/robots.ts` | Indexable under `SITE_URL` |

**Set `SITE_URL`.** Every URL in the JSON-LD and the feeds is absolute, because
Google discards a `JobPosting` whose `url` is relative. Left unset it
defaults to `http://localhost:3000`, which is valid output and useless for
indexing.

**`baseSalary` is deliberately absent.** `Job.salaryMin` / `salaryMax` are an
internal budget used by the scoring rules. `toPublishedJob()` is the only way a
job becomes a `PublishedJob`, and the salary fields do not survive it, so
nothing downstream — HTML, JSON-LD, RSS, or a board payload — can leak it. Both
test files assert this rather than trusting the type.

### Why not Naukri

Naukri has no public posting API. Everything published as a "Naukri API" is
scraping in the opposite direction, posting is recruiter-UI-only or an
enterprise contract, and driving the UI with a browser breaks their terms with
a real risk of a permanent ban on the employer's own account. LinkedIn's Job
Posting API exists but is closed to new partners. So the design pushes jobs out
through channels we are actually allowed to use — Google for Jobs reads the
`JobPosting` graph, aggregators read the feeds — and pushes to boards only where
a real API exists.

### Recruitee

`lib/publishers/` is a small adapter interface (`types.ts`) with one
implementation, `recruitee.ts`, talking to `https://api.recruitee.com/c/{company_id}`
with a Personal API Token. That token is full-permission for the generating
user and cannot be scoped down, so it is server-side only and the sole entry
point is the admin route.

| Step | Call |
| --- | --- |
| Resolve a city to a location id | `GET /locations` |
| Find the existing listing | `GET /offers`, `GET /offers/{id}` |
| Create | `POST /offers` |
| Update / relist / withdraw | `PATCH /offers/{id}` |

Run it with `POST /api/admin/jobs/publish?dryRun=false` (admin session
required). `GET` on the same path reports the configuration and the last
recorded state per job.

Three things make repeat runs safe, which is the property that actually matters —
clicking publish twice must not produce two listings:

- `data/job-publishes.json` records the remote id and a content hash per job.
  An unchanged job is a `skip` with no HTTP write at all.
- If local state is lost, `findOffer()` falls back to an exact title match
  before creating, so a reset `data/` directory does not duplicate the board.
- The Careers Site API token cannot create offers; only a Personal API token
  can. Using the wrong one is a hard failure at the first `POST`, not a silent
  half-published state.

**`JOB_PUBLISH_DRY_RUN` defaults to `true`.** A half-finished token cannot
publish a real board by accident. The dry run reports the exact call it would
make and writes nothing.

```env
SITE_URL=https://apply.example.com
CAREERS_EMAIL=careers@example.com
JOB_PUBLISHER=recruitee            # "none" keeps everything on our own page
JOB_PUBLISH_DRY_RUN=false          # only after the dry-run output looks right
RECRUITE_COMPANY_ID=12345
RECRUITE_API_TOKEN=...
RECRUITE_LOCATION_ID=42            # used when a job's city is not in the account
RECRUITE_API_BASE=https://api.recruitee.com   # ...or api.rc.recruitee.com to rehearse
```

`npm run careers:test` covers the escaping, the `JobPosting` shape Google
validates, the location matcher, and the full create/update/withdraw/idempotency
sequence against a local stand-in for the Recruitee API.

## Local Services

Docker Compose provides PostgreSQL, Redis, and MinIO:

```powershell
docker compose up -d
```

Set these service values in `GT_Interviewer/.env` alongside the app's existing AI and admin settings:

```env
DATABASE_URL=postgresql://gt_interviewer:local-development-only@localhost:5432/gt_interviewer
REDIS_URL=redis://localhost:6379
OBJECT_STORAGE_BUCKET=gt-interviewer
OBJECT_STORAGE_ENDPOINT=http://localhost:9000
OBJECT_STORAGE_REGION=us-east-1
OBJECT_STORAGE_ACCESS_KEY=interviewer
OBJECT_STORAGE_SECRET_KEY=local-development-only
```

Initialize and import existing data once:

```powershell
npm run db:migrate
npm run db:import-json
```

Run the Next.js application and screening worker in separate terminals:

```powershell
npm run dev
npm run screening:worker
```

## Production Deployment

Provision managed PostgreSQL, Redis, and S3-compatible object storage. Set `DATABASE_URL`, `REDIS_URL`, `OBJECT_STORAGE_BUCKET`, and `OBJECT_STORAGE_REGION` in both the web and worker environments. For non-AWS object storage, also set the endpoint and credentials. Run `npm run db:migrate` before deploying the web app, and run `npm run screening:worker` as a separate long-lived worker process.

The current application still uses the Next.js API for uploads and interview actions. WebSocket/WebRTC conversational streaming, a dedicated media server, and RAG/vector retrieval remain later phases; this change does not claim to provide those services or a custom-trained model.

### The screening bridge in production

The bridge needs the parent repository's virtualenv, so the web and worker environments
must have `../.venv` present (or `SCREENING_BRIDGE_PYTHON` pointed at an equivalent
interpreter with `sentence-transformers` installed). The first run downloads
`all-MiniLM-L6-v2` from Hugging Face (~90 MB) and caches it; mount the cache or
pre-warm the model in the image so the first candidate does not wait on a download.

If the venv cannot be shipped to the deployment target, leave `SCREENING_BRIDGE_ENABLED`
unset and screening falls back to the LLM judge — the pipeline, the three states, the
admin breakdown and all notifications continue to work.
