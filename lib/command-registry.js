"use strict";

const { UsageError } = require("./errors");
const { PHASES, STREAMS } = require("./harness-state");

const DEFAULT_OWNER = "nathanku3-hue";

const commandSpecs = [
  {
    name: "init",
    summary: "Create local harness state.",
    usage: "meta-harness init --authority-public-key-file <path> --authority-receipt-file <path>",
    handler: "./commands/init",
  },
  {
    name: "execute",
    summary: "Execute one approved bounded repository change with durable custody evidence.",
    usage: "meta-harness execute --request <absolute-path> [--json]",
    handler: "./commands/execute",
  },
  {
    name: "status",
    summary: "Print current harness status.",
    usage: "meta-harness status [--refresh]",
    handler: "./commands/status",
  },
  {
    name: "event",
    summary: "Append a governance event.",
    usage: [
      "meta-harness event --stream <stream> --phase <phase> --action <text> --result <text>",
      "meta-harness event --canonical --authority-receipt-file <path>",
    ],
    handler: "./commands/event",
  },
  {
    name: "worker-report",
    summary: "Write a bounded worker PM brief.",
    usage: "meta-harness worker-report [worker-id] --stream <stream> --task <text> --outcome <DONE|PARTIAL_WITH_EXPLICIT_SCOPE|REJECTED> --requested-work-type <type> --actual-work-type <type> [--result <text>]",
    handler: "./commands/worker-report",
  },
  {
    name: "templates",
    summary: "List or install packaged templates.",
    usage: ["meta-harness templates list", "meta-harness templates install [--overwrite]"],
    handler: "./commands/templates",
  },
  {
    name: "sync",
    summary: "Check installed template sync.",
    usage: "meta-harness sync check --target <repo>",
    handler: "./commands/sync",
  },
  {
    name: "trust",
    summary: "Check skill trust references.",
    usage: "meta-harness trust check --target <repo>",
    handler: "./commands/trust",
  },
  {
    name: "contract",
    summary: "Scan contract headings.",
    usage: "meta-harness contract scan --target <repo>",
    handler: "./commands/contract",
  },
  {
    name: "context",
    summary: "Check, assemble, or query round context sufficiency.",
    usage: [
      "meta-harness context check --from <phase> --to <phase> [--round <id>] [--json] [--out <path>] [--commit-artifact]",
      "meta-harness context packet <round-id> --for <worker|review|planning> [--json] [--out <path>]",
      "meta-harness context ask <round-id> [--json]",
    ],
    handler: "./commands/context",
  },
  {
    name: "state",
    summary: "Check harness state layout.",
    usage: "meta-harness state check --target <repo>",
    handler: "./commands/state",
  },
  {
    name: "dirty",
    summary: "Snapshot or classify dirty work.",
    usage: [
      "meta-harness dirty snapshot --out <path>",
      "meta-harness dirty classify --before <path> --after <path> --scope <path> --out <path>",
    ],
    handler: "./commands/dirty",
  },
  {
    name: "gate",
    summary: "Gate a dirty-work scope.",
    usage: [
      "meta-harness gate scope --dirty <path> --scope <path>",
      "meta-harness gate ship --dirty <path> --scope <path> [--json]",
    ],
    handler: "./commands/gate",
  },
  {
    name: "merge",
    summary: "Check PR or branch merge readiness.",
    usage: [
      "meta-harness merge check --pr <n> --scope <scope> [--json]",
      "meta-harness merge check --base <base> --head <head> --scope <scope> [--json]",
    ],
    handler: "./commands/merge",
  },
  {
    name: "mcp",
    summary: "Serve read-only MCP tools or generate strategic loop artifacts.",
    usage: [
      "meta-harness mcp init [--overwrite]",
      "meta-harness mcp serve [--list-tools]",
      "meta-harness mcp insight extract --diff <base-ref> [--log <path>] [--json]",
      "meta-harness mcp research prompt --question <q> --files <paths>",
      "meta-harness mcp research ingest --report <path> --question <q> [--json]",
      "meta-harness mcp research summarize --report <path> [--json]",
      "meta-harness mcp research handoff --report <path> --question <q> [--json]",
    ],
    handler: "./commands/mcp",
  },
  {
    name: "decisions",
    summary: "Manage or scan the decision inbox.",
    usage: [
      "meta-harness decisions list --in <path>",
      "meta-harness decisions add --kind <kind> --question <text> --state-hash <hash>",
      "meta-harness decisions resolve --id <id> --resolution <approved|rejected|deferred>",
      "meta-harness decisions scan --target <repo>",
    ],
    handler: "./commands/decisions",
  },
  {
    name: "domain-governance",
    summary: "Check downstream domain governance activation, rule-chain, and expiry evidence.",
    usage: "meta-harness domain-governance check --target <repo> [--json]",
    handler: "./commands/domain-governance",
  },
  {
    name: "governance",
    summary: "Snapshot, diff, or replay context gate governance.",
    usage: [
      "meta-harness governance snapshot [--target <repo>] [--out <path>] [--json]",
      "meta-harness governance diff [--snapshot <path>] [--target <repo>] [--json]",
      "meta-harness governance replay --snapshot <path> --artifact <path> --target <repo> [--json]",
      "meta-harness governance migration plan --spec <path> --snapshot <path> [--json]",
      "meta-harness governance migration apply --spec <path> --snapshot <path> --out <path> [--json]",
      "meta-harness governance migration verify --spec <path> --before <path> --after <path> [--json]",
      "meta-harness governance migration impact --spec <path> --snapshot <path> --artifacts-dir <path> [--json]",
      "meta-harness governance release check --release <path> --before <path> --snapshot <path> --migration <path> [--artifacts-dir <path>] [--json]",
      "meta-harness governance release report --release <path> [--diff <path>] [--impact <path>] [--migration-verification <path>] [--out <path>]",
    ],
    handler: "./commands/governance",
  },
  {
    name: "ready",
    summary: "Run aggregated readiness checks.",
    usage: "meta-harness ready --target <repo> [--json] [--quick] [--read-only] [--no-exec] [--mode <local|strict|release>] [--strict-github-settings]",
    handler: "./commands/ready",
  },
  {
    name: "release",
    summary: "Check local release readiness without publishing.",
    usage: "meta-harness release check [--target <repo>] [--json] [--publish]",
    handler: "./commands/release",
  },
  {
    name: "distill",
    summary: "Record and check skill distillation records.",
    usage: [
      "meta-harness distill add --decision-id <id> --principle <text> --skill <name> --assumption <text> --reopen-when <text> [--enforcement <check>] [--owner <owner>] [--out <path>]",
      "meta-harness distill candidate <distillation-id> --target <repo> [--in <path>] [--json] [--overwrite]",
      "meta-harness distill list --in <path>",
      "meta-harness distill check --in <path>",
    ],
    handler: "./commands/skill-distillation",
  },
  {
    name: "skill",
    summary: "Validate, diagnose, or quarantine repo-local skills.",
    usage: [
      "meta-harness skill check --target <repo> [--json] [--strict]",
      "meta-harness skill doctor --target <repo> [--json] [--strict]",
      "meta-harness skill preflight <skill-name> --target <repo> [--json] [--permission-decision <id>]",
      "meta-harness skill promote <skill-name> --target <repo> --decision-id <id> [--json] [--dry-run]",
      "meta-harness skill rollback <skill-name> --target <repo> --decision-id <id> [--json] [--dry-run]",
      "meta-harness skill disable <skill-name> --target <repo> [--json] [--dry-run]",
    ],
    handler: "./commands/skill",
  },
  {
    name: "brief",
    summary: "Create or scan bounded PM briefs.",
    usage: [
      "meta-harness brief pm --dirty <path> --decisions <path> --out <path>",
      "meta-harness brief scan --target <repo>",
    ],
    handler: "./commands/brief",
  },
  {
    name: "expert-packet",
    summary: "Build a bounded local expert review packet.",
    usage: "meta-harness expert-packet <round-id> [--include <path>] [--owned-path <path>] [--forbidden-path <path>] [--required-evidence <text>] [--overwrite]",
    handler: "./commands/expert-packet",
  },
  {
    name: "quality",
    summary: "Initialize, baseline, check, or explain quality policy.",
    usage: [
      "meta-harness quality init",
      "meta-harness quality baseline --force",
      "meta-harness quality baseline refresh --decision <id>",
      "meta-harness quality check",
      "meta-harness quality explain",
    ],
    handler: "./commands/quality",
  },
  {
    name: "lookback",
    summary: "Render the local event lookback.",
    usage: "meta-harness lookback [--write]",
    handler: "./commands/lookback",
  },
  {
    name: "poll",
    summary: "Render parent/child status poll.",
    usage: [
      "meta-harness poll [--write]",
      "meta-harness poll --rollup [--json] [--autonomy-approval-receipt <json>] [--autonomy-approval-receipt-file <path>] [--write-manual-work-packet <path>] [--verify-manual-work-packet <path>] [--write-operator-execution-plan <path>] [--verify-operator-execution-plan <path>] [--force]",
      "  (with --verify-operator-execution-plan always emits execution_readiness + worker_entry_gate; selected_repo_resolution when validation passes)",
    ],
    handler: "./commands/poll",
  },
  {
    name: "repos",
    summary: "Manage child repo index.",
    usage: [
      "meta-harness repos list",
      "meta-harness repos add <name> <path> [--role <role>]",
      "meta-harness repos remove <name>",
    ],
    handler: "./commands/repos",
  },
];

function commandMetadata(spec) {
  return {
    name: spec.name,
    public: spec.public !== false && spec.hidden !== true && spec.internal !== true,
    alias_of: spec.alias_of || null,
    deprecated: spec.deprecated === true,
    internal: spec.internal === true,
    owner: spec.owner || DEFAULT_OWNER,
  };
}

function commandRegistry() {
  return commandSpecs
    .map(commandMetadata)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function commandNames() {
  return commandSpecs.filter((spec) => !spec.hidden).map((spec) => spec.name);
}

function commandUsages() {
  return commandSpecs.flatMap((spec) => Array.isArray(spec.usage) ? spec.usage : [spec.usage]);
}

function resolveCommand(argv) {
  const [command, ...args] = argv;
  const spec = commandSpecs.find((candidate) => candidate.name === command || candidate.aliases?.includes(command));
  if (!spec) {
    throw new UsageError(`unknown command: ${command}`);
  }
  return {
    args,
    canonicalName: spec.name,
    handler: require(spec.handler),
    spec,
  };
}

function renderHelp() {
  return `meta-harness

Markdown-first Codex-native workflow visibility harness.

Usage:
  ${commandUsages().join("\n  ")}

Streams: ${STREAMS.join(", ")}
Phases:  ${PHASES.join(" -> ")}
`;
}

module.exports = {
  commandRegistry,
  commandNames,
  commandSpecs,
  commandUsages,
  renderHelp,
  resolveCommand,
};
