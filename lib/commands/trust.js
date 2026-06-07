"use strict";

const { checkTrustPolicy } = require("../sync-check");
const { runReadOnlyCheck } = require("./read-only-check");

module.exports = function runTrust(args, context) {
  return runReadOnlyCheck(args, context, {
    action: "check",
    command: "trust",
    label: "TRUST CHECK",
    check: checkTrustPolicy,
  });
};
