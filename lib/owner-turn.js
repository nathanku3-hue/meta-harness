"use strict";

function fail(message) {
  const error = new Error(message);
  error.code = "MH_OWNER_TURN";
  throw error;
}

function parseExplicitGoalChange(rawTurn) {
  const value = String(rawTurn || "").trim();
  if (/^change the goal to\s*$/iu.test(value)) {
    fail("explicit goal change requires replacement objective bytes");
  }
  const prefix = /^change the goal to\s+/iu.exec(value);
  if (!prefix) return null;

  let replacementObjective = value.slice(prefix[0].length);
  let advance = false;
  const advanceMatch = /^(.*?)(?:,\s*|\s+)and\s+go\s*$/iu.exec(replacementObjective);
  if (advanceMatch) {
    replacementObjective = advanceMatch[1];
    advance = true;
  }

  replacementObjective = replacementObjective.trim();
  if (!replacementObjective) fail("explicit goal change requires replacement objective bytes");
  return Object.freeze({ replacementObjective, advance });
}

module.exports = {
  parseExplicitGoalChange,
};
