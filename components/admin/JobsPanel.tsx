"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { Job } from "@/lib/types";
import { Alert, Button, Card, CardTitle, Field, inputClass, Pill } from "../ui";

export function JobsPanel({ jobs }: { jobs: Job[] }) {
  const [editing, setEditing] = useState<Job | "new" | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-slate-500">
          The salary budget (LPA) is used for scoring only and is never shown to applicants.
        </p>
        <Button onClick={() => setEditing("new")} className="ml-auto">
          + New job
        </Button>
      </div>

      {editing && (
        <JobForm key={editing === "new" ? "new" : editing.id} job={editing === "new" ? null : editing} onDone={() => setEditing(null)} />
      )}

      {jobs.map((j) => (
        <JobCard key={j.id} job={j} onEdit={() => setEditing(j)} />
      ))}
    </div>
  );
}

function JobCard({ job, onEdit }: { job: Job; onEdit: () => void }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    if (
      !confirm(
        `Delete the job "${job.title}"?

It will disappear from the application form and job list. Candidates who already applied keep their interviews and scores.

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
          <p className="mt-0.5 text-sm text-slate-500">
            {job.updatedBy && <span className="mr-1">Last edited by {job.updatedBy} ·</span>}
            {job.location || "No location"} · Budget:{" "}
            {job.salaryMax ? `₹${job.salaryMin ?? 0}–${job.salaryMax} LPA` : "not set"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              navigator.clipboard.writeText(`${window.location.origin}/?job=${job.id}`);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copied ✓" : "Copy apply link"}
          </Button>
          <Button variant="secondary" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="ghost" onClick={remove} className="!border-red-200 !text-red-600 hover:!bg-red-50">
            Delete
          </Button>
        </div>
      </div>
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
      <div className="mt-3 max-h-48 overflow-auto rounded-lg bg-slate-50 p-3 text-sm whitespace-pre-wrap text-slate-700">
        {job.description}
      </div>
    </Card>
  );
}

function JobForm({ job, onDone }: { job: Job | null; onDone: () => void }) {
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
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Could not save the job.");
      return;
    }
    router.refresh();
    onDone();
  }

  return (
    <Card className="ring-2 ring-brand-100">
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
            label="Job description"
            htmlFor="description"
            className="sm:col-span-2"
            hint="Most interview questions are generated from this text, so list the skills and responsibilities you want tested."
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
          Open for applications
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            Save job
          </Button>
        </div>
      </form>
    </Card>
  );
}
