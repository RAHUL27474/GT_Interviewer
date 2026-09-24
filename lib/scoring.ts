// Scoring rules. Edit the numbers here to change how candidates are ranked.
//
//   Final score = Interview (0 to 70) + Joining date (-10 to +15) + Salary (-15 to +15)
//   Range: -25 to 100. Joining and salary can pull the total below zero.
import type { Scores } from "./types";

export const INTERVIEW_MAX = 70;

export const JOINING_OPTIONS = [
  { value: "immediate", label: "Immediate", points: 15 },
  { value: "15_days", label: "Within 15 days", points: 10 },
  { value: "30_days", label: "Within 30 days", points: 5 },
  { value: "60_days", label: "Within 60 days", points: 0 },
  { value: "90_days", label: "Within 90 days", points: -5 },
  { value: "90_plus", label: "More than 90 days", points: -10 },
];

export const SALARY_RULES = {
  // Expected CTC vs the job's budget (salaryMin / salaryMax, in LPA)
  atOrBelowMin: 15, // expected <= budget min
  atMax: 5, // expected == budget max (linear between min and max)
  overBudget: [
    { upToPct: 10, points: 0 }, // up to 10% above max
    { upToPct: 25, points: -5 },
    { upToPct: Infinity, points: -10 },
  ],
  // Hike asked over current CTC (skipped for freshers with current CTC 0)
  hikePenalty: [
    { abovePct: 50, points: -5 },
    { abovePct: 30, points: -2 },
  ],
  min: -15,
  max: 15,
};

export const RECOMMENDATIONS = [
  { minScore: 75, label: "Strong Hire" },
  { minScore: 60, label: "Hire" },
  { minScore: 45, label: "Maybe" },
  { minScore: -Infinity, label: "Reject" },
];

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function joiningScore(category: string) {
  const opt = JOINING_OPTIONS.find((o) => o.value === category);
  return { points: opt?.points ?? 0, label: opt?.label ?? category };
}

export function salaryScore(input: {
  currentCTC: number;
  expectedCTC: number;
  salaryMin: number | null;
  salaryMax: number | null;
}) {
  const { currentCTC, expectedCTC, salaryMin, salaryMax } = input;
  const notes: string[] = [];
  let points = 0;

  if (salaryMax && salaryMax > 0) {
    const min = salaryMin ?? 0;
    if (expectedCTC <= min) {
      points += SALARY_RULES.atOrBelowMin;
      notes.push(`Expected ${expectedCTC} LPA is at/below budget min (${min} LPA): +${SALARY_RULES.atOrBelowMin}`);
    } else if (expectedCTC <= salaryMax) {
      const t = (expectedCTC - min) / (salaryMax - min || 1);
      const p = round1(SALARY_RULES.atOrBelowMin - t * (SALARY_RULES.atOrBelowMin - SALARY_RULES.atMax));
      points += p;
      notes.push(`Expected ${expectedCTC} LPA is within budget (${min}-${salaryMax} LPA): +${p}`);
    } else {
      const overPct = ((expectedCTC - salaryMax) / salaryMax) * 100;
      const band = SALARY_RULES.overBudget.find((b) => overPct <= b.upToPct)!;
      points += band.points;
      notes.push(`Expected ${expectedCTC} LPA is ${round1(overPct)}% above budget max (${salaryMax} LPA): ${band.points}`);
    }
  } else {
    notes.push("No salary budget set for this job: budget check skipped");
  }

  if (currentCTC > 0) {
    const hikePct = ((expectedCTC - currentCTC) / currentCTC) * 100;
    const rule = SALARY_RULES.hikePenalty.find((r) => hikePct > r.abovePct);
    if (rule) {
      points += rule.points;
      notes.push(`Asking ${round1(hikePct)}% hike over current ${currentCTC} LPA: ${rule.points}`);
    } else {
      notes.push(`Asking ${round1(hikePct)}% hike over current ${currentCTC} LPA: no penalty`);
    }
  }

  return { points: round1(clamp(points, SALARY_RULES.min, SALARY_RULES.max)), notes };
}

export function computeScores(input: {
  questionScores: number[];
  joiningCategory: string;
  currentCTC: number;
  expectedCTC: number;
  job: { salaryMin: number | null; salaryMax: number | null };
}): Scores {
  const { questionScores, joiningCategory, currentCTC, expectedCTC, job } = input;
  const avg = questionScores.length ? questionScores.reduce((a, b) => a + b, 0) / questionScores.length : 0;
  const interview = { points: round1((avg / 10) * INTERVIEW_MAX), max: INTERVIEW_MAX, averageOutOf10: round1(avg) };
  const joining = joiningScore(joiningCategory);
  const salary = salaryScore({ currentCTC, expectedCTC, salaryMin: job.salaryMin, salaryMax: job.salaryMax });
  const total = round1(interview.points + joining.points + salary.points);
  const recommendation = RECOMMENDATIONS.find((r) => total >= r.minScore)!.label;
  return { interview, joining, salary, total, recommendation };
}
