#!/usr/bin/env node
"use strict";

/**
 * Offline test-only Codex launcher for D070-A1 full-chain tests.
 * Emits production-shaped JSONL; does not call a model or network.
 * Not a second production path. Bound via the same codexProgram identity fields.
 */

const fs = require("node:fs");
const path = require("node:path");

function main(argv) {
  if (argv.length === 1 && argv[0] === "--version") {
    process.stdout.write("codex-cli 0.144.1-test\n");
    return 0;
  }

  const schemaIdx = argv.indexOf("--output-schema");
  if (schemaIdx < 0 || schemaIdx + 1 >= argv.length) {
    process.stderr.write("test-codex-launcher: missing --output-schema\n");
    return 2;
  }
  const schemaPath = argv[schemaIdx + 1];
  let schema;
  try {
    schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  } catch (err) {
    process.stderr.write(`test-codex-launcher: schema read failed: ${err.message}\n`);
    return 2;
  }
  const allowedPath = schema
    && schema.properties
    && schema.properties.path
    && schema.properties.path.const;
  if (typeof allowedPath !== "string" || !allowedPath) {
    process.stderr.write("test-codex-launcher: schema path.const missing\n");
    return 2;
  }

  // Invocation counter beside schema (controller artDir) for replay spawn proofs.
  const counterPath = path.join(path.dirname(schemaPath), "ao-invocation-count.txt");
  let count = 0;
  try {
    count = Number(fs.readFileSync(counterPath, "utf8"));
    if (!Number.isFinite(count)) count = 0;
  } catch {
    count = 0;
  }
  count += 1;
  fs.writeFileSync(counterPath, `${count}\n`, "utf8");

  // Optional failure modes for offline negative tests via env file next to schema.
  const modePath = path.join(path.dirname(schemaPath), "ao-test-mode.txt");
  let mode = "ok";
  try {
    mode = String(fs.readFileSync(modePath, "utf8")).trim() || "ok";
  } catch {
    mode = "ok";
  }

  const content = "d070-ao-verified-marker\n";
  const artifact = { path: allowedPath, content };

  function emit(obj) {
    process.stdout.write(`${JSON.stringify(obj)}\n`);
  }

  if (mode === "timeout-child") {
    // Spawn a long-lived child then hang (used only by process-tree unit tests via separate harness).
    const { spawn } = require("node:child_process");
    const child = spawn(process.execPath, ["-e", "setInterval(()=>{}, 1000)"], {
      stdio: "ignore",
      windowsHide: true,
      detached: false,
    });
    fs.writeFileSync(
      path.join(path.dirname(schemaPath), "ao-child-pid.txt"),
      `${child.pid}\n`,
      "utf8",
    );
    setInterval(() => {}, 1000);
    return undefined; // keep alive
  }

  if (mode === "fail-terminal") {
    emit({ type: "thread.started", thread_id: "test-thread" });
    emit({ type: "turn.started" });
    emit({ type: "turn.failed", error: { message: "forced" } });
    return 1;
  }

  if (mode === "bad-jsonl") {
    process.stdout.write("not-json\n");
    return 0;
  }

  if (mode === "wrong-path") {
    emit({ type: "thread.started", thread_id: "test-thread" });
    emit({ type: "turn.started" });
    emit({
      type: "item.completed",
      item: {
        id: "item_0",
        type: "agent_message",
        text: JSON.stringify({ path: "other.txt", content }),
      },
    });
    emit({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } });
    return 0;
  }

  // Happy path — production-shaped JSONL
  emit({ type: "thread.started", thread_id: "test-thread" });
  emit({ type: "turn.started" });
  emit({
    type: "item.completed",
    item: {
      id: "item_0",
      type: "agent_message",
      text: JSON.stringify(artifact),
    },
  });
  emit({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } });
  return 0;
}

const code = main(process.argv.slice(2));
if (code !== undefined) process.exitCode = code;
