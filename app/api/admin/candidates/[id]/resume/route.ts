import path from "node:path";
import { requireStaff } from "@/lib/auth";
import { files, resumeKey } from "@/lib/files";
import { handler, HttpError } from "@/lib/http";
import { store } from "@/lib/store";

const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain; charset=utf-8",
};

export const GET = handler(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireStaff();
  const c = await store.getCandidate((await ctx.params).id);
  if (!c) throw new HttpError(404, "Candidate not found.");
  const resume = c.resume;
  if (!resume) throw new HttpError(404, c.resumeProblem ?? "This candidate has no resume file.");
  const data = await files.get(resumeKey(resume.storedAs)).catch(() => {
    throw new HttpError(404, "Resume file not found.");
  });
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": MIME[path.extname(resume.storedAs)] ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(resume.fileName)}`,
    },
  });
});
