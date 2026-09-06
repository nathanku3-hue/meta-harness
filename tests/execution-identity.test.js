"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  attemptInputKey,
  toolSurfaceDigest,
  validationEnvironmentDigest,
  validationKey,
} = require("../lib/execution-identity");

function session() {
  return {
    productDirection: { digest: `sha256:${"a".repeat(64)}` },
    origin: { type: "OWNER_GOAL" },
    productResult: "Ship the useful result.",
    journeyState: "The result is not true yet.",
    doNow: "Implement it.",
    newlyTrueBehavior: "The result works.",
    doneWhen: "Validation proves the behavior.",
    stopOnlyIf: ["No in-scope route remains."],
    allowedPaths: ["src", "tests"],
    productProofSpec: { specDigest: `sha256:${"b".repeat(64)}` },
  };
}

test("attempt identity changes only when product, snapshot, tool surface, or runtime input changes", () => {
  const baseSession = session();
  const runtime = `sha256:${"c".repeat(64)}`;
  const base = attemptInputKey({
    session: baseSession,
    snapshotTreeOid: "d".repeat(40),
    runtimeCapabilityDigest: runtime,
  });
  assert.equal(base, attemptInputKey({
    session: session(),
    snapshotTreeOid: "d".repeat(40),
    runtimeCapabilityDigest: runtime,
  }));
  assert.notEqual(base, attemptInputKey({
    session: session(),
    snapshotTreeOid: "e".repeat(40),
    runtimeCapabilityDigest: runtime,
  }));
  assert.notEqual(base, attemptInputKey({
    session: { ...session(), allowedPaths: ["src"] },
    snapshotTreeOid: "d".repeat(40),
    runtimeCapabilityDigest: runtime,
  }));
  assert.notEqual(base, attemptInputKey({
    session: session(),
    snapshotTreeOid: "d".repeat(40),
    runtimeCapabilityDigest: `sha256:${"f".repeat(64)}`,
  }));
});

test("tool surface is content-derived from actual scoped operations", () => {
  const broad = toolSurfaceDigest(session());
  const narrow = toolSurfaceDigest({ ...session(), allowedPaths: ["src"] });
  assert.match(broad, /^sha256:[a-f0-9]{64}$/u);
  assert.notEqual(broad, narrow);
});

test("validation key changes with candidate, commands, or validation environment", () => {
  const runtimeA = `sha256:${"1".repeat(64)}`;
  const runtimeB = `sha256:${"2".repeat(64)}`;
  const environmentA = validationEnvironmentDigest(runtimeA);
  const environmentB = validationEnvironmentDigest(runtimeB);
  const commands = [{ argv: ["node", "test.js"], cwd: ".", timeoutSeconds: 30 }];
  const base = validationKey({
    candidateTreeOid: "3".repeat(40),
    validation: commands,
    validationEnvironmentDigest: environmentA,
  });
  assert.equal(base, validationKey({
    candidateTreeOid: "3".repeat(40),
    validation: JSON.parse(JSON.stringify(commands)),
    validationEnvironmentDigest: environmentA,
  }));
  assert.notEqual(base, validationKey({
    candidateTreeOid: "4".repeat(40),
    validation: commands,
    validationEnvironmentDigest: environmentA,
  }));
  assert.notEqual(base, validationKey({
    candidateTreeOid: "3".repeat(40),
    validation: [{ argv: ["node", "other.js"], cwd: ".", timeoutSeconds: 30 }],
    validationEnvironmentDigest: environmentA,
  }));
  assert.notEqual(base, validationKey({
    candidateTreeOid: "3".repeat(40),
    validation: commands,
    validationEnvironmentDigest: environmentB,
  }));
});
