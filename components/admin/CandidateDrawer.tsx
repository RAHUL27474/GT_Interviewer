"use client";

import { useCallback, useEffect, useState } from "react";
import type { Candidate } from "@/lib/types";
import { Alert, Button, Pill } from "../ui";
import { RecommendationPill, Signed, STATUS } from "./shared";

interface Props {
  id: string;
  joiningLabels: Record<string, string>;
  onClose: () => void;
  onChanged: () => void;
}

export function CandidateDrawer({ id, joiningLabels, onClose, onChanged }: Props) {
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

  async function reevaluate() {
    const res = await fetch(`/api/admin/candidates/${encodeURIComponent(id)}/evaluate`, { method: "POST" });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || "Could not start evaluation.");
    else load();
  }

  return (
    <>
      <div className="fixed inset-0 z-30 bg-slate-900/20" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-40 w-full max-w-3xl overflow-y-auto border-l border-slate-200 bg-white p-6 shadow-2xl">
        <Button variant="ghost" onClick={onClose} className="float-right" aria-label="Close">
          ✕
        </Button>
        {error && <Alert>{error}</Alert>}
        {!c && !error && <p className="text-slate-400">Loading…</p>}
        {c && <Detail c={c} joiningLabels={joiningLabels} onReevaluate={reevaluate} />}
      </aside>
    </>
  );
}

function Detail({
  c,
  joiningLabels,
  onReevaluate,
}: {
  c: Candidate;
  joiningLabels: Record<string, string>;
  onReevaluate: () => void;
}) {
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
        <a href={c.linkedin} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">
          {c.linkedin}
        </a>
      ) : (
        "–"
      ),
    ],
    ["Applied", new Date(c.createdAt).toLocaleString()],
    ["Tab switches", <Flag key="t" n={c.integrity.tabSwitches} />],
  ];
  const media = (file: string) => `/api/admin/candidates/${encodeURIComponent(c.id)}/media/${encodeURIComponent(file)}`;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">{c.fullName}</h2>
        <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">
          {c.jobTitle} <Pill tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Pill>
        </div>
      </div>

      {c.evaluationError && <Alert>Evaluation error: {c.evaluationError}</Alert>}

      {s && (
        <div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ScoreBox label={<RecommendationPill label={s.recommendation} />} value={<Signed value={s.total} />} sub="Total" />
            <ScoreBox label={`avg ${s.interview.averageOutOf10}/10`} value={s.interview.points} sub="Interview /70" />
            <ScoreBox label={s.joining.label} value={<Signed value={s.joining.points} />} sub="Joining" />
            <ScoreBox label="" value={<Signed value={s.salary.points} />} sub="Salary" />
          </div>
          <ul className="mt-2 list-disc pl-5 text-xs text-slate-500">
            {s.salary.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <a
          href={`/api/admin/candidates/${encodeURIComponent(c.id)}/resume`}
          className="inline-flex items-center rounded-lg border border-brand-600 px-4 py-2 text-sm font-semibold text-brand-600 hover:bg-brand-50"
        >
          Download resume
        </a>
        {canReevaluate && (
          <Button variant="ghost" onClick={onReevaluate}>
            Re-run AI evaluation
          </Button>
        )}
      </div>

      <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-1.5 text-sm">
        {facts.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-slate-500">{k}</dt>
            <dd className="break-all">{v}</dd>
          </div>
        ))}
      </dl>

      {ev && (
        <div>
          <h3 className="mb-1 font-semibold">AI summary</h3>
          <p className="text-sm text-slate-700">{ev.summary}</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <BulletList title="Strengths" items={ev.strengths} />
            <BulletList title="Concerns" items={ev.concerns} />
          </div>
          {ev.proctoringNotes?.length > 0 && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <h4 className="mb-1 text-sm font-semibold text-amber-800">⚠ Proctoring flags (from webcam snapshots)</h4>
              <ul className="list-disc space-y-1 pl-5 text-sm text-amber-800">
                {ev.proctoringNotes.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-amber-700">Not included in the score. Watch the videos before deciding.</p>
            </div>
          )}
        </div>
      )}

      <div>
        <h3 className="mb-2 font-semibold">Interview</h3>
        <div className="space-y-3">
          {c.questions.map((q, i) => {
            const a = c.answers[i];
            const e = ev?.evaluations[i];
            return (
              <div key={i} className="rounded-lg border border-slate-200 p-4">
                <p className="font-semibold">
                  Q{i + 1}. {q.question}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {q.based_on === "resume" ? "From resume" : "From JD"} · {q.focus}
                  {a && ` · ${Math.round((a.timeTakenSec / 60) * 10) / 10} min`}
                </p>
                {!a && <p className="my-3 text-sm text-slate-400 italic">Not answered yet</p>}
                {a?.video && (
                  <video
                    src={media(a.video)}
                    controls
                    preload="metadata"
                    className="my-3 aspect-video w-full rounded-md bg-slate-900"
                  />
                )}
                {a && (
                  <div className="mb-3">
                    <p className="mb-1 text-xs font-medium text-slate-500">Auto transcript (may contain recognition errors)</p>
                    <div className="rounded-md bg-slate-50 p-3 text-sm whitespace-pre-wrap">
                      {a.transcript || <em className="text-slate-400">(no speech detected; watch the video)</em>}
                    </div>
                  </div>
                )}
                {a && a.snapshots.length > 0 && (
                  <div className="mb-3 flex gap-2">
                    {a.snapshots.map((s) => (
                      <img key={s} src={media(s)} alt="Webcam snapshot" className="h-16 rounded border border-slate-200" />
                    ))}
                  </div>
                )}
                {e && (
                  <p className="text-sm">
                    <Pill tone={e.score >= 7 ? "good" : e.score >= 4 ? "warn" : "bad"}>{e.score}/10</Pill>{" "}
                    <span className="text-slate-600">{e.feedback}</span>
                  </p>
                )}
                <details className="mt-2 text-xs text-slate-500">
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
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-xs text-slate-500">{sub}</div>
      {label && <div className="mt-1 text-xs">{label}</div>}
    </div>
  );
}

function BulletList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h4 className="mb-1 text-sm font-semibold">{title}</h4>
      {items.length ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
          {items.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-400">None noted</p>
      )}
    </div>
  );
}

function Flag({ n }: { n: number }) {
  return n ? <span className="font-semibold text-red-600">{n}</span> : <span>0</span>;
}
