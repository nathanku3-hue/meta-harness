"use strict";

const nodeProcess = require("node:process");
const { extractInsights, renderInsightMarkdown } = require("./insight-extractor");
const { generateResearchPrompt } = require("./research-prompt-generator");
const { readWorkspaceFiles } = require("./mcp-workspaces");

const PROTOCOL_VERSION = "2024-11-05";

function textResult(text) {
  return {
    content: [{ type: "text", text }],
  };
}

function toolDescriptors() {
  return [
    {
      name: "harness-status",
      description: "Read the local meta-harness status and package identity for the current workspace.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "harness-research-prompt",
      description: "Generate a copy-paste Deep Research prompt from a question and workspace file paths.",
      inputSchema: {
        type: "object",
        required: ["question", "files"],
        properties: {
          question: { type: "string" },
          files: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    },
    {
      name: "harness-insight-summary",
      description: "Summarize provided git diff and task log text into deterministic implementation insights.",
      inputSchema: {
        type: "object",
        properties: {
          diffText: { type: "string" },
          logText: { type: "string" },
          json: { type: "boolean" },
        },
        additionalProperties: false,
      },
    },
  ];
}

function readOptionalText(fsApi, path) {
  try {
    return fsApi.readFileSync(path, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return "";
    throw error;
  }
}

function createMcpServer(options = {}) {
  const root = options.root || options.cwd || ".";
  const fsApi = options.fs || require("node:fs");
  const pathApi = options.path || require("node:path");

  function harnessStatus() {
    const statusPath = pathApi.join(root, ".meta-harness", "status.md");
    const packagePath = pathApi.join(root, "package.json");
    const status = readOptionalText(fsApi, statusPath).trim();
    const packageJson = JSON.parse(readOptionalText(fsApi, packagePath) || "{}");
    return textResult(JSON.stringify({
      schema_version: "1.0.0",
      package: {
        name: packageJson.name || null,
        version: packageJson.version || null,
      },
      status_path: ".meta-harness/status.md",
      status: status || null,
    }, null, 2));
  }

  function researchPrompt(input) {
    const files = readWorkspaceFiles(root, input.files || [], fsApi);
    return textResult(generateResearchPrompt({
      question: input.question,
      files,
    }));
  }

  function insightSummary(input) {
    const insights = extractInsights({
      diffText: input.diffText || "",
      logText: input.logText || "",
    });
    return textResult(input.json ? `${JSON.stringify(insights, null, 2)}\n` : renderInsightMarkdown(insights));
  }

  const handlers = {
    "harness-status": harnessStatus,
    "harness-research-prompt": researchPrompt,
    "harness-insight-summary": insightSummary,
  };

  return {
    toolDescriptors,
    async callTool(name, input = {}) {
      const handler = handlers[name];
      if (!handler) throw new Error(`Unknown MCP tool: ${name}`);
      return handler(input);
    },
    async handleRequest(request) {
      if (request.method === "initialize") {
        return {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "meta-harness", version: "0.2.0" },
        };
      }
      if (request.method === "tools/list") {
        return { tools: toolDescriptors() };
      }
      if (request.method === "tools/call") {
        const params = request.params || {};
        return this.callTool(params.name, params.arguments || {});
      }
      if (request.method === "shutdown") {
        return null;
      }
      throw new Error(`Unsupported MCP method: ${request.method}`);
    },
  };
}

function writeFrame(output, message) {
  const body = JSON.stringify(message);
  output.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}

function errorResponse(id, error) {
  return {
    jsonrpc: "2.0",
    id: id === undefined ? null : id,
    error: {
      code: -32000,
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

function extractFrames(buffer) {
  const frames = [];
  let remaining = buffer;
  while (true) {
    const separator = remaining.indexOf("\r\n\r\n");
    if (separator === -1) break;
    const header = remaining.slice(0, separator);
    const match = header.match(/content-length:\s*(\d+)/i);
    if (!match) throw new Error("Missing Content-Length header.");
    const length = Number(match[1]);
    const bodyStart = separator + 4;
    const bodyEnd = bodyStart + length;
    if (remaining.length < bodyEnd) break;
    frames.push(remaining.slice(bodyStart, bodyEnd));
    remaining = remaining.slice(bodyEnd);
  }
  return { frames, remaining };
}

function runStdioServer(options = {}) {
  const input = options.input || nodeProcess.stdin;
  const output = options.output || nodeProcess.stdout;
  const server = options.server || createMcpServer(options);
  let buffer = "";

  return new Promise((resolve, reject) => {
    input.setEncoding("utf8");
    input.on("data", async (chunk) => {
      buffer += chunk;
      let parsed;
      try {
        parsed = extractFrames(buffer);
        buffer = parsed.remaining;
      } catch (error) {
        writeFrame(output, errorResponse(null, error));
        return;
      }
      for (const frame of parsed.frames) {
        let request;
        try {
          request = JSON.parse(frame);
          if (request.id === undefined) continue;
          const result = await server.handleRequest(request);
          writeFrame(output, { jsonrpc: "2.0", id: request.id, result });
        } catch (error) {
          writeFrame(output, errorResponse(request && request.id, error));
        }
      }
    });
    input.on("end", resolve);
    input.on("error", reject);
    output.on("error", reject);
  });
}

module.exports = {
  PROTOCOL_VERSION,
  createMcpServer,
  extractFrames,
  runStdioServer,
  toolDescriptors,
  writeFrame,
};
