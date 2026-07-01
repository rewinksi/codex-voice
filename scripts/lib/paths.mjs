import { mkdir, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function getCodexHome(options = {}) {
  return options.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

export function getVoiceDir(options = {}) {
  return path.join(getCodexHome(options), "voice");
}

export function getSettingsPath(options = {}) {
  return path.join(getVoiceDir(options), "settings.json");
}

export function getVoiceEnvPath(options = {}) {
  return path.join(getVoiceDir(options), "voice_env");
}

export function getSessionsPath(options = {}) {
  return path.join(getVoiceDir(options), "sessions.json");
}

export function getLogsDir(options = {}) {
  return path.join(getVoiceDir(options), "logs");
}

export function getRuntimeSessionPath(options = {}, threadId) {
  const safeThreadId = String(threadId || "unknown").replace(/[^a-zA-Z0-9_.-]/g, "_");
  return path.join(getVoiceDir(options), `session-${safeThreadId}.json`);
}

export async function ensureVoiceDir(options = {}) {
  const voiceDir = getVoiceDir(options);
  await mkdir(voiceDir, { recursive: true, mode: 0o700 });
  await chmod(voiceDir, 0o700);
  return voiceDir;
}
