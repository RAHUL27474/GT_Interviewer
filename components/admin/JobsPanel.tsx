"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { IconCheck, IconCopy, IconExternal, IconMail, IconPencil, IconPlus, IconTrash } from "../icons";
import type { GoogleStatus, Job } from "@/lib/types";
import { Alert, Button, buttonClass, Card, CardTitle, Field, inputClass, Pill } from "../ui";

export function JobsPanel({ jobs, google, defaultPassMark }: { jobs: Job[]; google: GoogleStatus; defaultPassMark: number }) {
  const [editing, setEditing] = useState<Job | "new" | null>(null);
  const [notice, setNotice] = useState("");

  return (
    <div className="space-y-4">
      <GoogleCard google={google} />

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-fg-3">
          Open jobs are listed on the careers page, where applicants apply and track their applications. The salary budget (LPA) is used for scoring only and is
          never shown to them.
        </p>
        <Button onClick={() => setEditing("new")} className="ml-auto">
          <IconPlus /> New job
        </Button>
      </div>

      {notice && <Alert>{notice}</Alert>}
      {editing === "new" && (
        <JobForm
          key="new"
          job={null}
          defaultPassMark={defaultPassMark}
          onDone={(warning) => {
            setEditing(null);
            setNotice(warning ?? "");
          }}
        />
      )}

      {/* The job being edited is replaced by its form, right where it was clicked. */}
      {jobs.map((j) =>
        editing !== "new" && editing?.id === j.id ? (
          <JobForm
            key={j.id}
            job={j}
            defaultPassMark={defaultPassMark}
            onDone={(warning) => {
              setEditing(null);
              setNotice(warning ?? "");
            }}
          />
        ) : (
          <JobCard
            key={j.id}
            job={j}
            defaultPassMark={defaultPassMark}
            onEdit={() => setEditing(j)}
          />
        ),
      )}
    </div>
  );
}

function GoogleCard({ google }: { google: GoogleStatus }) {
  const router = useRouter();
  const { connection } = google;

  async function disconnect() {
    if (!confirm("Disconnect this Google account? Interview emails won't be sent from it until you connect again.")) return;
    await fetch("/api/admin/google", { method: "DELETE" });
    router.replace("/admin?tab=jobs");
    router.refresh();
  }

  const emailLine =
    google.emailRoute === "smtp"
      ? "Interview emails are sent through your SMTP server."
      : google.emailRoute === "gmail"
        ? `Interview emails are sent from ${connection?.email}.`
        : "Emails can't be sent yet: connect Google (with Gmail permission) or set SMTP_HOST. Until then, use \"Send new login details\" on each candidate and pass the password on.";

  return (
    <Card className="!p-4">
      {google.message && (
        <div className="mb-3">
          <Alert tone={google.message.tone}>{google.message.text}</Alert>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-fg">
          <IconMail className="size-5" />
        </span>
        <div className="min-w-0 flex-1 text-sm">
          {connection ? (
            <>
              <p>
                Email sending: <strong>{connection.email}</strong> <Pill tone="good">Connected</Pill>
              </p>
              <p className="text-fg-3">
                {emailLine}
              </p>
            </>
          ) : (
            <>
              <p>
                <strong>No Google account connected.</strong>
              </p>
              <p className="text-fg-3">
                {google.configured
                  ? "Connect the company Google account so interview emails are sent from its Gmail."
                  : "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env (see the README), restart, then connect here."}{" "}
                {google.emailRoute === "smtp" && emailLine}
              </p>
            </>
          )}
        </div>
        {google.canConnect && google.configured && (
          <div className="flex gap-2">
            <a
              href="/api/admin/google/connect"
              className="inline-flex items-center rounded-lg border border-brand-600 px-4 py-2 text-sm font-semibold text-brand-fg hover:bg-brand-soft"
            >
              {connection ? "Switch account" : "Connect Google"}
            </a>
            {connection && (
              <Button variant="ghost" onClick={disconnect}>
                Disconnect
              </Button>
            )}
          </div>
        )}
        {!google.canConnect && !connection && <p className="text-xs text-fg-3">A Manager can connect it.</p>}
      </div>
    </Card>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <IconCheck /> : <IconCopy />}
      {copied ? "Copied" : label}
    </Button>
  );
}

function JobCard({
  job,
  defaultPassMark,
  onEdit,
}: {
  job: Job;
  defaultPassMark: number;
  onEdit: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const jobPath = `/jobs/${encodeURIComponent(job.id)}`;

  async function remove() {
    if (
      !confirm(
        `Delete the job "${job.title}"?

It disappears from the careers page. Candidates who already applied keep their interviews and scores.

Tip: to stop new applications but keep the job, edit it and untick "Open for applications" instead.`,
      )
    )
      return;
    const res = await fetch(`/api/admin/jobs/${encodeURIComponent(job.id)}`, { method: "DELETE" });
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error || "Could not delete the job.");
    router.refresh();
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            {job.title} {job.active ? <Pill tone="good">Open</Pill> : <Pill tone="bad">Closed</Pill>}
          </h3>
          <p className="mt-0.5 text-sm text-fg-3">
            {job.updatedBy && <span className="mr-1">Last edited by {job.updatedBy} ·</span>}
            {job.location || "No location"} · Budget:{" "}
            {job.salaryMax ? `₹${job.salaryMin ?? 0}–${job.salaryMax} LPA` : "not set"} · Resume pass mark{" "}
            {job.screening?.passMark ?? defaultPassMark}
            {job.screening?.minExperience != null && ` · min ${job.screening.minExperience} yrs experience`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {job.active && <CopyButton text={`${typeof window === "undefined" ? "" : window.location.origin}${jobPath}`} label="Copy job link" />}
          <a href={jobPath} target="_blank" rel="noreferrer" className={buttonClass("ghost")}>
            <IconExternal /> {job.active ? "View on careers page" : "Preview"}
          </a>
          <Button variant="secondary" onClick={onEdit}>
            <IconPencil /> Edit job
          </Button>
          <Button variant="ghost" onClick={remove} aria-label="Delete job" title="Delete job" className="!border-danger-line !px-2.5 !text-danger-fg hover:!bg-danger-soft">
            <IconTrash />
          </Button>
        </div>
      </div>
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
      <div className="mt-3 max-h-48 overflow-auto rounded-lg bg-surface-2 p-3 text-sm whitespace-pre-wrap text-fg-2">
        {job.description}
      </div>
    </Card>
  );
}

function JobForm({
  job,
  defaultPassMark,
  onDone,
}: {
  job: Job | null;
  defaultPassMark: number;
  onDone: (warning?: string) => void;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    const res = await fetch(job ? `/api/admin/jobs/${encodeURIComponent(job.id)}` : "/api/admin/jobs", {
      method: job ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: f.get("title"),
        location: f.get("location"),
        salaryMin: f.get("salaryMin"),
        salaryMax: f.get("salaryMax"),
        description: f.get("description"),
        active: f.get("active") === "on",
        passMark: f.get("passMark"),
        minExperience: f.get("minExperience"),
      }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Could not save the job.");
      return;
    }
    router.refresh();
    onDone(data.warning);
  }

  return (
    <Card className="ring-2 ring-brand-soft-2">
      <CardTitle>{job ? "Edit job" : "New job"}</CardTitle>
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" htmlFor="title">
            <input id="title" name="title" required defaultValue={job?.title} className={inputClass} />
          </Field>
          <Field label="Location" htmlFor="location" optional>
            <input id="location" name="location" defaultValue={job?.location} className={inputClass} />
          </Field>
          <Field label="Budget min (₹ LPA)" htmlFor="salaryMin">
            <input id="salaryMin" name="salaryMin" type="number" min={0} step={0.1} defaultValue={job?.salaryMin ?? ""} className={inputClass} />
          </Field>
          <Field label="Budget max (₹ LPA)" htmlFor="salaryMax">
            <input id="salaryMax" name="salaryMax" type="number" min={0} step={0.1} defaultValue={job?.salaryMax ?? ""} className={inputClass} />
          </Field>
          <Field
            label="Resume pass mark (0–100)"
            htmlFor="passMark"
            optional
            hint={`Resumes the AI rates at or above this are shortlisted. Empty: ${defaultPassMark}.`}
          >
            <input id="passMark" name="passMark" type="number" min={0} max={100} step={1} defaultValue={job?.screening?.passMark ?? ""} placeholder={String(defaultPassMark)} className={inputClass} />
          </Field>
          <Field label="Minimum experience (years)" htmlFor="minExperience" optional hint="Applicants with less are not selected.">
            <input id="minExperience" name="minExperience" type="number" min={0} step={0.5} defaultValue={job?.screening?.minExperience ?? ""} className={inputClass} />
          </Field>
          <Field
            label="Job description"
            htmlFor="description"
            className="sm:col-span-2"
            hint="Shown on the careers page, and most interview questions are generated from it, so list the skills and responsibilities you want tested."
          >
            <textarea
              id="description"
              name="description"
              rows={12}
              required
              defaultValue={job?.description}
              placeholder="Responsibilities, required skills, tools, experience…"
              className={inputClass}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={job?.active ?? true} className="size-4 accent-brand-600" />
          Open for applications (shown on the careers page)
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onDone()}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save job"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
