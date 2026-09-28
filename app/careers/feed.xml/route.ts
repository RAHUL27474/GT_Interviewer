import { careersUrl, loadCareers, rssFeed } from "@/lib/careers";

export const dynamic = "force-dynamic";

/**
 * RSS 2.0 feed of open roles.
 *
 * This is the lowest-friction way for an existing job board or aggregator to
 * pull new openings, and it is what a candidate's feed reader can subscribe to.
 * Google for Jobs reads the schema.org/JobPosting graph on each job page rather
 * than this feed, so the two are complementary, not alternatives.
 */
export async function GET() {
  const { jobs, dates } = await loadCareers();
  return new Response(rssFeed(jobs, dates), {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=900",
      "Link": `<${careersUrl()}feed.xml>; rel="canonical"`,
    },
  });
}
