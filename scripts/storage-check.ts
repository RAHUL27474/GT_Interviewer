// Checks the configured file storage end to end: write, size, read, a signed browser upload (with the CORS check a
// browser would make from APP_URL), and delete. Leaves nothing behind.  npm run storage:check
import { directUploads, fileStorageLabel, files } from "../lib/files";

async function main() {
  console.log(`Storage: ${fileStorageLabel}`);
  const key = `healthcheck/${Date.now()}.txt`;
  const body = Buffer.from("storage check");

  await files.put(key, body, "text/plain");
  const size = await files.size(key);
  const back = (await files.get(key)).toString();
  console.log(`Write/read: ${size === body.length && back === "storage check" ? "OK" : "MISMATCH"}`);

  if (directUploads && files.presignPut) {
    const upKey = `healthcheck/${Date.now()}-upload.webm`;
    const url = await files.presignPut(upKey, "video/webm", 300);
    const origin = process.env.APP_URL?.replace(/\/+$/, "") || "http://localhost:3000";
    const preflight = await fetch(url, {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type" },
    });
    const allowed = preflight.headers.get("access-control-allow-origin");
    console.log(`Browser upload allowed from ${origin}: ${preflight.ok && (allowed === origin || allowed === "*") ? "OK" : `NO (${preflight.status}, allow-origin=${allowed})`}`);
    const put = await fetch(url, { method: "PUT", headers: { "Content-Type": "video/webm", Origin: origin }, body: new Uint8Array(1024) });
    console.log(`Signed upload: ${put.ok && (await files.size(upKey)) === 1024 ? "OK" : `FAILED (${put.status} ${await put.text()})`}`);
    await files.remove([upKey]);
  }

  await files.remove([key]);
  const gone = await files.size(key).then(() => false, () => true);
  console.log(`Delete: ${gone ? "OK" : "FAILED"}`);
}

main().catch((err) => {
  console.error("Storage check failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
