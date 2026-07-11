"use strict";

/**
 * Hardened scope evaluation over git name-status style changes.
 * Deny overrides allow. Ambiguous path semantics fail closed.
 */

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizePath(p) {
  return String(p || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

function isAmbiguousPath(raw) {
  const s = String(raw || "");
  if (!s || s.trim() === "") return true;
  if (s.includes("\0")) return true;
  if (/^[a-zA-Z]:/.test(s) || s.startsWith("/") || s.startsWith("\\\\")) return true;
  const norm = normalizePath(s);
  if (norm === "" || norm === "." || norm === "..") return true;
  const parts = norm.split("/");
  if (parts.some((part) => part === ".." || part === "")) return true;
  // Control characters
  if (/[\u0000-\u001f\u007f]/.test(s)) return true;
  return false;
}

function globToRegExp(pattern) {
  const normalized = normalizePath(pattern);
  let re = "^";
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];
    if (ch === "*" && normalized[i + 1] === "*") {
      re += ".*";
      i += 1;
      if (normalized[i + 1] === "/") i += 1;
    } else if (ch === "*") {
      re += "[^/]*";
    } else if ("+?^${}()|[]\\.".includes(ch)) {
      re += `\\${ch}`;
    } else {
      re += ch;
    }
  }
  re += "$";
  return new RegExp(re);
}

function matchesAny(patterns, filePath) {
  const path = normalizePath(filePath);
  if (!Array.isArray(patterns) || patterns.length === 0) return false;
  return patterns.some((pat) => globToRegExp(pat).test(path));
}

/**
 * Normalize a git name-status style change into evaluable paths.
 * status: A|M|D|T|R|C|U|?  (U/? are ambiguous)
 * rename/copy must supply path (new) and fromPath (old).
 *
 * @returns {{ path: string, fromPath?: string, status: string, paths: string[] }|null}
 */
function normalizeChange(entry) {
  if (!isPlainObject(entry)) return null;
  const status = String(entry.status || "").toUpperCase();
  const path = entry.path != null ? String(entry.path) : "";
  const fromPath = entry.fromPath != null ? String(entry.fromPath) : undefined;
  const paths = [];
  if (path) paths.push(path);
  if (fromPath) paths.push(fromPath);
  return {
    path,
    fromPath,
    status: status || "?",
    paths,
    raw: entry,
  };
}

function pathsForChange(change) {
  const status = change.status;
  // Rename/copy: both old and new names must be evaluated.
  if (status.startsWith("R") || status.startsWith("C")) {
    return change.paths.slice();
  }
  if (status === "D") {
    return change.path ? [change.path] : change.paths.slice();
  }
  return change.path ? [change.path] : change.paths.slice();
}

/**
 * @param {{ allow: string[], deny: string[] }} scope
 * @param {Array<object>} changes name-status entries
 * @returns {{ allowed: object[], violations: object[], ambiguous: object[] }}
 */
function evaluateScope(scope, changes) {
  const allow = scope && Array.isArray(scope.allow) ? scope.allow : [];
  const deny = scope && Array.isArray(scope.deny) ? scope.deny : [];
  const allowed = [];
  const violations = [];
  const ambiguous = [];

  const list = Array.isArray(changes) ? changes : [];
  for (const entry of list) {
    const change = normalizeChange(entry);
    if (!change) {
      ambiguous.push({ entry, reason: "CHANGE_NOT_OBJECT" });
      continue;
    }
    if (change.status === "U" || change.status === "?" || change.status === "") {
      ambiguous.push({ change, reason: "AMBIGUOUS_STATUS" });
      continue;
    }
    const evalPaths = pathsForChange(change);
    if (evalPaths.length === 0) {
      ambiguous.push({ change, reason: "EMPTY_PATHS" });
      continue;
    }
    if ((change.status.startsWith("R") || change.status.startsWith("C"))
      && (!change.fromPath || !change.path)) {
      ambiguous.push({ change, reason: "RENAME_COPY_NEEDS_BOTH_PATHS" });
      continue;
    }

    let pathAmbiguous = false;
    let denied = false;
    let notAllowed = false;
    for (const p of evalPaths) {
      if (isAmbiguousPath(p)) {
        pathAmbiguous = true;
        break;
      }
      const norm = normalizePath(p);
      // Deny overrides allow.
      if (matchesAny(deny, norm)) {
        denied = true;
        break;
      }
      if (!matchesAny(allow, norm)) {
        notAllowed = true;
      }
    }

    if (pathAmbiguous) {
      ambiguous.push({ change, reason: "AMBIGUOUS_PATH" });
      continue;
    }
    if (denied) {
      violations.push({
        change,
        code: "SCOPE_DENY",
        detail: `denied path(s) in change: ${evalPaths.map(normalizePath).join(" -> ")}`,
      });
      continue;
    }
    if (notAllowed) {
      violations.push({
        change,
        code: "SCOPE_NOT_ALLOWED",
        detail: `path(s) not in allow list: ${evalPaths.map(normalizePath).join(" -> ")}`,
      });
      continue;
    }
    allowed.push({
      ...change,
      paths: evalPaths.map(normalizePath),
    });
  }

  return { allowed, violations, ambiguous };
}

/**
 * Fail-closed summary: ok only when no violations and no ambiguous.
 */
function checkScope(scope, changes) {
  const evaluation = evaluateScope(scope, changes);
  if (evaluation.ambiguous.length > 0) {
    return {
      ok: false,
      code: "SCOPE_AMBIGUOUS",
      detail: "ambiguous path semantics fail closed",
      evaluation,
    };
  }
  if (evaluation.violations.length > 0) {
    return {
      ok: false,
      code: evaluation.violations[0].code,
      detail: evaluation.violations[0].detail,
      evaluation,
    };
  }
  return { ok: true, evaluation };
}

module.exports = {
  normalizePath,
  isAmbiguousPath,
  matchesAny,
  normalizeChange,
  evaluateScope,
  checkScope,
};
