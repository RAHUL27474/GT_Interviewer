"use client";

import { useState, type FormEvent } from "react";
import { Alert, Button, Card, CardTitle, Field, inputClass } from "../ui";

/** Find an application with email + Application ID. */
export function TrackLookup() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    const res = await fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: f.get("email"), ref: f.get("ref") }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      window.location.href = data.trackPath;
    } else {
      setError(data.error || "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardTitle>Track your application</CardTitle>
      <p className="-mt-2 mb-5 text-sm text-fg-3">
        Enter the email you applied with and your Application ID. It&apos;s in your confirmation email, and looks like
        GA-7K2M9Q.
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Email" htmlFor="email">
          <input id="email" name="email" type="email" required autoComplete="email" className={inputClass} />
        </Field>
        <Field label="Application ID" htmlFor="ref">
          <input id="ref" name="ref" required autoComplete="off" placeholder="GA-XXXXXX" className={`${inputClass} font-mono uppercase`} />
        </Field>
        <Button type="submit" disabled={busy} className="w-full py-2.5">
          {busy ? "Finding…" : "Find my application"}
        </Button>
      </form>
    </Card>
  );
}
