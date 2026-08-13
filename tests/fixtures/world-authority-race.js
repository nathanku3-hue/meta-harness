"use strict";

const fs = require("node:fs");

const { enterExecutionAttempt } = require("../../lib/execution-permit");
const { commitTransition } = require("../../lib/world-transition");

const sleeper = new Int32Array(new SharedArrayBuffer(4));

function sleep(milliseconds) {
  Atomics.wait(sleeper, 0, 0, milliseconds);
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

fs.writeFileSync(process.env.MH_RACE_READY, "ready\n", "utf8");
while (fs.existsSync(process.env.MH_RACE_BARRIER)) sleep(2);

for (let attempt = 0; attempt < 500; attempt += 1) {
  try {
    let result;
    if (process.env.MH_RACE_ROLE === "admission") {
      result = enterExecutionAttempt({
        stateDirectory: process.env.MH_RACE_STATE_DIRECTORY,
        permit: JSON.parse(process.env.MH_RACE_PERMIT),
        session: JSON.parse(process.env.MH_RACE_SESSION),
      });
      emit({ ok: true, status: "ENTERED", entryDigest: result.entryDigest });
    } else {
      result = commitTransition(
        process.env.MH_RACE_REPOSITORY,
        JSON.parse(process.env.MH_RACE_TRANSITION),
      );
      emit({ ok: true, status: result.status, headDigest: result.head.headDigest });
    }
    process.exit(0);
  } catch (error) {
    if (error?.code === "MH_WORLD_AUTHORITY_BUSY") {
      sleep(2);
      continue;
    }
    emit({ ok: false, code: error?.code || "ERROR", message: String(error?.message || error) });
    process.exit(0);
  }
}

emit({ ok: false, code: "MH_RACE_TIMEOUT", message: "world-authority race did not settle" });
process.exit(1);
