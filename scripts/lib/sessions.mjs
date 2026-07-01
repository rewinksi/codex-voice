import { constants } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";

import {
  ensureVoiceDir,
  getSessionsPath,
} from "./paths.mjs";
import { settingsSignature } from "./settings.mjs";

const EMPTY_REGISTRY = {
  version: 1,
  sessions: {},
};

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function loadSessions(options = {}) {
  await ensureVoiceDir(options);
  const sessionsPath = getSessionsPath(options);
  if (!(await exists(sessionsPath))) {
    return structuredClone(EMPTY_REGISTRY);
  }
  const parsed = JSON.parse(await readFile(sessionsPath, "utf8"));
  return {
    version: 1,
    sessions: parsed.sessions && typeof parsed.sessions === "object" ? parsed.sessions : {},
  };
}

export async function saveSessions(options = {}, registry) {
  await ensureVoiceDir(options);
  const sessionsPath = getSessionsPath(options);
  await writeFile(sessionsPath, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
  return sessionsPath;
}

function activePorts(registry, exceptThreadId = null) {
  return new Set(
    Object.entries(registry.sessions)
      .filter(([threadId, session]) => threadId !== exceptThreadId && session.active)
      .map(([, session]) => session.port),
  );
}

function endpointFor(settings, port) {
  const host = settings.host || "127.0.0.1";
  const route = settings.stt?.openAiCompatiblePath || "/v1/chat/completions";
  return `http://${host}:${port}${route}`;
}

function choosePort(registry, threadId, settings) {
  const existing = registry.sessions[threadId];
  const used = activePorts(registry, threadId);

  if (existing?.port && !used.has(existing.port)) {
    return existing.port;
  }

  const base = Number(settings.portBase || 6901);
  const maxSessions = Number(settings.maxSessions || 16);
  for (let port = base; port < base + maxSessions; port += 1) {
    if (!used.has(port)) return port;
  }
  throw new Error(`No Codex Voice ports available in ${base}-${base + maxSessions - 1}`);
}

export async function allocateSession(options = {}, thread, settings) {
  if (!thread?.threadId) {
    throw new Error("threadId is required to allocate a Codex Voice session");
  }

  const registry = await loadSessions(options);
  const port = choosePort(registry, thread.threadId, settings);
  const now = new Date().toISOString();
  const session = {
    threadId: thread.threadId,
    threadName: thread.threadName || thread.threadId,
    cwd: thread.cwd || "",
    port,
    endpoint: endpointFor(settings, port),
    active: true,
    pid: thread.pid ?? null,
    settingsSignature: settingsSignature(settings),
    createdAt: registry.sessions[thread.threadId]?.createdAt || now,
    updatedAt: now,
  };

  registry.sessions[thread.threadId] = session;
  await saveSessions(options, registry);
  return session;
}

export async function releaseSession(options = {}, threadId) {
  const registry = await loadSessions(options);
  const session = registry.sessions[threadId];
  if (!session) return null;

  const released = {
    ...session,
    active: false,
    pid: null,
    updatedAt: new Date().toISOString(),
  };
  registry.sessions[threadId] = released;
  await saveSessions(options, registry);
  return released;
}

export async function setSessionPid(options = {}, threadId, pid) {
  const registry = await loadSessions(options);
  const session = registry.sessions[threadId];
  if (!session) return null;

  const updated = {
    ...session,
    pid,
    updatedAt: new Date().toISOString(),
  };
  registry.sessions[threadId] = updated;
  await saveSessions(options, registry);
  return updated;
}
