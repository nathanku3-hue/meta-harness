"use strict";

const crypto = require("node:crypto");
const { canonicalize, assertStrictJsonData } = require("./canonical-json");

/**
 * Content integrity digests for authority contracts.
 * Digests prove content consistency only — not provenance or issuer identity.
 *
 * Domain-separated: SHA-256 over UTF-8 bytes of:
 *   domain + "\u001e" + canonicalJson
 * encoded as "sha256:" + lowercase hex.
 */

const DIGEST_RE = /^sha256:[a-f0-9]{64}$/;

function isDigest(value) {
  return typeof value === "string" && DIGEST_RE.test(value);
}

/**
 * @param {string} domain e.g. "run-spec/v1"
 * @param {unknown} value strict JSON data
 * @returns {string} sha256:<hex>
 */
function domainDigest(domain, value) {
  if (typeof domain !== "string" || domain.length === 0 || domain.includes("\u001e")) {
    const err = new Error("domain must be a non-empty string without separator");
    err.code = "DIGEST_DOMAIN_INVALID";
    throw err;
  }
  assertStrictJsonData(value);
  const payload = `${domain}\u001e${canonicalize(value)}`;
  const hex = crypto.createHash("sha256").update(payload, "utf8").digest("hex");
  return `sha256:${hex}`;
}

module.exports = {
  isDigest,
  domainDigest,
};
