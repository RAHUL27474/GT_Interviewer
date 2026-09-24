import fs from "node:fs/promises";
import path from "node:path";
import { requireAdmin } from "@/lib/auth";
import { handler, HttpError } from "@/lib/http";
import { RESUME_DIR, store } from "@/lib/store";

const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain; charset=utf-8",
};

export const GET = handler(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const c = await store.getCandidate((await ctx.params).id);
  if (!c) throw new HttpError(404, "Candidate not found.");
  const data = await fs.readFile(path.join(RESUME_DIR, c.resume.storedAs));
  return new Response(data, {
    headers: {
      "Content-Type": MIME[path.extname(c.resume.storedAs)] ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(c.resume.fileName)}`,
    },
  });
});
