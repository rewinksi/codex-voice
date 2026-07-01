import { constants } from "node:fs";
import { access, chmod, readFile, writeFile } from "node:fs/promises";

import {
  ensureVoiceDir,
  getSettingsPath,
  getVoiceEnvPath,
} from "./paths.mjs";

export const DEFAULT_SETTINGS = Object.freeze({
  version: 1,
  host: "127.0.0.1",
  portBase: 6901,
  maxSessions: 16,
  stt: {
    openAiCompatiblePath: "/v1/chat/completions",
  },
  sideChannel: {
    responseMode: "lmstudio",
    speakImmediateAck: true,
    timeoutMs: 6000,
    maxResponseChars: 260,
    contextBytes: 120000,
    maxContextChars: 2400,
    lmstudio: {
      baseUrl: "http://127.0.0.1:1234",
      model: "google/gemma-4-12b-qat",
    },
    ollama: {
      baseUrl: "http://127.0.0.1:11434",
      model: "llama3.2:3b",
    },
  },
  tts: {
    provider: "supertonic",
    speakOnOnline: true,
    supertonic: {
      baseUrl: "http://127.0.0.1:7788",
      path: "/v1/tts",
      voice: "F4F2Dynamic01",
      speed: 1.2,
      responseFormat: "wav",
    },
    elevenlabs: {
      baseUrl: "https://api.elevenlabs.io",
      voiceName: "",
      model: "eleven_flash_v2_5",
      responseFormat: "mp3_44100_128",
      streaming: true,
      optimizeStreamingLatency: 3,
      streamPlayer: "auto",
    },
  },
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeDefaults(defaults, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return clone(defaults);
  }

  const merged = clone(defaults);
  for (const [key, item] of Object.entries(value)) {
    if (
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      merged[key] &&
      typeof merged[key] === "object" &&
      !Array.isArray(merged[key])
    ) {
      merged[key] = mergeDefaults(merged[key], item);
    } else {
      merged[key] = item;
    }
  }
  return merged;
}

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function saveSettings(options = {}, settings) {
  await ensureVoiceDir(options);
  const settingsPath = getSettingsPath(options);
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  await chmod(settingsPath, 0o600);
  return settingsPath;
}

export async function ensureSettings(options = {}) {
  await ensureVoiceDir(options);
  const settingsPath = getSettingsPath(options);
  const created = !(await exists(settingsPath));

  if (created) {
    const settings = clone(DEFAULT_SETTINGS);
    await saveSettings(options, settings);
    return { settings, settingsPath, created };
  }

  const raw = await readFile(settingsPath, "utf8");
  const settings = mergeDefaults(DEFAULT_SETTINGS, JSON.parse(raw));
  return { settings, settingsPath, created };
}

export function parseVoiceEnv(raw) {
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsAt = trimmed.indexOf("=");
    if (equalsAt <= 0) continue;
    const key = trimmed.slice(0, equalsAt).trim();
    const value = trimmed.slice(equalsAt + 1);
    env[key] = value;
  }
  return env;
}

export function formatVoiceEnv(env) {
  return `${Object.keys(env)
    .sort()
    .map((key) => `${key}=${env[key] ?? ""}`)
    .join("\n")}\n`;
}

export async function loadVoiceEnv(options = {}) {
  await ensureVoiceDir(options);
  const envPath = getVoiceEnvPath(options);
  if (!(await exists(envPath))) return {};
  return parseVoiceEnv(await readFile(envPath, "utf8"));
}

export async function writeVoiceEnv(options = {}, updates = {}) {
  await ensureVoiceDir(options);
  const envPath = getVoiceEnvPath(options);
  const current = await loadVoiceEnv(options);
  const next = { ...current, ...updates };
  await writeFile(envPath, formatVoiceEnv(next), { mode: 0o600 });
  await chmod(envPath, 0o600);
  return envPath;
}
