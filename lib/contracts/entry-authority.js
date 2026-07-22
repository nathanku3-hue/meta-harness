"use strict";

const path = require("node:path");
const {
  assertStrictJsonData,
  exactKeys,
  isOrdinaryPlainObject,
} = require("./canonical-json");
const {
  computeRunSpecDigest,
  isHexRevision,
  validateRunSpec,
} = require("./run-spec");
const { compareRepositoryIdentity } = require("./execution-readiness-facts");

const RESULT = Object.freeze({
  PASS_CURRENT: "PASS_CURRENT",
  REDIRECT: "REDIRECT",
  CUSTODY_REQUIRED: "CUSTODY_REQUIRED",
  BLOCK: "BLOCK",
});

const TRUSTED_SOURCE_KINDS = new Set([
  "controller_authorized_run_spec",
  "authenticated_operator",
  "signed_canonical",
  "immutable_evidence",
]);

function reason(code, detail) {
  return { code, detail };
}

function safetyFlags() {
  return {
    mutates: false,
    writes_files: false,
    executes_child_commands: false,
    spawns_process: false,
    network: false,
    creates_worktree: false,
    creates_ref: false,
  };
}

function result(verdict, reasons, redirect = null) {
  return {
    kind: "entry_authority",
    verdict,
    ok: verdict === RESULT.PASS_CURRENT,
    reasons,
    redirect,
    next_action: nextAction(verdict, redirect),
    ...safetyFlags(),
  };
}

function nextAction(verdict, redirect) {
  if (verdict === RESULT.PASS_CURRENT) return "continue in the current checkout";
  if (verdict === RESULT.REDIRECT && redirect) {
    return `continue at ${redirect.path} ${redirect.ref} ${redirect.commit}`;
  }
  if (verdict === RESULT.CUSTODY_REQUIRED) {
    return "place the product bytes in a named Git authority before planning or execution";
  }
  return "obtain one verified expected repository identity from an external trusted boundary";
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isPortableAbsolutePath(value) {
  if (!isNonEmptyString(value) || value.includes("\0")) return false;
  const normalized = value.replace(/\\/g, "/");
  return normalized.startsWith("/")
    || normalized.startsWith("//")
    || /^[A-Za-z]:\//.test(normalized);
}

function normalizePortablePath(value) {
  let normalized = value.replace(/\\/g, "/");
  const unc = normalized.startsWith("//");
  normalized = path.posix.normalize(normalized);
  if (unc && !normalized.startsWith("//")) normalized = `/${normalized}`;
  if (/^[A-Za-z]:\//.test(normalized)) return normalized.toLowerCase();
  return normalized;
}

function validateRepository(repository, label) {
  const reasons = [];
  if (!isOrdinaryPlainObject(repository)
    || !exactKeys(repository, ["repositoryId", "objectFormat", "expectedBaseRevision"])) {
    return [reason(
      "EXPECTED_REPOSITORY_SHAPE",
      `${label} must be exactly { repositoryId, objectFormat, expectedBaseRevision }`,
    )];
  }
  if (!isNonEmptyString(repository.repositoryId)) {
    reasons.push(reason("EXPECTED_REPOSITORY_ID", `${label}.repositoryId is required`));
  }
  if (repository.objectFormat !== "sha1" && repository.objectFormat !== "sha256") {
    reasons.push(reason("EXPECTED_OBJECT_FORMAT", `${label}.objectFormat must be sha1 or sha256`));
  }
  if (!isHexRevision(repository.expectedBaseRevision, repository.objectFormat)) {
    reasons.push(reason(
      "EXPECTED_REVISION",
      `${label}.expectedBaseRevision must be full lowercase hex for objectFormat`,
    ));
  }
  return reasons;
}

function validateSource(source) {
  const reasons = [];
  if (!isOrdinaryPlainObject(source)
    || !exactKeys(source, ["kind", "verified", "reference"])) {
    return [reason(
      "TRUST_SOURCE_SHAPE",
      "expected.source must be exactly { kind, verified, reference }",
    )];
  }
  if (!TRUSTED_SOURCE_KINDS.has(source.kind)) {
    reasons.push(reason(
      "TRUST_SOURCE_UNTRUSTED",
      "expected identity must come from a controller RunSpec, authenticated operator boundary, signed canonical evidence, or immutable evidence",
    ));
  }
  if (source.verified !== true) {
    reasons.push(reason("TRUST_SOURCE_UNVERIFIED", "expected.source.verified must be true"));
  }
  if (!isNonEmptyString(source.reference)) {
    reasons.push(reason("TRUST_SOURCE_REFERENCE", "expected.source.reference is required"));
  }
  return reasons;
}

function validateAuthority(authority, repository) {
  const reasons = [];
  if (!isOrdinaryPlainObject(authority)
    || !exactKeys(authority, ["path", "ref", "commit"])) {
    return [reason(
      "NAMED_AUTHORITY_SHAPE",
      "expected.authority must be exactly { path, ref, commit }",
    )];
  }
  if (!isPortableAbsolutePath(authority.path)) {
    reasons.push(reason("NAMED_AUTHORITY_PATH", "expected.authority.path must be absolute"));
  }
  if (!isNonEmptyString(authority.ref)) {
    reasons.push(reason("NAMED_AUTHORITY_REF", "expected.authority.ref is required"));
  }
  if (!isHexRevision(authority.commit, repository && repository.objectFormat)) {
    reasons.push(reason(
      "NAMED_AUTHORITY_COMMIT",
      "expected.authority.commit must be full lowercase hex for expected objectFormat",
    ));
  }
  if (repository && authority.commit !== repository.expectedBaseRevision) {
    reasons.push(reason(
      "TRUSTED_IDENTITY_CONTRADICTION",
      "expected authority commit contradicts expected repository revision",
    ));
  }
  return reasons;
}

function validateExpected(expected) {
  const reasons = [];
  if (!isOrdinaryPlainObject(expected)) {
    return { ok: false, reasons: [reason("TRUSTED_EXPECTED_IDENTITY_MISSING", "expected identity is required")] };
  }
  const keys = Object.keys(expected).sort();
  const controllerKeys = ["authority", "repository", "runSpec", "source"];
  const anchoredKeys = ["authority", "repository", "source"];
  const allowedShape = exactKeys(expected, controllerKeys) || exactKeys(expected, anchoredKeys);
  if (!allowedShape) {
    return {
      ok: false,
      reasons: [reason(
        "TRUSTED_EXPECTED_IDENTITY_SHAPE",
        `unexpected expected identity fields: ${keys.join(", ")}`,
      )],
    };
  }

  reasons.push(...validateSource(expected.source));
  reasons.push(...validateRepository(expected.repository, "expected.repository"));
  reasons.push(...validateAuthority(expected.authority, expected.repository));

  if (expected.source && expected.source.kind === "controller_authorized_run_spec") {
    if (!Object.prototype.hasOwnProperty.call(expected, "runSpec")) {
      reasons.push(reason("RUN_SPEC_REQUIRED", "controller-authorized expected identity requires runSpec"));
    } else {
      const checked = validateRunSpec(expected.runSpec);
      if (!checked.ok) {
        reasons.push(reason("RUN_SPEC_INVALID", "controller-authorized runSpec is invalid"));
        reasons.push(...checked.reasons);
      } else {
        const repository = expected.runSpec.repository;
        if (repository.repositoryId !== expected.repository.repositoryId
          || repository.objectFormat !== expected.repository.objectFormat
          || repository.expectedBaseRevision !== expected.repository.expectedBaseRevision) {
          reasons.push(reason(
            "RUN_SPEC_IDENTITY_CONTRADICTION",
            "expected.repository contradicts the controller-authorized RunSpec",
          ));
        }
        if (expected.source.reference !== computeRunSpecDigest(expected.runSpec)) {
          reasons.push(reason(
            "RUN_SPEC_REFERENCE_MISMATCH",
            "expected.source.reference must equal the RunSpec digest",
          ));
        }
      }
    }
  } else if (Object.prototype.hasOwnProperty.call(expected, "runSpec")) {
    reasons.push(reason(
      "RUN_SPEC_SOURCE_MISMATCH",
      "runSpec may appear only with controller_authorized_run_spec source",
    ));
  }

  return { ok: reasons.length === 0, reasons };
}

function validateObserved(observed) {
  const reasons = [];
  if (!isOrdinaryPlainObject(observed)
    || !exactKeys(observed, [
      "repositoryId",
      "objectFormat",
      "observedHeadRevision",
      "repositoryRoot",
      "ref",
      "clean",
      "productBytesPresent",
      "productBytesReachableFromNamedAuthority",
    ])) {
    return {
      ok: false,
      reasons: [reason(
        "OBSERVED_CHECKOUT_SHAPE",
        "observed checkout facts have an invalid shape",
      )],
    };
  }

  if (!isNonEmptyString(observed.repositoryId)) {
    reasons.push(reason("OBSERVED_REPOSITORY_ID", "observed.repositoryId is required"));
  }
  if (observed.objectFormat !== "sha1" && observed.objectFormat !== "sha256") {
    reasons.push(reason("OBSERVED_OBJECT_FORMAT", "observed.objectFormat must be sha1 or sha256"));
  }
  if (!isHexRevision(observed.observedHeadRevision, observed.objectFormat)) {
    reasons.push(reason(
      "OBSERVED_HEAD_REVISION",
      "observed.observedHeadRevision must be full lowercase hex for objectFormat",
    ));
  }
  if (!isPortableAbsolutePath(observed.repositoryRoot)) {
    reasons.push(reason("OBSERVED_REPOSITORY_ROOT", "observed.repositoryRoot must be absolute"));
  }
  if (!isNonEmptyString(observed.ref)) {
    reasons.push(reason("OBSERVED_REF", "observed.ref is required; use DETACHED for detached HEAD"));
  }
  if (typeof observed.clean !== "boolean") {
    reasons.push(reason("OBSERVED_CLEAN", "observed.clean must be boolean"));
  }
  if (typeof observed.productBytesPresent !== "boolean"
    || typeof observed.productBytesReachableFromNamedAuthority !== "boolean") {
    reasons.push(reason(
      "OBSERVED_CUSTODY_FACTS",
      "observed product custody facts must be booleans",
    ));
  }

  return { ok: reasons.length === 0, reasons };
}

/**
 * Pure pre-planning authority assessment.
 * Expected identity is supplied by a trusted boundary external to the checkout.
 * Observed facts are read-only inputs; this function performs no I/O.
 */
function evaluateEntryAuthority(input) {
  const envelope = input === undefined ? {} : input;
  try {
    assertStrictJsonData(envelope);
  } catch (err) {
    return result(RESULT.BLOCK, [reason(err.code || "STRICT_JSON", err.message)]);
  }
  if (!isOrdinaryPlainObject(envelope) || !exactKeys(envelope, ["expected", "observed"])) {
    return result(RESULT.BLOCK, [reason(
      "ENTRY_AUTHORITY_INPUT_SHAPE",
      "input must be exactly { expected, observed }",
    )]);
  }

  const expectedCheck = validateExpected(envelope.expected);
  if (!expectedCheck.ok) return result(RESULT.BLOCK, expectedCheck.reasons);

  const observedCheck = validateObserved(envelope.observed);
  if (!observedCheck.ok) return result(RESULT.BLOCK, observedCheck.reasons);

  const { expected, observed } = envelope;
  if (observed.productBytesPresent === true
    && observed.productBytesReachableFromNamedAuthority === false) {
    return result(RESULT.CUSTODY_REQUIRED, [reason(
      "PRODUCT_BYTES_OUTSIDE_NAMED_AUTHORITY",
      "product bytes are present but are not reachable from the named Git authority",
    )]);
  }

  const identity = compareRepositoryIdentity(observed, expected.repository);
  const pathMatches = normalizePortablePath(observed.repositoryRoot)
    === normalizePortablePath(expected.authority.path);
  const refMatches = observed.ref === expected.authority.ref;

  if (identity.ok && pathMatches && refMatches) {
    return result(RESULT.PASS_CURRENT, []);
  }

  if (!pathMatches) {
    return result(RESULT.REDIRECT, [
      ...identity.reasons,
      reason("AUTHORITY_PATH_MISMATCH", "current checkout is not the named authority path"),
      ...(refMatches ? [] : [reason("AUTHORITY_REF_MISMATCH", "current ref is not the named authority ref")]),
    ], {
      path: expected.authority.path,
      ref: expected.authority.ref,
      commit: expected.authority.commit,
    });
  }

  return result(RESULT.BLOCK, [
    ...identity.reasons,
    ...(refMatches ? [] : [reason("AUTHORITY_REF_MISMATCH", "current ref is not the named authority ref")]),
    reason(
      "NAMED_AUTHORITY_STATE_CONTRADICTORY",
      "the checkout is at the named authority path but its observed state contradicts the trusted identity",
    ),
  ]);
}

module.exports = {
  RESULT,
  TRUSTED_SOURCE_KINDS,
  evaluateEntryAuthority,
  normalizePortablePath,
};
