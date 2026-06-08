"use strict";

const { commandGate } = require("../dirty");

module.exports = async function runGate(args, context) {
  return commandGate(args, context);
};
