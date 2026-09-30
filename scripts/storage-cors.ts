// Lets browsers upload answer videos straight to the storage bucket (Backblaze B2, R2, S3) from the app's address.
// Run once after creating the bucket, and again if APP_URL changes:  npm run storage:cors
// Extra origins (e.g. http://localhost:3000 for local testing) can be listed as arguments.
import { GetBucketCorsCommand, PutBucketCorsCommand, S3Client } from "@aws-sdk/client-s3";

const bucket = process.env.S3_BUCKET?.trim();
if (!bucket) throw new Error("S3_BUCKET is not set in .env");
const origins = [process.env.APP_URL, ...process.argv.slice(2)]
  .map((o) => o?.trim().replace(/\/+$/, ""))
  .filter((o): o is string => Boolean(o));
if (!origins.length) throw new Error("Set APP_URL in .env (or pass origins as arguments)");

const client = new S3Client({
  region: process.env.S3_REGION || "auto",
  endpoint: process.env.S3_ENDPOINT || undefined,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID || "", secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "" },
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

async function main() {
  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: origins,
            AllowedMethods: ["PUT"],
            AllowedHeaders: ["content-type"],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  );
  const check = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
  console.log(`Bucket "${bucket}" now accepts video uploads from: ${check.CORSRules?.flatMap((r) => r.AllowedOrigins).join(", ")}`);
}

main().catch((err) => {
  console.error("Setting CORS failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
