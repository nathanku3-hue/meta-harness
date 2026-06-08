"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  analyzeComplexity,
  compareComplexityToBaseline,
  defaultComplexityPolicy,
  _test,
} = require("../lib/quality-complexity");
const { runRaw, tempDir, writeFile } = require("./helpers/cli");

function writeJson(root, relative, value) {
  writeFile(root, relative, `${JSON.stringify(value, null, 2)}\n`);
}

function seedComplexityRepo() {
  const root = tempDir();
  writeJson(root, ".meta-harness/complexity-policy.json", defaultComplexityPolicy());
  writeJson(root, "docs/architecture/owners.json", {
    schema_version: "1.0.0",
    version: 1,
    modules: [
      { path: "lib/", owner: "owner", risk: "implementation", budget_lines: 400 },
      { path: "lib/commands/", owner: "owner", risk: "command", budget_lines: 200 },
    ],
  });
  writeFile(root, ".github/CODEOWNERS", "/lib/ @owner\n");
  return root;
}

test("import scanner ignores comments and strings while detecting real import forms", () => {
  const imports = _test.scanImports(`
    // require("./commands/commented")
    const text = "require('./commands/string')";
    const fs = require("node:fs");
    const resolved = require.resolve("./commands/resolved");
    import thing from "./commands/static.js";
    export { thing } from "./commands/exported.js";
    import("./commands/dynamic.js");
    import(dynamicTarget);
  `);

  assert.deepEqual(imports.map((item) => item.specifier || "<dynamic>"), [
    "node:fs",
    "./commands/resolved",
    "./commands/static.js",
    "./commands/exported.js",
    "./commands/dynamic.js",
    "<dynamic>",
  ]);
});

test("complexity analysis reports stable import and registry findings", () => {
  const root = seedComplexityRepo();
  const sourceFiles = [{
    relative: "lib/shared.js",
    lines: 4,
    text: `
      require("node:fs");
      require("package/subpath");
      import alias from "#local-alias";
      import command from "./commands/run.js";
    `,
  }];

  const analysis = analyzeComplexity(root, {
    sourceFiles,
    checkIdRegistry: [
      { id: "MH_SYNC_001", public: true },
      { id: "MH_SYNC_001", public: true },
      { id: "BAD_001", public: true },
    ],
  });

  const ids = analysis.findings.map((item) => item.id);
  assert.equal(ids.includes("MH_COMPLEXITY_REVERSE_IMPORT"), true);
  assert.equal(ids.includes("MH_COMPLEXITY_DUPLICATE_CHECK_ID"), true);
  assert.equal(ids.includes("MH_COMPLEXITY_INVALID_CHECK_ID_NAMESPACE"), true);
});

test("complexity module budget ratchet distinguishes new, grew, and crossed", () => {
  const findings = compareComplexityToBaseline({
    findings: [],
    module_budgets: [
      { relative: "lib/new-big.js", lines: 450, max_lines: 400, overbudget: true },
      { relative: "lib/old-big.js", lines: 460, max_lines: 400, overbudget: true },
      { relative: "lib/crossed.js", lines: 410, max_lines: 400, overbudget: true },
    ],
  }, {
    complexity: {
      module_budgets: {
        "lib/old-big.js": { lines: 450, overbudget: true, max_lines: 400 },
        "lib/crossed.js": { lines: 399, overbudget: false, max_lines: 400 },
      },
    },
  });

  assert.deepEqual(findings.map((item) => item.id), [
    "MH_COMPLEXITY_MODULE_BUDGET_NEW",
    "MH_COMPLEXITY_MODULE_BUDGET_GREW",
    "MH_COMPLEXITY_MODULE_BUDGET_CROSSED",
  ]);
});

test("owners duplicate paths and invalid CODEOWNERS syntax are deterministic findings", () => {
  const root = tempDir();
  writeJson(root, ".meta-harness/complexity-policy.json", defaultComplexityPolicy());
  writeJson(root, "docs/architecture/owners.json", {
    schema_version: "1.0.0",
    version: 1,
    modules: [
      { path: "lib/", owner: "owner", risk: "implementation", budget_lines: 400 },
      { path: "./lib/", owner: "owner", risk: "implementation", budget_lines: 400 },
    ],
  });
  writeFile(root, ".github/CODEOWNERS", "!lib/ @owner\n/lib/ @owner\n");

  const analysis = analyzeComplexity(root, { sourceFiles: [] });
  const ids = analysis.findings.map((item) => item.id);
  assert.equal(ids.includes("MH_COMPLEXITY_OWNER_PATH_DUPLICATE"), true);
  assert.equal(ids.includes("MH_COMPLEXITY_CODEOWNERS_INVALID"), true);
});

test("quality check json keeps old fields and adds complexity schema", () => {
  const root = tempDir();
  const init = runRaw(root, ["quality", "init"]);
  assert.equal(init.status, 0, init.stderr);

  const checked = runRaw(root, ["quality", "check", "--json"]);
  assert.equal(checked.status, 0, checked.stderr);
  const payload = JSON.parse(checked.stdout);
  assert.equal(payload.schema_version, "1.0.0");
  assert.equal(payload.analysis.schema_version, "1.0.0");
  assert.equal(Array.isArray(payload.analysis.files), true);
  assert.equal(payload.analysis.complexity.schema_version, "1.0.0");
});
