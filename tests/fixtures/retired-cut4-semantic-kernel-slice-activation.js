"use strict";

const crypto = require("node:crypto");

const { domainDigest } = require("../contracts/digest");
const {
  contractError,
  immutable,
  requireDigest,
  requireExactKeys,
  requireExactUtc,
  requireInteger,
  requireNonEmptyString,
} = require("./contract-utils");
const { exactUtcNow } = require("./clock");
const {
  computeSliceAcceptanceDigest,
  validateSliceAuthorization,
} = require("./slice-authorization");

const SLICE_ACTIVATION_SCHEMA = "slice-activation/v1";
const SLICE_ACTIVATION_DOMAIN = "meta-harness-slice-activation/v1";
const ACTIVATION_KEYS = Object.freeze([
  "schemaVersion",
  "sliceAuthorizationDigest",
  "sliceAcceptanceDigest",
  "repositoryId",
  "sliceId",
  "generation",
  "initialBaseRevision",
  "controllerProgramDigest",
  "controllerPolicyDigest",
  "activatedAt",
  "activationNonce",
  "activationDigest",
]);

function activationBody(value) {
  const body = JSON.parse(JSON.stringify(value));
  delete body.activationDigest;
  return body;
}

function computeSliceActivationDigest(value) {
  return domainDigest(SLICE_ACTIVATION_DOMAIN, activationBody(value));
}

function validateSliceActivation(value, sliceAuthorization, options = {}) {
  requireExactKeys(value, ACTIVATION_KEYS, "SliceActivation");
  if (value.schemaVersion !== SLICE_ACTIVATION_SCHEMA) {
    throw contractError("UNSUPPORTED_SCHEMA", `SliceActivation schema must be ${SLICE_ACTIVATION_SCHEMA}`);
  }
  for (const field of [
    "sliceAuthorizationDigest",
    "sliceAcceptanceDigest",
    "repositoryId",
    "controllerProgramDigest",
    "controllerPolicyDigest",
    "activationDigest",
  ]) requireDigest(value[field], `SliceActivation.${field}`);
  requireNonEmptyString(value.sliceId, "SliceActivation.sliceId");
  requireInteger(value.generation, "SliceActivation.generation", { min: 1, max: 1 });
  requireNonEmptyString(value.initialBaseRevision, "SliceActivation.initialBaseRevision");
  requireExactUtc(value.activatedAt, "SliceActivation.activatedAt");
  requireNonEmptyString(value.activationNonce, "SliceActivation.activationNonce");
  if (!/^[A-Za-z0-9_-]{22,128}$/.test(value.activationNonce)) {
    throw contractError("SLICE_ACTIVATION_NONCE_INVALID", "activation nonce must be canonical base64url-like text");
  }
  if (value.activationDigest !== computeSliceActivationDigest(value)) {
    throw contractError("SLICE_ACTIVATION_DIGEST_MISMATCH", "SliceActivation digest does not match its body");
  }
  if (!sliceAuthorization) {
    throw contractError("SLICE_AUTHORIZATION_REQUIRED", "SliceActivation requires a validated SliceAuthorization");
  }
  const expectedAcceptanceDigest = computeSliceAcceptanceDigest(sliceAuthorization.sliceAcceptance);
  const expected = {
    sliceAuthorizationDigest: sliceAuthorization.authorizationDigest,
    sliceAcceptanceDigest: expectedAcceptanceDigest,
    repositoryId: sliceAuthorization.repositoryId,
    sliceId: sliceAuthorization.sliceId,
    initialBaseRevision: sliceAuthorization.initialBaseRevision,
    controllerProgramDigest: sliceAuthorization.controllerBinding.controllerProgramDigest,
    controllerPolicyDigest: sliceAuthorization.controllerBinding.controllerPolicyDigest,
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (value[field] !== expectedValue) {
      throw contractError("SLICE_ACTIVATION_BINDING_MISMATCH", `SliceActivation.${field} does not match SliceAuthorization`);
    }
  }
  if (Date.parse(value.activatedAt) < Date.parse(sliceAuthorization.executionLimits.issuedAt)
    || Date.parse(value.activatedAt) >= Date.parse(sliceAuthorization.executionLimits.expiresAt)) {
    throw contractError("SLICE_ACTIVATION_EXPIRED", "SliceActivation must occur inside the owner-authorized activation window");
  }
  if (options.activatedAt && value.activatedAt !== options.activatedAt) {
    throw contractError("SLICE_ACTIVATION_TIME_MISMATCH", "SliceActivation does not match trusted activation time");
  }
  return immutable(value);
}

function createSliceActivation({ sliceAuthorization, ownerPin, repositoryId, initialBaseRevision, activatedAt = exactUtcNow() }) {
  const authorization = validateSliceAuthorization(sliceAuthorization, ownerPin, {
    repositoryId,
    initialBaseRevision,
  });
  const body = {
    schemaVersion: SLICE_ACTIVATION_SCHEMA,
    sliceAuthorizationDigest: authorization.authorizationDigest,
    sliceAcceptanceDigest: computeSliceAcceptanceDigest(authorization.sliceAcceptance),
    repositoryId: authorization.repositoryId,
    sliceId: authorization.sliceId,
    generation: 1,
    initialBaseRevision: authorization.initialBaseRevision,
    controllerProgramDigest: authorization.controllerBinding.controllerProgramDigest,
    controllerPolicyDigest: authorization.controllerBinding.controllerPolicyDigest,
    activatedAt,
    activationNonce: crypto.randomBytes(24).toString("base64url"),
  };
  const activation = {
    ...body,
    activationDigest: domainDigest(SLICE_ACTIVATION_DOMAIN, body),
  };
  return validateSliceActivation(activation, authorization, { activatedAt });
}

module.exports = {
  ACTIVATION_KEYS,
  SLICE_ACTIVATION_DOMAIN,
  SLICE_ACTIVATION_SCHEMA,
  activationBody,
  computeSliceActivationDigest,
  createSliceActivation,
  validateSliceActivation,
};
