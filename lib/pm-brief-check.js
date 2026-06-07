"use strict";

const fs = require("node:fs");
const path = require("node:path");

const REQUIRED_SECTIONS = ["## Decisions", "## Blockers", "## Evidence"];
const ALLOWED_HEADINGS = new Set(["# PM Brief", ...REQUIRED_SECTIONS]);

function toSlash(value) {
  return value.split(path.sep).join("/");
}

function relativePath(root, targetPath) {
  return toSlash(path.relative(root, targetPath));
}

function safeLstat(targetPath) {
  try {
    return { status: "ok", stat: fs.lstatSync(targetPath) };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { status: "missing" };
    }
    return { status: "error", error };
  }
}

function readUtf8(targetPath) {
  try {
    return { status: "ok", text: fs.readFileSync(targetPath, "utf8") };
  } catch (error) {
    return { status: "error", error };
  }
}

function readDirectory(targetPath) {
  try {
    return { status: "ok", entries: fs.readdirSync(targetPath).sort((left, right) => left.localeCompare(right)) };
  } catch (error) {
    return { status: "error", error };
  }
}

function errorDetail(prefix, error) {
  return `${prefix}: ${error && error.code ? error.code : "unreadable"}`;
}

function parseFenceOpen(line) {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
  if (!match) {
    return undefined;
  }
  return { marker: match[1][0], length: match[1].length };
}

function isFenceClose(line, fence) {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
  return Boolean(match && match[1][0] === fence.marker && match[1].length >= fence.length);
}

function headingLine(line) {
  return /^ {0,3}#{1,6}\s+/.test(line) ? line : undefined;
}

function isSetextUnderline(line) {
  return /^ {0,3}(=+|-+)\s*$/.test(line);
}

function isSetextCandidate(line) {
  return (
    line.trim().length > 0
    && !headingLine(line)
    && !parseFenceOpen(line)
    && !/^ {0,3}([-*+]\s+|\d+[.)]\s+)/.test(line)
  );
}

function firstNonEmptyLine(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim().length > 0) {
      return { index, line: lines[index] };
    }
  }
  return undefined;
}

function countSections(sections) {
  const counts = new Map(REQUIRED_SECTIONS.map((section) => [section, 0]));
  for (const section of sections) {
    counts.set(section, (counts.get(section) || 0) + 1);
  }
  return counts;
}

function validateBriefText(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  const first = firstNonEmptyLine(lines);
  const problems = [];
  const sections = [];
  let fence;
  let h1Count = 0;
  let setextCandidate;

  if (!first || first.line !== "# PM Brief") {
    problems.push({ status: "REJECTED", detail: "first non-empty line must be # PM Brief" });
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (fence) {
      if (isFenceClose(line, fence)) {
        fence = undefined;
      }
      setextCandidate = undefined;
      continue;
    }

    const fenceOpen = parseFenceOpen(line);
    if (fenceOpen) {
      fence = fenceOpen;
      setextCandidate = undefined;
      continue;
    }

    if (setextCandidate && isSetextUnderline(line)) {
      problems.push({ status: "REJECTED", detail: `unexpected heading: ${setextCandidate.trim()}` });
      setextCandidate = undefined;
      continue;
    }

    const heading = headingLine(line);
    if (!heading) {
      setextCandidate = isSetextCandidate(line) ? line : undefined;
      continue;
    }
    setextCandidate = undefined;
    if (!ALLOWED_HEADINGS.has(heading)) {
      problems.push({ status: "REJECTED", detail: `unexpected heading: ${heading}` });
      continue;
    }
    if (heading === "# PM Brief") {
      h1Count += 1;
      if (h1Count > 1 || !first || index !== first.index) {
        problems.push({ status: "REJECTED", detail: "duplicate or misplaced H1: # PM Brief" });
      }
      continue;
    }
    sections.push(heading);
  }

  if (fence) {
    problems.push({ status: "MALFORMED", detail: "malformed: unclosed fenced code block" });
  }

  const counts = countSections(sections);
  let countProblem = false;
  for (const section of REQUIRED_SECTIONS) {
    const count = counts.get(section) || 0;
    if (count === 0) {
      countProblem = true;
      problems.push({ status: "REJECTED", detail: `missing required section: ${section}` });
    } else if (count > 1) {
      countProblem = true;
      problems.push({ status: "REJECTED", detail: `duplicate required section: ${section}` });
    }
  }

  if (!countProblem) {
    for (let index = 0; index < REQUIRED_SECTIONS.length; index += 1) {
      if (sections[index] !== REQUIRED_SECTIONS[index]) {
        problems.push({
          status: "REJECTED",
          detail: `required sections out of order: ${REQUIRED_SECTIONS.join(" -> ")}`,
        });
        break;
      }
    }
  }

  return problems;
}

function scanBriefFile(resolvedTarget, filePath, relative, items) {
  const statResult = safeLstat(filePath);
  if (statResult.status === "missing") {
    return 0;
  }
  if (statResult.status === "error") {
    items.push({ status: "UNREADABLE", path: relative, detail: errorDetail("unreadable brief surface", statResult.error) });
    return 1;
  }
  if (statResult.stat.isSymbolicLink() || !statResult.stat.isFile()) {
    items.push({ status: "REJECTED", path: relative, detail: "brief surface is not a regular file" });
    return 1;
  }

  const readResult = readUtf8(filePath);
  if (readResult.status === "error") {
    items.push({ status: "UNREADABLE", path: relative, detail: errorDetail("unreadable brief file", readResult.error) });
    return 1;
  }

  const problems = validateBriefText(readResult.text);
  if (problems.length === 0) {
    items.push({ status: "PASS", path: relative });
    return 1;
  }
  for (const problem of problems) {
    items.push({ status: problem.status, path: relative, detail: problem.detail });
  }
  return 1;
}

function scanBriefsDirectory(resolvedTarget, briefsRoot, items) {
  const relative = ".meta-harness/briefs";
  const statResult = safeLstat(briefsRoot);
  if (statResult.status === "missing") {
    return 0;
  }
  if (statResult.status === "error") {
    items.push({ status: "UNREADABLE", path: relative, detail: errorDetail("unreadable briefs directory", statResult.error) });
    return 1;
  }
  if (statResult.stat.isSymbolicLink() || !statResult.stat.isDirectory()) {
    items.push({ status: "REJECTED", path: relative, detail: "briefs surface is not a real directory" });
    return 1;
  }

  const directory = readDirectory(briefsRoot);
  if (directory.status === "error") {
    items.push({ status: "UNREADABLE", path: relative, detail: errorDetail("unreadable briefs directory", directory.error) });
    return 1;
  }

  let checked = 0;
  for (const entry of directory.entries) {
    if (!entry.endsWith(".md")) {
      continue;
    }
    const filePath = path.join(briefsRoot, entry);
    checked += scanBriefFile(resolvedTarget, filePath, relativePath(resolvedTarget, filePath), items);
  }
  return checked;
}

function scanPmBrief({ targetRoot }) {
  const resolvedTarget = path.resolve(targetRoot);
  const harnessRoot = path.join(resolvedTarget, ".meta-harness");
  const items = [];
  let checked = 0;

  const harnessStat = safeLstat(harnessRoot);
  if (harnessStat.status === "missing") {
    return { status: "PASS", checked: 0, items: [] };
  }
  if (harnessStat.status === "error") {
    return {
      status: "FAIL",
      checked: 1,
      items: [{ status: "UNREADABLE", path: ".meta-harness", detail: errorDetail("unreadable harness directory", harnessStat.error) }],
    };
  }
  if (harnessStat.stat.isSymbolicLink() || !harnessStat.stat.isDirectory()) {
    return {
      status: "FAIL",
      checked: 1,
      items: [{ status: "REJECTED", path: ".meta-harness", detail: "brief root is not a real directory" }],
    };
  }

  checked += scanBriefFile(
    resolvedTarget,
    path.join(harnessRoot, "pm-brief.md"),
    ".meta-harness/pm-brief.md",
    items,
  );
  checked += scanBriefsDirectory(resolvedTarget, path.join(harnessRoot, "briefs"), items);

  return {
    status: items.some((item) => item.status !== "PASS") ? "FAIL" : "PASS",
    checked,
    items,
  };
}

module.exports = { scanPmBrief };
