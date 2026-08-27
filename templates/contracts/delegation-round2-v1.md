# Delegation Round 2 v1

`meta-harness-delegation-round2/v1` is the contract seam between authoritative Meta-Harness product truth and DevSpace `DELEGATION-R2`. It adds deterministic lane memory and compact fan-in only. It is not a scheduler, lifecycle controller, World writer, Grill, or runtime router.

## Boot memory

Meta-Harness compiles one bounded DevSpace-compatible memory packet from durable truth:

```text
owner-authored PRODUCT Endgame
→ authoritative current World + WorldHead provenance
→ explicit current gate
→ immutable evidence index
```

The DevSpace context order is fixed:

```text
original endgame
→ current accepted World
→ current gate
→ lane-specific brief
→ evidence index
→ execution instructions
```

The original endgame comes from the exact `PRODUCT.md` Endgame projection. The current World comes from authoritative `world-head/v2` plus its current World object, encoded deterministically. Repository status prose, parent chat, sibling conversations, and newer mutable World state are not memory sources.

Each lane names exactly one immutable `outcome/v1`. Meta-Harness derives two acceptance criteria mechanically:

```text
desired-state         = Outcome.desiredState
evidence-requirement  = Outcome.evidenceRequirement
```

The contract computes the exact `delegation-context/v1` digest expected by DevSpace. A different context digest, lane objective, or criterion set fails fan-in acceptance.

## Compact fan-in

DevSpace returns `lane-result-card/v1` cards through `get_delegation`. Meta-Harness reduces those cards into `meta-harness-delegation-acceptance/v1` without child transcripts.

Per lane the matrix retains:

```text
lane / Outcome identity
server-bound task + workspace identity
lane-brief + boot-prompt digests
PASS | FAIL | UNKNOWN | PENDING | CANCELLED
criterion verdicts + evidence refs
compact evidence summaries
advisory worldDelta
remaining uncertainty
recommended handoff
```

`worldDelta` is evidence only. This contract never mutates World or changes Claims.

Raw transcript/message fields are rejected. Normal acceptance also rejects selectively expanded evidence bodies; compact cards are the default input.

## Selective evidence

If one compact criterion is disputed, Meta-Harness may compile one bounded `get_delegation` evidence request containing 1–10 refs already named by that lane's compact result. The evidence response must contain exactly those refs for exactly that lane. Extra or cross-lane evidence fails closed.

## Round boundary

Round 2 ends at deterministic memory boot + compact acceptance. Do not add here:

- Grill challenges;
- DONE/HOLD/obsolete lane lifecycle;
- capacity refill or kill policy;
- frontier/gate scheduling;
- automatic World landing;
- runtime/fidelity routing.

Those require later product rounds and observed journey need.
