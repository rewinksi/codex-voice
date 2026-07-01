import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildSideChannelAckText,
  readRecentThreadContext,
  resetSideChannelSpeechQueueForTests,
  respondToSideChannel,
} from "../scripts/lib/side-channel-response.mjs";
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

test("buildSideChannelAckText references the side-channel subject briefly", () => {
  assert.equal(
    buildSideChannelAckText("Can you check the LM Studio timeout thing?", {}, { random: () => 0.2 }),
    "Got it: LM Studio.",
  );
  assert.equal(
    buildSideChannelAckText("Um, the side channel is still not answering", {}, { random: () => 0.2 }),
    "Got it: side channel.",
  );
});

test("buildSideChannelAckText varies acknowledgement words from configured options", () => {
  const settings = {
    sideChannel: {
      acknowledgementWords: ["Righto", "Sweet as", "Mmm, your mother (what?)"],
    },
  };

  assert.equal(
    buildSideChannelAckText("Gemma is answering now", settings, { random: () => 0 }),
    "Righto: Gemma.",
  );
  assert.equal(
    buildSideChannelAckText("Gemma is answering now", settings, { random: () => 0.5 }),
    "Sweet as: Gemma.",
  );
  assert.equal(
    buildSideChannelAckText("Gemma is answering now", settings, { random: () => 0.99 }),
    "Mmm, your mother (what?): Gemma.",
  );
});

test("respondToSideChannel leaves a breath between side-channel utterances", async () => {
  resetSideChannelSpeechQueueForTests();
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-voice-side-gap-"));
  const spokenTexts = [];
  const sleeps = [];
  try {
    const { settings } = await ensureSettings({ codexHome });
    settings.tts.provider = "elevenlabs";
    settings.tts.elevenlabs.voiceName = "Rachel";
    settings.tts.elevenlabs.voiceId = "voice-1";
    settings.tts.elevenlabs.streaming = false;
    settings.sideChannel.responseMode = "codex-exec";
    settings.sideChannel.speechGapMs = 250;
    await saveSettings({ codexHome }, settings);
    await writeVoiceEnv({ codexHome }, { ELEVENLABS_API_KEY: "test-key" });

    await respondToSideChannel(
      { codexHome },
      { threadId: "thread-a", threadName: "Alpha", cwd: "/tmp" },
      settings,
      "Can you check the LM Studio timeout thing?",
      {
        runCodexExec: async () => "Timeout is bumped and the ack is cleaner.",
        fetch: async (url, options = {}) => {
          if (String(url).includes("/v1/text-to-speech/voice-1")) {
            spokenTexts.push(JSON.parse(options.body).text);
          }
          return {
            ok: true,
            arrayBuffer: async () => Buffer.from("audio").buffer,
          };
        },
        player: async () => {},
        random: () => 0.2,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    );

    assert.deepEqual(spokenTexts, [
      "Got it: LM Studio.",
      "Timeout is bumped and the ack is cleaner.",
    ]);
    assert.deepEqual(sleeps, [250]);
  } finally {
    resetSideChannelSpeechQueueForTests();
    await rm(codexHome, { recursive: true, force: true });
  }
});

test("respondToSideChannel uses LM Studio for quick side-channel answers by default", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-voice-side-lmstudio-"));
  const calls = [];
  const played = [];
  try {
    const { settings } = await ensureSettings({ codexHome });
    settings.tts.provider = "elevenlabs";
    settings.tts.elevenlabs.voiceName = "Rachel";
    settings.tts.elevenlabs.streaming = false;
    settings.voiceStyle = {
      spokenPersonality: "concise, cheeky kiwi humour, light sarcasm",
      profanity: "allowed when appropriate",
    };
    await saveSettings({ codexHome }, settings);
    await writeVoiceEnv({ codexHome }, { ELEVENLABS_API_KEY: "test-key", LM_API_TOKEN: "lm-token" });

    const result = await respondToSideChannel(
      { codexHome },
      { threadId: "thread-a", threadName: "Alpha", cwd: "/tmp" },
      settings,
      "How is this working?",
      {
        fetch: async (url, options = {}) => {
          calls.push({ url: String(url), options });
          if (String(url).endsWith("/v1/chat/completions")) {
            return {
              ok: true,
              json: async () => ({
                choices: [{ message: { content: "It is working through the LM Studio side-channel responder." } }],
              }),
            };
          }
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
    const lmStudioCall = calls.find((call) => call.url.endsWith("/v1/chat/completions"));
    assert.ok(lmStudioCall);
    assert.equal(lmStudioCall.options.headers.authorization, "Bearer lm-token");
    const lmStudioBody = JSON.parse(lmStudioCall.options.body);
    assert.equal(lmStudioBody.model, "google/gemma-4-12b-qat");
    assert.equal(lmStudioBody.max_tokens, 768);
    assert.deepEqual(lmStudioBody.reasoning, { effort: "none" });
    assert.ok(lmStudioBody.messages.every((message) => message.content.startsWith("/nothink ")));
    assert.match(lmStudioBody.messages[0].content, /cheeky kiwi humour/);
    assert.match(lmStudioBody.messages[0].content, /profanity: allowed when appropriate/);
    assert.match(result.text, /LM Studio side-channel responder/);
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
