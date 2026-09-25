"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { PublicStaffUser, StaffRole } from "@/lib/types";
import { assignableRoles, canManage, ROLE_DESCRIPTION, ROLE_LABEL, ROLES } from "@/lib/roles";
import { Alert, Button, Card, CardTitle, cn, Field, inputClass, Pill } from "../ui";

/** Suggests a readable starting password the manager shares with the new person. */
function suggestPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return Array.from(bytes, (b) => "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"[b % 56]).join("");
}

async function patchUser(id: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Update failed.");
}

export function TeamPanel({
  me,
  team,
  deleteAfterDays,
}: {
  me: PublicStaffUser;
  team: PublicStaffUser[];
  deleteAfterDays: number;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function run(action: () => Promise<void>, success?: string) {
    setError("");
    setNotice("");
    try {
      await action();
      if (success) setNotice(success);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const rank = (r: StaffRole) => ROLES.indexOf(r);
  const sorted = [...team].sort(
    (a, b) => Number(b.active) - Number(a.active) || rank(b.role) - rank(a.role) || a.name.localeCompare(b.name),
  );
  const canAdd = assignableRoles(me.role);

  return (
    <div className="space-y-4">
      <div className={cn("grid gap-3", me.role === "superadmin" ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        {ROLES.filter((r) => r !== "superadmin" || me.role === "superadmin").map((r) => (
          <div
            key={r}
            className={cn("rounded-xl border bg-white p-4 text-sm", r === me.role ? "border-brand-500" : "border-slate-200")}
          >
            <p className="font-semibold">
              {ROLE_LABEL[r]} {r === me.role && <span className="text-xs font-normal text-brand-600">(your role)</span>}
            </p>
            <p className="mt-1 text-slate-500">{ROLE_DESCRIPTION[r]}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center">
        <p className="text-sm text-slate-500">
          You can add and manage: <strong>{canAdd.map((r) => ROLE_LABEL[r]).join(", ")}</strong>. Deactivated accounts
          are deleted automatically after {deleteAfterDays} days. Applicants don&apos;t need accounts.
        </p>
        <Button onClick={() => setAdding(true)} className="ml-auto">
          + Add team member
        </Button>
      </div>

      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="info">{notice}</Alert>}
      {adding && (
        <AddMemberForm
          roles={canAdd}
          onDone={(msg) => {
            setAdding(false);
            if (msg) setNotice(msg);
            router.refresh();
          }}
        />
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs tracking-wide text-slate-500 uppercase">
            <tr>
              <th className="px-3 py-3">Name</th>
              <th className="px-3 py-3">Email (login)</th>
              <th className="px-3 py-3">Role</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Last sign-in</th>
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.map((u) => {
              const self = u.id === me.id;
              const manageable = !self && canManage(me.role, u.role);
              return (
                <tr key={u.id} className={cn(!u.active && "opacity-60")}>
                  <td className="px-3 py-2.5 font-medium">
                    {u.name} {self && <span className="text-xs text-slate-400">(you)</span>}
                  </td>
                  <td className="px-3 py-2.5">{u.email}</td>
                  <td className="px-3 py-2.5">
                    {manageable ? (
                      <select
                        value={u.role}
                        onChange={(e) =>
                          run(
                            () => patchUser(u.id, { role: e.target.value }),
                            `${u.name} is now ${ROLE_LABEL[e.target.value as StaffRole]}.`,
                          )
                        }
                        className={cn(inputClass, "w-auto py-1")}
                      >
                        {canAdd.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className={cn("font-medium", u.role === "superadmin" && "text-purple-700")}>
                        {ROLE_LABEL[u.role]}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {u.active ? (
                      <Pill tone="good">Active</Pill>
                    ) : (
                      <div>
                        <Pill tone="bad">Deactivated</Pill>
                        {u.deletesAt && (
                          <p className="mt-0.5 text-xs whitespace-nowrap text-red-600">
                            Deletes on {new Date(u.deletesAt).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-slate-500">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "Never"}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    {(manageable || self) && (
                      <Button
                        variant="ghost"
                        className="py-1"
                        onClick={() => {
                          const pw = suggestPassword();
                          if (
                            !confirm(
                              `Reset ${u.name}'s password to:\n\n${pw}\n\nThey'll be signed out and must use this password. Share it with them securely.`,
                            )
                          )
                            return;
                          run(
                            () => patchUser(u.id, { password: pw }),
                            `New password for ${u.name}: ${pw} (share it securely; they'll be signed out).`,
                          );
                        }}
                      >
                        Reset password
                      </Button>
                    )}{" "}
                    {manageable && (
                      <Button
                        variant="ghost"
                        className="py-1"
                        onClick={() => {
                          if (
                            u.active &&
                            !confirm(
                              `Deactivate ${u.name}?\n\nThey'll be signed out and can't sign in. If the account stays deactivated for ${deleteAfterDays} days, it will be deleted permanently. Reactivate it before then to keep it.`,
                            )
                          )
                            return;
                          run(() => patchUser(u.id, { active: !u.active }), `${u.name} ${u.active ? "deactivated" : "reactivated"}.`);
                        }}
                      >
                        {u.active ? "Deactivate" : "Reactivate"}
                      </Button>
                    )}
                    {!manageable && !self && <span className="text-xs text-slate-400">No access</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AddMemberForm({ roles, onDone }: { roles: StaffRole[]; onDone: (message?: string) => void }) {
  const [password] = useState(suggestPassword);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    const body = { name: f.get("name"), email: f.get("email"), role: f.get("role"), password: f.get("password") };
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error || "Could not add the account.");
    onDone(`Added ${body.name}. Sign-in: ${body.email} / ${body.password} (share it securely; they can change it after signing in).`);
  }

  return (
    <Card className="ring-2 ring-brand-100">
      <CardTitle>Add team member</CardTitle>
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="name">
            <input id="name" name="name" required className={inputClass} />
          </Field>
          <Field label="Email (used to sign in)" htmlFor="email">
            <input id="email" name="email" type="email" required className={inputClass} />
          </Field>
          <Field label="Role" htmlFor="role">
            <select id="role" name="role" defaultValue="hr" className={inputClass}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Starting password" htmlFor="password" hint="Share this with them. They can change it after signing in.">
            <input id="password" name="password" defaultValue={password} minLength={8} required className={inputClass} />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onDone()}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            Add account
          </Button>
        </div>
      </form>
    </Card>
  );
}
