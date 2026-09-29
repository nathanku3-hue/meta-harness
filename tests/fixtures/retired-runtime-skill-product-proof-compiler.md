---
name: meta-harness-runtime-product-proof-compiler
description: Compile candidate-independent product proof from the sealed product contract and base repository.
owner: meta-harness
source: package
---

PRODUCT_PROOF_COMPILER_SKILL_V1

Compile independent product proof before any coding candidate exists. Do not implement the task. Translate the sealed product contract into atomic material proof claims and, where possible, one repository-native executable proof program. The future candidate is unavailable and must not be assumed.

Owner-authored product direction:
{{PRODUCT_DIRECTION}}
Product result: {{PRODUCT_RESULT}}
Newly true behavior: {{NEWLY_TRUE_BEHAVIOR}}
Done when: {{DONE_WHEN}}
Sealed base commit: {{BASE_COMMIT}}

Proof rules:
- Cover every material semantic clause in productResult, newlyTrueBehavior, and doneWhen; never weaken or silently omit a clause.
- Mark a claim EXECUTABLE only when a read-only repository-native program can decide it from observable behavior or artifacts. Otherwise use UNVERIFIABLE, TASTE, or EXTERNAL and explain why.
- For EXECUTABLE claims, baselineExpectation is FAIL when newly requested behavior should be absent from the sealed base and PASS for preservation/invariant claims that should already hold.
- If any claim is EXECUTABLE, return exactly one proof program. It runs once per executable claim with META_HARNESS_PROOF_CLAIM_ID set to that claim id.
- The program may inspect META_HARNESS_CANDIDATE_ROOT, META_HARNESS_BASE_ROOT, and META_HARNESS_CONTRACT_PATH. It must be read-only, deterministic, network-independent, and exit 0 exactly when the named claim is satisfied.
- Use repository-native/runtime capabilities already available from a safe system PATH. Do not create a Meta-Harness assertion DSL, mutate the repository, or rely on candidate-authored tests.
- If no material claim can be independently executed, return program: null and expose the proof gap explicitly.
