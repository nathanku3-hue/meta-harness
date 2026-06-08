"use strict";

const { scanContracts } = require("../sync-check");
const { runReadOnlyCheck } = require("./read-only-check");

module.exports = function runContract(args, context) {
  return runReadOnlyCheck(args, context, {
    action: "scan",
    command: "contract",
    label: "CONTRACT SCAN",
    check: scanContracts,
  });
};
