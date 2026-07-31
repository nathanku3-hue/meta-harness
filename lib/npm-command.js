"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function npmInvocation(args) {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter(Boolean);
  const npmExecPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (npmExecPath) return { command: process.execPath, args: [npmExecPath, ...args] };
  return { command: process.platform === "win32" ? "npm.cmd" : "npm", args };
}

function runNpm(args, options = {}) {
  const invocation = npmInvocation(args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: "utf8",
    shell: process.platform === "win32" && invocation.command === "npm.cmd",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: options.timeout || 60_000,
    maxBuffer: options.maxBuffer || 20 * 1024 * 1024,
  });
  return { ...result, command: invocation.command, args: invocation.args };
}

function commandSummary(result) {
  const stderr = String(result.stderr || "").trim();
  const stdout = String(result.stdout || "").trim();
  return stderr || stdout || result.error?.message || `exit ${result.status}`;
}

module.exports = {
  commandSummary,
  npmInvocation,
  runNpm,
};
