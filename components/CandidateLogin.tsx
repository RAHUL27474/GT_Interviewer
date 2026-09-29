"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button, Card, CardTitle, Field, inputClass } from "./ui";

export function CandidateLogin({ notice }: { notice?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/candidate/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      router.push(`/interview/${data.id}`);
    } else {
      setError(data.error || "Login failed.");
      setBusy(false);
    }
  }

  return (
    <Card className="mx-auto mt-10 max-w-sm">
      <CardTitle>Log in to your interview</CardTitle>
      <p className="-mt-2 mb-4 text-sm text-slate-500">
        Use the email and password from your interview email. It&apos;s sent shortly after you apply through the job&apos;s
        application form.
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
        {notice && !error && <Alert tone="info">{notice}</Alert>}
        {error && <Alert>{error}</Alert>}
        <Field label="Email" htmlFor="email">
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Password" htmlFor="password">
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Button type="submit" disabled={busy} className="w-full">
          Log in
        </Button>
      </form>
    </Card>
  );
}
