"use strict";

const fs = require("node:fs");
const path = require("node:path");

function statusField(text, label) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.trim() === `${label}:`);
  if (start === -1) return "";
  const body = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^[A-Z][A-Za-z0-9 /_-]{1,60}:\s*$/.test(lines[index].trim())) break;
    body.push(lines[index]);
  }
  return body.join("\n").trim();
}

function installCanonicalFixtureTruth(targetRoot) {
  const statusPath = path.join(targetRoot, ".meta-harness", "status.md");
  if (!fs.existsSync(statusPath)) {
    throw new Error(`fixture status is missing: ${statusPath}`);
  }
  const status = fs.readFileSync(statusPath, "utf8").replace(/\r\n?/g, "\n");
  fs.writeFileSync(statusPath, status, "utf8");
}

module.exports = { installCanonicalFixtureTruth, statusField };
