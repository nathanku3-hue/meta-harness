"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  ACTIONS,
  PAYLOAD_KEYS,
  REQUEST_SCHEMA,
  loadExecutionRequestEnvelope,
  validateExecutionRequest,
} = require("../lib/execution-custody/execute");

function authorization() {
  return {
    schemaVersion: "slice-authorization/v1",
    sliceId: "SLICE-REQUEST-TEST",
    generation: 1,
  };
}

function request(action = "ACTIVATE_SLICE", payload = {}) {
  return {
    schemaVersion: REQUEST_SCHEMA,
    action,
    sliceAuthorization: authorization(),
    payload,
  };
}

function placeholderPayload(action) {
  return Object.fromEntries(PAYLOAD_KEYS[action].map((key) => {
    if (key === "mechanicsAssessments" || key === "reviewerAssessments") return [key, []];
    if (key === "implementationProcessId") return [key, "process-request-test"];
    return [key, { schemaVersion: `${key}/test` }];
  }));
}

function writeRequest(root, value) {
  const requestPath = path.resolve(root, "request.json");
  fs.writeFileSync(requestPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return requestPath;
}

test("v2 public execution request has one exact top-level shape", () => {
  const value = request();
  const validated = validateExecutionRequest(value);
  assert.deepEqual(validated, value);
  assert.equal(validated.schemaVersion, "meta-harness-execution-request/v2");
  assert.deepEqual(Object.keys(validated).sort(), [
    "action",
    "payload",
    "schemaVersion",
    "sliceAuthorization",
  ]);
  assert.equal(Object.isFrozen(validated), true);
  assert.equal(Object.isFrozen(validated.payload), true);
});

test("v2 request rejects retired schemas and all extra or missing fields", () => {
  assert.throws(
    () => validateExecutionRequest({ ...request(), schemaVersion: "meta-harness-execution-request/v1" }),
    (error) => error.code === "UNSUPPORTED_SCHEMA",
  );
  assert.throws(
    () => validateExecutionRequest({ ...request(), compatibility: true }),
    (error) => error.code === "EXECUTION_REQUEST_SHAPE",
  );
  const missing = request();
  delete missing.payload;
  assert.throws(
    () => validateExecutionRequest(missing),
    (error) => error.code === "EXECUTION_REQUEST_SHAPE",
  );
  assert.throws(
    () => validateExecutionRequest({ ...request(), action: "RUN_WORKER" }),
    (error) => error.code === "EXECUTION_ACTION_UNSUPPORTED",
  );
});

test("every v2 action enforces its exact payload keys", () => {
  for (const action of ACTIONS) {
    const payload = placeholderPayload(action);
    assert.equal(validateExecutionRequest(request(action, payload)).action, action);

    assert.throws(
      () => validateExecutionRequest(request(action, { ...payload, extra: true })),
      (error) => error.code === "EXECUTION_PAYLOAD_SHAPE",
      `${action} must reject extra payload keys`,
    );

    if (PAYLOAD_KEYS[action].length > 0) {
      const incomplete = { ...payload };
      delete incomplete[PAYLOAD_KEYS[action][0]];
      assert.throws(
        () => validateExecutionRequest(request(action, incomplete)),
        (error) => error.code === "EXECUTION_PAYLOAD_SHAPE",
        `${action} must reject missing payload keys`,
      );
    }
  }
});

test("public request cannot submit successful mechanics, proof, reviewer, or terminal evidence", () => {
  assert.throws(
    () => validateExecutionRequest(request("RECORD_MECHANICS", {
      runSpec: { schemaVersion: "run-spec/v2" },
      expectedContributedRevision: "2".repeat(40),
      mechanicsAssessment: { verdict: "MECHANICS_VERIFIED" },
    })),
    (error) => error.code === "EXECUTION_PAYLOAD_SHAPE",
  );
  assert.throws(
    () => validateExecutionRequest(request("RECORD_TERMINAL_CANDIDATE", {
      integratedCandidate: {},
      packageCandidate: {},
      releaseCandidate: {},
      proofRequest: {},
      blackBoxProof: { proofDigest: "sha256:caller" },
      reviewerAssessments: [],
      terminalAssessment: { verdict: "TERMINAL_SLICE_VERIFIED" },
    })),
    (error) => error.code === "EXECUTION_PAYLOAD_SHAPE",
  );
  assert.throws(
    () => validateExecutionRequest(request("CERTIFY_CANDIDATE", {
      integratedCandidate: {},
      certificationRequest: {},
      certificationProof: { proofDigest: "sha256:caller" },
      reviewerAssessments: [],
    })),
    (error) => error.code === "EXECUTION_PAYLOAD_SHAPE",
  );
});

test("request cannot select controller state, repository identity, policy, or clock", () => {
  const probes = [
    ["stateRoot", "/tmp/state", "CALLER_STATE_ROOT_FORBIDDEN"],
    ["custodyRoot", "/tmp/custody", "CALLER_STATE_ROOT_FORBIDDEN"],
    ["repositoryId", "caller-repository", "REQUEST_REPOSITORY_ID_FORBIDDEN"],
    ["controllerPolicyDigest", "sha256:caller", "EXECUTION_REQUEST_FORBIDDEN_FIELD"],
    ["now", "2000-01-01T00:00:00.000Z", "REQUEST_CLOCK_FORBIDDEN"],
    ["clock", "caller-clock", "REQUEST_CLOCK_FORBIDDEN"],
  ];
  for (const [field, value, code] of probes) {
    assert.throws(
      () => validateExecutionRequest({ ...request(), [field]: value }),
      (error) => error.code === code,
      `${field} must fail with ${code}`,
    );
  }
  assert.throws(
    () => validateExecutionRequest(request("ACTIVATE_SLICE", { now: "2000-01-01T00:00:00.000Z" })),
    (error) => error.code === "REQUEST_CLOCK_FORBIDDEN",
  );
});

test("request envelope reads only a regular non-symlink absolute JSON file", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "execution-request-v2-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const requestPath = writeRequest(root, request());
  assert.deepEqual(loadExecutionRequestEnvelope(requestPath), request());

  assert.throws(
    () => loadExecutionRequestEnvelope(root),
    /regular non-symlink file/,
  );
  assert.throws(
    () => loadExecutionRequestEnvelope(path.relative(process.cwd(), requestPath)),
    (error) => error.code === "EXECUTION_REQUEST_PATH",
  );

  const invalidPath = path.join(root, "invalid.json");
  fs.writeFileSync(invalidPath, "{not-json}\n", "utf8");
  assert.throws(
    () => loadExecutionRequestEnvelope(invalidPath),
    (error) => error.code === "EXECUTION_REQUEST_JSON",
  );

  const symlinkPath = path.join(root, "request-link.json");
  try {
    fs.symlinkSync(requestPath, symlinkPath, "file");
    assert.throws(
      () => loadExecutionRequestEnvelope(symlinkPath),
      (error) => error.code === "EXECUTION_REQUEST_FILE",
    );
  } catch (error) {
    if (!["EPERM", "EACCES", "ENOSYS"].includes(error.code)) throw error;
  }
});

test("v2 request rejects non-plain authorization and payload objects", () => {
  assert.throws(
    () => validateExecutionRequest({ ...request(), sliceAuthorization: [] }),
    (error) => error.code === "EXECUTION_REQUEST_OBJECT",
  );
  assert.throws(
    () => validateExecutionRequest({ ...request(), payload: [] }),
    (error) => error.code === "EXECUTION_REQUEST_OBJECT",
  );
});
