import crypto from "node:crypto";
import { HttpError } from "./http";
import type { Job } from "./types";

export function parseJob(body: Record<string, unknown>, existing?: Job): Job {
  const title = String(body.title ?? "").trim();
  const description = String(body.description ?? "").trim();
  if (!title || !description) throw new HttpError(400, "Title and description are required.");
  const optNum = (v: unknown) => (v === "" || v == null ? null : Number(v));
  const salaryMin = optNum(body.salaryMin);
  const salaryMax = optNum(body.salaryMax);
  if ([salaryMin, salaryMax].some((n) => n !== null && !(n >= 0))) throw new HttpError(400, "Salary must be a positive number.");
  if (salaryMin !== null && salaryMax !== null && salaryMin > salaryMax) throw new HttpError(400, "Salary min is above max.");
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  // Only a genuinely new role gets a fresh date; an edit keeps the original so
  // the public listing does not look re-posted every time HR tweaks the JD.
  //
  // `body.postedAt` arrives as `unknown` from the request, so it is only honoured
  // when it is a real, parseable date. Storing an arbitrary object or an
  // unparseable string here would surface as a broken "Posted on" date on the
  // public listing rather than failing here.
  const supplied = typeof body.postedAt === "string" ? body.postedAt.trim() : "";
  const postedAt =
    existing?.postedAt ??
    (supplied && !Number.isNaN(Date.parse(supplied)) ? supplied : new Date().toISOString().slice(0, 10));
  return {
    id: existing?.id ?? `${slug}-${crypto.randomBytes(3).toString("hex")}`,
    title,
    location: String(body.location ?? "").trim(),
    description,
    salaryMin,
    salaryMax,
    active: body.active !== false,
    postedAt,
  };
}
