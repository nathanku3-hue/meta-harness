#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const testsRoot = path.join(root, "tests");
const SERIAL_TEST = /(?:^|\/)(?:cli-expert-packet|cli-ready|cli-ready-repro|judge|release-check|release-check-evidence|runtime-execution-custody(?:-devspace-live|-live|-process-tree)?)\.test\.js$/;
const LINUX_EXECUTION_TEST = /(?:^|\/)(?:cli-work|repo-decision-plane|work-loop)\.test\.js$/;
const DEFAULT_CONCURRENCY = Math.max(1, Math.min(3, os.availableParallelism ? os.availableParallelism() : os.cpus().length || 2));
const PARALLEL_CONCURRENCY = positiveInteger(process.env.META_HARNESS_TEST_CONCURRENCY, DEFAULT_CONCURRENCY);
const FILE_TIMEOUT_MS = positiveInteger(process.env.META_HARNESS_TEST_FILE_TIMEOUT_MS, 240_000);

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toSlash(value) {
  return String(value).split(path.sep).join("/");
}

function collectTests(directory, out = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectTests(fullPath, out);
    } else if (entry.isFile() && entry.name.endsWith(".test.js")) {
      out.push(fullPath);
    }
  }
  return out.sort((left, right) => left.localeCompare(right));
}

function dotReporterCounts(stdout) {
  let tests = 0;
  let failedTests = 0;
  for (const line of String(stdout || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!/^[.X]+$/.test(trimmed)) continue;
    tests += trimmed.length;
    failedTests += [...trimmed].filter((entry) => entry === "X").length;
  }
  return { tests, failedTests };
}

function runFile(testFile) {
  const relative = toSlash(path.relative(root, testFile));
  const args = ["--test", "--test-reporter=dot"];
  if (SERIAL_TEST.test(relative)) args.push("--test-concurrency=1");
  args.push(testFile);

  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = spawn(process.execPath, args, {
      cwd: root,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, META_HARNESS_INTERNAL_CLI: "1" },
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 2_000).unref();
    }, FILE_TIMEOUT_MS);
    timer.unref();

    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        file: relative,
        status: 1,
        signal: null,
        elapsedMs: Date.now() - started,
        stdout,
        stderr,
        error,
        timedOut,
        ...dotReporterCounts(stdout),
      });
    });
    child.on("exit", (status, signal) => {
      clearTimeout(timer);
      resolve({
        file: relative,
        status: status === null ? 1 : status,
        signal,
        elapsedMs: Date.now() - started,
        stdout,
        stderr,
        timedOut,
        ...dotReporterCounts(stdout),
      });
    });
  });
}

function printResult(result) {
  const elapsed = `${(result.elapsedMs / 1000).toFixed(1)}s`;
  const status = result.status === 0 && !result.timedOut ? "pass" : result.timedOut ? "timeout" : "fail";
  console.error(`# ${status} ${result.file} (${elapsed})`);
  if (result.stdout.trim()) process.stdout.write(result.stdout.endsWith("\n") ? result.stdout : `${result.stdout}\n`);
  if (result.stderr.trim()) process.stderr.write(result.stderr.endsWith("\n") ? result.stderr : `${result.stderr}\n`);
  if (result.error) console.error(`# error ${result.file}: ${result.error.message}`);
  if (result.signal) console.error(`# signal ${result.file}: ${result.signal}`);
}

async function runPool(files, concurrency) {
  const pending = [...files];
  const results = [];
  async function worker() {
    while (pending.length > 0) {
      const next = pending.shift();
      const result = await runFile(next);
      results.push(result);
      printResult(result);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));
  return results;
}

async function runSerial(files) {
  const results = [];
  for (const testFile of files) {
    const result = await runFile(testFile);
    results.push(result);
    printResult(result);
  }
  return results;
}

async function main() {
  const discovered = collectTests(testsRoot);
  const platformSkipped = process.platform === "linux"
    ? []
    : discovered.filter((file) => LINUX_EXECUTION_TEST.test(toSlash(path.relative(root, file))));
  const tests = discovered.filter((file) => !platformSkipped.includes(file));
  const serialTests = tests.filter((file) => SERIAL_TEST.test(toSlash(path.relative(root, file))));
  const parallelTests = tests.filter((file) => !SERIAL_TEST.test(toSlash(path.relative(root, file))));
  const started = Date.now();
  const results = [];

  if (platformSkipped.length > 0) {
    console.error(`# platform-skipped execution test files: ${platformSkipped.length} (v6 work requires Linux namespaces)`);
  }
  if (parallelTests.length > 0) {
    console.error(`# parallel test files: ${parallelTests.length} (concurrency ${PARALLEL_CONCURRENCY})`);
    results.push(...await runPool(parallelTests, PARALLEL_CONCURRENCY));
  }
  if (serialTests.length > 0) {
    console.error(`# serial test files: ${serialTests.length}`);
    results.push(...await runSerial(serialTests));
  }
  const failed = results.filter((result) => result.status !== 0 || result.timedOut || result.error);
  const testCount = results.reduce((sum, result) => sum + (result.tests || 0), 0);
  const failedTestCount = results.reduce((sum, result) => sum + (result.failedTests || 0), 0);
  console.error(
    `# test files: ${results.length}; failed files: ${failed.length}; tests: ${testCount}; failed tests: ${failedTestCount}; duration: ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
  process.exitCode = failed.length > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
