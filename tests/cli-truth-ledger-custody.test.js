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

function seedLedger(root) {
  const harness = path.join(root, ".meta-harness");
  fs.mkdirSync(path.join(harness, "local", "locks"), { recursive: true });
  const ledger = path.join(harness, "events.jsonl");
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
  return ledger;
}

function listBackupResidue(directory) {
  return fs.readdirSync(directory).filter((name) => name.startsWith(".bak.events."));
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

test("forced ledger rename failure preserves the canonical path with no backup residue", () => {
  const root = tempDir("truth-ledger-rename-fail-");
  const ledger = seedLedger(root);
  const directory = path.dirname(ledger);
  const before = fs.readFileSync(ledger);
  const originalRename = fs.renameSync;
  let forced = false;

  fs.renameSync = (from, to) => {
    if (path.resolve(to) === path.resolve(ledger) && path.basename(from).startsWith(".tmp.events.")) {
      forced = true;
      const error = new Error("EIO: forced install failure");
      error.code = "EIO";
      throw error;
    }
    return originalRename.call(fs, from, to);
  };

  try {
    assert.throws(
      () => eventStore.appendEvent(ledger, {
        actor: "controller",
        stream: "coding",
        phase: "plan",
        action: "forced rename failure",
        result: "must not displace prior ledger",
      }, () => "2026-07-18T00:00:01.000Z"),
      /forced install failure|EIO/,
    );
  } finally {
    fs.renameSync = originalRename;
  }

  assert.equal(forced, true);
  assert.equal(fs.existsSync(ledger), true);
  assert.deepEqual(fs.readFileSync(ledger), before);
  assert.deepEqual(listBackupResidue(directory), []);
  assert.deepEqual(
    fs.readdirSync(directory).filter((name) => name.startsWith(".tmp.events.")),
    [],
  );
});

test("rename-boundary ledger path replacement cannot redirect the final write", () => {
  const root = tempDir("truth-ledger-rename-boundary-");
  const ledger = seedLedger(root);
  const outside = path.join(tempDir("truth-ledger-rename-boundary-outside-"), "events.jsonl");
  fs.mkdirSync(path.dirname(outside), { recursive: true });
  fs.writeFileSync(outside, fs.readFileSync(ledger));
  const before = fs.readFileSync(outside, "utf8");
  const originalRename = fs.renameSync;
  let swapped = false;

  fs.renameSync = (from, to) => {
    if (path.resolve(to) === path.resolve(ledger) && path.basename(from).startsWith(".tmp.events.")) {
      // Actual check/use boundary: swap the destination after validation and immediately
      // before the install rename so only directory-entry replacement is exercised.
      fs.unlinkSync(ledger);
      fs.linkSync(outside, ledger);
      swapped = true;
      assert.equal(fs.statSync(ledger).nlink, 2);
    }
    return originalRename.call(fs, from, to);
  };

  try {
    eventStore.appendEvent(ledger, {
      actor: "controller",
      stream: "coding",
      phase: "plan",
      action: "rename-boundary swap probe",
      result: "must stay repository-local",
    }, () => "2026-07-18T00:00:01.000Z");
  } finally {
    fs.renameSync = originalRename;
  }

  assert.equal(swapped, true);
  assert.equal(fs.readFileSync(outside, "utf8"), before);
  assert.equal(fs.readFileSync(outside, "utf8").includes("rename-boundary swap probe"), false);
  assert.equal(fs.lstatSync(ledger).isSymbolicLink(), false);
  assert.equal(fs.statSync(ledger).nlink, 1);
  const events = eventStore.readEvents(ledger);
  assert.equal(events.length, 2);
  assert.equal(events[1].action, "rename-boundary swap probe");
  assert.deepEqual(listBackupResidue(path.dirname(ledger)), []);
});
