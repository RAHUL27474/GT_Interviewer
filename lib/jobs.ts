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
  // Both tags are optional, so an admin form that does not carry them must not be
  // allowed to erase them: an edit that silently dropped a role's experience band
  // would change the public listing without anyone touching the field.
  const optStr = (v: unknown, fallback?: string) => {
    const s = typeof v === "string" ? v.trim() : "";
    return s || fallback;
  };
  return {
    id: existing?.id ?? `${slug}-${crypto.randomBytes(3).toString("hex")}`,
    title,
    location: String(body.location ?? "").trim(),
    description,
    salaryMin,
    salaryMax,
    active: body.active !== false,
    postedAt,
    employmentType: optStr(body.employmentType, existing?.employmentType),
    experience: optStr(body.experience, existing?.experience),
  };
}

/**
 * schema.org/JobPosting.employmentType as an applicant would read it. Only the
 * values this app could realistically post are spelled out; anything else is
 * shown in title case rather than dropped, so an unexpected value on a record is
 * visible instead of silently rendering as "Full-time".
 */
const JOB_EMPLOYMENT_LABELS: Record<string, string> = {
  FULL_TIME: "Full-time",
  PART_TIME: "Part-time",
  CONTRACTOR: "Contract",
  TEMPORARY: "Temporary",
  INTERN: "Internship",
  VOLUNTEER: "Volunteer",
  PER_DIEM: "Per diem",
};

/**
 * The two metadata chips under a role's title on the apply card.
 *
 * `experience` is stored on the record when the role has it, and otherwise read
 * back out of the description, because every role this app has posted states its
 * band in the requirements ("1-3 years of hands-on experience"). Regex rather
 * than a stored field alone, so a role written before the field existed still
 * gets a chip instead of a bare card.
 *
 * `employmentType` is a label lookup. Nothing here has ever been part-time or
 * contract, so an *absent* value means full-time; an unrecognised value is shown
 * in title case rather than dropped, so a surprising record is visible on the
 * page instead of quietly reading "Full-time".
 */
export function jobTags(job: Pick<Job, "description" | "employmentType" | "experience">): {
  employment: string;
  experience: string | null;
} {
  const experience =
    job.experience?.trim() ||
    // "2-5 years", "0-2 years", "up to 3 years", "3+ years"
    job.description.match(/(\d+\s*(?:-|–|to)\s*\d+|\d+\s*\+|\d+)\s*\+?\s*years?/i)?.[0]?.replace(/\s+/g, " ") ||
    null;

  const raw = job.employmentType?.trim() ?? "";
  const employment = raw
    ? (JOB_EMPLOYMENT_LABELS[raw.toUpperCase()] ??
      raw.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()))
    : "Full-time";
  return { employment, experience };
}
