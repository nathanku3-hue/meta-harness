"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { scanDecisionInbox } = require("../lib/decision-inbox-check");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-decision-inbox-"));
}

function writeFile(root, relativePath, content) {
  const filePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

function decision(overrides = {}) {
  return {
    id: "D-001",
    kind: "user_decision",
    question: "Approve bounded scope?",
    recommended: "hold",
    state_hash: "state-1",
    assumption_hash: "assumption-1",
    reask_when: "source state changes",
    status: "open",
    evidence: [".meta-harness/dirty-work.json"],
    ...overrides,
  };
}

function writeInbox(root, body) {
  const inbox = Array.isArray(body) ? { v: 1, decisions: body } : body;
  return writeFile(root, ".meta-harness/decision-inbox.json", `${JSON.stringify(inbox, null, 2)}\n`);
}

function snapshotTree(root) {
  if (!fs.existsSync(root)) {
    return [];
  }
  const items = [];
  function walk(directoryPath) {
    for (const name of fs.readdirSync(directoryPath).sort((left, right) => left.localeCompare(right))) {
      const itemPath = path.join(directoryPath, name);
      const relative = path.relative(root, itemPath).split(path.sep).join("/");
      const stat = fs.lstatSync(itemPath);
      if (stat.isDirectory()) {
        items.push({ path: relative, type: "dir" });
        walk(itemPath);
      } else if (stat.isFile()) {
        items.push({ path: relative, type: "file", content: fs.readFileSync(itemPath).toString("base64") });
      } else if (stat.isSymbolicLink()) {
        items.push({ path: relative, type: "symlink", link: fs.readlinkSync(itemPath) });
      }
    }
  }
  walk(root);
  return items;
}

function rejectedDetails(result) {
  return result.items
    .filter((item) => item.status !== "PASS")
    .map((item) => `${item.path}\t${item.detail}`);
}

test("decision inbox scan passes when no inbox exists", () => {
  const targetRoot = tempDir();

  const result = scanDecisionInbox({ targetRoot });

  assert.deepEqual(result, { status: "PASS", checked: 0, items: [] });
});

test("decision inbox scan scans only the direct decision-inbox surface", () => {
  const targetRoot = tempDir();
  writeFile(targetRoot, ".meta-harness/decision-inbox-copy.json", "{not-json");
  writeFile(targetRoot, ".meta-harness/nested/decision-inbox.json", "{not-json");

  const result = scanDecisionInbox({ targetRoot });

  assert.deepEqual(result, { status: "PASS", checked: 0, items: [] });
});

test("decision inbox scan passes with target-form decision inbox", () => {
  const targetRoot = tempDir();
  writeInbox(targetRoot, [decision()]);

  const result = scanDecisionInbox({ targetRoot });

  assert.equal(result.status, "PASS");
  assert.equal(result.checked, 1);
  assert.deepEqual(result.items, [{ status: "PASS", path: ".meta-harness/decision-inbox.json" }]);
});

test("decision inbox scan passes with an empty decisions array", () => {
  const targetRoot = tempDir();
  writeInbox(targetRoot, []);

  const result = scanDecisionInbox({ targetRoot });

  assert.equal(result.status, "PASS");
  assert.equal(result.checked, 1);
});

test("decision inbox scan allows current statuses", () => {
  for (const status of ["open", "approved", "rejected", "deferred"]) {
    const targetRoot = tempDir();
    writeInbox(targetRoot, [decision({ status })]);

    const result = scanDecisionInbox({ targetRoot });

    assert.equal(result.status, "PASS", status);
  }
});

test("decision inbox scan allows current recommended values", () => {
  for (const recommended of ["approve", "reject", "defer", "hold"]) {
    const targetRoot = tempDir();
    writeInbox(targetRoot, [decision({ recommended })]);

    const result = scanDecisionInbox({ targetRoot });

    assert.equal(result.status, "PASS", recommended);
  }
});

test("decision inbox scan does not require a literal question mark", () => {
  const targetRoot = tempDir();
  writeInbox(targetRoot, [decision({ question: "Approve bounded scope" })]);

  const result = scanDecisionInbox({ targetRoot });

  assert.equal(result.status, "PASS");
});

test("decision inbox scan trims required string fields before validation", () => {
  const targetRoot = tempDir();
  writeInbox(targetRoot, [decision({
    id: " D-001 ",
    kind: " user_decision ",
    question: " Approve bounded scope? ",
    recommended: " hold ",
    state_hash: " state-1 ",
    reask_when: " source state changes ",
    status: " open ",
  })]);

  const result = scanDecisionInbox({ targetRoot });

  assert.equal(result.status, "PASS");
});

test("decision inbox scan allows extra current-contract fields", () => {
  const targetRoot = tempDir();
  writeInbox(targetRoot, [decision({
    identity_hash: "identity-hash",
    identity_key: "identity-key",
    assumptions: ["scope unchanged"],
    resolution: "approved",
    resolved_at: "2026-06-05T00:00:00.000Z",
    created_at: "2026-06-05T00:00:00.000Z",
    updated_at: "2026-06-05T00:00:00.000Z",
  })]);

  const result = scanDecisionInbox({ targetRoot });

  assert.equal(result.status, "PASS");
});

test("decision inbox scan fails malformed JSON without throwing", () => {
  const targetRoot = tempDir();
  writeFile(targetRoot, ".meta-harness/decision-inbox.json", "{not-json");

  const result = scanDecisionInbox({ targetRoot });

  assert.equal(result.status, "FAIL");
  assert.equal(result.checked, 1);
  assert.deepEqual(result.items.map((entry) => entry.status), ["MALFORMED"]);
  assert.match(rejectedDetails(result).join("\n"), /malformed JSON/);
});

test("decision inbox scan rejects malformed root shapes", () => {
  const targetRoot = tempDir();
  writeInbox(targetRoot, { v: 1 });

  const result = scanDecisionInbox({ targetRoot });

  assert.equal(result.status, "FAIL");
  assert.equal(result.items[0].status, "MALFORMED");
  assert.match(rejectedDetails(result).join("\n"), /decisions array/);
});

test("decision inbox scan rejects non-object decision entries", () => {
  const targetRoot = tempDir();
  writeInbox(targetRoot, { v: 1, decisions: ["bad"] });

  const result = scanDecisionInbox({ targetRoot });

  assert.equal(result.status, "FAIL");
  assert.deepEqual(result.items, [{
    status: "MALFORMED",
    path: ".meta-harness/decision-inbox.json#decisions[0]",
    detail: "decision must be a JSON object",
  }]);
});

test("decision inbox scan is read-only by before and after tree snapshot", () => {
  const targetRoot = tempDir();
  writeFile(targetRoot, ".meta-harness/decision-inbox.json", "{not-json");
  const before = snapshotTree(targetRoot);

  const result = scanDecisionInbox({ targetRoot });
  const after = snapshotTree(targetRoot);

  assert.equal(result.status, "FAIL");
  assert.deepEqual(after, before);
});

test("decision inbox scan rejects missing required decision fields", () => {
  for (const field of ["id", "kind", "question", "recommended", "state_hash", "assumption_hash", "reask_when", "status"]) {
    const targetRoot = tempDir();
    const item = decision();
    delete item[field];
    writeInbox(targetRoot, [item]);

    const result = scanDecisionInbox({ targetRoot });

    assert.equal(result.status, "FAIL", field);
    assert.match(rejectedDetails(result).join("\n"), new RegExp(`missing required field: ${field}`));
  }
});

test("decision inbox scan rejects blank-after-trim required decision fields", () => {
  for (const field of ["id", "kind", "question", "recommended", "state_hash", "assumption_hash", "reask_when", "status"]) {
    const targetRoot = tempDir();
    writeInbox(targetRoot, [decision({ [field]: "   " })]);

    const result = scanDecisionInbox({ targetRoot });

    assert.equal(result.status, "FAIL", field);
    assert.match(rejectedDetails(result).join("\n"), new RegExp(`missing required field: ${field}`));
  }
});

test("decision inbox scan rejects invalid kind values", () => {
  for (const kind of ["blocker", "expert_decision", "approval_gate"]) {
    const targetRoot = tempDir();
    writeInbox(targetRoot, [decision({ kind })]);

    const result = scanDecisionInbox({ targetRoot });

    assert.equal(result.status, "FAIL", kind);
    assert.match(rejectedDetails(result).join("\n"), new RegExp(`invalid kind: ${kind}`));
  }
});

test("decision inbox scan rejects invalid status values", () => {
  for (const status of ["resolved", "blocked", "maybe"]) {
    const targetRoot = tempDir();
    writeInbox(targetRoot, [decision({ status })]);

    const result = scanDecisionInbox({ targetRoot });

    assert.equal(result.status, "FAIL", status);
    assert.match(rejectedDetails(result).join("\n"), new RegExp(`invalid status: ${status}`));
  }
});

test("decision inbox scan rejects invalid recommended values", () => {
  const targetRoot = tempDir();
  writeInbox(targetRoot, [decision({ recommended: "escalate" })]);

  const result = scanDecisionInbox({ targetRoot });

  assert.equal(result.status, "FAIL");
  assert.match(rejectedDetails(result).join("\n"), /invalid recommended: escalate/);
});

test("decision inbox scan rejects duplicate decision ids using trimmed values", () => {
  const targetRoot = tempDir();
  writeInbox(targetRoot, [
    decision({ id: " D-dup ", state_hash: "state-1" }),
    decision({ id: "D-dup", state_hash: "state-2" }),
  ]);

  const result = scanDecisionInbox({ targetRoot });

  assert.equal(result.status, "FAIL");
  assert.match(rejectedDetails(result).join("\n"), /duplicate id: D-dup/);
});

test("decision inbox scan allows multiple decisions for the same state hash", () => {
  const targetRoot = tempDir();
  writeInbox(targetRoot, [
    decision({ id: "D-001", state_hash: " state-dup ", assumption_hash: "assumption-1" }),
    decision({ id: "D-002", state_hash: "state-dup", assumption_hash: "assumption-2" }),
  ]);

  const result = scanDecisionInbox({ targetRoot });

  assert.equal(result.status, "PASS");
});

test("decision inbox scan rejects duplicate identity hashes when present", () => {
  const targetRoot = tempDir();
  writeInbox(targetRoot, [
    decision({ id: "D-001", state_hash: "state-1", identity_hash: " identity-dup " }),
    decision({ id: "D-002", state_hash: "state-2", assumption_hash: "assumption-2", identity_hash: "identity-dup" }),
  ]);

  const result = scanDecisionInbox({ targetRoot });

  assert.equal(result.status, "FAIL");
  assert.match(rejectedDetails(result).join("\n"), /duplicate identity_hash: identity-dup/);
});

test("decision inbox scan rejects broad multi-question text", () => {
  for (const question of [
    "Approve scope?\nApprove provider access?",
    "Approve scope; approve provider access",
    "Approve scope? Approve provider access?",
  ]) {
    const targetRoot = tempDir();
    writeInbox(targetRoot, [decision({ question })]);

    const result = scanDecisionInbox({ targetRoot });

    assert.equal(result.status, "FAIL", question);
    assert.match(rejectedDetails(result).join("\n"), /one explicit question/);
  }
});

test("decision inbox scan allows omitted evidence", () => {
  const targetRoot = tempDir();
  const item = decision();
  delete item.evidence;
  writeInbox(targetRoot, [item]);

  const result = scanDecisionInbox({ targetRoot });

  assert.equal(result.status, "PASS");
});

test("decision inbox scan rejects non-array evidence and blank evidence items", () => {
  const targetRoot = tempDir();
  writeInbox(targetRoot, [
    decision({ id: "D-001", evidence: ".meta-harness/dirty-work.json" }),
    decision({ id: "D-002", state_hash: "state-2", evidence: [""] }),
  ]);

  const result = scanDecisionInbox({ targetRoot });

  assert.equal(result.status, "FAIL");
  assert.match(rejectedDetails(result).join("\n"), /evidence must be an array/);
  assert.match(rejectedDetails(result).join("\n"), /evidence item must be a non-empty string/);
});

test("decision inbox scan rejects decision-inbox when it is a directory", () => {
  const targetRoot = tempDir();
  fs.mkdirSync(path.join(targetRoot, ".meta-harness", "decision-inbox.json"), { recursive: true });

  const result = scanDecisionInbox({ targetRoot });

  assert.equal(result.status, "FAIL");
  assert.equal(result.checked, 1);
  assert.deepEqual(result.items, [{
    status: "REJECTED",
    path: ".meta-harness/decision-inbox.json",
    detail: "decision inbox surface is not a regular file",
  }]);
});

test("decision inbox scan rejects .meta-harness when it is not a directory", () => {
  const targetRoot = tempDir();
  writeFile(targetRoot, ".meta-harness", "not a directory\n");

  const result = scanDecisionInbox({ targetRoot });

  assert.equal(result.status, "FAIL");
  assert.deepEqual(result.items, [{
    status: "REJECTED",
    path: ".meta-harness",
    detail: "decision inbox root is not a real directory",
  }]);
});

test("decision inbox scan rejects symlink surfaces when supported", (t) => {
  const targetRoot = tempDir();
  const outside = tempDir();
  writeFile(outside, "decision-inbox.json", JSON.stringify({ decisions: [] }));
  fs.mkdirSync(path.join(targetRoot, ".meta-harness"), { recursive: true });

  try {
    fs.symlinkSync(path.join(outside, "decision-inbox.json"), path.join(targetRoot, ".meta-harness", "decision-inbox.json"));
  } catch (error) {
    t.skip(`symlink creation unavailable: ${error.code || error.message}`);
    return;
  }

  const result = scanDecisionInbox({ targetRoot });

  assert.equal(result.status, "FAIL");
  assert.deepEqual(result.items, [{
    status: "REJECTED",
    path: ".meta-harness/decision-inbox.json",
    detail: "decision inbox surface is not a regular file",
  }]);
});
