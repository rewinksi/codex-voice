#!/usr/bin/env node
import { createInterface } from "node:readline";
import { spawn, execFile } from "node:child_process";
import { openSync, closeSync } from "node:fs";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getLogsDir, getRuntimeSessionPath } from "./lib/paths.mjs";
import { ensureSettings, settingsSignature } from "./lib/settings.mjs";
import {
  allocateSession,
  loadSessions,
  releaseSession,
  setSessionPid,
} from "./lib/sessions.mjs";
import { summarizeForSpeech } from "./lib/thread-watch.mjs";
import { resolveTtsProvider, speakText } from "./lib/tts.mjs";

const SERVER_INFO = {
  name: "codex-voice",
  version: "0.1.7",
};

const TOOL_DEFS = [
  {
    name: "codex_voice_on",
    description: "Start or reuse the current thread's Codex Voice listener.",
    inputSchema: {
      type: "object",
      properties: {
        threadId: { type: "string", description: "Current Codex thread id, when known." },
        threadName: { type: "string", description: "User-facing thread title." },
        cwd: { type: "string", description: "Current thread working directory." },
      },
    },
  },
  {
    name: "codex_voice_off",
    description: "Stop the current thread's Codex Voice listener.",
    inputSchema: {
      type: "object",
      properties: {
        threadId: { type: "string", description: "Current Codex thread id." },
        cwd: { type: "string", description: "Current thread working directory." },
      },
    },
  },
  {
    name: "codex_voice_status",
    description: "Inspect the current thread's Codex Voice listener state.",
    inputSchema: {
      type: "object",
      properties: {
        threadId: { type: "string", description: "Current Codex thread id." },
        cwd: { type: "string", description: "Current thread working directory." },
      },
    },
  },
  {
    name: "codex_voice_say",
    description: "Speak a concise voice summary for the current thread when Codex Voice is active.",
    inputSchema: {
      type: "object",
      properties: {
        threadId: { type: "string", description: "Current Codex thread id." },
        cwd: { type: "string", description: "Current thread working directory." },
        text: { type: "string", description: "Short spoken summary. Do not include secrets, code, logs, or long output." },
      },
      required: ["text"],
    },
  },
];

function textResult(text, structuredContent = {}) {
  return {
    content: [{ type: "text", text }],
    structuredContent,
  };
}

function errorResponse(id, error) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: -32000,
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

async function resolveThread(args = {}, deps = {}) {
  const env = deps.env || process.env;
  if (args.threadId) {
    if (!args.threadName || args.threadName === args.threadId) {
      const fromState = await resolveThreadByIdFromState(args.threadId, deps);
      if (fromState) {
        return {
          threadId: args.threadId,
          threadName: fromState.threadName,
          cwd: args.cwd || fromState.cwd || "",
        };
      }
    }
    return {
      threadId: args.threadId,
      threadName: args.threadName || "this thread",
      cwd: args.cwd || "",
    };
  }

  if (env.CODEX_THREAD_ID) {
    return {
      threadId: env.CODEX_THREAD_ID,
      threadName: args.threadName || env.CODEX_THREAD_TITLE || env.CODEX_THREAD_ID,
      cwd: args.cwd || env.PWD || "",
    };
  }

  if (args.cwd) {
    const fromState = await resolveThreadFromState(args.cwd, deps);
    if (fromState) return fromState;
  }

  throw new Error("Unable to determine current Codex thread id. Pass threadId or cwd to /voice.");
}

function quoteSql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export async function resolveThreadByIdFromState(threadId, deps = {}) {
  const codexHome = deps.codexHome || process.env.CODEX_HOME || path.join(process.env.HOME, ".codex");
  const dbPath = path.join(codexHome, "state_5.sqlite");
  const sql = `select id,title,cwd from threads where id = ${quoteSql(threadId)} limit 1;`;
  const fromState = await new Promise((resolve) => {
    execFile("sqlite3", ["-separator", "\t", dbPath, sql], { timeout: 2000 }, (error, stdout) => {
      if (error || !stdout.trim()) {
        resolve(null);
        return;
      }
      const [resolvedThreadId, threadName, threadCwd] = stdout.trim().split("\t");
      if (resolvedThreadId !== threadId || !threadName || threadName === threadId) {
        resolve(null);
        return;
      }
      resolve({ threadId: resolvedThreadId, threadName, cwd: threadCwd || "" });
    });
  });
  if (!fromState) return null;

  const indexedName = await resolveThreadNameFromSessionIndex(threadId, deps);
  return { ...fromState, threadName: indexedName || fromState.threadName };
}

export async function resolveThreadNameFromSessionIndex(threadId, deps = {}) {
  const codexHome = deps.codexHome || process.env.CODEX_HOME || path.join(process.env.HOME, ".codex");
  const indexPath = path.join(codexHome, "session_index.jsonl");
  try {
    const lines = (await readFile(indexPath, "utf8")).trim().split(/\r?\n/);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const entry = JSON.parse(lines[index]);
      const threadName = String(entry.thread_name || "").trim();
      if (entry.id === threadId && threadName && threadName !== threadId) return threadName;
    }
  } catch {
    // Codex Desktop may not have created a session index yet.
  }
  return null;
}

export async function resolveThreadFromState(cwd, deps = {}) {
  const codexHome = deps.codexHome || process.env.CODEX_HOME || path.join(process.env.HOME, ".codex");
  const dbPath = path.join(codexHome, "state_5.sqlite");
  const candidates = new Set([cwd]);
  try {
    candidates.add(await realpath(cwd));
  } catch {
    // The original cwd is still worth trying when the directory no longer exists.
  }
  const cwdFilter = [...candidates].map(quoteSql).join(",");
  const sql = `select id,title,cwd from threads where archived=0 and cwd in (${cwdFilter}) order by recency_at_ms desc limit 1;`;
  const fromState = await new Promise((resolve) => {
    execFile("sqlite3", ["-separator", "\t", dbPath, sql], { timeout: 2000 }, (error, stdout) => {
      if (error || !stdout.trim()) {
        resolve(null);
        return;
      }
      const [threadId, threadName, threadCwd] = stdout.trim().split("\t");
      resolve({ threadId, threadName: threadName || threadId, cwd: threadCwd || cwd });
    });
  });
  if (!fromState) return null;

  const indexedName = await resolveThreadNameFromSessionIndex(fromState.threadId, deps);
  return { ...fromState, threadName: indexedName || fromState.threadName };
}

async function defaultStartListener({ options, session, settings }) {
  const sessionFile = getRuntimeSessionPath(options, session.threadId);
  await writeFile(
    sessionFile,
    `${JSON.stringify({ codexHome: options.codexHome || process.env.CODEX_HOME || null, session, settings }, null, 2)}\n`,
    { mode: 0o600 },
  );

  const logsDir = getLogsDir(options);
  await mkdir(logsDir, { recursive: true, mode: 0o700 });
  const stdoutFd = openSync(path.join(logsDir, `${session.threadId}.out.log`), "a");
  const stderrFd = openSync(path.join(logsDir, `${session.threadId}.err.log`), "a");
  const scriptPath = fileURLToPath(new URL("./voice-listener.mjs", import.meta.url));
  const child = spawn(process.execPath, [scriptPath, "--session-file", sessionFile], {
    detached: true,
    stdio: ["ignore", stdoutFd, stderrFd],
  });
  child.unref();
  closeSync(stdoutFd);
  closeSync(stderrFd);
  return { pid: child.pid, alreadyRunning: false };
}

async function defaultStopProcess(pid) {
  if (!pid) return { stopped: false, reason: "no-pid" };
  try {
    process.kill(pid, "SIGTERM");
    return { stopped: true, pid };
  } catch (error) {
    return { stopped: false, pid, reason: error.code || error.message };
  }
}

function defaultIsProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function voiceOn(args, deps) {
  const options = { codexHome: deps.codexHome };
  const thread = await resolveThread(args, deps);
  const { settings } = await ensureSettings(options);
  const tts = await resolveTtsProvider(options, { fetch: deps.fetch, env: deps.env });
  const registry = await loadSessions(options);
  const current = registry.sessions[thread.threadId];
  const isProcessAlive = deps.isProcessAlive || defaultIsProcessAlive;
  if (current?.active && current.pid && isProcessAlive(current.pid)) {
    if (current.settingsSignature !== settingsSignature(settings)) {
      await (deps.stopProcess || defaultStopProcess)(current.pid);
      let refreshed = await allocateSession(options, thread, settings);
      const started = await (deps.startListener || defaultStartListener)({ options, session: refreshed, settings });
      refreshed = await setSessionPid(options, thread.threadId, started.pid ?? null);
      const text = [
        `Voice listener endpoint: ${refreshed.endpoint}`,
        "Voice active",
        `TTS provider: ${tts.provider} (${tts.ready ? "ready" : "needs setup"})`,
      ].join("\n");
      return textResult(text, { session: refreshed, tts, refreshed: true });
    }
    const text = [
      `Voice listener endpoint: ${current.endpoint}`,
      "Voice active",
      `TTS provider: ${tts.provider} (${tts.ready ? "ready" : "needs setup"})`,
    ].join("\n");
    return textResult(text, { session: current, tts, reused: true });
  }

  let session = await allocateSession(options, thread, settings);
  const started = await (deps.startListener || defaultStartListener)({ options, session, settings });
  session = await setSessionPid(options, thread.threadId, started.pid ?? null);

  const onlineText = "Voice active";
  if (settings.tts?.speakOnOnline && tts.ready) {
    await speakText(onlineText, tts, { fetch: deps.fetch, player: deps.player });
  }

  const missing = tts.missing?.length ? `\nMissing setup: ${tts.missing.join(", ")}` : "";
  const text = [
    `Voice listener endpoint: ${session.endpoint}`,
    `${onlineText}`,
    `TTS provider: ${tts.provider} (${tts.ready ? "ready" : "needs setup"})${missing}`,
  ].join("\n");

  return textResult(text, { session, tts });
}

async function voiceStatus(args, deps) {
  const options = { codexHome: deps.codexHome };
  const thread = await resolveThread(args, deps);
  const registry = await loadSessions(options);
  const session = registry.sessions[thread.threadId];
  if (!session) {
    return textResult(`Status: inactive\nThread: ${thread.threadName}`);
  }
  return textResult(
    [
      `Status: ${session.active ? "active" : "inactive"}`,
      `Thread: ${session.threadName}`,
      `Endpoint: ${session.endpoint}`,
      `PID: ${session.pid || "none"}`,
    ].join("\n"),
    { session },
  );
}

async function voiceOff(args, deps) {
  const options = { codexHome: deps.codexHome };
  const thread = await resolveThread(args, deps);
  const registry = await loadSessions(options);
  const current = registry.sessions[thread.threadId];
  if (current?.pid) {
    await (deps.stopProcess || defaultStopProcess)(current.pid);
  }

  const released = await releaseSession(options, thread.threadId);
  if (!released) {
    return textResult(`Voice already offline for ${thread.threadName}`);
  }

  return textResult(
    `Voice offline for ${released.threadName}\nReleased port: ${released.port}`,
    { session: released },
  );
}

async function voiceSay(args, deps) {
  const text = summarizeForSpeech(args.text || "", 260);
  if (!text) throw new Error("codex_voice_say requires non-empty text");

  const options = { codexHome: deps.codexHome };
  const thread = await resolveThread(args, deps);
  const registry = await loadSessions(options);
  const session = registry.sessions[thread.threadId];
  if (!session?.active) {
    return textResult(`Voice is inactive for ${thread.threadName}; summary not spoken.`, {
      spoken: false,
      reason: "voice-inactive",
    });
  }

  const tts = await resolveTtsProvider(options, { fetch: deps.fetch, env: deps.env });
  const spoken = await speakText(text, tts, { fetch: deps.fetch, player: deps.player });
  return textResult(
    `Spoken summary for ${session.threadName}: ${spoken.spoken ? "ok" : spoken.reason}`,
    { session, tts, spoken },
  );
}

async function callTool(params, deps) {
  const args = params.arguments || {};
  if (params.name === "codex_voice_on") return voiceOn(args, deps);
  if (params.name === "codex_voice_off") return voiceOff(args, deps);
  if (params.name === "codex_voice_status") return voiceStatus(args, deps);
  if (params.name === "codex_voice_say") return voiceSay(args, deps);
  throw new Error(`Unknown Codex Voice tool: ${params.name}`);
}

export async function handleMcpRequest(message, deps = {}) {
  try {
    if (message.method === "initialize") {
      return {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        },
      };
    }

    if (message.method === "tools/list") {
      return { jsonrpc: "2.0", id: message.id, result: { tools: TOOL_DEFS } };
    }

    if (message.method === "tools/call") {
      return { jsonrpc: "2.0", id: message.id, result: await callTool(message.params || {}, deps) };
    }

    if (message.id === undefined) return null;
    throw new Error(`Unsupported MCP method: ${message.method}`);
  } catch (error) {
    return errorResponse(message.id, error);
  }
}

async function runStdio() {
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    const response = await handleMcpRequest(message);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runStdio().catch((error) => {
    process.stderr.write(`${error.stack || error.message || error}\n`);
    process.exit(1);
  });
}
