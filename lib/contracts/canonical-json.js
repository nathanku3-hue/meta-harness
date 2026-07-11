"use strict";

/**
 * Meta-Harness strict JSON subset for authority contracts.
 * Not an RFC 8785 claim — a fixed, documented local subset.
 *
 * Allowed: null, boolean, string, finite number (not -0), dense arrays,
 * ordinary Object.prototype plain objects with string keys only.
 */

const PROTOCOL_MAX_JSON_DEPTH = 64;
const PROTOCOL_MAX_JSON_NODES = 10000;
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isOrdinaryPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function reason(path, code, detail) {
  const err = new Error(`${code} at ${path}: ${detail}`);
  err.code = code;
  err.path = path;
  return err;
}

/**
 * Reject unsupported values. Returns nothing on success; throws Error with .code.
 */
function assertStrictJsonData(value, path = "$", ancestors = null, depth = 0, counter = null) {
  const nodeCounter = counter || { count: 0 };
  nodeCounter.count += 1;
  if (nodeCounter.count > PROTOCOL_MAX_JSON_NODES) {
    throw reason(path, "JSON_TOO_LARGE", `exceeds ${PROTOCOL_MAX_JSON_NODES} nodes`);
  }
  if (depth > PROTOCOL_MAX_JSON_DEPTH) {
    throw reason(path, "JSON_TOO_DEEP", `exceeds depth ${PROTOCOL_MAX_JSON_DEPTH}`);
  }

  if (value === null) return;
  const t = typeof value;
  if (t === "boolean") return;
  if (t === "string") return;
  if (t === "number") {
    if (!Number.isFinite(value)) {
      throw reason(path, "NON_FINITE_NUMBER", "numbers must be finite");
    }
    if (Object.is(value, -0)) {
      throw reason(path, "NEGATIVE_ZERO", "negative zero is forbidden");
    }
    return;
  }
  if (t !== "object") {
    throw reason(path, "UNSUPPORTED_TYPE", `type ${t} is forbidden`);
  }

  const chain = ancestors || new Set();
  if (chain.has(value)) {
    throw reason(path, "CYCLIC_VALUE", "cyclic structures are forbidden");
  }
  chain.add(value);

  try {
    if (Array.isArray(value)) {
      const len = value.length;
      for (let i = 0; i < len; i += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, i)) {
          throw reason(path, "SPARSE_ARRAY", "arrays must be dense");
        }
        assertStrictJsonData(value[i], `${path}[${i}]`, chain, depth + 1, nodeCounter);
      }
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key === "symbol") {
          throw reason(path, "SYMBOL_KEY", "symbol keys are forbidden on arrays");
        }
        if (key === "length") continue;
        if (!/^(0|[1-9]\d*)$/.test(key)) {
          throw reason(path, "ARRAY_EXTRA_KEY", `array property "${key}" is forbidden`);
        }
      }
      return;
    }

    if (!isOrdinaryPlainObject(value)) {
      throw reason(path, "NON_PLAIN_OBJECT", "only Object.prototype plain objects are allowed");
    }

    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === "symbol") {
        throw reason(path, "SYMBOL_KEY", "symbol keys are forbidden");
      }
      if (DANGEROUS_KEYS.has(key)) {
        throw reason(`${path}.${key}`, "DANGEROUS_KEY", `key "${key}" is forbidden`);
      }
      const desc = Object.getOwnPropertyDescriptor(value, key);
      if (!desc) {
        throw reason(`${path}.${key}`, "MISSING_DESCRIPTOR", "property descriptor required");
      }
      if (typeof desc.get === "function" || typeof desc.set === "function") {
        throw reason(`${path}.${key}`, "ACCESSOR_PROPERTY", "accessors are forbidden");
      }
      if (!desc.enumerable) {
        throw reason(`${path}.${key}`, "NON_ENUMERABLE", "non-enumerable properties are forbidden");
      }
      assertStrictJsonData(value[key], `${path}.${key}`, chain, depth + 1, nodeCounter);
    }
  } finally {
    chain.delete(value);
  }
}

/**
 * Canonical string for hashing. Sorts object keys. Assumes assertStrictJsonData passed.
 */
function canonicalize(value) {
  assertStrictJsonData(value);
  return canonicalizeTrusted(value);
}

function canonicalizeTrusted(value) {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "boolean") return value ? "true" : "false";
  if (t === "number") return JSON.stringify(value);
  if (t === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeTrusted).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalizeTrusted(value[k])}`).join(",")}}`;
}

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isExactUtcTimestamp(value) {
  if (typeof value !== "string" || !TIMESTAMP_RE.test(value)) return false;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return false;
  return value === new Date(ms).toISOString();
}

function parseExactUtcTimestamp(value) {
  if (!isExactUtcTimestamp(value)) {
    const err = new Error("timestamp must be exact YYYY-MM-DDTHH:mm:ss.sssZ and calendar-valid");
    err.code = "TIMESTAMP_INVALID";
    throw err;
  }
  return Date.parse(value);
}

function exactKeys(obj, allowed) {
  if (!isOrdinaryPlainObject(obj)) return false;
  const keys = Object.keys(obj).sort();
  const expected = [...allowed].sort();
  if (keys.length !== expected.length) return false;
  return keys.every((k, i) => k === expected[i]);
}

function hasOnlyKeys(obj, allowed) {
  if (!isOrdinaryPlainObject(obj)) return false;
  const allow = new Set(allowed);
  return Object.keys(obj).every((k) => allow.has(k));
}

function freezeDeep(value) {
  if (Array.isArray(value)) {
    value.forEach(freezeDeep);
    return Object.freeze(value);
  }
  if (isOrdinaryPlainObject(value)) {
    for (const v of Object.values(value)) freezeDeep(v);
    return Object.freeze(value);
  }
  return value;
}

function cloneStrict(value) {
  assertStrictJsonData(value);
  return JSON.parse(JSON.stringify(value));
}

/** Safe ms + seconds → ISO, or null if overflow / invalid. */
function addSecondsExactUtc(iso, seconds) {
  if (!isExactUtcTimestamp(iso) || !Number.isInteger(seconds) || seconds < 0) return null;
  const base = Date.parse(iso);
  if (!Number.isSafeInteger(base) || !Number.isSafeInteger(seconds * 1000)) return null;
  const next = base + seconds * 1000;
  if (!Number.isSafeInteger(next) || !Number.isFinite(next)) return null;
  const out = new Date(next).toISOString();
  if (!isExactUtcTimestamp(out)) return null;
  return out;
}

module.exports = {
  isOrdinaryPlainObject,
  assertStrictJsonData,
  canonicalize,
  isExactUtcTimestamp,
  parseExactUtcTimestamp,
  exactKeys,
  hasOnlyKeys,
  freezeDeep,
  cloneStrict,
  addSecondsExactUtc,
  PROTOCOL_MAX_JSON_DEPTH,
  PROTOCOL_MAX_JSON_NODES,
};
