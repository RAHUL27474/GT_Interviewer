"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button, Card, CardTitle, Field, inputClass } from "../ui";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) {
      router.refresh();
    } else {
      setError((await res.json().catch(() => ({}))).error || "Sign in failed.");
      setBusy(false);
    }
  }

  return (
    <Card className="mx-auto mt-10 max-w-sm">
      <CardTitle>Staff sign in</CardTitle>
      <p className="-mt-2 mb-4 text-sm text-slate-500">For HR and Managers. Applicants use the link sent to them.</p>
      <form onSubmit={onSubmit} className="space-y-4">
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
          Sign in
        </Button>
      </form>
    </Card>
  );
}
