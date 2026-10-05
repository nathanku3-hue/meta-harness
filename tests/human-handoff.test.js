"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  AUDIT,
  normalizeEnvelope,
  renderValidatedHumanHandoff,
  validateHumanHandoffText,
} = require("../lib/human-handoff");
const { renderHuman } = require("../lib/commands/work");
const { DRAIN_COMPLETE } = require("../lib/work-loop");

function baseEnvelope(overrides = {}) {
  return {
    status: "The requested product result is now observable.",
    why: "The completed work resolved the current product gap without requiring lifecycle detail.",
    next: {
      action: "Use the completed result.",
      where: "After implementation and validation, before any new product objective.",
      whyNow: "The requested result is complete.",
      locks: ["the delivered result", "the current product direction"],
      doneWhen: "The result is consumed or a new product gap is observed.",
      unlocks: "A new independent objective can begin.",
      whyNotOthers: ["Repeating the completed implementation would not change the product result."],
    },
    humanStopRequired: false,
    humanStopReason: null,
    decisionQuestion: null,
    egressSource: "NORMAL_COMPLETION",
    ...overrides,
  };
}

function capture(result, options = {}) {
  let output = "";
  renderHuman({ stdout: { write: (chunk) => { output += String(chunk); } } }, result, options);
  return output;
}

test("runtime contract and distributable contract cannot drift on required fields", () => {
  const contract = fs.readFileSync(
    path.join(__dirname, "..", "templates", "contracts", "human-handoff-contract.md"),
    "utf8",
  );
  for (const marker of [
    "HumanHandoffEnvelope",
    "status",
    "why",
    "next.where",
    "next.why_now",
    "next.locks[]",
    "next.done_when",
    "next.unlocks",
    "next.why_not_others[1..3]",
    "human_stop_required",
    "NORMAL_COMPLETION",
    "RESUME_COMPLETION",
    "SUBAGENT_AGGREGATION",
    "USE_PRODUCT",
    "There is no direct raw-worker-to-user path.",
    "There is no direct special-exit-to-user path.",
  ]) {
    assert.ok(contract.includes(marker), `missing contract marker: ${marker}`);
  }

  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.ok(packageJson.files.includes("templates/**/*.md"));
});

test("raw worker report and audit dump are rejected from PM closure", () => {
  const raw = [
    "**Outcome:** DONE",
    "**Round:** R1",
    "**Progress:** 100%",
    "**Confidence:** High",
    "**Validation / evidence:** 12/12 PASS",
    "**Worker accountability:** provider calls=0; broker=false; real capital=NONE. No commit or push was performed.",
  ].join("\n");
  const errors = validateHumanHandoffText(raw, { humanStopRequired: false });
  assert.ok(errors.length >= 4);
  assert.match(errors.join("\n"), /Outcome metadata/u);
  assert.match(errors.join("\n"), /audit section/u);
  assert.match(errors.join("\n"), /raw zero-counter/u);
});

test("embedded lifecycle metadata is rejected even when pasted into Status", () => {
  const text = renderValidatedHumanHandoff(baseEnvelope()).replace(
    "Status: The requested product result is now observable.",
    "Status: Outcome: DONE; the requested product result is now observable.",
  );
  const errors = validateHumanHandoffText(text, { humanStopRequired: false });
  assert.match(errors.join("\n"), /embedded lifecycle metadata/u);
});

test("terminal envelopes may omit next but active envelopes may not", () => {
  const terminal = normalizeEnvelope(baseEnvelope({
    next: null,
    presentation: { textMode: "COMPLETION" },
  }));
  assert.equal(terminal.next, null);

  assert.throws(
    () => normalizeEnvelope(baseEnvelope({
      next: null,
      presentation: { textMode: "CONTINUATION" },
    })),
    /next is required while product work remains active/u,
  );
});

test("egress source is mandatory instead of silently defaulting to normal", () => {
  const envelope = baseEnvelope();
  delete envelope.egressSource;
  assert.throws(() => normalizeEnvelope(envelope), /egressSource is invalid/u);
});

test("resume narration is rejected but resume source itself never renders", () => {
  const invalid = renderValidatedHumanHandoff(baseEnvelope({
    status: "The task is complete.",
    egressSource: "RESUME_COMPLETION",
  }));
  assert.doesNotMatch(invalid, /resume|interruption|rerun/iu);

  const leaked = invalid.replace(
    "Status: The task is complete.",
    "Status: On resume I detected that the task completed during the interruption.",
  );
  const errors = validateHumanHandoffText(leaked, { humanStopRequired: false });
  assert.match(errors.join("\n"), /resume narration|interruption narration/iu);
});

test("fake owner stop is impossible when humanStopRequired is false", () => {
  assert.throws(
    () => normalizeEnvelope(baseEnvelope({
      humanStopRequired: false,
      humanStopReason: "OWNER_DECISION",
      decisionQuestion: "Proceed?",
    })),
    /human stop payload is forbidden/u,
  );

  const rendered = renderValidatedHumanHandoff(baseEnvelope());
  const tampered = `${rendered}Decision needed: wait for owner.\n`;
  const errors = validateHumanHandoffText(tampered, { humanStopRequired: false });
  assert.match(errors.join("\n"), /Decision needed is forbidden/u);
  assert.match(errors.join("\n"), /bureaucratic owner wait/u);
});

test("legitimate owner-exclusive stop renders one concrete decision question", () => {
  const rendered = renderValidatedHumanHandoff(baseEnvelope({
    humanStopRequired: true,
    humanStopReason: "PROTECTED_ACCESS",
    decisionQuestion: "Provide access to the protected dataset?",
  }));
  assert.match(rendered, /Decision needed: Provide access to the protected dataset\?/u);
  assert.equal(validateHumanHandoffText(rendered, { humanStopRequired: true }).length, 0);
});

test("AUDIT mode explicitly permits machine evidence language", () => {
  const audit = "Outcome: DONE\nSAW Verdict: PASS\nClosurePacket: x\n";
  assert.deepEqual(validateHumanHandoffText(audit, { mode: AUDIT }), []);
});

test("completion renderer cannot be switched into AUDIT mode by a caller", () => {
  assert.throws(
    () => renderValidatedHumanHandoff(baseEnvelope({
      status: "Outcome: DONE",
    }), { mode: AUDIT }),
    (error) => error && error.code === "MH_HUMAN_HANDOFF_EGRESS",
  );
});

test("all three completion sources render through the same schema-first gate", () => {
  for (const egressSource of [
    "NORMAL_COMPLETION",
    "RESUME_COMPLETION",
    "SUBAGENT_AGGREGATION",
  ]) {
    const rendered = renderValidatedHumanHandoff(baseEnvelope({ egressSource }));
    assert.match(rendered, /^Status:/u);
    assert.match(rendered, /^Why:/mu);
    assert.match(rendered, /^Next:/mu);
    assert.match(rendered, /^- Where:/mu);
    assert.match(rendered, /^- Why now:/mu);
    assert.match(rendered, /^- Lock:/mu);
    assert.match(rendered, /^- Done when:/mu);
    assert.match(rendered, /^- Why not other candidates:/mu);
    assert.doesNotMatch(rendered, /Outcome:|Worker accountability|On resume/iu);
  }
});

test("renderHuman cannot bypass the PM egress validator with raw worker leakage", () => {
  assert.throws(
    () => capture({
      outcome: "DONE",
      observableResult: "Outcome: DONE; provider calls=0; broker=false",
      productResult: "Ship result.",
      nextAction: "Use the result.",
    }),
    (error) => error && error.code === "MH_TEXT_PRESENTATION_EGRESS",
  );
});

test("USE_PRODUCT completion cannot bypass the PM egress gate or manufacture next work", () => {
  const rendered = capture({
    outcome: "USE_PRODUCT",
  });
  assert.equal(rendered, "No current product gap.\n");
  assert.doesNotMatch(rendered, /Next —|Status:|Why:|Where:|Outcome:|Worker accountability|On resume/iu);
});

test("drain completion cannot bypass the PM egress gate or manufacture next work", () => {
  const rendered = capture(DRAIN_COMPLETE, { source: "RESUME_COMPLETION" });
  assert.equal(rendered, "Stopped safely — current product state is preserved.\n");
  assert.doesNotMatch(rendered, /Next —|Status:|Why:|Where:|Outcome:|Worker accountability|On resume I detected/iu);
});

test("repo-wave aggregation cannot surface legacy owner-decision prose without controller ownerEffect", () => {
  const rendered = capture({
    schemaVersion: "repo-work-wave-result/v2",
    outcome: "PARTIAL",
    outcomes: [{
      state: "LANDED",
      desiredState: "The parser is fixed.",
      observableResult: "The parser is fixed.",
      ownerRequest: { question: "This legacy field should not stop the user." },
    }],
  });
  assert.doesNotMatch(rendered, /Decision needed|Need you|ownerRequest|Next —/iu);
  assert.equal(rendered, "Done — The parser is fixed.\n");
  assert.doesNotMatch(rendered, /^Status:|^Why:|^- Where:/mu);
});
