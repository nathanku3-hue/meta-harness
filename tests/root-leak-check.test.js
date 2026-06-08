"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { isEvidenceSidecar, scanRootLeakArtifacts } = require("../lib/root-leak-check");
const { runReadyCheck } = require("../lib/ready-check");
const { tempDir } = require("./helpers/cli");

test("root leak check detects sibling evidence sidecars", () => {
  const parent = tempDir();
  const targetRoot = path.join(parent, "target-repo");
  fs.mkdirSync(targetRoot);
  fs.writeFileSync(path.join(parent, "boot_gov_proof_staged.patch"), "diff\n", "utf8");
  fs.writeFileSync(path.join(parent, "meta-harness-porcelain-status.txt"), " M file\n", "utf8");
  fs.writeFileSync(path.join(parent, "ordinary-note.txt"), "ok\n", "utf8");

  const result = scanRootLeakArtifacts({ targetRoot });

  assert.equal(result.status, "REJECTED");
  assert.deepEqual(result.items.map((item) => item.path), [
    "../boot_gov_proof_staged.patch",
    "../meta-harness-porcelain-status.txt",
  ]);
  assert.match(result.items[0].detail, /\.meta-harness\/local/);
});

test("root leak filename matcher stays narrow", () => {
  assert.equal(isEvidenceSidecar("boot_gov_proof_staged.patch"), true);
  assert.equal(isEvidenceSidecar("meta-harness-mixed-workspace.patch"), true);
  assert.equal(isEvidenceSidecar("meta-harness-untracked-files.txt"), true);
  assert.equal(isEvidenceSidecar("feature.patch"), false);
  assert.equal(isEvidenceSidecar("notes.txt"), false);
});

test("ready root leak check warns locally and fails in strict mode", async () => {
  const parent = tempDir();
  const targetRoot = path.join(parent, "target-repo");
  fs.mkdirSync(targetRoot);
  fs.writeFileSync(path.join(parent, "target-repo-staged.patch"), "diff\n", "utf8");

  const local = await runReadyCheck({ targetRoot, quick: true, readOnly: true, mode: "local" });
  const localCheck = local.checks.find((check) => check.id === "MH_STATE_ROOT_LEAK_001");
  assert.equal(localCheck.status, "warn");
  assert.match(localCheck.reason, /target-repo-staged\.patch/);

  const strict = await runReadyCheck({ targetRoot, quick: true, readOnly: true, mode: "strict" });
  const strictCheck = strict.checks.find((check) => check.id === "MH_STATE_ROOT_LEAK_001");
  assert.equal(strictCheck.status, "fail");
  assert.match(strictCheck.next_action, /\.meta-harness\/local/);
});
