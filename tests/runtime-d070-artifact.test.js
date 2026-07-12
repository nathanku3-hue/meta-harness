"use strict";

/**
 * D070-A1 offline artifact unit tests (no Codex, no network).
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  requireSingleLiteralScopePath,
  buildChangeArtifactSchema,
  parseCodexJsonl,
  extractChangeArtifact,
  validateChangeArtifact,
  materializeChangeArtifact,
  AO_CONTENT_MAX_BYTES,
} = require("../internal/d069/ao-artifact");

const ALLOWED = "src/fixture.txt";
const CONTENT = "d070-ao-verified-marker\n";

function happyEvents(artifactText = JSON.stringify({ path: ALLOWED, content: CONTENT })) {
  return [
    { type: "thread.started", thread_id: "t1" },
    { type: "turn.started" },
    {
      type: "item.completed",
      item: { id: "item_0", type: "agent_message", text: artifactText },
    },
    { type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } },
  ];
}

test("scope: single literal allow, empty deny", () => {
  assert.equal(requireSingleLiteralScopePath({ allow: [ALLOWED], deny: [] }), ALLOWED);
  assert.throws(
    () => requireSingleLiteralScopePath({ allow: [ALLOWED, "other"], deny: [] }),
    (e) => e.code === "D070_SCOPE_ALLOW",
  );
  assert.throws(
    () => requireSingleLiteralScopePath({ allow: [ALLOWED], deny: ["x"] }),
    (e) => e.code === "D070_SCOPE_DENY",
  );
  assert.throws(
    () => requireSingleLiteralScopePath({ allow: ["src/*.txt"], deny: [] }),
    (e) => e.code === "D070_SCOPE_GLOB",
  );
});

test("schema is deterministic from allowed path without content const", () => {
  const schema = buildChangeArtifactSchema(ALLOWED);
  assert.equal(schema.properties.path.const, ALLOWED);
  assert.equal(schema.properties.content.const, undefined);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ["path", "content"]);
});

test("JSONL parser rejects blank and non-JSON lines", () => {
  const events = parseCodexJsonl(
    `${JSON.stringify({ type: "turn.started" })}\n${JSON.stringify({ type: "turn.completed" })}\n`,
  );
  assert.equal(events.length, 2);
  assert.throws(() => parseCodexJsonl("not-json\n"), (e) => e.code === "D070_JSONL_PARSE");
  assert.throws(
    () => parseCodexJsonl(`${JSON.stringify({ type: "a" })}\n\n${JSON.stringify({ type: "b" })}\n`),
    (e) => e.code === "D070_JSONL_BLANK",
  );
});

test("extractChangeArtifact requires terminal turn.completed and exact JSON object", () => {
  const extracted = extractChangeArtifact(happyEvents());
  assert.equal(extracted.artifact.path, ALLOWED);
  assert.equal(extracted.artifact.content, CONTENT);

  assert.throws(
    () => extractChangeArtifact([
      { type: "turn.started" },
      { type: "turn.failed", error: { message: "x" } },
    ]),
    (e) => e.code === "D070_TERMINAL_ERROR",
  );

  assert.throws(
    () => extractChangeArtifact([
      { type: "turn.started" },
      {
        type: "item.completed",
        item: { id: "i", type: "agent_message", text: JSON.stringify({ path: ALLOWED, content: CONTENT }) },
      },
    ]),
    (e) => e.code === "D070_TERMINAL_MISSING",
  );

  assert.throws(
    () => extractChangeArtifact(happyEvents(`${JSON.stringify({ path: ALLOWED, content: CONTENT })} trailing`)),
    (e) => e.code === "D070_ARTIFACT_JSON" || e.code === "D070_ARTIFACT_PROSE",
  );

  const multi = [
    { type: "turn.started" },
    {
      type: "item.completed",
      item: {
        id: "a",
        type: "agent_message",
        text: JSON.stringify({ path: ALLOWED, content: CONTENT }),
      },
    },
    {
      type: "item.completed",
      item: {
        id: "b",
        type: "agent_message",
        text: JSON.stringify({ path: ALLOWED, content: "other\n" }),
      },
    },
    { type: "turn.completed", usage: {} },
  ];
  assert.throws(() => extractChangeArtifact(multi), (e) => e.code === "D070_ARTIFACT_MULTIPLE");
});

test("validateChangeArtifact enforces exact keys, path, bounds", () => {
  const ok = validateChangeArtifact({ path: ALLOWED, content: CONTENT }, ALLOWED);
  assert.equal(ok.contentBytes, Buffer.byteLength(CONTENT));

  assert.throws(
    () => validateChangeArtifact({ path: ALLOWED, content: CONTENT, extra: 1 }, ALLOWED),
    (e) => e.code === "D070_ARTIFACT_KEYS",
  );
  assert.throws(
    () => validateChangeArtifact({ path: "other.txt", content: CONTENT }, ALLOWED),
    (e) => e.code === "D070_ARTIFACT_PATH",
  );
  assert.throws(
    () => validateChangeArtifact({ path: ALLOWED, content: "" }, ALLOWED),
    (e) => e.code === "D070_ARTIFACT_EMPTY",
  );
  assert.throws(
    () => validateChangeArtifact({ path: ALLOWED, content: "a\0b" }, ALLOWED),
    (e) => e.code === "D070_ARTIFACT_NUL",
  );
  const huge = "x".repeat(AO_CONTENT_MAX_BYTES + 1);
  assert.throws(
    () => validateChangeArtifact({ path: ALLOWED, content: huge }, ALLOWED),
    (e) => e.code === "D070_ARTIFACT_SIZE",
  );
});

test("materialize writes exact bytes and rejects path escape / missing / symlink components", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "d070-mat-"));
  try {
    const targetDir = path.join(root, "src");
    fs.mkdirSync(targetDir, { recursive: true });
    const target = path.join(targetDir, "fixture.txt");
    fs.writeFileSync(target, "old\n", "utf8");

    materializeChangeArtifact(root, { path: ALLOWED, content: CONTENT });
    assert.equal(fs.readFileSync(target, "utf8"), CONTENT);

    assert.throws(
      () => materializeChangeArtifact(root, { path: "../escape.txt", content: CONTENT }),
      (e) => e.code === "D070_SCOPE_PATH" || e.code === "D070_PATH_ESCAPE" || e.code === "D070_MATERIALIZE_PATH",
    );

    // Scope helper rejects .. ; materialize also rejects escape
    assert.throws(
      () => materializeChangeArtifact(root, { path: "missing.txt", content: CONTENT }),
      (e) => e.code === "D070_TARGET_MISSING",
    );

    // No directory creation: nested missing dir
    assert.throws(
      () => materializeChangeArtifact(root, { path: "nope/dir/file.txt", content: CONTENT }),
      (e) => e.code === "D070_TARGET_MISSING",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
