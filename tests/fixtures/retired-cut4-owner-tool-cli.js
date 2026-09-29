#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  signGScope,
  signPublicationException,
} = require("./owner-tool");

function usage(message) {
  if (message) process.stderr.write(`${message}\n`);
  process.stderr.write(
    "usage: owner-tool <sign-g-scope|sign-publication-exception> --input <json> --private-key <pem>\n",
  );
  process.exitCode = 2;
}

function parse(argv) {
  const [command, ...rest] = argv;
  if (!new Set(["sign-g-scope", "sign-publication-exception"]).has(command)) {
    usage("unsupported owner-tool command");
    return null;
  }
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!new Set(["--input", "--private-key"]).has(flag) || !value) {
      usage(`invalid option: ${String(flag)}`);
      return null;
    }
    if (options[flag]) {
      usage(`duplicate option: ${flag}`);
      return null;
    }
    options[flag] = value;
  }
  if (!options["--input"] || !options["--private-key"]) {
    usage("--input and --private-key are required");
    return null;
  }
  return { command, inputPath: options["--input"], privateKeyPath: options["--private-key"] };
}

function readRegularFile(filePathInput, label) {
  const filePath = path.resolve(filePathInput);
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symlink file`);
  }
  return fs.readFileSync(filePath);
}

function main() {
  const parsed = parse(process.argv.slice(2));
  if (!parsed) return;
  const input = JSON.parse(readRegularFile(parsed.inputPath, "input").toString("utf8"));
  const privateBytes = readRegularFile(parsed.privateKeyPath, "private key");
  let privateKey;
  try {
    privateKey = crypto.createPrivateKey(privateBytes);
  } finally {
    privateBytes.fill(0);
  }
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("owner private key must be Ed25519");
  }

  const result = parsed.command === "sign-g-scope"
    ? signGScope(input, privateKey)
    : signPublicationException(input, privateKey);

  process.stderr.write(`Owner key: ${result.ownerKeyId}\n`);
  process.stderr.write(`Object digest: ${result.objectDigest}\n`);
  process.stderr.write(`Canonical signed body: ${result.canonicalSigningBody}\n`);
  process.stdout.write(`${JSON.stringify(result.signed, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.code || "OWNER_TOOL_ERROR"}: ${error.message}\n`);
  process.exitCode = 1;
}
