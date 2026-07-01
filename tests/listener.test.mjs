import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createVoiceServer } from "../scripts/voice-listener.mjs";

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

test("voice listener records side-channel text without injecting into Codex", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-voice-side-channel-"));
  const responded = [];
  const server = createVoiceServer({
    session: { threadId: "thread-a", threadName: "Alpha", port: 0 },
    settings: { host: "127.0.0.1", stt: {} },
    codexHome,
    sideChannelResponder: async ({ session, text }) => {
      responded.push({ session, text });
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
    assert.equal(body.choices[0].message.content, "Side-channel message received.");

    const logPath = path.join(codexHome, "voice", "side-channel.jsonl");
    const entry = JSON.parse((await readFile(logPath, "utf8")).trim());
    assert.equal(entry.threadId, "thread-a");
    assert.equal(entry.threadName, "Alpha");
    assert.equal(entry.text, "what changed?");
    assert.equal(entry.route, "side-channel");
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(responded.length, 1);
    assert.equal(responded[0].text, "what changed?");
    assert.equal(responded[0].session.threadId, "thread-a");
  } finally {
    await close(server);
    await rm(codexHome, { recursive: true, force: true });
  }
});

test("voice listener rejects requests without configured bearer token", async () => {
  const server = createVoiceServer({
    session: { threadId: "thread-a", threadName: "Alpha", port: 0 },
    settings: { host: "127.0.0.1", stt: { bearerToken: "token-123" } },
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
