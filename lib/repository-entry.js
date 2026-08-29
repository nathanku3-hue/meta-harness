"use strict";

const { normalizeHarnessError } = require("./errors");
const { repoPlannerEnabled } = require("./repo-planner-input");
const {
  latestWorkSessionState,
  readOwnerGoalIngress,
  repositoryRoot,
} = require("./work-git");

const META_ENTRY_SCHEMA = "meta-entry/v1";
const META_ENTRY_ACTIONS = Object.freeze(["CONTINUE", "IDLE", "INVALID"]);

function freezeEntry(value) {
  return Object.freeze(value);
}

function resolveRepositoryEntry(repositoryPath) {
  try {
    const root = repositoryRoot(repositoryPath);
    const direct = latestWorkSessionState(root);
    if (direct.state === "ACTIVE") {
      return freezeEntry({
        schemaVersion: META_ENTRY_SCHEMA,
        action: "CONTINUE",
        result: direct.session.productResult,
        kind: "DIRECT_SESSION",
        repositoryRoot: root,
        session: direct.session,
        ingress: null,
        error: null,
      });
    }

    const ingress = readOwnerGoalIngress(root, { optional: true });
    if (ingress) {
      return freezeEntry({
        schemaVersion: META_ENTRY_SCHEMA,
        action: "CONTINUE",
        result: ingress.content,
        kind: "OWNER_GOAL_INGRESS",
        repositoryRoot: root,
        session: null,
        ingress,
        error: null,
      });
    }

    if (repoPlannerEnabled(root)) {
      return freezeEntry({
        schemaVersion: META_ENTRY_SCHEMA,
        action: "CONTINUE",
        result: null,
        kind: "REPO_WAVE",
        repositoryRoot: root,
        session: null,
        ingress: null,
        error: null,
      });
    }

    return freezeEntry({
      schemaVersion: META_ENTRY_SCHEMA,
      action: "IDLE",
      result: null,
      kind: "IDLE",
      repositoryRoot: root,
      session: null,
      ingress: null,
      error: null,
    });
  } catch (error) {
    return freezeEntry({
      schemaVersion: META_ENTRY_SCHEMA,
      action: "INVALID",
      result: null,
      kind: "INVALID",
      repositoryRoot: null,
      session: null,
      ingress: null,
      error: normalizeHarnessError(error),
    });
  }
}

function publicRepositoryEntry(entry) {
  if (!entry || entry.schemaVersion !== META_ENTRY_SCHEMA || !META_ENTRY_ACTIONS.includes(entry.action)) {
    throw new TypeError("repository entry must be a resolved meta-entry/v1 value");
  }
  return Object.freeze({
    schemaVersion: META_ENTRY_SCHEMA,
    action: entry.action,
    result: entry.result ?? null,
  });
}

function assertRepositoryEntryValid(entry) {
  if (entry.action !== "INVALID") return entry;
  throw entry.error || new Error("repository continuation authority is invalid");
}

module.exports = {
  META_ENTRY_ACTIONS,
  META_ENTRY_SCHEMA,
  assertRepositoryEntryValid,
  publicRepositoryEntry,
  resolveRepositoryEntry,
};
