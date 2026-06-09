"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const GOVERNANCE_DIR = [".meta-harness", "domain-governance"];
const ACTIVATION_FILE = "activation.json";
const PILOT_CHAIN_FILE = "pilot-chain.json";
const DECISION_ID_PATTERN = /^D\d{3}$/;

function check(id, name, ok, reason = "", nextAction = "") {
  return {
    id,
    name,
    status: ok ? "pass" : "fail",
    reason: ok ? "" : reason,
    next_action: ok ? "" : nextAction,
  };
}

function skip(id, name, reason = "") {
  return { id, name, status: "skip", reason, next_action: "" };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function readJson(filePath) {
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(filePath, "utf8")) };
  } catch (error) {
    return {
      ok: false,
      reason: error && error.code === "ENOENT" ? "missing file" : "unreadable or malformed JSON",
    };
  }
}

function safeRelativePathExists(targetRoot, relativePath) {
  if (!nonEmptyString(relativePath) || path.isAbsolute(relativePath)) return false;
  const resolved = path.resolve(targetRoot, relativePath);
  const relative = path.relative(targetRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return false;
  return fs.existsSync(resolved);
}

function fileReferenceCheck(targetRoot, label, relativePath) {
  const ok = safeRelativePathExists(targetRoot, relativePath);
  return ok ? "" : `${label} missing or outside target: ${relativePath || "missing"}`;
}

function httpUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function gitHead(targetRoot) {
  const inside = spawnSync("git", ["-C", targetRoot, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8", shell: false });
  if (inside.status !== 0 || inside.stdout.trim() !== "true") return null;
  const head = spawnSync("git", ["-C", targetRoot, "rev-parse", "HEAD"], { encoding: "utf8", shell: false });
  return head.status === 0 ? head.stdout.trim() : null;
}

function activationSchemaFailures(activation) {
  const failures = [];
  if (!DECISION_ID_PATTERN.test(activation.decision_id || "")) failures.push("decision_id must match D###");
  if (!nonEmptyString(activation.domain)) failures.push("domain is required");
  if (!isObject(activation.adopter)) {
    failures.push("adopter is required");
  } else {
    if (!nonEmptyString(activation.adopter.repo_url || activation.adopter.url)) failures.push("adopter repo URL is required");
    if (!nonEmptyString(activation.adopter.repo_path || activation.adopter.path)) failures.push("adopter repo path is required");
    if (!nonEmptyString(activation.adopter.commit)) failures.push("adopter commit is required");
    if (!nonEmptyString(activation.adopter.owner)) failures.push("adopter owner is required");
  }
  if (!isObject(activation.ready_evidence)) failures.push("ready_evidence is required");
  if (!isObject(activation.domain_owner)) failures.push("domain_owner is required");
  if (!isObject(activation.reviewer)) failures.push("reviewer is required");
  if (!isObject(activation.boundary)) failures.push("boundary is required");
  if (!isObject(activation.activation)) {
    failures.push("activation is required");
  } else if (!nonEmptyString(activation.activation.requested_at)) {
    failures.push("activation.requested_at is required");
  }
  if (!isObject(activation.release_impact)) failures.push("release_impact is required");
  if (!isObject(activation.patch_plan)) failures.push("patch_plan is required");
  return failures;
}

function validateActivation(targetRoot, activationRead) {
  if (!activationRead.ok) {
    return {
      activation: null,
      checks: [check("MH_DG_ACTIVATION_001", "activation file", false, activationRead.reason, "Create .meta-harness/domain-governance/activation.json")],
    };
  }

  const activation = activationRead.data;
  const checks = [];
  const schemaFailures = isObject(activation) ? activationSchemaFailures(activation) : ["activation must be a JSON object"];
  checks.push(check("MH_DG_ACTIVATION_001", "activation file/schema", schemaFailures.length === 0, schemaFailures.join("; "), "Fix activation.json required fields"));

  const ready = activation.ready_evidence || {};
  const readyFailures = [];
  if (!nonEmptyString(ready.command)) readyFailures.push("ready_evidence.command is required");
  if (ready.ok !== true) readyFailures.push("ready_evidence.ok must be true");
  if (!nonEmptyString(ready.git_commit)) readyFailures.push("ready_evidence.git_commit is required");
  if (!nonEmptyString(ready.state_hash)) readyFailures.push("ready_evidence.state_hash is required");
  if (!nonEmptyString(ready.generated_at)) readyFailures.push("ready_evidence.generated_at is required");
  checks.push(check("MH_DG_READY_EVIDENCE_001", "downstream ready evidence", readyFailures.length === 0, readyFailures.join("; "), "Regenerate passing ready evidence"));

  const head = gitHead(targetRoot);
  if (head) {
    checks.push(check("MH_DG_READY_COMMIT_001", "ready evidence commit", ready.git_commit === head, `ready_evidence.git_commit ${ready.git_commit || "missing"} does not match target HEAD ${head}`, "Refresh ready evidence at target HEAD"));
  } else {
    checks.push(skip("MH_DG_READY_COMMIT_001", "ready evidence commit", "git metadata unavailable"));
  }

  const owner = activation.domain_owner || {};
  const reviewer = activation.reviewer || {};
  const peopleFailures = [];
  if (!nonEmptyString(owner.name)) peopleFailures.push("domain_owner.name is required");
  if (!nonEmptyString(owner.handle)) peopleFailures.push("domain_owner.handle is required");
  if (!nonEmptyString(owner.request)) peopleFailures.push("domain_owner.request is required");
  if (!nonEmptyString(reviewer.name)) peopleFailures.push("reviewer.name is required");
  if (!nonEmptyString(reviewer.handle)) peopleFailures.push("reviewer.handle is required");
  checks.push(check("MH_DG_OWNER_REVIEWER_001", "owner/reviewer", peopleFailures.length === 0, peopleFailures.join("; "), "Add named domain owner and reviewer"));

  const boundary = activation.boundary || {};
  const boundaryFailures = [];
  if (!nonEmptyString(boundary.doc)) boundaryFailures.push("boundary.doc is required");
  if (!nonEmptyArray(boundary.in_scope)) boundaryFailures.push("boundary.in_scope must be nonempty");
  if (!nonEmptyArray(boundary.out_of_scope)) boundaryFailures.push("boundary.out_of_scope must be nonempty");
  const boundaryFileFailure = fileReferenceCheck(targetRoot, "boundary.doc", boundary.doc);
  if (boundaryFileFailure) boundaryFailures.push(boundaryFileFailure);
  checks.push(check("MH_DG_BOUNDARY_001", "governed-data boundary", boundaryFailures.length === 0, boundaryFailures.join("; "), "Declare and link the governed-data boundary"));

  const releaseImpact = activation.release_impact || {};
  checks.push(check("MH_DG_RELEASE_IMPACT_001", "release-impact classification", releaseImpact.phase_10_guard_weakens === false, "release_impact.phase_10_guard_weakens must be false", "Classify release impact without weakening Phase 10 guards"));

  const patchPlan = activation.patch_plan || {};
  const patchFailures = [];
  if (!nonEmptyArray(patchPlan.files)) patchFailures.push("patch_plan.files must be nonempty");
  if (!nonEmptyArray(patchPlan.non_goals)) patchFailures.push("patch_plan.non_goals must be nonempty");
  checks.push(check("MH_DG_PATCH_BOUNDS_001", "patch bounds", patchFailures.length === 0, patchFailures.join("; "), "Bound the pilot patch plan and non-goals"));

  return { activation, checks };
}

function validatePilotChain(targetRoot, activation, pilotRead) {
  if (!pilotRead.ok) {
    return {
      pilot: null,
      checks: [
        check("MH_DG_PILOT_CHAIN_001", "pilot chain", false, pilotRead.reason, "Create .meta-harness/domain-governance/pilot-chain.json"),
        check("MH_DG_REVIEW_SIGNOFF_001", "reviewer signoff", false, "pilot chain is missing", "Add signed reviewer signoff"),
      ],
    };
  }

  const pilot = pilotRead.data;
  const failures = [];
  if (!isObject(pilot)) failures.push("pilot-chain must be a JSON object");
  if (isObject(pilot)) {
    if (pilot.activation_decision_id !== activation?.decision_id) failures.push("activation_decision_id must match activation decision_id");
    if (!nonEmptyString(pilot.chain_id)) failures.push("chain_id is required");
    if (!isObject(pilot.source) || !nonEmptyString(pilot.source.id) || !nonEmptyString(pilot.source.uri)) failures.push("source id/uri are required");
    if (!isObject(pilot.fact) || !nonEmptyString(pilot.fact.id) || !nonEmptyString(pilot.fact.source_id) || !nonEmptyString(pilot.fact.statement)) failures.push("fact id/source_id/statement are required");
    if (!isObject(pilot.ontology_term) || !nonEmptyString(pilot.ontology_term.id) || !nonEmptyString(pilot.ontology_term.label) || !nonEmptyString(pilot.ontology_term.definition)) failures.push("ontology_term id/label/definition are required");
    if (!isObject(pilot.code_mapping) || !nonEmptyString(pilot.code_mapping.fact_id) || !nonEmptyString(pilot.code_mapping.term_id) || !nonEmptyString(pilot.code_mapping.file)) failures.push("code_mapping fact_id/term_id/file are required");
    if (!isObject(pilot.golden_case) || !nonEmptyString(pilot.golden_case.id) || !nonEmptyString(pilot.golden_case.file) || !nonEmptyString(pilot.golden_case.assertion)) failures.push("golden_case id/file/assertion are required");
    if (pilot.fact?.source_id && pilot.source?.id && pilot.fact.source_id !== pilot.source.id) failures.push("fact.source_id must match source.id");
    if (pilot.code_mapping?.fact_id && pilot.fact?.id && pilot.code_mapping.fact_id !== pilot.fact.id) failures.push("code_mapping.fact_id must match fact.id");
    if (pilot.code_mapping?.term_id && pilot.ontology_term?.id && pilot.code_mapping.term_id !== pilot.ontology_term.id) failures.push("code_mapping.term_id must match ontology_term.id");
    if (pilot.source?.uri && !httpUrl(pilot.source.uri)) {
      const sourceFailure = fileReferenceCheck(targetRoot, "source.uri", pilot.source.uri);
      if (sourceFailure) failures.push(sourceFailure);
    }
    const codeFailure = fileReferenceCheck(targetRoot, "code_mapping.file", pilot.code_mapping?.file);
    if (codeFailure) failures.push(codeFailure);
    const goldenFailure = fileReferenceCheck(targetRoot, "golden_case.file", pilot.golden_case?.file);
    if (goldenFailure) failures.push(goldenFailure);
  }

  const review = pilot.review || {};
  const reviewerMatches = review.reviewer === activation?.reviewer?.handle || review.reviewer === activation?.reviewer?.name;
  const reviewFailures = [];
  if (!nonEmptyString(review.reviewer)) reviewFailures.push("review.reviewer is required");
  if (!reviewerMatches) reviewFailures.push("review.reviewer must match activation reviewer handle or name");
  if (review.status !== "signed_off") reviewFailures.push("review.status must be signed_off");
  if (!nonEmptyString(review.signed_at)) reviewFailures.push("review.signed_at is required");

  return {
    pilot,
    checks: [
      check("MH_DG_PILOT_CHAIN_001", "pilot chain", failures.length === 0, failures.join("; "), "Complete the pilot chain evidence"),
      check("MH_DG_REVIEW_SIGNOFF_001", "reviewer signoff", reviewFailures.length === 0, reviewFailures.join("; "), "Have the activation reviewer sign off"),
    ],
  };
}

function countChecks(checks) {
  return {
    pass: checks.filter((item) => item.status === "pass").length,
    fail: checks.filter((item) => item.status === "fail").length,
    skip: checks.filter((item) => item.status === "skip").length,
  };
}

function checkDomainGovernance({ targetRoot }) {
  const governanceRoot = path.join(targetRoot, ...GOVERNANCE_DIR);
  const activationRead = readJson(path.join(governanceRoot, ACTIVATION_FILE));
  const pilotRead = readJson(path.join(governanceRoot, PILOT_CHAIN_FILE));
  const activationResult = validateActivation(targetRoot, activationRead);
  const pilotResult = validatePilotChain(targetRoot, activationResult.activation, pilotRead);
  const checks = [...activationResult.checks, ...pilotResult.checks];
  const counts = countChecks(checks);

  return {
    schema_version: "1",
    ok: counts.fail === 0,
    target: targetRoot.split(path.sep).join("/"),
    activation_decision_id: activationResult.activation?.decision_id || null,
    pilot_chain_id: pilotResult.pilot?.chain_id || null,
    counts,
    checks,
    next_action: counts.fail === 0 ? "none" : checks.find((item) => item.status === "fail")?.next_action || "Fix failed domain governance checks",
  };
}

module.exports = { checkDomainGovernance };
