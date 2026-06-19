"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CANDIDATE_PROFILE_SCHEMA,
  profileFromJudgeEvidence,
  renderProfileGuidance,
  validateCandidateProfile,
} = require("../lib/judge-profile");

function judgeEnvelope(overrides = {}) {
  return {
    schema_version: "1.0.0",
    tool: "meta-harness-judge",
    generated_at: "2026-06-19T00:00:00.000Z",
    ok: false,
    status: "fail",
    target: {
      path: "E:/Code/meta-harness",
      git_root: "E:/Code/meta-harness",
      base_ref: "origin/main",
      base_sha: "base",
      head_sha: "head",
      changed_files: ["lib/feature.js", "docs/note.md"],
      untracked_files: ["docs/note.md"],
    },
    input: {
      source: "inline",
      round: "ROUND-015",
      model: "gpt-5.5",
      smoke_checks: ["cli_help"],
    },
    checks: [
      {
        check_id: "JUDGE_DEFENSIVE_001",
        trait: "over-defensive-abstraction",
        status: "fail",
        evidence: "new generic defensive helper pattern found in added lines",
        files: ["lib/feature.js"],
      },
      {
        check_id: "JUDGE_SCOPE_001",
        trait: "eager-broad-edits",
        status: "fail",
        evidence: "changed files outside declared scope",
        files: ["docs/note.md"],
      },
    ],
    errors: [],
    traits_triggered: ["eager-broad-edits", "over-defensive-abstraction"],
    candidate_profile_events: [
      {
        trait: "over-defensive-abstraction",
        check_id: "JUDGE_DEFENSIVE_001",
        status: "fail",
        files: ["lib\\feature.js"],
      },
      {
        trait: "eager-broad-edits",
        check_id: "JUDGE_SCOPE_001",
        status: "fail",
        files: ["docs/note.md"],
      },
    ],
    ...overrides,
  };
}

test("candidate profile schema exposes the intended stable JSON envelope", () => {
  assert.equal(CANDIDATE_PROFILE_SCHEMA.properties.schema_version.const, "1.0.0");
  assert.equal(CANDIDATE_PROFILE_SCHEMA.properties.tool.const, "meta-harness-candidate-profile");
  assert.deepEqual(CANDIDATE_PROFILE_SCHEMA.required, [
    "schema_version",
    "tool",
    "generated_at",
    "ok",
    "status",
    "source",
    "traits",
    "guidance",
    "errors",
  ]);
});

test("candidate profile aggregates judge trait events into read-only guidance", () => {
  const profile = profileFromJudgeEvidence(judgeEnvelope(), {
    generatedAt: "2026-06-19T01:00:00.000Z",
  });

  assert.equal(profile.ok, true);
  assert.equal(profile.status, "profiled");
  assert.equal(profile.source.round, "ROUND-015");
  assert.equal(profile.source.model, "gpt-5.5");
  assert.equal(profile.source.check_count, 2);
  assert.deepEqual(profile.traits.map((item) => item.trait), [
    "eager-broad-edits",
    "over-defensive-abstraction",
  ]);
  assert.deepEqual(profile.traits[1].files, ["lib/feature.js"]);
  assert.equal(profile.traits[1].evidence[0].evidence, "new generic defensive helper pattern found in added lines");

  assert.equal(profile.guidance.length, 2);
  assert.equal(profile.guidance[0].mode, "read_only_guidance");
  assert.equal(profile.guidance[0].authority, "advisory_only");
  assert.match(profile.guidance[0].text, /Declare owned files/);
  assert.equal("delegation_policy" in profile.guidance[0], false);
  assert.equal("routing_decision" in profile.guidance[0], false);
  assert.equal(validateCandidateProfile(profile).ok, true);
});

test("candidate profile remains valid when no traits are observed", () => {
  const profile = profileFromJudgeEvidence(judgeEnvelope({
    ok: true,
    status: "pass",
    checks: [],
    traits_triggered: [],
    candidate_profile_events: [],
  }), {
    generatedAt: "2026-06-19T01:00:00.000Z",
  });

  assert.equal(profile.ok, true);
  assert.equal(profile.status, "no_observed_traits");
  assert.deepEqual(profile.traits, []);
  assert.deepEqual(profile.guidance, []);
  assert.equal(renderProfileGuidance(profile), "candidate profile: no_observed_traits\nno judge-derived guidance\n");
  assert.equal(validateCandidateProfile(profile).ok, true);
});

test("candidate profile fails closed for invalid or errored judge evidence", () => {
  const invalidTool = profileFromJudgeEvidence({ tool: "other", schema_version: "1.0.0" }, {
    generatedAt: "2026-06-19T01:00:00.000Z",
  });
  assert.equal(invalidTool.ok, false);
  assert.equal(invalidTool.status, "insufficient_evidence");
  assert.equal(invalidTool.errors[0].code, "PROFILE_INPUT_TOOL_INVALID");
  assert.deepEqual(invalidTool.guidance, []);

  const erroredJudge = profileFromJudgeEvidence(judgeEnvelope({
    ok: false,
    status: "fail",
    checks: [],
    candidate_profile_events: [{ trait: "eager-broad-edits", check_id: "JUDGE_SCOPE_001", status: "fail", files: [] }],
    errors: [{ code: "JUDGE_INPUT_BASE_REF_UNAVAILABLE", message: "base_ref missing" }],
  }), {
    generatedAt: "2026-06-19T01:00:00.000Z",
  });
  assert.equal(erroredJudge.ok, false);
  assert.equal(erroredJudge.status, "insufficient_evidence");
  assert.equal(erroredJudge.errors[0].code, "PROFILE_INPUT_HAS_ERRORS");
  assert.deepEqual(erroredJudge.traits, []);
});

test("unknown judge traits get generic advisory guidance without becoming policy", () => {
  const profile = profileFromJudgeEvidence(judgeEnvelope({
    checks: [{
      check_id: "JUDGE_FUTURE_001",
      trait: "future-trait",
      status: "warn",
      evidence: "future checker emitted an advisory event",
      files: ["lib/future.js"],
    }],
    traits_triggered: ["future-trait"],
    candidate_profile_events: [{
      trait: "future-trait",
      check_id: "JUDGE_FUTURE_001",
      status: "warn",
      files: ["lib/future.js"],
    }],
  }), {
    generatedAt: "2026-06-19T01:00:00.000Z",
  });

  assert.equal(profile.ok, true);
  assert.equal(profile.traits[0].priority, "medium");
  assert.equal(profile.guidance[0].id, "JUDGE_GUIDANCE_REVIEW_EVIDENCE");
  assert.match(profile.guidance[0].text, /Review the referenced judge evidence/);
  assert.equal(profile.guidance[0].authority, "advisory_only");
});

test("profile renderer keeps guidance compact and evidence-derived", () => {
  const profile = profileFromJudgeEvidence(judgeEnvelope(), {
    generatedAt: "2026-06-19T01:00:00.000Z",
  });
  const rendered = renderProfileGuidance(profile);

  assert.match(rendered, /^candidate profile: profiled/);
  assert.match(rendered, /HIGH eager-broad-edits/);
  assert.match(rendered, /HIGH over-defensive-abstraction/);
  assert.equal(rendered.split(/\r?\n/).filter(Boolean).length, 3);
});
