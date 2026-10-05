"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { HARNESS_DIR, readText } = require("./paths");
const { parseIsoDate, parseJsonSafe, slashPath } = require("./context-gate-utils");

function sectionAfterLabel(text, label) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const labelPattern = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*$`, "i");
  const headingPattern = /^[A-Z][A-Za-z0-9 /_-]{1,60}\s*:\s*$/;
  const start = lines.findIndex((line) => labelPattern.test(line.trim()));
  if (start === -1) {
    return "";
  }

  const body = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (body.length > 0 && headingPattern.test(line.trim())) {
      break;
    }
    body.push(line);
  }
  return body.join("\n").trim();
}

function hasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function listFiles(root, relativeDir, options = {}) {
  const directory = path.join(root, relativeDir);
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    return [];
  }
  const extensions = options.extensions || [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(relativeDir, entry.name))
    .filter((item) => extensions.length === 0 || extensions.includes(path.extname(item).toLowerCase()))
    .map((item) => slashPath(item))
    .sort((left, right) => left.localeCompare(right));
}

function readEvents(cwd) {
  const eventsPath = path.join(cwd, HARNESS_DIR, "events.jsonl");
  if (!fs.existsSync(eventsPath)) {
    return [];
  }
  return fs.readFileSync(eventsPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (_) {
        return undefined;
      }
    })
    .filter(Boolean)
    .slice(-5);
}

function readHarnessState(cwd) {
  const statusPath = path.join(cwd, HARNESS_DIR, "status.md");
  const phaseMapPath = path.join(cwd, HARNESS_DIR, "phase-map.md");
  const decisionLogPath = path.join(cwd, "docs", "product", "decision-log.md");
  const packagePath = path.join(cwd, "package.json");
  const pyprojectPath = path.join(cwd, "pyproject.toml");
  const securityPolicyPath = path.join(cwd, HARNESS_DIR, "security-policy.json");

  const packageJson = fs.existsSync(packagePath) ? parseJsonSafe(packagePath) : undefined;
  const securityPolicy = fs.existsSync(securityPolicyPath) ? parseJsonSafe(securityPolicyPath) : undefined;

  return {
    cwd,
    statusText: readText(statusPath, ""),
    phaseMapText: readText(phaseMapPath, ""),
    decisionLogText: readText(decisionLogPath, ""),
    readmeText: readText(path.join(cwd, "README.md"), ""),
    pyprojectText: readText(pyprojectPath, ""),
    packageJson,
    securityPolicy,
    events: readEvents(cwd),
    workerFiles: listFiles(cwd, path.join(HARNESS_DIR, "workers"), { extensions: [".md", ".json"] }),
    expertPacketFiles: listFiles(cwd, path.join(HARNESS_DIR, "expert-packets"), { extensions: [".zip", ".md", ".json"] }),
    files: {
      status: fs.existsSync(statusPath),
      phaseMap: fs.existsSync(phaseMapPath),
      decisionLog: fs.existsSync(decisionLogPath),
      packageJson: fs.existsSync(packagePath),
      pyproject: fs.existsSync(pyprojectPath),
      securityPolicy: fs.existsSync(securityPolicyPath),
      readme: fs.existsSync(path.join(cwd, "README.md")),
    },
  };
}

function statusDate(state) {
  const updated = sectionAfterLabel(state.statusText, "Updated");
  const match = updated.match(/\b[0-9]{4}-[0-9]{2}-[0-9]{2}(?:T[0-9:.+-]+Z?)?\b/);
  return match ? parseIsoDate(match[0]) : undefined;
}

function eventDates(state) {
  return state.events
    .map((event) => parseIsoDate(event.ts || event.time))
    .filter(Boolean);
}

function latestDate(dates) {
  return dates.reduce((latest, date) => {
    if (!latest || date.getTime() > latest.getTime()) {
      return date;
    }
    return latest;
  }, undefined);
}

module.exports = {
  eventDates,
  hasAny,
  latestDate,
  readHarnessState,
  sectionAfterLabel,
  statusDate,
};
