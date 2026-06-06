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

function writeTextAtomic(targetPath, content) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(dir, `.tmp.${path.basename(targetPath)}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}`);
  try {
    fs.writeFileSync(tempPath, content, "utf8");
    fs.renameSync(tempPath, targetPath);
  } catch (error) {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch (_) {}
    throw error;
  }
}

function writeJsonAtomic(targetPath, value) {
  writeTextAtomic(targetPath, JSON.stringify(value, null, 2) + "\n");
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
  writeTextAtomic,
  writeJsonAtomic,
};
