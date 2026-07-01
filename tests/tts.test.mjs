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
