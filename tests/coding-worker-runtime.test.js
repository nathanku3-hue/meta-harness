"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  codingArgs,
  resolveCodingWorker,
  windowsPathToWsl,
  wslPathToWindows,
} = require("../lib/coding-worker");

test("WSL worker paths translate to native Windows paths", () => {
  assert.equal(wslPathToWindows("/mnt/e/Code/repo/file.json"), "E:\\Code\\repo\\file.json");
  assert.equal(wslPathToWindows("E:\\Code\\repo"), null);
  assert.equal(windowsPathToWsl("D:\\nodejs\\node.exe"), "/mnt/d/nodejs/node.exe");
  assert.equal(windowsPathToWsl("/mnt/d/nodejs/node.exe"), null);

  const args = codingArgs({
    workspacePath: "/mnt/e/Code/repo",
    schemaPath: "/mnt/e/Code/repo/.git/schema.json",
    outputPath: "/mnt/e/Code/repo/.git/output.json",
    prompt: "Do the work.",
    pathStyle: "windows",
  });
  assert.deepEqual(args.slice(args.indexOf("-C"), args.indexOf("-C") + 2), ["-C", "E:\\Code\\repo"]);
  assert.ok(args.includes("E:\\Code\\repo\\.git\\schema.json"));
  assert.ok(args.includes("E:\\Code\\repo\\.git\\output.json"));
});

test("WSL resolves the existing Windows Codex launcher without installing another runtime", () => {
  const calls = [];
  const worker = resolveCodingWorker(
    { WSL_DISTRO_NAME: "Ubuntu" },
    "linux",
    (executable, args) => {
      calls.push({ executable, args });
      if (executable === "where.exe" && args[0] === "node") {
        return { status: 0, stdout: "D:\\nodejs\\node.exe\r\n", stderr: "" };
      }
      if (executable === "where.exe" && args[0] === "codex.cmd") {
        return { status: 0, stdout: "C:\\Users\\Lenovo\\AppData\\Roaming\\npm\\codex.cmd\r\n", stderr: "" };
      }
      return { status: 0, stdout: "codex-cli 0.144.1\n", stderr: "" };
    },
  );

  assert.deepEqual(calls, [
    { executable: "where.exe", args: ["node"] },
    { executable: "where.exe", args: ["codex.cmd"] },
    {
      executable: "/mnt/d/nodejs/node.exe",
      args: ["C:\\Users\\Lenovo\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js", "--version"],
    },
  ]);
  assert.equal(worker.executable, "/mnt/d/nodejs/node.exe");
  assert.deepEqual(worker.prefixArgs, [
    "C:\\Users\\Lenovo\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js",
  ]);
  assert.equal(worker.pathStyle, "windows");
});

test("native Linux retains the native Codex command", () => {
  const worker = resolveCodingWorker({}, "linux", () => {
    throw new Error("native Linux must not probe Windows Codex");
  });
  assert.deepEqual(worker, {
    executable: "codex",
    prefixArgs: [],
    identity: "codex-cli",
    pathStyle: "native",
  });
});
