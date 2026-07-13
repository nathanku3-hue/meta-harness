#!/usr/bin/env node
"use strict";

/**
 * Offline authenticated-agent fixture.
 * Emits production-shaped JSONL without model or network access.
 */

const fs = require("node:fs");
const path = require("node:path");

function loadKnownGoodContent() {
  const override = process.env.CUSTODY_AGENT_FIXTURE_CONTENT_PATH;
  const fixturePath = override || path.join(__dirname, "known-good-message.js");
  if (!fs.existsSync(fixturePath)) {
    throw new Error(`fixture not found: ${fixturePath}`);
  }
  return fs.readFileSync(fixturePath, "utf8");
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function main(argv) {
  if (argv.length === 1 && argv[0] === "--version") {
    process.stdout.write("codex-cli 0.144.1-test\n");
    return 0;
  }

  const schemaIndex = argv.indexOf("--output-schema");
  if (schemaIndex < 0 || schemaIndex + 1 >= argv.length) {
    process.stderr.write("test-agent-launcher: missing --output-schema\n");
    return 2;
  }

  const schemaPath = argv[schemaIndex + 1];
  let schema;
  try {
    schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  } catch (err) {
    process.stderr.write(`test-agent-launcher: schema read failed: ${err.message}\n`);
    return 2;
  }

  const allowedPath = schema
    && schema.properties
    && schema.properties.path
    && schema.properties.path.const;
  if (typeof allowedPath !== "string" || allowedPath.length === 0) {
    process.stderr.write("test-agent-launcher: schema path.const missing\n");
    return 2;
  }

  const artifactDirectory = path.dirname(schemaPath);
  const countPath = path.join(artifactDirectory, "agent-invocation-count.txt");
  let count = 0;
  try {
    count = Number(fs.readFileSync(countPath, "utf8"));
    if (!Number.isFinite(count)) count = 0;
  } catch {
    count = 0;
  }
  fs.writeFileSync(countPath, `${count + 1}\n`, "utf8");

  const modePath = path.join(artifactDirectory, "agent-test-mode.txt");
  let mode = "ok";
  try {
    mode = String(fs.readFileSync(modePath, "utf8")).trim() || "ok";
  } catch {
    mode = "ok";
  }

  let content;
  try {
    content = loadKnownGoodContent();
  } catch (err) {
    process.stderr.write(`test-agent-launcher: fixture read failed: ${err.message}\n`);
    return 2;
  }

  if (mode === "timeout-child") {
    const { spawn } = require("node:child_process");
    const child = spawn(process.execPath, ["-e", "setInterval(()=>{}, 1000)"], {
      stdio: "ignore",
      windowsHide: true,
      detached: false,
    });
    fs.writeFileSync(path.join(artifactDirectory, "agent-child-pid.txt"), `${child.pid}\n`, "utf8");
    setInterval(() => {}, 1000);
    return undefined;
  }

  if (mode === "fail-terminal") {
    emit({ type: "thread.started", thread_id: "fixture-thread" });
    emit({ type: "turn.started" });
    emit({ type: "turn.failed", error: { message: "forced" } });
    return 1;
  }

  if (mode === "bad-jsonl") {
    process.stdout.write("not-json\n");
    return 0;
  }

  const artifact = {
    path: mode === "wrong-path" ? "other.txt" : allowedPath,
    content,
  };
  emit({ type: "thread.started", thread_id: "fixture-thread" });
  emit({ type: "turn.started" });
  emit({
    type: "item.completed",
    item: {
      id: "fixture-item",
      type: "agent_message",
      text: JSON.stringify(artifact),
    },
  });
  emit({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } });
  return 0;
}

const exitCode = main(process.argv.slice(2));
if (exitCode !== undefined) process.exitCode = exitCode;
