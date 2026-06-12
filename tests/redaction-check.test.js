"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { scanRedactionSurfaces, scanTextForSecrets } = require("../lib/redaction-check");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-redaction-"));
}

function writeFile(root, relativePath, content) {
  const filePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

test("redaction scanner detects common secret-like output", () => {
  const text = [
    "aws=AKIAIOSFODNN7EXAMPLE",
    "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789",
    "DATABASE_URL=postgres://user:pass@example.com:5432/app",
    "-----BEGIN PRIVATE KEY-----"
  ].join("\n");

  const result = scanTextForSecrets(text, { path: "brief.md" });

  assert.equal(result.status, "FAIL");
  assert.ok(result.findings.find(item => item.id === "AWS_ACCESS_KEY_ID"));
  assert.ok(result.findings.find(item => item.id === "BEARER_TOKEN"));
  assert.ok(result.findings.find(item => item.id === "CONNECTION_STRING"));
  assert.ok(result.findings.find(item => item.id === "PRIVATE_KEY_BLOCK"));
});

test("redaction scanner allows benign hashes, UUIDs, integrity strings, public keys, and registry URLs", () => {
  const text = [
    "sha256=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "id=550e8400-e29b-41d4-a716-446655440000",
    "integrity=sha512-YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=",
    "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC7 fake@example.com",
    "-----BEGIN PUBLIC KEY-----",
    "resolved=https://registry.npmjs.org/meta-harness/-/meta-harness-0.1.0.tgz"
  ].join("\n");

  const result = scanTextForSecrets(text, { path: "package-lock.json" });

  assert.equal(result.status, "PASS");
  assert.deepEqual(result.findings, []);
});

test("redaction scanner checks committed context artifacts when surface is registered", () => {
  const cwd = tempDir();
  writeFile(cwd, ".meta-harness/context/ROUND-001.md", [
    "# Context Gate",
    "",
    "Leaked key: AKIAIOSFODNN7EXAMPLE",
    ""
  ].join("\n"));

  const result = scanRedactionSurfaces({
    targetRoot: cwd,
    surfaces: [
      ".meta-harness/events.jsonl",
      ".meta-harness/workers/",
      ".meta-harness/expert-packets/",
      ".meta-harness/briefs/",
      ".meta-harness/context/"
    ],
  });

  assert.equal(result.status, "FAIL");
  assert.equal(result.findings.some((item) => item.id === "AWS_ACCESS_KEY_ID"), true);
  assert.equal(result.findings.some((item) => item.path === ".meta-harness/context/ROUND-001.md"), true);
});
