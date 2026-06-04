"use strict";

const fs = require("node:fs");
const path = require("node:path");

const HARNESS_DIR = ".meta-harness";

function harnessPath(...parts) {
  return path.join(process.cwd(), HARNESS_DIR, ...parts);
}

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function fileExists(targetPath) {
  return fs.existsSync(targetPath);
}

function readText(targetPath, fallback = "") {
  if (!fileExists(targetPath)) {
    return fallback;
  }
  return fs.readFileSync(targetPath, "utf8");
}

function writeText(targetPath, content) {
  fs.writeFileSync(targetPath, content, "utf8");
}

function writeIfMissing(targetPath, content) {
  if (!fileExists(targetPath)) {
    writeText(targetPath, content);
  }
}

module.exports = {
  HARNESS_DIR,
  ensureDir,
  fileExists,
  harnessPath,
  readText,
  writeIfMissing,
  writeText,
};
