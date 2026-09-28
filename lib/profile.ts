import { HttpError } from "./http";
import { JOINING_OPTIONS } from "./scoring";
import type { CandidateProfile } from "./types";

/** Read a trimmed string out of a submitted form. */
const str = (form: FormData, k: string) => {
  const v = form.get(k);
  return typeof v === "string" ? v.trim() : "";
};

/** Read a number, or NaN so a missing or unparseable value fails validation. */
const num = (form: FormData, k: string) => (str(form, k) === "" ? NaN : Number(str(form, k)));

/** Valid enough to contact someone and to name an application by. */
const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const isPhone = (v: string) => /^[+\d][\d\s-]{7,16}$/.test(v);

/**
 * Contact details, collected with the resume on the apply page.
 *
 * Deliberately the shortest form that can still run Round 1 and reach the
 * candidate. Everything a rejected or held candidate would have to type — their
 * salary, their notice period, their notice period in rupees — is asked for
 * after the shortlist instead, in `parseDetailsForm`.
 *
 * The point is not a shorter form. It is that someone who does not get an
 * interview should not have handed over their compensation to find out.
 */
export function parseApplicationDetails(form: FormData): Pick<CandidateProfile, "fullName" | "email" | "phone"> {
  const details = {
    fullName: str(form, "fullName"),
    email: str(form, "email").toLowerCase(),
    phone: str(form, "phone"),
  };
  const errors: string[] = [];
  if (!details.fullName) errors.push("Full name is required.");
  if (!isEmail(details.email)) errors.push("A valid email is required.");
  if (!isPhone(details.phone)) errors.push("A valid phone number is required.");
  if (errors.length) throw new HttpError(400, errors.join(" "));
  return details;
}

/**
 * Everything Round 1 did not need, collected only once a resume is shortlisted.
 *
 * Name, email and phone are re-sent here and re-validated, because a candidate
 * has had time to spot a typo in what they typed at apply time, and because the
 * shortlist step prefills them from the resume.
 *
 * Salary and joining date are here rather than at apply for one reason: they
 * feed the weighted scoring in `lib/scoring.ts`, and they are worth up to 30 of
 * its 100 points. They are asked for only from someone who is about to be
 * interviewed, which is also the only person for whom the answer changes
 * anything.
 */
export function parseDetailsForm(form: FormData): Omit<CandidateProfile, "jobId"> {
  const details = {
    fullName: str(form, "fullName"),
    email: str(form, "email").toLowerCase(),
    phone: str(form, "phone"),
    totalExperience: num(form, "totalExperience"),
    currentLocation: str(form, "currentLocation"),
    linkedin: str(form, "linkedin"),
    currentCTC: num(form, "currentCTC"),
    expectedCTC: num(form, "expectedCTC"),
    joiningCategory: str(form, "joiningCategory"),
  };
  const errors: string[] = [];
  if (!details.fullName) errors.push("Full name is required.");
  if (!isEmail(details.email)) errors.push("A valid email is required.");
  if (!isPhone(details.phone)) errors.push("A valid phone number is required.");
  if (!(details.totalExperience >= 0 && details.totalExperience <= 60)) {
    errors.push("Experience must be between 0 and 60 years.");
  }
  if (!(details.currentCTC >= 0)) errors.push("Current CTC is required (enter 0 if fresher).");
  if (!(details.expectedCTC > 0)) errors.push("Expected CTC is required.");
  if (!JOINING_OPTIONS.some((o) => o.value === details.joiningCategory)) {
    errors.push("Please choose when you can join.");
  }
  if (errors.length) throw new HttpError(400, errors.join(" "));
  return details;
}

/**
 * What a candidate record holds between applying and being shortlisted.
 *
 * The fields below are real and typed, not null, so nothing downstream has to
 * learn about a half-filled record. `profileComplete` is the flag that says
 * whether they are real, and /admin already renders "–" for every one of them
 * until it flips.
 */
export const EMPTY_DETAILS: Omit<CandidateProfile, "jobId" | "fullName" | "email" | "phone"> = {
  totalExperience: 0,
  currentLocation: "",
  linkedin: "",
  currentCTC: 0,
  expectedCTC: 0,
  joiningCategory: "",
};
