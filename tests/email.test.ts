import assert from "node:assert/strict";
import { test } from "node:test";
import { applicationReceivedMail, formatDeadline, gradedMail, loginDetailsMail, rejectionMail } from "../lib/email";
import type { Candidate } from "../lib/types";

const opts = {
  loginUrl: "https://jobs.example.com/",
  password: "Abc23xyz9Q",
  expiresAt: "2026-09-30T11:00:00.000Z",
  reinterview: false,
  company: "Acme",
  minutes: 24,
  hrContact: "HR desk",
  timeZone: "Asia/Kolkata",
};

test("login email has the login page, email, password and deadline", () => {
  const mail = loginDetailsMail({ fullName: "Asha", email: "asha@example.com", jobTitle: "Advisor" }, opts);
  assert.equal(mail.to, "asha@example.com");
  assert.equal(mail.subject, "You're shortlisted: video interview for Advisor - Acme");
  assert.match(mail.text, /shortlisted/);
  for (const body of [mail.text, mail.html]) {
    assert.match(body, /https:\/\/jobs\.example\.com\//);
    assert.match(body, /asha@example\.com/);
    assert.match(body, /Abc23xyz9Q/);
    assert.match(body, /4:30\s?pm/i); // 11:00 UTC is 4:30 pm in India
  }
  assert.match(mail.text, /about 24 minutes/);
});

test("deadline is written in the configured time zone", () => {
  assert.match(formatDeadline("2026-09-30T11:00:00.000Z", "Asia/Kolkata"), /30 Sept? 2026.*4:30\s?pm.*IST/i);
});

test("form input is escaped in HTML and kept to one line in subjects", () => {
  const mail = loginDetailsMail(
    { fullName: "<script>x</script>", email: "a@b.co", jobTitle: "Role\r\nBcc: evil@x.com" },
    { ...opts, reinterview: true },
  );
  assert.ok(!mail.html.includes("<script>"));
  assert.ok(mail.html.includes("&lt;script&gt;"));
  assert.ok(!/[\r\n]/.test(mail.subject));
  assert.match(mail.subject, /^New attempt: /);
  assert.match(mail.text, /old password no longer works/);
});

test("HR email covers graded and failed interviews", () => {
  const base = { fullName: "Asha", jobTitle: "Advisor" } as Candidate;
  const ok = gradedMail(
    { ...base, scores: { total: 72, recommendation: "Hire" } as Candidate["scores"] },
    ["hr@example.com"],
    "https://x/admin",
  );
  assert.match(ok.subject, /Hire/);
  assert.match(ok.text, /total 72/);
  const failed = gradedMail({ ...base, evaluationError: "timeout" }, ["hr@example.com"], null);
  assert.match(failed.text, /grading failed \(timeout\)/);
});

test("application-received email promises an answer within the decision delay", () => {
  const mail = applicationReceivedMail({ fullName: "Asha", email: "asha@example.com", jobTitle: "Advisor" }, { company: "Acme", decisionHours: 2 });
  assert.equal(mail.subject, "Application received: Advisor - Acme");
  assert.match(mail.text, /within about 2 hours/);
  assert.doesNotMatch(mail.text, /Password/);
});

test("rejection email is polite and gives no screening details", () => {
  const mail = rejectionMail({ fullName: "<b>Asha</b>", email: "asha@example.com", jobTitle: "Advisor" }, { company: "Acme" });
  assert.equal(mail.subject, "Your application for Advisor - Acme");
  assert.match(mail.text, /won't be taking it forward/);
  assert.ok(!mail.html.includes("<b>Asha</b>"));
});
