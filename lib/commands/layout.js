"use strict";

const { UsageError } = require("../errors");
const { optionValue, parseArgs } = require("../cli-args");
const { writeLine, writeOut } = require("../cli-context");
const {
  closeLayoutTarget,
  resolveInputPath,
  writeLayoutManifest,
} = require("../repository-layout-close");

function requiredOption(options, name) {
  const value = optionValue(options[name]);
  if (value === undefined || value === null || value === true || String(value).trim() === "") {
    throw new UsageError(`--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} requires a value`);
  }
  return value;
}

function printJson(context, value) {
  writeOut(context, `${JSON.stringify(value, null, 2)}\n`);
}

module.exports = async function runLayout(args, context) {
  const { positional, options } = parseArgs(args);
  const action = positional[0];
  if (positional.length !== 1 || !["manifest", "close"].includes(action)) {
    throw new UsageError(`unknown layout action: ${action || "missing"}`);
  }

  if (action === "manifest") {
    const target = resolveInputPath(requiredOption(options, "target"), context.cwd);
    const output = resolveInputPath(requiredOption(options, "output"), context.cwd);
    const copy = options.copy === undefined ? undefined : resolveInputPath(requiredOption(options, "copy"), context.cwd);
    const result = writeLayoutManifest({ targetRoot: target, outputPath: output, copyPath: copy });
    const summary = {
      ok: result.ok,
      schema: result.schema,
      manifest_path: result.manifest_path,
      manifest_sha256: result.manifest_sha256,
      manifest_bytes: result.manifest_bytes,
      second_copy: result.second_copy,
      inventory_digest: result.manifest.inventory_digest,
      target_path_identity: result.manifest.target_path_identity,
      target_classification: result.manifest.target_classification,
      counts: result.manifest.layout_snapshot.counts,
    };
    if (options.json) printJson(context, summary);
    else writeLine(context, `LAYOUT MANIFEST: ${summary.manifest_path} sha256=${summary.manifest_sha256}`);
    return { exitCode: 0 };
  }

  const target = requiredOption(options, "target");
  const manifest = requiredOption(options, "manifest");
  const receipt = requiredOption(options, "receipt");
  const manifestCopy = options.manifestCopy === undefined
    ? undefined
    : requiredOption(options, "manifestCopy");
  const result = closeLayoutTarget({
    target,
    manifestPath: manifest,
    receiptPath: receipt,
    manifestCopyPath: manifestCopy,
    cwd: context.cwd,
  });
  if (options.json) printJson(context, result);
  else writeLine(context, `LAYOUT CLOSE: ${result.verdict} ${result.target}`);
  return { exitCode: result.ok ? 0 : 1 };
};
