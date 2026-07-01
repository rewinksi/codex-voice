import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  CodexAppServerClient,
  CodexBridge,
  JsonRpcLineClient,
} from "../scripts/lib/codex-bridge.mjs";

test("JsonRpcLineClient sends requests and resolves matching responses", async () => {
  const clientToServer = new PassThrough();
  const serverToClient = new PassThrough();
  const rpc = new JsonRpcLineClient({ input: serverToClient, output: clientToServer });

  const seen = new Promise((resolve) => {
    clientToServer.once("data", (chunk) => resolve(JSON.parse(String(chunk))));
  });

  const pending = rpc.request("ping", { ok: true });
  const request = await seen;
  assert.equal(request.method, "ping");
  assert.deepEqual(request.params, { ok: true });

  serverToClient.write(`${JSON.stringify({ id: request.id, result: { pong: true } })}\n`);
  assert.deepEqual(await pending, { pong: true });
});

test("JsonRpcLineClient rejects JSON-RPC errors", async () => {
  const clientToServer = new PassThrough();
  const serverToClient = new PassThrough();
  const rpc = new JsonRpcLineClient({ input: serverToClient, output: clientToServer });

  const pending = rpc.request("boom", {});
  const request = JSON.parse(String(clientToServer.read() || await new Promise((resolve) => clientToServer.once("data", resolve))));
  serverToClient.write(`${JSON.stringify({ id: request.id, error: { code: -1, message: "nope" } })}\n`);

  await assert.rejects(pending, /nope/);
});

test("CodexAppServerClient initializes, resumes thread, and starts idle turns", async () => {
  const calls = [];
  const fakeRpc = {
    request: async (method, params) => {
      calls.push({ method, params });
      if (method === "initialize") return { ok: true };
      if (method === "thread/resume") {
        return {
          thread: {
            id: params.threadId,
            status: { type: "idle" },
            turns: [],
          },
        };
      }
      if (method === "turn/start") return { turn: { id: "turn-1" } };
      throw new Error(`unexpected ${method}`);
    },
    notify: (method, params) => calls.push({ method, params }),
  };

  const client = new CodexAppServerClient({ rpc: fakeRpc });
  const result = await client.sendText(
    { threadId: "thread-a", cwd: "/tmp/project" },
    "run the tests",
  );

  assert.equal(result.delivered, true);
  assert.equal(result.mode, "turn/start");
  assert.deepEqual(calls.map((call) => call.method), [
    "initialize",
    "initialized",
    "thread/resume",
    "turn/start",
  ]);
  assert.deepEqual(calls.at(-1).params.input, [{ type: "text", text: "run the tests" }]);
});

test("CodexAppServerClient steers active in-progress turns", async () => {
  const calls = [];
  const fakeRpc = {
    request: async (method, params) => {
      calls.push({ method, params });
      if (method === "initialize") return { ok: true };
      if (method === "thread/resume") {
        return {
          thread: {
            id: params.threadId,
            status: { type: "active", activeFlags: [] },
            turns: [{ id: "turn-active", status: "inProgress", items: [] }],
          },
        };
      }
      if (method === "turn/steer") return {};
      throw new Error(`unexpected ${method}`);
    },
    notify: (method, params) => calls.push({ method, params }),
  };

  const client = new CodexAppServerClient({ rpc: fakeRpc });
  const result = await client.sendText({ threadId: "thread-a" }, "pause and explain");

  assert.equal(result.delivered, true);
  assert.equal(result.mode, "turn/steer");
  const steer = calls.find((call) => call.method === "turn/steer");
  assert.equal(steer.params.expectedTurnId, "turn-active");
  assert.deepEqual(steer.params.input, [{ type: "text", text: "pause and explain" }]);
});

test("CodexBridge returns structured bridge failures without throwing", async () => {
  const bridge = new CodexBridge({
    clientFactory: () => ({
      sendText: async () => {
        throw new Error("app-server unavailable");
      },
    }),
  });

  const result = await bridge.sendText({ threadId: "thread-a" }, "hello");
  assert.equal(result.delivered, false);
  assert.equal(result.reason, "app-server unavailable");
  assert.equal(result.threadId, "thread-a");
});
