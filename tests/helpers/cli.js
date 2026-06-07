"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const CLI = path.join(ROOT, "bin", "meta-harness.js");

function tempDir(prefix = "meta-harness-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function run(cwd, args, options = {}) {
  const result = runRaw(cwd, args, options);
  if (result.status !== 0) {
    throw new Error(`Command failed: ${args.join(" ")}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result.stdout;
}

function runRaw(cwd, args, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    shell: false,
    ...options,
  });
}

function errorCode(result) {
  return result.stderr.match(/meta-harness: ([A-Z0-9_]+):/)?.[1];
}

function assertCliError(result, code, pattern) {
  assert.notEqual(result.status, 0);
  assert.equal(errorCode(result), code, result.stderr);
  assert.match(result.stderr, pattern);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function writeFile(root, relativePath, content) {
  const filePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

function snapshotTree(root) {
  const items = [];
  function walk(directoryPath) {
    for (const name of fs.readdirSync(directoryPath).sort((left, right) => left.localeCompare(right))) {
      const itemPath = path.join(directoryPath, name);
      const relative = path.relative(root, itemPath).split(path.sep).join("/");
      const stat = fs.lstatSync(itemPath);
      if (stat.isDirectory()) {
        items.push({ path: relative, type: "dir" });
        walk(itemPath);
      } else if (stat.isFile()) {
        items.push({ path: relative, type: "file", content: fs.readFileSync(itemPath).toString("base64") });
      } else if (stat.isSymbolicLink()) {
        items.push({ path: relative, type: "symlink", link: fs.readlinkSync(itemPath) });
      }
    }
  }
  walk(root);
  return items;
}

function fencedBlockCount(text) {
  return (text.match(/```/g) || []).length;
}

function zipEntryText(zipBytes, entryName) {
  let offset = 0;
  while (offset + 4 <= zipBytes.length) {
    const signature = zipBytes.readUInt32LE(offset);
    if (signature !== 0x04034b50) {
      break;
    }
    const flags = zipBytes.readUInt16LE(offset + 6);
    const compressionMethod = zipBytes.readUInt16LE(offset + 8);
    assert.equal(compressionMethod, 0, "zipEntryText assumes stored entries");
    assert.equal(flags & 0x08, 0, "zipEntryText assumes no data descriptor");
    const compressedSize = zipBytes.readUInt32LE(offset + 18);
    const nameLength = zipBytes.readUInt16LE(offset + 26);
    const extraLength = zipBytes.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + nameLength;
    const name = zipBytes.subarray(nameStart, nameEnd).toString("utf8");
    const dataStart = nameEnd + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (name === entryName) {
      return zipBytes.subarray(dataStart, dataEnd).toString("utf8");
    }
    offset = dataEnd;
  }
  throw new Error(`Missing zip entry: ${entryName}`);
}

function assertSkillFrontMatter(text, name) {
  assert.match(text, /^---\nname: [a-z0-9-]+\ndescription: .+\n---/);
  assert.match(text, new RegExp(`^name: ${name}$`, "m"));
}

module.exports = {
  CLI,
  ROOT,
  assertCliError,
  assertSkillFrontMatter,
  errorCode,
  fencedBlockCount,
  readJsonl,
  run,
  runRaw,
  snapshotTree,
  tempDir,
  writeFile,
  zipEntryText,
};
