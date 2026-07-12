#!/usr/bin/env node
"use strict";

/**
 * Offline identity stub for the native codex executable binding.
 * Never invoked by the test launcher path; present only for sha256 bind/revalidate.
 */
process.stdout.write("d070-test-native-stub\n");
process.exitCode = 0;
