"use client";

import { useId, useState } from "react";
import { cn, inputClass } from "./ui";

/**
 * Country dialling codes for the phone field.
 *
 * The default is +91 because the roles this is built for are in India, and
 * because a candidate who has to go looking for their code in a list of 200 is
 * a candidate who abandons the form at the worst possible moment. It is a
 * default, not a lock: the list is there for anyone applying from elsewhere.
 */
const COUNTRIES: { code: string; label: string; dial: string }[] = [
  { code: "IN", label: "India", dial: "+91" },
  { code: "AE", label: "United Arab Emirates", dial: "+971" },
  { code: "AU", label: "Australia", dial: "+61" },
  { code: "CA", label: "Canada", dial: "+1" },
  { code: "DE", label: "Germany", dial: "+49" },
  { code: "GB", label: "United Kingdom", dial: "+44" },
  { code: "IE", label: "Ireland", dial: "+353" },
  { code: "NL", label: "Netherlands", dial: "+31" },
  { code: "NZ", label: "New Zealand", dial: "+64" },
  { code: "SG", label: "Singapore", dial: "+65" },
  { code: "US", label: "United States", dial: "+1" },
  { code: "ZA", label: "South Africa", dial: "+27" },
];

/**
 * Split a stored number like "+91 98765 43210" back into its dialling code and
 * the rest, so an edit shows what the candidate typed rather than a mangled
 * version of it.
 */
function split(phone: string): { dial: string; rest: string } {
  const match = COUNTRIES.find((c) => phone.startsWith(c.dial));
  if (!match) return { dial: "+91", rest: phone.replace(/^\+/, "") };
  return { dial: match.dial, rest: phone.slice(match.dial.length).trim() };
}

/**
 * Phone as a country selector plus a local number.
 *
 * One hidden input carries the composed "+91 98765 43210" so the server keeps
 * seeing one field, and `lib/profile.ts` keeps validating one value. Splitting
 * it into two posted fields would mean two parsers and two chances to disagree
 * about what a valid number is.
 */
export function PhoneInput({ name = "phone", defaultValue = "", required }: { name?: string; defaultValue?: string; required?: boolean }) {
  const id = useId();
  const initial = split(defaultValue);
  const [dial, setDial] = useState(initial.dial);
  const [rest, setRest] = useState(initial.rest);

  return (
    <div className="flex gap-2">
      <label htmlFor={`${id}-dial`} className="sr-only">
        Country dialling code
      </label>
      <select
        id={`${id}-dial`}
        value={dial}
        onChange={(e) => setDial(e.target.value)}
        className={cn(inputClass, "w-32 shrink-0 px-2 py-2 sm:w-40")}
      >
        {COUNTRIES.map((c) => (
          <option key={`${c.code}-${c.dial}`} value={c.dial}>
            {c.dial} {c.label}
          </option>
        ))}
      </select>
      <input
        id={name}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        required={required}
        value={rest}
        onChange={(e) => setRest(e.target.value)}
        placeholder="98765 43210"
        aria-label="Phone number"
        className={inputClass}
      />
      {/*
        The only input named `phone`, and the only one the server reads. The
        visible field is deliberately unnamed: two inputs sharing a name would
        post two values and form.get() would silently take the local number.
      */}
      <input type="hidden" name={name} value={rest ? `${dial} ${rest}` : ""} readOnly />
    </div>
  );
}
