"use strict";

const fs = require("node:fs");
const path = require("node:path");

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".json",
  ".jsonl",
  ".yml",
  ".yaml",
  ".log"
]);

const SECRET_PATH_PATTERN = /(^|[\\/])(?:\.env(?:\.[A-Za-z0-9_-]+)?|[^\\/]*\.(?:pem|key)|credentials\.[A-Za-z0-9_-]+)(?=$|[\s"'`)])/i;

const SECRET_PATTERNS = [
  {
    id: "AWS_ACCESS_KEY_ID",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g
  },
  {
    id: "BEARER_TOKEN",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}={0,2}\b/g
  },
  {
    id: "PRIVATE_KEY_BLOCK",
    pattern: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |)?PRIVATE KEY-----/g
  },
  {
    id: "CONNECTION_STRING",
    pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"'`]+/gi
  },
  {
    id: "AZURE_ACCOUNT_KEY",
    pattern: /\bAccountKey=[A-Za-z0-9+/]{40,}={0,2}/g
  },
  {
    id: "GCP_SERVICE_ACCOUNT",
    pattern: /"type"\s*:\s*"service_account"|"private_key_id"\s*:|"client_email"\s*:\s*"[^"]+\.iam\.gserviceaccount\.com"/g
  },
  {
    id: "SECRET_ASSIGNMENT",
    pattern: /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\s*[:=]\s*["']?[A-Za-z0-9._~+/-]{20,}={0,2}/gi
  },
  {
    id: "SECRET_FILE_PATH",
    pattern: SECRET_PATH_PATTERN
  }
];

function normalizeRelativePath(value) {
  return value.split(path.sep).join("/");
}

function lineForIndex(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function redactMatch(value) {
  const compact = String(value).replace(/\s+/g, " ");
  if (compact.length <= 16) {
    return "[redacted]";
  }
  return `${compact.slice(0, 8)}...[redacted]...${compact.slice(-4)}`;
}

function scanTextForSecrets(text, options = {}) {
  const findings = [];
  const sourcePath = options.path || "<text>";

  for (const rule of SECRET_PATTERNS) {
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`);
    for (const match of text.matchAll(pattern)) {
      findings.push({
        id: rule.id,
        path: sourcePath,
        line: lineForIndex(text, match.index || 0),
        match: redactMatch(match[0])
      });
    }
  }

  return {
    status: findings.length === 0 ? "PASS" : "FAIL",
    checked: 1,
    findings
  };
}

function shouldSkipSecretFile(filePath) {
  const normalized = normalizeRelativePath(filePath);
  return SECRET_PATH_PATTERN.test(`/${normalized}`);
}

function isTextFile(filePath) {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function collectSurfaceFiles(root, relativePath, files, pathFindings) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return;
  }

  const stat = fs.statSync(absolutePath);
  if (stat.isDirectory()) {
    for (const item of fs.readdirSync(absolutePath).sort((left, right) => left.localeCompare(right))) {
      collectSurfaceFiles(root, path.join(relativePath, item), files, pathFindings);
    }
    return;
  }

  if (!stat.isFile()) {
    return;
  }

  const normalized = normalizeRelativePath(relativePath);
  if (shouldSkipSecretFile(relativePath)) {
    pathFindings.push({
      id: "SECRET_FILE_PATH",
      path: normalized,
      line: 1,
      match: "[secret-like output filename]"
    });
    return;
  }

  if (isTextFile(absolutePath)) {
    files.push(relativePath);
  }
}

function scanRedactionSurfaces({ targetRoot, surfaces } = {}) {
  const root = path.resolve(targetRoot || process.cwd());
  const surfacePaths = surfaces || [
    ".meta-harness/events.jsonl",
    ".meta-harness/workers",
    ".meta-harness/expert-packets",
    ".meta-harness/briefs"
  ];

  const files = [];
  const findings = [];
  for (const surface of surfacePaths) {
    collectSurfaceFiles(root, surface, files, findings);
  }

  for (const file of files) {
    const absolutePath = path.join(root, file);
    const relative = normalizeRelativePath(file);
    const text = fs.readFileSync(absolutePath, "utf8");
    const result = scanTextForSecrets(text, { path: relative });
    findings.push(...result.findings);
  }

  return {
    status: findings.length === 0 ? "PASS" : "FAIL",
    checked: files.length,
    findings
  };
}

module.exports = {
  scanRedactionSurfaces,
  scanTextForSecrets
};
