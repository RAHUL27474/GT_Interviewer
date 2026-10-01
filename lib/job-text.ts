// Reads a job description (plain text: UPPERCASE heading lines, "- " bullets, paragraphs) for display on the careers
// site. Pure functions, shared by server and browser.

export type Block = { kind: "heading"; text: string } | { kind: "list"; items: string[] } | { kind: "paragraph"; text: string };

const isHeading = (line: string) => line.length <= 60 && /[A-Z]/.test(line) && line === line.toUpperCase() && !/^[-*•]/.test(line);
const bullet = /^\s*[-*•]\s+/;

/** Splits a description into headings, bullet lists and paragraphs. */
export function parseDescription(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const last = blocks.at(-1);
    if (bullet.test(line)) {
      const item = line.replace(bullet, "");
      if (last?.kind === "list") last.items.push(item);
      else blocks.push({ kind: "list", items: [item] });
    } else if (isHeading(line)) {
      blocks.push({ kind: "heading", text: line.charAt(0) + line.slice(1).toLowerCase() });
    } else {
      blocks.push({ kind: "paragraph", text: line });
    }
  }
  return blocks;
}

/** The text under a heading (first line), e.g. section(blocks, "experience") -> "3–6 Years". */
function section(blocks: Block[], name: string): string | undefined {
  const i = blocks.findIndex((b) => b.kind === "heading" && b.text.toLowerCase() === name);
  const next = i >= 0 ? blocks[i + 1] : undefined;
  return next?.kind === "paragraph" ? next.text : undefined;
}

/** Short facts for the job card: type, experience, duration (when the description has those sections). */
export function jobFacts(text: string): string[] {
  const blocks = parseDescription(text);
  return [section(blocks, "job type"), section(blocks, "experience"), section(blocks, "duration")]
    .filter((x): x is string => Boolean(x))
    .map((x) => (x.length > 40 ? `${x.slice(0, 38)}…` : x));
}

/** A one- or two-sentence teaser: the first paragraph under "About the role", or the first real paragraph. */
export function jobSummary(text: string, max = 220): string {
  const blocks = parseDescription(text);
  const facts = new Set(["job type", "experience", "duration"]);
  const about = blocks.findIndex((b) => b.kind === "heading" && b.text.toLowerCase() === "about the role");
  let para = about >= 0 && blocks[about + 1]?.kind === "paragraph" ? (blocks[about + 1] as { text: string }).text : undefined;
  if (!para) {
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const prev = blocks[i - 1];
      if (b.kind === "paragraph" && !(prev?.kind === "heading" && facts.has(prev.text.toLowerCase()))) {
        para = b.text;
        break;
      }
    }
  }
  if (!para) return "";
  return para.length > max ? `${para.slice(0, max).replace(/\s+\S*$/, "")}…` : para;
}
