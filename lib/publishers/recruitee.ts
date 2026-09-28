/**
 * Recruitee publisher.
 *
 * Uses the Recruitee ATS API, company-scoped at
 * https://api.recruitee.com/c/{company_id}, authenticated with a Personal API
 * Token from Settings > Apps and plugins > API Tokens. That token carries the
 * full permissions of the user who made it and cannot be scoped down, so it
 * never leaves the server: nothing here is reachable from the client, and the
 * only entry point is the admin publish route.
 *
 * Endpoints used, documented at https://docs.recruitee.com:
 *   GET   /locations          resolve a city to a location id
 *   GET   /offers, /offers/id find an existing offer, which is what makes this
 *                             adapter idempotent rather than duplicating roles
 *   POST  /offers             create
 *   PATCH /offers/{id}        update content, or publish/withdraw via status
 */
import crypto from "node:crypto";
import { applyUrl, toPublishedJob, type PublishedJob } from "../careers";
import { config } from "../config";
import { publishState } from "../publish-state";
import type { Job } from "../types";
import { failed, type PublishOptions, type PublishOutcome, type Publisher } from "./types";

const API = () => config.recruiteeApiBase;
/** The location catalogue is company-specific and rarely changes; cache per run. */
let locationCache: RecruiteeLocation[] | null = null;

interface RecruiteeLocation {
  id: number;
  name?: string;
  city?: string;
  state_name?: string;
  full_address?: string;
}

interface RecruiteeOffer {
  id: number;
  title?: string;
  slug?: string;
  status?: string;
  url?: string;
  careersUrl?: string;
}

/** Statuses that mean the role is visible to candidates. */
const LIVE = "published";
/** Statuses that mean HR deliberately took it down. Do not fight these. */
const ARCHIVED = new Set(["archived", "closed"]);

/** Strip markup so two spellings of the same JD produce the same hash. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fingerprint of a payload we would send, so an unchanged job is a no-op.
 *
 * `active` is included because publishing and withdrawing are the same PATCH
 * with a different status, so a job going inactive has to register as a change
 * even when its text is untouched.
 */
function contentHash(job: PublishedJob, locationIds: number[]): string {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        t: job.title,
        d: stripHtml(job.descriptionHtml),
        l: [...locationIds].sort((a, b) => a - b),
        a: true,
      }),
    )
    .digest("hex");
}

/** Lowercase alphanumeric words, for tolerant city matching. */
function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((t) => t.length > 1),
  );
}

/**
 * "NCR" describes a region rather than a city, so it matches on its own and
 * would otherwise pull every Delhi-area location into contention.
 */
function significant(text: string): Set<string> {
  const all = tokens(text);
  for (const stop of ["ncr", "india", "indias", "in"]) all.delete(stop);
  return all;
}

/**
 * Pick the Recruitee location that best matches a job's free-text location.
 *
 * "Delhi NCR" has to land on whatever the company actually configured, and
 * there is no naming rule that holds across accounts. So every configured
 * location is scored by shared significant words and the best match wins,
 * provided at least one word overlaps. A hit on the city itself outranks a hit
 * on the state, which is what separates "Delhi" from "Gurugram".
 *
 * Returns null when nothing overlaps, and the caller falls back to
 * RECRUITEE_LOCATION_ID: `location_ids` is required on create, so there is no
 * option to omit it.
 */
export function matchLocation(locations: RecruiteeLocation[], wanted: string): number | null {
  const want = significant(wanted);
  if (want.size === 0) return null;

  let best: { id: number; score: number } | null = null;
  for (const loc of locations) {
    const have = significant([loc.name, loc.city, loc.state_name, loc.full_address].filter(Boolean).join(" "));
    if (have.size === 0) continue;

    let score = 0;
    for (const word of want) if (have.has(word)) score += 1;
    const wantCity = loc.city ? significant(loc.city) : new Set<string>();
    for (const word of wantCity) if (want.has(word)) score += 2;

    if (score > 0 && (!best || score > best.score)) best = { id: loc.id, score };
  }
  return best?.id ?? null;
}

/**
 * One Recruitee call. Adds the bearer token, a timeout, and a small delay so a
 * publish-all run never looks like a flood.
 *
 * Recruitee allows 1000 requests/minute per token, but trial accounts are far
 * tighter and the delay is cheap insurance against a partial run.
 */
async function api(
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const url = `${API()}/c/${encodeURIComponent(config.recruiteeCompanyId)}${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${config.recruiteeApiToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(config.jobPublishTimeoutMs),
  });

  if (config.recruiteeRequestDelayMs) {
    await new Promise((resolve) => setTimeout(resolve, config.recruiteeRequestDelayMs));
  }

  const text = await response.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // A non-JSON error body is normal (gateway text, proxy HTML). Keep a
      // short slice for the admin message, never the full response.
      if (!response.ok) return { ok: false, status: response.status, data: { detail: text.slice(0, 300) } };
    }
  }
  return { ok: response.ok, status: response.status, data };
}

/** One-line, credential-free reason from an error body. */
function apiError(data: Record<string, unknown>): string {
  for (const key of ["errors", "error", "detail", "message"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.slice(0, 300);
    if (Array.isArray(value) && value.length) {
      const first = value[0] as Record<string, unknown>;
      const detail = first?.detail ?? first?.message;
      if (typeof detail === "string") return detail.slice(0, 300);
    }
  }
  return "no error detail returned";
}

/** Page through the active locations once per process. */
async function listLocations(): Promise<RecruiteeLocation[]> {
  if (locationCache) return locationCache;
  const locations: RecruiteeLocation[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await api("GET", `/locations?scope=active&view_mode=brief&limit=100&page=${page}`);
    if (!res.ok) throw new Error(`Recruitee locations: ${apiError(res.data)}`);
    const batch = (res.data.locations as RecruiteeLocation[] | undefined) ?? [];
    locations.push(...batch);
    if (batch.length < 100) break;
  }
  locationCache = locations;
  return locations;
}

/** Every offer, so an existing listing can be found without trusting local state. */
async function listOffers(): Promise<RecruiteeOffer[]> {
  const offers: RecruiteeOffer[] = [];
  for (let page = 1; page <= 20; page++) {
    const res = await api("GET", `/offers?limit=100&page=${page}`);
    if (!res.ok) throw new Error(`Recruitee offers: ${apiError(res.data)}`);
    const batch = (res.data.offers as RecruiteeOffer[] | undefined) ?? [];
    offers.push(...batch);
    if (batch.length < 100) break;
  }
  return offers;
}

/**
 * Find the remote offer backing a local job.
 *
 * Prefers the id recorded last time, then falls back to an exact
 * case-insensitive title match. That fallback is what stops a reset or
 * gitignored data/ directory from turning the next publish into a board full of
 * duplicate roles, which is the failure that actually damages a company page.
 */
async function findOffer(job: Job, recordedId: string | null): Promise<RecruiteeOffer | null> {
  if (recordedId) {
    const res = await api("GET", `/offers/${encodeURIComponent(recordedId)}`);
    if (res.ok) {
      const offer = res.data.offer as RecruiteeOffer | undefined;
      if (offer?.id) return offer;
    }
    // A 404 here means it was deleted in Recruitee, not that we should give up.
  }
  const title = job.title.trim().toLowerCase();
  const offers = await listOffers();
  return offers.find((o) => o.title?.trim().toLowerCase() === title) ?? null;
}

/**
 * The offer payload. `requirements` is required alongside `description` on
 * create, and gets the same body rather than a truncated copy: a board card
 * that disagrees with the careers page is worse than a repetitive one.
 */
function offerPayload(job: PublishedJob, locationIds: number[]) {
  return {
    offer: {
      title: job.title,
      kind: "job",
      location_ids: locationIds,
      description: job.descriptionHtml,
      requirements: job.descriptionHtml,
      on_site: true,
      remote: false,
    },
  };
}

/** Reconcile one job with Recruitee. */
export async function syncRecruiteeJob(job: Job, options: PublishOptions): Promise<PublishOutcome> {
  const base = { jobId: job.id, jobTitle: job.title, publisher: "recruitee" };
  const recorded = await publishState.get(job.id);

  let existing: RecruiteeOffer | null;
  try {
    existing = await findOffer(job, recorded?.externalId ?? null);
  } catch (err) {
    return failed(job, "recruitee", err instanceof Error ? err.message : String(err));
  }

  /* ------------------------------------------------------------- withdraw */

  if (!job.active) {
    if (!existing) {
      return { ...base, action: "skip", message: "Inactive locally and never published to Recruitee." };
    }
    const externalId = String(existing.id);
    const url = existing.careersUrl ?? existing.url ?? null;

    if (existing.status && ARCHIVED.has(existing.status)) {
      return { ...base, action: "skip", externalId, url, message: `Already ${existing.status} in Recruitee.` };
    }
    if (options.dryRun) {
      return {
        ...base,
        action: "dry-run",
        externalId,
        message: `Would PATCH /offers/${externalId} {"offer":{"status":"archived"}} to withdraw the listing.`,
      };
    }

    const res = await api("PATCH", `/offers/${externalId}`, { offer: { status: "archived" } });
    if (!res.ok) return failed(job, "recruitee", `Withdraw failed: ${apiError(res.data)}`);
    await publishState.set(job.id, {
      externalId,
      url,
      title: job.title,
      hash: recorded?.hash ?? "",
      status: "archived",
    });
    return { ...base, action: "close", externalId, url, message: "Withdrawn from Recruitee (archived)." };
  }

  /* -------------------------------------------------- resolve the location */

  let locationIds: number[];
  try {
    const matched = matchLocation(await listLocations(), job.location);
    if (matched !== null) {
      locationIds = [matched];
    } else if (config.recruiteeFallbackLocationId) {
      locationIds = [config.recruiteeFallbackLocationId];
    } else {
      return failed(
        job,
        "recruitee",
        `No Recruitee location matches "${job.location}". Add the city in Recruitee > Settings > Locations, or set RECRUITEE_LOCATION_ID.`,
      );
    }
  } catch (err) {
    return failed(job, "recruitee", err instanceof Error ? err.message : String(err));
  }

  const published = toPublishedJob(job);
  const hash = contentHash(published, locationIds);
  const payload = offerPayload(published, locationIds);

  /* --------------------------------------------------------------- create */

  if (!existing) {
    if (options.dryRun) {
      return {
        ...base,
        action: "dry-run",
        message: `Would POST /offers "${job.title}" at location id ${locationIds.join(", ")}. Apply URL: ${applyUrl(job)}`,
      };
    }
    const res = await api("POST", "/offers", payload);
    if (!res.ok) return failed(job, "recruitee", `Create failed: ${apiError(res.data)}`);

    const offer = res.data.offer as RecruiteeOffer | undefined;
    const url = offer?.careersUrl ?? offer?.url ?? null;
    if (offer?.id) {
      await publishState.set(job.id, {
        externalId: String(offer.id),
        url,
        title: job.title,
        hash,
        status: offer.status ?? LIVE,
      });
    }
    return {
      ...base,
      action: "create",
      externalId: offer?.id ? String(offer.id) : null,
      url,
      message: `Created in Recruitee (${offer?.status ?? "created"}).`,
    };
  }

  /* ------------------------------------------- update / republish / no-op */

  const externalId = String(existing.id);
  const url = existing.careersUrl ?? existing.url ?? null;
  const wasArchived = Boolean(existing.status && ARCHIVED.has(existing.status));

  if (recorded?.hash === hash && existing.status === LIVE) {
    return { ...base, action: "skip", externalId, url, message: "Already up to date in Recruitee." };
  }

  if (options.dryRun) {
    return {
      ...base,
      action: "dry-run",
      externalId,
      message: wasArchived
        ? `Would PATCH /offers/${externalId} {"offer":{"status":"published"}} to relist.`
        : `Would PATCH /offers/${externalId} with the current title and description.`,
    };
  }

  // Relisting needs the status flip in the same call: patching only the text of
  // an archived offer leaves it archived.
  const res = await api(
    "PATCH",
    `/offers/${externalId}`,
    wasArchived ? { offer: { ...payload.offer, status: LIVE } } : payload,
  );
  if (!res.ok) return failed(job, "recruitee", `Update failed: ${apiError(res.data)}`);

  const offer = (res.data.offer as RecruiteeOffer | undefined) ?? existing;
  const nextUrl = offer.careersUrl ?? offer.url ?? url;
  await publishState.set(job.id, {
    externalId,
    url: nextUrl,
    title: job.title,
    hash,
    status: offer.status ?? existing.status ?? LIVE,
  });
  return {
    ...base,
    action: wasArchived ? "republish" : "update",
    externalId,
    url: nextUrl,
    message: wasArchived ? "Relisted in Recruitee." : "Updated in Recruitee.",
  };
}

export const recruitee: Publisher = {
  name: "recruitee",
  configured: () => Boolean(config.recruiteeCompanyId && config.recruiteeApiToken),
  unavailable: () =>
    config.recruiteeCompanyId && config.recruiteeApiToken
      ? null
      : "Set RECRUITEE_COMPANY_ID and RECRUITEE_API_TOKEN (Recruitee > Settings > Apps and plugins > API Tokens).",
  sync: syncRecruiteeJob,
};

/** Drop the cached locations so a newly added Recruitee city is picked up. */
export function resetLocationCache(): void {
  locationCache = null;
}
