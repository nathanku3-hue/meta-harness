"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const eventStore = require("../lib/events");
const {
  assertCliError,
  run,
  runRaw,
  tempDir,
} = require("./helpers/cli");
const {
  mintReceiptForTarget,
} = require("./helpers/truth-authority");

function writeJson(root, name, value) {
  const filePath = path.join(root, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return filePath;
}

test("hard-linked canonical ledger is rejected without external append", () => {
  const cwd = tempDir("truth-ledger-hardlink-");
  run(cwd, ["init", "Hard-link ledger confinement"]);
  const ledger = path.join(cwd, ".meta-harness", "events.jsonl");
  const outside = path.join(tempDir("truth-ledger-hardlink-outside-"), "events.jsonl");
  fs.mkdirSync(path.dirname(outside), { recursive: true });
  fs.writeFileSync(outside, fs.readFileSync(ledger));
  fs.unlinkSync(ledger);
  fs.linkSync(outside, ledger);
  const before = fs.readFileSync(outside, "utf8");
  assert.equal(fs.lstatSync(ledger).isSymbolicLink(), false);
  assert.equal(fs.statSync(ledger).nlink, 2);
  const receiptPath = writeJson(cwd, "hardlinked-ledger-receipt.json", mintReceiptForTarget(cwd));
  assertCliError(
    runRaw(cwd, ["event", "--canonical", "--authority-receipt-file", receiptPath]),
    "MH_TRUTH_PATH",
    /hard-linked|multiply linked/i,
  );
  assert.equal(fs.readFileSync(outside, "utf8"), before);
  assert.equal(fs.readFileSync(outside, "utf8").includes("hardlinked-ledger-receipt"), false);
});

test("post-validation ledger path replacement cannot redirect the final write", () => {
  const root = tempDir("truth-ledger-swap-");
  const harness = path.join(root, ".meta-harness");
  fs.mkdirSync(path.join(harness, "local", "locks"), { recursive: true });
  const ledger = path.join(harness, "events.jsonl");
  const outside = path.join(tempDir("truth-ledger-swap-outside-"), "events.jsonl");
  const seed = {
    ts: "2026-07-18T00:00:00.000Z",
    time: "2026-07-18T00:00:00.000Z",
    actor: "controller",
    stream: "coding",
    phase: "intake",
    action: "seed",
    result: "seeded",
  };
  fs.writeFileSync(ledger, `${JSON.stringify(seed)}\n`, "utf8");
  fs.mkdirSync(path.dirname(outside), { recursive: true });
  fs.writeFileSync(outside, fs.readFileSync(ledger));
  const before = fs.readFileSync(outside, "utf8");

  // Deterministic check/use probe: after the ledger would have been validated as a regular
  // contained file, replace the pathname with an alias that points outside the repository.
  fs.unlinkSync(ledger);
  fs.linkSync(outside, ledger);
  assert.equal(fs.statSync(ledger).nlink, 2);

  eventStore.appendEvent(ledger, {
    actor: "controller",
    stream: "coding",
    phase: "plan",
    action: "post-check swap probe",
    result: "must stay repository-local",
  }, () => "2026-07-18T00:00:01.000Z");

  assert.equal(fs.readFileSync(outside, "utf8"), before);
  assert.equal(fs.readFileSync(outside, "utf8").includes("post-check swap probe"), false);
  assert.equal(fs.lstatSync(ledger).isSymbolicLink(), false);
  assert.equal(fs.statSync(ledger).nlink, 1);
  const events = eventStore.readEvents(ledger);
  assert.equal(events.length, 2);
  assert.equal(events[1].action, "post-check swap probe");
});
