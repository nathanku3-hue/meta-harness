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
