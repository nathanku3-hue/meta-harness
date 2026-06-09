"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ConfigError, UsageError } = require("./errors");
const { appendEvent, ensureHarness } = require("./harness-state");
const { writeJsonAtomic } = require("./paths");
const { preflightSkillPromotion } = require("./skill-promotion-preflight");
const {
  canonicalSkillBundleHash,
  readSkillRegistry,
  validateSkillRegistry,
  withMetaHarnessLock,
  _test,
} = require("./skill-registry");

const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function assertSkillName(skillName) {
  if (!SKILL_NAME_PATTERN.test(skillName || "")) {
    throw new UsageError(`invalid skill name: ${skillName}`);
  }
}

function requireDecisionId(decisionId) {
  if (typeof decisionId !== "string" || decisionId.trim() === "") {
    throw new UsageError("skill promotion requires --decision-id");
  }
  return decisionId.trim();
}

function toSlash(value) {
  return value.split(path.sep).join("/");
}

function registryPath(targetRoot) {
  return path.join(targetRoot, ".meta-harness", "skill-registry.json");
}

function activeSkillPath(skillName) {
  return `.agents/skills/${skillName}`;
}

function normalizeRecordPath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/\/+$/, "");
}

function timestampSlug(timestamp = new Date()) {
  return timestamp.toISOString().replace(/[:.]/g, "-");
}

function hashSlug(contentHash) {
  return String(contentHash || "sha256-unknown").replace(/^sha256:/, "").slice(0, 12);
}

function quarantinePath(skillName, reason, contentHash) {
  return `.agents/quarantine/${skillName}-${reason}-${timestampSlug()}-${hashSlug(contentHash)}`;
}

function selectBaseline(records, skillName) {
  return records.find((record) => record.name === skillName && record.status === "active")
    || records.find((record) => record.name === skillName && record.status === "prototype")
    || null;
}

function findRecordIndex(records, target) {
  return records.findIndex((record) => record === target);
}

function writeRegistry(targetRoot, registry) {
  writeJsonAtomic(registryPath(targetRoot), registry);
}

function copyForRecovery(value) {
  return JSON.parse(JSON.stringify(value));
}

function appendSkillLifecycleEvent(targetRoot, action, payload) {
  ensureHarness({ cwd: targetRoot });
  appendEvent({ cwd: targetRoot }, {
    actor: "meta-harness",
    stream: "coding",
    phase: "work",
    action,
    result: payload.result,
    skill: payload.skill,
    decision_id: payload.decision_id,
    active_path: payload.active_path,
    quarantine_path: payload.quarantine_path,
    rollback_path: payload.rollback_path,
    redacted: true,
  });
}

function moveDirectory(targetRoot, fromRel, toRel) {
  const fromPath = _test.resolveUnder(targetRoot, fromRel);
  const toPath = _test.resolveUnder(targetRoot, toRel);
  if (!fs.existsSync(fromPath)) {
    throw new ConfigError(`skill path is missing: ${fromRel}`);
  }
  if (fs.existsSync(toPath)) {
    throw new ConfigError(`target skill path already exists: ${toRel}`);
  }
  fs.mkdirSync(path.dirname(toPath), { recursive: true });
  fs.renameSync(fromPath, toPath);
  return { fromPath, toPath };
}

function restoreMovedDirectory(fromPath, toPath) {
  if (fs.existsSync(toPath) && !fs.existsSync(fromPath)) {
    fs.mkdirSync(path.dirname(fromPath), { recursive: true });
    fs.renameSync(toPath, fromPath);
  }
}

function validateForLifecycle(targetRoot) {
  const validation = validateSkillRegistry(targetRoot);
  if (!validation.ok) {
    throw new ConfigError(`skill registry invalid: ${validation.errors.join("; ")}`);
  }
  return validation.registry;
}

function promoteSkill({ targetRoot, skillName, decisionId, dryRun = false }) {
  assertSkillName(skillName);
  const promotionDecision = requireDecisionId(decisionId);
  return withMetaHarnessLock(targetRoot, "skill-registry", () => {
    const preflight = preflightSkillPromotion({ targetRoot, skillName, permissionDecision: promotionDecision });
    if (!preflight.ok) {
      throw new ConfigError(`promotion preflight blocked: ${preflight.blockers.map((item) => item.message).join("; ")}`);
    }
    const registry = validateForLifecycle(targetRoot);
    const records = registry.skills;
    const candidate = records.find((record) => record.name === skillName && record.status === "candidate");
    const baseline = selectBaseline(records, skillName);
    const activeRel = activeSkillPath(skillName);
    const baselineQuarantine = baseline ? quarantinePath(skillName, "superseded", baseline.content_hash) : null;
    if (dryRun) {
      return { dry_run: true, skill: skillName, status: "would-promote", from: candidate.path, to: activeRel, rollback_path: baselineQuarantine };
    }

    const originalRegistry = copyForRecovery(registry);
    const moved = [];
    try {
      if (baseline && fs.existsSync(_test.resolveUnder(targetRoot, baseline.path))) {
        moved.push(moveDirectory(targetRoot, baseline.path, baselineQuarantine));
        baseline.status = "quarantined";
        baseline.path = baselineQuarantine;
        baseline.quarantined_at = new Date().toISOString();
        baseline.quarantine_reason = "superseded-by-skill-promotion";
      }
      moved.push(moveDirectory(targetRoot, candidate.path, activeRel));
      candidate.status = "active";
      candidate.path = activeRel;
      candidate.promotion_date = new Date().toISOString();
      candidate.promotion_decision = promotionDecision;
      candidate.permission_diff = preflight.permission_diff;
      candidate.previous_version_hash = baseline?.content_hash || null;
      candidate.rollback_hash = baseline?.content_hash || null;
      candidate.rollback_path = baselineQuarantine;
      candidate.first_version = baseline ? false : candidate.first_version === true;
      candidate.content_hash = canonicalSkillBundleHash(targetRoot, activeRel);
      writeRegistry(targetRoot, registry);
      appendSkillLifecycleEvent(targetRoot, "skill.promote", {
        result: "promoted",
        skill: skillName,
        decision_id: promotionDecision,
        active_path: activeRel,
        quarantine_path: baselineQuarantine,
        rollback_path: baselineQuarantine,
      });
      return { dry_run: false, skill: skillName, status: "promoted", from: preflight.candidate.path, to: activeRel, rollback_path: baselineQuarantine };
    } catch (error) {
      for (const item of moved.reverse()) {
        restoreMovedDirectory(item.fromPath, item.toPath);
      }
      writeRegistry(targetRoot, originalRegistry);
      throw error;
    }
  });
}

function activeRecord(registry, skillName) {
  return registry.skills.find((record) => record.name === skillName && record.status === "active") || null;
}

function rollbackRecord(registry, active) {
  return registry.skills.find((record) => record !== active
    && record.status === "quarantined"
    && normalizeRecordPath(record.path) === normalizeRecordPath(active.rollback_path))
    || registry.skills.find((record) => record !== active
      && record.status === "quarantined"
      && record.content_hash === active.rollback_hash)
    || null;
}

function rollbackSkill({ targetRoot, skillName, decisionId, dryRun = false }) {
  assertSkillName(skillName);
  const rollbackDecision = requireDecisionId(decisionId);
  return withMetaHarnessLock(targetRoot, "skill-registry", () => {
    const registry = validateForLifecycle(targetRoot);
    const active = activeRecord(registry, skillName);
    if (!active) {
      throw new UsageError(`active skill not found: ${skillName}`);
    }
    if (!active.rollback_hash || !active.rollback_path) {
      throw new ConfigError(`active skill has no rollback path: ${skillName}`);
    }
    const restoreRecord = rollbackRecord(registry, active);
    if (!restoreRecord) {
      throw new ConfigError(`rollback record not found for ${skillName}`);
    }
    const activeRel = activeSkillPath(skillName);
    const currentQuarantine = quarantinePath(skillName, "rolled-back", active.content_hash);
    if (dryRun) {
      return { dry_run: true, skill: skillName, status: "would-rollback", from: active.path, to: restoreRecord.path, quarantine_path: currentQuarantine };
    }

    const originalRegistry = copyForRecovery(registry);
    const moved = [];
    const originalActivePath = active.path;
    try {
      moved.push(moveDirectory(targetRoot, active.path, currentQuarantine));
      moved.push(moveDirectory(targetRoot, restoreRecord.path, activeRel));
      active.status = "quarantined";
      active.path = currentQuarantine;
      active.quarantined_at = new Date().toISOString();
      active.quarantine_reason = "rolled-back";
      restoreRecord.status = "active";
      restoreRecord.path = activeRel;
      restoreRecord.restored_at = new Date().toISOString();
      restoreRecord.restored_by_decision = rollbackDecision;
      restoreRecord.content_hash = canonicalSkillBundleHash(targetRoot, activeRel);
      writeRegistry(targetRoot, registry);
      appendSkillLifecycleEvent(targetRoot, "skill.rollback", {
        result: "rolled-back",
        skill: skillName,
        decision_id: rollbackDecision,
        active_path: activeRel,
        quarantine_path: currentQuarantine,
        rollback_path: activeRel,
      });
      return { dry_run: false, skill: skillName, status: "rolled-back", from: originalActivePath, to: activeRel, quarantine_path: currentQuarantine };
    } catch (error) {
      for (const item of moved.reverse()) {
        restoreMovedDirectory(item.fromPath, item.toPath);
      }
      writeRegistry(targetRoot, originalRegistry);
      throw error;
    }
  });
}

module.exports = { promoteSkill, readSkillRegistry, rollbackSkill };
