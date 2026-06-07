"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const harnessState = require("../lib/harness-state");

test("harness-state exports stay intentional", () => {
  assert.deepEqual(Object.keys(harnessState).sort(), [
    "ACTUAL_WORK_TYPES",
    "EXECUTION_STYLE_WORK_TYPES",
    "HARNESS_DIR",
    "PHASES",
    "REQUESTED_WORK_TYPES",
    "STREAMS",
    "appendEvent",
    "ensureHarness",
    "eventTime",
    "fieldFromLatest",
    "harnessPath",
    "hasExplicitBlocker",
    "latest",
    "listOrNone",
    "normalizePhase",
    "normalizeStream",
    "nowIso",
    "phaseMapTemplate",
    "readEvents",
    "refreshStatus",
    "relativePath",
    "renderStatus",
    "requireHarness",
    "slugify",
    "streamTemplate",
    "workerReportTemplate",
  ].sort());
});
