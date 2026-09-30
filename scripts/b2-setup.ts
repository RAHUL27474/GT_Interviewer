// One-time Backblaze B2 setup: creates a private bucket that accepts browser video uploads from the app, and an
// application key limited to that bucket, then writes the S3_* settings into .env and removes the setup key.
//   1. Backblaze -> Application Keys -> "Generate New Master Application Key" (or a key with access to all buckets)
//   2. Put it in .env as B2_SETUP_KEY_ID=... and B2_SETUP_APP_KEY=...
//   3. npm run b2:setup
import crypto from "node:crypto";
import fs from "node:fs";

const API = "https://api.backblazeb2.com/b2api/v3";

async function b2<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as T & { message?: string; code?: string };
  if (!res.ok) throw new Error(`${data.code ?? res.status}: ${data.message ?? "Backblaze request failed"}`);
  return data;
}

async function main() {
  const keyId = process.env.B2_SETUP_KEY_ID?.trim();
  const appKey = process.env.B2_SETUP_APP_KEY?.trim();
  if (!keyId || !appKey) throw new Error("Put B2_SETUP_KEY_ID and B2_SETUP_APP_KEY in .env first.");
  if (process.env.S3_BUCKET?.trim()) throw new Error(`S3_BUCKET is already set (${process.env.S3_BUCKET}); nothing to do.`);

  const auth = await b2<{
    accountId: string;
    authorizationToken: string;
    apiInfo: { storageApi: { apiUrl: string; s3ApiUrl: string } };
  }>(`${API}/b2_authorize_account`, {
    headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${appKey}`).toString("base64")}` },
  });
  const { apiUrl, s3ApiUrl } = auth.apiInfo.storageApi;
  const call = <T>(name: string, body: object) =>
    b2<T>(`${apiUrl}/b2api/v3/${name}`, {
      method: "POST",
      headers: { Authorization: auth.authorizationToken, "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: auth.accountId, ...body }),
    });

  const origins = [process.env.APP_URL?.replace(/\/+$/, ""), "http://localhost:3000"].filter(Boolean) as string[];
  const bucketName = `gt-interviewer-${crypto.randomBytes(4).toString("hex")}`;
  const bucket = await call<{ bucketId: string; bucketName: string }>("b2_create_bucket", {
    bucketName,
    bucketType: "allPrivate",
    // Browsers PUT answer videos straight to the bucket through signed S3 links.
    corsRules: [
      {
        corsRuleName: "videoUploads",
        allowedOrigins: origins,
        allowedOperations: ["s3_put"],
        allowedHeaders: ["content-type"],
        maxAgeSeconds: 3600,
      },
    ],
  });
  console.log(`Created private bucket ${bucket.bucketName}`);

  const key = await call<{ applicationKeyId: string; applicationKey: string }>("b2_create_key", {
    keyName: `${bucketName}-app`,
    bucketId: bucket.bucketId,
    capabilities: ["listBuckets", "listFiles", "readFiles", "writeFiles", "deleteFiles"],
  });
  console.log("Created an application key limited to that bucket");

  const endpoint = s3ApiUrl.replace(/\/+$/, "");
  const region = new URL(endpoint).hostname.split(".")[1];
  const settings: Record<string, string> = {
    S3_BUCKET: bucket.bucketName,
    S3_ENDPOINT: endpoint,
    S3_ACCESS_KEY_ID: key.applicationKeyId,
    S3_SECRET_ACCESS_KEY: key.applicationKey,
    S3_REGION: region,
  };
  let env = fs.readFileSync(".env", "utf8");
  for (const [k, v] of Object.entries(settings)) {
    env = new RegExp(`^${k}=.*$`, "m").test(env) ? env.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`) : `${env.trimEnd()}\n${k}=${v}\n`;
  }
  // The all-access setup key isn't needed any more; the app only uses the bucket key.
  env = env.replace(/^B2_SETUP_(KEY_ID|APP_KEY)=.*\r?\n?/gm, "");
  fs.writeFileSync(".env", env);
  console.log(`Wrote S3_BUCKET, S3_ENDPOINT (${endpoint}), S3_REGION (${region}) and the bucket key to .env; removed the setup key.`);
  console.log(`Browser uploads allowed from: ${origins.join(", ")}`);
}

main().catch((err) => {
  console.error("B2 setup failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
