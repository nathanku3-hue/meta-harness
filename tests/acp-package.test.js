"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { ROOT } = require("./helpers/cli");

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return String(result.stdout || "").trim();
}

function managedRepository(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-acp-package-"));
  git(root, ["init"]);
  git(root, ["config", "user.name", "ACP Package Test"]);
  git(root, ["config", "user.email", "acp-package@example.invalid"]);
  fs.mkdirSync(path.join(root, ".meta-harness"), { recursive: true });
  fs.writeFileSync(path.join(root, ".meta-harness", "repo-charter.json"), "{}\n", "utf8");
  fs.writeFileSync(path.join(root, "README.md"), "managed fixture\n", "utf8");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "baseline"]);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function npmInvocation(args) {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter(Boolean);
  const npmExecPath = candidates.find((candidate) => fs.existsSync(candidate));
  return npmExecPath
    ? { command: process.execPath, args: [npmExecPath, ...args] }
    : { command: process.platform === "win32" ? "npm.cmd" : "npm", args };
}

test("ACP package surface is stable-v1 SDK based and self-contained for publication", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));
  const source = fs.readFileSync(path.join(ROOT, "lib", "acp-entry.js"), "utf8");

  assert.equal(packageJson.bin["meta-harness-acp"], "bin/meta-harness-acp.js");
  assert.equal(packageJson.dependencies["@agentclientprotocol/sdk"], "1.3.0");
  assert.equal(packageJson.dependencies.zod, "4.4.3");
  assert.deepEqual(packageJson.bundleDependencies, ["@agentclientprotocol/sdk", "zod"]);
  assert.equal(lock.packages[""].dependencies["@agentclientprotocol/sdk"], "1.3.0");
  assert.equal(lock.packages["node_modules/@agentclientprotocol/sdk"].version, "1.3.0");
  assert.equal(lock.packages["node_modules/zod"].version, "4.4.3");
  assert.match(source, /import\("@agentclientprotocol\/sdk"\)/u);
  assert.doesNotMatch(source, /experimental\/v2|readline|JSON\.parse\(line\)/u);

  const invocation = npmInvocation(["pack", "--dry-run", "--ignore-scripts", "--json"]);
  const packed = spawnSync(invocation.command, invocation.args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: false,
    timeout: 120000,
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(packed.status, 0, packed.stderr || packed.stdout);
  const result = JSON.parse(packed.stdout);
  assert.equal(result.length, 1);
  const files = result[0].files.map((entry) => entry.path);
  assert.equal(files.includes("bin/meta-harness-acp.js"), true);
  assert.equal(files.includes("lib/acp-entry.js"), true);
  assert.deepEqual(new Set(result[0].bundled || []), new Set(["@agentclientprotocol/sdk", "zod"]));
});

test("published ACP executable negotiates v1 and binds only a managed repository root", (t) => {
  const root = managedRepository(t);
  const requests = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: "meta-harness-acp-test", version: "1.0.0" },
      },
    },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "session/new",
      params: { cwd: root, mcpServers: [] },
    },
  ];
  const child = spawnSync(process.execPath, [path.join(ROOT, "bin", "meta-harness-acp.js")], {
    cwd: root,
    input: `${requests.map(JSON.stringify).join("\n")}\n`,
    encoding: "utf8",
    shell: false,
    timeout: 15000,
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  assert.equal(child.stderr, "");
  const lines = child.stdout.trim().split(/\r?\n/u).map((line) => JSON.parse(line));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].id, 1);
  assert.equal(lines[0].result.protocolVersion, 1);
  assert.deepEqual(lines[0].result.agentCapabilities, {});
  assert.equal(lines[1].id, 2);
  assert.match(lines[1].result.sessionId, /^transport-[0-9a-f-]{36}$/u);
  assert.equal(fs.existsSync(path.join(root, ".git", "meta-harness")), false);
});
