import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { handleMcpRequest } from "../scripts/mcp-server.mjs";
import { loadSessions } from "../scripts/lib/sessions.mjs";
import { ensureSettings, saveSettings } from "../scripts/lib/settings.mjs";

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

test("plugin MCP config uses plugin-root relative script paths", async () => {
  const config = JSON.parse(await readFile(new URL("../.mcp.json", import.meta.url), "utf8"));
  const args = config.mcpServers["codex-voice"].args;
  assert.deepEqual(args, ["./scripts/mcp-server.mjs"]);
});

test("MCP tools/list exposes voice lifecycle tools", async () => {
  const response = await handleMcpRequest({
    id: 1,
    method: "tools/list",
    params: {},
  });

  assert.equal(response.id, 1);
  assert.equal(response.jsonrpc, "2.0");
  assert.deepEqual(
    response.result.tools.map((tool) => tool.name),
    ["codex_voice_on", "codex_voice_off", "codex_voice_status", "codex_voice_say"],
  );
});

test("codex_voice_status resolves current thread from CODEX_THREAD_ID", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-voice-mcp-env-thread-"));
  try {
    const response = await handleMcpRequest(
      {
        id: 7,
        method: "tools/call",
        params: {
          name: "codex_voice_status",
          arguments: {},
        },
      },
      {
        codexHome,
        env: {
          CODEX_THREAD_ID: "thread-from-env",
          CODEX_THREAD_TITLE: "Env Thread",
          PWD: "/tmp/env-thread",
        },
      },
    );

    assert.equal(response.jsonrpc, "2.0");
    assert.ifError(response.error);
    assert.match(response.result.content[0].text, /Status: inactive/);
    assert.match(response.result.content[0].text, /Thread: Env Thread/);
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
});

test("codex_voice_on resolves canonical cwd aliases from Codex state", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-voice-mcp-realpath-"));
  const project = await mkdtemp(path.join(os.tmpdir(), "codex-voice-project-"));
  try {
    const dbPath = path.join(codexHome, "state_5.sqlite");
    const canonicalProject = await realpath(project);
    await sqlite([
      dbPath,
      "create table threads (id text primary key, title text not null, cwd text not null, archived integer not null, recency_at_ms integer not null);",
    ]);
    await sqlite([
      dbPath,
      `insert into threads values ('canonical-thread', 'Canonical', '${canonicalProject.replaceAll("'", "''")}', 0, 1);`,
    ]);

    const response = await handleMcpRequest(
      {
        id: 8,
        method: "tools/call",
        params: {
          name: "codex_voice_on",
          arguments: { cwd: project },
        },
      },
      {
        codexHome,
        env: {},
        startListener: async () => ({ pid: 45678 }),
        fetch: async () => ({ status: 404 }),
      },
    );

    assert.equal(response.jsonrpc, "2.0");
    assert.ifError(response.error);
    assert.match(response.result.content[0].text, /Voice online for Canonical/);
  } finally {
    await rm(codexHome, { recursive: true, force: true });
    await rm(project, { recursive: true, force: true });
  }
});

test("codex_voice_on resolves the sidebar title from Codex state when threadId is provided", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-voice-mcp-title-by-id-"));
  try {
    const dbPath = path.join(codexHome, "state_5.sqlite");
    await sqlite([
      dbPath,
      "create table threads (id text primary key, title text not null, cwd text not null, archived integer not null, recency_at_ms integer not null);",
    ]);
    await sqlite([
      dbPath,
      "insert into threads values ('019f1cb4-5f93-7582-a92c-595f1d1ea0fe', 'Codex Voice', '/tmp/codex-voice', 0, 1);",
    ]);

    const response = await handleMcpRequest(
      {
        id: 9,
        method: "tools/call",
        params: {
          name: "codex_voice_on",
          arguments: { threadId: "019f1cb4-5f93-7582-a92c-595f1d1ea0fe" },
        },
      },
      {
        codexHome,
        env: {},
        startListener: async () => ({ pid: 56789 }),
        fetch: async () => ({ status: 404 }),
      },
    );

    assert.equal(response.jsonrpc, "2.0");
    assert.ifError(response.error);
    assert.match(response.result.content[0].text, /Voice online for Codex Voice/);
    assert.doesNotMatch(response.result.content[0].text, /019f1cb4/);

    const registry = await loadSessions({ codexHome });
    assert.equal(registry.sessions["019f1cb4-5f93-7582-a92c-595f1d1ea0fe"].threadName, "Codex Voice");
    assert.equal(registry.sessions["019f1cb4-5f93-7582-a92c-595f1d1ea0fe"].cwd, "/tmp/codex-voice");
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
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

test("codex_voice_on reuses an already active listener for the same thread", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-voice-mcp-reuse-"));
  let starts = 0;
  try {
    const deps = {
      codexHome,
      startListener: async () => {
        starts += 1;
        return { pid: 12345, alreadyRunning: false };
      },
      isProcessAlive: () => true,
      fetch: async () => ({ status: 404 }),
    };

    await handleMcpRequest(
      {
        id: 40,
        method: "tools/call",
        params: {
          name: "codex_voice_on",
          arguments: { threadId: "thread-a", threadName: "Alpha" },
        },
      },
      deps,
    );

    const second = await handleMcpRequest(
      {
        id: 41,
        method: "tools/call",
        params: {
          name: "codex_voice_on",
          arguments: { threadId: "thread-a", threadName: "Alpha" },
        },
      },
      deps,
    );

    assert.ifError(second.error);
    assert.equal(starts, 1);
    assert.match(second.result.content[0].text, /Voice already online for Alpha/);
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
});

test("codex_voice_on refreshes active listeners when settings change", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-voice-mcp-refresh-"));
  const startedSettings = [];
  const stoppedPids = [];
  let nextPid = 100;
  try {
    const deps = {
      codexHome,
      startListener: async ({ settings }) => {
        startedSettings.push(settings);
        nextPid += 1;
        return { pid: nextPid, alreadyRunning: false };
      },
      stopProcess: async (pid) => {
        stoppedPids.push(pid);
        return { stopped: true, pid };
      },
      isProcessAlive: () => true,
      fetch: async () => ({ status: 404 }),
    };

    await handleMcpRequest(
      {
        id: 42,
        method: "tools/call",
        params: {
          name: "codex_voice_on",
          arguments: { threadId: "thread-a", threadName: "Alpha" },
        },
      },
      deps,
    );

    const { settings } = await ensureSettings({ codexHome });
    settings.sideChannel.acknowledgementWords = ["Sweet as"];
    settings.sideChannel.maxContextChars = 600;
    await saveSettings({ codexHome }, settings);

    const second = await handleMcpRequest(
      {
        id: 43,
        method: "tools/call",
        params: {
          name: "codex_voice_on",
          arguments: { threadId: "thread-a", threadName: "Alpha" },
        },
      },
      deps,
    );

    assert.ifError(second.error);
    assert.equal(startedSettings.length, 2);
    assert.deepEqual(stoppedPids, [101]);
    assert.match(second.result.content[0].text, /Voice refreshed for Alpha/);
    assert.deepEqual(startedSettings.at(-1).sideChannel.acknowledgementWords, ["Sweet as"]);

    const registry = await loadSessions({ codexHome });
    assert.equal(registry.sessions["thread-a"].port, 6901);
    assert.equal(registry.sessions["thread-a"].pid, 102);
    assert.equal(typeof registry.sessions["thread-a"].settingsSignature, "string");
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

test("codex_voice_say speaks a concise main-thread summary for an active voice session", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-voice-mcp-say-"));
  const played = [];
  const fetchCalls = [];
  try {
    await handleMcpRequest(
      {
        id: 30,
        method: "tools/call",
        params: {
          name: "codex_voice_on",
          arguments: { threadId: "thread-a", threadName: "Alpha" },
        },
      },
      {
        codexHome,
        startListener: async () => ({ pid: 45678 }),
        fetch: async () => ({ status: 404 }),
      },
    );

    const response = await handleMcpRequest(
      {
        id: 31,
        method: "tools/call",
        params: {
          name: "codex_voice_say",
          arguments: {
            threadId: "thread-a",
            text: "**Tests passed**; I am updating the *docs* now.",
          },
        },
      },
      {
        codexHome,
        fetch: async (url, options = {}) => {
          fetchCalls.push({ url: String(url), options });
          return {
            ok: true,
            status: 200,
            arrayBuffer: async () => Buffer.from("audio").buffer,
          };
        },
        player: async (audioPath) => {
          played.push(audioPath);
        },
      },
    );

    assert.ifError(response.error);
    assert.match(response.result.content[0].text, /Spoken summary for Alpha/);
    assert.equal(played.length, 1);
    assert.ok(fetchCalls.some((call) => call.url.includes("/v1/tts")));
    assert.equal(
      JSON.parse(fetchCalls.find((call) => call.url.includes("/v1/tts")).options.body).text,
      "Tests passed; I am updating the docs now.",
    );
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
        env: {},
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
