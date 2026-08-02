"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  createPublicationAssetManifest,
  verifyPublicationAssetFiles,
} = require("../lib/semantic-kernel/publication-intent");
const {
  githubTransportFromEnvironment,
} = require("../lib/semantic-kernel/publication-runtime");

function fixtureRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "portable-publication-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeAsset(root, filename, content = filename) {
  const filePath = path.join(root, filename);
  fs.writeFileSync(filePath, `${content}\n`, "utf8");
  return filePath;
}

function completeAssetInputs(root) {
  return [
    ["black-box-proof", "black-box-proof.json"],
    ["integrated-candidate", "integrated-candidate.json"],
    ["mechanics-assessment", "mechanics-assessment.json"],
    ["owner-pin", "owner-pin.json"],
    ["package-candidate", "package-candidate.json"],
    ["release-candidate", "release-candidate.json"],
    ["reviewer-assessment", "review-custody.json"],
    ["reviewer-assessment", "review-domain.json"],
    ["reviewer-assessment", "review-product.json"],
    ["run-spec", "run-spec.json"],
    ["slice-authorization", "slice-authorization.json"],
    ["tarball", "nkgss-meta-harness-0.4.0.tgz"],
    ["terminal-assessment", "terminal-assessment.json"],
  ].map(([role, filename]) => ({ role, filePath: writeAsset(root, filename) }));
}

test("portable publication assets verify exact regular-file bytes and reject tampering", (t) => {
  const root = fixtureRoot(t);
  const manifest = createPublicationAssetManifest(completeAssetInputs(root));
  const verified = verifyPublicationAssetFiles({
    assetRoot: root,
    publicationIntent: { assets: manifest.assets },
  });
  assert.equal(verified.length, 13);
  assert.equal(verified.every((asset) => path.dirname(asset.filePath) === root), true);

  fs.appendFileSync(path.join(root, "release-candidate.json"), "tamper\n", "utf8");
  assert.throws(
    () => verifyPublicationAssetFiles({
      assetRoot: root,
      publicationIntent: { assets: manifest.assets },
    }),
    (error) => error.code === "PUBLICATION_ASSET_MISMATCH",
  );
});

test("portable publication assets reject links rather than following release substitutions", (t) => {
  const root = fixtureRoot(t);
  const inputs = completeAssetInputs(root);
  const manifest = createPublicationAssetManifest(inputs);
  const target = path.join(root, "release-candidate.json");
  const replacement = path.join(root, "replacement.json");
  fs.renameSync(target, replacement);
  try {
    fs.symlinkSync(replacement, target, "file");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) return;
    throw error;
  }
  assert.throws(
    () => verifyPublicationAssetFiles({
      assetRoot: root,
      publicationIntent: { assets: manifest.assets },
    }),
    (error) => error.code === "PUBLICATION_ASSET_NOT_FILE",
  );
});

test("GitHub release transport is bound to repository, workflow, tag, and exact target SHA", (t) => {
  const root = fixtureRoot(t);
  const eventPath = path.join(root, "event.json");
  fs.writeFileSync(eventPath, JSON.stringify({
    release: {
      id: 123456,
      tag_name: "v0.4.0",
    },
  }), "utf8");
  const publicationIntent = {
    transport: {
      provider: "github-actions",
      repository: "nathanku3-hue/meta-harness",
      workflowFilename: "publish-0.4.yml",
    },
    gitTag: "v0.4.0",
    gitTagTargetRevision: "9".repeat(40),
  };
  const env = {
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "nathanku3-hue/meta-harness",
    GITHUB_WORKFLOW_REF: "nathanku3-hue/meta-harness/.github/workflows/publish-0.4.yml@refs/heads/main",
    GITHUB_RUN_ID: "98765",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_EVENT_NAME: "release",
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_SHA: "9".repeat(40),
  };
  const transport = githubTransportFromEnvironment(publicationIntent, env);
  assert.equal(transport.releaseId, 123456);
  assert.equal(transport.githubSha, publicationIntent.gitTagTargetRevision);

  assert.throws(
    () => githubTransportFromEnvironment(publicationIntent, {
      ...env,
      GITHUB_REPOSITORY: "attacker/fork",
    }),
    (error) => error.code === "PUBLICATION_GITHUB_BINDING",
  );
  assert.throws(
    () => githubTransportFromEnvironment(publicationIntent, {
      ...env,
      GITHUB_WORKFLOW_REF: "nathanku3-hue/meta-harness/.github/workflows/other.yml@refs/heads/main",
    }),
    (error) => error.code === "PUBLICATION_GITHUB_WORKFLOW",
  );
});
