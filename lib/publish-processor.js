"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function validateCommitExists(cwd, commitSha) {
  const result = spawnSync("git", ["cat-file", "-t", commitSha], {
    cwd,
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return result.status === 0 && result.stdout.trim() === "commit";
}

function checkCommitAlreadyOnRemote(cwd, commitSha) {
  const result = spawnSync("git", ["branch", "-r", "--contains", commitSha], {
    cwd,
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return result.status === 0 && result.stdout.trim().length > 0;
}

function runReadinessCheck(cwd) {
  const readyScript = path.resolve(cwd, "bin", "meta-harness.js");
  const result = spawnSync("node", [readyScript, "ready", "--target", ".", "--quick", "--json"], {
    cwd,
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  
  if (result.status !== 0) {
    return { ok: false, reason: `Ready check script exited with code ${result.status}: ${result.stderr.trim()}` };
  }
  
  try {
    const parsed = JSON.parse(result.stdout);
    if (!parsed.ok) {
      return { ok: false, reason: "Ready check reported ok: false" };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `Failed to parse ready check JSON output: ${error.message}` };
  }
}

function runGitPush(cwd, commitSha, targetRef) {
  const args = ["push", "origin", `${commitSha}:${targetRef}`];
  const env = { ...process.env };
  
  let result = spawnSync("git", args, {
    cwd,
    env,
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  
  if (result.status !== 0 && env.GITHUB_TOKEN && 
      (result.stderr.includes("Authentication failed") || 
       result.stderr.includes("Invalid username or token") ||
       result.stderr.includes("Password authentication is not supported"))) {
    delete env.GITHUB_TOKEN;
    result = spawnSync("git", args, {
      cwd,
      env,
      encoding: "utf8",
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  
  return result;
}

function processPublishQueue(cwd, options = {}) {
  const localDir = path.join(cwd, ".meta-harness", "local");
  const queuePath = path.join(localDir, "publish-queue.jsonl");
  
  if (!fs.existsSync(queuePath)) {
    return { processed: 0, msg: "No publish queue found." };
  }
  
  const content = fs.readFileSync(queuePath, "utf8");
  const lines = content.split("\n").filter(Boolean);
  const updatedLines = [];
  let processedCount = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let job;
    try {
      job = JSON.parse(line);
    } catch (e) {
      updatedLines.push(line);
      continue;
    }
    
    if (job.status !== "queued") {
      updatedLines.push(line);
      continue;
    }
    
    processedCount++;
    console.log(`Processing job ${job.job_id} for commit ${job.commit_sha}...`);
    
    if (!validateCommitExists(cwd, job.commit_sha)) {
      job.status = "failed";
      job.error = "Commit SHA does not exist locally";
      job.processed_at = new Date().toISOString();
      updatedLines.push(JSON.stringify(job));
      console.error(`Job ${job.job_id} failed: Commit does not exist locally.`);
      continue;
    }
    
    if (checkCommitAlreadyOnRemote(cwd, job.commit_sha)) {
      job.status = "completed";
      job.msg = "Commit is already present on remote repository";
      job.processed_at = new Date().toISOString();
      updatedLines.push(JSON.stringify(job));
      console.log(`Job ${job.job_id} skipped: Already on remote.`);
      continue;
    }
    
    const readyResult = runReadinessCheck(cwd);
    if (!readyResult.ok) {
      job.status = "failed";
      job.error = `Readiness check failed: ${readyResult.reason}`;
      job.processed_at = new Date().toISOString();
      updatedLines.push(JSON.stringify(job));
      console.error(`Job ${job.job_id} failed: Readiness check failed.`);
      continue;
    }
    
    const targetRef = `refs/heads/chatgpt/${job.job_id}`;
    if (options.dryRun) {
      console.log(`[DRY RUN] Would push ${job.commit_sha} to origin:${targetRef}`);
      job.status = "queued"; // Keep it queued
      updatedLines.push(JSON.stringify(job));
    } else {
      const pushResult = runGitPush(cwd, job.commit_sha, targetRef);
      if (pushResult.status === 0) {
        job.status = "completed";
        job.pushed_ref = targetRef;
        job.processed_at = new Date().toISOString();
        updatedLines.push(JSON.stringify(job));
        console.log(`Job ${job.job_id} completed successfully.`);
      } else {
        job.status = "failed";
        job.error = `Git push failed: ${pushResult.stderr.trim()}`;
        job.processed_at = new Date().toISOString();
        updatedLines.push(JSON.stringify(job));
        console.error(`Job ${job.job_id} failed: Git push failed. Output: ${pushResult.stderr}`);
      }
    }
  }
  
  fs.writeFileSync(queuePath, updatedLines.join("\n") + "\n", "utf8");
  return { processed: processedCount };
}

module.exports = {
  validateCommitExists,
  checkCommitAlreadyOnRemote,
  runReadinessCheck,
  runGitPush,
  processPublishQueue,
};
