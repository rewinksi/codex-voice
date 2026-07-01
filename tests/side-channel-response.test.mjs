import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readRecentThreadContext, respondToSideChannel } from "../scripts/lib/side-channel-response.mjs";
import { ensureSettings, saveSettings, writeVoiceEnv } from "../scripts/lib/settings.mjs";

test("respondToSideChannel speaks a generated side-channel answer", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-voice-side-response-"));
  const played = [];
  try {
    const { settings } = await ensureSettings({ codexHome });
    settings.tts.provider = "elevenlabs";
    settings.tts.elevenlabs.voiceName = "Rachel";
    settings.tts.elevenlabs.streaming = false;
    settings.sideChannel.responseMode = "codex-exec";
    await saveSettings({ codexHome }, settings);
    await writeVoiceEnv({ codexHome }, { ELEVENLABS_API_KEY: "test-key" });

    const result = await respondToSideChannel(
      { codexHome },
      { threadId: "thread-a", threadName: "Alpha", cwd: "/tmp" },
      settings,
      "How is the side channel working?",
      {
        runCodexExec: async () => "The side channel is working. I can answer aloud without touching the main thread.",
        fetch: async (url) => {
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
    assert.equal(played.length, 2);
    assert.match(result.text, /side channel is working/i);
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
});

test("readRecentThreadContext extracts bounded recent user and assistant messages", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-voice-side-context-"));
  const threadId = "thread-context-a";
  const rolloutDir = path.join(codexHome, "sessions", "2026", "07", "01");
  const rolloutPath = path.join(rolloutDir, `rollout-2026-07-01T00-00-00-${threadId}.jsonl`);
  try {
    await mkdir(rolloutDir, { recursive: true });
    await writeFile(
      rolloutPath,
      [
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "What changed in the listener?" }],
          },
        }),
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "I added automatic spoken replies." }],
          },
        }),
      ].join("\n") + "\n",
    );

    const context = await readRecentThreadContext(
      { codexHome },
      { threadId },
      { sideChannel: { maxContextChars: 1000 } },
    );

    assert.match(context, /user: What changed/);
    assert.match(context, /assistant: I added automatic spoken replies/);
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
});
