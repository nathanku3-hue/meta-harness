"use strict";

const fs = require("node:fs");
const path = require("node:path");

function subcheck(id, name, status, reason = "", nextAction = "") {
  return { id, name, status, reason, next_action: nextAction };
}

function readText(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function workflowFiles(root) {
  const dir = path.join(root, ".github", "workflows");
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return [];
  }
  return fs.readdirSync(dir)
    .filter(file => file.endsWith(".yml") || file.endsWith(".yaml"))
    .sort((left, right) => left.localeCompare(right))
    .map(file => path.join(".github", "workflows", file));
}

function usesEntries(text) {
  const entries = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*(?:-\s*)?uses:\s*["']?([^"'\s]+)["']?\s*$/);
    if (match) {
      entries.push({ value: match[1], line: index + 1 });
    }
  }
  return entries;
}

function checkWorkflowPinning(root) {
  const files = workflowFiles(root);
  if (files.length === 0) {
    return subcheck("SEC_WF_PIN_001", "workflow_pinning", "warn", "no workflow files found", "Add CI workflow with pinned remote actions");
  }

  const problems = [];
  for (const file of files) {
    const text = readText(root, file);
    for (const entry of usesEntries(text)) {
      const value = entry.value;
      if (value.startsWith("./") || value.startsWith(".\\")) {
        continue;
      }
      if (value.startsWith("docker://")) {
        if (!/@sha256:[a-f0-9]{64}$/i.test(value)) {
          problems.push(`${file}:${entry.line} docker action is not digest-pinned`);
        }
        continue;
      }
      const at = value.lastIndexOf("@");
      if (at === -1) {
        problems.push(`${file}:${entry.line} remote action missing @ref`);
        continue;
      }
      const ref = value.slice(at + 1);
      if (!/^[a-f0-9]{40}$/i.test(ref)) {
        problems.push(`${file}:${entry.line} remote action/workflow must use a full commit SHA`);
      }
    }
  }

  if (problems.length > 0) {
    return subcheck("SEC_WF_PIN_001", "workflow_pinning", "fail", problems.join("; "), "Pin remote actions and reusable workflows to full commit SHAs");
  }
  return subcheck("SEC_WF_PIN_001", "workflow_pinning", "pass");
}

function checkWorkflowPermissions(root) {
  const files = workflowFiles(root);
  const problems = [];
  for (const file of files) {
    const text = readText(root, file);
    if (!/^\s*permissions:\s*$/m.test(text)) {
      problems.push(`${file}: missing permissions block`);
    }
    if (/permissions:\s*write-all\b/i.test(text) || /^\s*[a-z-]+:\s*write\s*$/im.test(text)) {
      problems.push(`${file}: write permissions are not allowed in Phase 5 baseline`);
    }
    if (!/^\s*contents:\s*read\s*$/m.test(text)) {
      problems.push(`${file}: contents: read permission missing`);
    }
    if (/secrets\s*:\s*inherit\b/i.test(text) || /\$\{\{\s*secrets\./.test(text)) {
      problems.push(`${file}: workflow references repository secrets`);
    }
  }
  if (problems.length > 0) {
    return subcheck("SEC_WF_PERM_001", "workflow_permissions", "fail", problems.join("; "), "Use read-only contents permissions and avoid repository secrets");
  }
  return subcheck("SEC_WF_PERM_001", "workflow_permissions", files.length === 0 ? "warn" : "pass", files.length === 0 ? "no workflow files found" : "");
}

function checkWorkflowTriggers(root) {
  const problems = [];
  for (const file of workflowFiles(root)) {
    const text = readText(root, file);
    if (/^\s*pull_request_target\s*:/m.test(text)) problems.push(`${file}: pull_request_target trigger is not allowed without gated approval`);
    if (/^\s*workflow_run\s*:/m.test(text)) problems.push(`${file}: workflow_run trigger is not allowed without gated approval`);
  }
  if (problems.length > 0) {
    return subcheck("SEC_WF_TRIGGER_001", "workflow_triggers", "fail", problems.join("; "), "Remove pull_request_target/workflow_run or add explicit gated approval");
  }
  return subcheck("SEC_WF_TRIGGER_001", "workflow_triggers", "pass");
}

function checkWorkflowUntrustedInput(root) {
  const risky = [
    /github\.event\.pull_request\.(?:title|body)/,
    /github\.event\.issue\.(?:title|body)/,
    /github\.event\.comment\.body/,
    /github\.event\.review\.body/,
    /github\.head_ref/,
    /github\.ref_name/
  ];
  const problems = [];
  for (const file of workflowFiles(root)) {
    const text = readText(root, file);
    for (const pattern of risky) {
      if (pattern.test(text)) {
        problems.push(`${file}: untrusted GitHub context ${pattern.source}`);
      }
    }
  }
  if (problems.length > 0) {
    return subcheck("SEC_WF_UNTRUSTED_001", "workflow_untrusted_input", "fail", problems.join("; "), "Do not pass PR, issue, comment, or branch text directly into shell commands or agent prompts");
  }
  return subcheck("SEC_WF_UNTRUSTED_001", "workflow_untrusted_input", "pass");
}

function checkWorkflowRunners(root) {
  const problems = [];
  for (const file of workflowFiles(root)) {
    const text = readText(root, file);
    if (/runs-on\s*:\s*.*self-hosted/i.test(text)) {
      problems.push(`${file}: self-hosted runner configured`);
    }
  }
  if (problems.length > 0) {
    return subcheck("SEC_WF_RUNNER_001", "workflow_runners", "fail", problems.join("; "), "Use GitHub-hosted runners unless self-hosted runner use is explicitly approved");
  }
  return subcheck("SEC_WF_RUNNER_001", "workflow_runners", "pass");
}

module.exports = {
  checkWorkflowPermissions,
  checkWorkflowPinning,
  checkWorkflowRunners,
  checkWorkflowTriggers,
  checkWorkflowUntrustedInput,
  workflowFiles
};
