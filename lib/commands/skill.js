"use strict";
const path = require("node:path");
const { fail, parseArgs, requireTargetRoot } = require("../cli-args");
const { writeLine } = require("../cli-context");
const { normalizeHarnessError } = require("../errors");
const { diagnoseRepoAdoption } = require("../repo-adoption-doctor");
const { preflightSkillPromotion } = require("../skill-promotion-preflight");
const { runPromote, runRollback } = require("./skill-lifecycle");
const { disableSkill, validateSkillRegistry } = require("../skill-registry");
function toSlash(value) {
  return value.split(path.sep).join("/");
}
function jsonLine(context, payload) {
  writeLine(context, JSON.stringify(payload, null, 2));
}
function skillErrorPayload(error, nextAction = "Fix the skill registry or command input, then retry.") {
  const normalized = normalizeHarnessError(error);
  return {
    schema_version: "1.0.0",
    ok: false,
    error_code: normalized.code,
    message: normalized.message,
    next_action: nextAction,
  };
}
function humanValidation(context, result) {
  writeLine(context, `Registry: ${result.ok ? "PASS" : "FAIL"}`);
  writeLine(context, `Active Skills: ${result.registry?.skills?.filter((skill) => skill.status === "active").length || 0}`);
  writeLine(context, `Prototype Skills: ${result.registry?.skills?.filter((skill) => skill.status === "prototype").length || 0}`);
  if (!result.ok) {
    for (const error of result.errors) {
      writeLine(context, `FAIL  ${error}`);
    }
  }
}
function runCheck(options, context) {
  const targetRoot = requireTargetRoot(options, context);
  const result = validateSkillRegistry(targetRoot);
  const payload = {
    schema_version: "1.0.0",
    ok: result.ok,
    target: toSlash(path.relative(context.cwd, targetRoot)) || ".",
    registry: result.ok ? "PASS" : "FAIL",
    active_skills: result.registry?.skills?.filter((skill) => skill.status === "active").length || 0,
    prototype_skills: result.registry?.skills?.filter((skill) => skill.status === "prototype").length || 0,
    errors: result.errors,
    ...(result.ok ? {} : {
      error_code: "MH_CONFIG",
      message: result.errors.join("; "),
      next_action: "Fix .meta-harness/skill-registry.json and retry.",
    }),
  };
  if (options.json) {
    jsonLine(context, payload);
  } else {
    humanValidation(context, result);
  }
  return { exitCode: result.ok ? 0 : 1 };
}
function humanDoctor(context, result) {
  writeLine(context, `Repo Adoption Doctor: ${result.ok ? "PASS" : "FINDINGS"}`);
  if (result.findings.length === 0) {
    writeLine(context, "- none");
    return;
  }
  for (const finding of result.findings) {
    writeLine(context, `${finding.severity.toUpperCase()}\t${finding.id}\t${finding.issue}`);
  }
}
function runDoctor(options, context) {
  const targetRoot = requireTargetRoot(options, context);
  const result = diagnoseRepoAdoption({ sourceRoot: path.resolve(__dirname, "..", ".."), targetRoot });
  const blockFindings = result.findings.filter((finding) => finding.severity === "block");
  const exitCode = options.strict && blockFindings.length > 0 ? 2 : 0;
  const payload = {
    schema_version: "1.0.0",
    ok: result.ok,
    target: toSlash(path.relative(context.cwd, targetRoot)) || ".",
    strict: Boolean(options.strict),
    findings: result.findings,
    next_action: result.ok ? "none" : result.findings[0].fix,
    ...(exitCode === 0 ? {} : {
      error_code: "MH_SKILL_FINDINGS",
      message: "diagnostic findings include block severity",
    }),
  };
  if (options.json) {
    jsonLine(context, payload);
  } else {
    humanDoctor(context, result);
  }
  return { exitCode };
}
function runDisable(positional, options, context) {
  const skillName = positional[1];
  if (!skillName) {
    fail("skill disable requires a skill name");
  }
  const targetRoot = requireTargetRoot(options, context);
  const result = disableSkill({
    targetRoot,
    skillName,
    reason: typeof options.reason === "string" ? options.reason : "operator-requested",
    dryRun: Boolean(options.dryRun),
  });
  const payload = {
    schema_version: "1.0.0",
    ok: true,
    ...result,
  };
  if (options.json) {
    jsonLine(context, payload);
  } else {
    writeLine(context, `${result.status}\t${result.skill}\t${result.from} -> ${result.to}`);
  }
  return { exitCode: 0 };
}
function humanPreflight(context, result) {
  writeLine(context, `Promotion Preflight: ${result.preflight}`);
  writeLine(context, `Skill: ${result.skill}`);
  if (result.candidate) {
    writeLine(context, `Candidate: ${result.candidate.status}\t${result.candidate.path}`);
  }
  if (result.permission_diff.baseline) {
    writeLine(context, `Baseline: ${result.permission_diff.baseline.status}\t${result.permission_diff.baseline.path}`);
  }
  if (result.permission_diff.added_allowed_tools.length > 0) {
    writeLine(context, `Added Allowed Tools: ${result.permission_diff.added_allowed_tools.join(", ")}`);
  }
  if (result.permission_diff.removed_forbidden_paths.length > 0) {
    writeLine(context, `Removed Forbidden Paths: ${result.permission_diff.removed_forbidden_paths.join(", ")}`);
  }
  if (result.permission_authorization) {
    writeLine(context, `Permission Decision: ${result.permission_authorization}`);
  }
  if (result.blockers.length === 0) {
    writeLine(context, "- none");
    return;
  }
  for (const item of result.blockers) {
    writeLine(context, `FAIL\t${item.id}\t${item.message}`);
  }
}
function runPreflight(positional, options, context) {
  const skillName = positional[1];
  if (!skillName) {
    fail("skill preflight requires a skill name");
  }
  const targetRoot = requireTargetRoot(options, context);
  const result = preflightSkillPromotion({
    targetRoot,
    skillName,
    permissionDecision: typeof options.permissionDecision === "string" ? options.permissionDecision : null,
  });
  const payload = {
    ...result,
    target: toSlash(path.relative(context.cwd, targetRoot)) || ".",
  };
  if (options.json) {
    jsonLine(context, payload);
  } else {
    humanPreflight(context, payload);
  }
  return { exitCode: payload.ok ? 0 : 1 };
}
module.exports = function runSkill(args, context) {
  const { positional, options } = parseArgs(args);
  const action = positional[0] || "check";
  try {
    if (action === "check") {
      return runCheck(options, context);
    }
    if (action === "doctor") {
      return runDoctor(options, context);
    }
    if (action === "preflight") {
      return runPreflight(positional, options, context);
    }
    if (action === "promote") {
      return runPromote(positional, options, context);
    }
    if (action === "rollback") {
      return runRollback(positional, options, context);
    }
    if (action === "disable") {
      return runDisable(positional, options, context);
    }
    fail(`unknown skill action: ${action}`);
  } catch (error) {
    if (options.json) {
      const payload = skillErrorPayload(error);
      jsonLine(context, payload);
      return { exitCode: normalizeHarnessError(error).exitCode || 1 };
    }
    throw error;
  }
};
