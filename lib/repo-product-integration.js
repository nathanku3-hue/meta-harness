"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { findExecutionWorkResultForOrigin, validateExecutionClosure } = require("./execution-closure");
const { readOutcomeClaimSession } = require("./outcome-claim");
const {
  PRODUCT_HEAD_REF,
  PRODUCT_INTEGRATION_DOMAIN,
  PRODUCT_INTEGRATION_SCHEMA,
  computeProductIntegrationDigest,
  latestIntegrationReceiptForHead,
  readProductIntegration,
  requireOid,
  retainedObligation,
  retainedObligationsForHead,
  validateProductIntegration,
} = require("./repo-product-integration-record");
const { repositoryRoot, runGit } = require("./work-git");
const { verifyRetainedSessionObligation } = require("./repo-product-proof-retention");
const { persistImmutableJson } = require("./world-authority");
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
  const result = findExecutionWorkResultForOrigin(repositoryPath, validated.origin);
  if (!result || result.workResultDigest !== validated.workResultDigest) {
    fail("MH_PRODUCT_INTEGRATION_WORK_RESULT", "integration cannot resolve the Closure's exact durable work result");
  }
  return result;
}

function bankEvidence(repositoryPath, claim, closure, workResult = null) {
  const result = workResult || exactWorkResult(repositoryPath, closure);
  if (!result || result.result?.outcome !== "DONE") {
    fail("MH_PRODUCT_INTEGRATION_WORK_RESULT", "only DONE work results may enter canonical product code");
  }
  const session = validateWorkSession(readOutcomeClaimSession(repositoryPath, claim.claimDigest));
  if (session.sessionDigest !== closure.sessionDigest || session.origin.outcomeDigest !== claim.outcomeDigest) {
    fail("MH_PRODUCT_INTEGRATION_SESSION", "Claim/session/Closure identity does not agree for integration");
  }
  const commit = result.result?.delivery?.commit;
  if (!commit || !new Set(["committed", "no_changes"]).has(commit.status)) {
    fail("MH_PRODUCT_INTEGRATION_BANK", "DONE work result lacks exact local BANK commit evidence");
  }
  const bankCommit = requireOid(commit.sha, "workResult.delivery.commit.sha");
  const acceptance = result.result?.acceptance;
  const productProof = result.result?.productProof;
  if (!acceptance || !isDigest(acceptance.acceptanceDigest)
      || !productProof || productProof.state !== "PROVEN"
      || !isDigest(productProof.productProofDigest) || !isDigest(productProof.candidateSealDigest)) {
    fail("MH_PRODUCT_INTEGRATION_BANK", "DONE work result lacks accepted candidate/product proof evidence");
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
  return Object.freeze({
    claim, closure, workResult: result, session, bankCommit, changedPaths: expectedPaths,
    candidateSealDigest: productProof.candidateSealDigest,
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

function integrationCommitEnv(now) {
  const timestamp = now.toISOString();
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

function verifyRetainedObligations(repositoryPath, workspacePath, candidateTreeOid, obligations, env) {
  const proofs = [];
  for (const obligation of obligations) {
    const session = readOutcomeClaimSession(repositoryPath, obligation.claimDigest);
    if (!session || session.sessionDigest !== obligation.sessionDigest) {
      fail("MH_PRODUCT_INTEGRATION_OBLIGATION", "retained obligation session cannot be resolved exactly");
    }
    const proof = verifyRetainedSessionObligation({
      workspacePath,
      dependencySourcePath: repositoryPath,
      session,
      candidateTreeOid,
      env,
    });
    proofs.push(proof);
    if (!proof.passed) return Object.freeze({ passed: false, proofs, failedSessionDigest: obligation.sessionDigest });
  }
  return Object.freeze({ passed: true, proofs, failedSessionDigest: null });
}

function obligationFor(banked) {
  return retainedObligation({
    sessionDigest: banked.session.sessionDigest,
    claimDigest: banked.claim.claimDigest,
    closureDigest: banked.closure.closureDigest,
    workResultDigest: banked.workResult.workResultDigest,
  });
}

function rejected(workspace, banked, reason, detail, proof = null) {
  return Object.freeze({ status: "REJECTED", reason, detail, proof, ...workspace, banked });
}

function applyBankCommit(workspace, banked, env) {
  if (banked.bankCommit === banked.session.base.commit) return null;
  return runGit(workspace.workspacePath, ["cherry-pick", "--no-commit", banked.bankCommit], { allowFailure: true, env });
}

function createIntegratedCommit(workspace, predecessorProductCommit, integratedTreeOid, productResult, now, env) {
  const priorTree = String(runGit(workspace.workspacePath, ["rev-parse", `${predecessorProductCommit}^{tree}`], { env }).stdout || "").trim();
  if (integratedTreeOid === priorTree) return predecessorProductCommit;
  runGit(workspace.workspacePath, ["commit", "--no-verify", "-m", `Integrate ${productResult}`], { env: integrationCommitEnv(now) });
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
  currentHead,
  claim,
  closure,
  workResult = null,
  retainedObligations = null,
  now = new Date(),
  env = process.env,
}) {
  const banked = bankEvidence(repositoryPath, claim, closure, workResult);
  const prior = retainedObligations || retainedObligationsForHead(repositoryPath, currentHead);
  const obligations = [...prior.map(retainedObligation), obligationFor(banked)];
  if (new Set(obligations.map((entry) => entry.sessionDigest)).size !== obligations.length) {
    fail("MH_PRODUCT_INTEGRATION_OBLIGATION", "current Outcome is already present in retained product obligations");
  }
  const workspace = integrationWorkspace(repositoryPath, predecessorProductCommit);
  try {
    const cherry = applyBankCommit(workspace, banked, env);
    if (cherry && (cherry.error || cherry.status !== 0)) {
      return rejected(workspace, banked, "GIT_CONFLICT", String(cherry.stderr || cherry.stdout || cherry.error?.message || "integration conflict").trim().slice(-4000));
    }
    const staged = normalizedPaths(String(runGit(workspace.workspacePath, ["diff", "--cached", "--name-only", "--no-renames"], { env }).stdout || "").split(/\r?\n/u).filter(Boolean));
    if (JSON.stringify(staged) !== JSON.stringify(banked.changedPaths)) {
      return rejected(workspace, banked, "PATH_MISMATCH", `expected ${JSON.stringify(banked.changedPaths)} but integration staged ${JSON.stringify(staged)}`);
    }
    const integratedTreeOid = requireOid(String(runGit(workspace.workspacePath, ["write-tree"], { env }).stdout || "").trim(), "integratedTreeOid");
    const proof = verifyRetainedObligations(repositoryPath, workspace.workspacePath, integratedTreeOid, obligations, env);
    if (!proof.passed) {
      return rejected(workspace, banked, "RETAINED_PROOF_FAILED", `retained obligation failed for ${proof.failedSessionDigest}`, proof);
    }
    const integratedCommit = createIntegratedCommit(
      workspace, predecessorProductCommit, integratedTreeOid, banked.session.productResult, now, env,
    );
    const retainedProofDigests = proof.proofs.map((entry) => entry.proofDigest);
    const productProofDigests = proof.proofs.map((entry) => entry.productProof.productProofDigest);
    const body = {
      schemaVersion: PRODUCT_INTEGRATION_SCHEMA,
      predecessorProductCommit,
      bankCommit: banked.bankCommit,
      sessionDigest: banked.session.sessionDigest,
      outcomeDigest: banked.claim.outcomeDigest,
      claimDigest: banked.claim.claimDigest,
      closureDigest: banked.closure.closureDigest,
      workResultDigest: banked.workResult.workResultDigest,
      candidateSealDigest: banked.candidateSealDigest,
      integratedTreeOid,
      integratedCommit,
      retainedObligations: obligations,
      retainedProofDigests,
      validationDigest: domainDigest("meta-harness-product-integration-validation/v1", { integratedTreeOid, retainedProofDigests }),
      productProofDigests,
      integratedAt: now.toISOString(),
    };
    const receipt = validateProductIntegration({ ...body, integrationDigest: computeProductIntegrationDigest(body) });
    persistImmutableJson(repositoryPath, "product-integrations", receipt.integrationDigest, receipt, "MH_PRODUCT_INTEGRATION_WRITE");
    return Object.freeze({ status: "ACCEPTED", ...workspace, banked, receipt, proof });
  } catch (error) {
    cleanupIntegrationWorkspace(workspace);
    throw error;
  }
}

function discardProductIntegration(candidate) {
  cleanupIntegrationWorkspace(candidate);
}

function repairProductHeadRef(repositoryPath, productCommit) {
  const root = repositoryRoot(repositoryPath);
  requireOid(productCommit, "productCommit");
  runGit(root, ["cat-file", "-e", `${productCommit}^{commit}`]);
  const current = runGit(root, ["rev-parse", "--verify", "--quiet", PRODUCT_HEAD_REF], { allowFailure: true });
  const actual = current.status === 0 ? String(current.stdout || "").trim() : null;
  if (actual !== productCommit) runGit(root, ["update-ref", PRODUCT_HEAD_REF, productCommit]);
  return productCommit;
}

function finalizeProductIntegration(candidate, authoritativeProductCommit) {
  if (candidate?.status === "ACCEPTED" && candidate.receipt.integratedCommit === authoritativeProductCommit) {
    repairProductHeadRef(candidate.root, authoritativeProductCommit);
  }
  cleanupIntegrationWorkspace(candidate);
}

function ensureLinearProductHead(repositoryPath, options) {
  return require("./repo-product-migration").ensureLinearProductHead(repositoryPath, options);
}

module.exports = {
  PRODUCT_HEAD_REF,
  PRODUCT_INTEGRATION_DOMAIN,
  PRODUCT_INTEGRATION_SCHEMA,
  computeProductIntegrationDigest,
  discardProductIntegration,
  ensureLinearProductHead,
  finalizeProductIntegration,
  latestIntegrationReceiptForHead,
  prepareProductIntegration,
  readProductIntegration,
  repairProductHeadRef,
  retainedObligationsForHead,
  validateProductIntegration,
  _test: { bankEvidence, verifyRetainedObligations },
};
