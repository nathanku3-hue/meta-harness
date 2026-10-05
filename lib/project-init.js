"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { withBootstrapLock } = require("./bootstrap-lock");
const { ConfigError } = require("./errors");
const {
  HARNESS_DIR,
  STREAMS,
  ensureHarness,
  harnessPath,
  streamTemplate,
  workerReportTemplate,
} = require("./harness-state");
const { writeIfMissing } = require("./paths");
const {
  PROJECT_DECLARATION_RELATIVE_PATH,
  PROJECT_DECLARATION_SCHEMA,
  STARTUP_CONTEXT_SCHEMA,
  inspectProjectStartup,
  readProjectDeclaration,
} = require("./project-startup-context");
const { renderCanonicalStatus } = require("./truth-reconciler");
const {
  assertContainedPath,
  assertHarnessAbsent,
  assertRepositoryRoot,
} = require("./truth-paths");

function failConfig(message) {
  throw new ConfigError(message);
}

function writeStarterFiles(context) {
  ensureHarness(context);
  writeIfMissing(harnessPath(context, "workers", "worker-report-template.md"), workerReportTemplate());
  for (const stream of STREAMS) {
    writeIfMissing(harnessPath(context, "streams", `${stream}.md`), streamTemplate(stream));
  }
  writeIfMissing(harnessPath(context, "status.md"), renderCanonicalStatus());
}

function promoteBootstrap(context) {
  const { root } = assertRepositoryRoot(context.cwd);
  const targetHarness = assertHarnessAbsent(root);
  const stageRoot = fs.mkdtempSync(path.join(root, ".meta-harness-bootstrap-"));
  const stageContext = { ...context, cwd: stageRoot };
  const stagedHarness = path.join(stageRoot, HARNESS_DIR);

  try {
    assertContainedPath(root, stageRoot, {
      leafType: "directory",
      label: "bootstrap staging directory",
    });
    writeStarterFiles(stageContext);
    assertHarnessAbsent(root);
    fs.renameSync(stagedHarness, targetHarness);
  } finally {
    fs.rmSync(stageRoot, { recursive: true, force: true });
  }
}

function regularFileNoLink(target) {
  try {
    const stat = fs.lstatSync(target);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw error;
  }
}

function directoryNoLink(target) {
  try {
    const stat = fs.lstatSync(target);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw error;
  }
}

function projectHooksComplete(root) {
  const targetHarness = path.join(root, HARNESS_DIR);
  assertContainedPath(root, targetHarness, {
    leafType: "directory",
    label: "existing harness directory",
  });
  const requiredDirectories = [
    path.join(targetHarness, "contracts"),
    path.join(targetHarness, "streams"),
    path.join(targetHarness, "workers"),
  ];
  const requiredFiles = [
    path.join(targetHarness, "events.jsonl"),
    path.join(targetHarness, "repos.json"),
    path.join(targetHarness, "status.md"),
    path.join(targetHarness, "workers", "worker-report-template.md"),
    ...STREAMS.map((stream) => path.join(targetHarness, "streams", `${stream}.md`)),
  ];
  return requiredDirectories.every(directoryNoLink) && requiredFiles.every(regularFileNoLink);
}

function assertExistingHookRootsSafe(root) {
  for (const relative of ["contracts", "streams", "workers"]) {
    const target = path.join(root, HARNESS_DIR, relative);
    if (!fs.existsSync(target)) continue;
    assertContainedPath(root, target, {
      leafType: "directory",
      label: `existing harness ${relative} directory`,
    });
  }
  for (const relative of [
    "events.jsonl",
    "repos.json",
    "status.md",
    "workers/worker-report-template.md",
    ...STREAMS.map((stream) => `streams/${stream}.md`),
  ]) {
    const target = path.join(root, HARNESS_DIR, ...relative.split("/"));
    if (!fs.existsSync(target)) continue;
    assertContainedPath(root, target, {
      leafType: "file",
      label: `existing harness ${relative}`,
    });
  }
}

function ensureProjectHooks(context = {}) {
  const { root } = assertRepositoryRoot(context.cwd);
  const targetHarness = path.join(root, HARNESS_DIR);
  if (fs.existsSync(targetHarness)) {
    assertExistingHookRootsSafe(root);
    if (projectHooksComplete(root)) {
      return Object.freeze({ initialized: false, reconciled: false, root });
    }
    writeStarterFiles({ ...context, cwd: root });
    if (!projectHooksComplete(root)) {
      failConfig("repository runtime hooks remain incomplete after silent reconcile");
    }
    return Object.freeze({ initialized: false, reconciled: true, root });
  }
  withBootstrapLock({ ...context, cwd: root }, () => {
    if (!fs.existsSync(targetHarness)) promoteBootstrap({ ...context, cwd: root });
  });
  if (!projectHooksComplete(root)) {
    failConfig("fresh repository runtime hooks are incomplete after bootstrap");
  }
  return Object.freeze({ initialized: true, reconciled: false, root });
}

module.exports = {
  PROJECT_DECLARATION_RELATIVE_PATH,
  PROJECT_DECLARATION_SCHEMA,
  STARTUP_CONTEXT_SCHEMA,
  ensureProjectHooks,
  inspectProjectStartup,
  readProjectDeclaration,
};
