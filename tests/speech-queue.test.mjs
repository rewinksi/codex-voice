import assert from "node:assert/strict";
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
