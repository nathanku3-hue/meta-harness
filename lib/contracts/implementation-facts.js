"use strict";

const { domainDigest, isDigest } = require("./digest");
const {
  isOrdinaryPlainObject,
  assertStrictJsonData,
  exactKeys,
  isExactUtcTimestamp,
  freezeDeep,
} = require("./canonical-json");

const FACTS_SCHEMA = "implementation-facts/v1";
const FACTS_DOMAIN = "implementation-facts/v1";
const ALLOWED_STATUSES = new Set(["A", "M", "D", "T", "R", "C"]);

function reason(code, detail) {
  return { code, detail };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function factsBodyWithoutDigest(facts) {
  const { factsDigest: _omit, ...rest } = facts;
  return rest;
}

function computeFactsDigest(facts) {
  return domainDigest(FACTS_DOMAIN, factsBodyWithoutDigest(facts));
}

function sealImplementationFacts(body) {
  const without = { ...body };
  delete without.factsDigest;
  const factsDigest = domainDigest(FACTS_DOMAIN, without);
  return freezeDeep({ ...without, factsDigest });
}

/**
 * Structural validation of trusted implementation facts.
 * factsDigest is mandatory and recomputed.
 */
function validateImplementationFactsStructure(facts) {
  const reasons = [];
  if (!isOrdinaryPlainObject(facts)) {
    return { ok: false, reasons: [reason("FACTS_NOT_OBJECT", "trustedImplementationFacts must be an object")] };
  }
  try {
    assertStrictJsonData(facts);
  } catch (err) {
    return { ok: false, reasons: [reason(err.code || "STRICT_JSON", err.message)] };
  }

  const allowed = new Set([
    "schemaVersion",
    "bindings",
    "git",
    "commands",
    "collectedAt",
    "factsDigest",
  ]);
  for (const k of Object.keys(facts)) {
    if (!allowed.has(k)) {
      reasons.push(reason("UNKNOWN_FIELD", `facts.${k} is not allowed`));
    }
  }
  if (facts.schemaVersion !== FACTS_SCHEMA) {
    reasons.push(reason("SCHEMA_VERSION_INVALID", `schemaVersion must be ${FACTS_SCHEMA}`));
  }
  if (!isExactUtcTimestamp(facts.collectedAt)) {
    reasons.push(reason("FACTS_COLLECTED_AT_INVALID", "facts.collectedAt must be exact UTC timestamp"));
  }

  const b = facts.bindings;
  if (!isOrdinaryPlainObject(b)
    || !exactKeys(b, [
      "runSpecDigest",
      "authorizationReceiptDigest",
      "workspaceAttestationDigest",
      "startCheckDigest",
      "attemptId",
      "repositoryId",
    ])) {
    reasons.push(reason(
      "FACTS_BINDINGS_REQUIRED",
      "bindings must include runSpecDigest, authorizationReceiptDigest, workspaceAttestationDigest, startCheckDigest, attemptId, repositoryId",
    ));
  } else {
    for (const key of [
      "runSpecDigest",
      "authorizationReceiptDigest",
      "workspaceAttestationDigest",
      "startCheckDigest",
    ]) {
      if (!isDigest(b[key])) {
        reasons.push(reason("BINDING_DIGEST_REQUIRED", `bindings.${key} required`));
      }
    }
    if (!isNonEmptyString(b.attemptId) || !isNonEmptyString(b.repositoryId)) {
      reasons.push(reason("BINDING_IDS_REQUIRED", "bindings.attemptId and repositoryId required"));
    }
  }

  const git = facts.git;
  if (!isOrdinaryPlainObject(git)) {
    reasons.push(reason("GIT_MISSING", "git facts are required"));
  } else {
    for (const k of Object.keys(git)) {
      if (![
        "baseRevision", "headRevision", "baseIsAncestor", "clean",
        "changedFiles", "collectedAt", "nameStatusArtifact", "patchArtifact",
        "objectFormat", "repositoryId",
      ].includes(k)) {
        reasons.push(reason("UNKNOWN_FIELD", `git.${k} is not allowed`));
      }
    }
    for (const key of ["baseRevision", "headRevision", "objectFormat", "repositoryId"]) {
      if (!isNonEmptyString(git[key])) {
        reasons.push(reason("GIT_FIELD_REQUIRED", `git.${key} is required`));
      }
    }
    if (git.baseIsAncestor !== true) {
      reasons.push(reason("BASE_ANCESTOR_REQUIRED", "git.baseIsAncestor must be true"));
    }
    if (git.clean !== true) {
      reasons.push(reason("GIT_DIRTY", "git.clean must be true (final worktree including untracked)"));
    }
    if (!isExactUtcTimestamp(git.collectedAt)) {
      reasons.push(reason("GIT_COLLECTED_AT_INVALID", "git.collectedAt must be exact UTC timestamp"));
    }
    if (!isDigest(git.nameStatusArtifact) || !isDigest(git.patchArtifact)) {
      reasons.push(reason("GIT_ARTIFACT_REQUIRED", "git nameStatus/patch artifact digests required"));
    }
    if (!Array.isArray(git.changedFiles)) {
      reasons.push(reason("CHANGED_FILES_REQUIRED", "git.changedFiles array is required"));
    } else {
      git.changedFiles.forEach((entry, i) => {
        if (!isOrdinaryPlainObject(entry)
          || !isNonEmptyString(entry.status)
          || !isNonEmptyString(entry.path)) {
          reasons.push(reason("CHANGED_FILE_INVALID", `git.changedFiles[${i}] invalid`));
          return;
        }
        const st = entry.status.toUpperCase();
        if (!ALLOWED_STATUSES.has(st) && !/^R\d{0,3}$/.test(st) && !/^C\d{0,3}$/.test(st)) {
          reasons.push(reason("CHANGED_FILE_STATUS", `git.changedFiles[${i}].status not allowed`));
        }
      });
    }
  }

  if (!Array.isArray(facts.commands)) {
    reasons.push(reason("COMMANDS_REQUIRED", "commands array is required"));
  } else {
    facts.commands.forEach((cmd, index) => {
      if (!isOrdinaryPlainObject(cmd)) {
        reasons.push(reason("COMMAND_INVALID", `commands[${index}] must be an object`));
        return;
      }
      const required = [
        "commandId", "argv", "cwdRelative", "timeoutSeconds", "networkPolicy",
        "environmentPolicy", "startedAt", "endedAt", "exitCode", "timedOut",
        "headBefore", "headAfter", "networkAttempted", "stdoutArtifact", "stderrArtifact",
      ];
      for (const k of Object.keys(cmd)) {
        if (!required.includes(k)) {
          reasons.push(reason("UNKNOWN_FIELD", `commands[${index}].${k} is not allowed`));
        }
      }
      for (const k of required) {
        if (!Object.prototype.hasOwnProperty.call(cmd, k)) {
          reasons.push(reason("COMMAND_FIELD_REQUIRED", `commands[${index}].${k} is required`));
        }
      }
      if (cmd.commandId != null && !isDigest(cmd.commandId)) {
        reasons.push(reason("COMMAND_ID_INVALID", `commands[${index}].commandId must be digest`));
      }
      if (!Array.isArray(cmd.argv) || !cmd.argv.every(isNonEmptyString)) {
        reasons.push(reason("COMMAND_ARGV_REQUIRED", `commands[${index}].argv required`));
      }
      if (!isExactUtcTimestamp(cmd.startedAt) || !isExactUtcTimestamp(cmd.endedAt)) {
        reasons.push(reason("COMMAND_TIMESTAMPS_INVALID", `commands[${index}] timestamps invalid`));
      }
      if (!Number.isInteger(cmd.exitCode)) {
        reasons.push(reason("COMMAND_EXIT_REQUIRED", `commands[${index}].exitCode must be integer`));
      }
      if (cmd.timedOut !== false && cmd.timedOut !== true) {
        reasons.push(reason("COMMAND_TIMED_OUT_REQUIRED", `commands[${index}].timedOut must be boolean`));
      }
      if (cmd.networkAttempted !== false && cmd.networkAttempted !== true) {
        reasons.push(reason("COMMAND_NETWORK_FLAG", `commands[${index}].networkAttempted must be boolean`));
      }
      if (!isDigest(cmd.stdoutArtifact) || !isDigest(cmd.stderrArtifact)) {
        reasons.push(reason("COMMAND_ARTIFACT_REQUIRED", `commands[${index}] artifact digests required`));
      }
    });
  }

  if (!isDigest(facts.factsDigest)) {
    reasons.push(reason("FACTS_DIGEST_REQUIRED", "factsDigest is required"));
  } else if (facts.factsDigest !== computeFactsDigest(facts)) {
    reasons.push(reason("FACTS_DIGEST_MISMATCH", "factsDigest does not match body"));
  }

  return { ok: reasons.length === 0, reasons };
}

module.exports = {
  FACTS_SCHEMA,
  FACTS_DOMAIN,
  validateImplementationFactsStructure,
  computeFactsDigest,
  sealImplementationFacts,
};
