"use strict";

const { isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { listOutcomeClaimsForOutcome } = require("./outcome-claim");

const DELEGATION_LANE_KINDS = Object.freeze({
  EVIDENCE: "EVIDENCE",
  CODE: "CODE",
});
const LEGACY_ROUND3_CODE_LANE_KEY = /^r3-[1-9][0-9]*-[a-f0-9]{10}$/u;

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function delegationLaneAuthority(repositoryPath, outcomeDigest, { laneKey = null } = {}) {
  if (!isDigest(outcomeDigest)) {
    fail("MH_DELEGATION_R3_LANE_AUTHORITY", "delegation lane Outcome identity must be a sha256 digest");
  }
  const claimDigests = listOutcomeClaimsForOutcome(repositoryPath, outcomeDigest)
    .map((claim) => claim.claimDigest)
    .sort();
  const legacyWritableRefill = typeof laneKey === "string" && LEGACY_ROUND3_CODE_LANE_KEY.test(laneKey);
  return Object.freeze({
    kind: claimDigests.length > 0 || legacyWritableRefill
      ? DELEGATION_LANE_KINDS.CODE
      : DELEGATION_LANE_KINDS.EVIDENCE,
    outcomeDigest,
    claimDigests: Object.freeze(claimDigests),
    legacyWritableRefill,
  });
}

function assertDelegationEvidenceLane(repositoryPath, outcomeDigest, options = {}) {
  const authority = delegationLaneAuthority(repositoryPath, outcomeDigest, options);
  if (authority.kind === DELEGATION_LANE_KINDS.CODE) {
    fail(
      "MH_DELEGATION_R3_CODE_AUTHORITY",
      "Round 3 is evidence-only; Claim-bound or legacy writable coding Outcomes must return to controller validation and product integration",
      {
        outcomeDigest,
        claimDigests: authority.claimDigests,
        legacyWritableRefill: authority.legacyWritableRefill,
      },
    );
  }
  return authority;
}

module.exports = {
  DELEGATION_LANE_KINDS,
  LEGACY_ROUND3_CODE_LANE_KEY,
  assertDelegationEvidenceLane,
  delegationLaneAuthority,
};
