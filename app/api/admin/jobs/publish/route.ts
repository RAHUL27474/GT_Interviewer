import { requireAdmin } from "@/lib/auth";
import { config } from "@/lib/config";
import { HttpError, handler } from "@/lib/http";
import { activePublisher, publishAll } from "@/lib/publishers";
import { store } from "@/lib/store";

/**
 * Reconcile every job with the configured job board.
 *
 * Dry-run is the default, and stays the default until JOB_PUBLISH_DRY_RUN=false
 * is set. Publishing creates real, candidate-visible listings, so a preview has
 * to be the thing you get by accident rather than the thing you have to opt
 * into. `?dryRun=false` forces a live run for one-off use.
 */
export const POST = handler(async (request: Request) => {
  await requireAdmin();

  const url = new URL(request.url);
  const forced = url.searchParams.get("dryRun");
  if (forced !== null && forced !== "true" && forced !== "false") {
    throw new HttpError(400, "dryRun must be true or false.");
  }
  const dryRun = forced === null ? config.jobPublishDryRun : forced === "true";

  const publisher = activePublisher();
  const blocked = publisher.unavailable();
  if (blocked) throw new HttpError(400, blocked);

  const jobs = await store.listJobs();
  const report = await publishAll(jobs, dryRun);

  return Response.json({
    ...report,
    siteUrl: config.siteUrl,
    careers: `${config.siteUrl}/careers`,
  });
});

/** Current publish configuration, so the admin UI can show what is live. */
export const GET = handler(async () => {
  await requireAdmin();
  const publisher = activePublisher();
  return Response.json({
    publisher: publisher.name,
    configured: publisher.configured(),
    blocked: publisher.unavailable(),
    dryRun: config.jobPublishDryRun,
    siteUrl: config.siteUrl,
  });
});
