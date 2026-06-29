"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { tempDir, writeFile } = require("./helpers/cli");
const { processPublishQueue } = require("../lib/publish-processor");

test("publish queue processor logs skips and processes jobs correctly", () => {
  const root = tempDir("meta-harness-publish-processor-");
  const localDir = path.join(root, ".meta-harness", "local");
  fs.mkdirSync(localDir, { recursive: true });
  
  const initialJob = {
    job_id: "job_test_123",
    repo: "meta-harness",
    branch: "main",
    base_sha: "54cd68a94645fca3939c2652ddc634bfb9460368",
    commit_sha: "19ddca2415dda76c7f2aeeacad85d395580bda20",
    tests: "passed",
    status: "queued",
    created_at: new Date().toISOString(),
  };
  
  fs.writeFileSync(path.join(localDir, "publish-queue.jsonl"), JSON.stringify(initialJob) + "\n", "utf8");
  
  const result = processPublishQueue(root, { dryRun: true });
  
  assert.ok(result.processed >= 0);
  
  const content = fs.readFileSync(path.join(localDir, "publish-queue.jsonl"), "utf8");
  const line = content.split("\n").filter(Boolean)[0];
  const processedJob = JSON.parse(line);
  
  assert.equal(processedJob.job_id, "job_test_123");
  assert.equal(processedJob.status, "failed");
  assert.match(processedJob.error, /Commit SHA does not exist locally|git/);
});
