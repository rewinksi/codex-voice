import { speakText } from "./tts.mjs";

let speechQueue = Promise.resolve();
let hasSpoken = false;

export function resetSpeechQueueForTests() {
  speechQueue = Promise.resolve();
  hasSpoken = false;
}

export function speakQueuedText(text, tts, settings = {}, deps = {}) {
  const gapMs = Number(settings.sideChannel?.speechGapMs ?? 250);
  const speaker = deps.speaker || speakText;
  const run = speechQueue.then(async () => {
    if (hasSpoken && gapMs > 0) {
      await (deps.sleep || sleep)(gapMs);
    }
    const result = await speaker(text, tts, {
      fetch: deps.fetch,
      player: deps.player,
      streamPlayer: deps.streamPlayer,
    });
    hasSpoken = true;
    return result;
  });
  speechQueue = run.catch(() => {});
  return run;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
