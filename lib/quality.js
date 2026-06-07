"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ConfigError, UsageError } = require("./errors");
const { fileBudget, importBoundaryViolations } = require("./quality-budgets");
const {
  analyzeComplexity,
  baselineComplexitySnapshot,
  baselineHash,
  compareComplexityToBaseline,
  currentSourceCommit,
  defaultComplexityPolicy,
  isGitClean,
  validateDecisionId,
} = require("./quality-complexity");
const {
  compatibilitySignature,
  countDirectEventAppends,
  countMainBoundaryMissing,
  countProcessExit,
  workerReportFlagSignature,
} = require("./quality-signatures");

const DEFAULT_HARNESS_DIR = ".meta-harness";
const QUALITY_CONTRACT_FILE = "clean-code-contract.json";
const COMPLEXITY_POLICY_FILE = "complexity-policy.json";
const QUALITY_BASELINE_FILE = path.join("baseline", "quality-baseline.json");
const CONTRACT_TEMPLATE_PATH = path.resolve(__dirname, "..", "templates", "contracts", QUALITY_CONTRACT_FILE);
const EXCLUDED_DIRS = new Set([".git", "node_modules", ".meta-harness", "tmp", "dist", "build", "coverage"]);
const SOURCE_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx", ".py", ".rb", ".go", ".rs", ".java", ".cs", ".php"]);

function fileExists(targetPath) { return fs.existsSync(targetPath); }

function ensureDir(targetPath) { fs.mkdirSync(targetPath, { recursive: true }); }

function readText(targetPath, fallback = "") { return fileExists(targetPath) ? fs.readFileSync(targetPath, "utf8") : fallback; }

function readJson(targetPath) {
  const text = fs.readFileSync(targetPath, "utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`invalid JSON in ${targetPath}`, { cause: error });
  }
}

function writeJson(targetPath, value) {
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(`${targetPath}.tmp`, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(`${targetPath}.tmp`, targetPath);
}

function toSlash(value) { return value.split(path.sep).join("/"); }

function relativePath(targetPath, rootPath) { return toSlash(path.relative(rootPath, targetPath)); }

function qualityContractPath(rootPath, harnessDir = DEFAULT_HARNESS_DIR) { return path.join(rootPath, harnessDir, QUALITY_CONTRACT_FILE); }

function complexityPolicyPath(rootPath, harnessDir = DEFAULT_HARNESS_DIR) { return path.join(rootPath, harnessDir, COMPLEXITY_POLICY_FILE); }

function qualityBaselinePath(rootPath, harnessDir = DEFAULT_HARNESS_DIR) { return path.join(rootPath, harnessDir, QUALITY_BASELINE_FILE); }

function defaultQualityContract() { return readJson(CONTRACT_TEMPLATE_PATH); }

function readQualityContract(rootPath, harnessDir = DEFAULT_HARNESS_DIR) {
  const contractPath = qualityContractPath(rootPath, harnessDir);
  if (!fileExists(contractPath)) throw new ConfigError("quality contract missing; run meta-harness quality init");
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

function writeDefaultComplexityPolicy(rootPath, harnessDir = DEFAULT_HARNESS_DIR) {
  const policyPath = complexityPolicyPath(rootPath, harnessDir);
  if (!fileExists(policyPath)) {
    writeJson(policyPath, defaultComplexityPolicy());
    return { path: policyPath, created: true };
  }
  return { path: policyPath, created: false };
}

function sourceLineCount(text) {
  if (text.length === 0) return 0;
  const lines = text.split(/\r?\n/).length;
  return text.endsWith("\n") || text.endsWith("\r\n") ? lines - 1 : lines;
}

function excludedDirNames(contract) { return new Set([...(contract.excluded_dirs || []), ...EXCLUDED_DIRS]); }

function isExcludedDirectory(rootPath, dirPath, dirname, contract) {
  const excluded = excludedDirNames(contract);
  const relative = toSlash(path.relative(rootPath, dirPath));
  return excluded.has(dirname) || excluded.has(relative) || excluded.has(`${relative}/`);
}

function isSourceFile(targetPath) { return SOURCE_EXTENSIONS.has(path.extname(targetPath)); }

function qualitySourceFiles(rootPath, contract, currentPath = rootPath, collected = []) {
  const excluded = excludedDirNames(contract);
  const entries = fs.readdirSync(currentPath, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const entryPath = path.join(currentPath, entry.name);
      if (!isExcludedDirectory(rootPath, entryPath, entry.name, contract)) {
        qualitySourceFiles(rootPath, contract, entryPath, collected);
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

function analyzeQuality(rootPath, contract = defaultQualityContract(), options = {}) {
  const maxLines = contract.budgets?.max_source_file_lines || 500;
  const sourceFiles = qualitySourceFiles(rootPath, contract).map((fullPath) => {
    const text = readText(fullPath);
    const relative = relativePath(fullPath, rootPath);
    const lines = sourceLineCount(text);
    const budget = fileBudget(relative, contract, maxLines);
    return {
      fullPath,
      relative,
      text,
      lines,
      max_lines: budget.maxLines,
      budget_category: budget.category,
      budget_key: budget.key,
      overbudget: lines > budget.maxLines,
    };
  });

  const processExitCount = sourceFiles.reduce((total, file) => total + countProcessExit(file.text), 0);
  const mainBoundaryMissingCount = sourceFiles.reduce((total, file) => total + countMainBoundaryMissing(file.text), 0);
  const directEventAppendCount = sourceFiles.reduce(
    (total, file) => total + countDirectEventAppends(file.text, contract),
    0,
  );
  const complexity = analyzeComplexity(rootPath, { sourceFiles, harnessDir: options.harnessDir || DEFAULT_HARNESS_DIR });

  return {
    schema_version: "1.0.0",
    files: sourceFiles.map(({ relative, lines, max_lines, budget_category, budget_key, overbudget }) => ({
      relative,
      lines,
      max_lines,
      budget_category,
      budget_key,
      overbudget,
    })),
    architecture: {
      import_boundary_violations: importBoundaryViolations(sourceFiles),
    },
    ratchets: {
      process_exit: { count: processExitCount },
      main_boundary_missing: { count: mainBoundaryMissingCount },
      direct_events_jsonl_append: { count: directEventAppendCount },
      worker_report_flags: workerReportFlagSignature(sourceFiles),
    },
    compatibility: compatibilitySignature(rootPath, sourceFiles),
    complexity,
  };
}

function qualitySummary(analysis) {
  return {
    source_files: analysis.files.length,
    overbudget_files: analysis.files.filter((file) => file.overbudget).length,
    complexity_findings: analysis.complexity?.findings?.length || 0,
  };
}

function createBaseline(rootPath, contract, options = {}) {
  const analysis = analyzeQuality(rootPath, contract, { harnessDir: options.harnessDir });
  const baseline = {
    schema_version: "1.0.0",
    v: 1,
    generated_at: new Date().toISOString(),
    generated_by: options.generatedBy || "meta-harness quality baseline",
    source_commit: options.sourceCommit === undefined ? currentSourceCommit(rootPath) : options.sourceCommit,
    baseline_policy_hash: analysis.complexity?.policy_hash || null,
    owners_hash: analysis.complexity?.owners_hash || null,
    previous_baseline_hash: options.previousBaselineHash || null,
    quality_summary_before: options.qualitySummaryBefore || null,
    quality_summary_after: qualitySummary(analysis),
    manual_override_decision: options.decision || null,
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
    complexity: baselineComplexitySnapshot(analysis.complexity),
  };
  baseline.new_baseline_hash = baselineHash(baseline);
  return baseline;
}

function writeQualityBaseline(rootPath, contract, harnessDir = DEFAULT_HARNESS_DIR, options = {}) {
  const baseline = createBaseline(rootPath, contract, { ...options, harnessDir });
  writeJson(qualityBaselinePath(rootPath, harnessDir), baseline);
  return baseline;
}

function readQualityBaseline(rootPath, harnessDir = DEFAULT_HARNESS_DIR) {
  const baselinePath = qualityBaselinePath(rootPath, harnessDir);
  if (!fileExists(baselinePath)) throw new ConfigError("quality baseline missing; run meta-harness quality baseline");
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

function hasBlockFindings(findings) {
  return findings.some((finding) => finding.severity === "BLOCK");
}

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
  for (const violation of analysis.architecture?.import_boundary_violations || []) {
    findings.push(blockFinding("import_boundary", violation.message, violation.file));
  }
  findings.push(...compareComplexityToBaseline(analysis.complexity || {}, baseline));

  return {
    pass: !hasBlockFindings(findings),
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

function renderQualityJson(result) {
  return `${JSON.stringify({
    schema_version: "1.0.0",
    ok: result.pass,
    mode: result.mode,
    findings: result.findings,
    analysis: result.analysis,
  }, null, 2)}\n`;
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
  const usage = context.usage || ((message) => { throw new UsageError(message); });
  const displayPath = context.relativePath || ((targetPath) => relativePath(targetPath, rootPath));

  if (action === "init") {
    const contract = writeDefaultQualityContract(rootPath, harnessDir);
    const complexityPolicy = writeDefaultComplexityPolicy(rootPath, harnessDir);
    const loadedContract = readQualityContract(rootPath, harnessDir);
    const baselinePath = qualityBaselinePath(rootPath, harnessDir);
    console.log(`${contract.created ? "Created" : "Kept"} ${displayPath(contract.path)}`);
    console.log(`${complexityPolicy.created ? "Created" : "Kept"} ${displayPath(complexityPolicy.path)}`);
    if (fileExists(baselinePath)) {
      console.log(`Kept ${displayPath(baselinePath)}`);
    } else {
      writeQualityBaseline(rootPath, loadedContract, harnessDir);
      console.log(`Created ${displayPath(baselinePath)}`);
    }
    return;
  }

  if (action === "baseline") {
    if (argv[1] === "refresh") {
      const decision = argv[argv.indexOf("--decision") + 1];
      if (!decision || argv.indexOf("--decision") === -1) {
        usage("quality baseline refresh requires --decision <id>");
        return;
      }
      if (!validateDecisionId(rootPath, decision)) {
        usage(`quality baseline refresh decision not found: ${decision}`);
        return;
      }
      if (!isGitClean(rootPath)) {
        usage("quality baseline refresh requires a clean git tree");
        return;
      }
      const contract = readQualityContract(rootPath, harnessDir);
      const previous = fileExists(qualityBaselinePath(rootPath, harnessDir))
        ? readQualityBaseline(rootPath, harnessDir)
        : null;
      writeQualityBaseline(rootPath, contract, harnessDir, {
        decision,
        generatedBy: "meta-harness quality baseline refresh",
        previousBaselineHash: previous ? baselineHash(previous) : null,
        qualitySummaryBefore: previous?.quality_summary_after || null,
      });
      console.log(`Updated ${displayPath(qualityBaselinePath(rootPath, harnessDir))}`);
      return;
    }
    if (!hasFlag(argv, "--force")) {
      usage("quality baseline requires --force after audit; normal patch work should fix findings");
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
    const result = compareQualityToBaseline(analyzeQuality(rootPath, contract, { harnessDir }), baseline, contract, rootPath);
    process.stdout.write(hasFlag(argv, "--json") ? renderQualityJson(result) : renderQualityResult(result));
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

  usage(`unknown quality action: ${action || "missing"}`);
}

module.exports = { analyzeQuality, commandQuality, compareQualityToBaseline, createBaseline, defaultQualityContract, qualityBaselinePath, qualityContractPath, readQualityBaseline, readQualityContract, renderQualityExplain, renderQualityJson, renderQualityResult, writeDefaultQualityContract, writeQualityBaseline };
