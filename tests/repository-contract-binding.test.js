"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  assertRepositoryContractBindingsCurrent,
  compileRepositoryContractBindings,
  protectedRepositoryContractPaths,
  renderRepositoryContractBindings,
} = require("../lib/repository-contract-binding");
const { tempDir } = require("./helpers/cli");

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return String(result.stdout || "").trim();
}

function fixture(t, { validatorExitCode = 0 } = {}) {
  const root = tempDir("repository-contract-binding-");
  fs.mkdirSync(path.join(root, ".meta-harness"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs", "context"), { recursive: true });
  git(root, ["init"]);
  git(root, ["config", "user.name", "Repository Contract Test"]);
  git(root, ["config", "user.email", "repository-contract@example.invalid"]);

  const contractPath = "docs/context/mission.json";
  const contract = {
    schema_version: "mission/v1",
    economic_question: "Which uncertainty must this slice resolve?",
    decision_to_change: "Advance only if the frozen evidence changes the named decision.",
  };
  const controlPath = "docs/context/control.json";
  fs.writeFileSync(path.join(root, contractPath), `${JSON.stringify(contract, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(root, controlPath), "{\"secret_control\":true}\n", "utf8");
  fs.writeFileSync(path.join(root, ".meta-harness", "repository-contract-bindings.json"), `${JSON.stringify({
    schemaVersion: "repository-contract-bindings/v1",
    bindings: [
      {
        id: "TEST_MISSION",
        path: contractPath,
        visibility: "MODEL",
        validator: {
          argv: [process.execPath, "-e", `process.exit(${validatorExitCode})`],
          cwd: ".",
          timeoutSeconds: 30,
        },
      },
      {
        id: "TEST_CONTROL",
        path: controlPath,
        visibility: "CONTROL_ONLY",
        validator: null,
      },
    ],
  }, null, 2)}\n`, "utf8");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "bind mission"]);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, head: git(root, ["rev-parse", "HEAD"]), contractPath, controlPath };
}

test("repository contracts derive from the exact Git base without a durable sidecar", (t) => {
  const { root, head, contractPath, controlPath } = fixture(t);
  const compiled = compileRepositoryContractBindings({ repositoryPath: root, baseCommit: head });

  assert.ok(compiled);
  assert.equal(compiled.baseCommit, head);
  assert.equal(compiled.bindings.length, 2);
  assert.equal(compiled.bindings[0].id, "TEST_MISSION");
  assert.equal(compiled.bindings[0].path, contractPath);
  assert.equal(compiled.bindings[1].visibility, "CONTROL_ONLY");
  assert.deepEqual(protectedRepositoryContractPaths(compiled), [contractPath, controlPath]);

  const rendered = renderRepositoryContractBindings(compiled);
  assert.match(rendered, /TEST_MISSION/u);
  assert.match(rendered, /Which uncertainty must this slice resolve\?/u);
  assert.doesNotMatch(rendered, /secret_control/u);
  assert.doesNotMatch(rendered, /TEST_CONTROL/u);
  assert.doesNotThrow(() => assertRepositoryContractBindingsCurrent({
    repositoryPath: root,
    compiled,
    runValidators: true,
  }));

  const runRoot = path.join(root, ".git", "meta-harness", "runs");
  const sidecars = fs.existsSync(runRoot)
    ? fs.readdirSync(runRoot, { recursive: true }).filter((entry) => String(entry).endsWith("repository-contract-bindings.json"))
    : [];
  assert.deepEqual(sidecars, []);
});

test("repository contract projection reconstructs deterministically from immutable Git", (t) => {
  const { root, head } = fixture(t);
  const first = compileRepositoryContractBindings({ repositoryPath: root, baseCommit: head });
  const second = compileRepositoryContractBindings({ repositoryPath: root, baseCommit: head });
  assert.deepEqual(second, first);
});

test("sealed repository contract compilation ignores live control drift", (t) => {
  const { root, head, contractPath } = fixture(t);
  const compiled = compileRepositoryContractBindings({ repositoryPath: root, baseCommit: head });
  fs.writeFileSync(path.join(root, contractPath), "{\"drift\":true}\n", "utf8");

  const replay = compileRepositoryContractBindings({ repositoryPath: root, baseCommit: head });
  assert.deepEqual(replay, compiled);
  assert.throws(
    () => assertRepositoryContractBindingsCurrent({ repositoryPath: root, compiled, runValidators: false }),
    (error) => error?.code === "MH_REPOSITORY_CONTRACT_DRIFT",
  );
});

test("repository validators are explicit checks, not coding admission", (t) => {
  const { root, head } = fixture(t, { validatorExitCode: 9 });
  const compiled = compileRepositoryContractBindings({ repositoryPath: root, baseCommit: head });
  assert.ok(compiled);
  assert.doesNotThrow(() => assertRepositoryContractBindingsCurrent({
    repositoryPath: root,
    compiled,
    runValidators: false,
  }));
  assert.throws(
    () => assertRepositoryContractBindingsCurrent({ repositoryPath: root, compiled, runValidators: true }),
    (error) => error?.code === "MH_REPOSITORY_CONTRACT_VALIDATOR",
  );
});
