"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadExample } = require("../internal/execution-custody/example");
const {
  OPERATOR_REQUEST_SCHEMA,
  OPERATOR_RECEIPT_SCHEMA,
  validateOperatorRequest,
  loadOperatorRequestEnvelope,
  identityToken,
  buildOperatorRunRequest,
} = require("../internal/execution-custody/operator");
const { main: operatorMain } = require("../scripts/operate-execution-custody");

function validRequest() {
  return {
    schemaVersion: OPERATOR_REQUEST_SCHEMA,
    operationId: "devspace-operator-01",
    examplePath: path.resolve(".agents/skills/bounded-repository-change/examples/devspace-dev-server.json"),
    sourceRepositoryPath: path.resolve("local-source"),
    custodyRoot: path.resolve("local-custody"),
    approvedBy: "operator-test@meta-harness.local",
    agentProgram: {
      nodeExecutablePath: path.resolve("tools/node"),
      launcherScriptPath: path.resolve("tools/codex.js"),
      nativeExecutablePath: path.resolve("tools/codex"),
      expectedVersion: "0.144.1",
      codexHome: path.resolve("tools/codex-home"),
    },
    validationProgram: {
      executablePath: path.resolve("tools/validation"),
      hostEnv: { PATH: "test-path" },
      sensitiveValues: [path.resolve("private-dependency-root")],
    },
  };
}

test("private operator request has an exact local-binding shape", () => {
  const request = validRequest();
  const validated = validateOperatorRequest(request);
  assert.deepEqual(validated, request);
  assert.equal(Object.isFrozen(validated), true);
  assert.equal(OPERATOR_RECEIPT_SCHEMA, "execution-custody-operator-receipt/v1");

  assert.throws(
    () => validateOperatorRequest({ ...request, extra: true }),
    (err) => err && err.code === "CUSTODY_OPERATOR_REQUEST",
  );
  assert.throws(
    () => validateOperatorRequest({ ...request, examplePath: "relative/example.json" }),
    (err) => err && err.code === "CUSTODY_OPERATOR_REQUEST",
  );
  assert.throws(
    () => validateOperatorRequest({
      ...request,
      validationProgram: {
        ...request.validationProgram,
        hostEnv: { PATH: 7 },
      },
    }),
    (err) => err && err.code === "CUSTODY_OPERATOR_REQUEST",
  );
  assert.throws(
    () => validateOperatorRequest({ ...request, operationId: "bad operation id" }),
    (err) => err && err.code === "CUSTODY_OPERATOR_REQUEST",
  );
});

test("operator request receipt binds the exact bytes read at start", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-operator-request-"));
  try {
    const requestPath = path.join(temporaryRoot, "request.json");
    const bytes = Buffer.from(`${JSON.stringify(validRequest(), null, 2)}\n`, "utf8");
    fs.writeFileSync(requestPath, bytes);
    const envelope = loadOperatorRequestEnvelope(requestPath);
    assert.deepEqual(envelope.request, validRequest());
    assert.equal(
      envelope.requestDigest,
      `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
    );
    fs.appendFileSync(requestPath, " \n", "utf8");
    assert.equal(
      envelope.requestDigest,
      `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("operator identity deterministically binds one approved example operation", () => {
  const example = loadExample(path.resolve(
    ".agents/skills/bounded-repository-change/examples/devspace-dev-server.json",
  ));
  assert.equal(identityToken("devspace-operator-01"), "DEVSPACE-OPERATOR-01");
  const built = buildOperatorRunRequest(
    example,
    "devspace-operator-01",
    "2026-07-14T12:00:00.000Z",
    "operator-test@meta-harness.local",
  );
  assert.equal(built.runSpecApproval.runSpec.runId, "RUN-DEVSPACE-OPERATOR-01");
  assert.equal(built.runSpecApproval.approvalId, "APPROVAL-DEVSPACE-OPERATOR-01");
  assert.equal(built.authorizationRequest.authorizationId, "AUTH-DEVSPACE-OPERATOR-01");
  assert.equal(built.authorizationRequest.attemptId, "ATTEMPT-DEVSPACE-OPERATOR-01");
  assert.equal(built.runSpecApproval.approvedAt, "2026-07-14T11:55:00.000Z");
  assert.equal(built.runSpecApproval.runSpec.repository.repositoryId, "devspace");
  assert.deepEqual(built.runSpecApproval.runSpec.scope.allow, ["scripts/dev-server.mjs"]);
});

test("private operator entrypoint requires exactly one absolute local request path", () => {
  assert.throws(
    () => operatorMain(["node", "scripts/operate-execution-custody.js"]),
    /usage:/,
  );
  assert.throws(
    () => operatorMain([
      "node",
      "scripts/operate-execution-custody.js",
      "relative-request.json",
    ]),
    /must be absolute/,
  );
});
