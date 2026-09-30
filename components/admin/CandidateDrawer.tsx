"use client";

import { useCallback, useEffect, useState } from "react";
import type { Candidate } from "@/lib/types";
import { Alert, Button, buttonClass, Pill } from "../ui";
import { IconCheck, IconDownload, IconExternal, IconFile, IconLink, IconRepeat, IconSparkles, IconTrash, IconX } from "../icons";
import { computeIntegrity, PROCTOR_EVENTS } from "@/lib/proctoring";
import { inviteState } from "@/lib/invite-state";
import { IntegrityPill, RecommendationPill, Signed, statusBadge } from "./shared";

interface LoginResult {
  emailed?: boolean;
  password?: string;
  error?: string;
}

function loginResultText(r: LoginResult) {
  if (r.emailed) return "New login details have been emailed to the candidate.";
  if (r.password) {
    return `The email couldn't be sent (${r.error}).\n\nPass these on to the candidate yourself (shown only once):\nLogin page: ${window.location.origin}/\nPassword: ${r.password}`;
  }
  return `Login details couldn't be sent: ${r.error ?? "unknown error"}`;
}

const when = (iso: string) => new Date(iso).toLocaleString();

const DECISION: Record<NonNullable<Candidate["screening"]>["decision"], { label: string; tone: "good" | "bad" | "warn" }> = {
  selected: { label: "Shortlisted", tone: "good" },
  rejected: { label: "Not selected", tone: "bad" },
  review: { label: "Needs review", tone: "warn" },
};

/** The resume screening result, which emails went out, and HR's override buttons. */
function ScreeningPanel({ c, onDecide }: { c: Candidate; onDecide: (d: "selected" | "rejected") => void }) {
  const s = c.screening!;
  const d = DECISION[s.decision];
  const notStarted = c.status === "ready" || c.status === "rejected";
  const decisionEmail =
    s.decision === "rejected"
      ? s.rejectionEmailedAt
        ? `Rejection email sent ${when(s.rejectionEmailedAt)}.`
        : `Rejection email due ${when(c.access?.inviteAt ?? s.at)}.`
      : null;
  return (
    <div className="space-y-2 rounded-2xl border border-line bg-surface p-5 shadow-card text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">Resume screening</h3>
        <Pill tone={d.tone}>{d.label}</Pill>
        {s.score !== null && <span className="text-fg-3">AI rating {s.score}/100</span>}
        {s.decidedBy && <span className="text-fg-3">· decided by {s.decidedBy}</span>}
        {notStarted && (
          <span className="ml-auto flex gap-2">
            {s.decision !== "selected" && <Button onClick={() => onDecide("selected")}>Shortlist &amp; invite</Button>}
            {s.decision !== "rejected" && (
              <Button variant="ghost" onClick={() => onDecide("rejected")} className="!border-danger-line !text-danger-fg hover:!bg-danger-soft">
                Reject
              </Button>
            )}
          </span>
        )}
      </div>
      <ul className="list-disc pl-5 text-fg-2">
        {s.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      {s.summary && <p className="text-fg-2">{s.summary}</p>}
      {(s.strengths.length > 0 || s.gaps.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-ok-fg">Strengths</p>
            <ul className="list-disc pl-5">{s.strengths.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
          <div>
            <p className="text-xs font-medium text-danger-fg">Gaps</p>
            <ul className="list-disc pl-5">{s.gaps.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
        </div>
      )}
      <p className="text-xs text-fg-3">
        {s.receivedEmailedAt
          ? `"Application received" email sent ${when(s.receivedEmailedAt)}.`
          : s.receivedEmailError
            ? `"Application received" email failed: ${s.receivedEmailError}`
            : ""}{" "}
        {decisionEmail}
        {s.decision === "review" && " No email goes out until you shortlist or reject."}
        {c.access?.emailError && s.decision === "rejected" && ` Last attempt failed: ${c.access.emailError}`}
      </p>
    </div>
  );
}

/** Where the interview login stands, with a button to send new details. */
function LoginStatus({ c, onSendLogin }: { c: Candidate; onSendLogin: () => void }) {
  const a = c.access;
  const state = inviteState(c);
  const text = !a
    ? "Applied before interview logins existed: uses the private interview link."
    : state === "scheduled"
      ? `Login email scheduled for ${when(a.inviteAt)}.`
      : state === "email_failed"
        ? `Login email failed: ${a.emailError}. Retrying${a.retryAt ? ` at ${when(a.retryAt)}` : ""}.`
        : state === "expired"
          ? `Didn't start in time: login expired ${when(a.expiresAt!)}.`
          : `Login ${a.delivery === "manual" ? "details given to HR to pass on" : "emailed"} ${when(a.invitedAt!)}; must start by ${when(a.expiresAt!)}.`;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface-2 p-3 text-sm">
      <span className="flex-1">{text}</span>
      <Button variant="secondary" onClick={onSendLogin}>
        {state === "scheduled" ? "Send login details now" : "Send new login details"}
      </Button>
    </div>
  );
}

interface Props {
  id: string;
  joiningLabels: Record<string, string>;
  onClose: () => void;
  onChanged: () => void;
  /** Managers only. */
  canDelete: boolean;
}

export function CandidateDrawer({ id, joiningLabels, onClose, onChanged, canDelete }: Props) {
  const [c, setC] = useState<Candidate | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/candidates/${encodeURIComponent(id)}`);
    const data = await res.json();
    if (!res.ok) setError(data.error || "Could not load candidate.");
    else setC(data);
  }, [id]);

  useEffect(() => {
    setC(null);
    setError("");
    load();
  }, [load]);

  // Poll while the AI is grading.
  useEffect(() => {
    if (c?.status !== "evaluating") return;
    const t = setInterval(async () => {
      await load();
    }, 4000);
    return () => clearInterval(t);
  }, [c?.status, load]);

  // Refresh the table once grading finishes (onChanged is intentionally not a dependency).
  const status = c?.status;
  useEffect(() => {
    if (status === "completed" || status === "evaluation_failed") onChanged();
  }, [status]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function allowReinterview() {
    if (!confirm("Archive this attempt and let the candidate take the interview again with new questions?")) return;
    setError("");
    const res = await fetch(`/api/admin/candidates/${encodeURIComponent(id)}/reset`, { method: "POST" });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || "Could not reset the interview.");
    else {
      const result = (await res.json().catch(() => ({}))) as LoginResult;
      await load();
      onChanged();
      alert(`New questions are ready. ${loginResultText(result)}`);
    }
  }

  async function sendLogin() {
    if (!confirm("Send new login details now? This makes a new password (the old one stops working) and gives a fresh window to start.")) return;
    setError("");
    const res = await fetch(`/api/admin/candidates/${encodeURIComponent(id)}/invite`, { method: "POST" });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) return setError(result.error || "Could not send login details.");
    await load();
    onChanged();
    alert(loginResultText(result));
  }

  async function decide(decision: "selected" | "rejected") {
    const question =
      decision === "selected"
        ? "Shortlist this applicant? Their interview questions are written and the login email is sent now."
        : "Reject this applicant? The rejection email is sent now (if it hasn't been already), and any login they have stops working.";
    if (!confirm(question)) return;
    setError("");
    const res = await fetch(`/api/admin/candidates/${encodeURIComponent(id)}/screening`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) return setError(result.error || "Could not save the decision.");
    await load();
    onChanged();
    alert(
      decision === "selected"
        ? loginResultText(result)
        : result.rejectionSent
          ? "Rejected. The rejection email has been sent."
          : "Rejected. The rejection email couldn't be sent yet; it will be retried automatically.",
    );
  }

  async function deleteCandidate() {
    if (!confirm("Permanently delete this candidate, their resume and all interview recordings? This can't be undone.")) return;
    const res = await fetch(`/api/admin/candidates/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error || "Could not delete.");
    onChanged();
    onClose();
  }

  async function reevaluate() {
    const res = await fetch(`/api/admin/candidates/${encodeURIComponent(id)}/evaluate`, { method: "POST" });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || "Could not start evaluation.");
    else load();
  }

  return (
    <>
      <div className="fixed inset-0 z-30 bg-slate-900/30 backdrop-blur-[2px]" onClick={onClose} />
      <aside
        role="dialog"
        aria-label={c ? `Candidate ${c.fullName}` : "Candidate"}
        className="fixed inset-y-0 right-0 z-40 flex w-full max-w-3xl flex-col border-l border-line bg-canvas shadow-2xl"
      >
        <header className="flex items-start gap-4 border-b border-line bg-surface px-6 py-4">
          {c ? (
            <>
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-semibold text-brand-fg">
                {c.fullName
                  .split(/\s+/)
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((w) => w[0]!.toUpperCase())
                  .join("")}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-semibold tracking-tight">{c.fullName}</h2>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-fg-3">
                  <span className="truncate">{c.jobTitle}</span>
                  <Pill tone={statusBadge({ status: c.status, invite: inviteState(c) }).tone}>
                    {statusBadge({ status: c.status, invite: inviteState(c) }).label}
                  </Pill>
                </div>
              </div>
            </>
          ) : (
            <p className="flex-1 py-2 text-fg-4">{error ? "Candidate" : "Loading…"}</p>
          )}
          <Button variant="ghost" onClick={onClose} aria-label="Close" className="!px-2.5">
            <IconX />
          </Button>
        </header>
        <div className="flex-1 overflow-y-auto p-6">
          {error && <Alert>{error}</Alert>}
          {c && (
            <Detail
            c={c}
            joiningLabels={joiningLabels}
            onReevaluate={reevaluate}
            onReinterview={allowReinterview}
            onSendLogin={sendLogin}
            onDecide={decide}
            onDelete={canDelete ? deleteCandidate : undefined}
            />
          )}
        </div>
      </aside>
    </>
  );
}

function Detail({
  c,
  joiningLabels,
  onReevaluate,
  onReinterview,
  onSendLogin,
  onDecide,
  onDelete,
}: {
  c: Candidate;
  joiningLabels: Record<string, string>;
  onReevaluate: () => void;
  onReinterview: () => void;
  onSendLogin: () => void;
  onDecide: (decision: "selected" | "rejected") => void;
  onDelete?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const integrity = computeIntegrity(c.proctoring.events);
  const startMs = new Date(c.startedAt ?? c.createdAt).getTime();
  const offset = (at: string) => {
    const sec = Math.max(0, Math.round((new Date(at).getTime() - startMs) / 1000));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  };
  const s = c.scores;
  const ev = c.evaluation;
  const canReevaluate = c.status === "completed" || c.status === "evaluation_failed";

  const facts: [string, React.ReactNode][] = [
    ["Email", c.email],
    ["Phone", c.phone],
    ["Location", c.currentLocation || "–"],
    ["Experience", `${c.totalExperience} years`],
    ["Current CTC", `₹${c.currentCTC} LPA`],
    ["Expected CTC", `₹${c.expectedCTC} LPA`],
    ["Can join", joiningLabels[c.joiningCategory] ?? c.joiningCategory],
    [
      "LinkedIn",
      /^https?:\/\//.test(c.linkedin) ? (
        <a href={c.linkedin} target="_blank" rel="noopener noreferrer" className="text-brand-fg hover:underline">
          {c.linkedin}
        </a>
      ) : (
        "–"
      ),
    ],
    [
      "Resume link",
      c.resumeUrl && /^https?:\/\//.test(c.resumeUrl) ? (
        <a href={c.resumeUrl} target="_blank" rel="noopener noreferrer" className="text-brand-fg hover:underline">
          {c.resumeUrl}
        </a>
      ) : (
        "–"
      ),
    ],
    ["Applied", `${new Date(c.createdAt).toLocaleString()}${c.source === "google_form" ? " (Google Form)" : ""}`],
    ["Previous attempts", c.attempts?.length ?? 0],
  ];
  const media = (file: string) => `/api/admin/candidates/${encodeURIComponent(c.id)}/media/${encodeURIComponent(file)}`;
  const mediaGone = Boolean(c.mediaDeletedAt);
  const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="space-y-6">
      {c.screening && <ScreeningPanel c={c} onDecide={onDecide} />}
      {c.status === "ready" && c.screening?.decision !== "review" && <LoginStatus c={c} onSendLogin={onSendLogin} />}
      {c.resumeProblem && (
        <Alert tone="info">
          Resume not read: {c.resumeProblem}
        </Alert>
      )}

      {c.interruption && (
        <div className="rounded-lg border border-danger-line bg-danger-soft p-3 text-sm text-danger-fg">
          <p className="font-semibold">Interview interrupted, auto-submitted with {c.interruption.answeredCount} of{" "}
            {c.questions.length} answers</p>
          <p className="mt-0.5">
            {c.interruption.reason} · {new Date(c.interruption.at).toLocaleString()}. Unanswered questions scored 0. The
            candidate was asked to contact HR for a re-interview.
          </p>
        </div>
      )}
      {c.evaluationError && <Alert>Evaluation error: {c.evaluationError}</Alert>}

      {s && (
        <div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ScoreBox label={<RecommendationPill label={s.recommendation} />} value={<Signed value={s.total} />} sub="Total" />
            <ScoreBox label={`avg ${s.interview.averageOutOf10}/10`} value={s.interview.points} sub="Interview /70" />
            <ScoreBox label={s.joining.label} value={<Signed value={s.joining.points} />} sub="Joining" />
            <ScoreBox label="" value={<Signed value={s.salary.points} />} sub="Salary" />
          </div>
          <ul className="mt-2 list-disc pl-5 text-xs text-fg-3">
            {s.salary.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {c.resume && (
          <>
            <a href={`/api/admin/candidates/${encodeURIComponent(c.id)}/resume?view=1`} target="_blank" rel="noreferrer" className={buttonClass("primary")}>
              <IconFile /> View resume
            </a>
            <a href={`/api/admin/candidates/${encodeURIComponent(c.id)}/resume`} className={buttonClass("ghost")}>
              <IconDownload /> Download
            </a>
          </>
        )}
        {!c.resume && c.resumeUrl && /^https:\/\//.test(c.resumeUrl) && (
          <a href={c.resumeUrl} target="_blank" rel="noopener noreferrer" className={buttonClass("primary")}>
            <IconExternal /> View resume (applicant&apos;s link)
          </a>
        )}
        {canReevaluate && (
          <Button variant="ghost" onClick={onReevaluate}>
            <IconSparkles /> Re-run AI evaluation
          </Button>
        )}
        {canReevaluate && (
          <Button variant="ghost" onClick={onReinterview}>
            <IconRepeat /> Allow re-interview
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={() => {
            // Candidates with a login use the login page; older ones use their private link.
            navigator.clipboard.writeText(c.access ? `${window.location.origin}/` : `${window.location.origin}/interview/${c.id}`);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <IconCheck /> : <IconLink />}
          {copied ? "Copied" : c.access ? "Copy login page link" : "Copy interview link"}
        </Button>
        {onDelete && (
          <Button variant="ghost" onClick={onDelete} className="!border-danger-line !text-danger-fg hover:!bg-danger-soft">
            <IconTrash /> Delete
          </Button>
        )}
      </div>

      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <h3 className="mb-4 text-xs font-semibold tracking-wider text-fg-3 uppercase">Details</h3>
        <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
          {facts.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-xs text-fg-3">{k}</dt>
              <dd className="mt-0.5 font-medium break-words text-fg">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <h3 className="mb-3 text-xs font-semibold tracking-wider text-fg-3 uppercase">Screen recording</h3>
        {mediaGone && (
          <p className="mb-2 rounded-md bg-surface-3 px-3 py-2 text-sm text-fg-2">
            Videos, snapshots and the screen recording were deleted automatically on {day(c.mediaDeletedAt!)}. The
            transcripts, scores and proctoring timeline are kept.
          </p>
        )}
        {!mediaGone && c.mediaDeletesOn && (
          <p className="mb-2 rounded-md bg-warn-soft px-3 py-2 text-xs text-warn-fg">
            Videos, snapshots and the screen recording will be deleted automatically on {day(c.mediaDeletesOn)}.
          </p>
        )}
        {mediaGone ? null : c.screenRecording?.segments.length ? (
          <div className="space-y-3">
            {c.screenRecording.segments.map((seg, i) => (
              <div key={seg.file}>
                <p className="mb-1 text-xs text-fg-3">
                  {c.screenRecording!.segments.length > 1 && `Part ${i + 1} · `}
                  started {offset(seg.startedAt)} into the interview · {(seg.bytes / 1024 / 1024).toFixed(1)} MB
                  {i > 0 && " · re-shared after sharing was stopped"}
                </p>
                <video src={media(seg.file)} controls preload="metadata" className="aspect-video w-full rounded-md bg-slate-900" />
              </div>
            ))}
            <p className="text-xs text-fg-3">
              Covers the whole interview, including thinking time. Seeking may be limited; press play and use the speed
              control to skim.
            </p>
          </div>
        ) : (
          <p className="text-sm text-fg-4">No screen recording.</p>
        )}
      </div>

      <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-wider text-fg-3 uppercase">
          Live proctoring <IntegrityPill level={integrity.level} />
        </h3>
        {c.proctoring.events.length === 0 ? (
          <p className="text-sm text-fg-4">No proctoring events recorded.</p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-2">
              {Object.entries(integrity.counts).map(([type, n]) => (
                <Pill key={type} tone="warn">
                  {PROCTOR_EVENTS[type as keyof typeof PROCTOR_EVENTS].label} × {n}
                </Pill>
              ))}
            </div>
            <ol className="max-h-80 space-y-2 overflow-y-auto rounded-lg border border-line p-3 text-sm">
              {c.proctoring.events.map((e, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="w-12 shrink-0 font-mono text-xs text-fg-3 tabular-nums">{offset(e.at)}</span>
                  <div className="flex-1">
                    <span className="font-medium">{PROCTOR_EVENTS[e.type].label}</span>
                    <span className="text-fg-3">
                      {e.questionIndex !== null && ` · Q${e.questionIndex + 1}`} · {e.detail}
                    </span>
                  </div>
                  {e.snapshot && !mediaGone && (
                    <a href={media(e.snapshot)} target="_blank" rel="noopener noreferrer">
                      <img src={media(e.snapshot)} alt="Snapshot at event" className="h-12 rounded border border-line" />
                    </a>
                  )}
                </li>
              ))}
            </ol>
            <p className="mt-1 text-xs text-fg-3">
              Times are from interview start. Flags are signals for review, not proof. Check the video before deciding.
            </p>
          </>
        )}
      </div>

      {ev && (
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
          <h3 className="mb-2 text-xs font-semibold tracking-wider text-fg-3 uppercase">AI summary</h3>
          <p className="text-sm text-fg-2">{ev.summary}</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <BulletList title="Strengths" items={ev.strengths} />
            <BulletList title="Concerns" items={ev.concerns} />
          </div>
          {ev.proctoringNotes?.length > 0 && (
            <div className="mt-4 rounded-lg border border-warn-line bg-warn-soft p-3">
              <h4 className="mb-1 text-sm font-semibold text-warn-fg">⚠ Proctoring flags (from webcam snapshots)</h4>
              <ul className="list-disc space-y-1 pl-5 text-sm text-warn-fg">
                {ev.proctoringNotes.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-warn-fg">Not included in the score. Watch the videos before deciding.</p>
            </div>
          )}
        </div>
      )}

      <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <h3 className="mb-3 text-xs font-semibold tracking-wider text-fg-3 uppercase">Interview</h3>
        <div className="space-y-3">
          {c.questions.map((q, i) => {
            const a = c.answers[i];
            const e = ev?.evaluations[i];
            return (
              <div key={i} className="rounded-lg border border-line p-4">
                <p className="font-semibold">
                  Q{i + 1}. {q.question}
                </p>
                <p className="mt-0.5 text-xs text-fg-3">
                  {q.based_on === "resume" ? "From resume" : "From JD"} · {q.focus}
                  {a && ` · ${Math.round((a.timeTakenSec / 60) * 10) / 10} min`}
                </p>
                {!a && <p className="my-3 text-sm text-fg-4 italic">Not answered yet</p>}
                {a?.video && !mediaGone && (
                  <video
                    src={media(a.video)}
                    controls
                    preload="metadata"
                    className="my-3 aspect-video w-full rounded-md bg-slate-900"
                  />
                )}
                {a && (
                  <div className="mb-3">
                    <p className="mb-1 text-xs font-medium text-fg-3">
                      Auto transcript{a.transcriptSource === "whisper" && " (Whisper)"}
                      {a.transcriptSource === "gemini" && " (Gemini)"} (may contain recognition errors)
                    </p>
                    <div className="rounded-md bg-surface-2 p-3 text-sm whitespace-pre-wrap">
                      {a.transcript || <em className="text-fg-4">(no speech detected; watch the video)</em>}
                    </div>
                  </div>
                )}
                {a && a.snapshots.length > 0 && !mediaGone && (
                  <div className="mb-3 flex gap-2">
                    {a.snapshots.map((s) => (
                      <img key={s} src={media(s)} alt="Webcam snapshot" className="h-16 rounded border border-line" />
                    ))}
                  </div>
                )}
                {e && (
                  <p className="text-sm">
                    <Pill tone={e.score >= 7 ? "good" : e.score >= 4 ? "warn" : "bad"}>{e.score}/10</Pill>{" "}
                    <span className="text-fg-2">{e.feedback}</span>
                  </p>
                )}
                <details className="mt-2 text-xs text-fg-3">
                  <summary className="cursor-pointer">What a strong answer covers</summary>
                  <ul className="mt-1 list-disc pl-5">
                    {q.expected_points.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </details>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ScoreBox({ label, value, sub }: { label: React.ReactNode; value: React.ReactNode; sub: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <div className="text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      <div className="text-xs text-fg-3">{sub}</div>
      {label && <div className="mt-1 text-xs">{label}</div>}
    </div>
  );
}

function BulletList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h4 className="mb-1 text-sm font-semibold">{title}</h4>
      {items.length ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-fg-2">
          {items.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-4">None noted</p>
      )}
    </div>
  );
}
