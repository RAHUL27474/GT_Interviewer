/**
 * Tests for the two form parsers, which are the one place the reordered flow can
 * quietly lose data.
 *
 * The apply form and the post-shortlist details form cover the same fields
 * between them, split across two requests and a page reload. A field that ends
 * up in neither, or in both with the wrong name, still produces a working
 * interview — the candidate just finds their saved details blank, or their
 * salary silently scoring zero. Neither shows up anywhere else.
 */
import { assert, syncSuite } from "./test-harness";
import { EMPTY_DETAILS, parseApplicationDetails, parseDetailsForm } from "./profile";

const { test, done } = syncSuite("profile");

/** Build a FormData the way a real browser submit would. */
function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

const CONTACT = { fullName: "Asha Rao", email: "Asha.Rao@Example.COM", phone: "+91 98765 43210" };

/** What the post-shortlist form submits when a candidate changes nothing. */
const FULL = {
  ...CONTACT,
  totalExperience: "7.5",
  currentLocation: "Pune",
  linkedin: "https://linkedin.com/in/asharao",
  currentCTC: "18",
  expectedCTC: "24",
  joiningCategory: "30_days",
};

function errorMessage(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  return "";
}

/* ------------------------------------------------------- the apply form */

test("the apply form needs only a name, an email and a phone", () => {
  assert.deepEqual(parseApplicationDetails(form(CONTACT)), {
    fullName: "Asha Rao",
    // Lower-cased: the duplicate check in the register route is an exact string
    // match, and "Asha@x.com" vs "asha@x.com" would let someone apply twice.
    email: "asha.rao@example.com",
    phone: "+91 98765 43210",
  });
});

test("the apply form does not require salary or joining", () => {
  // This is the whole point of the reorder. If this ever fails, someone who is
  // never going to be interviewed is being asked for their compensation again.
  assert.doesNotThrow(() => parseApplicationDetails(form(CONTACT)));
});

test("the apply form ignores salary fields if a stale client sends them", () => {
  const details = parseApplicationDetails(form({ ...CONTACT, currentCTC: "0", joiningCategory: "" }));
  assert.equal((details as Record<string, unknown>).currentCTC, undefined);
});

test("the apply form rejects a missing name", () => {
  assert.match(errorMessage(() => parseApplicationDetails(form({ email: CONTACT.email, phone: CONTACT.phone }))), /name/i);
});

test("the apply form rejects a malformed email", () => {
  assert.match(errorMessage(() => parseApplicationDetails(form({ ...CONTACT, email: "asha@" }))), /email/i);
});

test("the apply form rejects a malformed phone", () => {
  assert.match(errorMessage(() => parseApplicationDetails(form({ ...CONTACT, phone: "abc" }))), /phone/i);
});

test("the apply form reports every problem at once", () => {
  // One message per round trip. A candidate fixing three fields one reload at a
  // time on a phone is a candidate who gives up.
  const message = errorMessage(() => parseApplicationDetails(form({})));
  assert.match(message, /name/i);
  assert.match(message, /email/i);
  assert.match(message, /phone/i);
});

/* ------------------------------------------------ the post-shortlist form */

test("the details form accepts a complete submission", () => {
  const details = parseDetailsForm(form(FULL));
  assert.equal(details.totalExperience, 7.5);
  assert.equal(details.currentCTC, 18);
  assert.equal(details.expectedCTC, 24);
  assert.equal(details.joiningCategory, "30_days");
  assert.equal(details.currentLocation, "Pune");
});

test("the details form requires a joining date even when prefilled", () => {
  // Prefill is a convenience, not a default the server can trust: a candidate
  // who never touches the select must still be made to choose, or the joining
  // component of the score silently reads as "unknown".
  assert.match(errorMessage(() => parseDetailsForm(form({ ...FULL, joiningCategory: "" }))), /join/i);
});

test("the details form rejects a joining value that is not one of the options", () => {
  assert.match(errorMessage(() => parseDetailsForm(form({ ...FULL, joiningCategory: "whenever" }))), /join/i);
});

test("the details form requires expected CTC", () => {
  assert.match(errorMessage(() => parseDetailsForm(form({ ...FULL, expectedCTC: "" }))), /expected ctc/i);
});

test("the details form allows a current CTC of zero for a fresher", () => {
  assert.doesNotThrow(() => parseDetailsForm(form({ ...FULL, currentCTC: "0" })));
});

test("the details form rejects an out-of-range experience", () => {
  assert.match(errorMessage(() => parseDetailsForm(form({ ...FULL, totalExperience: "61" }))), /experience/i);
  assert.match(errorMessage(() => parseDetailsForm(form({ ...FULL, totalExperience: "-1" }))), /experience/i);
});

/* ---------------------------------------------------- the in-between state */

test("EMPTY_DETAILS is a complete, type-correct starting point", () => {
  // A candidate record is written the moment they apply, long before they are
  // shortlisted. These six fields exist and are typed, so nothing downstream
  // needs to handle a null, and /admin shows "-" for each until they are real.
  assert.deepEqual(EMPTY_DETAILS, {
    totalExperience: 0,
    currentLocation: "",
    linkedin: "",
    currentCTC: 0,
    expectedCTC: 0,
    joiningCategory: "",
  });
});

done();
