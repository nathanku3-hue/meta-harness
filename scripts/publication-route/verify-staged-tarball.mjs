#!/usr/bin/env node
/**
 * Publication-route verifier for the pre-built 0.4.0 tarball.
 * - Never runs npm pack
 * - Never runs npm publish
 * - Fail-closed on any identity mismatch
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const identityPath = join(repoRoot, "publication-route", "identity.json");

function die(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function shaHex(algo, buf) {
  return createHash(algo).update(buf).digest("hex");
}

function sha512Integrity(buf) {
  return `sha512-${createHash("sha512").update(buf).digest("base64")}`;
}

function git(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

const identity = JSON.parse(readFileSync(identityPath, "utf8"));
const tarballPath = join(repoRoot, identity.canonicalTarballRelativePath);

if (!existsSync(tarballPath)) {
  die(`staged tarball missing: ${identity.canonicalTarballRelativePath}`);
}

const st = statSync(tarballPath);
const buf = readFileSync(tarballPath);
const actual = {
  bytes: st.size,
  sha256: shaHex("sha256", buf),
  sha1: shaHex("sha1", buf),
  integrity: sha512Integrity(buf),
};

const checks = [
  ["tarballBytes", identity.tarballBytes, actual.bytes],
  ["tarballSha256", identity.tarballSha256, actual.sha256],
  ["tarballSha1", identity.tarballSha1, actual.sha1],
  ["tarballIntegrity", identity.tarballIntegrity, actual.integrity],
];

for (const [name, expected, got] of checks) {
  if (String(expected) !== String(got)) {
    die(`${name} mismatch expected=${expected} actual=${got}`);
  }
}

// Source pin: release commit must be an ancestor of HEAD; its tree must match.
const sourceCommit = identity.sourceCommit;
const sourceTree = identity.sourceTree;
let ancestorOk = false;
try {
  execFileSync("git", ["merge-base", "--is-ancestor", sourceCommit, "HEAD"], {
    cwd: repoRoot,
  });
  ancestorOk = true;
} catch {
  ancestorOk = false;
}
if (!ancestorOk) {
  die(`source commit ${sourceCommit} is not an ancestor of HEAD`);
}

const actualSourceTree = git(["rev-parse", `${sourceCommit}^{tree}`]);
if (actualSourceTree !== sourceTree) {
  die(
    `source tree mismatch expected=${sourceTree} actual=${actualSourceTree}`,
  );
}

// Pin digests present (fail-closed constants; not recomputed here)
for (const key of [
  "packageCandidateDigest",
  "releaseCandidateDigest",
  "npmPackInvocationCount",
  "publicationNpmPackInvocationCount",
]) {
  if (identity[key] === undefined || identity[key] === null) {
    die(`identity missing ${key}`);
  }
}
if (identity.npmPackInvocationCount !== 1) {
  die("npmPackInvocationCount must be 1");
}
if (identity.publicationNpmPackInvocationCount !== 0) {
  die("publicationNpmPackInvocationCount must be 0");
}

// Guard: no accidental pack scripts in this verifier process
if (process.env.FORCE_NPM_PACK === "1") {
  die("FORCE_NPM_PACK is set; refusing");
}

const out = {
  ok: true,
  schema: "meta-harness/publication-route-verify/v1",
  head: git(["rev-parse", "HEAD"]),
  headTree: git(["rev-parse", "HEAD^{tree}"]),
  sourceCommit,
  sourceTree: actualSourceTree,
  tarballPath: identity.canonicalTarballRelativePath,
  actual,
  packageCandidateDigest: identity.packageCandidateDigest,
  releaseCandidateDigest: identity.releaseCandidateDigest,
  npmPackInvocationCount: identity.npmPackInvocationCount,
  publicationNpmPackInvocationCount:
    identity.publicationNpmPackInvocationCount,
  npmPackExecuted: false,
  npmPublishExecuted: false,
};

console.log(JSON.stringify(out, null, 2));
console.log("PASS: staged tarball and source identity verified");
