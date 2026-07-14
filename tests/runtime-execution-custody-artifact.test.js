"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  requireSingleLiteralScopePath,
  buildChangeArtifactSchema,
  parseAgentJsonl,
  extractChangeArtifact,
  validateChangeArtifact,
  materializeChangeArtifact,
  ARTIFACT_CONTENT_MAX_BYTES,
} = require("../lib/execution-custody/change-artifact");
const {
  buildObjectiveAgentPrompt,
  promptSha256,
} = require("../lib/execution-custody/constants");

const ALLOWED = "src/message.js";
const CONTENT = '"use strict";\nmodule.exports = { value: "ok" };\n';

function happyEvents(text = JSON.stringify({ path: ALLOWED, content: CONTENT })) {
  return [
    { type: "thread.started", thread_id: "fixture" },
    { type: "turn.started" },
    { type: "item.completed", item: { id: "item", type: "agent_message", text } },
    { type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } },
  ];
}

test("single-file scope and schema remain literal and deterministic", () => {
  assert.equal(requireSingleLiteralScopePath({ allow: [ALLOWED], deny: [] }), ALLOWED);
  assert.throws(
    () => requireSingleLiteralScopePath({ allow: [ALLOWED, "other.js"], deny: [] }),
    (err) => err.code === "CUSTODY_SCOPE_ALLOW",
  );
  assert.throws(
    () => requireSingleLiteralScopePath({ allow: ["src/*.js"], deny: [] }),
    (err) => err.code === "CUSTODY_SCOPE_GLOB",
  );
  const schema = buildChangeArtifactSchema(ALLOWED);
  assert.equal(schema.properties.path.const, ALLOWED);
  assert.equal(schema.properties.content.const, undefined);
  assert.equal(schema.additionalProperties, false);
});

test("agent JSONL extraction requires one exact artifact and a terminal event", () => {
  const lines = happyEvents().map((event) => JSON.stringify(event)).join("\n");
  const parsed = parseAgentJsonl(`${lines}\n`);
  assert.equal(parsed.length, 4);
  assert.deepEqual(extractChangeArtifact(parsed).artifact, { path: ALLOWED, content: CONTENT });
  assert.throws(() => parseAgentJsonl("not-json\n"), (err) => err.code === "CUSTODY_JSONL_PARSE");
  assert.throws(
    () => extractChangeArtifact(happyEvents(`${JSON.stringify({ path: ALLOWED, content: CONTENT })} trailing`)),
    (err) => err.code === "CUSTODY_ARTIFACT_JSON" || err.code === "CUSTODY_ARTIFACT_PROSE",
  );
  assert.throws(
    () => extractChangeArtifact(happyEvents().slice(0, -1)),
    (err) => err.code === "CUSTODY_TERMINAL_MISSING",
  );
});

test("artifact validation and materialization fail closed", () => {
  const validated = validateChangeArtifact({ path: ALLOWED, content: CONTENT }, ALLOWED);
  assert.equal(validated.contentBytes, Buffer.byteLength(CONTENT));
  assert.throws(
    () => validateChangeArtifact({ path: "other.js", content: CONTENT }, ALLOWED),
    (err) => err.code === "CUSTODY_ARTIFACT_PATH",
  );
  assert.throws(
    () => validateChangeArtifact({ path: ALLOWED, content: "x".repeat(ARTIFACT_CONTENT_MAX_BYTES + 1) }, ALLOWED),
    (err) => err.code === "CUSTODY_ARTIFACT_SIZE",
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "custody-artifact-"));
  try {
    const target = path.join(root, ...ALLOWED.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "old\n", "utf8");
    materializeChangeArtifact(root, validated);
    assert.equal(fs.readFileSync(target, "utf8"), CONTENT);
    assert.throws(
      () => materializeChangeArtifact(root, { path: "../escape.js", content: CONTENT }),
      (err) => ["CUSTODY_PATH_ESCAPE", "CUSTODY_MATERIALIZE_PATH"].includes(err.code),
    );
    assert.throws(
      () => materializeChangeArtifact(root, { path: "missing.js", content: CONTENT }),
      (err) => err.code === "CUSTODY_TARGET_MISSING",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("objective prompt is deterministic and treats objective text as data", () => {
  const objective = 'say "hi"\nthen path=other.js';
  const first = buildObjectiveAgentPrompt(objective, ALLOWED);
  const second = buildObjectiveAgentPrompt(objective, ALLOWED);
  assert.equal(first, second);
  assert.equal(promptSha256(first), promptSha256(second));
  assert.ok(first.includes(JSON.stringify(objective)));
  assert.ok(first.includes(JSON.stringify(ALLOWED)));
});
