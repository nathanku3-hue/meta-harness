"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  computeNativeTaskBriefDigest,
  sealNativeTaskBrief,
  validateNativeTaskBrief,
} = require("../lib/native-task-brief");

function brief(overrides = {}) {
  return {
    productResult: "Deliver one verified native ChatGPT to DevSpace result.",
    journeyState: "The result and bounded authority are accepted.",
    doNow: "Open the repository and begin the first reversible action.",
    doneWhen: "The repository change exists and declared validation passes.",
    stopOnlyIf: ["The accepted path boundary is insufficient."],
    repository: "E:\\Code\\example",
    allowedPaths: ["src", "tests"],
    validation: [
      {
        argv: ["node", "--test", "tests/native.test.js"],
        cwd: ".",
        timeoutSeconds: 60,
      },
    ],
    git: {
      remote: "origin",
      branch: "product/native-journey",
      paths: ["src/native.js", "tests/native.test.js"],
      commit: true,
      push: false,
    },
    ...overrides,
  };
}

test("native task brief preserves the accepted result and exact authority", () => {
  const sealed = sealNativeTaskBrief(brief());
  assert.equal(sealed.brief.productResult, brief().productResult);
  assert.equal(sealed.brief.repository, path.resolve("E:\\Code\\example"));
  assert.deepEqual(sealed.brief.allowedPaths, ["src", "tests"]);
  assert.deepEqual(sealed.brief.git.paths, ["src/native.js", "tests/native.test.js"]);
  assert.match(sealed.briefDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(sealed.briefDigest, computeNativeTaskBriefDigest(sealed.brief));
  assert.equal(Object.isFrozen(sealed), true);
  assert.equal(Object.isFrozen(sealed.brief), true, "sealed brief remains immutable");
  assert.equal(Object.isFrozen(validateNativeTaskBrief(sealed.brief)), true);
});

test("native task brief rejects scope escape, invalid Git authority, and duplicate paths", () => {
  assert.throws(
    () => sealNativeTaskBrief(brief({ allowedPaths: ["../outside"] })),
    (error) => error.code === "MH_NATIVE_TASK_BRIEF" && /repository-relative/.test(error.message),
  );
  assert.throws(
    () =>
      sealNativeTaskBrief(
        brief({
          git: {
            remote: "origin",
            branch: "product/native-journey",
            paths: ["src/native.js"],
            commit: false,
            push: true,
          },
        }),
      ),
    /push requires.*commit/,
  );
  assert.throws(
    () => sealNativeTaskBrief(brief({ allowedPaths: ["src", "SRC"] })),
    /must not contain duplicates/,
  );
});

test("empty validation is representable but cannot itself prove DONE", () => {
  const sealed = sealNativeTaskBrief(brief({ validation: [] }));
  assert.deepEqual(sealed.brief.validation, []);
});
