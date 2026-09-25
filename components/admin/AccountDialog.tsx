"use client";

import { useState, type FormEvent } from "react";
import { Alert, Button, Card, CardTitle, Field, inputClass } from "../ui";

/** Any signed-in staff member changes their own password. */
export function AccountDialog({ onClose }: { onClose: () => void }) {
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get("next") !== f.get("confirm")) return setError("New passwords don't match.");
    setBusy(true);
    setError("");
    const res = await fetch("/api/admin/account/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current: f.get("current"), next: f.get("next") }),
    });
    setBusy(false);
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error || "Could not change password.");
    setDone(true);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/30 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm">
        <Card>
          <CardTitle>Change password</CardTitle>
          {done ? (
            <div className="space-y-4">
              <Alert tone="info">Password changed. Your other signed-in devices have been signed out.</Alert>
              <Button onClick={onClose} className="w-full">
                Done
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              {error && <Alert>{error}</Alert>}
              <Field label="Current password" htmlFor="current">
                <input id="current" name="current" type="password" autoComplete="current-password" required className={inputClass} />
              </Field>
              <Field label="New password" htmlFor="next" hint="At least 8 characters.">
                <input id="next" name="next" type="password" autoComplete="new-password" minLength={8} required className={inputClass} />
              </Field>
              <Field label="Confirm new password" htmlFor="confirm">
                <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={8} required className={inputClass} />
              </Field>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  Change password
                </Button>
              </div>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
