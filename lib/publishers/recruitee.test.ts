/**
 * Integration test for the Recruitee adapter, driven against a local stand-in
 * for api.recruitee.com.
 *
 * This is the part of the feature most worth testing: the create / update /
 * withdraw decisions and, above all, idempotency. A publisher that creates a
 * second listing when the admin panel is clicked twice is worse than one that
 * does nothing, and that is only provable against a real request sequence.
 *
 * Everything lives inside main() because the config module snapshots
 * process.env at import time, so the RECRUITEE_* variables have to exist before
 * ./recruitee is pulled in. (tsconfig emits CJS, where top-level await is a
 * syntax error.)
 *
 * Run with: npx tsx lib/publishers/recruitee.test.ts
 */
import fs from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { assert, suite } from "../test-harness";
// Type-only, so it is erased at runtime and does not read config before the
// RECRUITEE_* variables are set below.
import type { Job } from "../types";

const stateFile = path.join(process.cwd(), "data", "job-publishes.json");

/** Every write the adapter attempted, so tests can assert on the sequence. */
type Call = { method: string; path: string; body: Record<string, unknown> };
/** The fake account's contents, keyed by Recruitee offer id. */
type Offer = Record<string, unknown>;

async function main(): Promise<void> {
  // The state file is a real one. Keep a copy so a test run never leaves the
  // developer's publish bookkeeping pointing at ids that no longer exist.
  const backup = await fs.readFile(stateFile, "utf8").catch(() => null);

  const calls: Call[] = [];
  let offers: Record<string, Offer> = {};
  let nextId = 1000;
  let failNextCreate = false;

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      const url = new URL(req.url ?? "/", "http://x");
      const m = req.method ?? "GET";
      calls.push({ method: m, path: url.pathname, body });

      const json = (status: number, payload: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };

      if (url.pathname.endsWith("/locations")) {
        return json(200, {
          locations: [
            { id: 1, name: "Gurugram office", city: "Gurugram", state_name: "Haryana" },
            { id: 2, name: "Delhi NCR office", city: "New Delhi", state_name: "Delhi" },
          ],
        });
      }

      if (url.pathname.endsWith("/offers") && m === "GET") {
        return json(200, { offers: Object.values(offers) });
      }
      if (url.pathname.endsWith("/offers") && m === "POST") {
        if (failNextCreate) {
          failNextCreate = false;
          return json(422, { errors: [{ detail: "title has already been taken" }] });
        }
        const offer = { ...(body.offer as object), id: nextId++, status: "published", careersUrl: "https://x.recruitee.com/o/new" };
        offers[String(offer.id)] = offer;
        return json(200, { offer });
      }

      const one = url.pathname.match(/\/offers\/(\d+)$/);
      if (one) {
        const id = one[1];
        if (m === "GET") {
          return offers[id] ? json(200, { offer: offers[id] }) : json(404, { errors: ["not found"] });
        }
        if (m === "PATCH") {
          if (!offers[id]) return json(404, { errors: ["not found"] });
          offers[id] = { ...offers[id], ...(body.offer as object) };
          return json(200, { offer: offers[id] });
        }
      }
      json(404, { errors: ["no route"] });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  process.env.RECRUITE_API_BASE = base;
  process.env.RECRUITE_COMPANY_ID = "12345";
  process.env.RECRUITE_API_TOKEN = "test-token";
  process.env.RECRUITE_REQUEST_DELAY_MS = "0";
  process.env.RECRUITE_LOCATION_ID = "999";

  try {
    const { syncRecruiteeJob, resetLocationCache } = await import("./recruitee");
    const { publishState } = await import("../publish-state");

    const job: Job = {
      id: "qa-engineer",
      title: "QA Engineer",
      location: "Delhi NCR",
      description: "Own our test strategy.\n\nRequirements:\n- 3+ years in QA",
      salaryMin: 5,
      salaryMax: 8,
      active: true,
      postedAt: "2026-02-01",
    };

    const harness = suite("recruitee adapter");
    /** Clear the recorded request log so each test asserts only its own calls. */
    async function test(name: string, fn: () => Promise<void>): Promise<void> {
      calls.length = 0;
      await harness.test(name, fn);
    }
    const { done } = harness;

    const writes = () => calls.filter((c) => c.method !== "GET");

    await test("dry run makes no writes but reports the create it would do", async () => {
      const out = await syncRecruiteeJob(job, { dryRun: true });
      assert.equal(out.action, "dry-run");
      assert.ok(out.message.includes("Would POST /offers"), out.message);
      assert.equal(writes().length, 0, "dry run performed a write");
    });

    await test("live run creates the offer and records the remote id", async () => {
      const out = await syncRecruiteeJob(job, { dryRun: false });
      assert.equal(out.action, "create");
      assert.ok(out.externalId, "no external id recorded");
      const saved = await publishState.get(job.id);
      assert.equal(saved?.externalId, out.externalId);
      assert.equal(writes().filter((c) => c.method === "POST").length, 1);
    });

    await test("second run is a no-op, not a duplicate listing", async () => {
      const before = Object.keys(offers).length;
      const out = await syncRecruiteeJob(job, { dryRun: false });
      assert.equal(out.action, "skip");
      assert.equal(out.message, "Already up to date in Recruitee.");
      assert.equal(Object.keys(offers).length, before, "a duplicate offer was created");
      assert.equal(writes().length, 0, "an unchanged job still issued a write");
    });

    await test("editing the description updates the existing offer in place", async () => {
      const edited = { ...job, description: "New and improved.\n\nRequirements:\n- 4+ years" };
      const out = await syncRecruiteeJob(edited, { dryRun: false });
      assert.equal(out.action, "update");
      const patches = writes().filter((c) => c.method === "PATCH");
      assert.equal(patches.length, 1);
      assert.ok(JSON.stringify(patches[0].body).includes("New and improved"));
      assert.equal(Object.keys(offers).length, 1, "the edit created a second offer");
    });

    await test("locates the remote offer by title when local state is lost", async () => {
      await publishState.clear(job.id);
      resetLocationCache();
      const out = await syncRecruiteeJob(job, { dryRun: false });
      // The offer is already published and identical in title, so the title
      // fallback must find it and update rather than create a twin.
      assert.ok(out.action === "skip" || out.action === "update", `unexpected ${out.action}`);
      assert.equal(Object.keys(offers).length, 1, "title fallback failed and created a duplicate");
    });

    await test("deactivating a job withdraws the listing", async () => {
      const out = await syncRecruiteeJob({ ...job, active: false }, { dryRun: false });
      assert.equal(out.action, "close");
      assert.equal(Object.values(offers)[0].status, "archived");
    });

    await test("withdrawing an already archived offer is a no-op", async () => {
      const out = await syncRecruiteeJob({ ...job, active: false }, { dryRun: false });
      assert.equal(out.action, "skip");
      assert.equal(writes().length, 0);
    });

    await test("reactivating a withdrawn job relists it", async () => {
      const out = await syncRecruiteeJob(job, { dryRun: false });
      assert.equal(out.action, "republish");
      assert.equal(Object.values(offers)[0].status, "published");
    });

    await test("surfaces a Recruitee validation error without throwing", async () => {
      const unique = { ...job, id: "new-role", title: "New Role Nobody Has" };
      failNextCreate = true;
      const out = await syncRecruiteeJob(unique, { dryRun: false });
      assert.equal(out.action, "error");
      assert.ok(out.message.includes("title has already been taken"), out.message);
      assert.equal(await publishState.get(unique.id), null, "a failed create left state behind");
    });

    await test("an unmatched city falls back to RECRUITEE_LOCATION_ID", async () => {
      const pune = { ...job, id: "pune-role", title: "Pune Role", location: "Pune" };
      const out = await syncRecruiteeJob(pune, { dryRun: false });
      assert.equal(out.action, "create");
      const post = writes().find((c) => c.method === "POST");
      const offer = post?.body.offer as { location_ids: number[] };
      assert.deepEqual(offer.location_ids, [999], "fallback location id not used");
    });

    // Job.salaryMin/salaryMax are an internal budget, never shown to a
    // candidate, so no board payload may contain them. This is checked against a
    // real create rather than by inspection because the leak would be in
    // offerPayload, which is the one place a field could slip in unnoticed.
    await test("never sends the internal salary in the payload", async () => {
      const paid = { ...job, id: "paid-role", title: "Paid Role", salaryMin: 5, salaryMax: 8 };
      await syncRecruiteeJob(paid, { dryRun: false });
      const sent = writes();
      assert.ok(sent.length > 0, "nothing was sent in this run");
      for (const call of sent) {
        assert.ok(
          !/salary|compensation|\bLPA\b/i.test(JSON.stringify(call.body)),
          `salary appeared in the ${call.method} ${call.path} payload`,
        );
      }
    });

    done();
  } finally {
    server.close();
    if (backup === null) {
      await fs.rm(stateFile, { force: true });
    } else {
      await fs.writeFile(stateFile, backup);
    }
    await fs.rm(`${stateFile}.tmp`, { force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
