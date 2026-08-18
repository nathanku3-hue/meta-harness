"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { ConfigError } = require("./errors");
const { codingArgs, resolveCodingWorker } = require("./coding-worker");
const { gitExecutableForWorkspace } = require("./git-command");
const { calibrateProductProofDraft } = require("./work-verifier");
const {
  COVERAGE_FIELDS,
  gapProductProofSpec,
  productProofContract,
  readBaseOwnedProductProofDraft,
  safeRuntime,
  sealProductProofSpec,
  validateClaim,
  validateProductProofSpec,
} = require("./work-product-proof-spec");

const DEFAULT_TIMEOUT_SECONDS = 600;
const OUTPUT_CAP_BYTES = 8 * 1024 * 1024;

const PROOF_COMPILER_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["claims", "program"],
  properties: {
    claims: {
      type: "array",
      minItems: 1,
      maxItems: 64,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "statement", "disposition", "baselineExpectation", "covers", "reason"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 80 },
          statement: { type: "string", minLength: 1 },
          disposition: { enum: ["EXECUTABLE", "UNVERIFIABLE", "TASTE", "EXTERNAL"] },
          baselineExpectation: { enum: ["PASS", "FAIL", "NONE"] },
          covers: {
            type: "array",
            minItems: 1,
            uniqueItems: true,
            items: { enum: COVERAGE_FIELDS },
          },
          reason: { type: "string", minLength: 1 },
        },
      },
    },
    program: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["runtime", "timeoutSeconds", "content"],
          properties: {
            runtime: { type: "string", minLength: 1 },
            timeoutSeconds: { type: "integer", minimum: 1, maximum: 3600 },
            content: { type: "string", minLength: 1 },
          },
        },
      ],
    },
  },
});

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("MH_WORK_PROOF_COMPILER", `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) fail("MH_WORK_PROOF_COMPILER", `${label} has missing or unexpected fields`, { actual, expected: wanted });
}

function git(repositoryPath, args) {
  const executable = gitExecutableForWorkspace({ cwd: repositoryPath, fs });
  const result = spawnSync(executable, args, {
    cwd: repositoryPath,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: OUTPUT_CAP_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    fail("MH_WORK_PROOF_COMPILER_GIT", `git ${args.join(" ")} failed while preparing sealed-base proof compilation: ${String(result.stderr || result.stdout || result.error?.message || "unknown error").trim()}`);
  }
  return result;
}

function buildProofCompilerPrompt(contract, productDirection) {
  return [
    "Compile independent product proof before any coding candidate exists.",
    "You are not implementing the task. You are translating the sealed product contract into atomic material proof claims and, where possible, one repository-native executable proof program.",
    "The final candidate will be produced only after your output is frozen. You cannot see it and must not assume its implementation shape.",
    "",
    "Owner-authored product direction:",
    productDirection.content,
    "",
    `Product result: ${contract.productResult}`,
    `Newly true behavior: ${contract.newlyTrueBehavior}`,
    `Done when: ${contract.doneWhen}`,
    `Sealed base commit: ${contract.baseCommit}`,
    "",
    "Proof rules:",
    "- Decompose every material semantic clause in productResult, newlyTrueBehavior, and doneWhen. Every one of those three fields must be covered by at least one claim; never weaken or silently omit a clause.",
    "- Mark a claim EXECUTABLE only when a read-only repository-native program can decide it from observable behavior or artifacts. Otherwise mark it UNVERIFIABLE, TASTE, or EXTERNAL and explain why.",
    "- For each EXECUTABLE claim choose baselineExpectation FAIL when the requested newly-true behavior should be absent from the sealed base, or PASS when it is a preservation/invariant claim that should already hold. Do not use candidate knowledge; none exists.",
    "- If any claim is EXECUTABLE, return exactly one proof program. It will run once per executable claim with META_HARNESS_PROOF_CLAIM_ID set to that claim id.",
    "- The program may inspect META_HARNESS_CANDIDATE_ROOT, META_HARNESS_BASE_ROOT, and META_HARNESS_CONTRACT_PATH. It must be read-only, deterministic, network-independent, and exit 0 iff the named claim is satisfied; exit nonzero otherwise.",
    "- Use repository-native/runtime capabilities already available from a safe system PATH. Do not create a Meta-Harness assertion DSL, do not modify the repository, and do not rely on candidate-authored tests.",
    "- If no material claim can be independently executed, return program: null and expose the gap honestly.",
  ].join("\n");
}

function parseCompilerOutput(filePath) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail("MH_WORK_PROOF_COMPILER_RESULT", `product-proof compiler did not produce valid structured output: ${error.message}`);
  }
  exactKeys(parsed, ["claims", "program"], "product-proof compiler result");
  if (!Array.isArray(parsed.claims) || parsed.claims.length === 0 || parsed.claims.length > 64) fail("MH_WORK_PROOF_COMPILER_RESULT", "product-proof compiler must return 1-64 claims");
  const claims = parsed.claims.map((claim, index) => validateClaim(claim, index));
  if (new Set(claims.map((claim) => claim.id)).size !== claims.length) fail("MH_WORK_PROOF_COMPILER_RESULT", "product-proof compiler claim ids must be unique");
  for (const field of COVERAGE_FIELDS) {
    if (!claims.some((claim) => claim.covers.includes(field))) fail("MH_WORK_PROOF_COMPILER_RESULT", `product-proof compiler omitted material contract clause ${field}`);
  }
  const executable = claims.filter((claim) => claim.disposition === "EXECUTABLE");
  if (parsed.program === null) {
    if (executable.length > 0) fail("MH_WORK_PROOF_COMPILER_RESULT", "executable claims require a proof program");
  } else {
    if (executable.length === 0) fail("MH_WORK_PROOF_COMPILER_RESULT", "proof compiler program must be null when no executable claims exist");
    exactKeys(parsed.program, ["runtime", "timeoutSeconds", "content"], "product-proof compiler program");
    if (!safeRuntime(parsed.program.runtime)
        || !Number.isInteger(parsed.program.timeoutSeconds) || parsed.program.timeoutSeconds < 1 || parsed.program.timeoutSeconds > 3600
        || typeof parsed.program.content !== "string" || parsed.program.content.trim() === "") {
      fail("MH_WORK_PROOF_COMPILER_RESULT", "product-proof compiler program is invalid");
    }
  }
  return Object.freeze({ claims, program: parsed.program ? Object.freeze({ ...parsed.program }) : null });
}

function runProofCompilerAgent({ repositoryPath, contract, productDirection, model, env = process.env, timeoutSeconds = DEFAULT_TIMEOUT_SECONDS }) {
  const root = path.resolve(repositoryPath);
  const worker = resolveCodingWorker(env);
  const tempRoot = fs.mkdtempSync(path.join(path.dirname(root), ".meta-harness-proof-compiler-"));
  const snapshotPath = path.join(tempRoot, "repository");
  const schemaPath = path.join(tempRoot, "schema.json");
  const outputPath = path.join(tempRoot, "output.json");
  try {
    git(root, ["clone", "--no-checkout", "--no-hardlinks", root, snapshotPath]);
    git(snapshotPath, ["reset", "--hard", contract.baseCommit]);
    fs.writeFileSync(schemaPath, `${JSON.stringify(PROOF_COMPILER_SCHEMA, null, 2)}\n`, "utf8");
    const prompt = buildProofCompilerPrompt(contract, productDirection);
    const args = [...worker.prefixArgs, ...codingArgs({
      workspacePath: snapshotPath,
      schemaPath,
      outputPath,
      prompt,
      model,
      pathStyle: worker.pathStyle || "native",
    })];
    const result = spawnSync(worker.executable, args, {
      cwd: snapshotPath,
      env: { ...env },
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: Math.max(1, timeoutSeconds) * 1000,
      maxBuffer: OUTPUT_CAP_BYTES,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error || result.status !== 0) {
      fail(
        result.error?.code === "ETIMEDOUT" ? "MH_WORK_PROOF_COMPILER_TIMEOUT" : "MH_WORK_PROOF_COMPILER_EXIT",
        `product-proof compiler failed: ${String(result.stderr || result.stdout || result.error?.message || `exit ${result.status}`).trim().slice(-4000)}`,
        { status: result.status, causeCode: result.error?.code },
      );
    }
    return { compiler: worker.identity, result: parseCompilerOutput(outputPath) };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function matchedCalibration(claims, calibration) {
  const claimById = new Map(claims.map((claim) => [claim.id, claim]));
  return calibration.filter((entry) => {
    const claim = claimById.get(entry.claimId);
    return claim && entry.observed === claim.baselineExpectation;
  });
}

function assertProductProofSpecAuthority({ repositoryPath, session, env = process.env }) {
  const contract = productProofContract(session);
  const spec = validateProductProofSpec(session.productProofSpec, contract);
  if (spec.source.type === "GAP") return spec;

  if (spec.source.type === "BASE_OWNED") {
    const draft = readBaseOwnedProductProofDraft(repositoryPath, contract);
    if (!draft) {
      fail("MH_WORK_PRODUCT_PROOF_SPEC_AUTHORITY", "sealed session claims base-owned product proof but the exact base contains no product-proof policy");
    }
    const calibration = calibrateProductProofDraft({
      workspacePath: repositoryPath,
      dependencySourcePath: repositoryPath,
      contract,
      claims: draft.claims,
      program: draft.program,
      env,
    });
    const bad = calibration.filter((entry) => entry.expected !== entry.observed);
    if (bad.length > 0) {
      fail(
        "MH_WORK_PRODUCT_PROOF_POLICY",
        `sealed base-owned product proof no longer satisfies its declared calibration: ${bad.map((entry) => `${entry.claimId}: expected ${entry.expected}, observed ${entry.observed}`).join("; ")}`,
      );
    }
    const expected = sealProductProofSpec({ ...draft, calibration });
    if (expected.specDigest !== spec.specDigest) {
      fail("MH_WORK_PRODUCT_PROOF_SPEC_AUTHORITY", "sealed session product-proof spec does not match the exact base-owned proof authority");
    }
    return spec;
  }

  const executable = spec.claims.filter((claim) => claim.disposition === "EXECUTABLE");
  const calibration = executable.length === 0 ? [] : calibrateProductProofDraft({
    workspacePath: repositoryPath,
    dependencySourcePath: repositoryPath,
    contract,
    claims: spec.claims,
    program: spec.program,
    env,
  });
  const bad = calibration.filter((entry) => entry.expected !== entry.observed);
  if (bad.length > 0) {
    fail(
      "MH_WORK_PRODUCT_PROOF_SPEC_AUTHORITY",
      `sealed compiled product proof does not satisfy its declared base calibration: ${bad.map((entry) => `${entry.claimId}: expected ${entry.expected}, observed ${entry.observed}`).join("; ")}`,
    );
  }
  const expected = sealProductProofSpec({
    source: spec.source,
    contract,
    claims: spec.claims,
    program: spec.program && {
      runtime: spec.program.runtime,
      timeoutSeconds: spec.program.timeoutSeconds,
      content: spec.program.content,
    },
    calibration,
  });
  if (expected.specDigest !== spec.specDigest) {
    fail("MH_WORK_PRODUCT_PROOF_SPEC_AUTHORITY", "sealed compiled product-proof spec calibration was not controller-derived for this exact base");
  }
  return spec;
}

function compileProductProofSpec({
  repositoryPath,
  productDirection,
  base,
  productResult,
  newlyTrueBehavior,
  doneWhen,
  model,
  env = process.env,
  allowModel = true,
}) {
  const contract = productProofContract({ productDirection, base, productResult, newlyTrueBehavior, doneWhen });
  const baseOwned = readBaseOwnedProductProofDraft(repositoryPath, contract);
  if (baseOwned) {
    const calibration = calibrateProductProofDraft({
      workspacePath: repositoryPath,
      dependencySourcePath: repositoryPath,
      contract,
      claims: baseOwned.claims,
      program: baseOwned.program,
      env,
    });
    const matched = matchedCalibration(baseOwned.claims, calibration);
    if (matched.length !== calibration.length) {
      const bad = calibration.filter((entry) => entry.expected !== entry.observed).map((entry) => `${entry.claimId}: expected ${entry.expected}, observed ${entry.observed}`);
      fail("MH_WORK_PRODUCT_PROOF_POLICY", `sealed base-owned product proof is not discriminating as declared: ${bad.join("; ")}`);
    }
    return sealProductProofSpec({ ...baseOwned, calibration });
  }

  if (!allowModel) {
    return gapProductProofSpec(contract, "No sealed base-owned product-proof policy exists and this authority path does not synthesize model-authored proof.");
  }

  let compiled;
  try {
    compiled = runProofCompilerAgent({ repositoryPath, contract, productDirection, model, env });
  } catch (error) {
    return gapProductProofSpec(contract, `Pre-worker product-proof compilation was unavailable: ${error.message}`);
  }

  let claims = compiled.result.claims.map((claim) => ({ ...claim }));
  let program = compiled.result.program ? { ...compiled.result.program } : null;
  let calibration = [];
  if (claims.some((claim) => claim.disposition === "EXECUTABLE")) {
    calibration = calibrateProductProofDraft({
      workspacePath: repositoryPath,
      dependencySourcePath: repositoryPath,
      contract,
      claims,
      program,
      env,
    });
    const observedById = new Map(calibration.map((entry) => [entry.claimId, entry]));
    claims = claims.map((claim) => {
      if (claim.disposition !== "EXECUTABLE") return claim;
      const observed = observedById.get(claim.id);
      if (observed && observed.observed === claim.baselineExpectation) return claim;
      return {
        ...claim,
        disposition: "UNVERIFIABLE",
        baselineExpectation: "NONE",
        reason: `${claim.reason} Generated proof did not satisfy its declared sealed-base calibration and was downgraded to an explicit proof gap.`,
      };
    });
    const executableIds = new Set(claims.filter((claim) => claim.disposition === "EXECUTABLE").map((claim) => claim.id));
    calibration = calibration.filter((entry) => executableIds.has(entry.claimId));
    if (executableIds.size === 0) program = null;
  }

  return sealProductProofSpec({
    source: { type: "COMPILED", compiler: compiled.compiler },
    contract,
    claims,
    program,
    calibration,
  });
}

module.exports = {
  PROOF_COMPILER_SCHEMA,
  assertProductProofSpecAuthority,
  buildProofCompilerPrompt,
  compileProductProofSpec,
  parseCompilerOutput,
  runProofCompilerAgent,
};
