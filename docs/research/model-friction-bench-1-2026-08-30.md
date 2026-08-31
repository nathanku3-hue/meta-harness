# MODEL-FRICTION-BENCH-1 — 2026-08-30

Status: **R1 measured compatibility blocker; no production adaptation performed**
Authority: non-authoritative measurement
Campaign base: `57a2564f1fe199de3a8ab8cfb8ae45834e9ec656`

## Current runtime facts

The bare WSL `codex` launcher is broken because its Linux optional package is missing, but that is **not** the production Meta-Harness model path.

`resolveStructuredModel()` on the current supported WSL/Windows setup resolves:

```text
identity = codex-cli-windows-from-wsl
Windows Node = D:\nodejs\node.exe
Windows Node version = v25.2.1
Codex launcher = C:\Users\Lenovo\AppData\Roaming\npm\node_modules\@openai\codex\bin\codex.js
Codex CLI = 0.144.1
```

A trivial exact production-style Codex invocation succeeded:

```text
-a never
-c model_reasoning_effort="medium"
exec
--skip-git-repo-check
-s read-only
-C C:\Windows\Temp
--ephemeral
--ignore-user-config
--color never
--json
```

Observed result:

```text
agent_message = ok
input_tokens = 13799
cached_input_tokens = 8960
output_tokens = 5
reasoning_output_tokens = 0
```

This proves current authentication/model transport can run. It does not estimate Meta-Harness planner cost.

## Production F2/F4 failure

The current research promoter runs from a fresh non-Git temp directory but does not pass `skipGitRepoCheck: true` into the shared structured-model invocation.

Three F2 and three F4 production attempts therefore failed before model reasoning with:

```text
MH_RESEARCH_PROMOTION_EXIT
Not inside a trusted directory and --skip-git-repo-check was not specified.
```

This is a repeated model-interface / ACI failure, not a prompt-quality result.

## One precommitted ACI ablation

After the repeated failure, R1 performed exactly one one-variable interface probe in the test-only runner:

```text
production research invocation
vs
same invocation + skipGitRepoCheck=true
```

No production bytes changed.

The trust-directory error disappeared, but the call still failed. Capturing the exact Codex JSON event stream then identified the next current-interface incompatibility:

```text
invalid_request_error
code = invalid_json_schema
param = text.format.schema
message = Invalid schema for response_format 'codex_output_schema':
          In context=('properties', 'schemaVersion'),
          schema must have a 'type' key.
```

The current research schema defines:

```text
schemaVersion: { const: RESEARCH_PROMOTION_CANDIDATE_SCHEMA_VERSION }
```

without an explicit JSON Schema type.

## Static compatibility surface

The same untyped `const` / `enum` pattern exists in other structured-model schemas, including current planner and worker surfaces. Examples include:

```text
lib/repo-planner-admission.js
  schemaVersion: { const: ... }

lib/worker-result.js
  schemaVersion: { const: ... }
  status: { enum: ... }
  operation.type: { const: ... }

lib/repo-research-promotion.js
  schemaVersion: { const: ... }
  finding.kind: { enum: ... }

lib/delegation-round3-frontier.js
  schemaVersion: { const: ... }
  decisions / gate kinds: { enum: ... }
```

This inspection does **not** claim every downstream schema has independently failed live. It establishes that the exact API-rejected schema pattern is not unique to research promotion and should be checked mechanically in the R2 repair.

## What was not measured

F2/F4 never reached logical planner boot under current production, so R1 did not obtain valid planner token/context cost, prompt success, or semantic-constraint/closure behavior from those fixtures.

Do not convert the missing measurement into a prompt-optimization project.

## Deletion-first interpretation

The observed defect does not justify a provider framework, model personality layer, automatic prompt optimizer, or richer ACI.

R2 should first compare the two smallest compatibility repairs at the existing shared structured-output membrane:

```text
A. simplify/delete provider-side schema machinery where local deterministic validation is sufficient
or
B. make only the retained provider-side schemas type-complete/accepted by the current API
```

The chosen repair must preserve existing local schema validation and authority checks. Do not weaken output validation to make the model call green.

For the research promoter specifically, the non-Git content-only temp directory also requires the existing Codex automation affordance `--skip-git-repo-check`; that is a narrow invocation correction, not a new substrate.

## Decision

Measured failure class:

```text
agent/artifact legibility / ACI
→ specifically current structured-model invocation/schema compatibility
```

Nearest production correction belongs in R2 ADAPT. Prompt simplification is **not yet warranted** because the benchmark did not reach prompt behavior.
