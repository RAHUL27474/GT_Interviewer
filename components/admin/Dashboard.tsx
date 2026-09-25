"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { CandidateSummary, Job, PublicStaffUser } from "@/lib/types";
import { isManagerOrAbove, ROLE_LABEL } from "@/lib/roles";
import { AccountDialog } from "./AccountDialog";
import { TeamPanel } from "./TeamPanel";
import { Button, cn, inputClass, Pill } from "../ui";
import { CandidateDrawer } from "./CandidateDrawer";
import { JobsPanel } from "./JobsPanel";
import { IntegrityPill, RecommendationPill, Signed, STATUS } from "./shared";

type SortKey = "fullName" | "jobTitle" | "createdAt" | "status" | "totalExperience" | "expectedCTC" | "interview" | "joining" | "salary" | "total" | "integrity";

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "fullName", label: "Candidate" },
  { key: "jobTitle", label: "Position" },
  { key: "createdAt", label: "Applied" },
  { key: "status", label: "Status" },
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
  if (key === "integrity") return c.integrity.points;
  if (key === "interview" || key === "joining" || key === "salary") return c.scores?.[key].points ?? -Infinity;
  return c[key];
}

interface Props {
  me: PublicStaffUser;
  team: PublicStaffUser[];
  deleteAfterDays: number;
  candidates: CandidateSummary[];
  jobs: Job[];
  joiningLabels: Record<string, string>;
}

export function Dashboard({ me, team, deleteAfterDays, candidates, jobs, joiningLabels }: Props) {
  const isManager = isManagerOrAbove(me.role);
  const [accountOpen, setAccountOpen] = useState(false);
  const router = useRouter();
  const [tab, setTab] = useState<"candidates" | "jobs" | "team">("candidates");
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
    { label: "Applicants", value: candidates.length },
    { label: "Interviews completed", value: completed.length },
    { label: "Hire / Strong Hire", value: completed.filter((c) => c.scores!.total >= 60).length },
    { label: "Open positions", value: jobs.filter((j) => j.active).length },
  ];

  function exportCsv() {
    const header = ["Name", "Email", "Phone", "Position", "Applied", "Status", "Experience", "Current CTC", "Expected CTC", "Joining", "Interview (/70)", "Joining pts", "Salary pts", "Total", "Recommendation", "Interrupted", "Integrity risk", "Proctoring flags"];
    const body = rows.map((c) => [
      c.fullName, c.email, c.phone, c.jobTitle, c.createdAt.slice(0, 10), STATUS[c.status].label, c.totalExperience,
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
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {(isManager ? (["candidates", "jobs", "team"] as const) : (["candidates", "jobs"] as const)).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "cursor-pointer rounded-lg px-4 py-2 text-sm font-semibold capitalize transition",
              tab === t ? "bg-brand-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50",
            )}
          >
            {t}
          </button>
        ))}
        <span className="ml-auto text-sm text-slate-500">
          {me.name} ·{" "}
          <span
            className={cn(
              "font-semibold",
              me.role === "superadmin" ? "text-purple-700" : isManager ? "text-brand-700" : "text-slate-700",
            )}
          >
            {ROLE_LABEL[me.role]}
          </span>
        </span>
        <Button variant="ghost" onClick={() => setAccountOpen(true)}>
          Change password
        </Button>
        <Button variant="ghost" onClick={signOut}>
          Sign out
        </Button>
      </div>
      {accountOpen && <AccountDialog onClose={() => setAccountOpen(false)} />}

      {tab === "team" && isManager ? (
        <TeamPanel me={me} team={team} deleteAfterDays={deleteAfterDays} />
      ) : tab === "jobs" ? (
        <JobsPanel jobs={jobs} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-2xl font-bold tabular-nums">{s.value}</div>
                <div className="text-xs text-slate-500">{s.label}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select value={jobFilter} onChange={(e) => setJobFilter(e.target.value)} className={cn(inputClass, "w-auto")}>
              <option value="">All positions</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title}
                </option>
              ))}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={cn(inputClass, "w-auto")}>
              <option value="">All statuses</option>
              {Object.entries(STATUS).map(([value, s]) => (
                <option key={value} value={value}>
                  {s.label}
                </option>
              ))}
            </select>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name / email / phone"
              className={cn(inputClass, "w-64")}
            />
            <div className="ml-auto flex gap-2">
              <Button variant="secondary" onClick={() => router.refresh()}>
                Refresh
              </Button>
              <Button variant="secondary" onClick={exportCsv}>
                Export CSV
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
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
              <tbody className="divide-y divide-slate-100">
                {rows.map((c) => {
                  const s = c.scores;
                  return (
                    <tr key={c.id} onClick={() => setOpenId(c.id)} className="cursor-pointer hover:bg-brand-50/60">
                      <td className="px-3 py-2.5">
                        <div className="font-semibold">{c.fullName}</div>
                        <div className="text-xs text-slate-500">{c.email}</div>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{c.jobTitle}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{new Date(c.createdAt).toLocaleDateString()}</td>
                      <td className="px-3 py-2.5">
                        <Pill tone={STATUS[c.status].tone}>
                          {STATUS[c.status].label}
                          {c.status === "in_progress" && ` ${c.answered}/${c.totalQuestions}`}
                        </Pill>
                        {c.interrupted && (
                          <span className="ml-1">
                            <Pill tone="bad">Interrupted</Pill>
                          </span>
                        )}
                      </td>
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
                    <td colSpan={COLUMNS.length + 1} className="px-3 py-12 text-center text-slate-400">
                      No candidates yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">
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
