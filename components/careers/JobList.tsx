"use client";

import { useMemo, useState } from "react";
import { IconBriefcase, IconClock, IconSearch } from "../icons";
import { cn, inputClass } from "../ui";

export interface JobCardData {
  id: string;
  title: string;
  location: string;
  facts: string[];
  summary: string;
  postedAt?: string;
}

const posted = (iso?: string) => {
  if (!iso) return null;
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return days <= 0 ? "Posted today" : days === 1 ? "Posted yesterday" : days < 30 ? `Posted ${days} days ago` : null;
};

/** Open roles with a search box. */
export function JobList({ jobs }: { jobs: JobCardData[] }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? jobs.filter((j) => `${j.title} ${j.location} ${j.summary} ${j.facts.join(" ")}`.toLowerCase().includes(s)) : jobs;
  }, [jobs, q]);

  return (
    <div>
      <div className="relative mb-6 max-w-md">
        <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-4" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search roles, skills or locations"
          aria-label="Search roles"
          className={cn(inputClass, "py-2.5 pl-9")}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {shown.map((j) => (
          <a
            key={j.id}
            href={`/jobs/${encodeURIComponent(j.id)}`}
            className="group flex flex-col rounded-2xl border border-line bg-surface p-6 shadow-card transition hover:-translate-y-0.5 hover:border-brand-500/50 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold tracking-tight text-fg group-hover:text-brand-fg">{j.title}</h2>
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-fg">
                <IconBriefcase className="size-[18px]" />
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {j.location && <Chip>{j.location}</Chip>}
              {j.facts.map((f) => (
                <Chip key={f}>{f}</Chip>
              ))}
            </div>
            {j.summary && <p className="mt-3 line-clamp-3 text-sm text-fg-3">{j.summary}</p>}
            <div className="mt-auto flex items-center justify-between pt-5 text-sm">
              <span className="flex items-center gap-1.5 text-fg-4">
                {posted(j.postedAt) && (
                  <>
                    <IconClock className="size-3.5" /> {posted(j.postedAt)}
                  </>
                )}
              </span>
              <span className="font-semibold text-brand-fg">View role →</span>
            </div>
          </a>
        ))}
      </div>

      {!shown.length && (
        <div className="rounded-2xl border border-dashed border-line-strong p-12 text-center">
          <IconBriefcase className="mx-auto size-8 text-fg-4" />
          <p className="mt-2 font-medium text-fg-2">{jobs.length ? "No roles match your search" : "No open roles right now"}</p>
          <p className="text-sm text-fg-3">{jobs.length ? "Try a different word." : "Please check back soon."}</p>
        </div>
      )}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-md bg-surface-3 px-2 py-0.5 text-xs font-medium text-fg-2">{children}</span>;
}
