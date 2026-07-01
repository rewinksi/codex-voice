import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { Readable } from "node:stream";

import {
  DEFAULT_SETTINGS,
  ensureSettings,
  loadVoiceEnv,
  saveSettings,
} from "./settings.mjs";

const SUPERTONIC_DEFAULT = DEFAULT_SETTINGS.tts.supertonic;
const elevenLabsVoiceIdCache = new Map();

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
    baseUrl: config.baseUrl,
    voiceName: config.voiceName,
    voiceId: config.voiceId,
    model: config.model,
    responseFormat: config.responseFormat,
    streaming: config.streaming !== false,
    optimizeStreamingLatency: config.optimizeStreamingLatency ?? 3,
    streamPlayer: config.streamPlayer || "auto",
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
  if (!elevenlabs.voiceName && !elevenlabs.voiceId) missing.push("tts.elevenlabs.voiceName");
  if (!apiKey) missing.push("ELEVENLABS_API_KEY");

  const config = publicElevenLabsConfig(elevenlabs, Boolean(apiKey));
  Object.defineProperty(config, "apiKey", {
    value: apiKey,
    enumerable: false,
  });

  return {
    provider: "elevenlabs",
    ready: missing.length === 0,
    missing,
    config,
  };
}

export async function speakText(text, providerResult, deps = {}) {
  if (!text || !providerResult?.ready) return { spoken: false, reason: "tts-not-ready" };
  if (providerResult.provider === "supertonic") {
    return speakWithSupertonic(text, providerResult.config, deps);
  }
  if (providerResult.provider === "elevenlabs") {
    return speakWithElevenLabs(text, providerResult.config, deps);
  }
  return { spoken: false, reason: "unsupported-provider" };
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
  return playAudio(audio, config.responseFormat || "wav", deps);
}

async function speakWithElevenLabs(text, config, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  if (!fetchImpl) return { spoken: false, reason: "fetch-unavailable" };
  if (!config?.apiKey) return { spoken: false, reason: "elevenlabs-api-key-missing" };

  const baseUrl = (config.baseUrl || "https://api.elevenlabs.io").replace(/\/$/, "");
  const voiceId = config.voiceId || await resolveElevenLabsVoiceId(baseUrl, config, fetchImpl);
  if (!voiceId) return { spoken: false, reason: "elevenlabs-voice-not-found" };

  const outputFormat = config.responseFormat || "mp3_44100_128";
  if (config.streaming !== false) {
    return streamWithElevenLabs(text, baseUrl, voiceId, outputFormat, config, deps);
  }

  const response = await fetchImpl(
    `${baseUrl}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(outputFormat)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "xi-api-key": config.apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: config.model || "eleven_flash_v2_5",
      }),
    },
  );

  if (!response.ok) {
    return { spoken: false, reason: `elevenlabs-http-${response.status}` };
  }

  const audio = Buffer.from(await response.arrayBuffer());
  return playAudio(audio, outputFormat, deps);
}

async function streamWithElevenLabs(text, baseUrl, voiceId, outputFormat, config, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  const url = new URL(`${baseUrl}/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream`);
  url.searchParams.set("output_format", outputFormat);
  if (config.optimizeStreamingLatency !== null && config.optimizeStreamingLatency !== undefined) {
    url.searchParams.set("optimize_streaming_latency", String(config.optimizeStreamingLatency));
  }

  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "xi-api-key": config.apiKey,
    },
    body: JSON.stringify({
      text,
      model_id: config.model || "eleven_flash_v2_5",
    }),
  });

  if (!response.ok) {
    return { spoken: false, reason: `elevenlabs-http-${response.status}` };
  }

  const stream = toNodeReadable(response.body);
  if (!stream) {
    const audio = Buffer.from(await response.arrayBuffer());
    return playAudio(audio, outputFormat, deps);
  }
  return playAudioStream(stream, outputFormat, deps, config);
}

async function findElevenLabsVoiceId(baseUrl, config, fetchImpl) {
  const response = await fetchImpl(`${baseUrl}/v1/voices`, {
    method: "GET",
    headers: {
      "xi-api-key": config.apiKey,
    },
  });
  if (!response.ok) return null;

  const payload = await response.json();
  const requested = String(config.voiceName || "").trim().toLowerCase();
  const match = payload?.voices?.find((voice) => {
    return String(voice.name || "").trim().toLowerCase() === requested;
  });
  return match?.voice_id || null;
}

async function resolveElevenLabsVoiceId(baseUrl, config, fetchImpl) {
  const key = elevenLabsVoiceCacheKey(baseUrl, config);
  if (elevenLabsVoiceIdCache.has(key)) return elevenLabsVoiceIdCache.get(key);
  const voiceId = await findElevenLabsVoiceId(baseUrl, config, fetchImpl);
  if (voiceId) elevenLabsVoiceIdCache.set(key, voiceId);
  return voiceId;
}

function elevenLabsVoiceCacheKey(baseUrl, config) {
  const keyHash = createHash("sha256")
    .update(String(config.apiKey || ""))
    .digest("hex")
    .slice(0, 12);
  return [
    baseUrl,
    String(config.voiceName || "").trim().toLowerCase(),
    keyHash,
  ].join("\0");
}

async function playAudio(audio, responseFormat, deps = {}) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "codex-voice-audio-"));
  const audioPath = path.join(tempDir, `speech.${audioExtension(responseFormat)}`);
  await writeFile(audioPath, audio);

  const player = deps.player || "afplay";
  if (typeof player === "function") {
    await player(audioPath);
  } else {
    const child = spawn(player, [audioPath], { stdio: "ignore", detached: true });
    child.unref();
  }
  setTimeout(() => rm(tempDir, { recursive: true, force: true }), 60_000).unref();
  return { spoken: true };
}

function toNodeReadable(stream) {
  if (!stream) return null;
  if (typeof stream.getReader === "function" && Readable.fromWeb) {
    return Readable.fromWeb(stream);
  }
  if (typeof stream[Symbol.asyncIterator] === "function") {
    return Readable.from(stream);
  }
  return null;
}

async function playAudioStream(stream, responseFormat, deps = {}, config = {}) {
  if (typeof deps.streamPlayer === "function") {
    await deps.streamPlayer(stream, responseFormat);
    return { spoken: true, streamed: true, player: "custom" };
  }

  const player = await selectStreamPlayer(deps.streamPlayer || config.streamPlayer || "auto");
  if (!player) {
    const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const audio = Buffer.concat(chunks);
    const result = await playAudio(audio, responseFormat, deps);
    return { ...result, streamed: false, reason: result.reason || "stream-player-unavailable" };
  }

  await pipeToPlayer(stream, player);
  return { spoken: true, streamed: true, player: player.command };
}

async function selectStreamPlayer(requested) {
  if (requested && requested !== "auto") {
    const command = Array.isArray(requested) ? requested[0] : String(requested);
    const args = Array.isArray(requested) ? requested.slice(1) : streamPlayerArgs(command);
    return (await commandExists(command)) ? { command, args } : null;
  }

  for (const command of ["ffplay", "mpv"]) {
    if (await commandExists(command)) {
      return { command, args: streamPlayerArgs(command) };
    }
  }
  return null;
}

function streamPlayerArgs(command) {
  if (command.includes("ffplay")) return ["-nodisp", "-autoexit", "-loglevel", "error", "-i", "pipe:0"];
  if (command.includes("mpv")) return ["--no-terminal", "--really-quiet", "-"];
  return ["-"];
}

function commandExists(command) {
  return new Promise((resolve) => {
    execFile("which", [command], (error) => resolve(!error));
  });
}

function pipeToPlayer(stream, player) {
  return new Promise((resolve, reject) => {
    const child = spawn(player.command, player.args, {
      stdio: ["pipe", "ignore", "ignore"],
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${player.command} exited with ${code}`));
    });
    stream.on("error", (error) => {
      child.kill();
      reject(error);
    });
    stream.pipe(child.stdin);
  });
}

function audioExtension(responseFormat) {
  const format = String(responseFormat || "").toLowerCase();
  if (format.startsWith("mp3")) return "mp3";
  if (format.startsWith("wav") || format.includes("pcm")) return "wav";
  if (format.startsWith("opus")) return "opus";
  return "audio";
}
