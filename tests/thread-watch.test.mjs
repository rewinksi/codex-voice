import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  extractAssistantSpeechText,
  startThreadWatcher,
  summarizeForSpeech,
} from "../scripts/lib/thread-watch.mjs";
import { resetSpeechQueueForTests } from "../scripts/lib/speech-queue.mjs";
import { ensureSettings, saveSettings, writeVoiceEnv } from "../scripts/lib/settings.mjs";

test("extractAssistantSpeechText reads assistant output text from rollout message lines", () => {
  const line = JSON.stringify({
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "I updated the listener. Tests are passing." }],
    },
  });

  assert.equal(
    extractAssistantSpeechText(line),
    "I updated the listener. Tests are passing.",
  );
});

test("extractAssistantSpeechText ignores non-assistant and tool output lines", () => {
  assert.equal(
    extractAssistantSpeechText(JSON.stringify({ type: "response_item", payload: { type: "function_call_output" } })),
    "",
  );
  assert.equal(
    extractAssistantSpeechText(JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hello" }],
      },
    })),
    "",
  );
});

test("summarizeForSpeech removes code blocks, directives, and long detail", () => {
  const summary = summarizeForSpeech(`
Done. I updated the watcher.

\`\`\`js
console.log("do not read this aloud");
\`\`\`

::git-commit{cwd="/tmp"}

The full test suite is passing and the listener is restarted.
`, 120);

  assert.equal(summary.includes("console.log"), false);
  assert.equal(summary.includes("::git-commit"), false);
  assert.equal(summary, "Done. I updated the watcher. The full test suite is passing and the listener is restarted.");
});

test("startThreadWatcher speaks newly appended assistant messages", async () => {
  resetSpeechQueueForTests();
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-voice-watch-"));
  const threadId = "thread-watch-a";
  const rolloutDir = path.join(codexHome, "sessions", "2026", "07", "01");
  const rolloutPath = path.join(rolloutDir, `rollout-2026-07-01T00-00-00-${threadId}.jsonl`);
  const spoken = [];

  try {
    await mkdir(rolloutDir, { recursive: true });
    await writeFile(rolloutPath, `${JSON.stringify({ type: "session_meta", payload: { id: threadId } })}\n`);

    const { settings } = await ensureSettings({ codexHome });
    settings.tts.provider = "elevenlabs";
    settings.tts.elevenlabs.voiceName = "Rachel";
    settings.tts.elevenlabs.streaming = false;
    await saveSettings({ codexHome }, settings);
    await writeVoiceEnv({ codexHome }, { ELEVENLABS_API_KEY: "test-key" });

    const watcher = await startThreadWatcher({
      session: { threadId, threadName: "Watch Test" },
      codexHome,
      intervalMs: 25,
      settleMs: 30,
      deps: {
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
          spoken.push(audioPath);
        },
      },
    });

    assert.equal(watcher.started, true);
    await appendFile(
      rolloutPath,
      `${JSON.stringify({
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Watcher spoke this." }],
        },
      })}\n`,
    );

    await new Promise((resolve) => setTimeout(resolve, 150));
    watcher.stop();
    assert.equal(spoken.length, 1);
  } finally {
    resetSpeechQueueForTests();
    await rm(codexHome, { recursive: true, force: true });
  }
});

test("startThreadWatcher coalesces rapid assistant messages and speaks only the latest", async () => {
  resetSpeechQueueForTests();
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-voice-watch-latest-"));
  const threadId = "thread-watch-latest";
  const rolloutDir = path.join(codexHome, "sessions", "2026", "07", "01");
  const rolloutPath = path.join(rolloutDir, `rollout-2026-07-01T00-00-00-${threadId}.jsonl`);
  const spokenTexts = [];

  try {
    await mkdir(rolloutDir, { recursive: true });
    await writeFile(rolloutPath, `${JSON.stringify({ type: "session_meta", payload: { id: threadId } })}\n`);

    const { settings } = await ensureSettings({ codexHome });
    settings.tts.provider = "elevenlabs";
    settings.tts.elevenlabs.voiceName = "Rachel";
    settings.tts.elevenlabs.voiceId = "voice-1";
    settings.tts.elevenlabs.streaming = false;
    await saveSettings({ codexHome }, settings);
    await writeVoiceEnv({ codexHome }, { ELEVENLABS_API_KEY: "test-key" });

    const watcher = await startThreadWatcher({
      session: { threadId, threadName: "Watch Test" },
      codexHome,
      intervalMs: 15,
      settleMs: 30,
      deps: {
        fetch: async (url, options = {}) => {
          assert.equal(String(url).endsWith("/v1/voices"), false);
          if (String(url).includes("/v1/text-to-speech/voice-1")) {
            spokenTexts.push(JSON.parse(options.body).text);
          }
          return {
            ok: true,
            arrayBuffer: async () => Buffer.from("audio").buffer,
          };
        },
        player: async () => {},
      },
    });

    assert.equal(watcher.started, true);
    await appendFile(
      rolloutPath,
      `${JSON.stringify({
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "First stale update." }],
        },
      })}\n${JSON.stringify({
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Latest useful update." }],
        },
      })}\n`,
    );

    await new Promise((resolve) => setTimeout(resolve, 180));
    watcher.stop();
    assert.deepEqual(spokenTexts, ["Latest useful update."]);
  } finally {
    resetSpeechQueueForTests();
    await rm(codexHome, { recursive: true, force: true });
  }
});
