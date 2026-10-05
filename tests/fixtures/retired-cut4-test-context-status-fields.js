"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  semanticMarkdownSection,
  semanticStatusField,
} = require("../lib/context-status-fields");

test("status placeholder detection removes comments until no complete comment remains", () => {
  const reintroducingComment = "<!<!-- inner -->-- pending -->";
  assert.equal(semanticStatusField(`Goal:\n${reintroducingComment}`, "Goal"), "");
  assert.equal(
    semanticMarkdownSection(`## Stack Evidence\n${reintroducingComment}`, "Stack Evidence"),
    "",
  );
});

test("status placeholder detection preserves non-comment semantic content", () => {
  const value = "<!-- ignored -->\nRelease evidence is retained.";
  assert.equal(semanticStatusField(`Goal:\n${value}`, "Goal"), value);
});
