"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  POST_PHASE_REFLECTION_BEGIN,
  POST_PHASE_REFLECTION_END,
  inspectPostPhaseReflectionGuidance,
  installPostPhaseReflectionGuidance,
} = require("../lib/active-guidance");
const { ROOT, tempDir, writeFile } = require("./helpers/cli");

function readAgents(targetRoot) {
  return fs.readFileSync(path.join(targetRoot, "AGENTS.md"), "utf8");
}

test("active guidance install preserves repository instructions and is idempotent", () => {
  const targetRoot = tempDir();
  const original = "# Repository instructions\n\nKeep this local rule exactly.\n";
  writeFile(targetRoot, "AGENTS.md", original);

  const first = installPostPhaseReflectionGuidance({ sourceRoot: ROOT, targetRoot });
  const installed = readAgents(targetRoot);
  assert.equal(first.action, "added");
  assert.equal(first.changed, true);
  assert.ok(installed.startsWith(original));
  assert.equal(installed.match(new RegExp(POST_PHASE_REFLECTION_BEGIN, "g")).length, 1);
  assert.equal(installed.match(new RegExp(POST_PHASE_REFLECTION_END, "g")).length, 1);
  assert.equal(inspectPostPhaseReflectionGuidance({ sourceRoot: ROOT, targetRoot }).status, "PASS");

  const second = installPostPhaseReflectionGuidance({ sourceRoot: ROOT, targetRoot });
  assert.deepEqual(second, { action: "unchanged", changed: false, path: "AGENTS.md" });
  assert.equal(readAgents(targetRoot), installed);
});

test("active guidance install creates missing AGENTS and repairs only its managed block", () => {
  const targetRoot = tempDir();
  const created = installPostPhaseReflectionGuidance({ sourceRoot: ROOT, targetRoot });
  assert.equal(created.action, "created");
  assert.equal(inspectPostPhaseReflectionGuidance({ sourceRoot: ROOT, targetRoot }).status, "PASS");

  const original = readAgents(targetRoot);
  const drifted = original.replace("durable cross-repository lessons", "temporary repository status");
  fs.writeFileSync(path.join(targetRoot, "AGENTS.md"), `LOCAL-PREFIX\n${drifted}LOCAL-SUFFIX\n`, "utf8");
  assert.equal(inspectPostPhaseReflectionGuidance({ sourceRoot: ROOT, targetRoot }).status, "DRIFT");

  const repaired = installPostPhaseReflectionGuidance({ sourceRoot: ROOT, targetRoot });
  const finalText = readAgents(targetRoot);
  assert.equal(repaired.action, "updated");
  assert.equal(repaired.changed, true);
  assert.ok(finalText.startsWith("LOCAL-PREFIX\n"));
  assert.ok(finalText.endsWith("LOCAL-SUFFIX\n"));
  assert.equal(inspectPostPhaseReflectionGuidance({ sourceRoot: ROOT, targetRoot }).status, "PASS");
});

test("active guidance install rejects partial or duplicate markers without writing", () => {
  const cases = [
    `${POST_PHASE_REFLECTION_BEGIN}\npartial\n`,
    `${POST_PHASE_REFLECTION_BEGIN}\none\n${POST_PHASE_REFLECTION_END}\n${POST_PHASE_REFLECTION_BEGIN}\ntwo\n${POST_PHASE_REFLECTION_END}\n`,
  ];

  for (const content of cases) {
    const targetRoot = tempDir();
    const agentsPath = writeFile(targetRoot, "AGENTS.md", content);
    const before = fs.readFileSync(agentsPath, "utf8");
    const inspection = inspectPostPhaseReflectionGuidance({ sourceRoot: ROOT, targetRoot });
    assert.equal(inspection.status, "REJECTED");
    assert.match(inspection.detail, /partial or duplicated/);
    assert.throws(
      () => installPostPhaseReflectionGuidance({ sourceRoot: ROOT, targetRoot }),
      /partial or duplicated/,
    );
    assert.equal(fs.readFileSync(agentsPath, "utf8"), before);
  }
});
