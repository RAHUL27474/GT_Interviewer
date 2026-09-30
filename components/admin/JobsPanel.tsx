"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { GoogleStatus, Job } from "@/lib/types";
import { Alert, Button, Card, CardTitle, Field, inputClass, Pill } from "../ui";

export function JobsPanel({ jobs, google, defaultPassMark }: { jobs: Job[]; google: GoogleStatus; defaultPassMark: number }) {
  const [editing, setEditing] = useState<Job | "new" | null>(null);
  const [notice, setNotice] = useState("");

  return (
    <div className="space-y-4">
      <GoogleCard google={google} />

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-fg-3">
          Each job gets a Google Form to share with applicants. The salary budget (LPA) is used for scoring only and is
          never shown to them.
        </p>
        <Button onClick={() => setEditing("new")} className="ml-auto">
          + New job
        </Button>
      </div>

      {notice && <Alert>{notice}</Alert>}
      {editing === "new" && (
        <JobForm
          key="new"
          job={null}
          canCreateForm={Boolean(google.connection)}
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
            canCreateForm={Boolean(google.connection)}
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
            googleConnected={Boolean(google.connection)}
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
    if (!confirm("Disconnect this Google account? Job forms stay in it, but new applications won't be read until you connect again.")) return;
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
        <span className="text-2xl">📝</span>
        <div className="min-w-0 flex-1 text-sm">
          {connection ? (
            <>
              <p>
                Google account: <strong>{connection.email}</strong> <Pill tone="good">Connected</Pill>
              </p>
              <p className="text-fg-3">
                Job forms are created in this account and checked for new applications every minute. {emailLine}
              </p>
              {!connection.canReadDrive && (
                <p className="mt-1 font-medium text-warn-fg">
                  ⚠ Click <strong>Switch account</strong> and connect the same account again, allowing Google Drive access,
                  so the app can read the resumes applicants upload.
                </p>
              )}
            </>
          ) : (
            <>
              <p>
                <strong>No Google account connected.</strong>
              </p>
              <p className="text-fg-3">
                {google.configured
                  ? "Connect the company Google account to create job application forms and read applications."
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
      {copied ? "Copied ✓" : label}
    </Button>
  );
}

function JobCard({
  job,
  googleConnected,
  defaultPassMark,
  onEdit,
}: {
  job: Job;
  googleConnected: boolean;
  defaultPassMark: number;
  onEdit: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const form = job.googleForm;

  async function remove() {
    if (
      !confirm(
        `Delete the job "${job.title}"?

Its Google Form will stop accepting applications. Candidates who already applied keep their interviews and scores.

Tip: to stop new applications but keep the job, edit it and untick "Open for applications" instead.`,
      )
    )
      return;
    const res = await fetch(`/api/admin/jobs/${encodeURIComponent(job.id)}`, { method: "DELETE" });
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error || "Could not delete the job.");
    router.refresh();
  }

  async function createForm() {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/admin/jobs/${encodeURIComponent(job.id)}/form`, { method: "POST" });
    setBusy(false);
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error || "Could not create the form.");
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
          {form ? (
            <>
              <CopyButton text={form.responderUri} label="Copy form link" />
              <a
                href={form.responderUri}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center rounded-lg border border-line-strong px-4 py-2 text-sm font-semibold text-fg-2 hover:bg-surface-2"
              >
                Open form
              </a>
              <a
                href={`https://docs.google.com/forms/d/${form.formId}/edit`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center rounded-lg border border-line-strong px-4 py-2 text-sm font-semibold text-fg-2 hover:bg-surface-2"
              >
                Edit in Google Forms
              </a>
            </>
          ) : (
            googleConnected && (
              <Button variant="secondary" onClick={createForm} disabled={busy}>
                {busy ? "Creating…" : "Create Google Form"}
              </Button>
            )
          )}
          <Button variant="secondary" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="ghost" onClick={remove} className="!border-danger-line !text-danger-fg hover:!bg-danger-soft">
            Delete
          </Button>
        </div>
      </div>
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
      {form && !form.uploadQuestionId && (
        <div className="mt-3 rounded-lg bg-warn-soft p-3 text-sm text-warn-fg">
          <p className="font-semibold">Add the resume upload question (one-time, about 30 seconds)</p>
          <p className="mt-1">
            Google only allows this in the form editor. Click <strong>Edit in Google Forms</strong>, then{" "}
            <strong>+ (Add question)</strong>, change the type to <strong>File upload</strong> and click Continue. Title
            it <strong>Upload your resume</strong>, turn on <strong>Allow only specific file types</strong> (tick PDF
            and Document), set <strong>Maximum file size</strong> to 10 MB, and switch on <strong>Required</strong>. If
            the form has an old &quot;Link to your resume&quot; question, delete it. The app finds the new question by
            itself within a minute. Note: Google asks applicants to sign in with a Google account to upload a file.
          </p>
        </div>
      )}
      {form && (
        <div className="mt-3 space-y-1 text-xs text-fg-3">
          <p>
            Form in {form.owner} ·{" "}
            {form.lastCheckedAt ? `last checked ${new Date(form.lastCheckedAt).toLocaleTimeString()}` : "not checked yet"}
            {!job.active && " · closed jobs aren't checked"}
          </p>
          {form.lastError && <p className="text-danger-fg">Problem reading responses: {form.lastError}</p>}
          {form.skipped?.length ? (
            <details>
              <summary className="cursor-pointer">{form.skipped.length} response(s) not added</summary>
              <ul className="mt-1 list-disc pl-5">
                {form.skipped.map((s) => (
                  <li key={s.at + s.name}>
                    {new Date(s.at).toLocaleString()} · {s.name}: {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
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
  canCreateForm,
  defaultPassMark,
  onDone,
}: {
  job: Job | null;
  canCreateForm: boolean;
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
        createForm: f.get("createForm") === "on",
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
            hint="Shown on the application form, and most interview questions are generated from it, so list the skills and responsibilities you want tested."
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
          Open for applications {job?.googleForm && "(closing the job also closes its Google Form)"}
        </label>
        {!job && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="createForm"
              defaultChecked={canCreateForm}
              disabled={!canCreateForm}
              className="size-4 accent-brand-600"
            />
            Create a Google Form for applications
            {!canCreateForm && <span className="text-fg-4">(connect a Google account first)</span>}
          </label>
        )}
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
