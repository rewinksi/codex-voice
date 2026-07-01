import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { handleMcpRequest } from "../scripts/mcp-server.mjs";
import { loadSessions } from "../scripts/lib/sessions.mjs";

function sqlite(args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile("sqlite3", args, options, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

test("MCP tools/list exposes voice lifecycle tools", async () => {
  const response = await handleMcpRequest({
    id: 1,
    method: "tools/list",
    params: {},
  });

  assert.equal(response.id, 1);
  assert.deepEqual(
    response.result.tools.map((tool) => tool.name),
    ["codex_voice_on", "codex_voice_off", "codex_voice_status"],
  );
});

test("codex_voice_on allocates a session, starts listener, and returns endpoint first", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-voice-mcp-on-"));
  const starts = [];
  try {
    const response = await handleMcpRequest(
      {
        id: 2,
        method: "tools/call",
        params: {
          name: "codex_voice_on",
          arguments: {
            threadId: "thread-a",
            threadName: "Alpha",
            cwd: "/tmp/project",
          },
        },
      },
      {
        codexHome,
        startListener: async ({ session }) => {
          starts.push(session);
          return { pid: 12345, alreadyRunning: false };
        },
        fetch: async () => ({ status: 404 }),
      },
    );

    const text = response.result.content[0].text;
    assert.ok(text.startsWith("Voice listener endpoint: http://127.0.0.1:6901/v1/chat/completions"));
    assert.match(text, /Voice online for Alpha/);
    assert.equal(starts.length, 1);

    const registry = await loadSessions({ codexHome });
    assert.equal(registry.sessions["thread-a"].active, true);
    assert.equal(registry.sessions["thread-a"].pid, 12345);
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
});

test("codex_voice_status and codex_voice_off inspect and stop the thread session", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-voice-mcp-off-"));
  try {
    await handleMcpRequest(
      {
        id: 3,
        method: "tools/call",
        params: {
          name: "codex_voice_on",
          arguments: { threadId: "thread-a", threadName: "Alpha" },
        },
      },
      {
        codexHome,
        startListener: async () => ({ pid: 23456 }),
        fetch: async () => ({ status: 404 }),
      },
    );

    const status = await handleMcpRequest(
      {
        id: 4,
        method: "tools/call",
        params: {
          name: "codex_voice_status",
          arguments: { threadId: "thread-a" },
        },
      },
      { codexHome },
    );
    assert.match(status.result.content[0].text, /Status: active/);
    assert.match(status.result.content[0].text, /6901/);

    const off = await handleMcpRequest(
      {
        id: 5,
        method: "tools/call",
        params: {
          name: "codex_voice_off",
          arguments: { threadId: "thread-a" },
        },
      },
      {
        codexHome,
        stopProcess: async (pid) => ({ stopped: true, pid }),
      },
    );
    assert.match(off.result.content[0].text, /Voice offline for Alpha/);

    const registry = await loadSessions({ codexHome });
    assert.equal(registry.sessions["thread-a"].active, false);
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
});

test("codex_voice_on resolves thread id from Codex state when cwd is provided", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-voice-mcp-state-"));
  try {
    const dbPath = path.join(codexHome, "state_5.sqlite");
    await sqlite([
      dbPath,
      "create table threads (id text primary key, title text not null, cwd text not null, archived integer not null, recency_at_ms integer not null);",
    ]);
    await sqlite([
      dbPath,
      "insert into threads values ('old-thread', 'Old', '/tmp/project', 0, 1); insert into threads values ('new-thread', 'Newest', '/tmp/project', 0, 2);",
    ]);

    const response = await handleMcpRequest(
      {
        id: 6,
        method: "tools/call",
        params: {
          name: "codex_voice_on",
          arguments: { cwd: "/tmp/project" },
        },
      },
      {
        codexHome,
        startListener: async () => ({ pid: 34567 }),
        fetch: async () => ({ status: 404 }),
      },
    );

    assert.ifError(response.error);
    assert.match(response.result.content[0].text, /Voice online for Newest/);

    const registry = await loadSessions({ codexHome });
    assert.equal(registry.sessions["new-thread"].port, 6901);
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
});
