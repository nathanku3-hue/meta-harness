"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { ConfigError } = require("./errors");
const { isDigest } = require("./contracts/digest");

const PRODUCT_DIRECTION_SCHEMA = "product-direction/v1";
const PRODUCT_DIRECTION_SOURCE = "PRODUCT.md";
const PRODUCT_DIRECTION_DOMAIN = "meta-harness-product-direction/v1";
const MAX_PRODUCT_DIRECTION_BYTES = 128 * 1024;
const PRODUCT_DIRECTION_BLOCKED = [
  "Product direction changed since this work session was created.",
  "Start a new work session from the new direction.",
].join("\n");

const REQUIRED_HEADINGS = Object.freeze([
  "Version",
  "Endgame",
  "Target user",
  "Core user journey",
  "Taste — prefer",
  "Taste — reject",
  "Non-negotiables",
  "Shipping definition",
  "Change rule",
]);

const PRODUCT_DIRECTION_KEYS = Object.freeze([
  "schemaVersion",
  "sourcePath",
  "version",
  "digest",
  "content",
]);

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function productDirectionDigest(bytes) {
  if (!Buffer.isBuffer(bytes)) {
    fail("MH_PRODUCT_DIRECTION_DIGEST", "product direction digest requires raw bytes");
  }
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function contentBytes(content) {
  if (typeof content !== "string") {
    fail("MH_PRODUCT_DIRECTION_CONTENT", "product direction content must be a string of exact owner-authored bytes");
  }
  return Buffer.from(content, "utf8");
}

function parseRequiredSections(text) {
  const lines = String(text).split(/\r?\n/);
  const sections = new Map();
  let current = null;
  let body = [];

  const flush = () => {
    if (!current) return;
    const textBody = body.join("\n").trim();
    sections.set(current, textBody);
    body = [];
  };

  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+?)\s*$/);
    if (heading) {
      flush();
      current = heading[1].trim();
      body = [];
      continue;
    }
    if (current) body.push(line);
  }
  flush();

  for (const required of REQUIRED_HEADINGS) {
    if (!sections.has(required)) {
      fail(
        "MH_PRODUCT_DIRECTION_SECTION",
        `PRODUCT.md is missing required heading: ${required}`,
      );
    }
    if (sections.get(required).length === 0) {
      fail(
        "MH_PRODUCT_DIRECTION_SECTION",
        `PRODUCT.md section "${required}" must have non-empty content`,
      );
    }
  }
  return sections;
}

function exactRequiredSectionBodies(productDirection) {
  const direction = validateProductDirectionShape(productDirection);
  const content = direction.content;
  const headings = [];
  let cursor = 0;
  while (cursor < content.length) {
    const newline = content.indexOf("\n", cursor);
    const lineEnd = newline === -1 ? content.length : newline;
    const rawLine = content.slice(cursor, lineEnd);
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const heading = line.match(/^#{1,3}[ \t]+(.+?)[ \t]*$/u);
    const next = newline === -1 ? content.length : newline + 1;
    if (heading) {
      headings.push({ name: heading[1].trim(), headingStart: cursor, bodyStart: next });
    }
    if (newline === -1) break;
    cursor = next;
  }

  const sections = new Map();
  for (let index = 0; index < headings.length; index += 1) {
    const entry = headings[index];
    const nextHeadingStart = headings[index + 1]?.headingStart ?? content.length;
    sections.set(entry.name, content.slice(entry.bodyStart, nextHeadingStart));
  }
  for (const required of REQUIRED_HEADINGS) {
    if (!sections.has(required) || sections.get(required).trim() === "") {
      fail("MH_PRODUCT_DIRECTION_SECTION", `PRODUCT.md section "${required}" is unavailable for exact projection`);
    }
  }
  return sections;
}

function projectProductDirectionForPlanner(productDirection) {
  const direction = validateProductDirectionShape(productDirection);
  const sections = exactRequiredSectionBodies(direction);
  return Object.freeze({
    productDirectionDigest: direction.digest,
    version: direction.version,
    endgame: sections.get("Endgame"),
    targetUser: sections.get("Target user"),
    coreUserJourney: sections.get("Core user journey"),
    tastePrefer: sections.get("Taste — prefer"),
    tasteReject: sections.get("Taste — reject"),
    nonNegotiables: sections.get("Non-negotiables"),
    shippingDefinition: sections.get("Shipping definition"),
  });
}

function validateProductDirectionShape(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype) {
    fail("MH_PRODUCT_DIRECTION_SHAPE", "productDirection must be a plain object");
  }
  const actual = Object.keys(value).sort();
  const expected = [...PRODUCT_DIRECTION_KEYS].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail("MH_PRODUCT_DIRECTION_SHAPE", "productDirection has missing or unexpected fields", {
      actual,
      expected,
    });
  }
  if (value.schemaVersion !== PRODUCT_DIRECTION_SCHEMA) {
    fail(
      "MH_PRODUCT_DIRECTION_SCHEMA",
      `productDirection.schemaVersion must be ${PRODUCT_DIRECTION_SCHEMA}`,
    );
  }
  if (value.sourcePath !== PRODUCT_DIRECTION_SOURCE) {
    fail(
      "MH_PRODUCT_DIRECTION_SOURCE",
      `productDirection.sourcePath must be ${PRODUCT_DIRECTION_SOURCE}`,
    );
  }
  if (typeof value.version !== "string" || value.version.trim() === "") {
    fail("MH_PRODUCT_DIRECTION_VERSION", "productDirection.version must be a non-empty string");
  }
  if (!isDigest(value.digest)) {
    fail("MH_PRODUCT_DIRECTION_DIGEST", "productDirection.digest must be sha256:<64 lowercase hex>");
  }
  if (typeof value.content !== "string" || value.content.length === 0) {
    fail("MH_PRODUCT_DIRECTION_CONTENT", "productDirection.content must be non-empty exact owner-authored text");
  }
  const bytes = contentBytes(value.content);
  if (bytes.byteLength > MAX_PRODUCT_DIRECTION_BYTES) {
    fail(
      "MH_PRODUCT_DIRECTION_SIZE",
      `productDirection.content exceeds ${MAX_PRODUCT_DIRECTION_BYTES} bytes`,
    );
  }
  if (productDirectionDigest(bytes) !== value.digest) {
    fail(
      "MH_PRODUCT_DIRECTION_DIGEST",
      "productDirection.digest does not match productDirection.content bytes",
    );
  }
  parseRequiredSections(value.content);
  return value;
}

function productDirectionPath(repositoryPath) {
  return path.resolve(repositoryPath, PRODUCT_DIRECTION_SOURCE);
}

function isProtectedProductDirectionPath(relativePath) {
  const normalized = String(relativePath || "").replace(/\\/g, "/").replace(/^\.\//, "");
  return normalized === PRODUCT_DIRECTION_SOURCE
    || normalized.toLowerCase() === PRODUCT_DIRECTION_SOURCE.toLowerCase();
}

function readLiveProductDirection(repositoryPath) {
  const absolute = productDirectionPath(repositoryPath);
  let stat;
  try {
    stat = fs.lstatSync(absolute);
  } catch (error) {
    fail(
      "MH_PRODUCT_DIRECTION_MISSING",
      "PRODUCT.md is required at the repository root before coding work can start",
      { cause: error.message },
    );
  }
  if (stat.isSymbolicLink()) {
    fail("MH_PRODUCT_DIRECTION_TARGET", "PRODUCT.md must be a regular file, not a symlink");
  }
  if (!stat.isFile()) {
    fail("MH_PRODUCT_DIRECTION_TARGET", "PRODUCT.md must be a regular non-symlink file");
  }
  if (stat.size > MAX_PRODUCT_DIRECTION_BYTES) {
    fail(
      "MH_PRODUCT_DIRECTION_SIZE",
      `PRODUCT.md exceeds ${MAX_PRODUCT_DIRECTION_BYTES} bytes`,
    );
  }
  const bytes = fs.readFileSync(absolute);
  if (bytes.byteLength > MAX_PRODUCT_DIRECTION_BYTES) {
    fail(
      "MH_PRODUCT_DIRECTION_SIZE",
      `PRODUCT.md exceeds ${MAX_PRODUCT_DIRECTION_BYTES} bytes`,
    );
  }
  let content;
  try {
    content = bytes.toString("utf8");
  } catch (error) {
    fail("MH_PRODUCT_DIRECTION_ENCODING", `PRODUCT.md is not readable as UTF-8: ${error.message}`);
  }
  if (Buffer.compare(Buffer.from(content, "utf8"), bytes) !== 0) {
    fail("MH_PRODUCT_DIRECTION_ENCODING", "PRODUCT.md must be valid UTF-8 without replacement");
  }
  const sections = parseRequiredSections(content);
  const version = sections.get("Version").split(/\r?\n/, 1)[0].trim();
  if (!version) {
    fail("MH_PRODUCT_DIRECTION_VERSION", "PRODUCT.md Version section must begin with a non-empty version line");
  }
  const digest = productDirectionDigest(bytes);
  return {
    schemaVersion: PRODUCT_DIRECTION_SCHEMA,
    sourcePath: PRODUCT_DIRECTION_SOURCE,
    version,
    digest,
    content,
  };
}

function pinProductDirection(repositoryPath) {
  return validateProductDirectionShape(readLiveProductDirection(repositoryPath));
}

function assertProductDirectionUnchanged(sessionDirection, repositoryPath) {
  const pinned = validateProductDirectionShape(sessionDirection);
  let live;
  try {
    live = pinProductDirection(repositoryPath);
  } catch (error) {
    if (error instanceof ConfigError) {
      fail("MH_PRODUCT_DIRECTION_DRIFT", PRODUCT_DIRECTION_BLOCKED, {
        reason: error.code || "live_read_failed",
        cause: error.message,
      });
    }
    throw error;
  }
  if (live.digest !== pinned.digest || live.content !== pinned.content || live.version !== pinned.version) {
    fail("MH_PRODUCT_DIRECTION_DRIFT", PRODUCT_DIRECTION_BLOCKED, {
      persistedDigest: pinned.digest,
      liveDigest: live.digest,
    });
  }
  return live;
}

module.exports = {
  MAX_PRODUCT_DIRECTION_BYTES,
  PRODUCT_DIRECTION_BLOCKED,
  PRODUCT_DIRECTION_DOMAIN,
  PRODUCT_DIRECTION_SCHEMA,
  PRODUCT_DIRECTION_SOURCE,
  REQUIRED_HEADINGS,
  assertProductDirectionUnchanged,
  contentBytes,
  exactRequiredSectionBodies,
  isProtectedProductDirectionPath,
  pinProductDirection,
  productDirectionDigest,
  projectProductDirectionForPlanner,
  productDirectionPath,
  readLiveProductDirection,
  validateProductDirectionShape,
};
