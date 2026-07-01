import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  DEFAULT_SETTINGS,
  ensureSettings,
  loadVoiceEnv,
  saveSettings,
} from "./settings.mjs";

const SUPERTONIC_DEFAULT = DEFAULT_SETTINGS.tts.supertonic;

async function probeBaseUrl(baseUrl, fetchImpl) {
  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/openapi.json`, {
      method: "GET",
      signal: AbortSignal.timeout?.(1500),
    });
    return response.status < 500;
  } catch {
    return false;
  }
}

function publicSupertonicConfig(config) {
  return {
    baseUrl: config.baseUrl,
    path: config.path,
    voice: config.voice,
    speed: config.speed,
    responseFormat: config.responseFormat,
  };
}

function publicElevenLabsConfig(config, hasApiKey) {
  return {
    voiceName: config.voiceName,
    model: config.model,
    hasApiKey,
  };
}

export async function resolveTtsProvider(options = {}, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  const env = deps.env || process.env;
  const { settings } = await ensureSettings(options);
  const voiceEnv = await loadVoiceEnv(options);
  const requestedProvider = settings.tts?.provider || "supertonic";

  if (requestedProvider === "elevenlabs") {
    return resolveElevenLabs(settings, voiceEnv, env);
  }

  const supertonic = {
    ...SUPERTONIC_DEFAULT,
    ...(settings.tts?.supertonic || {}),
  };
  let changed = false;

  if (!supertonic.baseUrl) {
    supertonic.baseUrl = SUPERTONIC_DEFAULT.baseUrl;
    changed = true;
  }
  if (!supertonic.path) {
    supertonic.path = SUPERTONIC_DEFAULT.path;
    changed = true;
  }
  if (!supertonic.voice) {
    supertonic.voice = SUPERTONIC_DEFAULT.voice;
    changed = true;
  }
  if (!supertonic.responseFormat) {
    supertonic.responseFormat = SUPERTONIC_DEFAULT.responseFormat;
    changed = true;
  }

  const reachable = fetchImpl ? await probeBaseUrl(supertonic.baseUrl, fetchImpl) : false;
  if (changed || settings.tts.provider !== "supertonic") {
    settings.tts.provider = "supertonic";
    settings.tts.supertonic = supertonic;
    await saveSettings(options, settings);
  }

  if (!reachable) {
    return {
      provider: "supertonic",
      ready: false,
      missing: ["supertonic server at http://127.0.0.1:7788"],
      config: publicSupertonicConfig(supertonic),
    };
  }

  return {
    provider: "supertonic",
    ready: true,
    missing: [],
    config: publicSupertonicConfig(supertonic),
  };
}

function resolveElevenLabs(settings, voiceEnv, env) {
  const elevenlabs = {
    ...DEFAULT_SETTINGS.tts.elevenlabs,
    ...(settings.tts?.elevenlabs || {}),
  };
  const apiKey = voiceEnv.ELEVENLABS_API_KEY || env.ELEVENLABS_API_KEY || "";
  const missing = [];
  if (!elevenlabs.voiceName) missing.push("tts.elevenlabs.voiceName");
  if (!apiKey) missing.push("ELEVENLABS_API_KEY");

  return {
    provider: "elevenlabs",
    ready: missing.length === 0,
    missing,
    config: publicElevenLabsConfig(elevenlabs, Boolean(apiKey)),
  };
}

export async function speakText(text, providerResult, deps = {}) {
  if (!text || !providerResult?.ready) return { spoken: false, reason: "tts-not-ready" };
  if (providerResult.provider === "supertonic") {
    return speakWithSupertonic(text, providerResult.config, deps);
  }
  return { spoken: false, reason: "provider-speaking-not-implemented" };
}

async function speakWithSupertonic(text, config, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  if (!fetchImpl) return { spoken: false, reason: "fetch-unavailable" };

  const response = await fetchImpl(`${config.baseUrl.replace(/\/$/, "")}${config.path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text,
      voice: config.voice,
      speed: config.speed,
      response_format: config.responseFormat || "wav",
    }),
  });

  if (!response.ok) {
    return { spoken: false, reason: `supertonic-http-${response.status}` };
  }

  const audio = Buffer.from(await response.arrayBuffer());
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "codex-voice-audio-"));
  const audioPath = path.join(tempDir, `speech.${config.responseFormat || "wav"}`);
  await writeFile(audioPath, audio);

  const player = deps.player || "afplay";
  const child = spawn(player, [audioPath], { stdio: "ignore", detached: true });
  child.unref();
  setTimeout(() => rm(tempDir, { recursive: true, force: true }), 60_000).unref();
  return { spoken: true };
}
