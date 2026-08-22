"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { sealWorkSession } = require("../lib/work-session");
const { compileProductProofSpec } = require("../lib/work-proof-compiler");
const { compileSemanticAuthority, endgameProjection, semanticProjection } = require("../lib/semantic-authority");
const { CLI, ROOT } = require("./helpers/cli");

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
  const tempBase = process.env.WSL_DISTRO_NAME ? path.dirname(ROOT) : os.tmpdir();
  const parent = fs.mkdtempSync(path.join(tempBase, "meta-harness-live-work-"));
  const root = path.join(parent, "repository");
  const origin = path.join(parent, "origin.git");
  fs.mkdirSync(root);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));

  git(parent, ["init", "--bare", origin]);
  git(root, ["init"]);
  git(root, ["config", "user.name", "Meta Harness Live Work"]);
  git(root, ["config", "user.email", "live-work@example.invalid"]);
  fs.mkdirSync(path.join(root, "tests"));
  fs.writeFileSync(path.join(root, ".gitignore"), ".worktrees/\n", "utf8");
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
  const { writeProductMd } = require("./helpers/product-direction");
  const productDirection = writeProductMd(root);
  fs.mkdirSync(path.join(root, ".meta-harness"));
  fs.writeFileSync(path.join(root, ".meta-harness", "product-proof.js"), [
    '"use strict";',
    'const path = require("node:path");',
    'if (process.env.META_HARNESS_PROOF_CLAIM_ID !== "sum-behavior") process.exit(30);',
    'const candidate = process.env.META_HARNESS_CANDIDATE_ROOT;',
    'const target = path.join(candidate, "src", "sum.js");',
    'try {',
    '  const { sum } = require(target);',
    '  if (sum(2, 3) !== 5) process.exit(31);',
    '} catch { process.exit(32); }',
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(root, ".meta-harness", "product-proof.json"), `${JSON.stringify({
    schemaVersion: "product-proof-policy/v2",
    programPath: ".meta-harness/product-proof.js",
    runtime: process.execPath,
    timeoutSeconds: 60,
    claims: [{
      id: "sum-behavior",
      statement: "The exported production sum function returns 5 for sum(2, 3).",
      baselineExpectation: "FAIL",
      covers: ["productResult", "newlyTrueBehavior", "doneWhen"],
    }],
  }, null, 2)}\n`, "utf8");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "failing product fixture"]);
  git(root, ["remote", "add", "origin", origin]);
  git(root, ["push", "-u", "origin", "HEAD"]);
  const head = git(root, ["rev-parse", "HEAD"]);
  const branch = git(root, ["branch", "--show-current"]);

  const base = { type: "EXACT_COMMIT", commit: head };
  const productResult = "Make the existing sum test pass.";
  const newlyTrueBehavior = "Calling sum(2, 3) returns 5 through the exported production function.";
  const doneWhen = "node --test tests/sum.test.js exits zero.";
  const productProofSpec = compileProductProofSpec({
    repositoryPath: root,
    productDirection,
    base,
    productResult,
    newlyTrueBehavior,
    doneWhen,
    allowModel: false,
  });
  const semanticAuthority = compileSemanticAuthority({ productDirection });
  const session = sealWorkSession({
    schemaVersion: "work-session/v8",
    productDirection,
    semanticState: semanticAuthority.semanticState,
    semanticProjection: semanticProjection(semanticAuthority),
    endgameProjection: endgameProjection(semanticAuthority),
    origin: { type: "OWNER_GOAL" },
    base,
    productResult,
    journeyState: "The repository has one failing test because src/sum.js is absent.",
    doNow: "Implement the smallest CommonJS src/sum.js exporting sum(a, b).",
    newlyTrueBehavior,
    doneWhen,
    productProofSpec,
    stopOnlyIf: ["The result cannot be implemented inside src."],
    authorizedReversibleActions: ["Read the repository.", "Create or edit files inside src.", "Run the existing focused test."],
    ownerOnlyActions: ["Change the requested behavior.", "Expand delivery beyond the current branch and origin."],
    allowedPaths: ["src"],
    validation: [{
      argv: [process.execPath, "--test", "tests/sum.test.js"],
      cwd: ".",
      timeoutSeconds: 60,
    }],
    maxAttempts: 2,
    delivery: { commit: true, push: true },
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
  assert.equal(parsed.delivery.commit.status, "committed");
  assert.equal(parsed.delivery.push.status, "remote_equal");
  assert.notEqual(parsed.delivery.commit.sha, head);
  assert.equal(parsed.productProof.state, "PROVEN");
  assert.equal(git(root, ["branch", "--show-current"]), branch);
  assert.equal(git(root, ["rev-parse", "HEAD"]), head);
  assert.equal(git(parsed.workspace.path, ["rev-parse", "HEAD"]), parsed.delivery.commit.sha);
  assert.equal(
    git(root, ["ls-remote", "--heads", "origin", `refs/heads/${parsed.workspace.branch}`]).split(/\s+/)[0],
    parsed.delivery.commit.sha,
  );
  assert.equal(git(root, ["diff", "--cached", "--name-only"]), "");
  assert.deepEqual(parsed.changedPaths, ["src/sum.js"]);
  assert.equal(fs.existsSync(path.join(root, "src", "sum.js")), false);
  assert.match(fs.readFileSync(path.join(parsed.workspace.path, "src", "sum.js"), "utf8"), /function|=>|exports/);
});
