/**
 * Publisher registry and the run loop an admin endpoint calls.
 *
 * One board is active at a time (JOB_PUBLISHER). Adding a second means a list
 * here and a loop over publishers in publishJob; nothing above this file knows
 * which boards exist.
 */
import { config } from "../config";
import type { Job } from "../types";
import { resetLocationCache, recruitee } from "./recruitee";
import { NO_PUBLISHER, failed, type PublishOutcome, type Publisher } from "./types";

const REGISTRY: Record<string, Publisher> = {
  recruitee,
};

/** The configured publisher, or NO_PUBLISHER when unset or unknown. */
export function activePublisher(): Publisher {
  return REGISTRY[config.jobPublisher] ?? NO_PUBLISHER;
}

export interface PublishReport {
  publisher: string;
  dryRun: boolean;
  outcomes: PublishOutcome[];
  counts: Record<string, number>;
  /** Set when the board itself is unavailable, rather than any single job. */
  blocked: string | null;
}

/**
 * Publish every job, active or not.
 *
 * Inactive jobs are included deliberately: a role that was listed and then
 * closed still needs withdrawing from the board, and the "close" path is driven
 * by exactly that.
 */
export async function publishAll(jobs: Job[], dryRun: boolean): Promise<PublishReport> {
  const publisher = activePublisher();
  const blocked = publisher.unavailable();
  if (blocked) {
    return { publisher: publisher.name, dryRun, outcomes: [], counts: {}, blocked };
  }

  // A publish-all run is a fresh reconciliation; stale cached locations would
  // silently mis-file a job after someone added a city in Recruitee.
  resetLocationCache();

  const outcomes: PublishOutcome[] = [];
  for (const job of jobs) {
    try {
      outcomes.push(await publisher.sync(job, { dryRun }));
    } catch (err) {
      // One malformed job must not abandon the rest of the board.
      outcomes.push(
        failed(job, publisher.name, err instanceof Error ? err.message : String(err)),
      );
    }
  }
  return { publisher: publisher.name, dryRun, outcomes, counts: countBy(outcomes), blocked: null };
}

function countBy(outcomes: PublishOutcome[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const o of outcomes) counts[o.action] = (counts[o.action] ?? 0) + 1;
  return counts;
}

export { resetLocationCache };
