"use strict";

const { commandDirty } = require("../dirty");

module.exports = async function runDirty(args, context) {
  return commandDirty(args, context);
};
