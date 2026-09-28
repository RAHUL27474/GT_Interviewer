// Node side of the Python screening bridge.
//
// `scripts/screening_bridge.py` wraps the sentence-transformer model in
// `src/resume_screening`. That model costs several seconds to load, so the
// bridge is kept resident and reused rather than spawned per request.
//
// The bridge is an *enhancement*, never a hard dependency. If the interpreter,
// the venv or the bridge script is missing, or the process dies, every call
// here resolves to `null` and `lib/screening.ts` falls back to the LLM
// screener. A candidate must never be blocked from applying because a local
// model is not installed.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { config } from "./config";
import type { ScreeningEngine } from "./types";

/** Raw shape returned by the bridge's `screen` op. */
interface BridgeScreenResult {
  summary: string;
  scores: Record<string, number>;
  requiredSkills: string[];
  matchedSkills: string[];
  missingSkills: string[];
  bonusSkills: string[];
  strengths: string[];
  gaps: string[];
  candidate: Record<string, unknown>;
  jobRequirements: { minExperienceYears: number | null; degrees: string[] };
  extractionMethod: string;
  status: string;
  recommendedNextStep: string;
  engineNotes: string[];
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

interface Bridge {
  child: ChildProcessWithoutNullStreams;
  pending: Map<string, Pending>;
  ready: boolean;
  buffer: string;
  stderrTail: string[];
  nextId: number;
}

const g = globalThis as typeof globalThis & { __screeningBridge?: Bridge | null };

/** The model prints startup and progress noise; keep only the tail for errors. */
const STDERR_TAIL_LINES = 20;

/** Resolve the interpreter: the project's own venv first, then whatever is on PATH. */
function resolvePython(): { command: string; args: string[] } {
  if (config.screeningBridgePython) {
    return { command: config.screeningBridgePython, args: [] };
  }
  // The venv lives one level above this app, beside src/resume_screening.
  const repoRoot = path.resolve(process.cwd(), "..");
  const candidates = [
    path.join(repoRoot, ".venv", "Scripts", "python.exe"),
    path.join(repoRoot, ".venv", "bin", "python"),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found) return { command: found, args: [] };
  return { command: process.platform === "win32" ? "python" : "python3", args: [] };
}

function bridgeScriptPath(): string {
  return path.join(process.cwd(), "scripts", "screening_bridge.py");
}

/** Fail every in-flight request and drop the handle so the next call respawns. */
function teardown(bridge: Bridge, reason: string) {
  bridge.ready = false;
  for (const [id, pending] of bridge.pending) {
    clearTimeout(pending.timer);
    pending.reject(new Error(reason));
    bridge.pending.delete(id);
  }
  if (g.__screeningBridge === bridge) g.__screeningBridge = null;
  try {
    if (!bridge.child.killed) bridge.child.kill();
  } catch {
    // Already gone.
  }
}

function spawnBridge(): Bridge {
  const script = bridgeScriptPath();
  if (!existsSync(script)) {
    throw new Error(`Screening bridge script not found at ${script}`);
  }
  const { command, args } = resolvePython();
  const child = spawn(command, [...args, script], {
    cwd: path.resolve(process.cwd(), ".."),
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
    windowsHide: true,
  }) as ChildProcessWithoutNullStreams;

  const bridge: Bridge = {
    child,
    pending: new Map(),
    ready: false,
    buffer: "",
    stderrTail: [],
    nextId: 0,
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    bridge.buffer += chunk;
    let newline = bridge.buffer.indexOf("\n");
    while (newline !== -1) {
      const line = bridge.buffer.slice(0, newline).trim();
      bridge.buffer = bridge.buffer.slice(newline + 1);
      if (line) handleLine(bridge, line);
      newline = bridge.buffer.indexOf("\n");
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    for (const line of chunk.split("\n")) {
      if (!line.trim()) continue;
      bridge.stderrTail.push(line);
      if (bridge.stderrTail.length > STDERR_TAIL_LINES) bridge.stderrTail.shift();
    }
  });

  child.on("error", (error) => teardown(bridge, `Screening bridge failed to start: ${error.message}`));
  child.on("exit", (code, signal) =>
    teardown(bridge, `Screening bridge exited (code ${code}, signal ${signal})`),
  );

  return bridge;
}

function handleLine(bridge: Bridge, line: string) {
  let message: { id?: string; ok?: boolean; result?: unknown; error?: string };
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const id = message.id;
  if (!id) return;
  const pending = bridge.pending.get(id);
  if (!pending) return;
  bridge.pending.delete(id);
  clearTimeout(pending.timer);
  if (message.ok) pending.resolve(message.result);
  else pending.reject(new Error(message.error ?? "Screening bridge reported a failure"));
}

/** Get the resident bridge, starting it on first use. Null when unavailable. */
function getBridge(): Bridge | null {
  if (!config.screeningBridgeEnabled) return null;
  if (g.__screeningBridge) return g.__screeningBridge;
  try {
    g.__screeningBridge = spawnBridge();
    return g.__screeningBridge;
  } catch (error) {
    console.warn(
      `[screening] Python bridge unavailable (${error instanceof Error ? error.message : String(error)}). ` +
        "Falling back to the LLM screener. See .env.example SCREENING_BRIDGE_*.",
    );
    g.__screeningBridge = null;
    return null;
  }
}

/** Send one op to the bridge and await its reply. Rejects on timeout or failure. */
function request<T>(payload: Record<string, unknown>): Promise<T> {
  const bridge = getBridge();
  if (!bridge) return Promise.reject(new Error("Screening bridge is not available"));

  const id = String(++bridge.nextId);
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      bridge.pending.delete(id);
      // A stuck bridge will not recover on its own, so recycle it.
      teardown(bridge, `Screening bridge timed out after ${config.screeningBridgeTimeoutMs}ms`);
      reject(new Error(`Screening bridge timed out after ${config.screeningBridgeTimeoutMs}ms`));
    }, config.screeningBridgeTimeoutMs);

    bridge.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
    bridge.child.stdin.write(`${JSON.stringify({ id, ...payload })}\n`, (error) => {
      if (!error) return;
      clearTimeout(timer);
      bridge.pending.delete(id);
      reject(new Error(`Could not write to the screening bridge: ${error.message}`));
    });
  });
}

export interface BridgeScreenInput {
  resume: Buffer;
  filename: string;
  jobDescription: string;
  shortlistThreshold: number;
  reviewThreshold: number;
}

export interface BridgeScreenOutput {
  summary: string;
  scores: BridgeScreenResult["scores"];
  requiredSkills: string[];
  matchedSkills: string[];
  missingSkills: string[];
  bonusSkills: string[];
  strengths: string[];
  gaps: string[];
  candidate: BridgeScreenResult["candidate"];
  jobRequirements: BridgeScreenResult["jobRequirements"];
  extractionMethod: string;
  status: string;
  recommendedNextStep: string;
  engineNotes: string[];
  engine: ScreeningEngine;
}

/**
 * Score one resume against a job description with the Python model.
 * Resolves to null when the bridge is unavailable, so callers can fall back.
 */
export async function screenWithBridge(input: BridgeScreenInput): Promise<BridgeScreenOutput | null> {
  try {
    const result = await request<BridgeScreenResult | { error: string }>({
      op: "screen",
      resumeBase64: input.resume.toString("base64"),
      filename: input.filename,
      jobDescription: input.jobDescription,
      shortlistThreshold: input.shortlistThreshold,
      reviewThreshold: input.reviewThreshold,
    });

    if ("error" in result) {
      // RESUME_UNPARSEABLE is a verdict about the resume, not a bridge failure,
      // so it is reported rather than silently retried with the LLM.
      if (result.error === "RESUME_UNPARSEABLE") return null;
      console.warn(`[screening] bridge returned ${result.error}; falling back to the LLM screener.`);
      return null;
    }
    return { ...result, engine: "bridge" };
  } catch (error) {
    console.warn(
      `[screening] ${error instanceof Error ? error.message : String(error)}. Falling back to the LLM screener.`,
    );
    return null;
  }
}

/** Warm the model up so the first real screening does not pay the load cost. */
export async function warmScreeningBridge(): Promise<boolean> {
  if (!config.screeningBridgeEnabled) return false;
  try {
    await request({ op: "ping" });
    return true;
  } catch (error) {
    console.warn(
      `[screening] bridge warm-up skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

/** Stop the resident bridge. Used by the standalone worker on shutdown. */
export function disposeScreeningBridge(): void {
  const bridge = g.__screeningBridge;
  if (!bridge) return;
  try {
    bridge.child.stdin.write(`${JSON.stringify({ id: "shutdown", op: "quit" })}\n`);
  } catch {
    // The process may already be closing; fall through to the kill below.
  }
  teardown(bridge, "Screening bridge shut down");
}
