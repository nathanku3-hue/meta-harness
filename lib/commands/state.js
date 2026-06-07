"use strict";

const { checkStateLayout } = require("../sync-check");
const { runReadOnlyCheck } = require("./read-only-check");

module.exports = function runState(args, context) {
  return runReadOnlyCheck(args, context, {
    action: "check",
    command: "state",
    label: "STATE CHECK",
    check: checkStateLayout,
  });
};
