// File storage for resumes, answer videos, snapshots and screen recordings.
// S3-compatible bucket (Cloudflare R2, AWS S3, Supabase, Railway…) when S3_BUCKET is set; otherwise the local
// DATA_DIR folder. Keys are the same in both ("resumes/<file>", "videos/<candidateId>/<file>"), so moving
// from local disk to a bucket is a straight copy (scripts/migrate-to-cloud.mjs).
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

export const resumeKey = (storedAs: string) => `resumes/${storedAs}`;
export const mediaKey = (candidateId: string, file: string) => `videos/${candidateId}/${file}`;
export const mediaPrefix = (candidateId: string) => `videos/${candidateId}/`;

export interface FileRange {
  start: number;
  end: number;
}

interface Driver {
  put(key: string, data: Buffer, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  size(key: string): Promise<number>;
  /** Streams the whole file, or the inclusive byte range. */
  stream(key: string, range?: FileRange): Promise<ReadableStream>;
  remove(keys: string[]): Promise<void>;
  removePrefix(prefix: string): Promise<void>;
}

// ---------- Local folder ----------
const DATA_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR || "data");
const local = (key: string) => {
  const p = path.join(/*turbopackIgnore: true*/ DATA_DIR, key);
  if (!p.startsWith(DATA_DIR + path.sep)) throw new Error(`Invalid file key: ${key}`);
  return p;
};

const localDriver: Driver = {
  async put(key, data) {
    await fs.mkdir(path.dirname(local(key)), { recursive: true });
    await fs.writeFile(local(key), data);
  },
  get: (key) => fs.readFile(local(key)),
  size: async (key) => (await fs.stat(local(key))).size,
  stream: async (key, range) => Readable.toWeb(createReadStream(local(key), range)) as ReadableStream,
  async remove(keys) {
    await Promise.all(keys.map((k) => fs.rm(local(k), { force: true })));
  },
  async removePrefix(prefix) {
    await fs.rm(local(prefix), { recursive: true, force: true });
  },
};

// ---------- S3-compatible bucket ----------
function s3Driver(bucket: string): Driver {
  const client = new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    // Newer AWS SDKs add CRC checksums to every request, which Backblaze B2 and Cloudflare R2 reject.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
    },
  });
  return {
    async put(key, data, contentType) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: data, ContentType: contentType }));
    },
    async get(key) {
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return Buffer.from(await res.Body!.transformToByteArray());
    },
    async size(key) {
      const res = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return res.ContentLength ?? 0;
    },
    async stream(key, range) {
      const res = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key, Range: range && `bytes=${range.start}-${range.end}` }),
      );
      return res.Body!.transformToWebStream();
    },
    async remove(keys) {
      if (!keys.length) return;
      await client.send(
        new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } }),
      );
    },
    async removePrefix(prefix) {
      let token: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
        );
        await this.remove((page.Contents ?? []).map((o) => o.Key!).filter(Boolean));
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
    },
  };
}

export interface FilePart {
  key: string;
  size: number;
}

/** Streams the inclusive byte range of several stored files played back to back as one (screen-recording chunks). */
export function streamParts(parts: FilePart[], { start, end }: FileRange): ReadableStream<Uint8Array> {
  async function* chunks() {
    let offset = 0;
    for (const part of parts) {
      const partStart = offset;
      const partEnd = offset + part.size - 1;
      offset += part.size;
      if (partEnd < start || partStart > end || part.size === 0) continue;
      const stream = await files.stream(part.key, {
        start: Math.max(start, partStart) - partStart,
        end: Math.min(end, partEnd) - partStart,
      });
      const reader = stream.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        yield value as Uint8Array;
      }
    }
  }
  const it = chunks();
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await it.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    async cancel() {
      await it.return(undefined);
    },
  });
}

const bucket = process.env.S3_BUCKET?.trim();
export const files: Driver = bucket ? s3Driver(bucket) : localDriver;
/** The local folder, whatever is configured (used by the migration script). */
export const localFiles = { driver: localDriver, root: DATA_DIR };
export const fileStorageLabel = bucket ? `S3 bucket "${bucket}"` : `local folder ${DATA_DIR}`;
