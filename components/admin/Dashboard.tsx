"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { CandidateSummary, GoogleStatus, Job, PublicStaffUser } from "@/lib/types";
import { isManagerOrAbove, ROLE_LABEL } from "@/lib/roles";
import { AccountDialog } from "./AccountDialog";
import { TeamPanel } from "./TeamPanel";
import { Button, cn, inputClass, Pill } from "../ui";
import { CandidateDrawer } from "./CandidateDrawer";
import { JobsPanel } from "./JobsPanel";
import { IntegrityPill, RecommendationPill, Signed, STATUS, statusBadge } from "./shared";

type SortKey = "fullName" | "jobTitle" | "createdAt" | "status" | "resume" | "totalExperience" | "expectedCTC" | "interview" | "joining" | "salary" | "total" | "integrity";

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "fullName", label: "Candidate" },
  { key: "jobTitle", label: "Position" },
  { key: "createdAt", label: "Applied" },
  { key: "status", label: "Status" },
  { key: "resume", label: "Resume /100", numeric: true },
  { key: "totalExperience", label: "Exp (yrs)", numeric: true },
  { key: "expectedCTC", label: "CTC cur → exp", numeric: true },
  { key: "interview", label: "Interview /70", numeric: true },
  { key: "joining", label: "Joining", numeric: true },
  { key: "salary", label: "Salary", numeric: true },
  { key: "total", label: "Total", numeric: true },
  { key: "integrity", label: "Integrity" },
];

function sortValue(c: CandidateSummary, key: SortKey): string | number {
  if (key === "total") return c.scores?.total ?? -Infinity;
  if (key === "resume") return c.screening?.score ?? -Infinity;
  if (key === "integrity") return c.integrity.points;
  if (key === "interview" || key === "joining" || key === "salary") return c.scores?.[key].points ?? -Infinity;
  return c[key];
}

interface Props {
  initialTab: "candidates" | "jobs";
  defaultPassMark: number;
  google: GoogleStatus;
  me: PublicStaffUser;
  team: PublicStaffUser[];
  deleteAfterDays: number;
  candidates: CandidateSummary[];
  jobs: Job[];
  joiningLabels: Record<string, string>;
}

export function Dashboard({ initialTab, defaultPassMark, google, me, team, deleteAfterDays, candidates, jobs, joiningLabels }: Props) {
  const isManager = isManagerOrAbove(me.role);
  const [accountOpen, setAccountOpen] = useState(false);
  const router = useRouter();
  const [tab, setTab] = useState<"candidates" | "jobs" | "team">(initialTab);
  const [jobFilter, setJobFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "total", dir: -1 });
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return candidates
      .filter((c) => !jobFilter || c.jobId === jobFilter)
      .filter((c) => !statusFilter || c.status === statusFilter)
      .filter((c) => !q || `${c.fullName} ${c.email} ${c.phone}`.toLowerCase().includes(q))
      .sort((a, b) => {
        const va = sortValue(a, sort.key);
        const vb = sortValue(b, sort.key);
        return (va > vb ? 1 : va < vb ? -1 : 0) * sort.dir;
      });
  }, [candidates, jobFilter, statusFilter, search, sort]);

  const completed = candidates.filter((c) => c.scores);
  const stats = [
    { label: "Applicants", value: candidates.length, icon: "👥", accent: "from-brand-500/15" },
    { label: "Interviews completed", value: completed.length, icon: "🎥", accent: "from-sky-500/15" },
    { label: "Hire / Strong Hire", value: completed.filter((c) => c.scores!.total >= 60).length, icon: "⭐", accent: "from-emerald-500/15" },
    { label: "Open positions", value: jobs.filter((j) => j.active).length, icon: "💼", accent: "from-amber-500/15" },
  ];
  const tabs = isManager ? (["candidates", "jobs", "team"] as const) : (["candidates", "jobs"] as const);
  // Filters size to their content (inputClass is full width by default).
  const filterClass = inputClass.replace("w-full", "");

  function exportCsv() {
    const header = ["Name", "Email", "Phone", "Position", "Applied", "Status", "Resume score", "Experience", "Current CTC", "Expected CTC", "Joining", "Interview (/70)", "Joining pts", "Salary pts", "Total", "Recommendation", "Interrupted", "Integrity risk", "Proctoring flags"];
    const body = rows.map((c) => [
      c.fullName, c.email, c.phone, c.jobTitle, c.createdAt.slice(0, 10), statusBadge(c).label, c.screening?.score ?? "", c.totalExperience,
      c.currentCTC, c.expectedCTC, joiningLabels[c.joiningCategory] ?? c.joiningCategory,
      c.scores?.interview.points ?? "", c.scores?.joining.points ?? "", c.scores?.salary.points ?? "",
      c.scores?.total ?? "", c.scores?.recommendation ?? "", c.interrupted ? "Yes" : "No", c.integrity.level,
      Object.values(c.integrity.counts).reduce((a, b) => a + (b ?? 0), 0),
    ]);
    const csv = [header, ...body].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
    a.download = `candidates-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  async function signOut() {
    await fetch("/api/admin/login", { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <nav className="inline-flex rounded-xl border border-line bg-surface p-1 shadow-card" aria-label="Sections">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              aria-current={tab === t ? "page" : undefined}
              className={cn(
                "cursor-pointer rounded-lg px-4 py-1.5 text-sm font-semibold capitalize transition",
                "focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none",
                tab === t ? "bg-brand-600 text-white shadow-sm" : "text-fg-3 hover:bg-surface-2 hover:text-fg",
              )}
            >
              {t}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <div className="hidden items-center gap-2.5 rounded-xl border border-line bg-surface py-1 pr-3 pl-1 sm:flex">
            <span className="grid size-7 place-items-center rounded-lg bg-brand-soft text-xs font-bold text-brand-fg">
              {me.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="text-sm leading-tight">
              <span className="block font-medium text-fg">{me.name}</span>
              <span
                className={cn(
                  "block text-xs font-semibold",
                  me.role === "superadmin" ? "text-purple-700 dark:text-purple-300" : isManager ? "text-brand-fg" : "text-fg-3",
                )}
              >
                {ROLE_LABEL[me.role]}
              </span>
            </span>
          </div>
          <Button variant="ghost" onClick={() => setAccountOpen(true)}>
            Change password
          </Button>
          <Button variant="ghost" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </div>
      {accountOpen && <AccountDialog onClose={() => setAccountOpen(false)} />}

      {tab === "team" && isManager ? (
        <TeamPanel me={me} team={team} deleteAfterDays={deleteAfterDays} />
      ) : tab === "jobs" ? (
        <JobsPanel jobs={jobs} google={google} defaultPassMark={defaultPassMark} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {stats.map((s) => (
              <div
                key={s.label}
                className={cn(
                  "relative overflow-hidden rounded-2xl border border-line bg-surface bg-gradient-to-br to-transparent p-5 shadow-card",
                  s.accent,
                )}
              >
                <div className="flex items-start justify-between">
                  <div className="text-3xl font-bold tracking-tight tabular-nums">{s.value}</div>
                  <span className="text-xl" aria-hidden>
                    {s.icon}
                  </span>
                </div>
                <div className="mt-1 text-sm text-fg-3">{s.label}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface p-3 shadow-card">
            <div className="relative min-w-56 flex-1">
              <svg viewBox="0 0 20 20" fill="currentColor" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-4" aria-hidden>
                <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.45 4.39l3.08 3.08a.75.75 0 1 1-1.06 1.06l-3.08-3.08A7 7 0 0 1 2 9Z" clipRule="evenodd" />
              </svg>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, email or phone"
                aria-label="Search candidates"
                className={cn(inputClass, "pl-9")}
              />
            </div>
            <select value={jobFilter} onChange={(e) => setJobFilter(e.target.value)} className={filterClass} aria-label="Position">
              <option value="">All positions</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title}
                </option>
              ))}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={filterClass} aria-label="Status">
              <option value="">All statuses</option>
              {Object.entries(STATUS).map(([value, s]) => (
                <option key={value} value={value}>
                  {s.label}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => router.refresh()}>
                Refresh
              </Button>
              <Button variant="secondary" onClick={exportCsv}>
                Export CSV
              </Button>
            </div>
          </div>

          <div className="max-h-[70vh] overflow-auto rounded-2xl border border-line bg-surface shadow-card">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-surface-2 text-xs tracking-wide text-fg-3 uppercase shadow-[0_1px_0_var(--line)]">
                <tr>
                  {COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      onClick={() => setSort((s) => ({ key: col.key, dir: s.key === col.key ? (-s.dir as 1 | -1) : -1 }))}
                      className={cn("cursor-pointer px-3 py-3 font-semibold whitespace-nowrap select-none", col.numeric ? "text-right" : "text-left")}
                    >
                      {col.label}
                      {sort.key === col.key && (sort.dir === -1 ? " ↓" : " ↑")}
                    </th>
                  ))}
                  <th className="px-3 py-3 text-left font-semibold">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((c) => {
                  const s = c.scores;
                  return (
                    <tr key={c.id} onClick={() => setOpenId(c.id)} className="cursor-pointer hover:bg-brand-soft/60">
                      <td className="px-3 py-2.5">
                        <div className="font-semibold">{c.fullName}</div>
                        <div className="text-xs text-fg-3">{c.email}</div>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{c.jobTitle}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{new Date(c.createdAt).toLocaleDateString()}</td>
                      <td className="px-3 py-2.5">
                        <Pill tone={statusBadge(c).tone}>
                          {statusBadge(c).label}
                          {c.status === "in_progress" && ` ${c.answered}/${c.totalQuestions}`}
                        </Pill>
                        {c.interrupted && (
                          <span className="ml-1">
                            <Pill tone="bad">Interrupted</Pill>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{c.screening?.score ?? "–"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{c.totalExperience}</td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {c.currentCTC} → {c.expectedCTC}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{s ? s.interview.points : "–"}</td>
                      <td className="px-3 py-2.5 text-right">{s ? <Signed value={s.joining.points} /> : "–"}</td>
                      <td className="px-3 py-2.5 text-right">{s ? <Signed value={s.salary.points} /> : "–"}</td>
                      <td className="px-3 py-2.5 text-right text-base">{s ? <Signed value={s.total} /> : "–"}</td>
                      <td className="px-3 py-2.5">
                        <IntegrityPill level={c.integrity.level} />
                      </td>
                      <td className="px-3 py-2.5">{s && <RecommendationPill label={s.recommendation} />}</td>
                    </tr>
                  );
                })}
                {!rows.length && (
                  <tr>
                    <td colSpan={COLUMNS.length + 1} className="px-3 py-12 text-center text-fg-4">
                      No candidates yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-fg-3">
            Total = Interview (0–70) + Joining (−10 to +15) + Salary (−15 to +15). Range −25 to 100. Click a row for details.
          </p>
        </>
      )}

      {openId && (
        <CandidateDrawer
          id={openId}
          joiningLabels={joiningLabels}
          onClose={() => setOpenId(null)}
          onChanged={() => router.refresh()}
          canDelete={isManager}
        />
      )}
    </div>
  );
}
