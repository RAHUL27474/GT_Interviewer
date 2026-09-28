/**
 * What a shortlisted candidate is shown, and the small amount of logic behind it.
 *
 * This lives apart from the components on purpose, for the same reason
 * `lib/screening-copy.ts` does: the words a candidate reads are a policy
 * decision, not decoration. Keeping them here means a test can assert on them
 * without pulling in React, Next or the DOM.
 *
 * Two rules are enforced in the copy below, and they are the whole point of the
 * screen:
 *
 * 1. No score, no threshold, and no hint that one exists. A candidate who sees
 *    "your resume scored 78 against a 75 cutoff" learns a number they cannot
 *    act on and an appeal they expect to win. The mark stays on /admin.
 * 2. No rejection language, and nothing that reads as a verdict. They have
 *    cleared the bar; what follows is an invitation, so it is written as one.
 */

import { config } from "./config";
import type { Job, ResumeScreeningReport } from "./types";

/* ------------------------------------------------------------------ topics */

/** Section labels in a JD that hold the substance, in the order they appear. */
const TOPIC_SECTIONS = [
  "requirements",
  "key responsibilities",
  "what you will do",
  "what you'll do",
  "responsibilities",
  "skills",
  "must have",
  "required skills",
  "qualifications",
  "role",
  "about the role",
];

/** Cap a topic without cutting a word in half. */
const TOPIC_MAX = 72;

function shorten(text: string): string {
  if (text.length <= TOPIC_MAX) return text;
  const cut = text.slice(0, TOPIC_MAX - 1);
  const lastSpace = cut.lastIndexOf(" ");
  // Only honour the word boundary if it is not throwing away most of the line —
  // a very long single "word" (a URL, a compound noun) is better cut hard.
  const body = lastSpace > TOPIC_MAX * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${body.trimEnd()}…`;
}

/** Tidy one topic for display without inventing capitalisation it lacks. */
function tidyTopic(raw: string): string {
  let text = raw.replace(/\s+/g, " ").trim();
  // Bullet markers and numbering stack in real job descriptions — "* - 1. CAD"
  // is not unusual — and each pass removes one layer, so keep going until a pass
  // changes nothing. A space is required after the marker so that "1.5 hours"
  // keeps its decimal point instead of being cut down to "5 hours".
  let previous = "";
  while (text !== previous) {
    previous = text;
    text = text.replace(/^[-*•‣▪◦]\s+/, "").replace(/^\d+[.)]\s+/, "").trim();
  }
  text = text.replace(/[.;:,]+$/, "").trim();
  if (!text) return "";
  // Cap it: a whole JD bullet as a "focus area" is not a focus area.
  return shorten(text);
}

const isHeading = (line: string): boolean => {
  const bare = line.replace(/[:.]\s*$/, "").trim();
  return bare.length > 0 && bare.length <= 40 && TOPIC_SECTIONS.includes(bare.toLowerCase());
};

/** Bullets and sentences from the parts of a JD that describe the work. */
function topicsFromDescription(description: string): string[] {
  const lines = description.split(/\r?\n/);
  const found: string[] = [];
  let collecting = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (isHeading(line)) {
      collecting = true;
      continue;
    }
    if (collecting) {
      const topic = tidyTopic(line);
      if (topic) found.push(topic);
    }
  }
  return found;
}

/**
 * The focus areas shown on the invitation and brief screens.
 *
 * These come from the job description, never from the candidate's own screening
 * scores. Showing someone "Skills matched" would tell them they were measured
 * and invite an argument about the measurement; "you'll be asked about X, Y, Z"
 * is something they can actually prepare for, and it is equally true whether
 * they scored 95 or 76.
 *
 * The JD's own requirements list is the source, because that is what the
 * interviewer will be working from and because whoever wrote it capitalised it
 * properly. The screening report's `requiredSkills` is only a fallback: those
 * are the tokens a matcher pulled out of the JD, lowercased and unpunctuated,
 * and "aws css express git" on an invitation reads like a search query rather
 * than a description of the conversation the candidate is about to have.
 */
export function interviewTopics(
  job: Pick<Job, "title" | "description">,
  report?: Pick<ResumeScreeningReport, "requiredSkills"> | null,
): string[] {
  const limit = config.interviewTopicsMax;

  const fromJd = unique(topicsFromDescription(job.description));
  if (fromJd.length) return fromJd.slice(0, limit);

  const fromReport = (report?.requiredSkills ?? []).map(tidyTopic).filter((t) => t.length > 2);
  if (fromReport.length) return unique(fromReport).slice(0, limit);

  // Nothing recognisable in the JD. The role title is the only honest thing
  // left to show, and one topic is a worse screen than four invented ones would
  // be.
  return [job.title];
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/* ---------------------------------------------------------------- duration */

/**
 * How long the interview will take, in whole minutes.
 *
 * Derived from the actual question count and per-question limit rather than
 * written down, because a number on the invitation that does not match the
 * interview is the kind of small lie a candidate notices and stops trusting.
 * Prep time is included because it is spent waiting on a countdown.
 */
export function estimateInterviewMinutes(questionCount: number, minutesPerQuestion: number): number {
  const questions = Math.max(1, Math.floor(questionCount));
  const perQuestion = Math.max(0.5, minutesPerQuestion);
  return Math.max(1, Math.round(questions * (perQuestion + 1)));
}

/* ---------------------------------------------------------------- deadline */

/**
 * When the invitation runs out, as a short readable string.
 *
 * Rendered rather than returned as a Date so the component stays dumb and the
 * format is testable. Uses the candidate's own locale, not the server's.
 */
export function inviteDeadline(now: Date, hours: number = config.interviewInviteDeadlineHours): string {
  const end = new Date(now.getTime() + hours * 3_600_000);
  const sameYear = end.getFullYear() === now.getFullYear();
  return end.toLocaleString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/* -------------------------------------------------------------------- copy */

export const INVITE = {
  /** The whole-screen opener. Keeps "one step away" rather than "you passed". */
  opening: (company: string, role: string) =>
    `You're just one step away from moving forward with ${company} for the ${role} role.`,

  intro:
    "Your next step is a short AI interview with our AI recruiter. It's a conversational way for us to understand your experience, your motivation, and how you approach the work.",

  expectHeading: "Here's what to expect",

  /**
   * The answer mode. The interview records video and transcribes what is said,
   * so this must not promise typing: a candidate who is told they can type and
   * then finds no keyboard is stuck at the worst moment of the process.
   */
  answerMode:
    "You will answer out loud, on camera, in your own words. There are no trick questions and you can skip anything you'd rather not answer.",

  beforeHeading: "Before you begin",

  before: [
    "Find a quiet space with a good, stable internet connection",
    "Use a laptop or desktop rather than a phone",
    "Allow camera and microphone access when your browser asks",
    "Be ready to share your entire screen — it's part of the recording",
  ],

  cta: "Take the interview",

  /**
   * Only true when a mail provider is configured. The caller decides whether to
   * render this by checking the candidate's notification record, so the page
   * never promises an email that was never sent.
   */
  emailedNote: (email: string) => `We've also sent this link to ${email} in case you'd rather do it later.`,

  reviewLink: "Review the role",
} as const;

/** Shown on step 2 of 3, between the details form and the device check. */
export const BRIEF = {
  heading: "Here's what to expect",
  durationLead: (minutes: number) =>
    `This interview takes about ${minutes} minutes. Each question has a limited time to answer, and the timer starts once you've had a moment to think.`,

  topicsHeading: "You'll be interviewed on",

  /**
   * Recording is not optional here and must be said plainly before consent.
   * The consent checkbox on the details form is the legal half of the same
   * disclosure; this is the human half.
   */
  recording:
    "Your video, audio and answers are recorded and reviewed by our hiring team. Nothing is published, and the recording is only used to assess your application.",

  refreshWarning:
    "Please don't refresh or close this page once the interview starts — it will be submitted as it is, and you'd need to ask us for a new one.",

  cta: "Continue",
} as const;

/** The 3 steps of the pre-interview flow, for the shared progress indicator. */
export const PRE_INTERVIEW_STEPS = [
  { n: 1, label: "Your details" },
  { n: 2, label: "What to expect" },
  { n: 3, label: "Camera, mic & screen" },
] as const;
