"use strict";

const fs = require("node:fs");
const path = require("node:path");

function readText(targetPath, fallback = "") {
  return fs.existsSync(targetPath) ? fs.readFileSync(targetPath, "utf8") : fallback;
}

function findMatchingBrace(text, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    if (text[index] === "{") {
      depth += 1;
    } else if (text[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function findFunctionRanges(text) {
  const ranges = [];
  const matcher = /function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g;
  let match = matcher.exec(text);
  while (match) {
    const openIndex = text.indexOf("{", match.index);
    const closeIndex = findMatchingBrace(text, openIndex);
    if (closeIndex !== -1) {
      ranges.push({ name: match[1], start: match.index, end: closeIndex });
    }
    match = matcher.exec(text);
  }
  return ranges;
}

function functionNameAt(index, ranges) {
  const range = ranges.find((candidate) => index >= candidate.start && index <= candidate.end);
  return range ? range.name : null;
}

function countProcessExit(text) {
  return [...text.matchAll(/process\.exit\s*\(/g)].length;
}

function countMainBoundaryMissing(text) {
  const lines = text.split(/\r?\n/);
  let count = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*main\s*\(\s*process\.argv/.test(lines[index])) {
      continue;
    }
    const preceding = lines.slice(Math.max(0, index - 4), index).join("\n");
    if (!/\btry\s*\{/.test(preceding)) {
      count += 1;
    }
  }
  return count;
}

function countDirectEventAppends(text, contract) {
  const approvedHelpers = new Set(
    contract.ratchets?.direct_events_jsonl_append?.approved_helpers || ["appendEvent"],
  );
  const ranges = findFunctionRanges(text);
  let count = 0;

  for (const match of text.matchAll(/^.*appendFile(?:Sync)?\s*\(.*events\.jsonl.*$/gm)) {
    const functionName = functionNameAt(match.index, ranges);
    if (!approvedHelpers.has(functionName)) {
      count += 1;
    }
  }

  return count;
}

function extractFunctionBody(text, functionNames) {
  const names = Array.isArray(functionNames) ? functionNames : [functionNames];
  const ranges = findFunctionRanges(text);
  for (const name of names) {
    const range = ranges.find((candidate) => candidate.name === name);
    if (range) {
      return text.slice(range.start, range.end + 1);
    }
  }
  return "";
}

function workerReportFlagSignature(files) {
  const flags = new Set();
  for (const file of files) {
    const body = extractFunctionBody(file.text, ["commandWorkerReport", "runWorkerReport"]);
    for (const match of body.matchAll(/options\.([A-Za-z_$][\w$]*)/g)) {
      flags.add(match[1]);
    }
  }

  const normalized = Array.from(flags).sort();
  return { count: normalized.length, flags: normalized };
}

function commandNamesSignature(files) {
  const commands = new Set();
  for (const file of files) {
    if (file.relative === "lib/command-registry.js") {
      for (const match of file.text.matchAll(/^\s+name:\s*"([^"]+)"/gm)) {
        commands.add(match[1]);
      }
    }
    for (const match of file.text.matchAll(/if\s*\(\s*command\s*===\s*"([^"]+)"/g)) {
      commands.add(match[1]);
    }
  }
  return Array.from(commands).sort();
}

function workerReportRequiredFlagsSignature(files) {
  const flags = new Set();
  for (const file of files) {
    const body = extractFunctionBody(file.text, ["commandWorkerReport", "runWorkerReport"]);
    for (const match of body.matchAll(/requires --([a-z0-9-]+)/g)) {
      flags.add(`--${match[1]}`);
    }
  }
  return Array.from(flags).sort();
}

function outputTopFieldsSignature(files) {
  for (const file of files) {
    const match = file.text.match(/const report = `([\s\S]*?)## What changed/);
    if (!match) {
      continue;
    }
    return match[1]
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^[A-Za-z][A-Za-z ]+:/.test(line))
      .map((line) => line.split(":")[0])
      .sort();
  }
  return [];
}

function templatePrimarySkeletonSignature(rootPath) {
  const templatePath = path.join(rootPath, "templates", "contracts", "worker-done-contract.md");
  return readText(templatePath)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(Outcome|Round|Progress|Confidence):/.test(line) || /^## /.test(line))
    .sort();
}

function compatibilitySignature(rootPath, files) {
  return {
    command_names: commandNamesSignature(files),
    required_flags: workerReportRequiredFlagsSignature(files),
    output_top_fields: outputTopFieldsSignature(files),
    template_primary_skeleton: templatePrimarySkeletonSignature(rootPath),
  };
}

module.exports = {
  compatibilitySignature,
  countDirectEventAppends,
  countMainBoundaryMissing,
  countProcessExit,
  workerReportFlagSignature,
};
