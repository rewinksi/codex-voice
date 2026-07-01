import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ensureSettings, saveSettings, writeVoiceEnv } from "../scripts/lib/settings.mjs";
import { resolveTtsProvider } from "../scripts/lib/tts.mjs";

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
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
});
