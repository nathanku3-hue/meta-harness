"use strict";

const { checkTemplateSync } = require("../sync-check");
const { runReadOnlyCheck } = require("./read-only-check");

module.exports = function runSync(args, context) {
  return runReadOnlyCheck(args, context, {
    action: "check",
    command: "sync",
    label: "SYNC CHECK",
    check: checkTemplateSync,
  });
};
