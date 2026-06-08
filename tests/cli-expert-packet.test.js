"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const {
  ROOT,
  assertCliError,
  run,
  runRaw,
  tempDir,
  zipEntryText,
} = require("./helpers/cli");

function npmPackDryRun() {
  const npmExecPath = process.env.npm_execpath;
  const npmCliPath = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const command = (npmExecPath || fs.existsSync(npmCliPath)) ? process.execPath : (process.platform === "win32" ? "npm.cmd" : "npm");
  const args = npmExecPath
    ? [npmExecPath, "pack", "--dry-run", "--json"]
    : (fs.existsSync(npmCliPath) ? [npmCliPath, "pack", "--dry-run", "--json"] : ["pack", "--dry-run", "--json"]);
  return spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32" && command === "npm.cmd",
  });
}

test("package dry-run includes quality module", () => {
  const result = npmPackDryRun();
  assert.equal(result.status, 0, `ERROR:\n${result.error}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  const [pack] = JSON.parse(result.stdout);
  const packedFiles = pack.files.map((file) => file.path);
  assert.equal(packedFiles.includes("lib/quality.js"), true);
});

test("expert-packet builds bounded local review packet", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Build expert review packet"]);
  fs.writeFileSync(path.join(cwd, "focused-note.md"), "# Focused Note\n\nEvidence only.\n", "utf8");
  fs.mkdirSync(path.join(cwd, "docs", "chats"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "spec.md"), "# Spec\n\nSafe evidence.\n", "utf8");
  fs.writeFileSync(path.join(cwd, "docs", "chats", "example.md"), "raw chat words must not enter packet\n", "utf8");
  fs.writeFileSync(path.join(cwd, "stale-expert-report.md"), "# Expert Report\n\nOld markdown finding.\n", "utf8");
  fs.writeFileSync(path.join(cwd, "stale-expert-report.json"), "{\n  \"finding\": \"old json\"\n}\n", "utf8");
  const oldDate = new Date(Date.now() - 60_000);
  fs.utimesSync(path.join(cwd, "stale-expert-report.md"), oldDate, oldDate);
  fs.utimesSync(path.join(cwd, "stale-expert-report.json"), oldDate, oldDate);
  run(cwd, [
    "event",
    "--stream", "review",
    "--phase", "plan",
    "--action", "selected bounded expert review",
    "--result", "packet scope is one focused note",
  ]);

  const output = run(cwd, [
    "expert-packet", "ROUND-001",
    "--include", "focused-note.md",
    "--include", "docs",
    "--include", "stale-expert-report.md",
    "--include", "stale-expert-report.json",
  ]);
  assert.match(output, /Built expert packet zip:/);

  const packetDir = path.join(cwd, ".meta-harness", "expert-packets", "ROUND-001");
  const packetZip = `${packetDir}.zip`;
  assert.equal(fs.existsSync(packetDir), false);
  assert.equal(fs.existsSync(packetZip), true);

  const zipBytes = fs.readFileSync(packetZip);
  assert.equal(zipBytes.readUInt32LE(0), 0x04034b50);
  const zipText = zipBytes.toString("utf8");
  assert.match(zipText, /README_DECISION_CARD\.md/);
  assert.match(zipText, /subagent_packet\.json/);
  assert.match(zipText, /\.meta-harness\/status\.md/);
  assert.match(zipText, /included\/focused-note\.md/);
  assert.match(zipText, /included\/docs\/spec\.md/);
  assert.doesNotMatch(zipText, /raw chat words must not enter packet/);
  assert.match(zipText, /harness_templates\/skills\/scope-selector\.md/);
  assert.match(zipText, /PACKET_MANIFEST\.md/);
  assert.match(zipText, /git_status\.txt/);
  assert.match(zipText, /single zip archive only/);
  assert.match(zipText, /Excluded by design/);
  assert.match(zipEntryText(zipBytes, "included/stale-expert-report.md"), /^# STALE EXPERT REPORT/);
  assert.deepEqual(JSON.parse(zipEntryText(zipBytes, "included/stale-expert-report.json")), {
    finding: "old json",
  });

  const frontCard = zipEntryText(zipBytes, "README_DECISION_CARD.md");
  assert.match(frontCard, /Front Card Max: one page/);
  assert.ok(frontCard.split(/\r?\n/).length <= 40);
  assert.equal((frontCard.match(/^Question:/gm) || []).length, 1);
  assert.match(frontCard, /stale-expert-report\.json \(manifest\/front-card warning only\)/);

  const subagentPacket = JSON.parse(zipEntryText(zipBytes, "subagent_packet.json"));
  assert.deepEqual(Object.keys(subagentPacket), [
    "goal",
    "owned_paths",
    "forbidden_paths",
    "required_evidence",
    "stop_rule",
    "return_schema",
  ]);
  assert.deepEqual(subagentPacket.forbidden_paths, [".env", "provider-config/*", "user-worktree/*"]);
  assert.deepEqual(subagentPacket.required_evidence, [
    "dirty state snapshot",
    "scope diff gate result",
    "test output",
    "PM brief",
  ]);
  assert.equal(subagentPacket.owned_paths.includes("docs/spec.md"), true);
  assert.equal(subagentPacket.owned_paths.includes("docs/chats/example.md"), false);
  assert.equal(subagentPacket.owned_paths.includes("docs"), false);
  assert.doesNotMatch(subagentPacket.return_schema, /raw logs|chat logs|private transcripts/i);

  const manifest = zipEntryText(zipBytes, "PACKET_MANIFEST.md");
  assert.match(manifest, /Broad expert board: not invoked by default/);
  assert.match(manifest, /docs\/chats\/example\.md \(raw chat log excluded\)/);
  assert.match(manifest, /stale-expert-report\.json \(manifest\/front-card warning only\)/);
  assert.doesNotMatch(output, /broad expert board invoked/i);
});

test("expert-packet rejects includes that overlap packet output", () => {
  const cwd = tempDir();
  run(cwd, ["init", "Reject recursive packet includes"]);

  const result = runRaw(cwd, ["expert-packet", "ROUND-001", "--include", ".meta-harness"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /include path must not overlap packet output root/);
});

test("expert-packet rejects unsafe explicit owned paths", () => {
  for (const item of [".env", "secret.txt", "provider-config/foo", "runtime/output.json", "docs/chats/foo.md"]) {
    const cwd = tempDir();
    run(cwd, ["init", "Reject unsafe owned paths"]);
    const result = runRaw(cwd, ["expert-packet", "ROUND-001", "--owned-path", item]);
    assertCliError(result, "MH_USAGE", /owned path|raw chat/);
  }
});

test("package dry-run excludes repo-local control-plane files", () => {
  const result = npmPackDryRun();
  assert.equal(result.status, 0);
  const [pack] = JSON.parse(result.stdout);
  const packedFiles = pack.files.map((file) => file.path);
  const leaked = packedFiles.filter((file) => file.includes(".meta-harness") || file.startsWith(".agents/"));
  assert.deepEqual(leaked, [], `Tarball contains leaked repo-local files: ${leaked.join(", ")}`);
});
