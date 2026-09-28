/**
 * Discover and run every `*.test.ts` in the repository.
 *
 * Discovery is the point. Each test file is a standalone script, so the set of
 * tests that actually run used to be a hand-maintained list in package.json -
 * a new file that nobody remembered to add there would never run, and nothing
 * would say so. Now `npm test` finds them all.
 *
 * Each file runs in its own process. They are not isolated from each other
 * otherwise: several read the real config module, which snapshots `process.env`
 * at import time, so a file that changes the environment for its own benefit
 * would leak that into whatever ran next in the same process.
 *
 *   npm test
 */
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "data"]);

/** Every `*.test.ts` under the repo, ignoring build and dependency output. */
async function findTestFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await findTestFiles(full)));
    } else if (entry.name.endsWith(".test.ts")) {
      found.push(full);
    }
  }
  return found.sort();
}

function run(file: string): Promise<number> {
  const relative = path.relative(ROOT, file);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--env-file-if-exists=.env", "--import", "tsx", file], {
      cwd: ROOT,
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", (error) => {
      console.error(`Could not run ${relative}: ${error.message}`);
      resolve(1);
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function main() {
  // An argument filters by substring, so `npm test -- notify` runs one file
  // without anyone having to maintain a script per test file.
  const filter = process.argv[2];
  const all = await findTestFiles(ROOT);
  const files = filter ? all.filter((f) => f.includes(filter)) : all;

  if (!files.length) {
    console.log(filter ? `No test file matches "${filter}".` : "No test files found.");
    if (filter) process.exitCode = 1;
    return;
  }

  console.log(`Running ${files.length} test file(s)\n`);
  const failed: string[] = [];
  for (const file of files) {
    console.log(`── ${path.relative(ROOT, file)}`);
    if ((await run(file)) !== 0) failed.push(path.relative(ROOT, file));
    console.log("");
  }

  if (failed.length) {
    console.error(`${failed.length} test file(s) failed:\n  ${failed.join("\n  ")}`);
    process.exitCode = 1;
  } else {
    console.log(`All ${files.length} test file(s) passed.`);
  }
}

// Not `await main()`: package.json sets no `"type": "module"`, so tsx compiles
// this to CJS, where top-level await is a syntax error. The test files live
// under the same constraint, which is why recruitee.test.ts also wraps
// everything in a function.
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
