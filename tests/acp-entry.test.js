"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const {
  createAcpAgent,
  createAcpTransport,
  exactPromptInput,
  exactPromptText,
} = require("../lib/acp-entry");
const { expertSourceRefName, reopenExpertSource } = require("../lib/expert-source-ingress");
const { readSourceBearingOwnerIngress } = require("../lib/source-bearing-owner-ingress");
const { tempDir } = require("./helpers/cli");
const { git } = require("./helpers/linear-product-head");

function fakeAcp() {
  class RequestError extends Error {
    constructor(code, data, message) {
      super(message);
      this.code = code;
      this.data = data;
    }

    static invalidParams(data = {}, message = "invalid params") {
      return new RequestError(-32602, data, message);
    }
  }

  return { RequestError, PROTOCOL_VERSION: 1 };
}

function repository(t, { managed = true } = {}) {
  const parent = tempDir("acp-entry-");
  const root = path.join(parent, "repo");
  fs.mkdirSync(root);
  git(root, ["init"]);
  git(root, ["config", "user.name", "ACP Entry Test"]);
  git(root, ["config", "user.email", "acp-entry@example.invalid"]);
  fs.writeFileSync(path.join(root, "README.md"), "baseline\n", "utf8");
  if (managed) {
    fs.mkdirSync(path.join(root, ".meta-harness"), { recursive: true });
    fs.writeFileSync(path.join(root, ".meta-harness", "repo-charter.json"), "{}\n", "utf8");
  }
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "baseline"]);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return root;
}

function context(root) {
  return {
    cwd: root,
    env: {},
    platform: process.platform,
    stdout: { write() {} },
    stderr: { write() {} },
  };
}

async function assertInvalid(action, pattern) {
  await assert.rejects(
    Promise.resolve().then(action),
    (error) => error?.code === -32602 && pattern.test(error.message),
  );
}

test("exact ACP text reaches the shared product entry unchanged and transport identity stays ephemeral", async (t) => {
  const root = repository(t);
  const acp = fakeAcp();
  const calls = [];
  const updates = [];
  const transport = createAcpTransport(context(root), {
    acp,
    runProductResult: async (productResult, runContext) => {
      calls.push({ productResult, runContext });
      runContext.stdout.write("Done — mediated.\n");
      return { exitCode: 0 };
    },
  });

  const first = transport.newSession({ cwd: root, mcpServers: [] });
  const second = transport.newSession({ cwd: root, mcpServers: [], additionalDirectories: [] });
  assert.match(first.sessionId, /^transport-[0-9a-f-]{36}$/u);
  assert.match(second.sessionId, /^transport-[0-9a-f-]{36}$/u);
  assert.notEqual(first.sessionId, second.sessionId);

  const prompt = "  Review: SAW → 雪\r\nDecision needed?\r\nkeep  spaces  ";
  const result = await transport.prompt({
    sessionId: first.sessionId,
    prompt: [{ type: "text", text: prompt }],
  }, {
    signal: new AbortController().signal,
    sendUpdate: async (text) => updates.push(text),
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].productResult, prompt);
  assert.equal(calls[0].runContext.cwd, fs.realpathSync.native(root));
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0].runContext, "sessionId"), false);
  assert.equal(result.stopReason, "end_turn");
  assert.deepEqual(updates, ["Done — mediated.\n"]);
  assert.equal(fs.existsSync(path.join(root, ".git", "meta-harness")), false);
});

test("unsupported session scope and prompt shapes fail before product execution", async (t) => {
  const root = repository(t);
  const other = repository(t);
  const unmanaged = repository(t, { managed: false });
  fs.mkdirSync(path.join(root, "subdir"));
  const acp = fakeAcp();
  let executions = 0;
  const transport = createAcpTransport(context(root), {
    acp,
    runProductResult: async () => { executions += 1; },
  });

  await assertInvalid(
    () => transport.newSession({ cwd: root, mcpServers: [{ command: "danger" }] }),
    /mcpServers are rejected/u,
  );
  await assertInvalid(
    () => transport.newSession({ cwd: root, mcpServers: [], additionalDirectories: [other] }),
    /additionalDirectories.*rejected/u,
  );
  await assertInvalid(
    () => transport.newSession({ cwd: path.join(root, "subdir"), mcpServers: [] }),
    /repository root exactly/u,
  );
  await assertInvalid(
    () => transport.newSession({ cwd: unmanaged, mcpServers: [] }),
    /not a Meta-Harness managed repository/u,
  );

  const session = transport.newSession({ cwd: root, mcpServers: [] });
  await assertInvalid(
    () => transport.newSession({ cwd: other, mcpServers: [] }),
    /alternate workspace roots are rejected/u,
  );
  await assertInvalid(
    () => transport.prompt({ sessionId: session.sessionId, prompt: [] }, {
      signal: new AbortController().signal,
      sendUpdate: async () => {},
    }),
    /exactly one non-empty text block/u,
  );
  await assertInvalid(
    () => transport.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "one" }, { type: "text", text: "two" }],
    }, {
      signal: new AbortController().signal,
      sendUpdate: async () => {},
    }),
    /exactly one non-empty text block/u,
  );
  await assertInvalid(
    () => transport.prompt({ sessionId: session.sessionId, prompt: [{ type: "image", data: "x" }] }, {
      signal: new AbortController().signal,
      sendUpdate: async () => {},
    }),
    /exactly one non-empty text block/u,
  );
  await assertInvalid(
    () => transport.prompt({ sessionId: "transport-unknown", prompt: [{ type: "text", text: "x" }] }, {
      signal: new AbortController().signal,
      sendUpdate: async () => {},
    }),
    /unknown ACP transport session/u,
  );

  assert.equal(executions, 0);
  assert.equal(fs.existsSync(path.join(root, ".git", "meta-harness")), false);
});

test("ACP ResourceLink capture preserves raw text and exact source bytes without checkout mutation", async (t) => {
  const root = repository(t);
  const externalPath = path.join(path.dirname(root), "field-procedure.txt");
  const sourceText = "Threshold 0.60. Preserve INDETERMINATE when intervals overlap.\n";
  fs.writeFileSync(externalPath, sourceText, "utf8");
  const acp = fakeAcp();
  const calls = [];
  const before = {
    head: git(root, ["rev-parse", "HEAD"]),
    status: git(root, ["status", "--porcelain=v1", "--untracked-files=all"]),
    index: git(root, ["diff", "--cached", "--binary"]),
  };
  const transport = createAcpTransport(context(root), {
    acp,
    runProductResult: async (productResult, runContext) => {
      calls.push({ productResult, runContext });
      runContext.stdout.write("Done — captured.\n");
      return { exitCode: 0 };
    },
  });
  const session = transport.newSession({ cwd: root, mcpServers: [] });
  const rawText = "  Apply the attached procedure.\r\nPreserve uncertainty.  ";
  const result = await transport.prompt({
    sessionId: session.sessionId,
    prompt: [
      { type: "text", text: rawText },
      { type: "resource_link", name: "field-procedure.txt", uri: pathToFileURL(externalPath).href },
    ],
  }, {
    signal: new AbortController().signal,
    sendUpdate: async () => {},
  });

  assert.deepEqual(result, { stopReason: "end_turn" });
  assert.equal(calls[0].productResult, rawText);
  assert.match(calls[0].runContext.ownerIngressDigest, /^sha256:[a-f0-9]{64}$/u);
  const ingress = readSourceBearingOwnerIngress(root, calls[0].runContext.ownerIngressDigest);
  assert.equal(ingress.rawText, rawText);
  assert.equal(ingress.sources[0].name, "field-procedure.txt");
  const reopened = reopenExpertSource(root, ingress.sources[0]);
  assert.equal(reopened.text, sourceText);
  assert.equal(git(root, ["rev-parse", expertSourceRefName(reopened.contentDigest)]), reopened.blobOid);
  assert.equal(git(root, ["rev-parse", "HEAD"]), before.head);
  assert.equal(git(root, ["status", "--porcelain=v1", "--untracked-files=all"]), before.status);
  assert.equal(git(root, ["diff", "--cached", "--binary"]), before.index);
});

test("F1R valid Text + ResourceLink transport passes three fresh trials", async (t) => {
  for (let trial = 1; trial <= 3; trial += 1) {
    const root = repository(t);
    const externalPath = path.join(path.dirname(root), `f1r-${trial}.txt`);
    fs.writeFileSync(externalPath, `F1R source ${trial}.\n`, "utf8");
    const acp = fakeAcp();
    const calls = [];
    const transport = createAcpTransport(context(root), {
      acp,
      runProductResult: async (productResult, runContext) => {
        calls.push({ productResult, runContext });
        return { exitCode: 0 };
      },
    });
    const session = transport.newSession({ cwd: root, mcpServers: [] });
    const rawText = `F1R owner text ${trial}.`;
    const result = await transport.prompt({
      sessionId: session.sessionId,
      prompt: [
        { type: "text", text: rawText },
        { type: "resource_link", name: `f1r-${trial}.txt`, uri: pathToFileURL(externalPath).href },
      ],
    }, {
      signal: new AbortController().signal,
      sendUpdate: async () => {},
    });
    assert.equal(result.stopReason, "end_turn");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].productResult, rawText);
    const ingress = readSourceBearingOwnerIngress(root, calls[0].runContext.ownerIngressDigest);
    assert.equal(ingress.sources.length, 1);
    assert.equal(reopenExpertSource(root, ingress.sources[0]).text, `F1R source ${trial}.\n`);
  }
});

test("ACP ResourceLink admission rejects hosted file URLs before source persistence", async (t) => {
  const root = repository(t);
  const externalPath = path.join(path.dirname(root), "good-source.txt");
  fs.writeFileSync(externalPath, "good source\n", "utf8");
  const acp = fakeAcp();
  let executions = 0;
  const transport = createAcpTransport(context(root), {
    acp,
    runProductResult: async () => { executions += 1; },
  });
  const session = transport.newSession({ cwd: root, mcpServers: [] });

  await assertInvalid(
    () => transport.prompt({
      sessionId: session.sessionId,
      prompt: [
        { type: "text", text: "Use the sources." },
        { type: "resource_link", name: "good.txt", uri: pathToFileURL(externalPath).href },
        { type: "resource_link", name: "remote.txt", uri: "file://remote-host/share/source.txt" },
      ],
    }, {
      signal: new AbortController().signal,
      sendUpdate: async () => {},
    }),
    /empty hostname/u,
  );
  assert.equal(executions, 0);
  assert.equal(git(root, ["for-each-ref", "--format=%(refname)", "refs/meta-harness/research-sources"]), "");

  await assertInvalid(
    () => transport.prompt({
      sessionId: session.sessionId,
      prompt: [
        { type: "text", text: "Use this." },
        { type: "resource_link", name: "localhost.txt", uri: "file://localhost/tmp/source.txt" },
      ],
    }, {
      signal: new AbortController().signal,
      sendUpdate: async () => {},
    }),
    /empty hostname/u,
  );
});

test("session/cancel drains the active turn and the same transport session can recover", async (t) => {
  const root = repository(t);
  const acp = fakeAcp();
  const updates = [];
  let started;
  const didStart = new Promise((resolve) => { started = resolve; });
  const transport = createAcpTransport(context(root), {
    acp,
    runProductResult: async (productResult, runContext) => {
      if (productResult === "first") {
        started();
        if (!runContext.signal.aborted) {
          await new Promise((resolve) => runContext.signal.addEventListener("abort", resolve, { once: true }));
        }
        runContext.stdout.write("Stopped safely — continuation is automatic next time.\n");
        return { exitCode: 0 };
      }
      runContext.stdout.write("Done — recovered.\n");
      return { exitCode: 0 };
    },
  });
  const session = transport.newSession({ cwd: root, mcpServers: [] });

  const first = transport.prompt({
    sessionId: session.sessionId,
    prompt: [{ type: "text", text: "first" }],
  }, {
    signal: new AbortController().signal,
    sendUpdate: async (text) => updates.push(text),
  });
  await didStart;
  transport.cancel({ sessionId: session.sessionId });
  assert.deepEqual(await first, { stopReason: "cancelled" });

  const second = await transport.prompt({
    sessionId: session.sessionId,
    prompt: [{ type: "text", text: "second" }],
  }, {
    signal: new AbortController().signal,
    sendUpdate: async (text) => updates.push(text),
  });
  assert.deepEqual(second, { stopReason: "end_turn" });
  assert.deepEqual(updates, [
    "Stopped safely — continuation is automatic next time.\n",
    "Done — recovered.\n",
  ]);
});

test("ACP app registers only baseline inbound handlers and only emits session/update", async (t) => {
  const root = repository(t);
  const requests = new Map();
  const notifications = new Map();
  const acp = {
    ...fakeAcp(),
    methods: {
      agent: {
        initialize: "initialize",
        session: {
          new: "session/new",
          prompt: "session/prompt",
          cancel: "session/cancel",
        },
      },
      client: { session: { update: "session/update" } },
    },
    agent() {
      return {
        onRequest(method, handler) {
          requests.set(method, handler);
          return this;
        },
        onNotification(method, handler) {
          notifications.set(method, handler);
          return this;
        },
      };
    },
  };
  createAcpAgent(context(root), acp, {
    runProductResult: async (_text, runContext) => {
      runContext.stdout.write("Done — isolated.\n");
      return { exitCode: 0 };
    },
  });

  assert.deepEqual([...requests.keys()].sort(), ["initialize", "session/new", "session/prompt"]);
  assert.deepEqual([...notifications.keys()], ["session/cancel"]);

  const session = requests.get("session/new")({ params: { cwd: root, mcpServers: [] } });
  const clientCalls = [];
  const client = new Proxy({
    notify: async (...args) => { clientCalls.push(args); },
  }, {
    get(target, property, receiver) {
      if (property === "request") throw new Error("ACP mutation request authority must not be used");
      return Reflect.get(target, property, receiver);
    },
  });
  const response = await requests.get("session/prompt")({
    params: { sessionId: session.sessionId, prompt: [{ type: "text", text: "owner text" }] },
    signal: new AbortController().signal,
    client,
  });

  assert.deepEqual(response, { stopReason: "end_turn" });
  assert.deepEqual(clientCalls, [["session/update", {
    sessionId: session.sessionId,
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Done — isolated.\n" },
    },
  }]]);
});

test("exact prompt validation does not trim, normalize, or concatenate", () => {
  const value = "\r\n  雪  \r\n";
  assert.equal(exactPromptText([{ type: "text", text: value }]), value);
  const parsed = exactPromptInput([
    { type: "resource_link", name: "a.txt", uri: "file:///tmp/a.txt" },
    { type: "text", text: value },
    { type: "resource_link", name: "b.txt", uri: "file:///tmp/b.txt" },
  ]);
  assert.equal(parsed.text, value);
  assert.deepEqual(parsed.resources.map((entry) => entry.name), ["a.txt", "b.txt"]);
  assert.equal(exactPromptText([{ type: "text", text: "" }]), null);
  assert.equal(exactPromptText([{ type: "text", text: "a" }, { type: "text", text: "b" }]), null);
  assert.equal(exactPromptInput([{ type: "text", text: "a" }, { type: "image", data: "x" }]), null);
});
