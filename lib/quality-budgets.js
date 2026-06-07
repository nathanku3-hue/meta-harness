"use strict";

const path = require("node:path");

const CATEGORY_RULES = [
  {
    category: "bin_entrypoint",
    key: "max_bin_entrypoint_lines",
    matches: (relative) => /^bin\/[^/]+\.js$/.test(relative),
  },
  {
    category: "command_module",
    key: "max_command_module_lines",
    matches: (relative) => /^lib\/commands\/[^/]+\.js$/.test(relative),
  },
  {
    category: "cli_test_file",
    key: "max_cli_test_file_lines",
    matches: (relative) => /^tests\/cli-.*\.test\.js$/.test(relative),
  },
  {
    category: "test_helper",
    key: "max_test_helper_lines",
    matches: (relative) => /^tests\/helpers\/.*\.js$/.test(relative),
  },
];

function fileBudget(relative, contract, fallbackMaxLines) {
  const normalized = relative.split(path.sep).join("/");
  for (const rule of CATEGORY_RULES) {
    if (rule.matches(normalized) && Number.isInteger(contract.budgets?.[rule.key])) {
      return {
        category: rule.category,
        key: rule.key,
        maxLines: contract.budgets[rule.key],
      };
    }
  }
  return {
    category: "source",
    key: "max_source_file_lines",
    maxLines: fallbackMaxLines,
  };
}

function resolveRelativeImport(sourceRelative, specifier) {
  if (!specifier.startsWith(".")) {
    return null;
  }
  return path.posix.normalize(path.posix.join(path.posix.dirname(sourceRelative), specifier));
}

function importBoundaryViolations(files) {
  const violations = [];
  for (const file of files) {
    const source = file.relative.split(path.sep).join("/");
    for (const match of file.text.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) {
      const target = resolveRelativeImport(source, match[1]);
      if (!target) {
        continue;
      }
      if (source.startsWith("lib/") && target.startsWith("bin/")) {
        violations.push({ file: source, message: `${source} imports bin/ code` });
      }
      if (source.startsWith("lib/") && !source.startsWith("lib/commands/") && target.startsWith("lib/commands")) {
        violations.push({ file: source, message: `${source} imports lib/commands/ code` });
      }
    }
  }
  return violations;
}

module.exports = { fileBudget, importBoundaryViolations };
