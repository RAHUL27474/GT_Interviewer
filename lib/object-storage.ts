import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { config } from "./config";

const DATA_DIR = path.join(process.cwd(), "data");
const globalS3 = globalThis as typeof globalThis & { __interviewerS3?: S3Client };

export const objectStorageEnabled = Boolean(config.objectStorageBucket);

function normalizeKey(key: string): string {
  const parts = key.replace(/\\/g, "/").split("/");
  if (key.startsWith("/") || parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("Invalid object storage key.");
  }
  return parts.join("/");
}

function s3(): S3Client {
  globalS3.__interviewerS3 ??= new S3Client({
    region: config.objectStorageRegion,
    ...(config.objectStorageEndpoint ? { endpoint: config.objectStorageEndpoint, forcePathStyle: true } : {}),
    ...(config.objectStorageAccessKey && config.objectStorageSecretKey
      ? { credentials: { accessKeyId: config.objectStorageAccessKey, secretAccessKey: config.objectStorageSecretKey } }
      : {}),
  });
  return globalS3.__interviewerS3;
}

function localPath(key: string): string {
  return path.join(DATA_DIR, ...normalizeKey(key).split("/"));
}

export async function writeStoredObject(key: string, data: Uint8Array): Promise<void> {
  const safeKey = normalizeKey(key);
  if (objectStorageEnabled) {
    await s3().send(new PutObjectCommand({ Bucket: config.objectStorageBucket, Key: safeKey, Body: data }));
    return;
  }
  const target = localPath(safeKey);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, data);
}

export async function readStoredObject(key: string): Promise<Buffer> {
  const safeKey = normalizeKey(key);
  if (objectStorageEnabled) {
    const response = await s3().send(new GetObjectCommand({ Bucket: config.objectStorageBucket, Key: safeKey }));
    if (!response.Body) throw new Error("Object storage returned an empty object body.");
    return Buffer.from(await response.Body.transformToByteArray());
  }
  return fs.readFile(localPath(safeKey));
}

export async function deleteStoredObject(key: string): Promise<void> {
  const safeKey = normalizeKey(key);
  if (objectStorageEnabled) {
    await s3().send(new DeleteObjectCommand({ Bucket: config.objectStorageBucket, Key: safeKey }));
    return;
  }
  await fs.rm(localPath(safeKey), { force: true });
}

export async function appendScreenChunk(candidateId: string, file: string, seq: number, data: Uint8Array): Promise<void> {
  const part = String(seq).padStart(8, "0");
  await writeStoredObject(`videos/${candidateId}/${file}.parts/${part}`, data);
}

export async function storedObjectSize(key: string): Promise<number> {
  const safeKey = normalizeKey(key);
  if (objectStorageEnabled) {
    const result = await s3().send(new HeadObjectCommand({ Bucket: config.objectStorageBucket, Key: safeKey }));
    if (result.ContentLength === undefined) throw new Error("Object storage did not return object size.");
    return result.ContentLength;
  }
  return (await fs.stat(localPath(safeKey))).size;
}

export async function openStoredObject(
  key: string,
  range?: { start: number; end: number },
): Promise<ReadableStream<Uint8Array>> {
  const safeKey = normalizeKey(key);
  if (objectStorageEnabled) {
    const response = await s3().send(new GetObjectCommand({
      Bucket: config.objectStorageBucket,
      Key: safeKey,
      ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
    }));
    if (!response.Body) throw new Error("Object storage returned an empty object body.");
    return response.Body.transformToWebStream();
  }
  const stream = createReadStream(localPath(safeKey), range);
  return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
}

export async function openScreenRecording(
  candidateId: string,
  file: string,
  chunkSizes: number[],
  start: number,
  end: number,
): Promise<ReadableStream<Uint8Array>> {
  const chunks = Readable.from((async function* () {
    let offset = 0;
    for (let index = 0; index < chunkSizes.length; index += 1) {
      const size = chunkSizes[index];
      const chunkStart = offset;
      const chunkEnd = offset + size - 1;
      offset += size;
      if (chunkEnd < start || chunkStart > end) continue;

      const data = await readStoredObject(
        `videos/${candidateId}/${file}.parts/${String(index).padStart(8, "0")}`,
      );
      const from = Math.max(0, start - chunkStart);
      const to = Math.min(size, end - chunkStart + 1);
      yield data.subarray(from, to);
    }
  })());
  return Readable.toWeb(chunks) as ReadableStream<Uint8Array>;
}