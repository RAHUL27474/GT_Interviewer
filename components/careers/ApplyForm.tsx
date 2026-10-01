"use client";

import { useRef, useState, type FormEvent } from "react";
import { uploadWithProgress } from "../interview/media";
import { IconCheck, IconFile, IconUpload } from "../icons";
import { Alert, Button, cn, Field, inputClass } from "../ui";

const MAX_MB = 5;

/** The application form on a job page: details + resume, then the Application ID and tracking link. */
export function ApplyForm({
  jobId,
  jobTitle,
  joiningOptions,
}: {
  jobId: string;
  jobTitle: string;
  joiningOptions: { value: string; label: string }[];
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [done, setDone] = useState<{ ref: string; trackPath: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function pick(f: File | undefined | null) {
    setError("");
    if (!f) return;
    if (!/\.(pdf|docx)$/i.test(f.name)) return setError("Your resume must be a PDF or Word (.docx) file.");
    if (f.size > MAX_MB * 1024 * 1024) return setError(`Your resume must be under ${MAX_MB} MB.`);
    setFile(f);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) return setError("Please attach your resume.");
    const form = new FormData(e.currentTarget);
    form.set("jobId", jobId);
    form.set("resume", file);
    setBusy(true);
    setError("");
    setProgress(0);
    try {
      const res = await uploadWithProgress("/api/apply", form, setProgress);
      if (!res.ok) throw new Error(String(res.data.error || "Your application couldn't be sent. Please try again."));
      setDone({ ref: String(res.data.ref), trackPath: String(res.data.trackPath) });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-ok-soft text-ok-fg">
          <IconCheck className="size-6" />
        </span>
        <h2 className="mt-4 text-xl font-semibold tracking-tight">Application sent</h2>
        <p className="mt-1 text-sm text-fg-3">Thank you for applying for {jobTitle}. We&apos;ve emailed you a confirmation.</p>
        <div className="mt-5 rounded-xl border border-line bg-surface-2 p-4">
          <p className="text-xs font-medium tracking-wider text-fg-3 uppercase">Your Application ID</p>
          <p className="mt-1 font-mono text-2xl font-bold tracking-wider text-fg">{done.ref}</p>
          <p className="mt-1 text-xs text-fg-3">Keep it to look up your application later.</p>
        </div>
        <a
          href={done.trackPath}
          className="mt-5 inline-flex w-full items-center justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700"
        >
          Track your application
        </a>
        <a href="/" className="mt-3 inline-block text-sm text-fg-3 hover:text-fg">
          See other open roles
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate={false}>
      <h2 className="text-lg font-semibold tracking-tight">Apply for this role</h2>
      {error && <Alert>{error}</Alert>}

      {/* Hidden from people; bots tend to fill it in. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />

      <Field label="Full name" htmlFor="fullName">
        <input id="fullName" name="fullName" required autoComplete="name" className={inputClass} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email" htmlFor="email">
          <input id="email" name="email" type="email" required autoComplete="email" className={inputClass} />
        </Field>
        <Field label="Phone" htmlFor="phone">
          <input id="phone" name="phone" type="tel" required autoComplete="tel" placeholder="+91 98765 43210" className={inputClass} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Total experience (years)" htmlFor="totalExperience">
          <input id="totalExperience" name="totalExperience" type="number" min={0} max={60} step={0.5} required className={inputClass} />
        </Field>
        <Field label="Current city" htmlFor="currentLocation">
          <input id="currentLocation" name="currentLocation" required autoComplete="address-level2" className={inputClass} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Current CTC (₹ lakhs/year)" htmlFor="currentCTC" hint="0 if you're a fresher">
          <input id="currentCTC" name="currentCTC" type="number" min={0} step={0.1} required className={inputClass} />
        </Field>
        <Field label="Expected CTC (₹ lakhs/year)" htmlFor="expectedCTC">
          <input id="expectedCTC" name="expectedCTC" type="number" min={0} step={0.1} required className={inputClass} />
        </Field>
      </div>
      <Field label="When can you join?" htmlFor="joiningCategory">
        <select id="joiningCategory" name="joiningCategory" required defaultValue="" className={inputClass}>
          <option value="" disabled>
            Choose…
          </option>
          {joiningOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="LinkedIn profile" htmlFor="linkedin" optional>
        <input id="linkedin" name="linkedin" type="url" placeholder="https://linkedin.com/in/…" className={inputClass} />
      </Field>

      <div>
        <p className="mb-1.5 text-sm font-medium text-fg-2">Resume</p>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pick(e.dataTransfer.files[0]);
          }}
          className={cn(
            "flex w-full cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed px-4 py-5 text-left transition",
            dragging ? "border-brand-500 bg-brand-soft" : "border-line-strong hover:border-brand-500 hover:bg-surface-2",
          )}
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-fg">
            {file ? <IconFile className="size-5" /> : <IconUpload className="size-5" />}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-fg">{file ? file.name : "Upload your resume"}</span>
            <span className="block text-xs text-fg-3">
              {file ? `${file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB`} · click to change` : `PDF or Word (.docx), up to ${MAX_MB} MB. Drag and drop or click.`}
            </span>
          </span>
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </div>

      <Button type="submit" disabled={busy} className="w-full py-2.5">
        {busy ? (progress < 1 ? `Uploading… ${Math.round(progress * 100)}%` : "Sending…") : "Submit application"}
      </Button>
      <p className="text-center text-xs text-fg-4">
        By applying you agree to us using your details to assess your application, including an AI review of your resume.
      </p>
    </form>
  );
}
