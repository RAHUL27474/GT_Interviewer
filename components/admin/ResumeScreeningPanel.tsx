"use client";

import type { ResumeScreeningReport, ScreeningStatus } from "@/lib/types";
import { Pill, type Tone } from "../ui";

/** The five weighted dimensions, with the weights from the screening spec. */
const DIMENSIONS: { key: "requiredSkills" | "experience" | "education" | "projects" | "semantic"; label: string; weight: number }[] = [
  { key: "requiredSkills", label: "Required skills", weight: 40 },
  { key: "experience", label: "Experience", weight: 20 },
  { key: "education", label: "Education", weight: 10 },
  { key: "projects", label: "Projects", weight: 15 },
  { key: "semantic", label: "Semantic fit", weight: 15 },
];

const STATUS_META: Record<ScreeningStatus, { label: string; tone: Tone; detail: string }> = {
  SHORTLISTED: {
    label: "Shortlisted",
    tone: "good",
    detail: "At or above the auto-advance mark. The candidate was moved to the AI interview; review before contacting them.",
  },
  HR_REVIEW: {
    label: "HR review",
    tone: "warn",
    detail: "Between the review floor and the shortlist mark. Too close to call automatically, so a person decides.",
  },
  NOT_SHORTLISTED: {
    label: "Not shortlisted",
    tone: "bad",
    detail: "Below the review floor. A recommendation only — nothing is rejected automatically and HR still sees this breakdown.",
  },
};

const ENGINE_LABEL: Record<ResumeScreeningReport["engine"], string> = {
  bridge: "Local model (MiniLM + skill coverage)",
  llm: "LLM judge (Python model unavailable)",
  mock: "Test mode (no AI)",
};

function toneForScore(score: number): Tone {
  if (score >= 75) return "good";
  if (score >= 50) return "warn";
  return "bad";
}

function ScoreBar({ label, weight, value }: { label: string; weight: number; value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-slate-600">
          {label} <span className="text-slate-400">({weight}%)</span>
        </span>
        <span className="font-semibold tabular-nums text-slate-700">{Math.round(value)}</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full rounded-full ${
            clamped >= 75 ? "bg-emerald-500" : clamped >= 50 ? "bg-amber-500" : "bg-red-400"
          }`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

function ChipList({ title, items, tone }: { title: string; items: string[]; tone: Tone }) {
  if (!items.length) return null;
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase text-slate-500">
        {title} <span className="font-normal normal-case text-slate-400">({items.length})</span>
      </h4>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {items.map((item) => (
          <Pill key={item} tone={tone}>
            {item}
          </Pill>
        ))}
      </div>
    </div>
  );
}

export function ResumeScreeningPanel({ report }: { report: ResumeScreeningReport }) {
  const meta = STATUS_META[report.status];
  const { scores } = report;
  const hasBreakdown = scores.requiredSkills > 0 || scores.semantic > 0 || report.matchedSkills.length > 0;

  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Round 1 · AI resume screen</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={toneForScore(scores.finalScore)}>{scores.finalScore}/100</Pill>
          <Pill tone={meta.tone}>{meta.label}</Pill>
        </div>
      </div>

      <p className="mt-1 text-xs text-slate-500">
        Scored by {ENGINE_LABEL[report.engine]}
        {report.extractionMethod ? ` · resume text via ${report.extractionMethod}` : ""}
        {" · shortlist at "}
        {scores.threshold}
      </p>

      <p className="mt-2 text-sm text-slate-700">{report.summary}</p>
      <p className="mt-1 text-xs text-slate-500">{meta.detail}</p>

      {hasBreakdown && (
        <div className="mt-4 grid gap-2.5">
          <h4 className="text-xs font-semibold uppercase text-slate-500">Score breakdown</h4>
          {DIMENSIONS.map((dimension) => (
            <ScoreBar
              key={dimension.key}
              label={dimension.label}
              weight={dimension.weight}
              value={scores[dimension.key]}
            />
          ))}
          <p className="pt-1 text-xs text-slate-500">
            Final {scores.finalScore} = weighted sum.{" "}
            {scores.nativeScreeningScore !== null && (
              <>Raw model score {scores.nativeScreeningScore} (cosine {scores.semanticSimilarity}). </>
            )}{" "}
            Name, age, gender, nationality and college prestige are excluded from every dimension.
          </p>
        </div>
      )}

      {hasBreakdown && (
        <div className="mt-4 space-y-3">
          <ChipList title="Matched required skills" items={report.matchedSkills} tone="good" />
          <ChipList title="Missing required skills" items={report.missingSkills} tone="bad" />
          <ChipList title="Bonus skills (not required)" items={report.bonusSkills} tone="neutral" />
        </div>
      )}

      {report.candidateProfile && (
        <div className="mt-4 rounded-md border border-slate-200 bg-white p-3">
          <h4 className="text-xs font-semibold uppercase text-slate-500">Parsed from the resume</h4>
          <dl className="mt-1.5 grid grid-cols-[130px_1fr] gap-x-3 gap-y-1 text-xs">
            {report.candidateProfile.currentTitle && (
              <>
                <dt className="text-slate-500">Current title</dt>
                <dd className="text-slate-700">{report.candidateProfile.currentTitle}</dd>
              </>
            )}
            <dt className="text-slate-500">Experience</dt>
            <dd className="text-slate-700">
              {report.candidateProfile.totalExperienceYears !== null
                ? `${report.candidateProfile.totalExperienceYears} years`
                : "not stated"}
            </dd>
            {report.candidateProfile.employers.length > 0 && (
              <>
                <dt className="text-slate-500">Employers</dt>
                <dd className="text-slate-700">{report.candidateProfile.employers.join(", ")}</dd>
              </>
            )}
            {report.candidateProfile.education.length > 0 && (
              <>
                <dt className="text-slate-500">Education</dt>
                <dd className="text-slate-700">{report.candidateProfile.education.join("; ")}</dd>
              </>
            )}
            {report.candidateProfile.certifications.length > 0 && (
              <>
                <dt className="text-slate-500">Certifications</dt>
                <dd className="text-slate-700">{report.candidateProfile.certifications.join(", ")}</dd>
              </>
            )}
          </dl>
          {report.jobRequirements && (
            <p className="mt-2 text-xs text-slate-500">
              Job asks for{" "}
              {report.jobRequirements.minExperienceYears !== null
                ? `${report.jobRequirements.minExperienceYears}+ years`
                : "no stated minimum experience"}
              {report.jobRequirements.degrees.length > 0 && `, ${report.jobRequirements.degrees.join("/")} level`}
              .
            </p>
          )}
        </div>
      )}

      {(report.strengths.length > 0 || report.gaps.length > 0) && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {report.strengths.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase text-slate-500">Relevant evidence</h4>
              <ul className="mt-1 list-disc pl-5 text-sm text-slate-700">
                {report.strengths.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {report.gaps.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase text-slate-500">Needs verification</h4>
              <ul className="mt-1 list-disc pl-5 text-sm text-slate-700">
                {report.gaps.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {report.engineNotes && report.engineNotes.length > 0 && (
        <ul className="mt-3 list-disc pl-5 text-xs text-slate-500">
          {report.engineNotes.map((note, index) => (
            <li key={index}>{note}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
