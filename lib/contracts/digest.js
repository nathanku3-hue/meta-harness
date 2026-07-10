"use strict";

const { stateHash } = require("../state-hash");

/**
 * Canonical MH digest: sha256:<hex> over stableJson of value.
 * Providers must not supply digests as authoritative.
 */
function digestOf(value) {
  return `sha256:${stateHash(value)}`;
}

function isDigest(value) {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

module.exports = { digestOf, isDigest };
