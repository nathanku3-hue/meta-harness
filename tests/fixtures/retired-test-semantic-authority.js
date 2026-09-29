"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  compileSemanticAuthority,
  endgameProjection,
  semanticProjection,
  validateSemanticAuthority,
} = require("../lib/semantic-authority");
const { productDirectionDigest } = require("../lib/product-direction");
const { directionFromContent } = require("./helpers/product-direction");

function withDigest(base, content) {
  return { ...base, content, digest: productDirectionDigest(Buffer.from(content, "utf8")) };
}

function unboundDirection() {
  const base = directionFromContent();
  const content = `${base.content.split("## Semantic Authority")[0].trimEnd()}\n`;
  return withDigest(base, content);
}

function directionWithBinding(binding) {
  const base = unboundDirection();
  const content = `${base.content}\n## Semantic Authority\n\n\`\`\`json\n${JSON.stringify(binding, null, 2)}\n\`\`\`\n`;
  return withDigest(base, content);
}

function boundDirection() {
  return directionWithBinding({
    state: "BOUND",
    atoms: [
      { id: "OBJECT_PRIMARY", kind: "OBJECT", identity: "primary research object", role: "PRIMARY" },
      { id: "HYPOTHESIS_PRIMARY", kind: "HYPOTHESIS", identity: "primary hypothesis", role: "PRIMARY" },
      { id: "CRITERION_PRIMARY", kind: "CRITERION", identity: "primary success criterion", role: "PRIMARY" },
      { id: "METRIC_CAGR", kind: "METRIC", identity: "CAGR", role: "SECONDARY" },
      { id: "DESTINATION_E1", kind: "DESTINATION", identity: "first required endgame destination", role: "REQUIRED_DESTINATION" },
      { id: "DESTINATION_E2", kind: "DESTINATION", identity: "second required endgame destination", role: "REQUIRED_DESTINATION" },
    ],
  });
}

test("T0 authority defaults to UNBOUND without making up typed owner facts", () => {
  const authority = compileSemanticAuthority({ productDirection: unboundDirection() });
  assert.equal(authority.semanticState, "UNBOUND");
  assert.deepEqual(authority.atoms, []);
  assert.doesNotThrow(() => validateSemanticAuthority(authority));
  assert.deepEqual(semanticProjection(authority), {
    objectRefs: [],
    hypothesisRef: null,
    criterionRefs: [],
    metricRefs: [],
    atoms: [],
  });
  assert.deepEqual(endgameProjection(authority), {
    requiredDestinationRefs: [],
    atoms: [],
  });
});

test("EXPLICIT_NONE is distinct from UNBOUND", () => {
  const authority = compileSemanticAuthority({
    productDirection: directionWithBinding({ state: "EXPLICIT_NONE", atoms: [] }),
  });
  assert.equal(authority.semanticState, "EXPLICIT_NONE");
  assert.deepEqual(authority.atoms, []);
  assert.equal(semanticProjection(authority).hypothesisRef, "EXPLICIT_NONE");
});

test("T1 compression cannot omit PRIMARY semantic refs or required endgame destinations", () => {
  const authority = compileSemanticAuthority({ productDirection: boundDirection() });
  const projection = semanticProjection(authority, {
    objectRefs: [],
    hypothesisRef: null,
    criterionRefs: [],
    metricRefs: [],
  });
  assert.deepEqual(projection.objectRefs, ["OBJECT_PRIMARY"]);
  assert.equal(projection.hypothesisRef, "HYPOTHESIS_PRIMARY");
  assert.deepEqual(projection.criterionRefs, ["CRITERION_PRIMARY"]);
  assert.deepEqual(projection.metricRefs, []);
  assert.deepEqual(endgameProjection(authority).requiredDestinationRefs, ["DESTINATION_E1", "DESTINATION_E2"]);
});

test("T3 scalar substitution cannot replace required identities with a secondary metric", () => {
  const authority = compileSemanticAuthority({ productDirection: boundDirection() });
  const projection = semanticProjection(authority, {
    objectRefs: [],
    hypothesisRef: null,
    criterionRefs: [],
    metricRefs: ["METRIC_CAGR"],
  });
  assert.deepEqual(projection.objectRefs, ["OBJECT_PRIMARY"]);
  assert.equal(projection.hypothesisRef, "HYPOTHESIS_PRIMARY");
  assert.deepEqual(projection.criterionRefs, ["CRITERION_PRIMARY"]);
  assert.deepEqual(projection.metricRefs, ["METRIC_CAGR"]);
  assert.deepEqual(endgameProjection(authority).requiredDestinationRefs, ["DESTINATION_E1", "DESTINATION_E2"]);
});

test("T5 projection cannot mint, rewrite, or substitute owner atoms", () => {
  const authority = compileSemanticAuthority({ productDirection: boundDirection() });
  assert.throws(
    () => semanticProjection(authority, { objectRefs: ["OBJECT_INVENTED"] }),
    (error) => error.code === "MH_SEMANTIC_OBJECT_UNAUTHORIZED",
  );
  assert.throws(
    () => semanticProjection(authority, { hypothesisRef: "METRIC_CAGR" }),
    (error) => error.code === "MH_SEMANTIC_OBJECT_UNAUTHORIZED",
  );
});

test("T8 proxy ordering cannot demote or reorder owner PRIMARY roles", () => {
  const authority = compileSemanticAuthority({ productDirection: boundDirection() });
  const projection = semanticProjection(authority, {
    metricRefs: ["METRIC_CAGR"],
    criterionRefs: ["CRITERION_PRIMARY"],
    objectRefs: ["OBJECT_PRIMARY"],
    hypothesisRef: "HYPOTHESIS_PRIMARY",
  });
  assert.deepEqual(projection.atoms.map((atom) => atom.id), [
    "OBJECT_PRIMARY",
    "HYPOTHESIS_PRIMARY",
    "CRITERION_PRIMARY",
    "METRIC_CAGR",
  ]);
  assert.deepEqual(projection.atoms.slice(0, 3).map((atom) => atom.role), ["PRIMARY", "PRIMARY", "PRIMARY"]);
});

test("T9 standing authority projection is exact PRODUCT.md-derived and contains no objective epoch", () => {
  const direction = boundDirection();
  const first = compileSemanticAuthority({ productDirection: direction });
  const second = compileSemanticAuthority({ productDirection: { ...direction } });
  assert.deepEqual(first, second);
  assert.equal(Object.hasOwn(first, "ownerObjectiveDigest"), false);
});

test("T10 present-but-malformed or duplicate owner authority fails closed", () => {
  const base = unboundDirection();
  const malformed = `${base.content}\n## Semantic Authority\n\n\`\`\`json\n{not-json}\n\`\`\`\n`;
  assert.throws(
    () => compileSemanticAuthority({ productDirection: withDigest(base, malformed) }),
    (error) => error.code === "MH_SEMANTIC_AUTHORITY_SOURCE",
  );

  const duplicate = `${base.content}\n## Semantic Authority\n\n\`\`\`json\n${JSON.stringify({ state: "EXPLICIT_NONE", atoms: [] })}\n\`\`\`\n\n## Semantic Authority\n\n\`\`\`json\n${JSON.stringify({ state: "EXPLICIT_NONE", atoms: [] })}\n\`\`\`\n`;
  assert.throws(
    () => compileSemanticAuthority({ productDirection: withDigest(base, duplicate) }),
    (error) => error.code === "MH_SEMANTIC_AUTHORITY_SOURCE",
  );

  const escapedFence = `${base.content}\n## Semantic Authority\n\nAuthority declaration follows elsewhere.\n\n## Later Section\n\n\`\`\`json\n${JSON.stringify({ state: "EXPLICIT_NONE", atoms: [] })}\n\`\`\`\n`;
  assert.throws(
    () => compileSemanticAuthority({ productDirection: withDigest(base, escapedFence) }),
    (error) => error.code === "MH_SEMANTIC_AUTHORITY_SOURCE",
  );
});

test("T11 required destination identities must be unique", () => {
  assert.throws(
    () => compileSemanticAuthority({
      productDirection: directionWithBinding({
        state: "BOUND",
        atoms: [
          { id: "DESTINATION_E1", kind: "DESTINATION", identity: "same destination", role: "REQUIRED_DESTINATION" },
          { id: "DESTINATION_E2", kind: "DESTINATION", identity: "same destination", role: "REQUIRED_DESTINATION" },
        ],
      }),
    }),
    (error) => error.code === "MH_SEMANTIC_AUTHORITY_VALUE" && /destination identities.*unique/iu.test(error.message),
  );
});

test("T12 INVARIANT is not a supported authority primitive until it has mechanical semantics", () => {
  assert.throws(
    () => compileSemanticAuthority({
      productDirection: directionWithBinding({
        state: "BOUND",
        atoms: [{ id: "INVARIANT_OWNER", kind: "INVARIANT", identity: "owner invariant", role: "INVARIANT" }],
      }),
    }),
    (error) => error.code === "MH_SEMANTIC_AUTHORITY_VALUE",
  );
});
