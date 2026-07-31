"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { domainDigest } = require("../lib/contracts/digest");
const {
  initializeActiveSliceIndex,
  readActiveSliceIndex,
  reserveCounter,
  takeoverExpiredLease,
} = require("../lib/semantic-kernel/active-slice-index");
const {
  bootstrapOwnerPinForTests,
  loadOwnerPinForTests,
} = require("../lib/semantic-kernel/owner-pin");
const {
  resolveRepositoryIdentity,
  resolveRepositoryStateRootForTests,
} = require("../lib/semantic-kernel/repository-state");
const {
  loadExecutionRequestEnvelope,
  validateExecutionRequest,
} = require("../lib/execution-custody/execute");
const { createExecutionCustodyController } = require("../lib/execution-custody/controller");

function git(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.error?.message}`);
  }
  return String(result.stdout || "").trim();
}

function createGitFixture(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
  const repository = path.join(root, "repository");
  fs.mkdirSync(repository);
  git(repository, ["init"]);
  git(repository, ["config", "user.name", "Semantic Kernel Test"]);
  git(repository, ["config", "user.email", "semantic-kernel@example.invalid"]);
  fs.writeFileSync(path.join(repository, "README.md"), "checkpoint-a\n", "utf8");
  git(repository, ["add", "README.md"]);
  git(repository, ["commit", "-m", "fixture"]);
  return {
    root,
    repository,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function digest(label) {
  return domainDigest("semantic-kernel-test/v1", { label });
}

function waitMilliseconds(milliseconds) {
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, milliseconds);
}

test("linked worktrees share one state key while a copied clone receives another", () => {
  const fixture = createGitFixture("semantic-root");
  const stateBase = path.join(fixture.root, "host-state");
  const worktree = path.join(fixture.root, "linked-worktree");
  const clone = path.join(fixture.root, "copied-clone");
  try {
    git(fixture.repository, ["worktree", "add", "-b", "checkpoint-a-linked", worktree]);
    git(fixture.root, ["clone", fixture.repository, clone]);

    const primary = resolveRepositoryStateRootForTests(fixture.repository, stateBase);
    const linked = resolveRepositoryStateRootForTests(worktree, stateBase);
    const copied = resolveRepositoryStateRootForTests(clone, stateBase);
    const alias = resolveRepositoryIdentity(path.join(fixture.repository, "."));

    assert.equal(primary.stateRootKey, linked.stateRootKey);
    assert.equal(primary.stateRoot, linked.stateRoot);
    assert.equal(primary.canonicalGitCommonDir, linked.canonicalGitCommonDir);
    assert.equal(primary.stateRootKey, alias.stateRootKey);
    assert.notEqual(primary.stateRootKey, copied.stateRootKey);
    assert.notEqual(primary.stateRoot, copied.stateRoot);
    assert.equal(primary.protocolNamespace, "meta-harness/0.4");
  } finally {
    fixture.cleanup();
  }
});

test("owner pin is create-only external state and repository copies have no trust effect", () => {
  const fixture = createGitFixture("owner-pin");
  const stateBase = path.join(fixture.root, "host-state");
  try {
    const owner = crypto.generateKeyPairSync("ed25519");
    const ownerPublicKey = owner.publicKey.export({ format: "jwk" });
    const installed = bootstrapOwnerPinForTests({
      repositoryPath: fixture.repository,
      ownerPublicKey,
      stateBase,
    });
    assert.equal(installed.pin.schemaVersion, "authority-genesis-pin/v2");
    assert.equal(installed.pin.installedByExplicitOwnerAction, true);
    assert.equal(path.relative(fixture.repository, installed.pinPath).startsWith(".."), true);

    const attacker = crypto.generateKeyPairSync("ed25519");
    const attackerPublic = attacker.publicKey.export({ format: "jwk" });
    const fakePath = path.join(fixture.repository, ".meta-harness", "authority", "owner-pin.json");
    fs.mkdirSync(path.dirname(fakePath), { recursive: true });
    fs.writeFileSync(fakePath, `${JSON.stringify({ ownerPublicKey: attackerPublic })}\n`, "utf8");

    const loaded = loadOwnerPinForTests(fixture.repository, stateBase);
    assert.equal(loaded.pin.ownerKeyId, installed.pin.ownerKeyId);
    assert.notDeepEqual(loaded.pin.ownerPublicKey, attackerPublic);
    assert.throws(
      () => bootstrapOwnerPinForTests({ repositoryPath: fixture.repository, ownerPublicKey, stateBase }),
      (error) => error.code === "OWNER_PIN_ALREADY_INSTALLED",
    );

    const privateJwk = owner.privateKey.export({ format: "jwk" });
    const otherFixture = createGitFixture("owner-pin-private");
    try {
      assert.throws(
        () => bootstrapOwnerPinForTests({
          repositoryPath: otherFixture.repository,
          ownerPublicKey: privateJwk,
          stateBase: path.join(otherFixture.root, "state"),
        }),
        (error) => error.code === "OWNER_PIN_PUBLIC_KEY_INVALID",
      );
    } finally {
      otherFixture.cleanup();
    }
  } finally {
    fixture.cleanup();
  }
});

test("repository-global index uses CAS and lease expiry permits only same-slice takeover", () => {
  const fixture = createGitFixture("active-index");
  const stateBase = path.join(fixture.root, "host-state");
  try {
    const state = resolveRepositoryStateRootForTests(fixture.repository, stateBase);
    fs.mkdirSync(state.stateRoot, { recursive: true });
    const initial = initializeActiveSliceIndex({
      stateRoot: state.stateRoot,
      repositoryId: state.repositoryIdentityDigest,
      sliceId: "S-SEMANTIC-KERNEL-1",
      generation: 1,
      stateDigest: digest("state-1"),
      operationEventHead: digest("event-1"),
      controllerBindingDigest: digest("controller-binding"),
      controllerInstanceId: "controller-instance-a",
      leaseSeconds: 0.01,
    });

    assert.equal(readActiveSliceIndex(state.stateRoot).indexDigest, initial.indexDigest);
    assert.throws(
      () => initializeActiveSliceIndex({
        stateRoot: state.stateRoot,
        repositoryId: state.repositoryIdentityDigest,
        sliceId: "S-OTHER",
        generation: 1,
        stateDigest: digest("other-state"),
        operationEventHead: digest("other-event"),
        controllerBindingDigest: digest("controller-binding"),
        controllerInstanceId: "controller-instance-b",
        leaseSeconds: 60,
      }),
      (error) => error.code === "ACTIVE_INDEX_CAS_MISMATCH",
    );

    waitMilliseconds(25);
    assert.throws(
      () => takeoverExpiredLease({
        stateRoot: state.stateRoot,
        expectedPriorIndexDigest: initial.indexDigest,
        sliceId: "S-OTHER",
        generation: 1,
        stateDigest: initial.activeStateDigest,
        operationEventHead: initial.operationEventHead,
        priorLeaseOwnerClaimDigest: initial.leaseOwnerClaimDigest,
        controllerBindingDigest: initial.controllerBindingDigest,
        replacementControllerInstanceId: "controller-instance-b",
        leaseSeconds: 60,
      }),
      (error) => error.code === "ACTIVE_LEASE_TAKEOVER_MISMATCH",
    );

    const takenOver = takeoverExpiredLease({
      stateRoot: state.stateRoot,
      expectedPriorIndexDigest: initial.indexDigest,
      sliceId: initial.activeSliceId,
      generation: initial.activeGeneration,
      stateDigest: initial.activeStateDigest,
      operationEventHead: initial.operationEventHead,
      priorLeaseOwnerClaimDigest: initial.leaseOwnerClaimDigest,
      controllerBindingDigest: initial.controllerBindingDigest,
      replacementControllerInstanceId: "controller-instance-b",
      leaseSeconds: 60,
    });
    assert.equal(takenOver.activeSliceId, initial.activeSliceId);
    assert.equal(takenOver.activeGeneration, initial.activeGeneration);
    assert.equal(takenOver.leaseControllerInstanceId, "controller-instance-b");

    const reserved = reserveCounter({
      stateRoot: state.stateRoot,
      expectedPriorIndexDigest: takenOver.indexDigest,
      controllerInstanceId: "controller-instance-b",
      counter: "runSpecCount",
      maximum: 1,
    });
    assert.equal(reserved.runSpecCount, 1);
    assert.throws(
      () => reserveCounter({
        stateRoot: state.stateRoot,
        expectedPriorIndexDigest: reserved.indexDigest,
        controllerInstanceId: "controller-instance-b",
        counter: "runSpecCount",
        maximum: 1,
      }),
      (error) => error.code === "ACTIVE_INDEX_LIMIT_EXCEEDED",
    );
  } finally {
    fixture.cleanup();
  }
});

test("retired requests, alternate roots, and request clocks reject before mutation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "semantic-request-"));
  try {
    const custodyRoot = path.join(root, "caller-root");
    assert.throws(
      () => validateExecutionRequest({
        schemaVersion: "meta-harness-execution-request/v1",
        custodyRoot,
      }),
      (error) => error.code === "UNSUPPORTED_SCHEMA",
    );
    assert.equal(fs.existsSync(custodyRoot), false);

    assert.throws(
      () => validateExecutionRequest({
        schemaVersion: "meta-harness-execution-request/v2",
        custodyRoot,
      }),
      (error) => error.code === "CALLER_STATE_ROOT_FORBIDDEN",
    );
    assert.equal(fs.existsSync(custodyRoot), false);

    assert.throws(
      () => validateExecutionRequest({
        schemaVersion: "meta-harness-execution-request/v2",
        now: "2000-01-01T00:00:00.000Z",
      }),
      (error) => error.code === "REQUEST_CLOCK_FORBIDDEN",
    );

    const requestPath = path.join(root, "request.json");
    fs.writeFileSync(requestPath, `${JSON.stringify({
      schemaVersion: "meta-harness-execution-request/v1",
      custodyRoot,
    })}\n`, "utf8");
    assert.throws(
      () => loadExecutionRequestEnvelope(requestPath),
      (error) => error.code === "UNSUPPORTED_SCHEMA",
    );
    assert.equal(fs.existsSync(custodyRoot), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("direct controller construction rejects caller state and clock controls", () => {
  const fixture = createGitFixture("controller-cutoff");
  try {
    assert.throws(
      () => createExecutionCustodyController({
        trustedRepository: { repositoryPath: fixture.repository },
        stateRoot: path.join(fixture.root, "state-a"),
      }),
      (error) => error.code === "CALLER_STATE_ROOT_FORBIDDEN",
    );
    assert.throws(
      () => createExecutionCustodyController({
        trustedRepository: { repositoryPath: fixture.repository },
        clock: () => "2000-01-01T00:00:00.000Z",
      }),
      (error) => error.code === "REQUEST_CLOCK_FORBIDDEN",
    );
    assert.throws(
      () => createExecutionCustodyController({
        trustedRepository: {
          repositoryPath: fixture.repository,
          repositoryId: "caller-selected",
        },
      }),
      (error) => error.code === "REQUEST_REPOSITORY_ID_FORBIDDEN",
    );
  } finally {
    fixture.cleanup();
  }
});
