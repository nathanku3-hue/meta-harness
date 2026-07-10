"use strict";

/**
 * Minimal path-glob matching for scope allow/deny.
 * Patterns use / separators; supports * and **.
 */
function normalizePath(p) {
  return String(p || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/");
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
 * Scope rule: path must match at least one allow and no deny.
 * @returns {{ ok: boolean, code?: string, detail?: string }}
 */
function checkPathInScope(scope, filePath) {
  const path = normalizePath(filePath);
  if (!path) {
    return { ok: false, code: "SCOPE_EMPTY_PATH", detail: "changed file path is empty" };
  }
  const allow = scope && Array.isArray(scope.allow) ? scope.allow : [];
  const deny = scope && Array.isArray(scope.deny) ? scope.deny : [];
  if (matchesAny(deny, path)) {
    return {
      ok: false,
      code: "SCOPE_DENY",
      detail: `path denied by scope: ${path}`,
    };
  }
  if (!matchesAny(allow, path)) {
    return {
      ok: false,
      code: "SCOPE_NOT_ALLOWED",
      detail: `path not in allow list: ${path}`,
    };
  }
  return { ok: true };
}

module.exports = {
  normalizePath,
  matchesAny,
  checkPathInScope,
};
