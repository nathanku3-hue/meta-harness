# Execution Custody Runtime

Private, host-neutral runtime for one sealed bounded repository change.

The runtime binds local agent and validation executables outside the sealed RunSpec, materializes one schema-bound artifact through the controller, validates the resulting commit, retains terminal evidence, replays completed custody without execution-tool access, and exports independently verifiable evidence.

This directory is the sole production execution-custody root. It is not packaged and exposes no public CLI.
