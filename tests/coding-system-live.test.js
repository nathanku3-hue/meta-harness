"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { sealWorkSession } = require("../lib/work-session");
const { CLI } = require("./helpers/cli");

const enabled = /^(?:1|true)$/i.test(String(process.env.META_HARNESS_LIVE_WORK || ""));

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return String(result.stdout || "").trim();
}

test("live coding system carries one result through Codex and exact validation", {
  skip: !enabled,
  timeout: 280_000,
}, (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-live-work-"));
  const root = path.join(parent, "repository");
  fs.mkdirSync(root);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));

  git(root, ["init"]);
  git(root, ["config", "user.name", "Meta Harness Live Work"]);
  git(root, ["config", "user.email", "live-work@example.invalid"]);
  fs.mkdirSync(path.join(root, "tests"));
  fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(root, "tests", "sum.test.js"), [
    '"use strict";',
    'const assert = require("node:assert/strict");',
    'const test = require("node:test");',
    'const { sum } = require("../src/sum");',
    'test("sum adds two numbers", () => assert.equal(sum(2, 3), 5));',
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(root, "README.md"), "Implement the smallest code required by the existing test.\n", "utf8");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "failing product fixture"]);
  const head = git(root, ["rev-parse", "HEAD"]);

  const session = sealWorkSession({
    schemaVersion: "work-session/v1",
    intent: { version: "live-proof/v1", digest: "sha256:" + "3".repeat(64) },
    productResult: "Make the existing sum test pass.",
    journeyState: "The repository has one failing test because src/sum.js is absent.",
    doNow: "Implement the smallest CommonJS src/sum.js exporting sum(a, b).",
    newlyTrueBehavior: "Calling sum(2, 3) returns 5 through the exported production function.",
    doneWhen: "node --test tests/sum.test.js exits zero.",
    stopOnlyIf: ["The result cannot be implemented inside src."],
    authorizedReversibleActions: ["Read the repository.", "Create or edit files inside src.", "Run the existing focused test."],
    ownerOnlyActions: ["Change the requested behavior.", "Commit or publish the result."],
    allowedPaths: ["src"],
    dirtyPolicy: "continue-in-scope",
    validation: [{
      argv: [process.execPath, "--test", "tests/sum.test.js"],
      cwd: ".",
      timeoutSeconds: 60,
    }],
    maxAttempts: 2,
  });
  const sessionPath = path.join(parent, "work-session.json");
  fs.writeFileSync(sessionPath, `${JSON.stringify(session, null, 2)}\n`, "utf8");

  const result = spawnSync(process.execPath, [
    CLI,
    "work", root,
    "--session", sessionPath,
    "--timeout", "240",
    "--json",
  ], {
    cwd: root,
    env: { ...process.env },
    encoding: "utf8",
    windowsHide: true,
    timeout: 270_000,
    maxBuffer: 16 * 1024 * 1024,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.outcome, "DONE");
  assert.equal(parsed.productResult, "Make the existing sum test pass.");
  assert.equal(parsed.validation.length, 1);
  assert.equal(parsed.validation[0].passed, true);
  assert.equal(git(root, ["rev-parse", "HEAD"]), head);
  assert.equal(git(root, ["diff", "--cached", "--name-only"]), "");
  assert.deepEqual(parsed.changedPaths, ["src/sum.js"]);
  assert.match(fs.readFileSync(path.join(root, "src", "sum.js"), "utf8"), /function|=>|exports/);
});
