// Downloads the resume from the link an applicant pasted into the Google Form.
// The link comes from the public, so: https only, never an internal or private address (checked again on
// every redirect), a size limit and a timeout.
import dns from "node:dns/promises";
import net from "node:net";
import { config } from "./config";

export interface FetchedResume {
  buffer: Buffer;
  ext: ".pdf" | ".docx" | ".txt";
  fileName: string;
}

export class ResumeLinkError extends Error {}

/** Turns Google Drive / Docs sharing links into direct download links; other links are used as they are. */
export function downloadUrl(link: string): string {
  const url = new URL(link.trim());
  const host = url.hostname;
  if (host === "drive.google.com") {
    const id = url.pathname.match(/\/file\/d\/([\w-]+)/)?.[1] ?? url.searchParams.get("id");
    if (id) return `https://drive.google.com/uc?export=download&id=${id}`;
  }
  if (host === "docs.google.com") {
    const doc = url.pathname.match(/\/document\/d\/([\w-]+)/)?.[1];
    if (doc) return `https://docs.google.com/document/d/${doc}/export?format=pdf`;
  }
  return url.toString();
}

/** True for loopback, private, link-local and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
}

async function assertPublicHost(url: URL) {
  if (url.protocol !== "https:") throw new ResumeLinkError("The resume link must start with https://");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new ResumeLinkError("The resume link points to a private address.");
}

function detectType(buf: Buffer, contentType: string): FetchedResume["ext"] | null {
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return ".pdf";
  // DOCX files are zip archives.
  if (buf[0] === 0x50 && buf[1] === 0x4b) return ".docx";
  if (contentType.startsWith("text/plain")) return ".txt";
  return null;
}

/** Downloads and checks the resume. Throws ResumeLinkError with a reason HR can read. */
export async function fetchResume(link: string): Promise<FetchedResume> {
  let url: URL;
  try {
    url = new URL(downloadUrl(link));
  } catch {
    throw new ResumeLinkError("The resume link isn't a valid web address.");
  }

  let res: Response | null = null;
  for (let hop = 0; hop < 5; hop++) {
    await assertPublicHost(url);
    res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20_000) }).catch((err) => {
      throw new ResumeLinkError(`The resume link couldn't be opened (${err instanceof Error ? err.message : err}).`);
    });
    const next = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && next) {
      url = new URL(next, url);
      continue;
    }
    break;
  }
  if (!res || (res.status >= 300 && res.status < 400)) throw new ResumeLinkError("The resume link redirects too many times.");
  if (!res.ok) throw new ResumeLinkError(`The resume link returned an error (HTTP ${res.status}); it may not be shared publicly.`);
  if (Number(res.headers.get("content-length") || 0) > config.maxResumeBytes) throw new ResumeLinkError("The resume is larger than 5 MB.");

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > config.maxResumeBytes) throw new ResumeLinkError("The resume is larger than 5 MB.");
  const ext = detectType(buffer, res.headers.get("content-type") ?? "");
  if (!ext) {
    throw new ResumeLinkError(
      'The resume link opened a web page, not a PDF or Word file. It is probably not shared as "Anyone with the link".',
    );
  }
  const disposition = res.headers.get("content-disposition") ?? "";
  const named = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1] ?? disposition.match(/filename="?([^";]+)"?/i)?.[1];
  const fileName = named ? decodeURIComponent(named) : `resume${ext}`;
  return { buffer, ext, fileName };
}
