"use strict";

/** D071 test program identity and host-environment helpers. */

const fs = require("node:fs");
const path = require("node:path");

const { sha256File } = require("../../internal/d069/local-controller");
const {
  AO_ENV_ALLOWLIST,
  WINDOWS_POWERSHELL_PATH,
  VALIDATION_ENV_ALLOWLIST,
  D071_SUBJECT_RELATIVE_PATH,
  FIXED_TIMEOUT_SECONDS,
} = require("../../internal/d069/ao-constants");
const {
  absNorm,
  buildD071ValidationArgv,
  snapshotValidationHostEnv,
} = require("../../internal/d069/support");

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
  const fixturesDir = path.resolve(__dirname, "../fixtures/d071");
  const validationScript = absNorm(
    path.join(programsDir, "validate-toollauncher-shortcut.ps1"),
  );
  const powershellPath = absNorm(WINDOWS_POWERSHELL_PATH);
  const testLauncher = absNorm(path.join(programsDir, "test-codex-launcher.js"));
  const testNative = absNorm(path.join(programsDir, "test-codex-native-stub.js"));
  const treeChildLauncher = absNorm(path.join(programsDir, "test-tree-child-launcher.js"));
  const baselineFixture = absNorm(
    path.join(fixturesDir, "toollauncher-checkshortcut-7fab419f.ps1"),
  );
  const knownGoodFixture = absNorm(
    path.join(fixturesDir, "known-good-checkshortcut.ps1"),
  );

  if (!fs.existsSync(powershellPath)) {
    throw new Error(`Windows PowerShell host missing: ${powershellPath}`);
  }

  const argv = buildD071ValidationArgv(powershellPath, validationScript);
  const allow = [...VALIDATION_ENV_ALLOWLIST].sort();

  return {
    powershellPath,
    powershellSha256: sha256File(powershellPath),
    validationScript,
    validationSha256: sha256File(validationScript),
    validationArgv: argv,
    validationAllow: allow,
    validationExpectedCommand: {
      argv,
      cwdRelative: ".",
      timeoutSeconds: FIXED_TIMEOUT_SECONDS,
      networkPolicy: "denied",
      environmentPolicy: { allow },
    },
    subjectRelativePath: D071_SUBJECT_RELATIVE_PATH,
    baselineFixture,
    knownGoodFixture,
    baselineBlobSha1: "aa1d3b7c71761b9a50139f828e7c154bc9693b66",
    testLauncher,
    testLauncherSha256: sha256File(testLauncher),
    testNative,
    testNativeSha256: sha256File(testNative),
    treeChildLauncher,
    snapshotValidationHostEnv: () => snapshotValidationHostEnv(process.env),
  };
}

module.exports = {
  programPaths,
  snapshotHostEnv,
};
