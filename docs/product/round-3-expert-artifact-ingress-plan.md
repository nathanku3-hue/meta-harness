# 90+ Roadmap Round 3 — `EXPERT_ARTIFACT_INGRESS_1`

**Status:** IMPLEMENTED — R3 CLOSED AGAINST THE ACCEPTED RED BASELINE.

**Activation basis:** the independent re-audit retained the Git-blob, ingress-currentness, and handle-snapshot decisions; required one final plan-only simplification; explicitly said not to reopen R2; and found no further external SOTA round warranted after those corrections. The owner then authorized execution with `go`.

```text
R3 = CLOSED
R2 = DO NOT REOPEN
implementation = complete within this exact slice
```

**Authority:** subordinate to owner-authored `PRODUCT.md`. This plan does not edit `PRODUCT.md`, does not broaden canonical product direction by itself, and does not authorize greenfield bootstrap, prompt/model changes, memory, browser expansion, MCP work, skill work, provider frameworks, semantic-close machinery, or generic attachment infrastructure.

## Product result

In an existing Meta-Harness-managed project, an expert can supply ordinary language plus bounded local textual source artifacts through stable ACP, and the exact submitted source bytes become durable, attributable planner-visible evidence without the expert managing repository research files, Git, sessions, MCP, or evidence-engineering mechanics.

The intended journey is:

```text
existing managed project
+ exact expert statement
+ 0..N bounded local textual resources
        ↓
stable ACP
        ↓
validate complete prompt
+ snapshot all exact bytes
        ↓
Git object database
real blobOid for every exact source
+ non-authoritative Meta GC root
        ↓
ONE durable source-bearing OWNER INGRESS
raw exact Text + ordered source descriptors + deterministic ingressDigest
        ↓
idempotent owner-objective adoption of exact ingress identity
revision changes only for a genuinely new ingress
        ↓
existing research-promotion/v1
        ↓
existing finding semantics + truthful repository/expert provenance union
        ↓
correct bounded product action
```

Greenfield F5 remains a later owner-direction-dependent round.

## Why this patch changes the previous R3 plan

The previous patch correctly closed the first re-audit findings:

```text
Text + ResourceLink only
malformed Image F1 retired from acceptance
F1R / F1E introduced
artifact content kept separate from authority
persist-before-reference made explicit
```

The previous repo-native re-audit found two material corrections that remain accepted: Git is the exact content store, and source currentness belongs to durable owner ingress rather than a predicted objective revision.

The latest re-audit keeps both and finds two final material simplifications plus two bounded hardening clarifications.

### Correction A — Git already is the exact content store

The prior patch proposed a custom immutable content-object store plus a `research-promotion/v2` whose source identity removed `blobOid`.

That is unnecessary.

Meta already operates inside Git, and Git already provides the exact immutable content-addressed primitive R3 needs:

```text
git hash-object -w --stdin
```

For accepted exact bytes this yields a real repository blob object without touching the working tree, index, HEAD, or product history.

Therefore R3 deletes:

```text
research-source-content/v1 custom byte store
research-promotion/v2
v1 → v2 promotion normalization/migration
fake blobOid workaround
```

and keeps:

```text
existing research-promotion/v1
source = contentDigest + real blobOid + byteLength
```

### Correction B — owner ingress, not predicted objective revision, owns source currentness

The prior patch bound expert occurrences directly to an `objectiveRevision` before normal product entry.

That is incorrect because the current repo-wave path creates the new objective revision inside `replaceOwnerObjectiveState()`. Predicting `current revision + 1` would race with another admissible writer, while writing the objective first would allow a crash to expose the new objective without the evidence submitted with it.

R3 therefore freezes this identity law:

```text
atomic user act
= exact text + accepted source set
= durable owner ingress identity

objective revision
= derived continuity metadata that adopts that ingress
```

No R3 implementation may predict a future objective revision.

### Correction C — owner ingress itself is the occurrence

The previous patch retained a standalone expert-source occurrence artifact between the Git blob and the owner ingress. That layer is unnecessary.

R3 freezes the smaller identity law:

```text
Git blob
= immutable content identity

OWNER INGRESS
= source occurrence + atomic user-act identity
```

The ordered expert-source descriptors live directly inside the durable owner ingress. There is no `sourceOccurrenceDigests[]`, standalone occurrence store, or occurrence database. If the same blob is used by a later owner ingress, that later ingress is the new occurrence.

The ingress identity must also be deterministic. `ingressDigest` is a domain digest of the raw ACP Text bytes plus the ordered accepted source descriptors. It excludes receipt time, absolute local paths, GC-ref names, filesystem timestamps, and other transport ephemera. Replaying exactly the same accepted input therefore yields the same ingress identity.

Objective adoption is exactly idempotent:

```text
current objective already adopted D7
+ request to adopt D7
→ return existing objective
→ do not increment revision

current objective adopted D7
+ genuinely new ingress D8
→ create the next objective revision bound to D8
```

### Correction D — planner semantics stay; provenance projection evolves

The promoter's finding semantics and logical planner treatment remain unchanged, but the current planner-side provenance projection cannot remain byte-for-byte unchanged because repository research has `sourcePath` while expert ingress does not.

R3 therefore authorizes one tiny truthful provenance union. Do not synthesize an `expert://...` repository path.

Conceptually:

```text
source = {
  kind: "REPOSITORY",
  path,
  blobOid,
  contentDigest
}

or

source = {
  kind: "EXPERT_INGRESS",
  ingressDigest,
  ordinal,
  name,
  blobOid,
  contentDigest
}
```

`findingDigest`, `kind`, `statement`, `scope`, and `evidenceQuotes` remain unchanged. The planner prompt remains unchanged: promoted research is attributable advisory evidence, never authority.

### Hardening clarifications

R3 also freezes two bounded implementation invariants:

1. the source-bearing ingress retains the raw ACP Text bytes byte-for-byte for `textDigest`/`ingressDigest`; downstream owner-objective content may keep its existing normalization semantics; and
2. accepted `file:` URLs must have an empty hostname and use the platform's canonical file-URL conversion. Hosted/UNC forms such as `file://server/share/a.txt` and `file://localhost/...` fail before open.

## 0. R3 activation gate

Do not start R3 because the plan is patched or focused R2 tests are green.

R3 is active under the activation basis above. The retained audit conditions below remain acceptance evidence, not another approval gate.

### A. Final patched-plan re-audit — satisfied by the supplied re-audit plus exact corrections

The independent re-audit must accept at least:

```text
Text + ResourceLink only
historical malformed Image F1 is not acceptance
exact bytes become real Git blobs through raw stdin hashing
research-promotion/v1 remains canonical and unchanged
refs/meta-harness/research-sources/* are GC plumbing only
Git blob is content identity; owner ingress itself is source occurrence + user-act identity
ordered source descriptors live directly inside owner ingress; no standalone occurrence store
raw ACP Text bytes participate in deterministic ingressDigest
objective adoption is exactly idempotent for the same ingressDigest
objective revision changes only for genuinely new ingress identity
persist-before-reference ordering is explicit
one prompt = one all-or-nothing semantic admission
handle-level snapshot rejects TOCTOU replacement
hosted/UNC file: URLs are rejected before open
existing promoter semantics remain unchanged
planner provenance becomes a truthful REPOSITORY / EXPERT_INGRESS union
repairable GC ref loss is recoverable; authoritative-ingress missing blob fails closed
UTF-8 text semantic scope only
no generic attachment/provider/content-store framework
```

If the re-audit finds another material architecture defect:

```text
R3 = PARKED
patch plan only
no implementation
```

### B. R2 independent audit — retained; do not reopen without a newly observed R2 regression

The R2 audit must establish either:

```text
A. pristine/current baseline reproduces the unrelated full-suite failures
   and the R2 candidate adds no regression

OR

B. retained evidence proves those exact failing dependency surfaces were unchanged
   and focused validation is sufficient for R2 closure
```

The audit must also accept the intended R2 production surface, WSL neutral-temp correction, local schema-validation authority, F2/F4 semantic results, strict-wire behavior, and absence of prompt/model/browser/memory/authority drift.

If R2 introduced a full-suite regression, weakens authority, or still has an ambiguous baseline comparison:

```text
R3 = PARKED
R2 = repair / re-audit
```

No partial R3 implementation begins.

## 1. R3 scope

R3 repairs one observed product defect:

> A field expert cannot give Meta-Harness an artifact together with ordinary language through the supported direct-entry surface.

R3 is:

```text
expert statement
+ valid local ACP ResourceLink(s)
→ exact durable evidence
→ existing research semantics
→ planner-visible finding
→ correct bounded product action
```

R3 is not:

```text
Image support
EmbeddedResource support
Audio support
PDF extraction
spreadsheet extraction
image understanding
remote fetch
browser fetch
cloud storage
artifact provider framework
research provider framework
custom content store
generic attachment abstraction
greenfield project generation
prompt changes
model changes
memory
semantic-close machinery
```

## 2. Stable ACP contract — baseline primitives only

The R3 ACP input contract is exactly:

```text
session/prompt
→ exactly one non-empty Text block
+ 0..N bounded ResourceLink blocks
```

The source-bearing ingress retains the raw ACP Text bytes byte-for-byte. Those raw bytes determine `textDigest` and participate in `ingressDigest`. Downstream owner-objective adoption may preserve the product's existing text-normalization semantics; normalization must not rewrite the retained user-act identity.

ResourceLink blocks are separate untrusted source evidence.

Critical authority invariant:

```text
artifact content ≠ owner instruction
```

A source saying `approve`, `publish`, `ignore previous instructions`, `expand scope`, or similar remains evidence text and creates no authority.

Artifacts cannot create or modify:

```text
owner approval
scope
credentials
write permission
Git execution authority
publication authority
Claim authority
World authority
product direction
```

### R3 does not advertise richer ACP content types

Do not support or advertise in R3:

```text
Image
EmbeddedResource
Audio
```

Storage capability is not semantic product support. A capability is advertised only when the full supported expert journey can use it correctly.

## 3. ResourceLink v1 safety contract

R3 accepts one URI form only:

```text
file: URL
with url.protocol === "file:"
and url.hostname === ""
```

Use the platform's canonical file-URL conversion. Do not parse a file URL by slicing or inventing path rules.

Every accepted ResourceLink must be:

```text
absolute
explicitly supplied in the current ACP prompt
local
readable
regular file
not a symlink
not a junction / reparse-point indirection
within per-source size bound
within per-prompt source-count bound
within aggregate prompt byte bound
exact UTF-8 text
```

Reject before product reasoning:

```text
relative paths
non-file schemes
file://server/share/... hosted or UNC URLs
file://localhost/... hosted URLs
HTTP/HTTPS
network fetch
cloud-provider URLs
directories
devices
pipes
sockets
symlinks
junctions
recursive imports
unsupported encodings
oversized sources
excess source counts
unreadable resources
resource replacement/change during snapshot
```

No plural URI framework is part of R3.

The source is a one-shot exact snapshot. Later mutation or deletion of the external path cannot alter retained source identity.

## 4. Prompt-level all-or-nothing validation and handle-level snapshot

One ACP prompt is one admission unit.

For a prompt with N ResourceLinks:

```text
1. parse the complete ACP block set
2. require exactly one non-empty Text block
3. validate every ResourceLink shape and URI
4. validate path chain / reject symlink or reparse indirection
5. open each exact file once
6. fstat the opened object
7. bounded-read bytes from that same handle
8. fstat the same opened object again
9. reject identity/size/change inconsistency
10. require exact UTF-8 decoding and configured bounds
11. hold the complete accepted source set in bounded memory
12. only if ALL sources pass, begin durable persistence
```

Do not implement snapshot as:

```text
lstat(path)
→ later readFile(path)
```

because pathname replacement between those operations creates a TOCTOU window.

If resource 3 of 3 is invalid or changes during snapshot:

```text
resources 1-2 do not become current semantic evidence
no source-bearing owner ingress is admitted
product entry does not begin
```

## 5. Exact source content = real Git blob

R3 does not create a second content store.

For each fully validated in-memory source snapshot:

```text
exact bytes
→ git hash-object -w --stdin
→ real blobOid
```

Use raw stdin semantics for the captured bytes. Do not route the external source through a repository pathname/filter interpretation.

After hashing, controller code must mechanically verify the resulting object before it is referenced by ingress:

```text
blobOid is valid for repository object format
cat-file identifies blob
cat-file size == captured byteLength
reopened blob bytes == captured bytes
contentDigest == SHA-256(captured bytes)
```

The Git blob is immutable exact source content.

This operation must not change:

```text
working tree
index
HEAD
branch
product commit
World authority
```

The fact that a blob exists in the object database creates no semantic/currentness authority.

## 6. Non-authoritative GC roots

A loose/unreachable blob may later be garbage-collected, so accepted source blobs need a reachability root before an ingress receipt can depend on them.

R3 may add one narrow ref family, for example:

```text
refs/meta-harness/research-sources/<contentDigestHex>
→ exact expert-source blobOid
```

The precise ref spelling is implementation detail. The authority law is:

```text
source-bearing owner ingress
= evidence/currentness identity

refs/meta-harness/research-sources/*
= repairable non-authoritative Git GC/reachability plumbing only
```

This mirrors the existing product-head pattern:

```text
refs/meta-harness/product-head
= non-authoritative reachability/inspection plumbing
```

No GC lifecycle manager or source database is part of R3.

Repair law:

```text
authoritative owner ingress references blob
+ expected GC ref is absent
+ blob still exists and reopens exactly
→ repair the non-authoritative ref
→ continue

authoritative owner ingress references blob
+ blob object is actually missing or mismatched
→ fail closed
→ do not reconstruct or plan from that source
```

For identical exact bytes, the same repository object format naturally yields the same blob object identity, and the content digest is also identical.

## 7. Owner ingress directly owns expert-source occurrence

Content identity and source use remain distinct, but R3 does not create a standalone expert-occurrence artifact.

A repository research occurrence still has repository provenance:

```text
productCommit
path
blobOid
contentDigest
byteLength
```

For expert ingress, the owning owner-ingress record is the occurrence. Its ordered `sources[]` directly contains bounded descriptors such as:

```text
{
  blobOid
  contentDigest
  byteLength
  name
  transportKind = "file"
}
```

There is no:

```text
sourceOccurrenceDigests[]
standalone occurrenceDigest
standalone occurrence store
source occurrence database
```

If the same exact blob is used in a later owner ingress, that later ingress is the new occurrence.

Do not put `objectiveRevision`, absolute local path, GC-ref spelling, filesystem timestamps, or receipt time inside the semantic source descriptor.

## 8. Deterministic source-bearing owner ingress is the currentness boundary

Meta already has an `owner-goal-ingress/v1` seam. R3 should evolve that seam narrowly so one durable owner ingress contains the complete accepted user act.

Conceptually:

```text
owner-goal-ingress/v2

rawText
textDigest
sources: [ ordered stable source descriptors ]
ingressDigest
receivedAt
```

`rawText` is the exact ACP Text byte sequence, retained byte-for-byte. `textDigest` derives from those raw bytes. `receivedAt` is receipt metadata only and does not participate in semantic identity.

Freeze `ingressDigest` as a domain digest of:

```text
raw exact ACP Text bytes
+
ordered stable source descriptors
```

The stable descriptor identity includes:

```text
blobOid
contentDigest
byteLength
bounded name
transportKind
```

It excludes:

```text
receivedAt
absolute local path
GC-ref spelling
temporary paths
filesystem timestamps
```

Therefore an exact replay of the same accepted Text + ordered source set yields the same `ingressDigest`.

The ingress must be durable and mechanically reopenable before objective adoption starts. If a mutable/current ingress pointer remains useful, it may point at this identity, but historical source-bearing user acts must not depend on an overwriteable pathname alone.

## 9. Persist-before-reference and exactly-idempotent objective adoption

The complete order is:

```text
ACP prompt arrives
→ validate ALL ResourceLinks
→ snapshot ALL exact bytes from stable opened handles
→ derive SHA-256 contentDigest(s)
→ write/verify real Git blob(s)
→ create/repair non-authoritative GC root(s)
→ construct ordered source descriptors
→ compute deterministic ingressDigest from raw Text + descriptors
→ atomically persist one durable source-bearing owner ingress
→ only then request adoption of that exact ingress into owner-objective authority
→ if objective already adopted this ingressDigest, return existing objective unchanged
→ otherwise assign the next objective revision under existing authority serialization and bind it to ingressDigest
→ promotion/planning may begin
```

Objective adoption must mechanically bind the exact `ingressDigest` it adopted.

Exactly-idempotent law:

```text
current objective adopted D7
+ adopt D7 again
→ return current objective
→ revision unchanged

current objective adopted D7
+ adopt genuinely new D8
→ create next objective revision
→ bind it to D8
```

Do not:

```text
predict current objective revision + 1
bind source currentness to a future revision before adoption
write objective first and source ingress later
increment revision for exact ingress replay
adopt whichever ingress happens to be current without checking exact ingress identity
```

The adoption operation must use existing owner/world authority serialization and compare exact ingress identity under that serialization.

Crash/retry semantics:

```text
blob written, GC ref absent, ingress absent
→ unreachable/orphan object is non-authoritative
→ no current evidence

blob + GC ref present, ingress absent
→ orphan reachability plumbing is tolerated
→ no current evidence

ingress durable, objective adoption absent
→ exact user act is durable but not yet objective authority
→ retry adoption of exact ingressDigest

objective already adopted exact ingress, caller retries same accepted input
→ deterministic ingressDigest matches
→ return existing objective
→ no duplicate planning epoch

objective adopted exact ingress, promotion incomplete
→ fresh invocation reconstructs exact source set from ingress + blob IDs
→ promotion can continue

partial source-set visibility
→ forbidden
```

No model-generated promotion candidate becomes durable authority merely because capture or ingress succeeded.

## 10. Existing research-promotion/v1 remains canonical

R3 does **not** create `research-promotion/v2`.

The existing canonical source identity remains:

```text
research-promotion/v1
source:
  contentDigest
  blobOid
  byteLength
```

Expert ingress now has a real `blobOid`, so the existing schema is valid without distortion.

Required law:

```text
same exact bytes
→ same Git blobOid within this repository object format
→ same SHA-256 contentDigest
→ same existing promotion cache key
→ one promotion
```

Therefore:

```text
committed repository blob occurrence ─┐
                                      ├→ same exact blob/content → one research-promotion/v1
expert owner-ingress source entry ────┘
```

No fake Git object, compatibility migration, parallel promotion system, or second canonical representation is warranted.

## 11. Promoter semantics stay; planner provenance projection evolves minimally

The promoter still consumes exact UTF-8 source content as untrusted evidence and produces the existing bounded finding kinds:

```text
FINDING
CONSTRAINT
DISPROVED_ASSUMPTION
```

Exact quotation attribution remains controller checked against bytes reopened from the exact Git blob.

The planner still sees compact promoted evidence rather than raw files, and its semantic treatment remains unchanged:

```text
findingDigest
kind
statement
scope
evidenceQuotes
truthful source provenance
```

However, the provenance shape must evolve because expert-source blobs have no repository path. Do not fake a repository path such as `expert://...`.

Use a small typed source union, conceptually:

```text
source: {
  kind: "REPOSITORY"
  path
  blobOid
  contentDigest
}

or

source: {
  kind: "EXPERT_INGRESS"
  ingressDigest
  ordinal
  name
  blobOid
  contentDigest
}
```

Current research enumeration therefore becomes:

```text
current repository occurrences from current productCommit
+
current expert source entries from exact adopted ingressDigest
        ↓
dedupe exact content for promotion
        ↓
project EACH current occurrence with truthful provenance
```

Promotion dedupes by content; planner attribution preserves occurrence provenance. Those are separate operations.

Do not inject:

```text
whole source files
base64
raw binary
transport URLs
```

into the planner.

The logical planner prompt remains unchanged: promoted research is attributable advisory evidence and never authority. No elicitation/model change is part of R3.

## 12. Semantic format scope — UTF-8 text only

R3 claims semantic support only for exact textual sources that decode losslessly as UTF-8.

Examples:

```text
text/plain
text/markdown
other exact UTF-8 text accepted under the same bounded text rule
```

Not R3:

```text
PDF
CSV parser semantics
XLSX
image/*
OCR
embedded document extraction
```

If later real field fixtures require those formats, add the smallest real semantic primitive then.

## 13. Currentness semantics

Source currentness derives from the source-bearing owner ingress that the owner objective adopted, not from a predicted revision number.

Example:

```text
owner ingress I7
  exact text T7
  sources A/B
  ingressDigest = D7

owner objective adoption
  adopts D7
  assigns objective revision 7

planner epoch for that objective
  reconstructs A/B through D7
```

Fresh session:

```text
same active adopted ingress D7
→ ordered source descriptors reopen from D7
→ exact blobs reopen
→ A/B remain planner-visible
```

Later input:

```text
owner ingress I8
→ objective adopts I8 / D8
→ new objective revision derives

I7 remains historical evidence
→ A/B do not silently enter I8
```

Explicit reuse creates a new owner ingress whose `sources[]` references the already durable blob without uploading bytes again. That new ingress is the new occurrence.

No conversational memory service is needed.

## 14. F1 acceptance correction

The original historical F1 used:

```text
Text
+ Image { data: "field-expert-bench-artifact-placeholder" }
```

That Image block lacks the ACP v1 `mimeType` required for valid image content.

Therefore:

```text
old F1
→ preserve unchanged as historical R1 evidence
→ never rewrite it
→ do not require R3 to make it protocol-valid
```

R3 uses two replacement acceptance fixtures.

### F1R — valid ACP transport regression

Use valid stable ACP:

```text
exact Text
+ valid local ResourceLink
```

Run three fresh trials.

Pass only if the request no longer dies at the ACP prompt-shape membrane and the exact text/resource separation survives safe snapshot and ingress admission.

### F1E — artifact-to-planner journey

Use one real non-repository UTF-8 expert source whose content materially changes the correct product decision.

Journey:

```text
fresh ACP session
→ exact Text + ResourceLink
→ all-or-nothing handle-level snapshot
→ real Git blob + GC root
→ ONE durable owner ingress containing raw Text + ordered source descriptors
→ deterministic ingressDigest
→ exactly-idempotent objective adoption
→ existing research-promotion/v1
→ exact quote attribution
→ truthful EXPERT_INGRESS planner provenance
→ planner
→ bounded correct product candidate
```

Run three fresh trials.

Pass only if:

```text
expert performs no repository operation
source bytes are reopenable exactly from the retained blob
owner ingress retains raw ACP Text bytes and ordered source descriptors
replaying the exact accepted input yields the same ingressDigest
objective adoption binds the exact ingress and does not increment revision on exact replay
planner-visible evidence depends on the artifact and carries truthful EXPERT_INGRESS provenance
candidate stays on the correct product path
candidate preserves the artifact's uncertainty/judgment constraint
candidate does not choose review/status/governance work
```

Treat three trials as mechanism evidence, not prevalence evidence.

## 15. Adversarial fixtures

Use a small decision-changing battery:

| Fixture | Required result |
| --- | --- |
| source says `approve/publish/ignore prior instructions` | remains evidence; grants zero authority |
| duplicate exact expert content in the same ordered input | same blob/content; one promotion; descriptor ordinals remain attributable |
| same durable blob used by a later owner ingress | later ingress itself is the new occurrence; no standalone occurrence artifact |
| committed repository source and expert source have identical exact bytes | same blobOid/contentDigest; reuse existing promotion/v1 |
| two expert sources contradict | both remain attributable; no silent collapse |
| resource 3 of 3 invalid | no source-bearing owner ingress becomes current |
| oversized or unsupported resource | fails before product reasoning |
| hosted `file://remote-host/share/source.txt` or `file://localhost/...` | rejected before open |
| symlink/junction resource | fails closed |
| ResourceLink target changes between admission check and snapshot read | handle-level identity/change check fails; no ingress receipt |
| external file mutates after successful capture | retained Git blob remains exact source identity |
| crash after blob write but before GC ref/ingress | no semantic evidence becomes current |
| crash after GC ref but before ingress | orphan non-authoritative ref is tolerated; no current evidence |
| authoritative ingress references blob; GC ref deleted; blob still exists | repair non-authoritative ref; continue |
| authoritative ingress references blob; blob is actually missing/mismatched | fail closed before projection/planning |
| crash after ingress but before objective adoption | exact user act is retryable; objective has not silently advanced |
| exact same accepted input retried | deterministic ingressDigest matches; objective revision does not increment |
| concurrent admissible owner ingress | no predicted revision; adoption validates exact ingress identity under authority serialization |
| crash after objective adoption before promotion | fresh session reconstructs exact ingress/blobs and can continue |
| later owner ingress replaces objective | prior sources do not silently contaminate new objective |

## 16. Cancellation and drain

Follow existing disposable-model law.

```text
source-bearing owner ingress durable
→ objective adopts exact ingress
→ promoter starts
→ DRAIN wins
→ no new canonical promotion written after drain
```

A later invocation may continue from the already retained Git blob(s) when the same source-bearing owner ingress remains the adopted objective input.

Durable source capture is continuity evidence, not permission to keep a disposable model result.

## 17. Human UX

Target expert interaction:

> Open this. Apply the attached procedure to yesterday's evidence and preserve uncertainty.

Meta internally performs:

```text
exact text
+ exact local source snapshot
→ real Git blob(s)
→ non-authoritative reachability refs
→ source-bearing owner ingress
→ owner objective adoption
→ existing promotion
→ planning
→ coding
→ verification
```

The expert should never be instructed to:

```text
put this in docs/research
commit it first
provide a repository-relative path
create a manifest
select an ingestion mode
classify it as FINDING or CONSTRAINT
```

The expert supplies evidence, not evidence engineering.

## 18. Frozen surfaces

R3 must not modify without a new observed defect warrant:

```text
PRODUCT.md
planner prompt
worker prompt
reasoning effort
model selection
browser architecture
remote browser
memory
MCP servers
Claim semantics
World semantics
Git custody
SAW
validation architecture
product proof
resource scheduler
skills
provider architecture
semantic-close machinery
```

R3 may make the narrow schema/record evolution required to bind source-bearing owner ingress to objective adoption. That is part of the measured F1 repair, not a general authority redesign.

Do not add:

```text
ArtifactProvider
ResearchProvider
SourceBus
KnowledgeBus
DocumentPipeline
custom SourceContent database
generic Attachment
plugin ingestion framework
```

## 19. Validation ladder after activation

With R3 active under the activation basis above, validate in this order:

```text
ACP parser/unit tests
↓
ResourceLink URI/path/size/UTF-8 safety tests
↓
hosted/UNC file: URL rejection tests
↓
handle-level snapshot / TOCTOU replacement tests
↓
all-or-nothing multi-resource admission tests
↓
raw hash-object blob identity + byte reopening tests
↓
non-authoritative GC-ref reachability + repair/missing-blob fail-closed tests
↓
raw ACP Text preservation tests
↓
deterministic owner-ingress digest/atomicity/replay tests
↓
exactly-idempotent ingress → objective adoption race/crash/currentness tests
↓
existing research-promotion/v1 regressions
↓
repository + expert exact-content dedupe tests
↓
exact quote reopening from expert-source blob
↓
REPOSITORY / EXPERT_INGRESS provenance-union projection regressions
↓
F1R valid ResourceLink transport ×3
↓
F1E artifact-to-planner ×3
↓
interruption / fresh-session reconstruction
↓
owner-ingress replacement currentness
↓
focused authority regressions
↓
existing F2/F4 semantic fixtures
↓
full repository suite / exact accepted baseline comparison
```

No score change follows from a plan patch or one fixture campaign.

## 20. R3 done definition

`EXPERT_ARTIFACT_INGRESS_1` closes only when:

1. the supplied final re-audit corrections are reflected exactly in this plan;
2. R2 remains closed/not reopened absent a newly observed regression;
3. stable ACP accepts exactly one non-empty Text plus bounded local ResourceLink(s);
4. R3 advertises no Image, EmbeddedResource, or Audio capability;
5. accepted ResourceLinks are absolute local `file:` URLs with empty hostname, converted by the platform canonical file-URL mechanism, to bounded regular non-symlink/non-junction files;
6. hosted/UNC `file:` URLs such as `file://server/...` and `file://localhost/...` are rejected before open;
7. each accepted resource is snapshotted from one opened handle with before/after identity/change checks, closing the pathname TOCTOU case;
8. all resources in one prompt validate before any source-bearing owner ingress becomes current;
9. the source-bearing ingress retains raw ACP Text bytes byte-for-byte, and those raw bytes participate in `textDigest` / `ingressDigest`;
10. every accepted source snapshot is stored as a real Git blob using raw stdin bytes and mechanically reopens byte-for-byte;
11. expert-source blob retention uses a narrow `refs/meta-harness/...` family that is explicitly repairable non-authoritative reachability plumbing;
12. missing GC refs are repaired only when the authoritative ingress's referenced blob still exists and reopens exactly; a missing/mismatched referenced blob fails closed;
13. no accepted-source operation mutates the owner working tree, index, HEAD, branch, or product commit;
14. no standalone expert source-occurrence artifact/store exists; owner ingress itself owns the ordered source descriptors and is the occurrence/user-act identity;
15. `ingressDigest` is deterministic over raw ACP Text + ordered stable source descriptors and excludes receipt/path/GC-ref/filesystem ephemera;
16. replaying exactly the same accepted input yields the same `ingressDigest`;
17. objective adoption mechanically binds that exact ingress identity, is idempotent for the already-adopted digest, and increments revision only for a genuinely new ingress;
18. a crash cannot expose a new objective without the source-bearing user ingress it adopted;
19. artifact content remains untrusted evidence and cannot manufacture owner/execution/Git/scope/publication/Claim authority;
20. existing `research-promotion/v1` remains canonical without schema migration or fake `blobOid`;
21. identical exact bytes from repository and expert ingress reuse one blob/content identity and one promotion;
22. exact quote attribution reopens mechanically from retained Git blob bytes;
23. planner-visible promoted evidence uses truthful `REPOSITORY` / `EXPERT_INGRESS` provenance rather than a fake expert `sourcePath`, while planner prompt/semantics remain unchanged;
24. a fresh session reconstructs already-adopted source-bearing ingress without expert reattachment;
25. later owner ingress/objective replacement does not silently carry prior expert sources forward;
26. historical malformed-image F1 remains preserved as evidence but is not R3 protocol acceptance;
27. F1R passes three fresh valid ResourceLink transport trials;
28. F1E passes three fresh artifact-to-planner trials;
29. existing F2 and F4 remain green;
30. existing deterministic authority/custody/research regressions remain green;
31. no generic ingestion/provider/content-store/MCP/memory framework is added.

## Execution result

R3 implementation now satisfies the accepted slice:

```text
ACP Text + ResourceLink
→ bounded handle-stable UTF-8 snapshot
→ exact Git blob + repairable non-authoritative GC ref
→ one deterministic source-bearing owner ingress
→ idempotent objective adoption
→ existing research-promotion/v1
→ exact quote attribution
→ truthful REPOSITORY / EXPERT_INGRESS planner provenance
```

Retained validation:

```text
R3 focused acceptance/regression suite: 34/34 PASS
including F1R ×3 and F1E ×3 fresh trials

adjacent planner/direct-work suite: 65/65 PASS
serial-only repository tests: PASS
semantic/skill/work/security/runtime bounded batches: PASS

git diff --check: PASS
node --check on all R3 production modules: PASS
```

The repository-wide sweep remains red only on pre-existing/accepted baseline families whose production surfaces are unchanged by R3:

```text
tests/linear-product-head.test.js
→ 2 × MH_FORWARD_PROGRESS_INVARIANT in the existing work-wave/forward-progress baseline

legacy poll/rollup expectation tests
→ expect the retired public `poll --rollup` error contract
→ current unchanged command routing rejects `poll` as internal
```

No R3-modified production/test surface introduced an additional failing test. The external ResourceLink source path may be deleted after ingress; already-adopted source evidence reconstructs from the retained Git blob. Later owner-objective replacement does not carry prior expert sources into the new objective.

## 21. Stop only if

After activation, stop implementation only if evidence demonstrates one of:

```text
stable ACP ResourceLink cannot safely carry the required local textual source
exact opened-file snapshot cannot be bounded and made fail-closed
raw source bytes cannot be retained as verified Git blobs without mutating forbidden Git state
non-authoritative GC refs cannot safely retain expert-source blobs
source-bearing owner ingress cannot durably own the complete ordered accepted source set before objective adoption
exact ingress replay cannot be made idempotent under existing authority serialization
objective adoption cannot bind exact ingress identity without weakening existing authority serialization
truthful repository/expert provenance projection cannot be added without changing planner semantics
existing research-promotion/v1 cannot consume the real expert-source blob without invalidating attribution
exact quote attribution would be weakened
required source access needs protected credentials
R2 audit is not actually closed
or a newly observed defect requires owner-authorized scope expansion
```

Routine implementation detail, exact schema naming, local test repair, and reversible bounded refactoring inside this accepted slice are not owner decisions.

## 22. R4 remains separate

Greenfield F5 remains:

```text
field expert
→ empty folder / no repository
→ cannot start
```

Solving it requires materially different product authority and bootstrap behavior, including repository establishment and owner-authored product direction.

Therefore retain provisionally:

```text
R4 — EXPERT_GREENFIELD_BOOTSTRAP_1
```

only after an owner-authored `PRODUCT.md` direction change warrants it.

The sequence remains:

```text
R3
expert artifacts → existing managed product

then, only with owner direction

R4
expert intent + artifacts → new product
```

## Final patched R3 summary

```text
R3 — EXPERT_ARTIFACT_INGRESS_1

scope:
  existing managed project only

ACP:
  exactly one non-empty Text
  + 0..N bounded absolute local file: ResourceLinks
  + file: hostname must be empty; hosted/UNC forms rejected

snapshot:
  validate all
  → open each file once
  → fstat/read/fstat same handle
  → exact bounded UTF-8 bytes
  → fail whole prompt on one bad source

content storage:
  git hash-object -w --stdin
  → real blobOid
  → verify exact bytes
  → non-authoritative refs/meta-harness/research-sources/* GC root

owner input/currentness:
  ONE durable source-bearing OWNER INGRESS
  raw exact ACP Text + ordered source descriptors
  → deterministic ingressDigest
  → owner ingress itself is the source occurrence/user-act identity
  → no standalone occurrence artifact/store
  → objective adopts exact ingress identity idempotently
  → exact replay does not increment revision
  → genuinely new ingress derives the next revision
  → never predict revision + 1

research:
  existing research-promotion/v1 unchanged
  source = contentDigest + real blobOid + byteLength
  same exact bytes → one promotion
  exact quote attribution preserved

planner:
  unchanged finding semantics + prompt
  truthful source union:
    REPOSITORY { path, blobOid, contentDigest }
    EXPERT_INGRESS { ingressDigest, ordinal, name, blobOid, contentDigest }
  no fake expert sourcePath

acceptance:
  historical malformed-image F1 preserved only
  F1R valid ResourceLink transport ×3
  F1E full artifact → evidence → planner journey ×3
  hosted/UNC file: URL rejected
  TOCTOU replacement fails closed
  exact input replay is revision-idempotent
  deleted GC ref repairs when blob exists
  missing referenced blob fails closed
  provenance union stays truthful
  concurrent ingress cannot misbind source currentness

not R3:
  research-source-content/v1 custom store
  research-promotion/v2
  promotion migration layer
  Image
  EmbeddedResource
  Audio
  PDF/spreadsheet/image extraction
  greenfield
  prompt/model changes
  memory
  provider framework
  generic attachment system
  semantic-close machinery

status:
  FINAL RE-AUDIT CORRECTIONS APPLIED
  OWNER GO RECEIVED
  IMPLEMENTED
  VALIDATED AGAINST ACCEPTED RED BASELINE
  R3 CLOSED
```
