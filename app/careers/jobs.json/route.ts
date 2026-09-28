import { jsonFeed, loadCareers } from "@/lib/careers";

export const dynamic = "force-dynamic";

/**
 * JSON Feed 1.1 of open roles.
 *
 * Preferred over RSS by most aggregators because it carries HTML content and
 * the _extensions block with the hiringOrganization and jobLocation nodes, so a
 * consumer can build a full listing without a second request per job.
 */
export async function GET() {
  const { jobs, dates } = await loadCareers();
  return new Response(jsonFeed(jobs, dates), {
    headers: {
      "Content-Type": "application/feed+json; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=900",
    },
  });
}
