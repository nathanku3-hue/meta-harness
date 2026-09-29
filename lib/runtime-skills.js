"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", ".agents", "skills", "meta-harness-runtime");
const MAX_SKILL_BYTES = 256 * 1024;

const FILES = Object.freeze({
  root: path.join(ROOT, "SKILL.md"),
  "coding-worker": path.join(ROOT, "coding-worker", "SKILL.md"),
  "logical-planner": path.join(ROOT, "logical-planner", "SKILL.md"),
  "read-only-interaction": path.join(ROOT, "read-only-interaction", "SKILL.md"),
  "research-promotion": path.join(ROOT, "research-promotion", "SKILL.md"),
});

function stripFrontMatter(text) {
  const end = text.indexOf("\n---\n", 4);
  if (!text.startsWith("---\n") || end < 0) throw new Error("invalid packaged runtime skill");
  return text.slice(end + 5).trim();
}

function readRuntimeSkill(name) {
  const filePath = FILES[name];
  if (!filePath) throw new Error(`unknown packaged runtime skill: ${name}`);
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_SKILL_BYTES) {
    throw new Error(`invalid packaged runtime skill file: ${name}`);
  }
  return stripFrontMatter(fs.readFileSync(filePath, "utf8").replace(/\r\n/gu, "\n"));
}

function renderRuntimeSkill(name, bindings) {
  const template = [readRuntimeSkill("root"), readRuntimeSkill(name)].join("\n\n");
  const tokens = new Set([...template.matchAll(/\{\{([A-Z][A-Z0-9_]*)\}\}/gu)].map((match) => match[1]));
  const supplied = Object.keys(bindings || {});
  if ([...tokens].some((key) => !Object.prototype.hasOwnProperty.call(bindings || {}, key))
      || supplied.some((key) => !tokens.has(key))) {
    throw new Error(`runtime skill bindings do not match ${name}`);
  }
  return template.replace(/\{\{([A-Z][A-Z0-9_]*)\}\}/gu, (_, key) => String(bindings[key]));
}

module.exports = {
  FILES,
  MAX_SKILL_BYTES,
  ROOT,
  readRuntimeSkill,
  renderRuntimeSkill,
};
