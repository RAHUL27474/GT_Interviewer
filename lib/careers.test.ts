/**
 * Tests for the careers syndication logic that has real correctness risk:
 * HTML escaping, the JobPosting shape Google validates, and location matching.
 *
 * Every test here is synchronous, so the suite uses `syncSuite` and each `test`
 * call runs inline. Run it on its own with:
 *   node --env-file-if-exists=.env --import tsx lib/careers.test.ts
 * or with the rest via `npm test`.
 */
import { assert, syncSuite } from "./test-harness";
import {
  applyUrl,
  careersUrl,
  descriptionToHtml,
  escapeXml,
  jobPostingJsonLd,
  jsonFeed,
  rssFeed,
  serializeJsonLd,
  toPublishedJob,
  type PublishedJob,
} from "./careers";
import { matchLocation } from "./publishers/recruitee";
import { parseJob } from "./jobs";
import type { Job } from "./types";

const { test, done } = syncSuite("careers");

const job: Job = {
  id: "full-stack-web-developer",
  title: "Full Stack Web Developer",
  location: "Delhi NCR",
  description: "Intro paragraph.\n\nRequirements:\n- 2-5 years experience\n- Strong TypeScript",
  salaryMin: 6,
  salaryMax: 10,
  active: true,
  postedAt: "2026-01-15",
};

const published: PublishedJob = toPublishedJob(job);

/* ------------------------------------------------------------- escaping */

test("escapes HTML metacharacters instead of emitting them as tags", () => {
  const html = descriptionToHtml('<img src=x onerror="alert(1)">');
  assert.ok(!html.includes("<img"), "raw tag leaked into output");
  assert.ok(html.includes("&lt;img"), "expected an escaped entity");
});

test("escapes ampersands before they can start an entity", () => {
  assert.equal(escapeXml("R&D"), "R&amp;D");
});

test("renders a Label: line as a heading and a - list as bullets", () => {
  const html = descriptionToHtml(job.description);
  assert.ok(html.includes("<h3>Requirements</h3>"), `no heading in: ${html}`);
  assert.ok(html.includes("<ul><li>2-5 years experience</li>"), `no list in: ${html}`);
  assert.ok(!html.includes("Requirements:"), "the trailing colon should be dropped");
});

test("keeps a normal sentence that happens to end in a colon as a paragraph", () => {
  const html = descriptionToHtml("We need the following skills for this role which is quite long indeed:");
  assert.ok(html.includes("<p>"), `expected a paragraph, got: ${html}`);
});

/* --------------------------------------------------------- salary safety */

test("never leaks the internal salary band into a published view", () => {
  const view = JSON.stringify(published);
  assert.ok(!view.includes("salaryMin"), "salaryMin present in published view");
  assert.ok(!view.includes("salaryMax"), "salaryMax present in published view");
  // Word boundaries, not bare substrings: the ids and dates legitimately
  // contain digits, and a bare "6" check would either pass vacuously or trip
  // on an unrelated field.
  assert.ok(!/\b6\b/.test(view), "salary floor leaked into the published view");
  assert.ok(!/\b10\b/.test(view), "salary ceiling leaked into the published view");
});

test("omits baseSalary from the JobPosting graph", () => {
  const graph = jobPostingJsonLd(published, "2026-01-15");
  assert.equal(graph.baseSalary, undefined);
  assert.ok(!JSON.stringify(graph).includes("LPA"), "salary text leaked into structured data");
});

/* ------------------------------------------------------- JobPosting shape */

test("emits every field Google requires on a JobPosting", () => {
  const graph = jobPostingJsonLd(published, "2026-01-15");
  for (const field of ["@type", "title", "description", "datePosted", "validThrough", "hiringOrganization", "jobLocation"]) {
    assert.ok(graph[field] !== undefined, `missing required field ${field}`);
  }
  assert.equal(graph["@type"], "JobPosting");
  assert.equal(graph.datePosted, "2026-01-15");
  // validThrough must be a plain YYYY-MM-DD; an ISO timestamp is rejected.
  assert.match(String(graph.validThrough), /^\d{4}-\d{2}-\d{2}$/);
});

test("validThrough is later than datePosted", () => {
  const graph = jobPostingJsonLd(published, "2026-01-15");
  assert.ok(String(graph.validThrough) > "2026-01-15");
});

test("references the Organization by @id so the graph resolves", () => {
  const graph = jobPostingJsonLd(published, "2026-01-15");
  const org = graph.hiringOrganization as Record<string, string>;
  assert.ok(String(org["@id"]).endsWith("/#organization"), `unexpected @id ${org["@id"]}`);
});

test("uses an absolute apply URL, since aggregators reject relative ones", () => {
  assert.ok(/^https?:\/\//.test(applyUrl(job)), "apply URL is not absolute");
  assert.ok(applyUrl(job).includes(encodeURIComponent(job.id)));
  assert.ok(careersUrl().startsWith("http"));
});

/* ----------------------------------------------------- JSON-LD injection */

test("neutralises a script-closing sequence inside JSON-LD", () => {
  const nasty = toPublishedJob({ ...job, description: "</script><script>alert(1)</script>" });
  const out = serializeJsonLd(jobPostingJsonLd(nasty, "2026-01-15"));
  assert.ok(!out.includes("</script>"), "script break-out survived serialisation");
  assert.ok(!out.includes("<"), "a raw < reached the JSON-LD payload");
});

/* ------------------------------------------------------------------ feeds */

test("emits one RSS item per active job with an absolute link", () => {
  const xml = rssFeed([published], new Map([[job.id, "2026-01-15"]]));
  assert.equal((xml.match(/<item>/g) ?? []).length, 1);
  assert.ok(xml.includes("<guid isPermaLink=\"true\">http"), "no absolute guid");
  assert.ok(xml.includes("<language>en-in</language>"), "missing en-in language");
});

test("escapes XML metacharacters in feed text", () => {
  const risky = toPublishedJob({ ...job, title: "Dev <Ops> & Data" });
  const xml = rssFeed([risky], new Map());
  assert.ok(xml.includes("Dev &lt;Ops&gt; &amp; Data"), `not escaped: ${xml}`);
});

test("produces a valid JSON Feed with an absolute item id", () => {
  const parsed = JSON.parse(jsonFeed([published], new Map([[job.id, "2026-01-15"]])));
  assert.equal(parsed.version, "https://jsonfeed.org/version/1.1");
  assert.equal(parsed.items.length, 1);
  assert.ok(parsed.items[0].id.startsWith("http"));
  assert.ok(parsed.items[0]._extensions.hiringOrganization["@type"] === "Organization");
});

/* ------------------------------------------------------ location matching */

const locations = [
  { id: 1, name: "Gurugram office", city: "Gurugram", state_name: "Haryana", full_address: "India, Haryana, Gurugram" },
  { id: 2, name: "Delhi NCR office", city: "New Delhi", state_name: "Delhi", full_address: "India, Delhi, New Delhi" },
  { id: 3, name: "Bengaluru", city: "Bengaluru", state_name: "Karnataka", full_address: "India, Karnataka, Bengaluru" },
];

test("maps Delhi NCR onto the Delhi location, not Gurugram", () => {
  assert.equal(matchLocation(locations, "Delhi NCR"), 2);
});

test("ignores NCR on its own so it cannot match every Indian city", () => {
  assert.equal(matchLocation(locations, "NCR"), null);
});

test("returns null when nothing overlaps, so the caller can use the fallback", () => {
  assert.equal(matchLocation(locations, "Pune"), null);
});

test("is case and punctuation insensitive", () => {
  assert.equal(matchLocation(locations, "bengaluru, karnataka"), 3);
});

/* --------------------------------------------------------- postedAt rules */

test("a new job gets a datePosted", () => {
  const created = parseJob({ title: "New Role", description: "d", location: "Pune" });
  assert.match(created.postedAt ?? "", /^\d{4}-\d{2}-\d{2}$/);
});

test("editing a job keeps its original datePosted", () => {
  const created = parseJob({ title: "New Role", description: "d" });
  const edited = parseJob({ title: "New Role Renamed", description: "changed" }, created);
  assert.equal(edited.postedAt, created.postedAt, "an edit made the listing look re-posted");
});

test("parseJob still validates the way the admin panel expects", () => {
  assert.throws(() => parseJob({ title: "  ", description: "d" }), /Title and description/);
  assert.throws(() => parseJob({ title: "t", description: "d", salaryMin: 9, salaryMax: 2 }), /above max/);
});

done();
