"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { contractError, immutable } = require("./contract-utils");

const RETIRED_PACKAGE_PATHS = Object.freeze(new Set([
  "lib/contracts/attempt-authorization.js",
  "lib/contracts/authorize.js",
  "lib/contracts/execution-readiness-facts.js",
  "lib/contracts/implementation-assessment.js",
  "lib/contracts/implementation-facts.js",
  "lib/contracts/retired-contract.js",
  "lib/contracts/run-spec-approval.js",
  "lib/contracts/workspace-attestation.js",
  "lib/contracts/workspace-start.js",
  "lib/execution-custody/agent-custody.js",
  "lib/execution-custody/agent-process.js",
  "lib/execution-custody/attempt.js",
  "lib/execution-custody/change-artifact.js",
  "lib/execution-custody/controller-process.js",
  "lib/execution-custody/custody-export.js",
  "lib/execution-custody/custody-replay.js",
  "lib/execution-custody/execution-bindings.js",
  "lib/execution-custody/git-ops.js",
  "lib/execution-custody/implement.js",
  "lib/execution-custody/portable-verifier.js",
  "lib/execution-custody/retired-runtime.js",
  "lib/execution-custody/terminal-evidence.js",
  "lib/release-check.js",
  "lib/release-package-check.js",
  "lib/truth-authority-contract.js",
  "lib/truth-authority.js",
  "lib/truth-mutation.js",
]));

function toPackagePath(value) {
  return String(value).split(path.sep).join("/").replace(/^\.\//, "");
}

function staticRelativeRequires(source) {
  const text = String(source);
  const requests = [];
  let index = 0;
  let state = "code";
  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];
    if (state === "line-comment") {
      if (char === "\n") state = "code";
      index += 1;
      continue;
    }
    if (state === "block-comment") {
      if (char === "*" && next === "/") {
        state = "code";
        index += 2;
      } else index += 1;
      continue;
    }
    if (state === "single" || state === "double" || state === "template") {
      const quote = state === "single" ? "'" : state === "double" ? "\"" : "`";
      if (char === "\\") index += 2;
      else if (char === quote) {
        state = "code";
        index += 1;
      } else index += 1;
      continue;
    }
    if (char === "/" && next === "/") {
      state = "line-comment";
      index += 2;
      continue;
    }
    if (char === "/" && next === "*") {
      state = "block-comment";
      index += 2;
      continue;
    }
    if (char === "'") {
      state = "single";
      index += 1;
      continue;
    }
    if (char === "\"") {
      state = "double";
      index += 1;
      continue;
    }
    if (char === "`") {
      state = "template";
      index += 1;
      continue;
    }
    if (text.startsWith("require", index)
      && !/[A-Za-z0-9_$]/.test(text[index - 1] || "")
      && !/[A-Za-z0-9_$]/.test(text[index + 7] || "")) {
      let cursor = index + 7;
      while (/\s/.test(text[cursor] || "")) cursor += 1;
      if (text[cursor] !== "(") {
        index += 7;
        continue;
      }
      cursor += 1;
      while (/\s/.test(text[cursor] || "")) cursor += 1;
      const quote = text[cursor];
      if (quote !== "'" && quote !== "\"") {
        index += 7;
        continue;
      }
      cursor += 1;
      let request = "";
      let valid = true;
      while (cursor < text.length && text[cursor] !== quote) {
        if (text[cursor] === "\\") {
          valid = false;
          break;
        }
        request += text[cursor];
        cursor += 1;
      }
      if (valid && text[cursor] === quote) {
        cursor += 1;
        while (/\s/.test(text[cursor] || "")) cursor += 1;
        if (text[cursor] === ")" && request.startsWith(".")) requests.push(request);
      }
      index = cursor + 1;
      continue;
    }
    index += 1;
  }
  return Object.freeze([...new Set(requests)].sort());
}

function existingFile(candidate) {
  try {
    return fs.statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

function resolveRelativeRequire(packageRoot, importerPath, request) {
  const base = path.resolve(path.dirname(importerPath), request);
  const root = fs.realpathSync(packageRoot);
  const relativeBase = path.relative(root, base);
  if (relativeBase === ".." || relativeBase.startsWith(`..${path.sep}`) || path.isAbsolute(relativeBase)) {
    throw contractError("PACKAGE_CLOSURE_ESCAPE", `relative require escapes the package root: ${request}`);
  }
  const candidates = [base, `${base}.js`, `${base}.json`];
  try {
    if (fs.statSync(base).isDirectory()) {
      const packageJsonPath = path.join(base, "package.json");
      if (existingFile(packageJsonPath)) {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
        if (typeof packageJson.main === "string" && packageJson.main.length > 0) {
          const mainBase = path.resolve(base, packageJson.main);
          candidates.push(mainBase, `${mainBase}.js`, `${mainBase}.json`);
        }
      }
      candidates.push(path.join(base, "index.js"), path.join(base, "index.json"));
    }
  } catch {
    // File candidates below provide the stable unresolved result.
  }
  for (const candidate of candidates) {
    const found = existingFile(candidate);
    if (found) return found;
  }
  throw contractError(
    "PACKAGE_CLOSURE_TARGET_MISSING",
    `static relative require cannot be resolved from source: ${toPackagePath(path.relative(packageRoot, importerPath))} -> ${request}`,
  );
}

function verifyPackageClosure({ packageRoot, packedFiles }) {
  const root = fs.realpathSync(packageRoot);
  const files = new Set(packedFiles.map(toPackagePath));
  const javascriptFiles = [...files].filter((entry) => entry.endsWith(".js")).sort();
  const edges = [];
  for (const importer of javascriptFiles) {
    const importerPath = path.join(root, importer);
    if (!existingFile(importerPath)) {
      throw contractError("PACKAGE_CLOSURE_ENTRY_MISSING", `packed JavaScript entry is absent from source: ${importer}`);
    }
    for (const request of staticRelativeRequires(fs.readFileSync(importerPath, "utf8"))) {
      const targetPath = resolveRelativeRequire(root, importerPath, request);
      const target = toPackagePath(path.relative(root, targetPath));
      if (RETIRED_PACKAGE_PATHS.has(target)) {
        throw contractError(
          "PACKAGE_CLOSURE_RETIRED_IMPORT",
          `packed runtime imports an excluded retired surface: ${importer} -> ${target}`,
        );
      }
      if (!files.has(target)) {
        throw contractError(
          "PACKAGE_CLOSURE_DEPENDENCY_MISSING",
          `packed runtime dependency is absent from the tarball: ${importer} -> ${target}`,
        );
      }
      edges.push(Object.freeze({ importer, request, target }));
    }
  }
  return immutable({
    javascriptEntryCount: javascriptFiles.length,
    staticRelativeDependencyCount: edges.length,
    javascriptFiles,
    edges,
  });
}

module.exports = {
  RETIRED_PACKAGE_PATHS,
  resolveRelativeRequire,
  staticRelativeRequires,
  verifyPackageClosure,
};
