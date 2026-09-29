"use strict";

const { retiredRuntime } = require("./retired-runtime");

function exportPortableCustody() {
  return retiredRuntime("legacy custody export");
}

module.exports = {
  EXPORT_SCHEMA: null,
  SAFE_EXACT_FILES: Object.freeze([]),
  exportPortableCustody,
};
