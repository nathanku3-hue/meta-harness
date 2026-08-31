"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const { automaticRequest } = require("../lib/commands/work");
const {
  captureExpertResourceLinks,
  expertSourceRefName,
  reopenExpertSource,
  snapshotResourceLink,
} = require("../lib/expert-source-ingress");
const { readOwnerObjectiveState } = require("../lib/owner-objective-state");
const {
  persistSourceBearingOwnerIngress,
  readSourceBearingOwnerIngress,
} = require("../lib/source-bearing-owner-ingress");
const { git, repository } = require("./helpers/linear-product-head");

function externalFile(root, name, content) {
  const filePath = path.join(path.dirname(root), name);
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

function link(name, filePath) {
  return { type: "resource_link", name, uri: pathToFileURL(filePath).href };
}

test("source-bearing ingress digest is deterministic and excludes receipt time", (t) => {
  const { root } = repository(t);
  const filePath = externalFile(root, "deterministic-source.txt", "bounded expert evidence\n");
  const [source] = captureExpertResourceLinks(root, [link("evidence.txt", filePath)]);
  const rawText = "  Apply this evidence exactly.\r\n";

  const first = persistSourceBearingOwnerIngress(root, rawText, [source], {
    now: new Date("2026-08-30T18:00:00.000Z"),
  });
  const replay = persistSourceBearingOwnerIngress(root, rawText, [source], {
    now: new Date("2026-08-30T19:00:00.000Z"),
  });
  const changed = persistSourceBearingOwnerIngress(root, `${rawText} `, [source], {
    now: new Date("2026-08-30T20:00:00.000Z"),
  });

  assert.deepEqual(replay, first);
  assert.equal(replay.receivedAt, "2026-08-30T18:00:00.000Z");
  assert.notEqual(changed.ingressDigest, first.ingressDigest);
  assert.equal(readSourceBearingOwnerIngress(root, first.ingressDigest).rawText, rawText);
});

test("objective adoption preserves raw ingress identity and exact replay does not increment revision", (t) => {
  const { root } = repository(t);
  const filePath = externalFile(root, "objective-source.txt", "Use interval overlap as indeterminate.\n");
  const [source] = captureExpertResourceLinks(root, [link("procedure.txt", filePath)]);
  const rawText = "  Apply the attached procedure.  ";
  const ingress = persistSourceBearingOwnerIngress(root, rawText, [source]);

  assert.deepEqual(automaticRequest(root, rawText, { ownerIngressDigest: ingress.ingressDigest }), { type: "REPO_WAVE" });
  const first = readOwnerObjectiveState(root);
  assert.equal(first.schemaVersion, "owner-objective-state/v2");
  assert.equal(first.content, "Apply the attached procedure.");
  assert.equal(first.ingressDigest, ingress.ingressDigest);
  assert.equal(first.revision, 1);

  assert.deepEqual(automaticRequest(root, rawText, { ownerIngressDigest: ingress.ingressDigest }), { type: "REPO_WAVE" });
  assert.equal(readOwnerObjectiveState(root).revision, 1);

  const secondRawText = "Apply the attached procedure.";
  const secondIngress = persistSourceBearingOwnerIngress(root, secondRawText, [source]);
  assert.notEqual(secondIngress.ingressDigest, ingress.ingressDigest);
  assert.deepEqual(automaticRequest(root, secondRawText, { ownerIngressDigest: secondIngress.ingressDigest }), { type: "REPO_WAVE" });
  assert.equal(readOwnerObjectiveState(root).revision, 2);
});

test("deleted GC ref is repaired from authoritative blob while missing blob fails closed", (t) => {
  const { root } = repository(t);
  const filePath = externalFile(root, "gc-source.txt", "GC reachability evidence with unique bytes 7f46.\n");
  const [source] = captureExpertResourceLinks(root, [link("gc-source.txt", filePath)]);
  const ingress = persistSourceBearingOwnerIngress(root, "Use the source.", [source]);
  const retained = readSourceBearingOwnerIngress(root, ingress.ingressDigest).sources[0];
  const refName = expertSourceRefName(retained.contentDigest);

  git(root, ["update-ref", "-d", refName]);
  assert.equal(git(root, ["for-each-ref", "--format=%(refname)", refName]), "");
  const reopened = reopenExpertSource(root, retained);
  assert.equal(reopened.blobOid, retained.blobOid);
  assert.equal(git(root, ["rev-parse", refName]), retained.blobOid);

  git(root, ["update-ref", "-d", refName]);
  const objectsPathValue = git(root, ["rev-parse", "--git-path", "objects"]);
  const objectsPath = path.isAbsolute(objectsPathValue) ? objectsPathValue : path.resolve(root, objectsPathValue);
  const looseObjectPath = path.join(objectsPath, retained.blobOid.slice(0, 2), retained.blobOid.slice(2));
  assert.equal(fs.existsSync(looseObjectPath), true);
  fs.unlinkSync(looseObjectPath);

  assert.throws(
    () => reopenExpertSource(root, retained),
    (error) => error.code === "MH_EXPERT_SOURCE_BLOB_MISSING",
  );
});

test("snapshot fails closed when target is replaced between path validation and opening", (t) => {
  const { root } = repository(t);
  const target = externalFile(root, "race-source.txt", "original expert bytes\n");
  const replacement = externalFile(root, "race-replacement.txt", "replacement expert bytes\n");
  const originalOpenSync = fs.openSync;
  let swapped = false;
  fs.openSync = function patchedOpenSync(filePath, ...args) {
    if (!swapped && path.resolve(String(filePath)) === path.resolve(target)) {
      swapped = true;
      fs.unlinkSync(target);
      fs.renameSync(replacement, target);
    }
    return originalOpenSync.call(fs, filePath, ...args);
  };
  try {
    assert.throws(
      () => snapshotResourceLink(link("race.txt", target)),
      (error) => error.code === "MH_EXPERT_SOURCE_CHANGED",
    );
  } finally {
    fs.openSync = originalOpenSync;
  }
});
