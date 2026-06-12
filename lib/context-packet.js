"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { UsageError } = require("./errors");
const { HARNESS_DIR, ensureDir, readText, writeTextAtomic } = require("./paths");
const {
  CONTEXT_LOCAL_DIR,
  CONTEXT_TRACKED_DIR,
  safeRoundId,
  selectLatestContextArtifact,
  validateContextGateArtifact,
} = require("./context-gate");

const PACKET_MAX_CHARS = 9000;
const PACKET_TARGETS = new Set(["worker", "review", "planning"]);

function fail(message) {
  throw new UsageError(message);
}

function slashPath(value) {
  return String(value).split(path.sep).join("/");
}

function isInsidePath(targetPath, rootPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function parseJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseIsoDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function truncateLine(value, limit = 180) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 3)}...`;
}

function markdownList(items) {
  return items && items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- none";
}

function listFiles(cwd, relativeDir, options = {}) {
  const directory = path.join(cwd, relativeDir);
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    return [];
  }
  const extensions = options.extensions || [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => slashPath(path.join(relativeDir, entry.name)))
    .filter((item) => extensions.length === 0 || extensions.includes(path.extname(item).toLowerCase()))
    .sort((left, right) => left.localeCompare(right));
}

function readEvents(cwd) {
  const eventsPath = path.join(cwd, HARNESS_DIR, "events.jsonl");
  if (!fs.existsSync(eventsPath)) {
    return [];
  }
  return fs.readFileSync(eventsPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (_) {
        return undefined;
      }
    })
    .filter(Boolean)
    .slice(-5)
    .map((event) => {
      const date = event.ts || event.time || "undated";
      const action = event.action || "event";
      const result = event.result || "";
      const decision = event.decision ? ` (${event.decision})` : "";
      return `${date}: ${truncateLine(action)}${decision}${result ? ` -> ${truncateLine(result, 120)}` : ""}`;
    });
}

function packageSummary(cwd) {
  const packagePath = path.join(cwd, "package.json");
  if (!fs.existsSync(packagePath)) {
    return "";
  }
  let parsed;
  try {
    parsed = parseJsonFile(packagePath);
  } catch (_) {
    return "package.json present but malformed";
  }

  const parts = [];
  if (parsed.name) parts.push(`package ${parsed.name}`);
  if (parsed.version) parts.push(`version ${parsed.version}`);
  if (parsed.packageManager) parts.push(parsed.packageManager);
  if (parsed.engines?.node) parts.push(`node ${parsed.engines.node}`);
  if (parsed.scripts?.test) parts.push(`test: ${parsed.scripts.test}`);
  return parts.join("; ");
}

function parseDecisionTitles(text, ids) {
  const titleById = new Map();
  const lines = String(text || "").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^##\s+(D[0-9]{3})\s*:\s*(.+)$/);
    if (match) {
      titleById.set(match[1], match[2].trim());
    }
  }
  return ids.map((id) => titleById.has(id) ? `${id}: ${titleById.get(id)}` : id);
}

function artifactCandidatesForRound(cwd, roundId) {
  const filename = `${roundId}.json`;
  return [CONTEXT_LOCAL_DIR, CONTEXT_TRACKED_DIR]
    .map((relativeDir) => path.join(cwd, relativeDir, filename))
    .filter((filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isFile());
}

function selectRoundArtifact(cwd, roundId, validationOptions) {
  const candidates = artifactCandidatesForRound(cwd, roundId);
  if (candidates.length === 0) {
    fail(`context gate artifact not found for ${roundId}`);
  }

  const parsed = candidates.map((filePath) => {
    try {
      const artifact = parseJsonFile(filePath);
      const generatedAt = parseIsoDate(artifact.generated_at);
      return {
        filePath,
        artifact,
        generatedAt,
        generatedAtMs: generatedAt ? generatedAt.getTime() : Number.NEGATIVE_INFINITY,
        parseError: undefined,
      };
    } catch (error) {
      return {
        filePath,
        artifact: undefined,
        generatedAt: undefined,
        generatedAtMs: Number.NEGATIVE_INFINITY,
        parseError: error,
      };
    }
  }).sort((left, right) => {
    const timeDelta = right.generatedAtMs - left.generatedAtMs;
    if (timeDelta !== 0) return timeDelta;
    return slashPath(left.filePath).localeCompare(slashPath(right.filePath));
  });

  const selected = parsed[0];
  if (selected.parseError) {
    fail(`context gate artifact is malformed JSON: ${selected.filePath}: ${selected.parseError.message}`);
  }
  if (!selected.generatedAt) {
    fail(`context gate artifact has invalid generated_at: ${selected.filePath}`);
  }
  const validation = validateContextGateArtifact(selected.artifact, validationOptions || {});
  if (!validation.ok) {
    fail(`context gate artifact failed validation: ${validation.errors.join("; ")}`);
  }
  return {
    artifact: selected.artifact,
    path: selected.filePath,
  };
}

function readGateArtifact(cwd, roundId, validationOptions) {
  if (roundId) {
    return selectRoundArtifact(cwd, safeRoundId(roundId), validationOptions);
  }
  const selected = selectLatestContextArtifact({ cwd, validation: validationOptions || {} });
  if (!selected.applicable) {
    fail(selected.reason || "no context gate artifact found");
  }
  return {
    artifact: selected.artifact,
    path: selected.path,
  };
}

function collectPacketState(cwd, artifactPath, artifact) {
  const decisionLogText = readText(path.join(cwd, "docs", "product", "decision-log.md"), "");
  const decisions = parseDecisionTitles(decisionLogText, artifact.context_summary?.decisions || []);
  const sources = [
    ".meta-harness/status.md",
    ".meta-harness/phase-map.md",
    ".meta-harness/events.jsonl",
    slashPath(path.relative(cwd, artifactPath)),
  ];
  if (fs.existsSync(path.join(cwd, "README.md"))) sources.push("README.md");
  if (fs.existsSync(path.join(cwd, "package.json"))) sources.push("package.json");
  if (fs.existsSync(path.join(cwd, "pyproject.toml"))) sources.push("pyproject.toml");
  if (decisionLogText) sources.push("docs/product/decision-log.md");

  return {
    events: readEvents(cwd),
    workerFiles: listFiles(cwd, path.join(HARNESS_DIR, "workers"), { extensions: [".md", ".json"] }),
    expertPacketFiles: listFiles(cwd, path.join(HARNESS_DIR, "expert-packets"), { extensions: [".zip", ".md", ".json"] }),
    packageSummary: packageSummary(cwd),
    decisions,
    sources,
  };
}

function validatePacketInputs(artifact, target) {
  if (!PACKET_TARGETS.has(target)) {
    fail("context packet target must be worker, review, or planning");
  }
  if (!artifact.scores || artifact.scores.freshness < 6) {
    fail("context packet requires gate freshness score >= 6");
  }
}

function renderContextPacket(artifact, state, target) {
  const summary = artifact.context_summary || {};
  const scopeLines = [
    summary.scope || "unknown",
    summary.owned_surface ? `Owned surface: ${summary.owned_surface}` : "",
  ].filter(Boolean);
  if (artifact.verdict === "narrowed") {
    scopeLines.push("Narrowed verdict: continue only inside the scope above.");
  }

  const stack = [summary.stack, state.packageSummary].filter(nonEmpty).join("; ") || "unknown";
  const blockers = [
    ...(artifact.structural_hard_blockers || []),
    ...(artifact.evidence_gap_dimensions || []).map((dimension) => `Evidence gap: ${dimension}`),
    ...(artifact.unknown_dimensions || []).map((dimension) => `Unknown: ${dimension}`),
  ];

  const lines = [
    `# Context Packet ${artifact.round_id}`,
    "",
    `Audience: ${target}`,
    `Transition: ${artifact.transition}`,
    `Gate verdict: ${artifact.verdict} (${artifact.overall_score}/10)`,
    `Generated: ${artifact.generated_at}`,
    "",
    "## Goal",
    "",
    summary.goal || "unknown",
    "",
    "## Scope",
    "",
    scopeLines.join("\n"),
    "",
    "## Stack",
    "",
    stack,
    "",
    "## Evidence Required",
    "",
    summary.evidence_required || "unknown",
    "",
    "## Stop Rules",
    "",
    summary.stop_rules || "unknown",
    "",
    "## Decisions",
    "",
    markdownList(state.decisions),
    "",
    "## Freshness",
    "",
    `${summary.freshness || artifact.generated_at}; freshness score ${artifact.scores.freshness}/10`,
    "",
    "## Handoff",
    "",
    summary.handoff || artifact.correct_next_step,
    "",
    "## Blockers And Questions",
    "",
    markdownList(blockers),
    "",
    markdownList(artifact.questions || []),
    "",
    "## Recent Events",
    "",
    markdownList(state.events),
    "",
    "## Related Harness Files",
    "",
    markdownList([...state.workerFiles, ...state.expertPacketFiles]),
    "",
    "## Sources",
    "",
    markdownList(state.sources),
  ];

  return `${lines.join("\n")}\n`;
}

function resolvePacketOut(cwd, out, artifact, jsonMode) {
  const resolved = path.resolve(cwd, String(out));
  if (!isInsidePath(resolved, cwd)) {
    fail(`context packet output path must stay inside the repository: ${out}`);
  }
  const ext = path.extname(resolved).toLowerCase();
  if (ext === ".json" || ext === ".md") {
    return resolved;
  }
  return path.join(resolved, `${artifact.round_id}-context-packet.${jsonMode ? "json" : "md"}`);
}

function buildContextPacket(options = {}) {
  const cwd = path.resolve(options.targetRoot || options.cwd || process.cwd());
  const target = String(options.for || options.audience || options.target || "worker").trim();
  const selected = readGateArtifact(cwd, options.roundId, options.validation || {});
  const artifact = selected.artifact;

  validatePacketInputs(artifact, target);

  const state = collectPacketState(cwd, selected.path, artifact);
  const packetMarkdown = renderContextPacket(artifact, state, target);
  if (packetMarkdown.length > PACKET_MAX_CHARS) {
    fail(`context packet exceeds ${PACKET_MAX_CHARS} characters`);
  }

  const envelope = {
    round_id: artifact.round_id,
    generated_at: new Date().toISOString(),
    source_gate_path: slashPath(path.relative(cwd, selected.path)),
    for: target,
    verdict: artifact.verdict,
    transition: artifact.transition,
    packet_markdown: packetMarkdown,
  };

  if (options.out) {
    const outPath = resolvePacketOut(cwd, options.out, artifact, Boolean(options.json));
    ensureDir(path.dirname(outPath));
    const content = options.json || path.extname(outPath).toLowerCase() === ".json"
      ? `${JSON.stringify(envelope, null, 2)}\n`
      : packetMarkdown;
    writeTextAtomic(outPath, content);
    envelope.outPath = outPath;
  }

  return envelope;
}

module.exports = {
  PACKET_MAX_CHARS,
  PACKET_TARGETS,
  buildContextPacket,
  renderContextPacket,
};
