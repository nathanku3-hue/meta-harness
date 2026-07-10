"use strict";

/**
 * Phase 23A-PR1 execution contracts (authority root).
 * Pure fixtures only — no process, network, AO, or Codex.
 */
const digest = require("./digest");
const scope = require("./scope");
const runManifest = require("./run-manifest");
const authorize = require("./authorize");
const evidenceBundle = require("./evidence-bundle");
const verifyEvidence = require("./verify-evidence");

module.exports = {
  ...digest,
  ...scope,
  ...runManifest,
  ...authorize,
  ...evidenceBundle,
  ...verifyEvidence,
};
