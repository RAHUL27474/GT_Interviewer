// A minimal test harness, shared by every `*.test.ts` file in this repo.
//
// There is no test-runner dependency, deliberately. The suite is small, runs in
// seconds, and each file is a plain script executed with `node --import tsx`.
// That keeps `npm test` working on a fresh clone with nothing but the existing
// devDependencies installed.
//
// `npm test` discovers `*.test.ts` automatically (see scripts/run-tests.ts), so
// a new test file starts running as soon as it is created, with no edit to
// package.json to remember.
//
// Two entry points, and the difference matters:
//   syncSuite  - for files whose tests are all synchronous. `test` runs the body
//                immediately and returns void.
//   suite      - for files with async tests. `test` returns a promise that must
//                be awaited.
// Mixing them is the bug this split exists to prevent: awaiting nothing in a
// sync file defers the `passed++` to a microtask, so the summary would print
// before the last few tests had even reported.
import assert from "node:assert/strict";

export type TestFn = () => void | Promise<void>;

/** Print a failure in a form that is useful without a stack trace. */
function report(name: string, error: unknown): void {
  process.exitCode = 1;
  console.error(`FAIL  ${name}`);
  console.error(`      ${error instanceof Error ? error.message : String(error)}`);
}

export interface AsyncSuite {
  /** Register an async test. The returned promise must be awaited. */
  test: (name: string, fn: TestFn) => Promise<void>;
  /** Print the summary. Returns true when everything passed. */
  done: () => boolean;
}

export interface SyncSuite {
  /** Run a synchronous test immediately. */
  test: (name: string, fn: () => void) => void;
  /** Print the summary. Returns true when everything passed. */
  done: () => boolean;
}

/**
 * A suite whose tests are all synchronous.
 *
 * Failures are collected rather than thrown, so one broken assertion does not
 * hide the rest of the file. `process.exitCode` is what `npm test` reads to
 * decide whether the run failed.
 */
export function syncSuite(name: string): SyncSuite {
  let passed = 0;
  const failures: string[] = [];

  const test = (testName: string, fn: () => void): void => {
    try {
      fn();
      passed++;
      console.log(`  ok  ${testName}`);
    } catch (error) {
      failures.push(testName);
      report(testName, error);
    }
  };

  const done = (): boolean => {
    if (failures.length) process.exitCode = 1;
    console.log(`\n${passed} passing, ${failures.length} failing  (${name})`);
    return failures.length === 0;
  };

  return { test, done };
}

/**
 * A suite with async tests. Await every `test` call, then call `done`.
 */
export function suite(name: string): AsyncSuite {
  let passed = 0;
  const failures: string[] = [];

  const test = async (testName: string, fn: TestFn): Promise<void> => {
    try {
      await fn();
      passed++;
      console.log(`  ok  ${testName}`);
    } catch (error) {
      failures.push(testName);
      report(testName, error);
    }
  };

  const done = (): boolean => {
    if (failures.length) process.exitCode = 1;
    console.log(`\n${passed} passing, ${failures.length} failing  (${name})`);
    return failures.length === 0;
  };

  return { test, done };
}

export { assert };
