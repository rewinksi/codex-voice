import assert from "node:assert/strict";
import test from "node:test";

import { createListenerBridge, createVoiceServer } from "../scripts/voice-listener.mjs";

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test("voice listener exposes health and OpenAI-compatible model endpoints", async () => {
  const server = createVoiceServer({
    session: { threadId: "thread-a", threadName: "Alpha", port: 0 },
    settings: { host: "127.0.0.1", stt: {} },
    bridge: { sendText: async () => ({ delivered: true }) },
  });
  const port = await listen(server);

  try {
    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, "ok");

    const models = await fetch(`http://127.0.0.1:${port}/v1/models`);
    assert.equal(models.status, 200);
    const body = await models.json();
    assert.equal(body.object, "list");
    assert.equal(body.data[0].id, "codex-voice-stt");
  } finally {
    await close(server);
  }
});

test("voice listener forwards chat completion text to the bridge", async () => {
  const received = [];
  const server = createVoiceServer({
    session: { threadId: "thread-a", threadName: "Alpha", port: 0 },
    settings: { host: "127.0.0.1", stt: {} },
    bridge: {
      sendText: async (session, text) => {
        received.push({ session, text });
        return { delivered: true, mode: "turn/start" };
      },
    },
  });
  const port = await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "what changed?" }] }),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.choices[0].message.content, "Voice command received.");
    assert.equal(received.length, 1);
    assert.equal(received[0].text, "what changed?");
    assert.equal(received[0].session.threadId, "thread-a");
  } finally {
    await close(server);
  }
});

test("voice listener rejects requests without configured bearer token", async () => {
  const server = createVoiceServer({
    session: { threadId: "thread-a", threadName: "Alpha", port: 0 },
    settings: { host: "127.0.0.1", stt: { bearerToken: "token-123" } },
    bridge: { sendText: async () => ({ delivered: true }) },
  });
  const port = await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    });

    assert.equal(response.status, 401);
  } finally {
    await close(server);
  }
});

test("createListenerBridge passes session CODEX_HOME to the app-server bridge", () => {
  const bridgeOptions = createListenerBridge(
    { codexHome: "/tmp/codex-home-for-test" },
    (options) => options,
  );

  assert.equal(bridgeOptions.appServer.env.CODEX_HOME, "/tmp/codex-home-for-test");
});
