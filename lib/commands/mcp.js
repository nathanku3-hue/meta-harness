"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { fail, optionValue, parseArgs } = require("../cli-args");
const { writeLine, writeOut } = require("../cli-context");
const { renderInsightMarkdown, extractInsights } = require("../insight-extractor");
const {
  ingestResearchReport,
  renderResearchEvidenceMarkdown,
  summarizeResearchReport,
} = require("../research-report-ingest");
const { generateResearchPrompt } = require("../research-prompt-generator");
const { localMcpConfigPath, readWorkspaceFiles } = require("../mcp-workspaces");
const { runStdioServer, toolDescriptors } = require("../mcp-server");

function splitPathList(value) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .filter((item) => item !== undefined && item !== true)
    .flatMap((item) => String(item).split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

function readLog(context, logPath) {
  if (!logPath || logPath === true) return "";
  return context.fs.readFileSync(path.resolve(context.cwd, String(logPath)), "utf8");
}

function readReport(context, reportPath) {
  if (!reportPath || reportPath === true) fail("mcp research requires --report");
  return context.fs.readFileSync(path.resolve(context.cwd, String(reportPath)), "utf8");
}

function gitDiff(context, baseRef) {
  if (!baseRef || baseRef === true) return "";
  const result = spawnSync("git", ["diff", "--no-ext-diff", String(baseRef), "--", "."], {
    cwd: context.cwd,
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    fail(`git diff failed: ${result.stderr.trim() || result.stdout.trim() || String(baseRef)}`);
  }
  return result.stdout;
}

function writeJson(context, value) {
  writeOut(context, `${JSON.stringify(value, null, 2)}\n`);
}

function runInit(args, context) {
  const { options } = parseArgs(args);
  const configPath = localMcpConfigPath(context.cwd);
  const exists = context.fs.existsSync(configPath);
  if (exists && !options.overwrite) {
    writeLine(context, `MCP config already exists: ${configPath}`);
    writeLine(context, "Run with --overwrite to replace it.");
    return { exitCode: 0 };
  }
  context.fs.mkdirSync(path.dirname(configPath), { recursive: true });
  context.fs.writeFileSync(configPath, `${JSON.stringify({
    schema_version: "1.0.0",
    transport: "stdio",
    allowed_roots: [context.cwd],
    tools: toolDescriptors().map((tool) => tool.name),
  }, null, 2)}\n`, "utf8");
  writeLine(context, `Wrote MCP config: ${configPath}`);
  return { exitCode: 0 };
}

async function runServe(args, context) {
  const { options } = parseArgs(args);
  if (options.listTools) {
    writeJson(context, { schema_version: "1.0.0", tools: toolDescriptors() });
    return { exitCode: 0 };
  }
  await runStdioServer({ root: context.cwd, fs: context.fs });
  return { exitCode: 0 };
}

function runInsight(args, context) {
  const { positional, options } = parseArgs(args);
  if (positional[0] !== "extract") {
    fail(`unknown mcp insight action: ${positional[0] || "missing"}`);
  }
  const diffText = gitDiff(context, optionValue(options.diff));
  const logText = readLog(context, optionValue(options.log));
  const insights = extractInsights({ diffText, logText });
  if (options.json) {
    writeJson(context, insights);
  } else {
    writeOut(context, renderInsightMarkdown(insights));
  }
  return { exitCode: 0 };
}

function runResearchPrompt(options, context) {
  const question = optionValue(options.question);
  if (!question || question === true) fail("mcp research prompt requires --question");
  const files = splitPathList(options.files);
  const fileContexts = readWorkspaceFiles(context.cwd, files, context.fs);
  writeOut(context, generateResearchPrompt({ question, files: fileContexts }));
  return { exitCode: 0 };
}

function writeResearchEvidence(context, result, asJson) {
  if (asJson) writeJson(context, result);
  else writeOut(context, renderResearchEvidenceMarkdown(result));
  return { exitCode: 0 };
}

function runResearchIngest(options, context) {
  const report = optionValue(options.report);
  if (!report || report === true) fail("mcp research ingest requires --report");
  const question = optionValue(options.question);
  if (!question || question === true) fail("mcp research ingest requires --question");
  const result = ingestResearchReport({
    question,
    sourceReportPath: String(report),
    reportText: readReport(context, report),
  });
  return writeResearchEvidence(context, result, Boolean(options.json));
}

function runResearchSummarize(options, context) {
  const report = optionValue(options.report);
  if (!report || report === true) fail("mcp research summarize requires --report");
  const result = summarizeResearchReport({
    sourceReportPath: String(report),
    reportText: readReport(context, report),
  });
  return writeResearchEvidence(context, result, Boolean(options.json));
}

function runResearch(args, context) {
  const { positional, options } = parseArgs(args);
  if (positional[0] === "prompt") return runResearchPrompt(options, context);
  if (positional[0] === "ingest") return runResearchIngest(options, context);
  if (positional[0] === "summarize") return runResearchSummarize(options, context);
  fail(`unknown mcp research action: ${positional[0] || "missing"}`);
}

module.exports = async function runMcp(args, context) {
  const [area, ...rest] = args;

  if (area === "init") return runInit(rest, context);
  if (area === "serve") return runServe(rest, context);
  if (area === "insight") return runInsight(rest, context);
  if (area === "research") return runResearch(rest, context);

  fail(`unknown mcp action: ${area || "missing"}`);
};
