"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CandidateSummary, GoogleStatus, Job, PublicStaffUser } from "@/lib/types";
import { isManagerOrAbove, ROLE_LABEL } from "@/lib/roles";
import { AccountDialog } from "./AccountDialog";
import { TeamPanel } from "./TeamPanel";
import { Button, cn, inputClass, Pill } from "../ui";
import { CandidateDrawer } from "./CandidateDrawer";
import { JobsPanel } from "./JobsPanel";
import { INVITE, IntegrityPill, RecommendationPill, Signed, STATUS, statusBadge } from "./shared";
import {
  IconAward,
  IconBriefcase,
  IconChevronDown,
  IconDownload,
  IconKey,
  IconLogout,
  IconRepeat,
  IconSearch,
  IconUsers,
  IconVideo,
} from "../icons";

type SortKey = "fullName" | "jobTitle" | "createdAt" | "status" | "resume" | "totalExperience" | "expectedCTC" | "total" | "recommendation" | "integrity";

const COLUMNS: { key: SortKey; label: string; numeric?: boolean; title?: string }[] = [
  { key: "fullName", label: "Candidate" },
  { key: "jobTitle", label: "Position" },
  { key: "createdAt", label: "Applied" },
  { key: "status", label: "Status" },
  { key: "resume", label: "Resume", numeric: true, title: "AI resume rating out of 100" },
  { key: "totalExperience", label: "Exp", numeric: true, title: "Total experience in years" },
  { key: "expectedCTC", label: "CTC (LPA)", numeric: true, title: "Current → expected CTC" },
  { key: "total", label: "Score", numeric: true, title: "Interview (0–70) + joining (−10 to +15) + salary (−15 to +15)" },
  { key: "recommendation", label: "Result" },
  { key: "integrity", label: "Integrity" },
];

const RECOMMENDATION_ORDER: Record<string, number> = { "Strong Hire": 4, Hire: 3, Maybe: 2, Reject: 1 };

function sortValue(c: CandidateSummary, key: SortKey): string | number {
  if (key === "total") return c.scores?.total ?? -Infinity;
  if (key === "resume") return c.screening?.score ?? -Infinity;
  if (key === "integrity") return c.integrity.points;
  if (key === "recommendation") return RECOMMENDATION_ORDER[c.scores?.recommendation ?? ""] ?? 0;
  if (key === "status") return statusBadge(c).label;
  return c[key];
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

const TAB_INFO = {
  candidates: { title: "Candidates", subtitle: "Everyone who applied, their screening, interview scores and integrity." },
  jobs: { title: "Jobs", subtitle: "Open positions, their Google Forms and resume screening rules." },
  team: { title: "Team", subtitle: "Staff accounts and what each role can do." },
} as const;

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
      .filter((c) => !statusFilter || statusBadge(c).label === statusFilter)
      .filter((c) => !q || `${c.fullName} ${c.email} ${c.phone}`.toLowerCase().includes(q))
      .sort((a, b) => {
        const va = sortValue(a, sort.key);
        const vb = sortValue(b, sort.key);
        return (va > vb ? 1 : va < vb ? -1 : 0) * sort.dir;
      });
  }, [candidates, jobFilter, statusFilter, search, sort]);

  // Every status label the table can show, including the invite states ("Needs review", "Invited"...).
  const statusOptions = useMemo(
    () => [...new Set([...Object.values(INVITE), ...Object.values(STATUS)].map((s) => s.label))],
    [],
  );

  const completed = candidates.filter((c) => c.scores);
  const stats = [
    { label: "Applicants", value: candidates.length, icon: IconUsers, tint: "bg-brand-soft text-brand-fg" },
    { label: "Interviews completed", value: completed.length, icon: IconVideo, tint: "bg-sky-500/10 text-sky-600 dark:text-sky-300" },
    {
      label: "Hire / Strong Hire",
      value: completed.filter((c) => c.scores!.total >= 60).length,
      icon: IconAward,
      tint: "bg-ok-soft text-ok-fg",
    },
    { label: "Open positions", value: jobs.filter((j) => j.active).length, icon: IconBriefcase, tint: "bg-warn-soft text-warn-fg" },
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
        <div className="ml-auto">
          <UserMenu me={me} isManager={isManager} onChangePassword={() => setAccountOpen(true)} onSignOut={signOut} />
        </div>
      </div>
      {accountOpen && <AccountDialog onClose={() => setAccountOpen(false)} />}

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{TAB_INFO[tab].title}</h1>
        <p className="mt-1 text-sm text-fg-3">{TAB_INFO[tab].subtitle}</p>
      </div>

      {tab === "team" && isManager ? (
        <TeamPanel me={me} team={team} deleteAfterDays={deleteAfterDays} />
      ) : tab === "jobs" ? (
        <JobsPanel jobs={jobs} google={google} defaultPassMark={defaultPassMark} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="rounded-2xl border border-line bg-surface p-5 shadow-card">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-fg-3">{s.label}</p>
                  <span className={cn("grid size-9 place-items-center rounded-lg", s.tint)}>
                    <s.icon className="size-[18px]" />
                  </span>
                </div>
                <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{s.value}</p>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-line bg-surface shadow-card">
            <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
              <div className="relative min-w-56 flex-1">
                <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-4" />
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
                {statusOptions.map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </select>
              <Button variant="ghost" onClick={() => router.refresh()} title="Refresh">
                <IconRepeat />
                <span className="hidden md:inline">Refresh</span>
              </Button>
              <Button variant="ghost" onClick={exportCsv}>
                <IconDownload />
                Export CSV
              </Button>
            </div>

            <div className="max-h-[68vh] overflow-auto rounded-b-2xl">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-surface-2 text-[11px] tracking-wider text-fg-3 uppercase shadow-[0_1px_0_var(--line)]">
                  <tr>
                    {COLUMNS.map((col) => (
                      <th
                        key={col.key}
                        title={col.title}
                        onClick={() => setSort((s) => ({ key: col.key, dir: s.key === col.key ? (-s.dir as 1 | -1) : -1 }))}
                        className={cn(
                          "cursor-pointer px-4 py-3 font-semibold whitespace-nowrap select-none hover:text-fg",
                          col.numeric ? "text-right" : "text-left",
                          sort.key === col.key && "text-fg",
                        )}
                      >
                        {col.label}
                        {sort.key === col.key && <span className="ml-1 text-brand-fg">{sort.dir === -1 ? "↓" : "↑"}</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((c) => {
                    const s = c.scores;
                    const badge = statusBadge(c);
                    return (
                      <tr
                        key={c.id}
                        onClick={() => setOpenId(c.id)}
                        tabIndex={0}
                        onKeyDown={(e) => e.key === "Enter" && setOpenId(c.id)}
                        className="cursor-pointer transition-colors hover:bg-surface-2 focus-visible:bg-brand-soft/60 focus-visible:outline-none"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand-fg">
                              {initials(c.fullName)}
                            </span>
                            <div className="min-w-0">
                              <div className="truncate font-medium text-fg">{c.fullName}</div>
                              <div className="truncate text-xs text-fg-3">{c.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="max-w-44 truncate px-4 py-3 text-fg-2" title={c.jobTitle}>
                          {c.jobTitle}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-fg-2">{shortDate(c.createdAt)}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            <Pill tone={badge.tone}>
                              {badge.label}
                              {c.status === "in_progress" && ` ${c.answered}/${c.totalQuestions}`}
                            </Pill>
                            {c.interrupted && <Pill tone="bad">Interrupted</Pill>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {c.screening?.score != null ? (
                            <span className={cn("font-medium", c.screening.score >= 60 ? "text-ok-fg" : "text-danger-fg")}>
                              {c.screening.score}
                            </span>
                          ) : (
                            <span className="text-fg-4">–</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-fg-2 tabular-nums">{c.totalExperience}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap text-fg-2 tabular-nums">
                          {c.currentCTC} → {c.expectedCTC}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {s ? (
                            <div title={`Interview ${s.interview.points} · joining ${s.joining.points} · salary ${s.salary.points}`}>
                              <div className="text-base">
                                <Signed value={s.total} />
                              </div>
                              <div className="text-[11px] text-fg-4 tabular-nums">
                                {s.interview.points} · {s.joining.points >= 0 ? "+" : ""}
                                {s.joining.points} · {s.salary.points >= 0 ? "+" : ""}
                                {s.salary.points}
                              </div>
                            </div>
                          ) : (
                            <span className="text-fg-4">–</span>
                          )}
                        </td>
                        <td className="px-4 py-3">{s ? <RecommendationPill label={s.recommendation} /> : <span className="text-fg-4">–</span>}</td>
                        <td className="px-4 py-3">
                          <IntegrityPill level={c.integrity.level} />
                        </td>
                      </tr>
                    );
                  })}
                  {!rows.length && (
                    <tr>
                      <td colSpan={COLUMNS.length} className="px-4 py-16 text-center">
                        <IconUsers className="mx-auto size-8 text-fg-4" />
                        <p className="mt-2 font-medium text-fg-2">
                          {candidates.length ? "No candidates match these filters" : "No candidates yet"}
                        </p>
                        <p className="text-sm text-fg-3">
                          {candidates.length ? "Try clearing the search or filters." : "Applications from your job forms appear here."}
                        </p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-xs text-fg-3">
            Score = interview (0–70) + joining (−10 to +15) + salary (−15 to +15), shown underneath each total. Click a row for
            details.
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

/** Signed-in staff member, with Change password and Sign out in a small menu. */
function UserMenu({
  me,
  isManager,
  onChangePassword,
  onSignOut,
}: {
  me: PublicStaffUser;
  isManager: boolean;
  onChangePassword: () => void;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const item = "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-fg-2 hover:bg-surface-2 hover:text-fg";
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-line bg-surface py-1.5 pr-2.5 pl-1.5 shadow-card transition hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
      >
        <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-xs font-bold text-white">
          {initials(me.name)}
        </span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-sm font-medium text-fg">{me.name}</span>
          <span
            className={cn(
              "block text-xs",
              me.role === "superadmin" ? "text-purple-700 dark:text-purple-300" : isManager ? "text-brand-fg" : "text-fg-3",
            )}
          >
            {ROLE_LABEL[me.role]}
          </span>
        </span>
        <IconChevronDown className={cn("size-4 text-fg-3 transition", open && "rotate-180")} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-2 w-56 rounded-xl border border-line bg-surface p-1.5 shadow-card">
          <div className="px-3 py-2">
            <p className="truncate text-sm font-medium">{me.name}</p>
            <p className="truncate text-xs text-fg-3">{me.email}</p>
          </div>
          <div className="my-1 border-t border-line" />
          <button
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              onChangePassword();
            }}
          >
            <IconKey /> Change password
          </button>
          <button role="menuitem" className={cn(item, "text-danger-fg hover:text-danger-fg")} onClick={onSignOut}>
            <IconLogout /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
