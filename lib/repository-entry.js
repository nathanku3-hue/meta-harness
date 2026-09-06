"use strict";

const { normalizeHarnessError } = require("./errors");
const { repoPlannerEnabled } = require("./repo-planner-input");
const { listRunSessions, readRunJournal, runIdForSession } = require("./run-journal");
const {
  commonGitDirectory,
  latestWorkSessionState,
  readOwnerGoalIngress,
  recoverLatestDirectProductIntent,
  repositoryRoot,
} = require("./work-git");

const META_ENTRY_SCHEMA = "meta-entry/v1";
const META_ENTRY_ACTIONS = Object.freeze(["CONTINUE", "IDLE"]);

function freezeEntry(value) {
  return Object.freeze(value);
}

function latestOwnerGoalJournalRecovery(root) {
  const gitCommonDirectory = commonGitDirectory(root);
  const candidates = [];
  for (const session of listRunSessions({ gitCommonDirectory })) {
    if (session.origin?.type !== "OWNER_GOAL") continue;
    const events = readRunJournal({
      gitCommonDirectory,
      runId: runIdForSession(session.sessionDigest),
    });
    const completed = [...events].reverse().find((event) => event.type === "run/completed") || null;
    candidates.push({
      session,
      events,
      completed,
      observedAt: events.at(-1)?.at || null,
    });
  }
  candidates.sort((left, right) => Date.parse(right.observedAt || 0) - Date.parse(left.observedAt || 0)
    || right.session.sessionDigest.localeCompare(left.session.sessionDigest));
  const latest = candidates[0] || null;
  if (!latest) return Object.freeze({ state: "NONE", intent: null });
  if (latest.completed?.data?.outcome === "DONE") {
    return Object.freeze({ state: "SETTLED", intent: null });
  }
  return Object.freeze({
    state: "RECOVERABLE",
    intent: Object.freeze({
      content: latest.session.productResult,
      sessionDigest: latest.session.sessionDigest,
      source: "RUN_JOURNAL_INTENT",
    }),
  });
}

function ownerGoalJournalRecoveryForIntent(root, intent) {
  if (!intent?.sessionDigest) return Object.freeze({ state: "NONE", intent: null });
  const gitCommonDirectory = commonGitDirectory(root);
  const events = readRunJournal({
    gitCommonDirectory,
    runId: runIdForSession(intent.sessionDigest),
  });
  if (events.length === 0) return Object.freeze({ state: "NONE", intent: null });
  const completed = [...events].reverse().find((event) => event.type === "run/completed") || null;
  if (completed?.data?.outcome === "DONE") return Object.freeze({ state: "SETTLED", intent: null });
  return Object.freeze({
    state: "RECOVERABLE",
    intent: Object.freeze({
      content: intent.content,
      sessionDigest: intent.sessionDigest,
      source: "RUN_JOURNAL_INTENT",
    }),
  });
}

function hasRecoverableRepoRun(root) {
  const gitCommonDirectory = commonGitDirectory(root);
  for (const session of listRunSessions({ gitCommonDirectory })) {
    if (!["REPO_RUN", "REPO_OUTCOME"].includes(session.origin?.type)) continue;
    const events = readRunJournal({
      gitCommonDirectory,
      runId: runIdForSession(session.sessionDigest),
    });
    if (!events.some((event) => event.type === "integration/result"
        && ["APPLIED", "ALREADY_APPLIED", "LANDED"].includes(event.data?.status))) return true;
  }
  return false;
}

function resolveRepositoryEntry(repositoryPath) {
  let root = null;
  let diagnostic = null;
  try {
    root = repositoryRoot(repositoryPath);
  } catch (error) {
    diagnostic = normalizeHarnessError(error);
    return freezeEntry({
      schemaVersion: META_ENTRY_SCHEMA,
      action: "IDLE",
      result: null,
      kind: "IDLE",
      repositoryRoot: null,
      session: null,
      ingress: null,
      error: diagnostic,
    });
  }

  let direct = null;
  try {
    direct = latestWorkSessionState(root);
  } catch (error) {
    diagnostic = normalizeHarnessError(error);
  }
  if (direct?.state === "ACTIVE") {
    return freezeEntry({
      schemaVersion: META_ENTRY_SCHEMA,
      action: "CONTINUE",
      result: direct.session.productResult,
      kind: "DIRECT_SESSION",
      repositoryRoot: root,
      session: direct.session,
      ingress: null,
      error: diagnostic,
    });
  }

  const recoverableDirectFailure = diagnostic
    && [
      "MH_WORKSPACE_CUSTODY_READ",
      "MH_WORKSPACE_CUSTODY_MISMATCH",
      "MH_WORKSPACE_NOT_EXECUTABLE",
      "MH_WORK_WORKTREE_MISSING",
      "MH_WORK_RESUME",
    ].includes(diagnostic.code);
  if (recoverableDirectFailure || direct?.state === "TERMINAL") {
    let pointerIntent = null;
    try {
      pointerIntent = recoverLatestDirectProductIntent(root);
    } catch (error) {
      diagnostic = diagnostic || normalizeHarnessError(error);
    }
    let journalRecovery = Object.freeze({ state: "NONE", intent: null });
    try {
      journalRecovery = pointerIntent
        ? ownerGoalJournalRecoveryForIntent(root, pointerIntent)
        : latestOwnerGoalJournalRecovery(root);
    } catch (error) {
      diagnostic = diagnostic || normalizeHarnessError(error);
    }
    const recovered = journalRecovery.intent
      || (journalRecovery.state === "NONE" ? pointerIntent : null);
    if (recovered) {
      return freezeEntry({
        schemaVersion: META_ENTRY_SCHEMA,
        action: "CONTINUE",
        result: recovered.content,
        kind: "OWNER_GOAL_INGRESS",
        repositoryRoot: root,
        session: null,
        ingress: Object.freeze({
          content: recovered.content,
          recovered: true,
          sessionDigest: recovered.sessionDigest,
          source: recovered.source,
        }),
        error: diagnostic,
      });
    }
  }

  let ingress = null;
  try {
    ingress = readOwnerGoalIngress(root, { optional: true });
  } catch (error) {
    diagnostic = diagnostic || normalizeHarnessError(error);
  }
  if (ingress) {
    return freezeEntry({
      schemaVersion: META_ENTRY_SCHEMA,
      action: "CONTINUE",
      result: ingress.content,
      kind: "OWNER_GOAL_INGRESS",
      repositoryRoot: root,
      session: null,
      ingress,
      error: diagnostic,
    });
  }

  let recoverableRepoRun = false;
  try {
    recoverableRepoRun = hasRecoverableRepoRun(root);
  } catch (error) {
    diagnostic = diagnostic || normalizeHarnessError(error);
  }
  let plannerEnabled = false;
  try {
    plannerEnabled = repoPlannerEnabled(root);
  } catch (error) {
    diagnostic = diagnostic || normalizeHarnessError(error);
  }
  if (recoverableRepoRun || plannerEnabled) {
    return freezeEntry({
      schemaVersion: META_ENTRY_SCHEMA,
      action: "CONTINUE",
      result: null,
      kind: "REPO_WAVE",
      repositoryRoot: root,
      session: null,
      ingress: null,
      error: diagnostic,
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
    error: diagnostic,
  });
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
  if (!entry || entry.schemaVersion !== META_ENTRY_SCHEMA || !META_ENTRY_ACTIONS.includes(entry.action)) {
    throw new TypeError("repository entry must be a resolved meta-entry/v1 value");
  }
  return entry;
}

module.exports = {
  META_ENTRY_ACTIONS,
  META_ENTRY_SCHEMA,
  assertRepositoryEntryValid,
  publicRepositoryEntry,
  resolveRepositoryEntry,
};
