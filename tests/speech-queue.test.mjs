import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  resetSpeechQueueForTests,
  speakQueuedText,
} from "../scripts/lib/speech-queue.mjs";

test("speakQueuedText serializes overlapping speech calls with a breath between them", async () => {
  resetSpeechQueueForTests();
  const events = [];
  const sleeps = [];
  let releaseFirst;

  const speaker = async (text) => {
    events.push(`start:${text}`);
    if (text === "main update") {
      await new Promise((resolve) => {
        releaseFirst = resolve;
      });
    }
    events.push(`end:${text}`);
    return { spoken: true, text };
  };

  const settings = { sideChannel: { speechGapMs: 250 } };
  const first = speakQueuedText("main update", { ready: true }, settings, {
    speaker,
    sleep: async (ms) => sleeps.push(ms),
  });
  await new Promise((resolve) => setImmediate(resolve));
  const second = speakQueuedText("side channel", { ready: true }, settings, {
    speaker,
    sleep: async (ms) => sleeps.push(ms),
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(events, ["start:main update"]);
  releaseFirst();
  await Promise.all([first, second]);

  assert.deepEqual(events, [
    "start:main update",
    "end:main update",
    "start:side channel",
    "end:side channel",
  ]);
  assert.deepEqual(sleeps, [250]);
  resetSpeechQueueForTests();
});

test("speakQueuedText waits for a shared speech lock before speaking", async () => {
  resetSpeechQueueForTests();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "codex-voice-speech-lock-"));
  const lockPath = path.join(tempDir, "tts.lock");
  const events = [];
  let sleepCount = 0;

  try {
    await mkdir(lockPath);

    const run = speakQueuedText("locked speech", { ready: true }, { sideChannel: { speechGapMs: 0 } }, {
      lockPath,
      lockRetryMs: 10,
      lockStaleMs: 60_000,
      speaker: async (text) => {
        events.push(`speak:${text}`);
        return { spoken: true };
      },
      sleep: async () => {
        sleepCount += 1;
        if (sleepCount === 2) await rm(lockPath, { recursive: true, force: true });
      },
    });

    await run;

    assert.equal(sleepCount, 2);
    assert.deepEqual(events, ["speak:locked speech"]);
  } finally {
    resetSpeechQueueForTests();
    await rm(tempDir, { recursive: true, force: true });
  }
});
