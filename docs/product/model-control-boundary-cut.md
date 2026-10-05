# Model Control Boundary — Cut 3

Status: implementation contract for preventing model-invented human gates
Date: 2026-10-04

## Product problem

Cut 1 made presentation a late-bound projection. Cut 2 made the default text projection compact and prevented control-plane narration from leaking into ordinary human output. Those cuts protect egress after product state has already been classified.

The remaining failure is upstream: a model can still reinterpret a reversible method, evidence policy, missing preferred route, or repository-local control word as a reason that the owner must grant permission before work can continue.

Historical transcripts expose three recurring shapes:

1. consent stall — asking for a second GO or saying execution will happen only "if you want me to";
2. model self-authorization — treating conversational agreement as a newly minted authorization token;
3. methodology/control category error — describing bounded acquisition, holdout construction, preregistration, validation, review, or evidence custody as generic execution authority.

These are reasoning-boundary errors, not presentation errors.

## Desired result

    Outcome + Observation + Invariant + Capability + Fact
                         |
                         v
                   model reasoning
                         |
                         v
          reversible Action / explanation
                         |
                  no human gate
                         |
                         v
             exact physical effect call
                         |
                         v
          controller classifies consequence
                /                  \
        ordinary effect          human-only effect
             |                         |
          continue               typed ownerEffect
                                      |
                                      v
                            HumanHandoffEnvelope
                                      |
                                      v
                              Need input — ...

The model never manufactures the final transition on the right.

## First-principles classification

| Observation | Correct primitive | Consequence |
| --- | --- | --- |
| Fixed first-N acquisition rule, frozen holdout, preregistration, validation, review, evidence custody | Method / Invariant / Action | Execute when in scope and physically available |
| Preferred provider, tool, filesystem operation, or authenticated route is unavailable | Capability observation | Try another in-scope means or report the concrete capability gap |
| Repository uses words such as authority, admission, court, freeze, capital authority, or source authority | Repository/domain data | Preserve its domain meaning; do not promote it into generic Meta-Harness control |
| A reversible route failed | Observation / failed means | Recompute a materially different Action |
| Material product choice, real scope expansion, protected credentials/access, publication, destructive/irreversible external action, material-risk acceptance, ambiguous non-replayable effect | Exact effect-boundary fact | Controller may create typed human input |
| Model says the owner should GO/approve/authorize ordinary continuation | Invalid model control claim | Reject at model boundary |

Epistemic rigor and execution authority are orthogonal. A clean experiment may require a bounded sampling rule, a blinded candidate freeze, and later adjudicated gold. None of those facts inherently creates a human approval step.

## Model-facing law

The shared runtime prompt states the positive rule without teaching models a generic authority ontology:

- method and evidence discipline do not by themselves create a pause;
- capability absence is an observation, not new human work;
- reversible in-scope continuation needs no second conversational handshake;
- only the controller can establish required human input at the exact physical consequence boundary;
- repository-local control vocabulary remains domain data.

Role prompts specialize that law:

- logical planner: never encode human reconfirmation as Outcome, doNow, doneWhen, or stopOnlyIf;
- coding worker: report concrete failed means/capability gaps and keep searching for reversible alternatives;
- read-only interaction: explain or recommend the next action without turning the explanation into a signoff request.

## Deterministic output firewall

Prompting alone is not the safety property.

A small deterministic classifier checks only model-authored control-bearing text. It rejects known model-created human-gate forms such as:

- `Decision needed: ...`
- `reply GO ...`
- `if you want me to execute ...`
- `I’ll treat this as authorization ...`
- requests for owner approval/permission before ordinary continuation
- methodology labels such as `sampling authority` or `acquisition authority`

The classifier intentionally does not scan arbitrary file/code payloads or raw evidence. Quoted and fenced counterexamples are ignored, and concrete capability evidence such as `HTTP 401 Unauthorized` remains valid.

Boundary placement:

    logical planner semantic fields  -> reject invented human gate
    coding worker control fields     -> reject invented human gate
    read-only answer                 -> reject invented human gate

The controller-owned `ownerEffect` path is unchanged and remains the only normal route to `humanStopRequired=true`.

## History-derived regression corpus

The cut retains dirty shapes rather than one exact sentence. Representative regressions include:

- `Path B — authorize a bounded acquisition slice`
- `I’ll treat this as authorization to proceed ...`
- `I’m treating your instruction as the new bounded GO ...`
- `Decision needed: reply GO ...`
- `If you want me to execute it ...`
- `Do you want to authorize a fallback model ...`
- `Wait for the owner before continuing ...`
- `Ask the owner for approval before ...`
- `sampling authority`

Counterexamples must remain legal:

- a bounded acquisition rule expressed as experiment design;
- a missing authenticated capability reported as such;
- explicit text saying no human reconfirmation is needed;
- a future publication boundary described without pre-blocking local work;
- quoted or fenced examples of bad language used for explanation or tests.

## Non-goals

This cut does not:

- remove repository/domain-specific authority vocabulary;
- infer owner effects from model prose;
- broaden the existing typed ownerEffect kinds;
- add an approval service, permission record, admission layer, or new lifecycle state;
- make regex text matching product truth;
- modify PRODUCT.md;
- change presentation modes.

## Done when

1. planner, coding-worker, and read-only model boundaries share the positive control-classification law;
2. history-derived consent-stall, self-authorization, and methodology-as-authority cases are mechanically rejected;
3. legitimate capability observations, quoted counterexamples, and domain evidence remain representable;
4. planner evaluation treats invented human escalation as a hard failure, not a harmless style issue;
5. existing prompt tests still prove that generic permission/authorization vocabulary is not reintroduced into the model mental model;
6. focused model-boundary, planner, worker, interaction, handoff, and presentation regressions pass;
7. `git diff --check` passes and unrelated pre-existing working-tree changes remain untouched.
