"use strict";

const fs = require("node:fs");
const path = require("node:path");

const LEAK_PATTERNS = Object.freeze([
  /(^|[_-])staged\.patch$/i,
  /(^|[_-])mixed[_-]workspace\.patch$/i,
  /(^|[_-])merge[_-]gate[_-]wip\.patch$/i,
  /(^|[_-])staged[_-]names\.txt$/i,
  /(^|[_-])porcelain[_-]status\.txt$/i,
  /(^|[_-])untracked[_-]files\.txt$/i,
  /(^|[_-])merge[_-]gate[_-]untracked\.txt$/i,
]);

function toSlash(value) {
  return String(value).split(path.sep).join("/");
}

function isEvidenceSidecar(name) {
  return LEAK_PATTERNS.some((pattern) => pattern.test(name));
}

function item(status, filePath, detail = "") {
  return { status, path: filePath, detail };
}

function scanRootLeakArtifacts({ targetRoot } = {}) {
  const resolvedRoot = path.resolve(targetRoot || process.cwd());
  const parentRoot = path.dirname(resolvedRoot);
  if (parentRoot === resolvedRoot) {
    return { status: "PASS", checked: 0, items: [] };
  }

  let entries;
  try {
    entries = fs.readdirSync(parentRoot, { withFileTypes: true });
  } catch (error) {
    return {
      status: "UNREADABLE",
      checked: 0,
      items: [item("UNREADABLE", toSlash(parentRoot), `unable to inspect parent workspace: ${error.message}`)],
    };
  }

  const findings = entries
    .filter((entry) => entry.isFile() && isEvidenceSidecar(entry.name))
    .map((entry) => item(
      "REJECTED",
      `../${entry.name}`,
      "sibling evidence sidecar; write exports under .meta-harness/local/ or an explicit temp directory",
    ))
    .sort((left, right) => left.path.localeCompare(right.path));

  return {
    status: findings.length === 0 ? "PASS" : "REJECTED",
    checked: entries.length,
    items: findings,
  };
}

module.exports = {
  isEvidenceSidecar,
  scanRootLeakArtifacts,
};
