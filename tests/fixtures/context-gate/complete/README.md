# Context Gate Fixture

This fixture represents a Meta-Harness-adopted Node.js target with enough local truth for a fresh worker to continue without inventing intent.

## Stack

- Runtime: Node.js 20+
- Package manager: npm
- Test command: `npm test`

## Acceptance

The context gate should produce a compact packet for a Worker C test/docs slice and should stop if worker output crosses into runtime implementation.
