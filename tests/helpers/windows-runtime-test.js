"use strict";

const fs = require("node:fs");
const { test: nodeTest } = require("node:test");

const {
  WINDOWS_POWERSHELL_PATH,
} = require("../../internal/d069/ao-constants");

function windowsRuntimeSkipReason() {
  if (process.platform !== "win32") {
    return "requires native Windows PowerShell 5.1";
  }
  if (!fs.existsSync(WINDOWS_POWERSHELL_PATH)) {
    return `native Windows PowerShell missing: ${WINDOWS_POWERSHELL_PATH}`;
  }
  return null;
}

function windowsRuntimeTest(name, optionsOrFn, maybeFn) {
  const options = typeof optionsOrFn === "function"
    ? {}
    : { ...(optionsOrFn || {}) };
  const fn = typeof optionsOrFn === "function" ? optionsOrFn : maybeFn;
  const reason = windowsRuntimeSkipReason();

  if (reason && options.skip === undefined) {
    options.skip = reason;
  }

  return nodeTest(name, options, fn);
}

module.exports = {
  windowsRuntimeSkipReason,
  windowsRuntimeTest,
};
