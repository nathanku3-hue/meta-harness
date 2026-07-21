# Architecture Map

## Module Ownership

| Path | Owner | Purpose |
|---|---|---|
| bin/ | nathanku3-hue | CLI entry point (thin router only) |
| lib/commands/ | nathanku3-hue | Command handlers |
| lib/ | nathanku3-hue | Shared implementation modules |
| templates/contracts/ | nathanku3-hue | Installable contract templates |
| templates/skills/ | nathanku3-hue | Installable skill templates |
| .agents/skills/ | nathanku3-hue | Active repo skills |
| .meta-harness/ | nathanku3-hue | Tracked truth and local state |
| tests/ | nathanku3-hue | Test suites |
| docs/ | nathanku3-hue | Product and architecture docs |

## Dependency Direction

```text
bin/meta-harness.js -> lib/commands/*.js -> lib/*.js
tests/*.test.js -> lib/*.js or bin/meta-harness.js
lib/commands/*.js must not import from bin/
lib/*.js must not import from bin/
lib/*.js must not import from lib/commands/
templates/ are data, not imported code
```

## Public Surface

The public CLI surface is defined by `lib/command-registry.js`.
The check-ID surface is defined by `lib/check-id-registry.js`.
Architecture changes that add commands or check families must update this map and the owning registry together.

## Active Product-Proof Flow

D085 is canonically active under D086 and does not add a runtime layer. It constrains how the existing substrate is applied:

```text
intent-v1
→ representative external slice
→ bounded RunSpec
→ installed 0.3.0 execution custody
→ if blocked, smallest proven harness repair inside the same R3 slice
→ resume the same slice
→ independent code/product acceptance
→ merge
→ package
→ learning and handover
→ independent domain-axis test
```

The code/product verifier and the later domain validator are distinct responsibilities. S-006M requires specialist knowledge to materially shape the output but does not treat the original author as independent proof of domain correctness.

The packaged external artifact must carry its own claim ceiling. Publication is outside this flow and requires a separate human gate.
