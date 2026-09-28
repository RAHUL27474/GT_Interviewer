/**
 * Careers-page syndication core.
 *
 * One job record is the single source of truth. Everything a job board or a
 * search engine needs is derived from it here: the HTML we render, the
 * schema.org/JobPosting graph, the RSS feed and the JSON feed. Publishers in
 * ./publishers consume the same shape, so a board never gets a different
 * description than the careers page.
 */
import { config } from "./config";
import { store } from "./store";
import type { Job } from "./types";

/** A job as published: salary stripped, because it is an internal budget. */
export interface PublishedJob {
  id: string;
  title: string;
  location: string;
  /** Plain text, for meta tags and feed summaries. */
  summary: string;
  /** Sanitised HTML, for the page and for schema.org/JobPosting.description. */
  descriptionHtml: string;
}

/**
 * `Job.salaryMin`/`salaryMax` are documented in types.ts as an internal ₹ LPA
 * budget that must never reach an applicant, so no published view of a job
 * carries them and no feed or JobPosting graph advertises them. Publishing a
 * budget band that HR is still negotiating against is a real-world way to lose
 * a candidate, so this is a hard omission, not a display preference.
 */
export function toPublishedJob(job: Job): PublishedJob {
  return {
    id: job.id,
    title: job.title,
    location: job.location.trim(),
    summary: job.description.replace(/\s+/g, " ").trim(),
    descriptionHtml: descriptionToHtml(job.description),
  };
}

/** Active jobs, ready to publish. Inactive jobs stay admin-only. */
export async function activePublishedJobs(): Promise<PublishedJob[]> {
  const jobs = (await store.listJobs()).filter((j) => j.active);
  return jobs.map(toPublishedJob);
}

/**
 * Publish date per job, defaulted to today for records predating this field.
 *
 * schema.org requires datePosted, so there is no way to omit it; substituting
 * today for an undated legacy record is the only thing that keeps those roles
 * indexable, and it errs towards showing them as newly listed.
 */
export function postedDates(jobs: Pick<Job, "id" | "postedAt">[]): Map<string, string> {
  const fallback = today();
  return new Map(jobs.map((j) => [j.id, j.postedAt && /^\d{4}-\d{2}-\d{2}$/.test(j.postedAt) ? j.postedAt : fallback]));
}

/** Permalink for a job's own page. */
export function jobUrl(job: Pick<Job, "id">): string {
  return `${config.siteUrl}/careers/${encodeURIComponent(job.id)}`;
}

/** Where a candidate actually applies. One application form, per job. */
export function applyUrl(job: Pick<Job, "id">): string {
  return `${config.siteUrl}/?job=${encodeURIComponent(job.id)}`;
}

export function careersUrl(): string {
  return `${config.siteUrl}/careers`;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape text for safe interpolation into HTML. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/** Escape text for safe interpolation into XML, including the five entities. */
export function escapeXml(text: string): string {
  return escapeHtml(text);
}

/** A `-`, `*` or `•` bullet line. */
const BULLET = /^[-*•]\s+(.*)$/;
/** "Requirements:" is a section label; a 60+ character line ending in a colon is prose. */
const SECTION_LABEL = /^(.{1,60}):$/;

/**
 * Turn the plain-text job description into small, valid HTML.
 *
 * Job descriptions are authored as plain text in the admin panel, not HTML, so
 * the conversion has to be ours and every character has to be escaped before
 * any tag is added. Feeding raw text into `dangerouslySetInnerHTML` is the
 * stored-XSS hole this function exists to close: without the escape pass, a
 * description containing `<img onerror=...>` executes for every visitor.
 *
 * Walks line by line rather than treating each blank-line block as one unit,
 * because the common shape puts a label and its list in the same block:
 *
 *   Requirements:
 *   - 2-5 years experience
 *   - Strong TypeScript
 *
 * Consecutive bullets collapse into one <ul>; a short `Label:` line becomes an
 * <h3>; anything else becomes a <p>.
 */
export function descriptionToHtml(text: string): string {
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let html = "";
  let bullets: string[] = [];

  const flushBullets = () => {
    if (bullets.length === 0) return;
    html += `<ul>${bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>`;
    bullets = [];
  };

  for (const line of lines) {
    const bullet = line.match(BULLET);
    if (bullet) {
      bullets.push(bullet[1]);
      continue;
    }
    // Any non-bullet line ends the run of bullets, so heading and list stay separate.
    flushBullets();

    const label = line.match(SECTION_LABEL);
    html += label ? `<h3>${escapeHtml(label[1])}</h3>` : `<p>${escapeHtml(line)}</p>`;
  }
  flushBullets();

  return html;
}

/**
 * schema.org/JobPosting for one job, as an @graph node.
 *
 * Google requires `datePosted` and `validThrough` on every JobPosting, and a
 * `hiringOrganization` that matches the page's Organization node, otherwise the
 * rich result is dropped. `baseSalary` is absent on purpose: see
 * toPublishedJob.
 */
export function jobPostingJsonLd(job: PublishedJob, datePosted: string): Record<string, unknown> {
  return {
    "@type": "JobPosting",
    "@id": `${jobUrl(job)}#posting`,
    title: job.title,
    description: job.descriptionHtml,
    datePosted,
    // An empty validThrough is rejected; fall back to the configured window.
    validThrough: new Date(
      Date.parse(datePosted) + config.jobPostingValidDays * 24 * 60 * 60 * 1000,
    ).toISOString().slice(0, 10),
    employmentType: "FULL_TIME",
    hiringOrganization: { "@id": `${config.siteUrl}/#organization` },
    jobLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressLocality: job.location || "India",
        addressCountry: "IN",
      },
    },
    // Tell Google and job boards this is the direct-apply destination, so the
    // listing links here instead of to an aggregator's own form.
    directApply: true,
    url: jobUrl(job),
  };
}

/** The Organization node every JobPosting references by @id. */
export function organizationJsonLd(): Record<string, unknown> {
  return {
    "@type": "Organization",
    "@id": `${config.siteUrl}/#organization`,
    name: config.companyName,
    url: config.siteUrl,
    logo: `${config.siteUrl}/icon.svg`,
    sameAs: [],
  };
}

/** ItemList of every open role, for the careers page itself. */
export function itemListJsonLd(jobs: PublishedJob[]): Record<string, unknown> {
  return {
    "@type": "ItemList",
    "@id": `${careersUrl()}#list`,
    name: `${config.companyName} open roles`,
    numberOfItems: jobs.length,
    itemListElement: jobs.map((job, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: jobUrl(job),
      name: job.title,
    })),
  };
}

/**
 * Serialise a JSON-LD graph for a <script type="application/ld+json"> tag.
 *
 * `<` is escaped to its JSON unicode escape so a description containing
 * `</script>` cannot break out of the tag. That is the documented Next.js
 * approach, and it is the reason this lives in one function rather than being
 * inlined at each call site.
 */
export function serializeJsonLd(graph: Record<string, unknown>): string {
  return JSON.stringify(graph).replace(/</g, "\\u003c");
}

/** ISO date (YYYY-MM-DD) used for datePosted / lastmod. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Active jobs plus their publish dates, which every consumer needs together. */
export async function loadCareers(): Promise<{ jobs: PublishedJob[]; dates: Map<string, string> }> {
  const all = (await store.listJobs()).filter((j) => j.active);
  return { jobs: all.map(toPublishedJob), dates: postedDates(all) };
}

/** RSS 2.0 feed of the open roles. */
export function rssFeed(jobs: PublishedJob[], datePosted: Map<string, string>): string {
  const items = jobs
    .map((job) => {
      const url = jobUrl(job);
      return `    <item>
      <title>${escapeXml(job.title)}</title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="true">${escapeXml(url)}</guid>
      <description>${escapeXml(job.summary)}</description>
      <category>${escapeXml(job.location || "India")}</category>
      <pubDate>${new Date(datePosted.get(job.id) ?? today()).toUTCString()}</pubDate>
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(config.companyName)} · Careers</title>
    <link>${escapeXml(careersUrl())}</link>
    <atom:link href="${escapeXml(`${careersUrl()}/feed.xml`)}" rel="self" type="application/rss+xml"/>
    <description>Current openings at ${escapeXml(config.companyName)}.</description>
    <language>en-in</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <managingEditor>${escapeXml(config.careersEmail)} (${escapeXml(config.companyName)})</managingEditor>
${items}
  </channel>
</rss>
`;
}

/**
 * JSON Feed 1.1, the format aggregators prefer over RSS. The `hiringOrganization`
 * and `jobLocation` extension fields carry the structured data an aggregator
 * needs without a second HTTP call.
 */
export function jsonFeed(jobs: PublishedJob[], datePosted: Map<string, string>): string {
  return JSON.stringify(
    {
      version: "https://jsonfeed.org/version/1.1",
      title: `${config.companyName} · Careers`,
      home_page_url: careersUrl(),
      feed_url: `${careersUrl()}/jobs.json`,
      description: `Current openings at ${config.companyName}.`,
      language: "en-IN",
      items: jobs.map((job) => ({
        id: jobUrl(job),
        url: jobUrl(job),
        title: job.title,
        content_html: job.descriptionHtml,
        summary: job.summary,
        date_published: datePosted.get(job.id) ?? today(),
        tags: [job.location].filter(Boolean),
        _extensions: {
          hiringOrganization: organizationJsonLd(),
          jobLocation: jobPostingJsonLd(job, datePosted.get(job.id) ?? today())["jobLocation"],
        },
      })),
    },
    null,
    2,
  );
}
