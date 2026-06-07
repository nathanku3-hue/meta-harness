"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { UsageError } = require("./errors");
const { HARNESS_DIR, ensureDir, fileExists } = require("./paths");
const { copyPackagedTemplates } = require("./templates");
const { writeZipArchive } = require("./zip");
const {
  copyDirectoryWithPacketRules,
  copyFileWithPacketRules,
  isForbiddenPacketPath,
  isInsidePath,
  isRawChatPath,
  relativePath,
  resolveInsideRepo,
  validatePacketPath,
} = require("./packet-rules");
const { buildSubagentPacket } = require("./subagent-packet");

const EXPERT_PACKET_FILES = [
  "README_DECISION_CARD.md",
  "subagent_packet.json",
  "candidate_scope_memo.md",
  "low_confidence_and_boundaries.md",
];
const DEFAULT_EXPERT_PACKET_GIT_PATHS = [
  "README.md",
  "docs/product/prd.md",
  "docs/product/product-spec.md",
  "docs/product/decision-log.md",
  ".meta-harness/status.md",
  ".meta-harness/events.jsonl",
  "templates",
];
const GIT_OUTPUT_LINE_CAP = 200;
const GIT_OUTPUT_BYTE_CAP = 50_000;
const GIT_TIMEOUT_MS = 20_000;

function fail(message) {
  throw new UsageError(message);
}

function optionValue(value, fallback = undefined) {
  if (Array.isArray(value)) {
    return value[value.length - 1] ?? fallback;
  }
  return value ?? fallback;
}

function optionValues(value) {
  if (value === undefined || value === null || value === true) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function safeRoundId(roundId) {
  const value = String(roundId || "").trim();
  if (!value) {
    fail("expert-packet requires a non-empty round id");
  }
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value === "." || value === "..") {
    fail("round id may contain only letters, numbers, dot, underscore, and hyphen");
  }
  return value;
}

function writePacketStub(destinationPath, title, roundId, body) {
  fs.writeFileSync(
    destinationPath,
    `# ${title}\n\nRoundID: ${roundId}\n\n${body.trim()}\n`,
    "utf8"
  );
}

function limitCommandOutput(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  const lines = normalized.split(/\n/);
  if (Buffer.byteLength(normalized, "utf8") <= GIT_OUTPUT_BYTE_CAP && lines.length <= GIT_OUTPUT_LINE_CAP) {
    return normalized;
  }
  return `${lines.slice(0, GIT_OUTPUT_LINE_CAP).join("\n")}\n... truncated after ${GIT_OUTPUT_LINE_CAP} lines or ${GIT_OUTPUT_BYTE_CAP} bytes ...\n`;
}

function runGitCapture(cwd, args, pathspecs = []) {
  const command = [...args];
  if (pathspecs.length > 0) {
    command.push("--", ...pathspecs);
  }
  const result = spawnSync("git", command, {
    cwd,
    encoding: "utf8",
    shell: false,
    timeout: GIT_TIMEOUT_MS,
  });
  if (result.error || result.status !== 0) {
    return `git ${command.join(" ")} unavailable: ${(result.stderr || result.error?.message || "not a git repository").trim()}\n`;
  }
  return limitCommandOutput(result.stdout);
}

function existingGitPathspecs(cwd, extraPaths = []) {
  const seen = new Set();
  const pathspecs = [];
  for (const rawPath of [...DEFAULT_EXPERT_PACKET_GIT_PATHS, ...extraPaths]) {
    const resolved = resolveInsideRepo(cwd, rawPath, "git capture path", { mustExist: false });
    if (!fs.existsSync(resolved) || isForbiddenPacketPath(cwd, resolved) || isRawChatPath(cwd, resolved)) {
      continue;
    }
    const relative = relativePath(cwd, resolved);
    if (!seen.has(relative)) {
      seen.add(relative);
      pathspecs.push(relative);
    }
  }
  return pathspecs;
}

function referenceMtime(cwd) {
  const statusPath = path.join(cwd, HARNESS_DIR, "status.md");
  if (!fileExists(statusPath)) {
    return undefined;
  }
  return fs.statSync(statusPath).mtimeMs;
}

function copyOptionalMemo(cwd, source, destination, roundId, title, body, context) {
  if (source) {
    const result = copyFileWithPacketRules(cwd, source, destination, {
      referenceMtimeMs: context.referenceMtimeMs,
      failOnSkip: true,
    });
    return result.stale ? [result.stale] : [];
  }
  writePacketStub(destination, title, roundId, body);
  return [];
}

function copyHarnessTruth(cwd, packetDir, context) {
  const copied = [];
  const skipped = [];
  const staleEntries = [];
  const harnessRoot = path.join(cwd, HARNESS_DIR);
  if (!fileExists(harnessRoot)) {
    return { copied, skipped, staleEntries };
  }

  const rootFiles = ["status.md", "events.jsonl", "phase-map.md", "repos.json", "poll.md", "lookback.md"];
  for (const filename of rootFiles) {
    const source = path.join(harnessRoot, filename);
    if (fileExists(source) && fs.statSync(source).isFile()) {
      const destination = path.join(packetDir, HARNESS_DIR, filename);
      const result = copyFileWithPacketRules(cwd, source, destination, {
        referenceMtimeMs: context.referenceMtimeMs,
      });
      if (result.copied) {
        copied.push(`${HARNESS_DIR}/${filename}`);
      } else {
        skipped.push(result.skipped);
      }
      if (result.stale) {
        staleEntries.push(result.stale);
      }
    }
  }

  for (const dirname of ["streams", "workers", "templates"]) {
    const source = path.join(harnessRoot, dirname);
    if (fileExists(source) && fs.statSync(source).isDirectory()) {
      const destination = path.join(packetDir, HARNESS_DIR, dirname);
      const result = copyDirectoryWithPacketRules(cwd, source, destination, {
        referenceMtimeMs: context.referenceMtimeMs,
      });
      copied.push(...result.copied.map((item) => item.startsWith(HARNESS_DIR) ? item : `${HARNESS_DIR}/${dirname}/${path.basename(item)}`));
      skipped.push(...result.skipped);
      staleEntries.push(...result.staleEntries);
    }
  }
  return { copied, skipped, staleEntries };
}

function copyIncludedPaths(cwd, packetDir, includePaths, outputRoot, context) {
  const copied = [];
  const skipped = [];
  const staleEntries = [];
  const safeOwnedPaths = [];
  for (const rawPath of includePaths) {
    const source = validatePacketPath(cwd, rawPath, "include path").absolutePath;
    if (isInsidePath(source, outputRoot) || isInsidePath(outputRoot, source)) {
      fail(`include path must not overlap packet output root: ${relativePath(cwd, source)}`);
    }
    const relative = relativePath(cwd, source);
    const destination = path.join(packetDir, "included", relative);
    if (fs.statSync(source).isDirectory()) {
      const result = copyDirectoryWithPacketRules(cwd, source, destination, {
        referenceMtimeMs: context.referenceMtimeMs,
      });
      copied.push(...result.copied.map((item) => `included/${item}`));
      safeOwnedPaths.push(...result.copied);
      skipped.push(...result.skipped);
      staleEntries.push(...result.staleEntries);
    } else {
      const result = copyFileWithPacketRules(cwd, source, destination, {
        referenceMtimeMs: context.referenceMtimeMs,
      });
      if (result.copied) {
        copied.push(`included/${result.repoRelative}`);
        safeOwnedPaths.push(result.repoRelative);
      } else {
        skipped.push(result.skipped);
      }
      if (result.stale) {
        staleEntries.push(result.stale);
      }
    }
  }
  return { copied, safeOwnedPaths, skipped, staleEntries };
}

function markdownList(items) {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- none";
}

function buildExpertDecisionCardBody(options, subagentPacket, staleEntries) {
  const question = optionValue(options.question, "Answer the bounded review question using only this packet and return one next action.");
  const lines = [
    "Front Card Max: one page.",
    "",
    "Current delta:",
    "- Bounded expert/subagent packet for this round.",
    "",
    `Question: ${question}`,
    "",
    "Owned paths:",
    markdownList(subagentPacket.owned_paths),
    "",
    "Forbidden paths:",
    markdownList(subagentPacket.forbidden_paths),
    "",
    "Required evidence:",
    markdownList(subagentPacket.required_evidence),
    "",
    `Stop rule: ${subagentPacket.stop_rule}`,
    "",
    `Expected output: ${subagentPacket.return_schema}`,
    "",
    "Stale evidence:",
    markdownList(staleEntries),
    "",
    "Not authorized: broad expert boards, raw chat logs, credential/provider/runtime reads, governed data reads, broad repo dumps, or unscoped writes.",
  ];
  return lines.join("\n");
}

function writeExpertPacketManifest(packetDir, roundId, included, skipped, gitPathspecs, staleEntries) {
  const lines = [
    "# Expert Packet Manifest",
    "",
    `RoundID: ${roundId}`,
    "Builder: meta-harness expert-packet",
    "Deliverable: single zip archive only; do not publish sidecar diffs, next-scope notes, or loose packet files beside the zip.",
    "",
    "Included root files:",
    ...EXPERT_PACKET_FILES.map((filename) => `- ${filename}`),
    "- PACKET_MANIFEST.md",
    "- git_status.txt",
    "- git_diff_name_status.txt",
    "- git_log_oneline_20.txt",
    "",
    "Subagent workcell:",
    "- Default fanout budget: 2",
    "- Explicit max fanout: 3",
    "- Broad expert board: not invoked by default",
    "- Return schema excludes raw logs and private transcripts",
    "",
    "Included packet paths:",
    ...(included.length > 0 ? included.map((item) => `- ${item}`) : ["- none"]),
    "",
    "Git capture pathspecs:",
    ...(gitPathspecs.length > 0 ? gitPathspecs.map((item) => `- ${item}`) : ["- none"]),
    "",
    "Stale evidence:",
    ...(staleEntries.length > 0 ? staleEntries.map((item) => `- ${item}`) : ["- none"]),
    "",
    "Skipped paths:",
    ...(skipped.length > 0 ? skipped.map((item) => `- ${item}`) : ["- none"]),
    "",
    "Excluded by design:",
    "- .git/",
    "- node_modules/",
    "- .venv/",
    "- provider-config/",
    "- runtime/",
    "- user-worktree/",
    "- docs/chats/",
    "- raw chat logs",
    "- broad expert board output",
    "- Python and test caches",
    "- files larger than the packet size cap",
  ];
  fs.writeFileSync(path.join(packetDir, "PACKET_MANIFEST.md"), `${lines.join("\n")}\n`, "utf8");
}

function packetFiles(packetDir) {
  return fs.readdirSync(packetDir, { recursive: true })
    .map((item) => String(item))
    .filter((item) => fs.statSync(path.join(packetDir, item)).isFile())
    .map((item) => item.split(path.sep).join("/"))
    .sort();
}

function buildExpertPacket(input) {
  const cwd = input.cwd || process.cwd();
  const options = input.options || {};
  const roundId = safeRoundId(input.roundId);
  const outputRoot = resolveInsideRepo(
    cwd,
    optionValue(options.outputRoot, path.join(HARNESS_DIR, "expert-packets")),
    "output root",
    { mustExist: false }
  );
  if (isForbiddenPacketPath(cwd, outputRoot) || isRawChatPath(cwd, outputRoot)) {
    fail(`refusing packet output root: ${relativePath(cwd, outputRoot)}`);
  }

  const packetDir = path.join(outputRoot, `.${roundId}.packet-staging`);
  const packetZip = path.join(outputRoot, `${roundId}.zip`);
  const overwrite = Boolean(options.overwrite);
  const dryRun = Boolean(options.dryRun);
  const includePaths = optionValues(options.include);
  const gitPathspecs = existingGitPathspecs(cwd, [...includePaths, ...optionValues(options.gitPath)]);

  if (dryRun) {
    return { dryRun: true, packetZip, gitPathspecs };
  }

  if (fileExists(packetZip) || fileExists(packetDir)) {
    if (!overwrite) {
      fail(`expert packet already exists: ${packetZip}`);
    }
    if (!isInsidePath(packetDir, outputRoot)) {
      fail(`refusing to overwrite packet outside output root: ${packetDir}`);
    }
    if (!isInsidePath(packetZip, outputRoot)) {
      fail(`refusing to overwrite packet outside output root: ${packetZip}`);
    }
    if (fileExists(packetZip)) {
      fs.rmSync(packetZip, { force: true });
    }
    fs.rmSync(packetDir, { recursive: true, force: true });
  }
  ensureDir(outputRoot);
  ensureDir(packetDir);

  const context = { referenceMtimeMs: referenceMtime(cwd) };
  const included = [];
  const skipped = [];
  const staleEntries = [];

  const harnessResult = copyHarnessTruth(cwd, packetDir, context);
  included.push(...harnessResult.copied);
  skipped.push(...harnessResult.skipped);
  staleEntries.push(...harnessResult.staleEntries);

  included.push(...copyPackagedTemplates(path.join(packetDir, "harness_templates"), true).map((item) => `harness_templates/${item}`));

  const includeResult = copyIncludedPaths(cwd, packetDir, includePaths, outputRoot, context);
  included.push(...includeResult.copied);
  skipped.push(...includeResult.skipped);
  staleEntries.push(...includeResult.staleEntries);

  const subagentPacket = buildSubagentPacket({
    cwd,
    goal: optionValue(options.goal, "Answer the single expert packet question."),
    ownedPaths: optionValues(options.ownedPath),
    copiedSafeOwnedPaths: includeResult.safeOwnedPaths,
    forbiddenPaths: optionValues(options.forbiddenPath).length > 0 ? optionValues(options.forbiddenPath) : undefined,
    requiredEvidence: optionValues(options.requiredEvidence).length > 0 ? optionValues(options.requiredEvidence) : undefined,
    stopRule: optionValue(options.stopRule, undefined),
    returnSchema: optionValue(options.returnSchema, undefined),
  });

  staleEntries.push(...copyOptionalMemo(
    cwd,
    optionValue(options.decisionCard),
    path.join(packetDir, "README_DECISION_CARD.md"),
    roundId,
    "Expert Decision Card",
    buildExpertDecisionCardBody(options, subagentPacket, staleEntries),
    context
  ));
  fs.writeFileSync(
    path.join(packetDir, "subagent_packet.json"),
    `${JSON.stringify(subagentPacket, null, 2)}\n`,
    "utf8"
  );
  staleEntries.push(...copyOptionalMemo(
    cwd,
    optionValue(options.candidateScopeMemo) || optionValue(options.scopeMemo),
    path.join(packetDir, "candidate_scope_memo.md"),
    roundId,
    "Candidate Scope Memo",
    "Chosen scope, rejected alternatives, stop rules, file budget, and demo target should be filled by the orchestrator.",
    context
  ));
  staleEntries.push(...copyOptionalMemo(
    cwd,
    optionValue(options.lowConfidenceAndBoundaries) || optionValue(options.boundaries),
    path.join(packetDir, "low_confidence_and_boundaries.md"),
    roundId,
    "Low Confidence And Boundaries",
    "Record low-confidence items, approval gates, blocked actions, and out-of-boundary work before review.",
    context
  ));

  fs.writeFileSync(path.join(packetDir, "git_status.txt"), runGitCapture(cwd, ["status", "--short"], gitPathspecs), "utf8");
  fs.writeFileSync(path.join(packetDir, "git_diff_name_status.txt"), runGitCapture(cwd, ["diff", "--name-status"], gitPathspecs), "utf8");
  fs.writeFileSync(
    path.join(packetDir, "git_log_oneline_20.txt"),
    `# git log is limited to declared expert-packet paths.\n\n${runGitCapture(cwd, ["log", "--oneline", "-20"], gitPathspecs)}`,
    "utf8"
  );
  writeExpertPacketManifest(packetDir, roundId, included, skipped, gitPathspecs, staleEntries);

  const files = packetFiles(packetDir);
  writeZipArchive(packetDir, packetZip);
  fs.rmSync(packetDir, { recursive: true, force: true });

  return {
    packetZip,
    packetFiles: files,
    relativePacketZip: relativePath(cwd, packetZip),
  };
}

module.exports = {
  buildExpertPacket,
  safeRoundId,
};
