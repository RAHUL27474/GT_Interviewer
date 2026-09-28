import type { MetadataRoute } from "next";
import { jobUrl, loadCareers } from "@/lib/careers";
import { config } from "@/lib/config";

// Jobs are created and closed by HR, so the URL set changes on demand. This is
// rendered per request rather than at build time for that reason.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { jobs, dates } = await loadCareers();

  return [
    { url: config.siteUrl, changeFrequency: "monthly", priority: 1 },
    { url: `${config.siteUrl}/careers`, changeFrequency: "daily", priority: 0.9 },
    ...jobs.map((job) => ({
      url: jobUrl(job),
      lastModified: dates.get(job.id),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  ];
}
