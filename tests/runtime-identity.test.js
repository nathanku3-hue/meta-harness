"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  ensureRepositoryIdentity,
  pathIdentity,
  readRepositoryIdentity,
  runtimeCapabilityDigest,
} = require("../lib/runtime-identity");

test("repository path identity collapses Windows and WSL spellings", () => {
  assert.equal(pathIdentity("E:\\Code\\meta-harness"), pathIdentity("/mnt/e/Code/meta-harness"));
  assert.equal(pathIdentity("E:/Code/meta-harness"), pathIdentity("/mnt/e/code/meta-harness"));
  assert.notEqual(pathIdentity("E:\\Code\\meta-harness"), pathIdentity("E:\\Code\\other"));
});

test("repository identity is durable and independent of process lifetime", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mh-repository-id-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const first = ensureRepositoryIdentity(root, new Date("2026-09-05T00:00:00.000Z"));
  const second = ensureRepositoryIdentity(root, new Date("2026-09-06T00:00:00.000Z"));
  const reread = readRepositoryIdentity(root);

  assert.equal(second.repositoryId, first.repositoryId);
  assert.equal(reread.repositoryId, first.repositoryId);
  assert.equal(reread.createdAt, first.createdAt);
  assert.match(first.identityDigest, /^sha256:[a-f0-9]{64}$/u);
});

test("runtime capability identity changes when the live capability descriptor changes", () => {
  const base = runtimeCapabilityDigest({});
  const first = runtimeCapabilityDigest({
    META_HARNESS_RUNTIME_CAPABILITIES_JSON: JSON.stringify({ devspace: "live-a", tools: ["read", "edit"] }),
  });
  const same = runtimeCapabilityDigest({
    META_HARNESS_RUNTIME_CAPABILITIES_JSON: JSON.stringify({ devspace: "live-a", tools: ["read", "edit"] }),
  });
  const changed = runtimeCapabilityDigest({
    META_HARNESS_RUNTIME_CAPABILITIES_JSON: JSON.stringify({ devspace: "live-b", tools: ["read", "edit", "snapshot"] }),
  });

  assert.match(base, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(first, same);
  assert.notEqual(first, changed);
});
