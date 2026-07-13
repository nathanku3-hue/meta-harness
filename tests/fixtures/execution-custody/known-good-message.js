"use strict";

function formatMessage(name = "world") {
  const normalized = String(name).trim();
  return `hello ${normalized || "world"}`;
}

module.exports = { formatMessage };
