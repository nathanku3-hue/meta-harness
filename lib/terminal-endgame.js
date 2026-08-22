"use strict";

const { ConfigError } = require("./errors");
const {
  findExecutionWorkResultForOrigin,
  validateExecutionClosure,
} = require("./execution-closure");
const { readOutcome } = require("./outcome");
const { pinProductDirection } = require("./product-direction");
const { compileSemanticAuthority, endgameProjection } = require("./semantic-authority");
const { readImmutableJson } = require("./world-authority");
const { validateRepoWorld } = require("./world-attestation");
const { validateWorldHead, validateWorldTransition } = require("./world-contract");
const { readCurrentWorldState } = require("./world-transition");

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function terminalEndgameCoverage(repositoryPath, current = null) {
  const direction = pinProductDirection(repositoryPath);
  const authority = compileSemanticAuthority({ productDirection: direction });
  const projection = endgameProjection(authority);
  const requiredDestinationsByIdentity = new Map(
    projection.atoms.map((atom) => [atom.identity, atom]),
  );
  const covered = new Set();
  const requiredDestinationRefs = projection.requiredDestinationRefs;
  if (requiredDestinationRefs.length === 0) {
    return Object.freeze({
      productDirectionDigest: direction.digest,
      requiredDestinationRefs: Object.freeze([]),
      coveredDestinationRefs: Object.freeze([]),
      missingDestinationRefs: Object.freeze([]),
      complete: true,
    });
  }

  const worldState = current || readCurrentWorldState(repositoryPath, { optional: true });
  if (!worldState) {
    return Object.freeze({
      productDirectionDigest: direction.digest,
      requiredDestinationRefs: Object.freeze([...requiredDestinationRefs]),
      coveredDestinationRefs: Object.freeze([]),
      missingDestinationRefs: Object.freeze([...requiredDestinationRefs]),
      complete: false,
    });
  }
  if (worldState.world.productDirectionDigest !== direction.digest) {
    fail("MH_ENDGAME_DIRECTION_STALE", "terminal endgame coverage requires current World and live PRODUCT.md to agree");
  }

  let head = worldState.head;
  while (head?.lastTransitionDigest) {
    const transition = validateWorldTransition(readImmutableJson(repositoryPath, "transitions", head.lastTransitionDigest));
    if (transition.transitionDigest !== head.lastTransitionDigest) {
      fail("MH_ENDGAME_LINEAGE", "WorldHead transition identity does not match immutable terminal-coverage lineage");
    }
    const successorWorld = validateRepoWorld(readImmutableJson(repositoryPath, "worlds", head.worldDigest));
    if (transition.cause.type === "ATTEMPT_LEARNING"
        && transition.cause.integrationDigest
        && successorWorld.productDirectionDigest === direction.digest) {
      const closure = validateExecutionClosure(
        readImmutableJson(repositoryPath, "execution-closures", transition.cause.executionClosureDigest),
      );
      if (closure.closureDigest !== transition.cause.executionClosureDigest) {
        fail("MH_ENDGAME_LINEAGE", "terminal coverage closure path identity does not match the landed transition");
      }
      if (closure.origin.type === "REPO_OUTCOME" && closure.workResultDigest) {
        const workResult = findExecutionWorkResultForOrigin(repositoryPath, closure.origin);
        if (workResult?.workResultDigest === closure.workResultDigest
            && workResult.result?.outcome === "DONE"
            && workResult.result?.productProof?.state === "PROVEN") {
          const outcome = readOutcome(repositoryPath, closure.origin.outcomeDigest);
          const destination = requiredDestinationsByIdentity.get(outcome.desiredState);
          if (destination && workResult.result.productResult === destination.identity) {
            covered.add(destination.id);
          }
        }
      }
    }
    if (transition.predecessorHeadDigest === null) break;
    head = validateWorldHead(readImmutableJson(repositoryPath, "heads", transition.predecessorHeadDigest));
    if (head.headDigest !== transition.predecessorHeadDigest) {
      fail("MH_ENDGAME_LINEAGE", "terminal coverage predecessor Head identity does not match immutable lineage");
    }
  }

  const coveredDestinationRefs = requiredDestinationRefs.filter((id) => covered.has(id));
  const missingDestinationRefs = requiredDestinationRefs.filter((id) => !covered.has(id));
  return Object.freeze({
    productDirectionDigest: direction.digest,
    requiredDestinationRefs: Object.freeze([...requiredDestinationRefs]),
    coveredDestinationRefs: Object.freeze(coveredDestinationRefs),
    missingDestinationRefs: Object.freeze(missingDestinationRefs),
    complete: missingDestinationRefs.length === 0,
  });
}

function assertTerminalEndgameCovered(repositoryPath, current = null) {
  const coverage = terminalEndgameCoverage(repositoryPath, current);
  if (!coverage.complete) {
    fail(
      "MH_ENDGAME_INCOMPLETE",
      "product terminality is denied until every owner-required destination has durable landed PROVEN coverage",
      { missingDestinationRefs: coverage.missingDestinationRefs },
    );
  }
  return coverage;
}

module.exports = {
  assertTerminalEndgameCovered,
  terminalEndgameCoverage,
};
