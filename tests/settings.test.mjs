import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_SETTINGS,
  ensureSettings,
  loadVoiceEnv,
  writeVoiceEnv,
} from "../scripts/lib/settings.mjs";

test("ensureSettings creates default settings under CODEX_HOME/voice", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-voice-settings-"));
  try {
    const result = await ensureSettings({ codexHome });

    assert.equal(result.created, true);
    assert.equal(result.settings.host, "127.0.0.1");
    assert.equal(result.settings.portBase, 6901);
    assert.equal(result.settings.tts.provider, "supertonic");
    assert.equal(result.settings.tts.supertonic.baseUrl, "http://127.0.0.1:7788");
    assert.equal(result.settings.tts.supertonic.voice, "F4F2Dynamic01");
    assert.deepEqual(result.settings.stt, DEFAULT_SETTINGS.stt);

    const voiceDirMode = (await stat(path.join(codexHome, "voice"))).mode & 0o777;
    assert.equal(voiceDirMode, 0o700);
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
});

test("writeVoiceEnv preserves existing values and writes secrets with user-only permissions", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-voice-env-"));
  try {
    await ensureSettings({ codexHome });
    await writeVoiceEnv({ codexHome }, { ELEVENLABS_API_KEY: "first-secret" });
    await writeVoiceEnv({ codexHome }, { SUPERTONIC_TOKEN: "not-secret-for-test" });

    const env = await loadVoiceEnv({ codexHome });
    assert.equal(env.ELEVENLABS_API_KEY, "first-secret");
    assert.equal(env.SUPERTONIC_TOKEN, "not-secret-for-test");

    const envMode = (await stat(path.join(codexHome, "voice", "voice_env"))).mode & 0o777;
    assert.equal(envMode, 0o600);
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
});
