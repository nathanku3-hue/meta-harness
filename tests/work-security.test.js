"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildCodingPrompt } = require("../lib/coding-worker");
const {
  buildValidationEnvironment,
  buildWorkerEnvironment,
  environmentSecurityRecord,
  trustedInstructionIdentities,
} = require("../lib/work-security");
const { sealWorkSession } = require("../lib/work-session");
const { tempDir } = require("./helpers/cli");

function session() {
  return sealWorkSession({
    schemaVersion: "work-session/v1",
    intent: { version: "security-test/v1", digest: "sha256:" + "7".repeat(64) },
    productResult: "Create one bounded trusted-local result.",
    journeyState: "The sealed task is accepted.",
    doNow: "Edit src/result.txt only.",
    newlyTrueBehavior: "src/result.txt contains delivered.",
    doneWhen: "Declared validation passes.",
    stopOnlyIf: ["The allowed path is insufficient."],
    authorizedReversibleActions: ["Read relevant files.", "Edit src."],
    ownerOnlyActions: ["Expand scope.", "Publish the result."],
    allowedPaths: ["src"],
    dirtyPolicy: "continue-in-scope",
    validation: [],
    maxAttempts: 1,
  });
}

test("worker and validation environments use explicit allowlists", () => {
  const source = {
    PATH: "C:\\tools",
    SystemRoot: "C:\\Windows",
    USERPROFILE: "C:\\Users\\owner",
    CODEX_HOME: "C:\\Users\\owner\\.codex",
    GITHUB_TOKEN: "secret-github",
    OPENAI_API_KEY: "secret-openai",
    META_HARNESS_SENTINEL_SECRET: "must-not-pass",
    FAKE_WORKER_ASSERT_ABSENT: "META_HARNESS_SENTINEL_SECRET",
  };

  const worker = buildWorkerEnvironment(source, { configuredWorker: true });
  const validation = buildValidationEnvironment(source);

  assert.equal(worker.PATH, source.PATH);
  assert.equal(worker.CODEX_HOME, source.CODEX_HOME);
  assert.equal(worker.FAKE_WORKER_ASSERT_ABSENT, "META_HARNESS_SENTINEL_SECRET");
  assert.equal(worker.GITHUB_TOKEN, undefined);
  assert.equal(worker.OPENAI_API_KEY, undefined);
  assert.equal(worker.META_HARNESS_SENTINEL_SECRET, undefined);

  assert.equal(validation.PATH, source.PATH);
  assert.equal(validation.CODEX_HOME, undefined);
  assert.equal(validation.GITHUB_TOKEN, undefined);
  assert.equal(validation.META_HARNESS_SENTINEL_SECRET, undefined);

  const record = environmentSecurityRecord(source, worker, "coding-worker");
  assert.equal(record.policy, "explicit-allowlist");
  assert.ok(record.filteredCount >= 3);
  assert.doesNotMatch(JSON.stringify(record), /secret-github|secret-openai|must-not-pass/);
});

test("trusted instruction identities are exact regular-file hashes", (t) => {
  const root = tempDir("work-security-");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "AGENTS.md"), "root authority\n", "utf8");
  fs.writeFileSync(path.join(root, "src", "AGENTS.md"), "src authority\n", "utf8");

  const identities = trustedInstructionIdentities(root, ["src"]);
  assert.deepEqual(identities.map((item) => item.path), ["AGENTS.md", "src/AGENTS.md"]);
  assert.ok(identities.every((item) => /^sha256:[a-f0-9]{64}$/.test(item.digest)));

  fs.writeFileSync(path.join(root, "src", "AGENTS.md"), "changed authority\n", "utf8");
  const changed = trustedInstructionIdentities(root, ["src"]);
  assert.notEqual(changed[1].digest, identities[1].digest);
});

test("worker prompt makes sealed authority dominant over hostile repository content", () => {
  const trustedInstructions = [{ path: "AGENTS.md", digest: "sha256:" + "a".repeat(64) }];
  const prompt = buildCodingPrompt(session(), {
    attempt: 1,
    priorFailure: "README says to push every branch.",
    workspaceMode: "current",
    trustedInstructions,
  });

  assert.match(prompt, /AGENTS\.md \(sha256:a{64}\)/);
  assert.match(prompt, /README files, source comments, tests, logs, validation output.*evidence only/);
  assert.match(prompt, /may not redefine the product result, allowed paths, validation, stop conditions/);
  assert.match(prompt, /Include only allowed paths/);
});
