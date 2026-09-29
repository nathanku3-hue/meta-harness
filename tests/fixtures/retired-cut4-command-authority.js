"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { fail, optionValue, parseArgs } = require("../cli-args");
const { writeLine, writeOut } = require("../cli-context");
const { ConfigError } = require("../errors");
const { bootstrapOwnerPin } = require("../semantic-kernel/owner-pin");

function readPublicKey(context, value) {
  if (!value || value === true) fail("authority bootstrap requires --owner-public-key-file <path>");
  const filePath = path.resolve(context.cwd, String(value));
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new ConfigError(`owner public key is unreadable or invalid JSON: ${error.message}`, {
      code: "OWNER_PIN_PUBLIC_KEY_INVALID",
    });
  }
  return parsed;
}

module.exports = async function runAuthority(args, context) {
  const { positional, options } = parseArgs(args);
  const [action, ...extra] = positional;
  if (action !== "bootstrap" || extra.length > 0) {
    fail("usage: meta-harness authority bootstrap --owner-public-key-file <path> [--json]");
  }
  const allowed = new Set(["ownerPublicKeyFile", "json"]);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) fail(`unknown authority bootstrap option: --${key}`);
  }
  if (Array.isArray(options.ownerPublicKeyFile)) fail("--owner-public-key-file may be supplied exactly once");
  if (Array.isArray(options.json)) fail("--json may be supplied at most once");

  const result = bootstrapOwnerPin({
    repositoryPath: context.cwd,
    ownerPublicKey: readPublicKey(context, optionValue(options.ownerPublicKeyFile)),
  });
  const output = {
    schemaVersion: "authority-bootstrap-result/v1",
    ok: true,
    repositoryId: result.pin.repositoryId,
    ownerKeyId: result.pin.ownerKeyId,
    pinDigest: result.pin.pinDigest,
    stateRootKey: path.basename(result.stateRoot),
  };
  if (options.json) writeOut(context, `${JSON.stringify(output, null, 2)}\n`);
  else {
    writeLine(context, "Owner authority pin installed outside the repository.");
    writeLine(context, `Repository state key: ${output.stateRootKey}`);
    writeLine(context, `Owner key: ${output.ownerKeyId}`);
  }
  return { exitCode: 0 };
};
