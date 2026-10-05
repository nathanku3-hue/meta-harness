"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { closureWorkspaceId, readExecutionWorkResult, validateExecutionClosure } = require("./execution-closure");
const { compareAndSwapIntegrationHead, readIntegrationHead } = require("./optimistic-integration");
const {
  appendRunEvent,
  readRunJournal,
  readRunSession,
  runIdForExecution,
  runIdForSession,
} = require("./run-journal");
const {
  PRODUCT_HEAD_REF,
  PRODUCT_INTEGRATION_DOMAIN,
  PRODUCT_INTEGRATION_SCHEMA,
  PRODUCT_INTEGRATION_VALIDATION_DOMAIN,
  allProductIntegrationReceipts,
  computeProductIntegrationDigest,
  latestIntegrationReceiptForProductCommit,
  readProductIntegration,
  requireOid,
  validateProductIntegration,
} = require("./repo-product-integration-record");
const { commonGitDirectory, repositoryRoot, runGit } = require("./work-git");
const { evaluateStructuralSaw, preparePredecessorStructuralSaw } = require("./repo-structural-saw");
const { verifyRetainedSessionObligation } = require("./repo-product-proof-retention");
const { persistImmutableJson } = require("./protocol-store");
const { validateWorkSession } = require("./work-session");

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function normalizedPaths(value) {
  if (!Array.isArray(value)) fail("MH_PRODUCT_INTEGRATION_PATH", "changed paths must be an array");
  const paths = value.map((entry) => String(entry || "").replace(/\\/gu, "/")).filter(Boolean).sort();
  if (new Set(paths).size !== paths.length) fail("MH_PRODUCT_INTEGRATION_PATH", "changed paths must be unique");
  return paths;
}

function exactWorkResult(repositoryPath, closure) {
  const validated = validateExecutionClosure(closure);
  if (validated.workResultDigest === null) return null;
  const result = readExecutionWorkResult(repositoryPath, validated.workResultDigest);
  if (!result || result.workResultDigest !== validated.workResultDigest) {
    fail("MH_PRODUCT_INTEGRATION_WORK_RESULT", "integration cannot resolve the Closure's exact durable work result");
  }
  return result;
}

function sessionForClosure(repositoryPath, closure) {
  const validated = validateExecutionClosure(closure);
  const session = readRunSession({
    gitCommonDirectory: commonGitDirectory(repositoryPath),
    runId: runIdForSession(validated.sessionDigest),
  });
  if (session.sessionDigest !== validated.sessionDigest
      || session.origin.type !== "REPO_RUN"
      || session.origin.outcomeDigest !== validated.origin.outcomeDigest) {
    fail("MH_PRODUCT_INTEGRATION_SESSION", "run journal session does not match the execution closure");
  }
  return session;
}

function bankEvidence(repositoryPath, closure, workResult = null) {
  const result = workResult || exactWorkResult(repositoryPath, closure);
  if (!result || result.result?.outcome !== "DONE") {
    fail("MH_PRODUCT_INTEGRATION_WORK_RESULT", "only DONE work results may enter canonical product code");
  }
  const session = validateWorkSession(sessionForClosure(repositoryPath, closure));
  const outcomeDigest = closure.origin.outcomeDigest;
  if (session.sessionDigest !== closure.sessionDigest || session.origin.outcomeDigest !== outcomeDigest) {
    fail("MH_PRODUCT_INTEGRATION_SESSION", "run/session/Closure identity does not agree for integration");
  }
  const commit = result.result?.delivery?.commit;
  if (!commit || !new Set(["committed", "no_changes"]).has(commit.status)) {
    fail("MH_PRODUCT_INTEGRATION_BANK", "DONE work result lacks exact local BANK commit evidence");
  }
  const bankCommit = requireOid(commit.sha, "workResult.delivery.commit.sha");
  const acceptance = result.result?.acceptance;
  if (!acceptance
      || !isDigest(acceptance.acceptanceDigest)
      || !isDigest(acceptance.candidateSealDigest)
      || !isDigest(acceptance.verificationDigest)) {
    fail("MH_PRODUCT_INTEGRATION_BANK", "DONE work result lacks accepted candidate/validation evidence");
  }
  runGit(repositoryPath, ["cat-file", "-e", `${bankCommit}^{commit}`]);
  if (commit.status === "committed") {
    const parents = String(runGit(repositoryPath, ["rev-list", "--parents", "-n", "1", bankCommit]).stdout || "").trim().split(/\s+/u);
    if (parents.length !== 2 || parents[1] !== session.base.commit) {
      fail("MH_PRODUCT_INTEGRATION_BANK", "worker BANK commit must have the sealed session base as its unique parent");
    }
  } else if (bankCommit !== session.base.commit) {
    fail("MH_PRODUCT_INTEGRATION_BANK", "no_changes BANK must identify the sealed base commit");
  }
  const actualPaths = normalizedPaths(String(runGit(repositoryPath, [
    "diff", "--name-only", "--no-renames", session.base.commit, bankCommit,
  ]).stdout || "").split(/\r?\n/u).filter(Boolean));
  const expectedPaths = normalizedPaths(result.result.changedPaths || []);
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    fail("MH_PRODUCT_INTEGRATION_BANK", "worker BANK changed paths do not match durable work-result evidence", {
      expected: expectedPaths,
      actual: actualPaths,
    });
  }
  const acceptedValidation = Array.isArray(acceptance.validation) && acceptance.validation.length > 0
    ? acceptance.validation
    : session.validation;
  if (!Array.isArray(acceptedValidation) || acceptedValidation.length === 0) {
    fail("MH_PRODUCT_INTEGRATION_BANK", "DONE work result lacks a replayable accepted validation contract");
  }
  return Object.freeze({
    outcomeDigest,
    closure,
    workResult: result,
    session,
    bankCommit,
    changedPaths: expectedPaths,
    candidateSealDigest: acceptance.candidateSealDigest,
    validation: Object.freeze(JSON.parse(JSON.stringify(acceptedValidation))),
  });
}

function integrationWorkspace(repositoryPath, predecessorProductCommit) {
  const root = repositoryRoot(repositoryPath);
  requireOid(predecessorProductCommit, "predecessorProductCommit");
  runGit(root, ["cat-file", "-e", `${predecessorProductCommit}^{commit}`]);
  const holder = fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-product-integration-"));
  const workspacePath = path.join(holder, "workspace");
  const branch = `meta-harness/integration-${crypto.randomUUID().replace(/-/gu, "")}`;
  runGit(root, ["worktree", "add", "-b", branch, workspacePath, predecessorProductCommit]);
  return { root, holder, workspacePath, branch, predecessorProductCommit };
}

function cleanupIntegrationWorkspace(candidate) {
  if (!candidate) return;
  const root = candidate.root || candidate.repositoryRoot;
  if (root && candidate.workspacePath) {
    runGit(root, ["worktree", "remove", "--force", candidate.workspacePath], { allowFailure: true });
  }
  if (root && candidate.branch) runGit(root, ["branch", "-D", candidate.branch], { allowFailure: true });
  if (candidate.holder) fs.rmSync(candidate.holder, { recursive: true, force: true });
}

function integrationCommitEnv() {
  const timestamp = "2000-01-01T00:00:00Z";
  return {
    ...process.env,
    GIT_AUTHOR_NAME: "Meta-Harness Integration",
    GIT_AUTHOR_EMAIL: "integration@meta-harness.invalid",
    GIT_COMMITTER_NAME: "Meta-Harness Integration",
    GIT_COMMITTER_EMAIL: "integration@meta-harness.invalid",
    GIT_AUTHOR_DATE: timestamp,
    GIT_COMMITTER_DATE: timestamp,
  };
}

function integrationLineage(repositoryPath, productCommit) {
  requireOid(productCommit, "productCommit");
  const receipts = [];
  const seen = new Set();
  let cursor = productCommit;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const receipt = latestIntegrationReceiptForProductCommit(repositoryPath, cursor);
    if (!receipt) break;
    receipts.push(receipt);
    cursor = receipt.predecessorProductCommit;
  }
  return Object.freeze(receipts.reverse());
}

function retainedSessions(repositoryPath, predecessorProductCommit, currentSession, currentValidation) {
  const obligations = integrationLineage(repositoryPath, predecessorProductCommit).map((receipt) => {
    const session = readRunSession({
      gitCommonDirectory: commonGitDirectory(repositoryPath),
      runId: runIdForSession(receipt.sessionDigest),
    });
    const workResult = readExecutionWorkResult(repositoryPath, receipt.workResultDigest);
    const acceptedValidation = workResult?.result?.acceptance?.validation;
    const validation = Array.isArray(acceptedValidation) && acceptedValidation.length > 0
      ? acceptedValidation
      : session.validation;
    if (session.sessionDigest !== receipt.sessionDigest
        || session.origin.type !== "REPO_RUN"
        || session.origin.outcomeDigest !== receipt.outcomeDigest
        || !Array.isArray(validation) || validation.length === 0) {
      fail("MH_PRODUCT_INTEGRATION_OBLIGATION", "product lineage receipt does not resolve to its exact REPO_RUN validation obligation");
    }
    return Object.freeze({ session, validation: Object.freeze(JSON.parse(JSON.stringify(validation))) });
  });
  if (!Array.isArray(currentValidation) || currentValidation.length === 0) {
    fail("MH_PRODUCT_INTEGRATION_OBLIGATION", "current banked result lacks accepted validation obligation");
  }
  obligations.push(Object.freeze({
    session: currentSession,
    validation: Object.freeze(JSON.parse(JSON.stringify(currentValidation))),
  }));
  const unique = new Set(obligations.map((entry) => entry.session.sessionDigest));
  if (unique.size !== obligations.length) {
    fail("MH_PRODUCT_INTEGRATION_OBLIGATION", "product lineage repeats a session");
  }
  return Object.freeze(obligations);
}

function verifyRetainedSessions(repositoryPath, workspacePath, candidateTreeOid, obligations, env) {
  const validations = [];
  for (const obligation of obligations) {
    const validation = verifyRetainedSessionObligation({
      workspacePath,
      dependencySourcePath: repositoryPath,
      session: obligation.session,
      validation: obligation.validation,
      candidateTreeOid,
      env,
    });
    validations.push(validation);
    if (!validation.passed) {
      return Object.freeze({ passed: false, validations, failedSessionDigest: obligation.session.sessionDigest });
    }
  }
  return Object.freeze({ passed: true, validations, failedSessionDigest: null });
}

function rejected(workspace, banked, reason, detail, validation = null) {
  return Object.freeze({ status: "REJECTED", reason, detail, validation, ...workspace, banked });
}

function applyBankCommit(workspace, banked, env) {
  if (banked.bankCommit === banked.session.base.commit) return null;
  return runGit(workspace.workspacePath, ["cherry-pick", "--no-commit", banked.bankCommit], { allowFailure: true, env });
}

function createIntegratedCommit(workspace, predecessorProductCommit, integratedTreeOid, productResult, env) {
  const priorTree = String(runGit(workspace.workspacePath, ["rev-parse", `${predecessorProductCommit}^{tree}`], { env }).stdout || "").trim();
  if (integratedTreeOid === priorTree) return predecessorProductCommit;
  runGit(workspace.workspacePath, ["commit", "--no-verify", "-m", `Integrate ${productResult}`], { env: integrationCommitEnv() });
  const commit = String(runGit(workspace.workspacePath, ["rev-parse", "HEAD"], { env }).stdout || "").trim();
  const parent = String(runGit(workspace.workspacePath, ["rev-parse", "HEAD^"], { env }).stdout || "").trim();
  if (parent !== predecessorProductCommit) {
    fail("MH_PRODUCT_INTEGRATION_GIT", "integrated commit does not have the authoritative predecessor product commit as parent");
  }
  return commit;
}

function prepareProductIntegration({
  repositoryPath,
  predecessorProductCommit,
  closure,
  workResult = null,
  now = new Date(),
  env = process.env,
}) {
  const banked = bankEvidence(repositoryPath, closure, workResult);
  const sessions = retainedSessions(repositoryPath, predecessorProductCommit, banked.session, banked.validation);
  const workspace = integrationWorkspace(repositoryPath, predecessorProductCommit);
  let predecessorSaw;
  try {
    predecessorSaw = preparePredecessorStructuralSaw(workspace.workspacePath);
  } catch (error) {
    if (error?.code === "MH_STRUCTURAL_SAW_POLICY") {
      return rejected(workspace, banked, "STRUCTURAL_SAW_FAILED", `predecessor structural policy is invalid: ${error.message}`);
    }
    cleanupIntegrationWorkspace(workspace);
    throw error;
  }
  try {
    const cherry = applyBankCommit(workspace, banked, env);
    if (cherry && (cherry.error || cherry.status !== 0)) {
      return rejected(
        workspace,
        banked,
        "GIT_CONFLICT",
        String(cherry.stderr || cherry.stdout || cherry.error?.message || "integration conflict").trim().slice(-4000),
      );
    }
    const staged = normalizedPaths(String(runGit(workspace.workspacePath, [
      "diff", "--cached", "--name-only", "--no-renames",
    ], { env }).stdout || "").split(/\r?\n/u).filter(Boolean));
    if (JSON.stringify(staged) !== JSON.stringify(banked.changedPaths)) {
      return rejected(workspace, banked, "PATH_MISMATCH", `expected ${JSON.stringify(banked.changedPaths)} but integration staged ${JSON.stringify(staged)}`);
    }
    const integratedTreeOid = requireOid(
      String(runGit(workspace.workspacePath, ["write-tree"], { env }).stdout || "").trim(),
      "integratedTreeOid",
    );
    const structuralSaw = evaluateStructuralSaw({
      repositoryPath,
      workspacePath: workspace.workspacePath,
      predecessorProductCommit,
      candidateTreeOid: integratedTreeOid,
      changedPaths: staged,
      predecessor: predecessorSaw,
    });
    if (!structuralSaw.passed) {
      const detail = structuralSaw.regressions.slice(0, 8).map((item) => `${item.rule}:${item.key}`).join(", ");
      return rejected(workspace, banked, "STRUCTURAL_SAW_FAILED", detail || "structural SAW rejected cumulative candidate", structuralSaw);
    }
    const validation = verifyRetainedSessions(
      repositoryPath,
      workspace.workspacePath,
      integratedTreeOid,
      sessions,
      env,
    );
    if (!validation.passed) {
      return rejected(
        workspace,
        banked,
        "RETAINED_VALIDATION_FAILED",
        `retained validation failed for ${validation.failedSessionDigest}`,
        validation,
      );
    }
    const integratedCommit = createIntegratedCommit(
      workspace,
      predecessorProductCommit,
      integratedTreeOid,
      banked.session.productResult,
      env,
    );
    const body = {
      schemaVersion: PRODUCT_INTEGRATION_SCHEMA,
      predecessorProductCommit,
      bankCommit: banked.bankCommit,
      sessionDigest: banked.session.sessionDigest,
      outcomeDigest: banked.outcomeDigest,
      closureDigest: banked.closure.closureDigest,
      workResultDigest: banked.workResult.workResultDigest,
      candidateSealDigest: banked.candidateSealDigest,
      integratedTreeOid,
      integratedCommit,
      structuralSawDigest: structuralSaw.sawDigest,
      validationDigest: domainDigest(PRODUCT_INTEGRATION_VALIDATION_DOMAIN, {
        predecessorProductCommit,
        integratedTreeOid,
        sessionDigests: sessions.map((entry) => entry.session.sessionDigest),
        structuralSawDigest: structuralSaw.sawDigest,
      }),
      integratedAt: now.toISOString(),
    };
    const receipt = validateProductIntegration({ ...body, integrationDigest: computeProductIntegrationDigest(body) });
    persistImmutableJson(repositoryPath, "product-integrations", receipt.integrationDigest, receipt, "MH_PRODUCT_INTEGRATION_WRITE");
    return Object.freeze({
      status: "ACCEPTED",
      ...workspace,
      banked,
      receipt: readProductIntegration(repositoryPath, receipt.integrationDigest),
      validation,
      structuralSaw,
    });
  } catch (error) {
    cleanupIntegrationWorkspace(workspace);
    throw error;
  }
}

function commitIsAncestor(repositoryPath, ancestor, descendant) {
  if (ancestor === descendant) return true;
  return runGit(repositoryPath, ["merge-base", "--is-ancestor", ancestor, descendant], { allowFailure: true }).status === 0;
}

function landedProductIntegrationForClosure(repositoryPath, closureDigest, productCommit = null) {
  if (!isDigest(closureDigest)) fail("MH_PRODUCT_INTEGRATION_DIGEST", "closureDigest must be a sha256 digest");
  const head = productCommit || readIntegrationHead(repositoryPath, { optional: true });
  if (!head) return null;
  const landed = allProductIntegrationReceipts(repositoryPath)
    .filter((receipt) => receipt.closureDigest === closureDigest)
    .filter((receipt) => commitIsAncestor(repositoryPath, receipt.integratedCommit, head));
  if (landed.length === 0) return null;
  const commits = [...new Set(landed.map((receipt) => receipt.integratedCommit))];
  if (commits.length > 1) {
    fail("MH_PRODUCT_INTEGRATION_REPLAY", "one execution closure was published into product history more than once", {
      closureDigest,
      productCommit: head,
      integratedCommits: commits,
    });
  }
  return landed.sort((left, right) => Date.parse(left.integratedAt) - Date.parse(right.integratedAt)).at(-1);
}

function recordPublishedIntegration(candidate, state) {
  const closure = candidate.banked.closure;
  const workspaceId = closureWorkspaceId(candidate.root, closure);
  const runId = workspaceId
    ? runIdForExecution(closure.sessionDigest, workspaceId)
    : runIdForSession(closure.sessionDigest);
  const gitCommonDirectory = commonGitDirectory(candidate.root);
  const existing = readRunJournal({ gitCommonDirectory, runId }).find((event) => (
    event.type === "integration/result"
    && event.data?.integrationDigest === candidate.receipt.integrationDigest
    && event.data?.productCommit === candidate.receipt.integratedCommit
    && event.data?.status === "LANDED"
  ));
  if (existing) return existing;
  return appendRunEvent({
    gitCommonDirectory,
    runId,
    type: "integration/result",
    data: {
      sessionDigest: closure.sessionDigest,
      integrationDigest: candidate.receipt.integrationDigest,
      productCommit: candidate.receipt.integratedCommit,
      status: "LANDED",
      publicationState: state,
    },
  });
}

function publishProductIntegration(candidate) {
  if (!candidate || candidate.status !== "ACCEPTED" || !candidate.receipt) {
    fail("MH_PRODUCT_INTEGRATION_PUBLISH", "only an accepted validated integration candidate may be published");
  }
  const expectedHead = candidate.receipt.predecessorProductCommit;
  const candidateHead = candidate.receipt.integratedCommit;
  const observedHead = readIntegrationHead(candidate.root, { optional: true });
  if (observedHead === candidateHead) {
    recordPublishedIntegration(candidate, "ALREADY_LANDED");
    return Object.freeze({
      state: "ALREADY_LANDED",
      expectedHead,
      candidateHead,
      observedHead,
    });
  }
  if (observedHead !== expectedHead) {
    return Object.freeze({
      state: "CONFLICT",
      expectedHead,
      candidateHead,
      observedHead,
    });
  }
  const published = compareAndSwapIntegrationHead({
    repositoryPath: candidate.root,
    expectedHead,
    candidateHead,
  });
  if (published.state === "LANDED") recordPublishedIntegration(candidate, published.state);
  return published;
}

function discardProductIntegration(candidate) {
  cleanupIntegrationWorkspace(candidate);
}

function finalizeProductIntegration(candidate, publishedProductCommit = null) {
  if (candidate?.status === "ACCEPTED" && publishedProductCommit !== null
      && candidate.receipt.integratedCommit !== publishedProductCommit) {
    fail("MH_PRODUCT_INTEGRATION_PUBLISH", "finalization cannot substitute a different product commit for the landed candidate", {
      candidateCommit: candidate.receipt.integratedCommit,
      publishedProductCommit,
    });
  }
  cleanupIntegrationWorkspace(candidate);
}

module.exports = {
  PRODUCT_HEAD_REF,
  PRODUCT_INTEGRATION_DOMAIN,
  PRODUCT_INTEGRATION_SCHEMA,
  computeProductIntegrationDigest,
  discardProductIntegration,
  finalizeProductIntegration,
  landedProductIntegrationForClosure,
  latestIntegrationReceiptForProductCommit,
  prepareProductIntegration,
  publishProductIntegration,
  readProductIntegration,
  validateProductIntegration,
  _test: { bankEvidence, integrationLineage, retainedSessions, verifyRetainedSessions },
};
