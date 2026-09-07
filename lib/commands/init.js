"use strict";

const { fail, parseArgs } = require("../cli-args");
const { writeLine } = require("../cli-context");
const { HARNESS_DIR } = require("../harness-state");
const { ensureProjectHooks } = require("../project-init");
const { assertHarnessAbsent, assertRepositoryRoot } = require("../truth-paths");

module.exports = async function runInit(args, context) {
  const { positional, options } = parseArgs(args);
  if (positional.length > 0 || Object.keys(options).length > 0) {
    fail("init accepts no authority receipt, public key, state-root, repository-id, or clock options");
  }

  const { root } = assertRepositoryRoot(context.cwd);
  assertHarnessAbsent(root);
  ensureProjectHooks(context);

  writeLine(context, `Initialized ${HARNESS_DIR} repository hooks and advisory state.`);
  writeLine(context, "Run `meta-harness authority bootstrap --owner-public-key-file <path>` to install the external owner pin.");
};
