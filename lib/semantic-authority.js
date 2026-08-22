"use strict";

const { isDigest } = require("./contracts/digest");
const { ConfigError } = require("./errors");

const SEMANTIC_AUTHORITY_SCHEMA = "semantic-authority/v1";
const SEMANTIC_AUTHORITY_BLOCK = "Semantic Authority";
const SEMANTIC_STATES = new Set(["BOUND", "EXPLICIT_NONE", "UNBOUND"]);
const SEMANTIC_KINDS = new Set(["OBJECT", "HYPOTHESIS", "CRITERION", "METRIC"]);
const ENDGAME_KINDS = new Set(["DESTINATION"]);
const KINDS = new Set([...SEMANTIC_KINDS, ...ENDGAME_KINDS]);
const SEMANTIC_ROLES = new Set(["PRIMARY", "SECONDARY", "PRIMARY_SMOKE_PROBE", "DIAGNOSTIC"]);
const ENDGAME_ROLES = new Set(["REQUIRED_DESTINATION"]);
const ROLES = new Set([...SEMANTIC_ROLES, ...ENDGAME_ROLES]);

function fail(code, message, details) {
  throw new ConfigError(message, { code, details });
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("MH_SEMANTIC_AUTHORITY_SHAPE", `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) fail("MH_SEMANTIC_AUTHORITY_SHAPE", `${label} has missing or unexpected fields`, { actual, expected: wanted });
}

function nonEmpty(value, label) {
  if (typeof value !== "string" || value.trim() === "") fail("MH_SEMANTIC_AUTHORITY_VALUE", `${label} must be a non-empty string`);
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function parseStructuredBinding(content) {
  const lines = String(content).split(/\r?\n/u);
  const headings = lines
    .map((line, index) => (/^##\s+Semantic Authority\s*$/u.test(line) ? index : -1))
    .filter((index) => index >= 0);
  if (headings.length === 0) return null;
  if (headings.length !== 1) {
    fail("MH_SEMANTIC_AUTHORITY_SOURCE", "PRODUCT.md must contain at most one ## Semantic Authority section");
  }

  const heading = headings[0];
  const nextHeading = lines.findIndex((line, index) => index > heading && /^#{1,6}\s+\S/u.test(line));
  const sectionEnd = nextHeading === -1 ? lines.length : nextHeading;
  const section = lines.slice(heading + 1, sectionEnd);
  const jsonFences = section
    .map((line, index) => (/^```json\s*$/u.test(line) ? index : -1))
    .filter((index) => index >= 0);
  if (jsonFences.length !== 1) {
    fail("MH_SEMANTIC_AUTHORITY_SOURCE", "present ## Semantic Authority section must contain exactly one JSON fence inside that section");
  }
  const start = jsonFences[0];
  const end = section.findIndex((line, index) => index > start && /^```\s*$/u.test(line));
  if (end === -1) {
    fail("MH_SEMANTIC_AUTHORITY_SOURCE", "present ## Semantic Authority JSON fence is not closed inside that section");
  }
  const raw = section.slice(start + 1, end).join("\n").trim();
  if (!raw) fail("MH_SEMANTIC_AUTHORITY_SOURCE", "present ## Semantic Authority JSON fence is empty");
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail("MH_SEMANTIC_AUTHORITY_SOURCE", `present ## Semantic Authority JSON is invalid: ${error.message}`);
  }
}

function validateAtom(value, index) {
  exactKeys(value, ["id", "kind", "identity", "role"], `semanticAuthority.atoms[${index}]`);
  if (!KINDS.has(value.kind)) fail("MH_SEMANTIC_AUTHORITY_VALUE", `semanticAuthority.atoms[${index}].kind is invalid`);
  if (!ROLES.has(value.role)) fail("MH_SEMANTIC_AUTHORITY_VALUE", `semanticAuthority.atoms[${index}].role is invalid`);
  const expectedId = new RegExp(`^${value.kind}_[A-Z0-9_]+$`, "u");
  if (!expectedId.test(String(value.id || ""))) fail("MH_SEMANTIC_AUTHORITY_VALUE", `semanticAuthority.atoms[${index}].id is invalid for ${value.kind}`);
  nonEmpty(value.identity, `semanticAuthority.atoms[${index}].identity`);
  if (value.kind === "DESTINATION" && value.role !== "REQUIRED_DESTINATION") {
    fail("MH_SEMANTIC_AUTHORITY_VALUE", `semanticAuthority.atoms[${index}] DESTINATION role must be REQUIRED_DESTINATION`);
  }
  if (SEMANTIC_KINDS.has(value.kind) && ENDGAME_ROLES.has(value.role)) {
    fail("MH_SEMANTIC_AUTHORITY_VALUE", `semanticAuthority.atoms[${index}] semantic kind cannot use an endgame role`);
  }
  return Object.freeze({ id: value.id, kind: value.kind, identity: value.identity, role: value.role });
}

function assertAtomSetValid(atoms) {
  const ids = atoms.map((atom) => atom.id);
  if (new Set(ids).size !== ids.length) fail("MH_SEMANTIC_AUTHORITY_VALUE", "semantic authority atom ids must be unique");
  const primaryHypotheses = atoms.filter((atom) => atom.kind === "HYPOTHESIS" && atom.role === "PRIMARY");
  if (primaryHypotheses.length > 1) fail("MH_SEMANTIC_AUTHORITY_VALUE", "semantic authority may contain at most one PRIMARY hypothesis");
  const destinationIdentities = atoms.filter((atom) => atom.kind === "DESTINATION").map((atom) => atom.identity);
  if (new Set(destinationIdentities).size !== destinationIdentities.length) {
    fail("MH_SEMANTIC_AUTHORITY_VALUE", "required destination identities must be unique");
  }
}

function compileSemanticAuthority({ productDirection }) {
  if (!productDirection || typeof productDirection.content !== "string" || !isDigest(productDirection.digest)) {
    fail("MH_SEMANTIC_AUTHORITY_SOURCE", "semantic authority requires exact owner-authored PRODUCT.md bytes");
  }

  const source = parseStructuredBinding(productDirection.content);
  let state = "UNBOUND";
  let atoms = [];
  if (source !== null) {
    exactKeys(source, ["state", "atoms"], "semantic authority source binding");
    if (source.state !== "BOUND" && source.state !== "EXPLICIT_NONE") {
      fail("MH_SEMANTIC_AUTHORITY_VALUE", "present semantic authority source state must be BOUND or EXPLICIT_NONE");
    }
    state = source.state;
    if (!Array.isArray(source.atoms)) fail("MH_SEMANTIC_AUTHORITY_VALUE", "semantic authority source atoms must be an array");
    atoms = source.atoms.map(validateAtom);
    if (state === "EXPLICIT_NONE" && atoms.length !== 0) fail("MH_SEMANTIC_AUTHORITY_VALUE", "EXPLICIT_NONE semantic authority cannot contain typed atoms");
    if (state === "BOUND" && atoms.length === 0) fail("MH_SEMANTIC_AUTHORITY_VALUE", "BOUND semantic authority requires at least one typed atom");
  }

  assertAtomSetValid(atoms);
  return deepFreeze({
    schemaVersion: SEMANTIC_AUTHORITY_SCHEMA,
    semanticState: state,
    productDirectionDigest: productDirection.digest,
    atoms,
  });
}

function validateSemanticAuthority(value) {
  exactKeys(value, ["schemaVersion", "semanticState", "productDirectionDigest", "atoms"], "semanticAuthority");
  if (value.schemaVersion !== SEMANTIC_AUTHORITY_SCHEMA) fail("MH_SEMANTIC_AUTHORITY_SCHEMA", `semantic authority schema must be ${SEMANTIC_AUTHORITY_SCHEMA}`);
  if (!SEMANTIC_STATES.has(value.semanticState)) fail("MH_SEMANTIC_AUTHORITY_STATE", "semanticState must be BOUND, EXPLICIT_NONE, or UNBOUND");
  if (!isDigest(value.productDirectionDigest)) fail("MH_SEMANTIC_AUTHORITY_DIGEST", "productDirectionDigest must be a sha256 digest");
  if (!Array.isArray(value.atoms)) fail("MH_SEMANTIC_AUTHORITY_VALUE", "semantic authority atoms must be an array");
  const atoms = value.atoms.map(validateAtom);
  if ((value.semanticState === "EXPLICIT_NONE" || value.semanticState === "UNBOUND") && atoms.length !== 0) {
    fail("MH_SEMANTIC_AUTHORITY_STATE", `${value.semanticState} semantic authority cannot contain typed atoms`);
  }
  if (value.semanticState === "BOUND" && atoms.length === 0) fail("MH_SEMANTIC_AUTHORITY_STATE", "BOUND semantic authority requires typed atoms");
  assertAtomSetValid(atoms);
  return deepFreeze(JSON.parse(JSON.stringify(value)));
}

function refsForKind(refs, kind) {
  if (kind === "OBJECT") return refs.objectRefs || [];
  if (kind === "CRITERION") return refs.criterionRefs || [];
  if (kind === "METRIC") return refs.metricRefs || [];
  return [];
}

function semanticProjection(authority, refs = {}) {
  const validated = validateSemanticAuthority(authority);
  const semanticAtoms = validated.atoms.filter((atom) => SEMANTIC_KINDS.has(atom.kind));
  const byId = new Map(semanticAtoms.map((atom) => [atom.id, atom]));

  for (const kind of ["OBJECT", "CRITERION", "METRIC"]) {
    const requested = refsForKind(refs, kind);
    if (!Array.isArray(requested)) fail("MH_SEMANTIC_OBJECT_UNAUTHORIZED", `${kind} refs must be an array`);
    for (const id of requested) {
      const atom = byId.get(id);
      if (!atom || atom.kind !== kind) fail("MH_SEMANTIC_OBJECT_UNAUTHORIZED", `semantic authority does not authorize ${id} as ${kind}`);
    }
  }

  const requestedHypothesis = refs.hypothesisRef === undefined ? null : refs.hypothesisRef;
  if (requestedHypothesis !== null && requestedHypothesis !== "EXPLICIT_NONE") {
    const atom = byId.get(requestedHypothesis);
    if (!atom || atom.kind !== "HYPOTHESIS") fail("MH_SEMANTIC_OBJECT_UNAUTHORIZED", `semantic authority does not authorize ${requestedHypothesis} as HYPOTHESIS`);
  }
  if (validated.semanticState === "EXPLICIT_NONE" && requestedHypothesis !== null && requestedHypothesis !== "EXPLICIT_NONE") {
    fail("MH_SEMANTIC_OBJECT_UNAUTHORIZED", "EXPLICIT_NONE semantic authority cannot project a hypothesis");
  }

  const primaryHypothesis = semanticAtoms.find((atom) => atom.kind === "HYPOTHESIS" && atom.role === "PRIMARY") || null;
  if (primaryHypothesis && requestedHypothesis && requestedHypothesis !== primaryHypothesis.id) {
    fail("MH_SEMANTIC_OBJECT_UNAUTHORIZED", "planner-requested hypothesis cannot replace the owner-required PRIMARY hypothesis");
  }
  const hypothesisRef = validated.semanticState === "EXPLICIT_NONE"
    ? "EXPLICIT_NONE"
    : primaryHypothesis?.id || (requestedHypothesis === "EXPLICIT_NONE" ? null : requestedHypothesis);

  const selectedIds = new Set();
  for (const atom of semanticAtoms) {
    if (atom.role === "PRIMARY") selectedIds.add(atom.id);
  }
  for (const kind of ["OBJECT", "CRITERION", "METRIC"]) {
    for (const id of refsForKind(refs, kind)) selectedIds.add(id);
  }
  if (hypothesisRef && hypothesisRef !== "EXPLICIT_NONE") selectedIds.add(hypothesisRef);

  const selected = semanticAtoms.filter((atom) => selectedIds.has(atom.id));
  return deepFreeze({
    objectRefs: selected.filter((atom) => atom.kind === "OBJECT").map((atom) => atom.id),
    hypothesisRef,
    criterionRefs: selected.filter((atom) => atom.kind === "CRITERION").map((atom) => atom.id),
    metricRefs: selected.filter((atom) => atom.kind === "METRIC").map((atom) => atom.id),
    atoms: selected,
  });
}

function endgameProjection(authority) {
  const validated = validateSemanticAuthority(authority);
  const atoms = validated.atoms.filter((atom) => atom.kind === "DESTINATION");
  return deepFreeze({
    requiredDestinationRefs: atoms.map((atom) => atom.id),
    atoms,
  });
}

module.exports = {
  ENDGAME_KINDS,
  ENDGAME_ROLES,
  KINDS,
  ROLES,
  SEMANTIC_AUTHORITY_BLOCK,
  SEMANTIC_AUTHORITY_SCHEMA,
  SEMANTIC_KINDS,
  SEMANTIC_ROLES,
  SEMANTIC_STATES,
  compileSemanticAuthority,
  endgameProjection,
  semanticProjection,
  validateSemanticAuthority,
};
