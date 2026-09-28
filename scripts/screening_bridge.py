#!/usr/bin/env python
"""Long-lived screening bridge for the Next.js app.

The Next.js app needs the sentence-transformer model in
``src/resume_screening`` for every resume it screens. Loading that model costs
several seconds, so spawning ``main.py`` per request would add that cost to
every candidate. Instead this script stays resident, loads the matcher once,
and speaks newline-delimited JSON on stdin/stdout:

    -> {"id": "1", "op": "screen", "resumeBase64": "...", "filename": "r.pdf",
        "jobDescription": "...", "shortlistThreshold": 75, "reviewThreshold": 50}
    <- {"id": "1", "ok": true, "result": {...}}

Every reply carries back the request ``id`` so the caller can correlate
concurrent requests. A reply always arrives, even for failures: the process
must never die on bad input, because the app treats a dead bridge as "fall
back to the LLM screener" and would silently lose the stronger scorer.

Ops
---
``ping``   - readiness probe. Answers once the model is loaded.
``screen`` - extract text from a resume, score it against a JD, return the
             full explainable breakdown.
``fields`` - structured field extraction only, for the admin drawer.
``quit``   - shut down cleanly.

Resume *bytes* are sent rather than text on purpose: this package extracts PDF
text with OCR for scanned pages, which the Node app cannot do on its own.
"""

from __future__ import annotations

import base64
import json
import os
import sys
import traceback
from typing import Any

# The `resume_screening` package lives in the parent directory, outside this
# nested app, so make it importable without requiring an editable install.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

# Keep Hugging Face quiet: it logs a lot of progress noise on stderr, and a
# stray progress bar would corrupt the protocol if it ever reached stdout.
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

# Threshold defaults. The upstream `DEFAULT_THRESHOLD` is 90, which is
# unreachable in practice: cosine similarity between a resume and a job
# description for genuinely related professional text lands around 0.6-0.75,
# which the model rescales to roughly 80-88. A 90 cut-off would reject every
# real candidate, so these sit on the scale the model actually produces.
SHORTLIST_THRESHOLD = 75.0
REVIEW_THRESHOLD = 50.0

# Score given to a dimension the job description says nothing about.
#
# A requirement that was never stated cannot be failed, so it neither rewards nor
# penalises. It sits above the midpoint because the candidate met everything the
# posting did ask for, and below full marks because the dimension carries no
# signal either way. The same rule applies to required skills, experience,
# education and projects, so a thin job posting cannot decide a ranking.
NEUTRAL_DIMENSION_SCORE = 60

# How many dimension scores the Node side expects back.
REQUIRED_SKILLS_WEIGHT = 0.40
EXPERIENCE_WEIGHT = 0.20
EDUCATION_WEIGHT = 0.10
PROJECTS_WEIGHT = 0.15
SEMANTIC_WEIGHT = 0.15

_matcher: Any = None
_fields_module: Any = None


def log(message: str) -> None:
    """Diagnostics go to stderr; stdout carries the protocol only."""
    print(message, file=sys.stderr, flush=True)


def get_matcher() -> Any:
    """Load the matcher once per process and reuse it."""
    global _matcher
    if _matcher is None:
        from resume_screening.matching import ResumeJDMatcher

        _matcher = ResumeJDMatcher()
        log(f"[bridge] matcher ready: {len(_matcher.skill_terms)} skill terms")
    return _matcher


def get_fields() -> Any:
    global _fields_module
    if _fields_module is None:
        from resume_screening import fields as fields_module

        _fields_module = fields_module
    return _fields_module


def extract_resume_text(payload: dict) -> tuple[str, str]:
    """Return (text, method) for a base64 resume.

    Tries the full extractor with OCR first, then without it, then as plain
    text. A resume we cannot read is the candidate's problem to fix, not a
    reason to fail the whole bridge, so every failure is reported as empty
    text and the caller decides what that means.
    """
    raw = base64.b64decode(payload["resumeBase64"])
    filename = payload.get("filename") or "resume.pdf"
    ext = os.path.splitext(filename)[1].lower()

    if ext in (".txt", ".md", ""):
        return raw.decode("utf-8", errors="replace"), "text"

    from resume_screening.extract import extract

    try:
        result = extract(raw, filename, use_ocr=True)
        if result.text.strip():
            return result.text, result.method
    except Exception as error:  # noqa: BLE001 - OCR is best-effort
        log(f"[bridge] extraction with OCR failed: {error}")

    try:
        result = extract(raw, filename, use_ocr=False)
        return result.text, result.method
    except Exception as error:  # noqa: BLE001
        log(f"[bridge] extraction without OCR failed: {error}")
        return "", "unreadable"


#: Degree levels, weakest first. Used to compare a requirement against what a
#: resume actually claims.
DEGREE_LEVELS = ("diploma", "bachelor", "master", "phd")

#: Free-text cues for each degree level. A resume writes "Bachelor of Science in
#: Computer Science" or "B.Tech, CSE", never the bare label "bachelor", so the
#: candidate's education strings have to be read for a level the same way the
#: job description is.
DEGREE_CUES: dict[str, tuple[str, ...]] = {
    "phd": ("phd", "ph.d", "doctorate", "doctoral", "d.phil"),
    "master": ("master", "m.tech", "mtech", "m.sc", "msc", "m.s.", "mba", "m.eng", "masters", "post graduate", "postgraduate"),
    "bachelor": ("bachelor", "b.tech", "btech", "b.sc", "bsc", "b.s.", "b.e.", "b.eng", "undergraduate", "graduat", "b.ca", "b.com"),
    "diploma": ("diploma", "associate", "certificate", "intermediate", "h.s.c", "s.s.c", "12th"),
}


def detect_degree_levels(entries: list[str]) -> list[str]:
    """Map free-text education entries onto normalised degree levels.

    Without this, a resume listing "Bachelor of Science in Computer Science"
    compares as *no degree at all* against a job asking for a bachelor, which
    silently costs the candidate the whole education dimension.
    """
    found: list[str] = []
    for entry in entries:
        text = str(entry).lower()
        for level in DEGREE_LEVELS:
            if level in found:
                continue
            if any(cue in text for cue in DEGREE_CUES[level]):
                found.append(level)
    # Strongest first, so a candidate with both a B.Tech and an MBA ranks as a master.
    return sorted(found, key=DEGREE_LEVELS.index, reverse=True)


def degree_rank(degrees: list[str]) -> int:
    """0 = none found, 1 = diploma, 2 = bachelor, 3 = master, 4 = doctorate."""
    return max((DEGREE_LEVELS.index(d) + 1 for d in degrees if d in DEGREE_LEVELS), default=0)


def jd_requirements(job_description: str) -> dict:
    """Pull the scoring requirements a job description states in prose.

    The matcher already derives required *skills* from the description text.
    Experience and education are stated in words rather than as a taxonomy, so
    they are read with deliberately loose patterns. Anything not found stays
    None, and a missing requirement never penalises the candidate.
    """
    import re

    text = job_description.lower()
    requirements: dict[str, Any] = {"minExperienceYears": None, "degrees": []}

    years = re.search(r"(\d{1,2})\s*\+?\s*(?:years?|yrs?)", text)
    if years:
        try:
            requirements["minExperienceYears"] = float(years.group(1))
        except ValueError:
            pass

    degrees = detect_degree_levels([job_description])
    requirements["degrees"] = degrees

    return requirements


def score_experience(candidate_years: float | None, minimum: float | None) -> int:
    """Score the experience dimension.

    With no stated minimum in the JD, experience cannot be judged against it, so
    the dimension is neutral rather than zero - an absent requirement must not
    read as a missing qualification.
    """
    if minimum is None or minimum <= 0:
        return NEUTRAL_DIMENSION_SCORE
    if candidate_years is None:
        # Unverified, not absent. Partial credit, never zero.
        return 40
    if candidate_years >= minimum:
        # At or above the bar. Cap the bonus so extra years cannot outweigh fit.
        over = (candidate_years - minimum) / minimum if minimum else 0
        return min(100, int(80 + min(20, over * 40)))
    ratio = (candidate_years or 0) / minimum
    return max(0, min(70, int(ratio * 70)))


def score_education(candidate_degrees: list[str], required_degrees: list[str]) -> int:
    """Score the education dimension on degree *level* only.

    Institution name is deliberately ignored: college prestige is not a
    legitimate hiring signal and is excluded by policy.
    """
    if not required_degrees:
        return NEUTRAL_DIMENSION_SCORE
    have = degree_rank(detect_degree_levels(candidate_degrees))
    need = degree_rank(required_degrees)
    if need == 0:
        return NEUTRAL_DIMENSION_SCORE
    if have >= need:
        return 100 if have == need else 90
    if have == 0:
        # Education listed but no recognisable degree, rather than none at all.
        return 40
    return 60


def score_projects(resume_text: str, required_skills: list[str], matched_skills: list[str]) -> int:
    """Score the projects dimension.

    There is no project parser in the upstream package, so this measures
    whether the candidate shows applied, evidence-bearing work: a projects or
    experience section with real content, weighted by how many of the role's
    required skills appear in that applied context.
    """
    text = resume_text.lower()
    applied_markers = ("project", "internship", "work experience", "employment", "built", "developed", "implemented")
    if not any(marker in text for marker in applied_markers):
        return 30

    if not required_skills:
        return NEUTRAL_DIMENSION_SCORE
    matched = set(matched_skills)
    if not matched:
        return 35
    coverage = len(matched) / len(required_skills)
    return max(0, min(100, int(45 + coverage * 55)))


def op_screen(payload: dict) -> dict:
    resume_text, method = extract_resume_text(payload)
    job_description = str(payload.get("jobDescription") or "")

    if not resume_text.strip():
        return {
            "error": "RESUME_UNPARSEABLE",
            "extractionMethod": method,
            "status": "HR_REVIEW",
        }
    if not job_description.strip():
        return {"error": "JD_EMPTY", "status": "HR_REVIEW"}

    shortlist = float(payload.get("shortlistThreshold") or SHORTLIST_THRESHOLD)
    review = float(payload.get("reviewThreshold") or REVIEW_THRESHOLD)

    matcher = get_matcher()
    match = matcher.score(resume_text, job_description, threshold=shortlist)

    fields_module = get_fields()
    parsed = fields_module.extract_fields(resume_text)
    requirements = jd_requirements(job_description)

    required_skills = match.required_skills
    matched = match.matched_skills
    missing = match.missing_skills

    # Skills the candidate has that the role did not ask for. Reported so HR
    # can see adjacent capability, never counted against them.
    resume_skills = set(matcher.extract_skills(resume_text))
    bonus_skills = sorted(resume_skills - set(required_skills))

    # A JD that names no recognisable skill yields an empty required list, and
    # coverage of 0/0 is reported as 0. Reading that as "matched none of the
    # required skills" docks the candidate 40 weighted points for the vagueness of
    # the job posting rather than for anything they did or did not evidence.
    # The spec only reduces this dimension for a *missing* required skill, and with
    # none listed nothing is missing, so the dimension stays neutral.
    if required_skills:
        dim_required = round(match.skill_coverage * 100, 1)
    else:
        dim_required = NEUTRAL_DIMENSION_SCORE

    dim_semantic = round(match.semantic_score, 1)
    dim_experience = score_experience(parsed.total_experience_years, requirements["minExperienceYears"])
    dim_education = score_education(parsed.education, requirements["degrees"])
    dim_projects = score_projects(resume_text, required_skills, matched)

    final_score = round(
        dim_required * REQUIRED_SKILLS_WEIGHT
        + dim_experience * EXPERIENCE_WEIGHT
        + dim_education * EDUCATION_WEIGHT
        + dim_projects * PROJECTS_WEIGHT
        + dim_semantic * SEMANTIC_WEIGHT,
        1,
    )
    final_score = max(0.0, min(100.0, final_score))

    if final_score >= shortlist:
        status, next_step = "SHORTLISTED", "AI Interview"
    elif final_score >= review:
        status, next_step = "HR_REVIEW", "HR Manual Review"
    else:
        status, next_step = "NOT_SHORTLISTED", "HR Manual Review"

    strengths: list[str] = []
    gaps: list[str] = []
    if matched:
        strengths.append(f"Matches {len(matched)} of {len(required_skills)} skills the role asks for: {', '.join(matched[:8])}.")
    if bonus_skills:
        strengths.append(f"Brings adjacent skills the role did not list: {', '.join(bonus_skills[:8])}.")
    if missing:
        gaps.append(f"No evidence of {len(missing)} required skill(s): {', '.join(missing[:8])}.")
    if requirements["minExperienceYears"] and (parsed.total_experience_years or 0) < requirements["minExperienceYears"]:
        gaps.append(
            f"Resume shows {parsed.total_experience_years or 'no'} years against "
            f"{requirements['minExperienceYears']:g}+ asked for."
        )
    if parsed.education:
        strengths.append(f"Education listed: {'; '.join(parsed.education[:3])}.")
    if not strengths:
        strengths.append("Resume parsed successfully; little matched the role's stated requirements.")
    if not gaps:
        gaps.append("No blocking gaps found against the stated requirements.")

    # Anything that made a dimension unreliable, so a reviewer can discount the
    # number rather than read it as a fact about the candidate.
    engine_notes = list(match.notes)
    if not required_skills:
        engine_notes.append(
            "The job description names no skill this model recognises, so the required-skills "
            "dimension (40% of the score) is neutral rather than zero. Treat this score with "
            "more caution than usual and read the job description yourself."
        )
    if not requirements["minExperienceYears"]:
        engine_notes.append(
            "The job description states no minimum years of experience, so the experience "
            "dimension (20%) is neutral rather than judged."
        )
    if not requirements["degrees"]:
        engine_notes.append(
            "The job description states no degree requirement, so the education dimension "
            "(10%) is neutral rather than judged."
        )

    if status == "SHORTLISTED":
        summary = (
            f"Scored {int(round(final_score))}/100 (shortlist at {shortlist:g}). "
            f"{dim_required:g}% of the role's required skills are evidenced in the resume and the overall "
            f"semantic fit is {dim_semantic:g}/100. Recommended to advance to the AI interview; HR reviews every decision."
        )
    elif status == "HR_REVIEW":
        summary = (
            f"Scored {int(round(final_score))}/100, between the review floor of {review:g} and the "
            f"shortlist mark of {shortlist:g}. Too close to call automatically, so this goes to a person. "
            f"Required-skill coverage is {dim_required:g}%."
        )
    else:
        summary = (
            f"Scored {int(round(final_score))}/100, below the review floor of {review:g}. "
            f"Required-skill coverage is {dim_required:g}%, so the resume does not evidence enough of the role. "
            f"This is a recommendation only and HR still sees the full breakdown."
        )

    return {
        "summary": summary,
        "scores": {
            "requiredSkills": dim_required,
            "experience": dim_experience,
            "education": dim_education,
            "projects": dim_projects,
            "semantic": dim_semantic,
            "finalScore": int(round(final_score)),
            "nativeScreeningScore": round(match.screening_score, 2),
            "semanticSimilarity": round(match.semantic_similarity, 4),
            "skillCoveragePercent": round(match.skill_coverage * 100, 2),
            "threshold": shortlist,
            "reviewThreshold": review,
            "marginToThreshold": round(match.margin_to_threshold, 2),
        },
        "requiredSkills": required_skills,
        "matchedSkills": matched,
        "missingSkills": missing,
        "bonusSkills": bonus_skills,
        "strengths": strengths,
        "gaps": gaps,
        "candidate": {
            "name": parsed.full_name,
            "email": parsed.email,
            "phone": parsed.phone,
            "currentTitle": parsed.current_title,
            "totalExperienceYears": parsed.total_experience_years,
            "employers": parsed.employers[:6],
            "education": parsed.education[:6],
            "certifications": parsed.certifications[:6],
            "skills": parsed.skills[:20],
        },
        "jobRequirements": requirements,
        "extractionMethod": method,
        "status": status,
        "recommendedNextStep": next_step,
        "engineNotes": engine_notes,
    }


def op_fields(payload: dict) -> dict:
    resume_text = str(payload.get("resumeText") or "")
    if not resume_text.strip():
        return {"error": "RESUME_UNPARSEABLE"}
    parsed = get_fields().extract_fields(resume_text)
    return {
        "candidate": {
            "name": parsed.full_name,
            "email": parsed.email,
            "phone": parsed.phone,
            "currentTitle": parsed.current_title,
            "totalExperienceYears": parsed.total_experience_years,
            "employers": parsed.employers[:6],
            "education": parsed.education[:6],
            "skills": parsed.skills[:20],
        }
    }


def handle(request: dict) -> dict:
    op = request.get("op")
    if op == "ping":
        get_matcher()
        return {"ok": True, "result": {"ready": True}}
    if op == "screen":
        return {"ok": True, "result": op_screen(request)}
    if op == "fields":
        return {"ok": True, "result": op_fields(request)}
    if op == "quit":
        raise SystemExit(0)
    return {"ok": False, "error": f"UNKNOWN_OP:{op}"}


def main() -> int:
    log("[bridge] starting")
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        except Exception:  # noqa: BLE001 - older interpreters
            pass

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            response = handle(request)
        except SystemExit:
            raise
        except Exception as error:  # noqa: BLE001 - never let one bad request kill the bridge
            log(f"[bridge] request failed: {error}\n{traceback.format_exc()}")
            response = {"ok": False, "error": f"{type(error).__name__}: {error}"}

        response["id"] = request_id
        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
