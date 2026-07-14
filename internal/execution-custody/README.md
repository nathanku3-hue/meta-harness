# Execution Custody Runtime

Private, host-neutral runtime for one sealed bounded repository change.

The runtime binds local agent and validation executables outside the sealed RunSpec, materializes one schema-bound artifact through the controller, validates the resulting commit, retains terminal evidence, replays completed custody without execution-tool access, and exports independently verifiable evidence.

This directory is the sole production execution-custody root. It is not packaged and exposes no public CLI.

## Private operator seam

D075 exposes one intentionally unregistered entrypoint:

```text
node scripts/operate-execution-custody.js <absolute-local-request.json>
```

The request file is an ignored local binding, not a portable or public contract. It has the exact shape:

```json
{
  "schemaVersion": "execution-custody-operator-request/v1",
  "operationId": "devspace-operator-01",
  "examplePath": "<absolute tracked example JSON path>",
  "sourceRepositoryPath": "<absolute local Git object source>",
  "custodyRoot": "<absolute .meta-harness/local/custody child path>",
  "approvedBy": "<local operator identity>",
  "agentProgram": {
    "nodeExecutablePath": "<absolute path>",
    "launcherScriptPath": "<absolute path>",
    "nativeExecutablePath": "<absolute path>",
    "expectedVersion": "<exact version>",
    "codexHome": "<absolute path>"
  },
  "validationProgram": {
    "executablePath": "<absolute path matching the example command name>",
    "hostEnv": {},
    "sensitiveValues": []
  }
}
```

The operator requires a clean immutable Meta-Harness candidate before creating custody state. It accepts only tracked bounded-repository-change examples and create-only roots directly under `.meta-harness/local/custody`. It performs exact shallow authority preparation, one authenticated process, normal close, later-than-expiry fresh-process replay with unusable tools, portable export, independent validation, leakage verification, and a create-only `operator-receipt.json`.

The entrypoint is absent from `bin/`, package scripts, and package exports. Local source and tool paths remain host bindings and are never portable authority.
