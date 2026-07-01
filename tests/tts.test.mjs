import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ensureSettings, saveSettings, writeVoiceEnv } from "../scripts/lib/settings.mjs";
import { resolveTtsProvider, speakText } from "../scripts/lib/tts.mjs";

test("resolveTtsProvider discovers reachable Supertonic and persists non-secret details", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-voice-tts-supertonic-"));
  try {
    const { settings, settingsPath } = await ensureSettings({ codexHome });
    settings.tts.supertonic.baseUrl = "";
    settings.tts.supertonic.voice = "";
    await saveSettings({ codexHome }, settings);

    const calls = [];
    const result = await resolveTtsProvider(
      { codexHome },
      {
        fetch: async (url) => {
          calls.push(url);
          return { ok: true, status: 404 };
        },
      },
    );

    assert.equal(result.provider, "supertonic");
    assert.equal(result.ready, true);
    assert.equal(result.config.baseUrl, "http://127.0.0.1:7788");
    assert.equal(result.config.path, "/v1/tts");
    assert.equal(result.config.voice, "F4F2Dynamic01");
    assert.deepEqual(result.missing, []);
    assert.ok(calls.some((url) => String(url).startsWith("http://127.0.0.1:7788")));

    const persisted = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.equal(persisted.tts.supertonic.baseUrl, "http://127.0.0.1:7788");
    assert.equal(persisted.tts.supertonic.voice, "F4F2Dynamic01");
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
});

test("resolveTtsProvider reports missing ElevenLabs voice and key without exposing secrets", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-voice-tts-eleven-missing-"));
  try {
    const { settings } = await ensureSettings({ codexHome });
    settings.tts.provider = "elevenlabs";
    settings.tts.elevenlabs.voiceName = "";
    await saveSettings({ codexHome }, settings);

    const result = await resolveTtsProvider({ codexHome }, { env: {} });

    assert.equal(result.provider, "elevenlabs");
    assert.equal(result.ready, false);
    assert.deepEqual(result.missing, ["tts.elevenlabs.voiceName", "ELEVENLABS_API_KEY"]);
    assert.equal(JSON.stringify(result).includes("secret"), false);
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
});

test("resolveTtsProvider accepts ElevenLabs key from voice_env", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-voice-tts-eleven-ready-"));
  try {
    const { settings } = await ensureSettings({ codexHome });
    settings.tts.provider = "elevenlabs";
    settings.tts.elevenlabs.voiceName = "Rachel";
    await saveSettings({ codexHome }, settings);
    await writeVoiceEnv({ codexHome }, { ELEVENLABS_API_KEY: "test-key" });

    const result = await resolveTtsProvider({ codexHome }, { env: {} });

    assert.equal(result.provider, "elevenlabs");
    assert.equal(result.ready, true);
    assert.equal(result.config.voiceName, "Rachel");
    assert.equal(result.config.streaming, true);
    assert.equal(result.config.optimizeStreamingLatency, 3);
    assert.equal(result.config.streamPlayer, "auto");
    assert.equal(result.config.hasApiKey, true);
    assert.equal(JSON.stringify(result).includes("test-key"), false);
    assert.equal(result.config.apiKey, "test-key");
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
});

test("speakText uses ElevenLabs voice lookup without serializing the API key", async () => {
  const calls = [];
  const played = [];
  const result = await speakText(
    "Voice online",
    {
      provider: "elevenlabs",
      ready: true,
      config: Object.defineProperties(
        {
          baseUrl: "https://api.elevenlabs.io",
          voiceName: "Rachel",
          model: "eleven_flash_v2_5",
          responseFormat: "mp3_44100_128",
          streaming: false,
          hasApiKey: true,
        },
        {
          apiKey: {
            value: "secret-key",
            enumerable: false,
          },
        },
      ),
    },
    {
      fetch: async (url, options = {}) => {
        calls.push({ url: String(url), options });
        if (String(url).endsWith("/v1/voices")) {
          return {
            ok: true,
            json: async () => ({ voices: [{ name: "Rachel", voice_id: "voice-1" }] }),
          };
        }
        return {
          ok: true,
          arrayBuffer: async () => Buffer.from("audio").buffer,
        };
      },
      player: async (audioPath) => {
        played.push(audioPath);
      },
    },
  );

  assert.equal(result.spoken, true);
  assert.equal(played.length, 1);
  assert.ok(played[0].endsWith(".mp3"));
  assert.ok(calls.some((call) => call.url.endsWith("/v1/voices")));
  assert.ok(calls.some((call) => call.url.includes("/v1/text-to-speech/voice-1")));
  assert.equal(calls.at(-1).options.headers["xi-api-key"], "secret-key");
  assert.equal(JSON.stringify(calls.at(-1).options.body).includes("secret-key"), false);
});

test("speakText streams ElevenLabs audio when streaming is enabled", async () => {
  const calls = [];
  const streamedChunks = [];
  const result = await speakText(
    "Short summary",
    {
      provider: "elevenlabs",
      ready: true,
      config: Object.defineProperties(
        {
          baseUrl: "https://api.elevenlabs.io",
          voiceName: "Rachel",
          model: "eleven_flash_v2_5",
          responseFormat: "mp3_44100_128",
          streaming: true,
          optimizeStreamingLatency: 3,
          hasApiKey: true,
        },
        {
          apiKey: {
            value: "secret-key",
            enumerable: false,
          },
        },
      ),
    },
    {
      fetch: async (url, options = {}) => {
        calls.push({ url: String(url), options });
        if (String(url).endsWith("/v1/voices")) {
          return {
            ok: true,
            json: async () => ({ voices: [{ name: "Rachel", voice_id: "voice-1" }] }),
          };
        }
        return {
          ok: true,
          body: ReadableStream.from([Buffer.from("chunk-a"), Buffer.from("chunk-b")]),
        };
      },
      streamPlayer: async (stream, responseFormat) => {
        assert.equal(responseFormat, "mp3_44100_128");
        for await (const chunk of stream) {
          streamedChunks.push(Buffer.from(chunk).toString("utf8"));
        }
      },
    },
  );

  assert.equal(result.spoken, true);
  assert.equal(result.streamed, true);
  assert.deepEqual(streamedChunks, ["chunk-a", "chunk-b"]);
  const streamCall = calls.find((call) => call.url.includes("/v1/text-to-speech/voice-1/stream"));
  assert.ok(streamCall);
  assert.match(streamCall.url, /output_format=mp3_44100_128/);
  assert.match(streamCall.url, /optimize_streaming_latency=3/);
  assert.equal(JSON.parse(streamCall.options.body).model_id, "eleven_flash_v2_5");
});

test("speakText caches ElevenLabs voice lookup within the listener process", async () => {
  let voiceLookups = 0;
  const provider = {
    provider: "elevenlabs",
    ready: true,
    config: {
      baseUrl: "https://api.elevenlabs.io",
      voiceName: "Cache Voice",
      model: "eleven_flash_v2_5",
      responseFormat: "mp3_44100_128",
      streaming: false,
      hasApiKey: true,
    },
  };
  Object.defineProperty(provider.config, "apiKey", {
    value: "secret-key",
    enumerable: false,
  });

  const deps = {
    fetch: async (url) => {
      if (String(url).endsWith("/v1/voices")) {
        voiceLookups += 1;
        return {
          ok: true,
          json: async () => ({ voices: [{ name: "Cache Voice", voice_id: "voice-1" }] }),
        };
      }
      return {
        ok: true,
        arrayBuffer: async () => Buffer.from("audio").buffer,
      };
    },
    player: async () => {},
  };

  await speakText("First", provider, deps);
  await speakText("Second", provider, deps);

  assert.equal(voiceLookups, 1);
});
