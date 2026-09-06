"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const {
  acquireRepositoryLock,
  releaseRepositoryLock,
  repositoryLockPath,
  withRepositoryLock,
} = require("../lib/repository-lock");
const { repository } = require("./helpers/linear-product-head");

test("repository locks coordinate only the named decision", (t) => {
  const { root } = repository(t);
  const result = withRepositoryLock(root, "owner-objective", () => (
    withRepositoryLock(root, "owner-goal-ingress", () => "independent")
  ));
  assert.equal(result, "independent");
});

test("a live repository lock cannot be stolen by another acquisition", (t) => {
  const { root } = repository(t);
  const lock = acquireRepositoryLock(root, "owner-objective");
  try {
    assert.throws(
      () => acquireRepositoryLock(root, "owner-objective", { attempts: 1, waitMs: 0 }),
      (error) => error.code === "MH_REPOSITORY_LOCK_BUSY",
    );
  } finally {
    releaseRepositoryLock(lock);
  }
});

test("a dead repository lock is discarded and the named decision can continue", (t) => {
  const { root } = repository(t);
  const filePath = repositoryLockPath(root, "owner-objective");
  fs.writeFileSync(filePath, `${JSON.stringify({
    token: "dead-lock-token-0000000000000000",
    pid: 2147483647,
    acquiredAt: "2026-09-01T00:00:00.000Z",
  })}\n`, "utf8");

  const recovered = acquireRepositoryLock(root, "owner-objective", { attempts: 5, waitMs: 0 });
  assert.notEqual(recovered.token, "dead-lock-token-0000000000000000");
  releaseRepositoryLock(recovered);
  assert.equal(fs.existsSync(filePath), false);
});
