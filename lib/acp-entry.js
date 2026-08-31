"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Readable, Writable } = require("node:stream");

const packageJson = require("../package.json");
const { normalizeHarnessError } = require("./errors");
const { captureExpertResourceLinks } = require("./expert-source-ingress");
const { repoPlannerEnabled } = require("./repo-planner-input");
const { persistSourceBearingOwnerIngress } = require("./source-bearing-owner-ingress");
const { repositoryRoot } = require("./work-git");
const { runAutomaticProductResult } = require("./commands/work");

function samePath(left, right) {
  const normalize = (value) => {
    const resolved = path.resolve(String(value));
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function invalidParams(acp, message, data = {}) {
  throw acp.RequestError.invalidParams(data, message);
}

function exactPromptInput(prompt) {
  if (!Array.isArray(prompt) || prompt.length === 0) return null;
  let text = null;
  const resources = [];
  for (const block of prompt) {
    if (block?.type === "text") {
      if (text !== null || typeof block.text !== "string" || block.text.length === 0) return null;
      text = block.text;
      continue;
    }
    if (block?.type === "resource_link") {
      resources.push(block);
      continue;
    }
    return null;
  }
  if (text === null) return null;
  return Object.freeze({ text, resources: Object.freeze(resources) });
}

function exactPromptText(prompt) {
  return exactPromptInput(prompt)?.text ?? null;
}

function productMessage(error) {
  const harnessError = normalizeHarnessError(error);
  const message = String(harnessError.message || "The requested result could not continue.").trim();
  return `Blocked: ${message}${/[.!?]$/u.test(message) ? "" : "."}\n`;
}

function outputBuffer() {
  let text = "";
  return {
    writer: {
      write(chunk) {
        text += String(chunk);
        return true;
      },
    },
    read() {
      return text;
    },
  };
}

function createAcpTransport(context, {
  acp,
  runProductResult = runAutomaticProductResult,
  resolveRepositoryRoot = repositoryRoot,
  isManagedRepository = repoPlannerEnabled,
} = {}) {
  if (!acp?.RequestError || typeof acp.PROTOCOL_VERSION !== "number") {
    throw new TypeError("stable ACP v1 SDK is required");
  }

  let boundRepository = null;
  const sessions = new Set();
  const activeTurns = new Map();

  function requireKnownSession(sessionId) {
    if (typeof sessionId !== "string" || !sessions.has(sessionId)) {
      invalidParams(acp, "unknown ACP transport session", { sessionId });
    }
  }

  function initialize() {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {},
      authMethods: [],
      agentInfo: {
        name: packageJson.name,
        version: packageJson.version,
      },
    };
  }

  function newSession(params) {
    if (!params || typeof params.cwd !== "string" || !path.isAbsolute(params.cwd)) {
      invalidParams(acp, "session/new requires one absolute repository cwd", { field: "cwd" });
    }
    if (!Array.isArray(params.mcpServers)) {
      invalidParams(acp, "session/new requires mcpServers to be an empty array", { field: "mcpServers" });
    }
    if (params.mcpServers.length !== 0) {
      invalidParams(acp, "mcpServers are rejected", { field: "mcpServers" });
    }
    if (params.additionalDirectories !== undefined
        && (!Array.isArray(params.additionalDirectories) || params.additionalDirectories.length !== 0)) {
      invalidParams(acp, "additionalDirectories and alternate workspace roots are rejected", {
        field: "additionalDirectories",
      });
    }

    let root;
    let canonicalCwd;
    try {
      root = resolveRepositoryRoot(params.cwd);
      canonicalCwd = fs.realpathSync.native(params.cwd);
    } catch (error) {
      invalidParams(acp, "cwd must be an existing managed Git repository root", { field: "cwd" });
    }
    if (!samePath(canonicalCwd, root)) {
      invalidParams(acp, "cwd must name the repository root exactly", { field: "cwd" });
    }
    if (!isManagedRepository(root)) {
      invalidParams(acp, "cwd is not a Meta-Harness managed repository", { field: "cwd" });
    }
    if (boundRepository !== null && !samePath(boundRepository, root)) {
      invalidParams(acp, "alternate workspace roots are rejected", { field: "cwd" });
    }
    boundRepository = root;

    // ACP session identity is transport correlation only. It is never persisted,
    // passed into Meta-Harness planning/execution, or mapped to Claim/workspace authority.
    const sessionId = `transport-${crypto.randomUUID()}`;
    sessions.add(sessionId);
    return { sessionId };
  }

  async function prompt(params, { signal, sendUpdate }) {
    requireKnownSession(params?.sessionId);
    const input = exactPromptInput(params?.prompt);
    if (input === null) {
      invalidParams(acp, "session/prompt requires exactly one non-empty text block plus optional resource_link blocks", { field: "prompt" });
    }
    const { text, resources } = input;
    if (activeTurns.has(params.sessionId)) {
      invalidParams(acp, "only one prompt may be active per transport session", { sessionId: params.sessionId });
    }

    const controller = new AbortController();
    activeTurns.set(params.sessionId, controller);
    const abortFromRequest = () => controller.abort(signal?.reason);
    if (signal?.aborted) abortFromRequest();
    else signal?.addEventListener("abort", abortFromRequest, { once: true });

    const stdout = outputBuffer();
    const stderr = outputBuffer();
    try {
      let ownerIngressDigest = null;
      if (resources.length > 0) {
        try {
          const sourceDescriptors = captureExpertResourceLinks(boundRepository, resources);
          const ingress = persistSourceBearingOwnerIngress(boundRepository, text, sourceDescriptors);
          ownerIngressDigest = ingress.ingressDigest;
        } catch (error) {
          invalidParams(acp, String(error?.message || "resource_link input is invalid"), {
            field: "prompt",
            ...(error?.code ? { code: error.code } : {}),
          });
        }
      }
      try {
        await runProductResult(text, {
          ...context,
          cwd: boundRepository,
          signal: controller.signal,
          stdout: stdout.writer,
          stderr: stderr.writer,
          ownerIngressDigest,
        });
      } catch (error) {
        stdout.writer.write(productMessage(error));
      }

      const output = stdout.read();
      if (output) await sendUpdate(output);
      return { stopReason: controller.signal.aborted ? "cancelled" : "end_turn" };
    } finally {
      signal?.removeEventListener("abort", abortFromRequest);
      if (activeTurns.get(params.sessionId) === controller) activeTurns.delete(params.sessionId);
    }
  }

  function cancel(params) {
    requireKnownSession(params?.sessionId);
    activeTurns.get(params.sessionId)?.abort();
  }

  return Object.freeze({ initialize, newSession, prompt, cancel });
}

function createAcpAgent(context, acp, options = {}) {
  const transport = createAcpTransport(context, { acp, ...options });
  return acp.agent({ name: packageJson.name })
    .onRequest(acp.methods.agent.initialize, () => transport.initialize())
    .onRequest(acp.methods.agent.session.new, (ctx) => transport.newSession(ctx.params))
    .onRequest(acp.methods.agent.session.prompt, (ctx) => transport.prompt(ctx.params, {
      signal: ctx.signal,
      sendUpdate: (text) => ctx.client.notify(acp.methods.client.session.update, {
        sessionId: ctx.params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text },
        },
      }),
    }))
    .onNotification(acp.methods.agent.session.cancel, (ctx) => transport.cancel(ctx.params));
}

async function connectStdio(context, { input = process.stdin, output = process.stdout } = {}) {
  const acp = await import("@agentclientprotocol/sdk");
  const stream = acp.ndJsonStream(Writable.toWeb(output), Readable.toWeb(input));
  const connection = createAcpAgent(context, acp).connect(stream);
  await connection.closed;
}

module.exports = {
  connectStdio,
  createAcpAgent,
  createAcpTransport,
  exactPromptInput,
  exactPromptText,
};
