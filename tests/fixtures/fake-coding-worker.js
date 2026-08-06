"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const args = process.argv.slice(2);
function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

const workspace = option("-C");
const outputPath = option("-o");
const prompt = args.at(-1) || "";
if (!workspace || !outputPath) {
  process.stderr.write("fake worker missing -C or -o\n");
  process.exit(2);
}

const attempt = Number(prompt.match(/Attempt: (\d+) of/)?.[1] || "1");
const relativePath = process.env.FAKE_WORKER_PATH || "src/result.txt";
const content = process.env.FAKE_WORKER_RETRY === "1" && attempt === 1 ? "wrong\n" : "delivered\n";

if (process.env.FAKE_WORKER_DIRECT_WRITE === "1" || process.env.FAKE_WORKER_STAGE === "1") {
  const targetPath = path.join(workspace, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, "utf8");
  if (process.env.FAKE_WORKER_STAGE === "1") {
    spawnSync("git", ["add", relativePath], { cwd: workspace, encoding: "utf8" });
  }
}

const status = process.env.FAKE_WORKER_PARTIAL_FIRST === "1" && attempt === 1
  ? "partial"
  : process.env.FAKE_WORKER_STATUS || "done";
const result = {
  status,
  observableResult: `Prepared ${relativePath} on attempt ${attempt}.`,
  changes: status === "blocked" ? [] : [{ path: relativePath, content }],
  validation: ["fake worker completed"],
  blocker: process.env.FAKE_WORKER_BLOCKER || "",
  nextAction: process.env.FAKE_WORKER_NEXT || "Review and bank the delivered change.",
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(result)}\n`, "utf8");
