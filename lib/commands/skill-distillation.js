"use strict";

const { commandDistill } = require("../skill-distillation");

module.exports = async function runSkillDistillation(args, context) {
  return commandDistill(args, context);
};
