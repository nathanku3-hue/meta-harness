"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  assertStrictJsonData,
  canonicalize,
  isExactUtcTimestamp,
  parseExactUtcTimestamp,
  addSecondsExactUtc,
} = require("../lib/contracts/canonical-json");
const { domainDigest, isDigest } = require("../lib/contracts/digest");

test("rejects NaN, Infinity, negative zero", () => {
  assert.throws(() => assertStrictJsonData(NaN), (e) => e.code === "NON_FINITE_NUMBER");
  assert.throws(() => assertStrictJsonData(Infinity), (e) => e.code === "NON_FINITE_NUMBER");
  assert.throws(() => assertStrictJsonData(-0), (e) => e.code === "NEGATIVE_ZERO");
});

test("rejects Date, class instances, null-prototype objects", () => {
  assert.throws(() => assertStrictJsonData(new Date()), (e) => e.code === "NON_PLAIN_OBJECT");
  class C {}
  assert.throws(() => assertStrictJsonData(new C()), (e) => e.code === "NON_PLAIN_OBJECT");
  assert.throws(() => assertStrictJsonData(Object.create(null)), (e) => e.code === "NON_PLAIN_OBJECT");
});

test("rejects accessors, symbol keys, non-enumerable properties", () => {
  const accessor = {};
  Object.defineProperty(accessor, "x", {
    get() { return 1; },
    enumerable: true,
  });
  assert.throws(() => assertStrictJsonData(accessor), (e) => e.code === "ACCESSOR_PROPERTY");

  const sym = {};
  Object.defineProperty(sym, Symbol("s"), { value: 1, enumerable: true });
  assert.throws(() => assertStrictJsonData(sym), (e) => e.code === "SYMBOL_KEY");

  const hidden = {};
  Object.defineProperty(hidden, "x", { value: 1, enumerable: false });
  assert.throws(() => assertStrictJsonData(hidden), (e) => e.code === "NON_ENUMERABLE");
});

test("rejects sparse arrays and array extra keys", () => {
  const sparse = [];
  sparse[1] = 1;
  assert.throws(() => assertStrictJsonData(sparse), (e) => e.code === "SPARSE_ARRAY");
  const withProp = [1];
  withProp.extra = true;
  assert.throws(() => assertStrictJsonData(withProp), (e) => e.code === "ARRAY_EXTRA_KEY");
});

test("rejects dangerous keys __proto__, constructor, prototype", () => {
  assert.throws(
    () => assertStrictJsonData(JSON.parse('{"__proto__":{"x":1}}')),
    (e) => e.code === "DANGEROUS_KEY" || e.code === "NON_PLAIN_OBJECT",
  );
  assert.throws(
    () => assertStrictJsonData({ constructor: { name: "x" } }),
    (e) => e.code === "DANGEROUS_KEY",
  );
  assert.throws(
    () => assertStrictJsonData({ prototype: {} }),
    (e) => e.code === "DANGEROUS_KEY",
  );
});

test("cycles produce CYCLIC_VALUE not stack overflow", () => {
  const a = { x: 1 };
  a.self = a;
  assert.throws(() => assertStrictJsonData(a), (e) => e.code === "CYCLIC_VALUE");
  const b = { n: 1 };
  const c = { n: 2, ref: b };
  b.ref = c;
  assert.throws(() => assertStrictJsonData(b), (e) => e.code === "CYCLIC_VALUE");
});

test("domain digests are stable under key reorder", () => {
  const a = domainDigest("run-spec/v1", { b: 1, a: 2 });
  const b = domainDigest("run-spec/v1", { a: 2, b: 1 });
  assert.equal(a, b);
  assert.notEqual(domainDigest("run-spec/v1", { a: 1 }), domainDigest("other/v1", { a: 1 }));
  assert.ok(isDigest(a));
});

test("exact UTC timestamps require calendar-valid round-trip", () => {
  assert.equal(isExactUtcTimestamp("2026-07-11T12:00:00.000Z"), true);
  assert.equal(isExactUtcTimestamp("2026-07-11T12:00:00Z"), false);
  assert.equal(isExactUtcTimestamp("2026-02-30T12:00:00.000Z"), false);
  assert.equal(parseExactUtcTimestamp("2026-07-11T12:00:00.000Z"), Date.parse("2026-07-11T12:00:00.000Z"));
  assert.throws(() => parseExactUtcTimestamp("2026-02-30T12:00:00.000Z"));
});

test("canonicalize sorts keys", () => {
  assert.equal(canonicalize({ z: 1, a: 2 }), canonicalize({ a: 2, z: 1 }));
});

test("addSecondsExactUtc fails closed on overflow", () => {
  assert.equal(addSecondsExactUtc("2026-07-11T12:00:00.000Z", 3600), "2026-07-11T13:00:00.000Z");
  assert.equal(addSecondsExactUtc("2026-07-11T12:00:00.000Z", Number.MAX_SAFE_INTEGER), null);
  assert.equal(addSecondsExactUtc("2026-07-11T12:00:00.000Z", -1), null);
});
