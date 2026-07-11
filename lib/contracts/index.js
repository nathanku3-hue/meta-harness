"use strict";

/**
 * Phase 23A-PR1R / D068 — execution authority contracts (under review).
 * Pure fixtures only. No process, network, AO, Codex, or public run CLI.
 *
 * Digests and structural validation establish content consistency only —
 * not provenance or issuer identity. Trusted runtime establishes custody.
 *
 * Public surface is intentionally minimal until a concrete runtime composes it.
 */

const runSpec = require("./run-spec");
const runSpecApproval = require("./run-spec-approval");
const executionReadinessFacts = require("./execution-readiness-facts");
const attemptAuthorization = require("./attempt-authorization");
const authorize = require("./authorize");
const workspaceAttestation = require("./workspace-attestation");
const workspaceStart = require("./workspace-start");
const implementationAssessment = require("./implementation-assessment");

module.exports = {
  validateRunSpec: runSpec.validateRunSpec,
  computeRunSpecDigest: runSpec.computeRunSpecDigest,

  validateRunSpecApproval: runSpecApproval.validateRunSpecApproval,

  validateExecutionReadinessFacts: executionReadinessFacts.validateExecutionReadinessFacts,

  authorizeAttempt: authorize.authorizeAttempt,
  validateAttemptAuthorization: attemptAuthorization.validateAttemptAuthorization,

  validateWorkspaceAttestation: workspaceAttestation.validateWorkspaceAttestation,
  evaluateWorkspaceStart: workspaceStart.evaluateWorkspaceStart,

  evaluateImplementationFacts: implementationAssessment.evaluateImplementationFacts,
};
