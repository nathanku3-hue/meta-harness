"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { runRaw, tempDir } = require("./helpers/cli");

function writeJson(root, relativePath, value) {
  const filePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

test("domain-governance check emits JSON result", () => {
  const root = tempDir("cli-domain-governance-");

  const result = runRaw(root, ["domain-governance", "check", "--target", root, "--json"]);
  const data = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.equal(data.schema_version, "1");
  assert.equal(data.ok, false);
  assert.equal(data.target, root.split(path.sep).join("/"));
  assert.equal(data.activation_decision_id, null);
  assert.equal(data.pilot_chain_id, null);
  assert.equal(Array.isArray(data.checks), true);
  assert.equal(typeof data.counts.fail, "number");
});

test("domain-governance check rejects unknown actions", () => {
  const root = tempDir("cli-domain-governance-");
  writeJson(root, ".meta-harness/domain-governance/activation.json", {});

  const result = runRaw(root, ["domain-governance", "scan", "--target", root]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown domain-governance action: scan/);
});
