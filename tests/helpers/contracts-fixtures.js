"use strict";

/** Test-only D068 fixture builders (not production exports). */
const path = require("node:path");
const { domainDigest } = require("../../lib/contracts/digest");
const { freezeDeep, cloneStrict } = require("../../lib/contracts/canonical-json");
const {
  computeRunSpecDigest,
  commandIdFromSpecCommand,
} = require("../../lib/contracts/run-spec");
const { sealRunSpecApproval } = require("../../lib/contracts/run-spec-approval");
const { sealExecutionReadinessFacts } = require("../../lib/contracts/execution-readiness-facts");
const {
  computeWorkspacePolicyDigest,
  computeAuthorizationPolicyDigest,
} = require("../../lib/contracts/attempt-authorization");
const { authorizeAttempt } = require("../../lib/contracts/authorize");
const { sealWorkspaceAttestation } = require("../../lib/contracts/workspace-attestation");
const { evaluateWorkspaceStart } = require("../../lib/contracts/workspace-start");
const { sealImplementationFacts } = require("../../lib/contracts/implementation-facts");
const { evaluateImplementationFacts } = require("../../lib/contracts/implementation-assessment");

const BASE_SHA = "abc123def4567890abc123def4567890abc123de";
const HEAD_SHA = "def4567890abc123def4567890abc123def45678";

const NOW = "2026-07-11T12:00:00.000Z";
const APPROVED_AT = "2026-07-11T11:00:00.000Z";
const INSPECTED_AT = "2026-07-11T11:30:00.000Z";

const APPROVED_ROOT = path.resolve("/approved/root");
const FIXTURE_REPO_ROOT = path.join(APPROVED_ROOT, ".worktrees", "mh-run-0001");
const OUTSIDE_REPO_ROOT = path.resolve("/other/root/repo");

const WORKSPACE_POLICY = Object.freeze({
  schemaVersion: "workspace-policy/v1",
  approvedRoot: APPROVED_ROOT,
});

const POLICY = Object.freeze({
  authorizationTtlSeconds: 3600,
  maxReadinessAgeSeconds: 7200,
  maxCommandTimeoutSeconds: 3600,
  provider: { id: "agent-orchestrator", workerProfile: "codex-primary" },
  workspacePolicy: { ...WORKSPACE_POLICY },
});

function workspacePolicyDigest(policy = WORKSPACE_POLICY) {
  return computeWorkspacePolicyDigest(policy);
}

function buildRunSpecFixture(over = {}) {
  const base = {
    schemaVersion: "run-spec/v1",
    runId: "RUN-0001",
    repository: {
      repositoryId: "example",
      objectFormat: "sha1",
      expectedBaseRevision: BASE_SHA,
    },
    objective: "Fix session expiration and add regression tests.",
    scope: {
      allow: ["src/session/**", "tests/session/**"],
      deny: ["migrations/**", "infrastructure/**"],
    },
    validation: {
      commands: [
        {
          argv: ["npm", "test", "--", "session"],
          cwdRelative: ".",
          timeoutSeconds: 600,
          networkPolicy: "denied",
          environmentPolicy: { allow: ["CI", "NODE_ENV"] },
        },
      ],
    },
    changePolicy: "forbid-noop",
  };
  return freezeDeep(deepMerge(base, over));
}

function buildApprovalFixture(specOver = {}, approvalOver = {}) {
  const runSpec = buildRunSpecFixture(specOver);
  const runSpecDigest = computeRunSpecDigest(runSpec);
  return sealRunSpecApproval({
    schemaVersion: "run-spec-approval/v1",
    approvalId: "APR-0001",
    approvedBy: "operator@example",
    approvedAt: APPROVED_AT,
    runSpec,
    runSpecDigest,
    ...approvalOver,
    runSpec: approvalOver.runSpec || runSpec,
    runSpecDigest: approvalOver.runSpecDigest || runSpecDigest,
  });
}

function buildReadinessFacts(approval, over = {}) {
  const runSpec = approval.runSpec;
  const body = {
    schemaVersion: "execution-readiness-facts/v1",
    runSpecDigest: approval.runSpecDigest,
    repositoryId: runSpec.repository.repositoryId,
    objectFormat: runSpec.repository.objectFormat,
    observedHeadRevision: runSpec.repository.expectedBaseRevision,
    clean: true,
    inspectedAt: INSPECTED_AT,
    workspacePolicyDigest: workspacePolicyDigest(),
    ...over,
  };
  return sealExecutionReadinessFacts(body);
}

function authRequest(over = {}) {
  return {
    authorizationId: "AUTH-0001",
    attemptId: "ATTEMPT-1",
    ...over,
  };
}

function authorizeFixture(specOver = {}, requestOver = {}, optionOver = {}) {
  const approval = optionOver.approval || buildApprovalFixture(specOver, optionOver.approvalOver);
  const readiness = optionOver.readiness
    || buildReadinessFacts(approval, optionOver.readinessOver);
  const policy = optionOver.policy || POLICY;
  const options = {
    now: optionOver.now || NOW,
    policy,
  };
  if (Object.prototype.hasOwnProperty.call(optionOver, "priorReceipt")
    && optionOver.priorReceipt !== undefined) {
    options.priorReceipt = optionOver.priorReceipt;
  }
  const result = authorizeAttempt(approval, readiness, authRequest(requestOver), options);
  return {
    approval,
    runSpec: approval.runSpec,
    readiness,
    result,
    receipt: result.authorizationReceipt,
    policy,
  };
}

function buildAttestationFixture(runSpec, receipt, over = {}) {
  const body = {
    schemaVersion: "workspace-attestation/v1",
    runId: runSpec.runId,
    attemptId: receipt.attemptId,
    provider: receipt.provider.id,
    repositoryId: runSpec.repository.repositoryId,
    objectFormat: runSpec.repository.objectFormat,
    workspaceRef: over.workspaceRef || "ws-fixture-1",
    repositoryRoot: over.repositoryRoot || FIXTURE_REPO_ROOT,
    branch: over.branch || "mh/run-0001",
    baseRevision: runSpec.repository.expectedBaseRevision,
    currentHead: runSpec.repository.expectedBaseRevision,
    clean: over.clean != null ? over.clean : true,
    runSpecDigest: receipt.runSpecDigest,
    authorizationReceiptDigest: receipt.receiptDigest,
    workspacePolicyDigest: receipt.workspacePolicyDigest,
    collectedAt: over.collectedAt || "2026-07-11T12:05:00.000Z",
  };
  const merged = { ...body, ...over };
  merged.runSpecDigest = receipt.runSpecDigest;
  merged.authorizationReceiptDigest = receipt.receiptDigest;
  merged.workspacePolicyDigest = over.workspacePolicyDigest || receipt.workspacePolicyDigest;
  merged.attemptId = receipt.attemptId;
  merged.repositoryId = over.repositoryId || runSpec.repository.repositoryId;
  merged.objectFormat = over.objectFormat || runSpec.repository.objectFormat;
  return sealWorkspaceAttestation(merged);
}

function startFixture(specOver = {}, attOver = {}, now = "2026-07-11T12:10:00.000Z") {
  const { runSpec, receipt, result, approval, readiness, policy } = authorizeFixture(specOver);
  if (!result.ok) throw new Error(JSON.stringify(result.reasons));
  const attestation = buildAttestationFixture(runSpec, receipt, attOver);
  const start = evaluateWorkspaceStart({
    runSpec,
    authorizationReceipt: receipt,
    attestation,
    workspacePolicy: policy.workspacePolicy,
    now,
  });
  return { runSpec, receipt, attestation, start, approval, readiness, policy };
}

function buildTrustedFacts(runSpec, receipt, attestation, startCheck, over = {}) {
  const head = over.headRevision || HEAD_SHA;
  const commands = (runSpec.validation.commands || []).map((cmd, i) => {
    const commandId = commandIdFromSpecCommand(cmd);
    return {
      commandId,
      argv: cmd.argv.slice(),
      cwdRelative: cmd.cwdRelative,
      timeoutSeconds: cmd.timeoutSeconds,
      networkPolicy: cmd.networkPolicy,
      environmentPolicy: {
        allow: cmd.environmentPolicy.allow.slice(),
      },
      startedAt: over.commandStartedAt || "2026-07-11T12:15:00.000Z",
      endedAt: over.commandEndedAt || "2026-07-11T12:15:05.000Z",
      exitCode: 0,
      timedOut: false,
      headBefore: head,
      headAfter: head,
      networkAttempted: false,
      stdoutArtifact: domainDigest("artifact/v1", { stream: "stdout", i }),
      stderrArtifact: domainDigest("artifact/v1", { stream: "stderr", i }),
    };
  });

  const body = {
    schemaVersion: "implementation-facts/v1",
    bindings: {
      runSpecDigest: receipt.runSpecDigest,
      authorizationReceiptDigest: receipt.receiptDigest,
      workspaceAttestationDigest: attestation.attestationDigest,
      startCheckDigest: startCheck.startCheckDigest,
      attemptId: receipt.attemptId,
      repositoryId: runSpec.repository.repositoryId,
    },
    git: {
      repositoryId: runSpec.repository.repositoryId,
      objectFormat: runSpec.repository.objectFormat,
      baseRevision: runSpec.repository.expectedBaseRevision,
      headRevision: head,
      baseIsAncestor: true,
      clean: true,
      changedFiles: [
        { status: "M", path: "src/session/expiry.js" },
        { status: "A", path: "tests/session/expiry.test.js" },
      ],
      collectedAt: over.gitCollectedAt || "2026-07-11T12:16:00.000Z",
      nameStatusArtifact: domainDigest("artifact/v1", { nameStatus: "fixture" }),
      patchArtifact: domainDigest("artifact/v1", { patch: "fixture" }),
    },
    commands,
    collectedAt: over.factsCollectedAt || "2026-07-11T12:16:30.000Z",
  };
  const merged = deepMerge(body, over.facts || {});
  return sealImplementationFacts(merged);
}

function verifyFixture(specOver = {}) {
  const { runSpec, receipt, attestation, start, policy } = startFixture(specOver);
  if (!start.ok) throw new Error(JSON.stringify(start.reasons));
  const facts = buildTrustedFacts(runSpec, receipt, attestation, start.startCheck);
  const impl = evaluateImplementationFacts({
    runSpec,
    authorizationReceipt: receipt,
    workspaceAttestation: attestation,
    startCheck: start.startCheck,
    trustedImplementationFacts: facts,
    workspacePolicy: policy.workspacePolicy,
  });
  return { runSpec, receipt, attestation, start, facts, impl, policy };
}

function deepMerge(base, over) {
  if (!over || typeof over !== "object" || Array.isArray(over)) return { ...base };
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const nest = v && typeof v === "object" && !Array.isArray(v)
      && base[k] && typeof base[k] === "object" && !Array.isArray(base[k]);
    out[k] = nest ? deepMerge(base[k], v) : v;
  }
  return out;
}

/** Real-shaped D064/D065 objects — not authority inputs. */
function realOperatorPlanArtifact() {
  return {
    kind: "operator_execution_plan_artifact",
    packet_id: "MWP-0001",
    operator_execution_plan: { selected_repo: "example", target_paths: ["src/session"] },
  };
}

function realExecutionReadiness() {
  return {
    ok: true, verdict: "ready", selected_repo: "other-repo",
    captured: { head_commit: "f".repeat(40), is_clean: true },
    plan_artifact_digest: `sha256:${"a".repeat(64)}`,
  };
}

module.exports = {
  BASE_SHA, HEAD_SHA, NOW, APPROVED_AT, INSPECTED_AT, POLICY, WORKSPACE_POLICY,
  APPROVED_ROOT, FIXTURE_REPO_ROOT, OUTSIDE_REPO_ROOT,
  workspacePolicyDigest, buildRunSpecFixture, buildApprovalFixture, buildReadinessFacts,
  authRequest, authorizeFixture, buildAttestationFixture, startFixture, buildTrustedFacts,
  verifyFixture, realOperatorPlanArtifact, realExecutionReadiness, deepMerge, cloneStrict,
  freezeDeep, computeRunSpecDigest, domainDigest, computeAuthorizationPolicyDigest,
};
