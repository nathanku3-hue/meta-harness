"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { git, repository } = require("./helpers/linear-product-head");
const { tempDir } = require("./helpers/cli");
const {
  evaluateStructuralSaw,
  loadPredecessorStructuralPolicy,
  preparePredecessorStructuralSaw,
} = require("../lib/repo-structural-saw");
const { compareStructuralSaw, structuralSnapshot } = require("../lib/structural-saw");

function writeJson(root, relative, value) {
  const filePath = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function policyBundle(root, { sourceBudget = 3 } = {}) {
  writeJson(root, ".meta-harness/clean-code-contract.json", {
    v: 1,
    mode: "ratchet",
    ratchets: {
      direct_events_jsonl_append: { approved_helpers: ["appendEvent"] },
      worker_report_flags: { must_not_increase_without: ["--from", "--input"] },
    },
    excluded_dirs: [".git", ".meta-harness", "node_modules"],
  });
  writeJson(root, ".meta-harness/complexity-policy.json", {
    schema_version: "1.0.0",
    version: 1,
    line_budgets: { source: sourceBudget, bin_entrypoint: sourceBudget, command_module: sourceBudget, test: sourceBudget },
    duplicate_template_allowlist: [],
    import_direction: {
      "bin -> lib/commands": "allowed",
      "bin -> lib": "allowed",
      "lib/commands -> lib": "allowed",
      "lib/commands -> bin": "forbidden",
      "lib -> bin": "forbidden",
      "lib -> lib/commands": "forbidden",
      "templates -> lib": "forbidden",
    },
  });
  writeJson(root, "docs/architecture/owners.json", { schema_version: "1.0.0", version: 1, modules: [] });
}

function writeLines(root, relative, count, tail = "") {
  const filePath = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = Array.from({ length: count }, (_, index) => `const v${index}=0;`);
  if (tail) lines.push(tail);
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function copyTree(t, source) {
  const root = tempDir("structural-saw-tree-");
  fs.cpSync(source, root, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("structural SAW is repository-policy-owned and rejects partial bundles", (t) => {
  const empty = tempDir("structural-saw-empty-");
  t.after(() => fs.rmSync(empty, { recursive: true, force: true }));
  assert.equal(loadPredecessorStructuralPolicy(empty).active, false);

  writeJson(empty, ".meta-harness/complexity-policy.json", { schema_version: "1.0.0" });
  assert.throws(
    () => loadPredecessorStructuralPolicy(empty),
    (error) => error.code === "MH_STRUCTURAL_SAW_POLICY" && /partial structural SAW policy bundle/u.test(error.message),
  );
});

test("current product tree grandfathers old debt but blocks new or worsened structural facts", (t) => {
  const predecessorRoot = tempDir("structural-saw-predecessor-");
  t.after(() => fs.rmSync(predecessorRoot, { recursive: true, force: true }));
  policyBundle(predecessorRoot, { sourceBudget: 3 });
  writeLines(predecessorRoot, "lib/old.js", 5);
  writeLines(predecessorRoot, "lib/ok.js", 1);
  const bundle = loadPredecessorStructuralPolicy(predecessorRoot);
  const predecessor = structuralSnapshot(predecessorRoot, bundle);

  const unrelatedRoot = copyTree(t, predecessorRoot);
  writeLines(unrelatedRoot, "lib/ok.js", 2);
  assert.deepEqual(compareStructuralSaw(predecessor, structuralSnapshot(unrelatedRoot, bundle), bundle.cleanCodeContract), []);

  const growthRoot = copyTree(t, predecessorRoot);
  writeLines(growthRoot, "lib/old.js", 6);
  assert.equal(compareStructuralSaw(predecessor, structuralSnapshot(growthRoot, bundle), bundle.cleanCodeContract)[0].rule, "grandfathered_module_grew");

  const importRoot = copyTree(t, predecessorRoot);
  writeLines(importRoot, "lib/new.js", 0, 'require("../bin/entry");');
  const importRegression = compareStructuralSaw(predecessor, structuralSnapshot(importRoot, bundle), bundle.cleanCodeContract)
    .find((item) => item.rule === "forbidden_import");
  assert.deepEqual(
    { direction: importRegression.direction, source: importRegression.source, target: importRegression.target },
    { direction: "lib -> bin", source: "lib/new.js", target: "bin/entry" },
  );
});

test("candidate policy mutation cannot change the frozen predecessor rules", (t) => {
  const { root, baseline } = repository(t);
  policyBundle(root, { sourceBudget: 2 });
  writeLines(root, "lib/tiny.js", 2);
  const predecessor = preparePredecessorStructuralSaw(root);

  policyBundle(root, { sourceBudget: 999 });
  writeLines(root, "lib/tiny.js", 3);
  const evidence = evaluateStructuralSaw({
    repositoryPath: root,
    workspacePath: root,
    predecessorProductCommit: baseline,
    candidateTreeOid: git(root, ["rev-parse", "HEAD^{tree}"]),
    changedPaths: [".meta-harness/complexity-policy.json", "lib/tiny.js"],
    predecessor,
  });

  assert.equal(evidence.passed, false);
  assert.deepEqual(
    evidence.regressions.map((item) => item.rule).sort(),
    ["module_budget_crossed", "policy_self_modification"],
  );
  assert.equal(evidence.policyIdentity.complexityPolicyDigest, predecessor.policyBundle.identity.complexityPolicyDigest);
});
