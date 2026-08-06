"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  pinProductDirection,
  productDirectionDigest,
  validateProductDirectionShape,
} = require("../../lib/product-direction");

const SAMPLE_PRODUCT_MD = [
  "# Sample product direction",
  "",
  "## Version",
  "",
  "product-direction-v1",
  "",
  "## Endgame",
  "",
  "Deliver one clear product result without losing owner taste.",
  "",
  "## Target user",
  "",
  "Solo developer using Meta-Harness work sessions.",
  "",
  "## Core user journey",
  "",
  "State direction once, then run work until validation passes.",
  "",
  "## Taste — prefer",
  "",
  "Exact continuity and immediate coding action.",
  "",
  "## Taste — reject",
  "",
  "Silent direction rewrite and routine planning restarts.",
  "",
  "## Non-negotiables",
  "",
  "Owner authors PRODUCT.md; workers never mutate it.",
  "",
  "## Shipping definition",
  "",
  "Controller-owned validation passes on the accepted result.",
  "",
  "## Change rule",
  "",
  "Only the owner edits this file and bumps Version.",
  "",
].join("\n");

function writeProductMd(repositoryPath, content = SAMPLE_PRODUCT_MD) {
  fs.writeFileSync(path.join(repositoryPath, "PRODUCT.md"), content, "utf8");
  return pinProductDirection(repositoryPath);
}

function directionFromContent(content = SAMPLE_PRODUCT_MD) {
  const bytes = Buffer.from(content, "utf8");
  const versionLine = content
    .split(/\r?\n/)
    .slice(content.split(/\r?\n/).findIndex((line) => /^#{1,3}\s+Version\s*$/.test(line)) + 1)
    .find((line) => line.trim().length > 0);
  return validateProductDirectionShape({
    schemaVersion: "product-direction/v1",
    sourcePath: "PRODUCT.md",
    version: (versionLine || "product-direction-v1").trim(),
    digest: productDirectionDigest(bytes),
    content,
  });
}

module.exports = {
  SAMPLE_PRODUCT_MD,
  directionFromContent,
  writeProductMd,
};
