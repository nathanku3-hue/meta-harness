"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { writeTextAtomic } = require("./paths");

const POST_PHASE_REFLECTION_BEGIN = "<!-- META-HARNESS:POST-PHASE-REFLECTION:BEGIN -->";
const POST_PHASE_REFLECTION_END = "<!-- META-HARNESS:POST-PHASE-REFLECTION:END -->";
const POST_PHASE_REFLECTION_TEMPLATE = "templates/contracts/post-phase-reflection-contract.md";
const POST_PHASE_REFLECTION_TARGET = "AGENTS.md#meta-harness-post-phase-reflection";

function countOccurrences(text, token) {
  let count = 0;
  let offset = 0;
  while (true) {
    const index = text.indexOf(token, offset);
    if (index < 0) return count;
    count += 1;
    offset = index + token.length;
  }
}

function sourceTemplatePath(sourceRoot) {
  return path.join(path.resolve(sourceRoot), ...POST_PHASE_REFLECTION_TEMPLATE.split("/"));
}

function canonicalPostPhaseReflectionBlock(sourceRoot) {
  const templatePath = sourceTemplatePath(sourceRoot);
  if (!fs.existsSync(templatePath)) return undefined;
  const canonical = fs.readFileSync(templatePath, "utf8").replace(/\r\n/g, "\n").trimEnd();
  const beginCount = countOccurrences(canonical, POST_PHASE_REFLECTION_BEGIN);
  const endCount = countOccurrences(canonical, POST_PHASE_REFLECTION_END);
  if (
    beginCount !== 1
    || endCount !== 1
    || !canonical.startsWith(POST_PHASE_REFLECTION_BEGIN)
    || !canonical.endsWith(POST_PHASE_REFLECTION_END)
  ) {
    throw new Error("packaged post-phase reflection guidance has invalid managed-block markers");
  }
  return canonical;
}

function locateManagedBlock(text) {
  const beginCount = countOccurrences(text, POST_PHASE_REFLECTION_BEGIN);
  const endCount = countOccurrences(text, POST_PHASE_REFLECTION_END);
  if (beginCount === 0 && endCount === 0) {
    return { kind: "missing" };
  }
  const begin = text.indexOf(POST_PHASE_REFLECTION_BEGIN);
  const end = text.indexOf(POST_PHASE_REFLECTION_END);
  if (beginCount !== 1 || endCount !== 1 || begin < 0 || end < begin) {
    return { kind: "malformed" };
  }
  return {
    kind: "present",
    begin,
    end: end + POST_PHASE_REFLECTION_END.length,
    content: text.slice(begin, end + POST_PHASE_REFLECTION_END.length).replace(/\r\n/g, "\n"),
  };
}

function inspectPostPhaseReflectionGuidance({ sourceRoot, targetRoot }) {
  const canonical = canonicalPostPhaseReflectionBlock(sourceRoot);
  if (canonical === undefined) return undefined;
  const agentsPath = path.join(path.resolve(targetRoot), "AGENTS.md");
  let stat;
  try {
    stat = fs.lstatSync(agentsPath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {
        status: "MISSING",
        path: POST_PHASE_REFLECTION_TARGET,
        detail: "managed post-phase reflection guidance is missing",
      };
    }
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return {
      status: "REJECTED",
      path: POST_PHASE_REFLECTION_TARGET,
      detail: "AGENTS.md is not a regular file",
    };
  }
  const located = locateManagedBlock(fs.readFileSync(agentsPath, "utf8"));
  if (located.kind === "missing") {
    return {
      status: "MISSING",
      path: POST_PHASE_REFLECTION_TARGET,
      detail: "managed post-phase reflection guidance is missing",
    };
  }
  if (located.kind === "malformed") {
    return {
      status: "REJECTED",
      path: POST_PHASE_REFLECTION_TARGET,
      detail: "managed post-phase reflection markers are partial or duplicated",
    };
  }
  if (located.content !== canonical) {
    return {
      status: "DRIFT",
      path: POST_PHASE_REFLECTION_TARGET,
      detail: "managed post-phase reflection guidance differs from source",
    };
  }
  return { status: "PASS", path: POST_PHASE_REFLECTION_TARGET };
}

function installPostPhaseReflectionGuidance({ sourceRoot, targetRoot }) {
  const canonical = canonicalPostPhaseReflectionBlock(sourceRoot);
  if (canonical === undefined) {
    throw new Error("packaged post-phase reflection guidance is missing");
  }
  const agentsPath = path.join(path.resolve(targetRoot), "AGENTS.md");
  let existing = "";
  if (fs.existsSync(agentsPath)) {
    const stat = fs.lstatSync(agentsPath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error("AGENTS.md is not a regular file");
    }
    existing = fs.readFileSync(agentsPath, "utf8");
  }

  const located = locateManagedBlock(existing);
  let updated;
  let action;
  if (located.kind === "malformed") {
    throw new Error("managed post-phase reflection markers are partial or duplicated");
  }
  if (located.kind === "present") {
    updated = existing.slice(0, located.begin) + canonical + existing.slice(located.end);
    action = updated === existing ? "unchanged" : "updated";
  } else if (existing.length === 0) {
    updated = canonical + "\n";
    action = "created";
  } else {
    const separator = existing.endsWith("\n") ? "\n" : "\n\n";
    updated = existing + separator + canonical + "\n";
    action = "added";
  }

  if (updated !== existing) {
    writeTextAtomic(agentsPath, updated);
  }
  return { action, changed: updated !== existing, path: "AGENTS.md" };
}

module.exports = {
  POST_PHASE_REFLECTION_BEGIN,
  POST_PHASE_REFLECTION_END,
  POST_PHASE_REFLECTION_TARGET,
  canonicalPostPhaseReflectionBlock,
  inspectPostPhaseReflectionGuidance,
  installPostPhaseReflectionGuidance,
  locateManagedBlock,
};
