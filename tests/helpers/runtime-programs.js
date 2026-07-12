"use strict";

/** D070 test program identity and host-environment helpers. */

const path = require("node:path");

const { sha256File } = require("../../internal/d069/local-controller");
const { AO_ENV_ALLOWLIST } = require("../../internal/d069/ao-constants");
const { absNorm } = require("../../internal/d069/support");

function snapshotHostEnv() {
  const env = {};
  for (const key of AO_ENV_ALLOWLIST) {
    if (key === "CODEX_HOME") continue;
    if (process.env[key]) env[key] = process.env[key];
  }
  if (!env.PATH) env.PATH = process.env.PATH || "";
  return env;
}

function programPaths() {
  const programsDir = path.resolve(__dirname, "../../internal/d069/programs");
  const validationScript = absNorm(path.join(programsDir, "validation-program.js"));
  const testLauncher = absNorm(path.join(programsDir, "test-codex-launcher.js"));
  const testNative = absNorm(path.join(programsDir, "test-codex-native-stub.js"));
  const treeChildLauncher = absNorm(path.join(programsDir, "test-tree-child-launcher.js"));
  return {
    validationScript,
    validationSha256: sha256File(validationScript),
    testLauncher,
    testLauncherSha256: sha256File(testLauncher),
    testNative,
    testNativeSha256: sha256File(testNative),
    treeChildLauncher,
  };
}

module.exports = {
  programPaths,
  snapshotHostEnv,
};
