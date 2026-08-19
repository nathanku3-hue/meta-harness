"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { domainDigest, isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");
const { repositoryRoot, runGit } = require("./work-git");

const RESEARCH_PROMOTION_SCHEMA = "research-promotion/v1";
const RESEARCH_PROMOTION_DOMAIN = "meta-harness-research-promotion/v1";
const RESEARCH_FINDING_DOMAIN = "meta-harness-research-finding/v1";
const RESEARCH_FINDING_KINDS = Object.freeze([
  "FINDING",
  "CONSTRAINT",
  "DISPROVED_ASSUMPTION",
]);
const RESEARCH_FINDING_KIND_SET = new Set(RESEARCH_FINDING_KINDS);

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("MH_RESEARCH_EVIDENCE_SHAPE", `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail("MH_RESEARCH_EVIDENCE_SHAPE", `${label} has missing or unexpected fields`, { actual, expected: wanted });
  }
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail("MH_RESEARCH_EVIDENCE_VALUE", `${label} must be a non-empty string`);
  }
  return value;
}

function validBlobOid(value) {
  return typeof value === "string" && /^[a-f0-9]{40,64}$/u.test(value);
}

function validateSource(value) {
  exactKeys(value, ["contentDigest", "blobOid", "byteLength"], "researchPromotion.source");
  if (!isDigest(value.contentDigest)) fail("MH_RESEARCH_EVIDENCE_VALUE", "researchPromotion.source.contentDigest must be sha256:<hex>");
  if (!validBlobOid(value.blobOid)) fail("MH_RESEARCH_EVIDENCE_VALUE", "researchPromotion.source.blobOid must be a Git object id");
  if (!Number.isInteger(value.byteLength) || value.byteLength < 0) {
    fail("MH_RESEARCH_EVIDENCE_VALUE", "researchPromotion.source.byteLength must be a non-negative integer");
  }
  return Object.freeze({
    contentDigest: value.contentDigest,
    blobOid: value.blobOid,
    byteLength: value.byteLength,
  });
}

function validateEvidenceEntry(value, label) {
  exactKeys(value, ["quote", "byteStart", "byteEnd"], label);
  const quote = nonEmptyString(value.quote, `${label}.quote`);
  if (!Number.isInteger(value.byteStart) || value.byteStart < 0
      || !Number.isInteger(value.byteEnd) || value.byteEnd <= value.byteStart) {
    fail("MH_RESEARCH_EVIDENCE_VALUE", `${label} byte offsets are invalid`);
  }
  if (Buffer.byteLength(quote, "utf8") !== value.byteEnd - value.byteStart) {
    fail("MH_RESEARCH_EVIDENCE_VALUE", `${label} byte offsets do not match quote UTF-8 bytes`);
  }
  return Object.freeze({ quote, byteStart: value.byteStart, byteEnd: value.byteEnd });
}

function findingBody(sourceContentDigest, value) {
  return {
    sourceContentDigest,
    kind: value.kind,
    statement: value.statement,
    scope: value.scope,
    evidence: value.evidence,
  };
}

function computeResearchFindingDigest(sourceContentDigest, value) {
  return domainDigest(RESEARCH_FINDING_DOMAIN, findingBody(sourceContentDigest, value));
}

function validateFinding(value, sourceContentDigest, index) {
  const label = `researchPromotion.findings[${index}]`;
  exactKeys(value, ["findingDigest", "kind", "statement", "scope", "evidence"], label);
  if (!RESEARCH_FINDING_KIND_SET.has(value.kind)) {
    fail("MH_RESEARCH_EVIDENCE_VALUE", `${label}.kind is invalid`);
  }
  const statement = nonEmptyString(value.statement, `${label}.statement`);
  const scope = nonEmptyString(value.scope, `${label}.scope`);
  if (!Array.isArray(value.evidence) || value.evidence.length === 0) {
    fail("MH_RESEARCH_EVIDENCE_VALUE", `${label}.evidence must contain at least one exact quote`);
  }
  const evidence = Object.freeze(value.evidence.map((entry, evidenceIndex) => (
    validateEvidenceEntry(entry, `${label}.evidence[${evidenceIndex}]`)
  )));
  const finding = { kind: value.kind, statement, scope, evidence };
  const findingDigest = computeResearchFindingDigest(sourceContentDigest, finding);
  if (value.findingDigest !== findingDigest) {
    fail("MH_RESEARCH_EVIDENCE_DIGEST", `${label}.findingDigest does not match content`);
  }
  return Object.freeze({ findingDigest, ...finding });
}

function promotionBody(value) {
  return {
    schemaVersion: value.schemaVersion,
    source: value.source,
    promoterIdentity: value.promoterIdentity,
    findings: value.findings,
    promotedAt: value.promotedAt,
  };
}

function computeResearchPromotionDigest(value) {
  return domainDigest(RESEARCH_PROMOTION_DOMAIN, promotionBody(value));
}

function validateResearchPromotion(value) {
  exactKeys(value, [
    "schemaVersion",
    "source",
    "promoterIdentity",
    "findings",
    "promotedAt",
    "promotionDigest",
  ], "researchPromotion");
  if (value.schemaVersion !== RESEARCH_PROMOTION_SCHEMA) {
    fail("MH_RESEARCH_EVIDENCE_SCHEMA", `researchPromotion.schemaVersion must be ${RESEARCH_PROMOTION_SCHEMA}`);
  }
  const source = validateSource(value.source);
  const promoterIdentity = nonEmptyString(value.promoterIdentity, "researchPromotion.promoterIdentity");
  if (!Array.isArray(value.findings)) fail("MH_RESEARCH_EVIDENCE_VALUE", "researchPromotion.findings must be an array");
  const findings = Object.freeze(value.findings.map((entry, index) => validateFinding(entry, source.contentDigest, index)));
  const findingDigests = findings.map((entry) => entry.findingDigest);
  if (new Set(findingDigests).size !== findingDigests.length) {
    fail("MH_RESEARCH_EVIDENCE_VALUE", "researchPromotion.findings must not contain duplicate finding digests");
  }
  const promotedAt = nonEmptyString(value.promotedAt, "researchPromotion.promotedAt");
  if (!Number.isFinite(Date.parse(promotedAt))) fail("MH_RESEARCH_EVIDENCE_VALUE", "researchPromotion.promotedAt must be an ISO timestamp");
  const normalized = {
    schemaVersion: RESEARCH_PROMOTION_SCHEMA,
    source,
    promoterIdentity,
    findings,
    promotedAt,
  };
  const promotionDigest = computeResearchPromotionDigest(normalized);
  if (value.promotionDigest !== promotionDigest) {
    fail("MH_RESEARCH_EVIDENCE_DIGEST", "researchPromotion.promotionDigest does not match content");
  }
  return Object.freeze({ ...normalized, promotionDigest });
}

function sealResearchPromotion({ source, promoterIdentity, findings, promotedAt = new Date() }) {
  const normalizedSource = validateSource(source);
  const sealedFindings = findings.map((finding) => {
    const body = {
      kind: finding.kind,
      statement: finding.statement,
      scope: finding.scope,
      evidence: finding.evidence,
    };
    return {
      findingDigest: computeResearchFindingDigest(normalizedSource.contentDigest, body),
      ...body,
    };
  });
  const body = {
    schemaVersion: RESEARCH_PROMOTION_SCHEMA,
    source: normalizedSource,
    promoterIdentity,
    findings: sealedFindings,
    promotedAt: promotedAt instanceof Date ? promotedAt.toISOString() : String(promotedAt),
  };
  return validateResearchPromotion({ ...body, promotionDigest: computeResearchPromotionDigest(body) });
}

function researchEvidenceRoot(repositoryPath) {
  const root = repositoryRoot(repositoryPath);
  const common = String(runGit(root, ["rev-parse", "--git-common-dir"]).stdout || "").trim();
  if (!common) fail("MH_RESEARCH_EVIDENCE_STORE", "Git common directory could not be resolved");
  return path.join(path.resolve(root, common), "meta-harness", "research-evidence");
}

function promotionFilePath(repositoryPath, contentDigest) {
  if (!isDigest(contentDigest)) fail("MH_RESEARCH_EVIDENCE_VALUE", "promotion lookup requires sha256:<hex> content digest");
  return path.join(researchEvidenceRoot(repositoryPath), "promotions", `${contentDigest.slice("sha256:".length)}.json`);
}

function readResearchPromotion(repositoryPath, contentDigest, { optional = false } = {}) {
  const filePath = promotionFilePath(repositoryPath, contentDigest);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    fail("MH_RESEARCH_EVIDENCE_READ", `research promotion is unreadable: ${error.message}`, { contentDigest });
  }
  const promotion = validateResearchPromotion(parsed);
  if (promotion.source.contentDigest !== contentDigest) {
    fail("MH_RESEARCH_EVIDENCE_DIGEST", "research promotion filename/content identity mismatch", { contentDigest });
  }
  return promotion;
}

function writeCanonicalResearchPromotion(repositoryPath, value) {
  const promotion = validateResearchPromotion(value);
  const filePath = promotionFilePath(repositoryPath, promotion.source.contentDigest);
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const tempPath = path.join(
    directory,
    `.tmp.${promotion.source.contentDigest.slice("sha256:".length)}.${process.pid}.${crypto.randomUUID()}`,
  );
  let fd;
  try {
    fd = fs.openSync(tempPath, "wx", 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(promotion, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    try {
      fs.linkSync(tempPath, filePath);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  } catch (error) {
    fail("MH_RESEARCH_EVIDENCE_WRITE", `research promotion could not be persisted: ${error.message}`, {
      contentDigest: promotion.source.contentDigest,
    });
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(tempPath); } catch (_) {
      // The canonical hard link, not the temporary pathname, is the durable receipt.
    }
  }
  return readResearchPromotion(repositoryPath, promotion.source.contentDigest);
}

module.exports = {
  RESEARCH_FINDING_KINDS,
  RESEARCH_PROMOTION_SCHEMA,
  computeResearchFindingDigest,
  computeResearchPromotionDigest,
  promotionFilePath,
  readResearchPromotion,
  researchEvidenceRoot,
  sealResearchPromotion,
  validateResearchPromotion,
  writeCanonicalResearchPromotion,
};
