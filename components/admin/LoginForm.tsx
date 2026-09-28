"use client";

import { useState, type FormEvent } from "react";
import { Alert, Button, Card, CardTitle, Field, inputClass } from "../ui";

export function LoginForm() {
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
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      // Perform a full navigation so the server component reads the newly set auth cookie.
      window.location.replace("/admin");
    } else {
      setError((await res.json().catch(() => ({}))).error || "Sign in failed.");
      setBusy(false);
    }
  }

  return (
    <Card className="mx-auto mt-10 max-w-sm">
      <CardTitle>Sign in</CardTitle>
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Admin password" htmlFor="password">
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
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
