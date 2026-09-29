"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { runEphemeralStructuredModel } = require("../lib/ephemeral-structured-model");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mh-structured-cancel-"));
  const script = path.join(root, "hang.js");
  const grandchildScript = path.join(root, "grandchild.js");
  fs.writeFileSync(grandchildScript, [
    '"use strict";',
    'const fs = require("node:fs");',
    'fs.writeFileSync(process.env.HANG_GRANDCHILD_MARKER, String(process.pid));',
    'setInterval(() => {}, 1000);',
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(script, [
    '"use strict";',
    'const fs = require("node:fs");',
    'const { spawn } = require("node:child_process");',
    'fs.writeFileSync(process.env.HANG_MARKER, String(process.pid));',
    'if (process.env.HANG_GRANDCHILD_MARKER) {',
    '  const grandchild = spawn(process.execPath, [process.env.HANG_GRANDCHILD_SCRIPT], {',
    '    detached: true,',
    '    stdio: "ignore",',
    '    env: { ...process.env },',
    '  });',
    '  grandchild.unref();',
    '}',
    'const bytes = Number(process.env.HANG_OUTPUT_BYTES || "0");',
    'const delay = Number(process.env.HANG_OUTPUT_DELAY_MS || "0");',
    'if (bytes > 0) setTimeout(() => process.stdout.write("x".repeat(bytes)), delay);',
    'setInterval(() => {}, 1000);',
    "",
  ].join("\n"), "utf8");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    root,
    script,
    marker: path.join(root, "pid.txt"),
    grandchildScript,
    grandchildMarker: path.join(root, "grandchild-pid.txt"),
  };
}

function options(fx, extra = {}) {
  const { env: envOverride = {}, ...rest } = extra;
  return {
    cwd: fx.root,
    prompt: "hang",
    outputSchema: { type: "object" },
    schemaPath: path.join(fx.root, "schema.json"),
    outputPath: path.join(fx.root, "output.json"),
    timeoutSeconds: 10,
    outputCapBytes: 1024 * 1024,
    codePrefix: "MH_CANCEL",
    label: "cancel test model",
    env: {
      ...process.env,
      META_HARNESS_TEST_MODE: "1",
      META_HARNESS_WORKER_COMMAND_JSON: JSON.stringify([process.execPath, fx.script]),
      HANG_MARKER: fx.marker,
      ...envOverride,
    },
    ...rest,
  };
}

async function waitForFile(filePath, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${filePath}`);
}

function processIsLive(pid) {
  if (process.platform === "linux") {
    try {
      const status = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const close = status.lastIndexOf(")");
      if (close >= 0 && status.slice(close + 1).trim().split(/\s+/u)[0] === "Z") return false;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

test("pre-aborted structured model spawns no child", async (t) => {
  const fx = fixture(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    async () => runEphemeralStructuredModel(options(fx, { signal: controller.signal })),
    (error) => error.code === "MH_DRAIN_REQUESTED",
  );
  assert.equal(fs.existsSync(fx.marker), false);
});

test("drain kills the owned process tree and settles only after child close", async (t) => {
  const fx = fixture(t);
  const controller = new AbortController();
  const pending = runEphemeralStructuredModel(options(fx, { signal: controller.signal }));
  await waitForFile(fx.marker);
  const pid = Number(fs.readFileSync(fx.marker, "utf8"));
  assert.equal(processIsLive(pid), true);
  controller.abort();
  await assert.rejects(pending, (error) => error.code === "MH_DRAIN_REQUESTED");
  assert.equal(processIsLive(pid), false);
});

test("drain kills a detached grandchild that escaped the model process group before helper settlement", async (t) => {
  const fx = fixture(t);
  const controller = new AbortController();
  const pending = runEphemeralStructuredModel(options(fx, {
    signal: controller.signal,
    env: {
      HANG_GRANDCHILD_MARKER: fx.grandchildMarker,
      HANG_GRANDCHILD_SCRIPT: fx.grandchildScript,
    },
  }));
  await waitForFile(fx.grandchildMarker);
  const grandchildPid = Number(fs.readFileSync(fx.grandchildMarker, "utf8"));
  t.after(() => {
    if (processIsLive(grandchildPid)) {
      try { process.kill(grandchildPid, "SIGKILL"); } catch (_) {}
    }
  });
  assert.equal(processIsLive(grandchildPid), true);
  controller.abort();
  await assert.rejects(pending, (error) => error.code === "MH_DRAIN_REQUESTED");
  assert.equal(processIsLive(grandchildPid), false);
});

test("drain wins when requested before timeout or output cap", async (t) => {
  const fx = fixture(t);
  const controller = new AbortController();
  const pending = runEphemeralStructuredModel(options(fx, {
    signal: controller.signal,
    timeoutSeconds: 1,
    outputCapBytes: 32,
    env: { HANG_OUTPUT_BYTES: "4096", HANG_OUTPUT_DELAY_MS: "500" },
  }));
  await waitForFile(fx.marker);
  controller.abort();
  await assert.rejects(pending, (error) => error.code === "MH_DRAIN_REQUESTED");
});

test("timeout remains timeout rather than drain", async (t) => {
  const fx = fixture(t);
  await assert.rejects(
    runEphemeralStructuredModel(options(fx, { timeoutSeconds: 1 })),
    (error) => error.code === "MH_CANCEL_TIMEOUT",
  );
});

test("TIMEOUT then DRAIN preserves the first timeout termination cause", async (t) => {
  const fx = fixture(t);
  const controller = new AbortController();
  const observed = [];
  await assert.rejects(
    runEphemeralStructuredModel(options(fx, {
      timeoutSeconds: 1,
      signal: controller.signal,
      onTerminationRequestedForTest: (cause) => {
        observed.push(cause);
        if (cause === "TIMEOUT") controller.abort();
      },
    })),
    (error) => error.code === "MH_CANCEL_TIMEOUT",
  );
  assert.deepEqual(observed, ["TIMEOUT"]);
});

test("output cap remains output cap rather than drain", async (t) => {
  const fx = fixture(t);
  await assert.rejects(
    runEphemeralStructuredModel(options(fx, {
      timeoutSeconds: 5,
      outputCapBytes: 32,
      env: { HANG_OUTPUT_BYTES: "4096", HANG_OUTPUT_DELAY_MS: "0" },
    })),
    (error) => error.code === "MH_CANCEL_OUTPUT_CAP",
  );
});

test("OUTPUT_CAP then DRAIN preserves the first output-cap termination cause", async (t) => {
  const fx = fixture(t);
  const controller = new AbortController();
  const observed = [];
  await assert.rejects(
    runEphemeralStructuredModel(options(fx, {
      timeoutSeconds: 5,
      outputCapBytes: 32,
      signal: controller.signal,
      env: { HANG_OUTPUT_BYTES: "4096", HANG_OUTPUT_DELAY_MS: "0" },
      onTerminationRequestedForTest: (cause) => {
        observed.push(cause);
        if (cause === "OUTPUT_CAP") controller.abort();
      },
    })),
    (error) => error.code === "MH_CANCEL_OUTPUT_CAP",
  );
  assert.deepEqual(observed, ["OUTPUT_CAP"]);
});

test("real Codex adapters stream large prompts over stdin instead of argv", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mh-structured-stdin-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const script = path.join(root, "capture-stdin.js");
  fs.writeFileSync(script, [
    '"use strict";',
    'const fs = require("node:fs");',
    'const args = process.argv.slice(2);',
    'const outputAt = args.indexOf("-o");',
    'const outputPath = outputAt >= 0 ? args[outputAt + 1] : null;',
    'let input = "";',
    'process.stdin.setEncoding("utf8");',
    'process.stdin.on("data", (chunk) => { input += chunk; });',
    'process.stdin.on("end", () => {',
    '  if (!outputPath) process.exit(2);',
    '  fs.writeFileSync(outputPath, JSON.stringify({',
    '    receivedBytes: Buffer.byteLength(input, "utf8"),',
    '    lastArg: args.at(-1),',
    '    promptWasArg: args.includes(input),',
    '  }));',
    '});',
    "",
  ].join("\n"), "utf8");

  const prompt = "large-promoter-input-".repeat(8192);
  const outputPath = path.join(root, "output.json");
  const produced = await runEphemeralStructuredModel({
    cwd: root,
    prompt,
    outputSchema: { type: "object" },
    schemaPath: path.join(root, "schema.json"),
    outputPath,
    timeoutSeconds: 10,
    codePrefix: "MH_STDIN",
    label: "stdin transport model",
    resolvedCommand: {
      executable: process.execPath,
      prefixArgs: [script],
      identity: "codex-cli",
      pathStyle: "native",
    },
  });

  assert.equal(produced.result.receivedBytes, Buffer.byteLength(prompt, "utf8"));
  assert.equal(produced.result.lastArg, "-");
  assert.equal(produced.result.promptWasArg, false);
});

test("structured Codex stdout exposes the real failure when stderr is empty", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mh-structured-error-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const script = path.join(root, "stdout-error.js");
  fs.writeFileSync(script, [
    '"use strict";',
    'process.stdin.resume();',
    'process.stdin.on("end", () => {',
    '  process.stdout.write(JSON.stringify({ type: "error", message: "quota exhausted for test" }) + "\\n");',
    '  process.stdout.write(JSON.stringify({ type: "turn.failed", error: { message: "quota exhausted for test" } }) + "\\n");',
    '  process.exit(1);',
    '});',
    "",
  ].join("\n"), "utf8");

  await assert.rejects(
    runEphemeralStructuredModel({
      cwd: root,
      prompt: "trigger failure",
      outputSchema: { type: "object" },
      schemaPath: path.join(root, "schema.json"),
      outputPath: path.join(root, "output.json"),
      timeoutSeconds: 10,
      codePrefix: "MH_STDOUT_ERROR",
      label: "stdout error model",
      resolvedCommand: {
        executable: process.execPath,
        prefixArgs: [script],
        identity: "codex-cli",
        pathStyle: "native",
      },
    }),
    (error) => error.code === "MH_STDOUT_ERROR_EXIT"
      && /quota exhausted for test/u.test(error.message),
  );
});
