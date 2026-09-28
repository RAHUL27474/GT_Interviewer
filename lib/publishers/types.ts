/**
 * Publisher contract for job-board syndication.
 *
 * A publisher reconciles one local job record against a remote board. It must
 * be idempotent: running sync() twice for the same job should converge rather
 * than create a duplicate listing, because the admin panel can and will be
 * clicked twice.
 */
import type { Job } from "../types";

/** What the publisher did, or would have done in dry-run. */
export type PublishAction =
  /** Remote offer did not exist and was created. */
  | "create"
  /** Remote offer existed and its content was updated. */
  | "update"
  /** Remote offer existed but was unpublished, and is live again. */
  | "republish"
  /** Local job went inactive, so the remote offer was withdrawn. */
  | "close"
  /** Nothing to do; the remote state already matches. */
  | "skip"
  /** Credentials missing, so there was nothing to compare against. */
  | "unavailable"
  /** Dry-run: this is the request that would have been sent. */
  | "dry-run"
  /** The remote API refused or failed. `message` carries the reason. */
  | "error";

export interface PublishOutcome {
  jobId: string;
  jobTitle: string;
  publisher: string;
  action: PublishAction;
  /** Remote identifier, once known. */
  externalId?: string | null;
  /** Public listing URL on the destination, once known. */
  url?: string | null;
  /** One line an admin can act on. Never contains credentials. */
  message: string;
}

export interface PublishOptions {
  /** Report what would be sent and make no network writes. */
  dryRun: boolean;
}

export interface Publisher {
  readonly name: string;
  /** True when the credentials this board needs are present. */
  configured(): boolean;
  /** Why it cannot run, or null when it can. */
  unavailable(): string | null;
  /**
   * Reconcile one job against the board. Takes the whole record so the adapter
   * can derive its own published view. Must not throw for expected API
   * failures; return an "error" outcome instead.
   */
  sync(job: Job, options: PublishOptions): Promise<PublishOutcome>;
}

/** A publisher that does nothing, used when JOB_PUBLISHER is unset. */
export const NO_PUBLISHER: Publisher = {
  name: "none",
  configured: () => false,
  unavailable: () =>
    'No job board configured. The careers page, /careers/feed.xml and /careers/jobs.json are live regardless. Set JOB_PUBLISHER=recruitee with RECRUITEE_COMPANY_ID and RECRUITEE_API_TOKEN to also publish to Recruitee.',
  async sync(job) {
    return {
      jobId: job.id,
      jobTitle: job.title,
      publisher: "none",
      action: "unavailable" as const,
      message: "No publisher configured.",
    };
  },
};

export function failed(job: Job, publisher: string, message: string): PublishOutcome {
  return { jobId: job.id, jobTitle: job.title, publisher, action: "error", message };
}

