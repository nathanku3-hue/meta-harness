"use strict";

const DOCS_PATCH_KIND = "docs_patch";
const PATCH_SEVERITY = "info";
const STATUS_SOURCE = ".meta-harness/status.md";
const READY_SOURCE = ".meta-harness/ready.json";
const REPOS_SOURCE = ".meta-harness/repos.json";
const TEMPLATE_MANIFEST_SOURCE = ".meta-harness/templates/manifest.json";
const DEFAULT_SKILL_REGISTRY_SOURCE = ".meta-harness/skill-registry.json";

const READINESS_ACTION_IDS = Object.freeze(new Set([
  "ACTION_REVIEW_FAILED_READINESS",
  "ACTION_REVIEW_WARNED_READINESS",
  "ACTION_REVIEW_STALE_READINESS",
  "ACTION_REVIEW_INVALID_READINESS",
  "ACTION_REVIEW_UNKNOWN_READINESS",
]));

const CATEGORY_ORDER = Object.freeze([
  "readiness",
  "template",
  "security",
  "skill",
  "governance",
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function stripColonDetail(source) {
  return String(source || "").split(":")[0] || null;
}

function relativePath(value, fallback) {
  const candidate = stripColonDetail(value) || fallback;
  if (!candidate || candidate.startsWith("/") || /^[A-Za-z]:[\\/]/.test(candidate)) return fallback;
  return candidate.replace(/\\/g, "/");
}

function patchProposal(fields) {
  return {
    id: fields.id,
    kind: DOCS_PATCH_KIND,
    severity: PATCH_SEVERITY,
    reason: fields.reason,
    source_action_id: fields.source_action_id,
    target_path: fields.target_path,
    operation: fields.operation,
    proposal: fields.proposal,
    diff: null,
    mutates: false,
  };
}

function proposalForAction(action) {
  if (!action || !action.id) return null;
  if (READINESS_ACTION_IDS.has(action.id)) {
    return ["readiness", patchProposal({
      id: "PATCH_PROPOSE_READINESS_REVIEW",
      reason: "propose reviewing child readiness evidence before follow-up changes",
      source_action_id: action.id,
      target_path: relativePath(action.target_path, READY_SOURCE),
      operation: "review",
      proposal: "Review child readiness evidence before planning any follow-up change.",
    })];
  }
  if (action.id === "ACTION_REVIEW_MISSING_REPO") {
    return ["readiness", patchProposal({
      id: "PATCH_PROPOSE_REPO_PATH_REVIEW",
      reason: "propose reviewing configured child repo path",
      source_action_id: action.id,
      target_path: REPOS_SOURCE,
      operation: "review",
      proposal: "Review configured child repo path before planning any follow-up change.",
    })];
  }
  if (action.id === "ACTION_REVIEW_TEMPLATE_DRIFT") {
    if (action.source_warning_id === "DRIFT_TEMPLATE_MANIFEST_MISSING") {
      return ["template", patchProposal({
        id: "PATCH_PROPOSE_TEMPLATE_MANIFEST_REVIEW",
        reason: "propose reviewing missing child template manifest",
        source_action_id: action.id,
        target_path: TEMPLATE_MANIFEST_SOURCE,
        operation: "review",
        proposal: "Review whether the child should adopt the parent template manifest before any sync action.",
      })];
    }
    if (["DRIFT_TEMPLATE_VERSION", "DRIFT_TEMPLATE_ENTRY_MISSING", "DRIFT_TEMPLATE_HASH"].includes(action.source_warning_id)) {
      return ["template", patchProposal({
        id: "PATCH_PROPOSE_TEMPLATE_DRIFT_REVIEW",
        reason: "propose reviewing child template manifest drift",
        source_action_id: action.id,
        target_path: TEMPLATE_MANIFEST_SOURCE,
        operation: "review",
        proposal: "Review template manifest drift and decide whether a later sync or manual update is appropriate.",
      })];
    }
  }
  if (action.id === "ACTION_REVIEW_SECURITY_DRIFT") {
    if (action.source_warning_id === "DRIFT_SECURITY_FILE_MISSING") {
      return ["security", patchProposal({
        id: "PATCH_PROPOSE_SECURITY_FILE_REVIEW",
        reason: "propose reviewing missing child security policy file",
        source_action_id: action.id,
        target_path: relativePath(action.target_path, STATUS_SOURCE),
        operation: "review",
        proposal: "Review whether the child should add the missing security policy file from the parent.",
      })];
    }
    if (action.source_warning_id === "DRIFT_SECURITY_FILE_HASH") {
      return ["security", patchProposal({
        id: "PATCH_PROPOSE_SECURITY_FILE_DIFF_REVIEW",
        reason: "propose reviewing child security policy differences",
        source_action_id: action.id,
        target_path: relativePath(action.target_path, STATUS_SOURCE),
        operation: "review",
        proposal: "Review child security policy differences before proposing any manual update.",
      })];
    }
  }
  if (action.id === "ACTION_REVIEW_SKILL_DRIFT") {
    if (action.source_warning_id === "DRIFT_SKILL_REGISTRY_MISSING") {
      return ["skill", patchProposal({
        id: "PATCH_PROPOSE_SKILL_REGISTRY_REVIEW",
        reason: "propose reviewing missing child skill registry",
        source_action_id: action.id,
        target_path: relativePath(action.target_path, DEFAULT_SKILL_REGISTRY_SOURCE),
        operation: "review",
        proposal: "Review whether the child should adopt a skill registry before any manual update.",
      })];
    }
    if (["DRIFT_SKILL_REGISTRY_VERSION", "DRIFT_SKILL_ID", "DRIFT_SKILL_VERSION"].includes(action.source_warning_id)) {
      return ["skill", patchProposal({
        id: "PATCH_PROPOSE_SKILL_REGISTRY_DIFF_REVIEW",
        reason: "propose reviewing child skill registry drift",
        source_action_id: action.id,
        target_path: relativePath(action.target_path, DEFAULT_SKILL_REGISTRY_SOURCE),
        operation: "review",
        proposal: "Review child skill registry drift before proposing any manual update.",
      })];
    }
  }
  if (action.id === "ACTION_REVIEW_GOVERNANCE_DRIFT") {
    if (action.source_warning_id === "DRIFT_STATUS_PHASE_MARKER") {
      return ["governance", patchProposal({
        id: "PATCH_PROPOSE_STATUS_PHASE_MARKER",
        reason: "propose adding a Phase marker to child status documentation",
        source_action_id: action.id,
        target_path: STATUS_SOURCE,
        operation: "insert",
        proposal: "Add a Phase: marker near the top of .meta-harness/status.md.",
      })];
    }
    if (action.source_warning_id === "DRIFT_READY_SCHEMA_VERSION") {
      return ["governance", patchProposal({
        id: "PATCH_PROPOSE_READY_SCHEMA_REVIEW",
        reason: "propose reviewing child ready schema compatibility",
        source_action_id: action.id,
        target_path: READY_SOURCE,
        operation: "review",
        proposal: "Review ready.json schema_version compatibility before refreshing or regenerating readiness evidence.",
      })];
    }
  }
  return null;
}

function buildPatchProposals(repo) {
  const buckets = new Map(CATEGORY_ORDER.map((category) => [category, []]));
  for (const action of asArray(repo && repo.action_candidates)) {
    const proposal = proposalForAction(action);
    if (!proposal) continue;
    buckets.get(proposal[0]).push(proposal[1]);
  }
  return CATEGORY_ORDER.flatMap((category) => buckets.get(category));
}

module.exports = { buildPatchProposals };
