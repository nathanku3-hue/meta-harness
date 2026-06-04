"use strict";

const crypto = require("node:crypto");

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function stateHash(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

module.exports = { stableJson, stateHash };
