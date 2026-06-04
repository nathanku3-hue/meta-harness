"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_HARNESS_DIR = ".meta-harness";
const QUALITY_CONTRACT_FILE = "clean-code-contract.json";
const QUALITY_BASELINE_FILE = path.join("baseline", "quality-baseline.json");
const CONTRACT_TEMPLATE_PATH = path.resolve(__dirname, "..", "templates", "contracts", QUALITY_CONTRACT_FILE);
const EXCLUDED_DIRS = new Set([".git", "node_modules", ".meta-harness", "tmp", "dist", "build", "coverage"]);
const SOURCE_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx", ".py", ".rb", ".go", ".rs", ".java", ".cs", ".php"]);

function fileExists(targetPath) { return fs.existsSync(targetPath); }

function ensureDir(targetPath) { fs.mkdirSync(targetPath, { recursive: true }); }

function readText(targetPath, fallback = "") {
  return fileExists(targetPath) ? fs.readFileSync(targetPath, "utf8") : fallback;
}

function readJson(targetPath) { return JSON.parse(fs.readFileSync(targetPath, "utf8")); }

function writeJson(targetPath, value) {
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(`${targetPath}.tmp`, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(`${targetPath}.tmp`, targetPath);
}

function toSlash(value) { return value.split(path.sep).join("/"); }

function relativePath(targetPath, rootPath) { return toSlash(path.relative(rootPath, targetPath)); }

function qualityContractPath(rootPath, harnessDir = DEFAULT_HARNESS_DIR) { return path.join(rootPath, harnessDir, QUALITY_CONTRACT_FILE); }

function qualityBaselinePath(rootPath, harnessDir = DEFAULT_HARNESS_DIR) { return path.join(rootPath, harnessDir, QUALITY_BASELINE_FILE); }

function defaultQualityContract() { return readJson(CONTRACT_TEMPLATE_PATH); }

function readQualityContract(rootPath, harnessDir = DEFAULT_HARNESS_DIR) {
  const contractPath = qualityContractPath(rootPath, harnessDir);
  if (!fileExists(contractPath)) {
    throw new Error("quality contract missing; run meta-harness quality init");
  }
  return readJson(contractPath);
}

function writeDefaultQualityContract(rootPath, harnessDir = DEFAULT_HARNESS_DIR) {
  const contractPath = qualityContractPath(rootPath, harnessDir);
  if (!fileExists(contractPath)) {
    writeJson(contractPath, defaultQualityContract());
    return { path: contractPath, created: true };
  }
  return { path: contractPath, created: false };
}

function sourceLineCount(text) {
  if (text.length === 0) {
    return 0;
  }
  const lines = text.split(/\r?\n/).length;
  return text.endsWith("\n") || text.endsWith("\r\n") ? lines - 1 : lines;
}

function excludedDirNames(contract) { return new Set([...(contract.excluded_dirs || []), ...EXCLUDED_DIRS]); }

function isSourceFile(targetPath) { return SOURCE_EXTENSIONS.has(path.extname(targetPath)); }

function qualitySourceFiles(rootPath, contract, currentPath = rootPath, collected = []) {
  const excluded = excludedDirNames(contract);
  const entries = fs.readdirSync(currentPath, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!excluded.has(entry.name)) {
        qualitySourceFiles(rootPath, contract, path.join(currentPath, entry.name), collected);
      }
      continue;
    }

    if (entry.isFile()) {
      const fullPath = path.join(currentPath, entry.name);
      if (isSourceFile(fullPath)) {
        collected.push(fullPath);
      }
    }
  }

  return collected;
}

function findFunctionRanges(text) {
  const ranges = [];
  const matcher = /function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g;
  let match = matcher.exec(text);
  while (match) {
    const name = match[1];
    const openIndex = text.indexOf("{", match.index);
    const closeIndex = findMatchingBrace(text, openIndex);
    if (closeIndex !== -1) {
      ranges.push({ name, start: match.index, end: closeIndex });
    }
    match = matcher.exec(text);
  }
  return ranges;
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

function extractFunctionBody(text, functionName) {
  const range = findFunctionRanges(text).find((candidate) => candidate.name === functionName);
  if (!range) {
    return "";
  }
  return text.slice(range.start, range.end + 1);
}

function workerReportFlagSignature(files) {
  const flags = new Set();
  for (const file of files) {
    const body = extractFunctionBody(file.text, "commandWorkerReport");
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
    for (const match of file.text.matchAll(/if\s*\(\s*command\s*===\s*"([^"]+)"/g)) {
      commands.add(match[1]);
    }
  }
  return Array.from(commands).sort();
}

function workerReportRequiredFlagsSignature(files) {
  const flags = new Set();
  for (const file of files) {
    const body = extractFunctionBody(file.text, "commandWorkerReport");
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

function analyzeQuality(rootPath, contract = defaultQualityContract()) {
  const maxLines = contract.budgets?.max_source_file_lines || 500;
  const sourceFiles = qualitySourceFiles(rootPath, contract).map((fullPath) => {
    const text = readText(fullPath);
    const lines = sourceLineCount(text);
    return {
      fullPath,
      relative: relativePath(fullPath, rootPath),
      text,
      lines,
      overbudget: lines > maxLines,
    };
  });

  const processExitCount = sourceFiles.reduce((total, file) => total + countProcessExit(file.text), 0);
  const mainBoundaryMissingCount = sourceFiles.reduce((total, file) => total + countMainBoundaryMissing(file.text), 0);
  const directEventAppendCount = sourceFiles.reduce(
    (total, file) => total + countDirectEventAppends(file.text, contract),
    0,
  );

  return {
    files: sourceFiles.map(({ relative, lines, overbudget }) => ({ relative, lines, overbudget })),
    ratchets: {
      process_exit: { count: processExitCount },
      main_boundary_missing: { count: mainBoundaryMissingCount },
      direct_events_jsonl_append: { count: directEventAppendCount },
      worker_report_flags: workerReportFlagSignature(sourceFiles),
    },
    compatibility: compatibilitySignature(rootPath, sourceFiles),
  };
}

function createBaseline(rootPath, contract) {
  const analysis = analyzeQuality(rootPath, contract);
  return {
    v: 1,
    generated_at: new Date().toISOString(),
    mode: contract.mode || "ratchet",
    budgets: contract.budgets || {},
    files: Object.fromEntries(
      analysis.files.map((file) => [
        file.relative,
        {
          lines: file.lines,
          overbudget: file.overbudget,
        },
      ]),
    ),
    ratchets: analysis.ratchets,
    compatibility: analysis.compatibility,
  };
}

function writeQualityBaseline(rootPath, contract, harnessDir = DEFAULT_HARNESS_DIR) {
  const baseline = createBaseline(rootPath, contract);
  writeJson(qualityBaselinePath(rootPath, harnessDir), baseline);
  return baseline;
}

function readQualityBaseline(rootPath, harnessDir = DEFAULT_HARNESS_DIR) {
  const baselinePath = qualityBaselinePath(rootPath, harnessDir);
  if (!fileExists(baselinePath)) {
    throw new Error("quality baseline missing; run meta-harness quality baseline");
  }
  return readJson(baselinePath);
}

function arraysEqual(left = [], right = []) {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function hasMigrationNote(rootPath) {
  return [
    "MIGRATION.md",
    "migration-note.md",
    path.join(".meta-harness", "migration-note.md"),
    path.join("docs", "migration-note.md"),
    path.join("docs", "product", "migration-note.md"),
  ].some((candidate) => fileExists(path.join(rootPath, candidate)));
}

function blockFinding(kind, message, file = undefined) { return { severity: "BLOCK", kind, message, file }; }

function compareQualityToBaseline(analysis, baseline, contract, rootPath) {
  const findings = [];
  const baselineFiles = baseline.files || {};

  for (const file of analysis.files) {
    const previous = baselineFiles[file.relative];
    if (!previous && file.overbudget) {
      findings.push(blockFinding("new_overbudget_file", `new overbudget file: ${file.relative} has ${file.lines} lines`, file.relative));
      continue;
    }

    if (previous?.overbudget && file.lines > previous.lines) {
      findings.push(blockFinding(
        "grandfathered_file_grew",
        `grandfathered file grew: ${file.relative} increased from ${previous.lines} to ${file.lines} lines`,
        file.relative,
      ));
      continue;
    }

    if (previous && !previous.overbudget && file.overbudget) {
      findings.push(blockFinding("file_crossed_line_budget", `file crossed line budget: ${file.relative} has ${file.lines} lines`, file.relative));
    }
  }

  compareRatchetCount(findings, analysis, baseline, "process_exit", "process.exit count increased");
  compareRatchetCount(findings, analysis, baseline, "main_boundary_missing", "main() without boundary handler count increased");
  compareRatchetCount(
    findings,
    analysis,
    baseline,
    "direct_events_jsonl_append",
    "direct events.jsonl append count increased outside approved helper",
  );
  compareWorkerReportFlags(findings, analysis, baseline, contract);
  compareCompatibility(findings, analysis, baseline, rootPath);

  return {
    pass: findings.length === 0,
    mode: contract.mode || "ratchet",
    findings,
    analysis,
  };
}

function compareRatchetCount(findings, analysis, baseline, key, message) {
  const current = analysis.ratchets?.[key]?.count || 0;
  const previous = baseline.ratchets?.[key]?.count || 0;
  if (current > previous) {
    findings.push(blockFinding(key, `${message}: ${previous} -> ${current}`));
  }
}

function compareWorkerReportFlags(findings, analysis, baseline, contract) {
  const current = analysis.ratchets?.worker_report_flags || { count: 0, flags: [] };
  const previous = baseline.ratchets?.worker_report_flags || { count: 0, flags: [] };
  const requiredEscapeFlags = contract.ratchets?.worker_report_flags?.must_not_increase_without || ["--from", "--input"];
  const hasEscapeFlag = requiredEscapeFlags.some((flag) => current.flags.includes(flag.replace(/^--/, "")));

  if (current.count > previous.count && !hasEscapeFlag) {
    findings.push(blockFinding(
      "worker_report_flags",
      `worker-report option signature grew without ${requiredEscapeFlags.join(" or ")}: ${previous.count} -> ${current.count}`,
    ));
  }
}

function compareCompatibility(findings, analysis, baseline, rootPath) {
  const previous = baseline.compatibility || {};
  const current = analysis.compatibility || {};
  const keys = ["command_names", "required_flags", "output_top_fields", "template_primary_skeleton"];
  const changed = keys.filter((key) => !arraysEqual(current[key] || [], previous[key] || []));

  if (changed.length > 0 && !hasMigrationNote(rootPath)) {
    findings.push(blockFinding(
      "compatibility_signature",
      `exact compatibility signature changed without migration note: ${changed.join(", ")}`,
    ));
  }
}

function renderQualityResult(result) {
  const lines = [`Quality gate: ${result.pass ? "PASS" : "BLOCK"}`, `Mode: ${result.mode}`, "", "Findings:"];

  if (result.findings.length === 0) {
    lines.push("- none");
  } else {
    for (const finding of result.findings) {
      lines.push(`- [${finding.severity}] ${finding.message}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function renderQualityExplain(contract = defaultQualityContract()) {
  return [
    "Clean-Code Governor",
    "",
    `Mode: ${contract.mode || "ratchet"}`,
    "",
    "Ratchet policy:",
    "- existing debt may be grandfathered",
    "- new debt is blocked",
    "- touched grandfathered debt must not get worse",
    "- compatibility-breaking CLI or report behavior requires a migration note and approval",
    "",
    "Default exclusions:",
    ...Array.from(excludedDirNames(contract)).sort().map((dirname) => `- ${dirname}/`),
    "",
  ].join("\n");
}

function hasFlag(argv, flag) { return argv.includes(flag); }

function commandQuality(argv, context = {}) {
  const [action] = argv;
  const rootPath = context.cwd || process.cwd();
  const harnessDir = context.harnessDir || DEFAULT_HARNESS_DIR;
  const fail = context.fail || ((message) => { throw new Error(message); });
  const displayPath = context.relativePath || ((targetPath) => relativePath(targetPath, rootPath));

  try {
    if (action === "init") {
      const contract = writeDefaultQualityContract(rootPath, harnessDir);
      const loadedContract = readQualityContract(rootPath, harnessDir);
      const baselinePath = qualityBaselinePath(rootPath, harnessDir);
      console.log(`${contract.created ? "Created" : "Kept"} ${displayPath(contract.path)}`);
      if (fileExists(baselinePath)) {
        console.log(`Kept ${displayPath(baselinePath)}`);
      } else {
        writeQualityBaseline(rootPath, loadedContract, harnessDir);
        console.log(`Created ${displayPath(baselinePath)}`);
      }
      return;
    }

    if (action === "baseline") {
      if (!hasFlag(argv, "--force")) {
        fail("quality baseline requires --force after audit; normal patch work should fix findings");
        return;
      }
      const contract = readQualityContract(rootPath, harnessDir);
      writeQualityBaseline(rootPath, contract, harnessDir);
      console.log(`Updated ${displayPath(qualityBaselinePath(rootPath, harnessDir))}`);
      return;
    }

    if (action === "check") {
      const contract = readQualityContract(rootPath, harnessDir);
      const baseline = readQualityBaseline(rootPath, harnessDir);
      const result = compareQualityToBaseline(analyzeQuality(rootPath, contract), baseline, contract, rootPath);
      process.stdout.write(renderQualityResult(result));
      if (!result.pass) {
        fail("quality gate failed");
      }
      return;
    }

    if (action === "explain") {
      const contract = fileExists(qualityContractPath(rootPath, harnessDir))
        ? readQualityContract(rootPath, harnessDir)
        : defaultQualityContract();
      process.stdout.write(renderQualityExplain(contract));
      return;
    }

    fail(`unknown quality action: ${action || "missing"}`);
  } catch (error) {
    fail(error.message);
  }
}

module.exports = { analyzeQuality, commandQuality, compareQualityToBaseline, createBaseline, defaultQualityContract, qualityBaselinePath, qualityContractPath, readQualityBaseline, readQualityContract, renderQualityExplain, renderQualityResult, writeDefaultQualityContract, writeQualityBaseline };
