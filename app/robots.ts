import type { MetadataRoute } from "next";
import { config } from "@/lib/config";

/**
 * Crawlers follow /careers to the open roles, which is how the JobPosting graph
 * reaches Google for Jobs.
 *
 * The interview and admin routes are disallowed: a candidate's interview URL is
 * bearer-secret, and there is no reason for it to be in an index. Neither
 * /careers nor its feeds are blocked, since the whole point is to be found.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/careers", "/careers/feed.xml", "/careers/jobs.json"],
        disallow: ["/admin", "/api", "/interview"],
      },
    ],
    sitemap: `${config.siteUrl}/sitemap.xml`,
  };
}
