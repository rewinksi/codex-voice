import assert from "node:assert/strict";
import test from "node:test";

import { extractTranscriptText } from "../scripts/lib/stt.mjs";

test("extractTranscriptText reads the last user message from OpenAI chat payloads", () => {
  const text = extractTranscriptText({
    messages: [
      { role: "system", content: "ignore" },
      { role: "user", content: "first command" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "run the tests" },
    ],
  });

  assert.equal(text, "run the tests");
});

test("extractTranscriptText reads text parts from multimodal-style content arrays", () => {
  const text = extractTranscriptText({
    messages: [
      {
        role: "user",
        content: [
          { type: "input_text", text: "check voice status" },
          { type: "image_url", image_url: { url: "ignored" } },
        ],
      },
    ],
  });

  assert.equal(text, "check voice status");
});

test("extractTranscriptText accepts direct text and transcript payloads", () => {
  assert.equal(extractTranscriptText({ text: "hello codex" }), "hello codex");
  assert.equal(extractTranscriptText({ transcript: "ship it" }), "ship it");
});

test("extractTranscriptText rejects empty payloads", () => {
  assert.throws(() => extractTranscriptText({ messages: [] }), /No transcript text/);
  assert.throws(() => extractTranscriptText({ text: "   " }), /No transcript text/);
});
