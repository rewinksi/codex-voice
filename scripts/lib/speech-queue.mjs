import { speakText } from "./tts.mjs";
import { mkdir, rm, stat } from "node:fs/promises";

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
    const releaseLock = await acquireSpeechLock(deps.lockPath, settings, deps);
    try {
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
    } finally {
      await releaseLock();
    }
  });
  speechQueue = run.catch(() => {});
  return run;
}

async function acquireSpeechLock(lockPath, settings = {}, deps = {}) {
  if (!lockPath || settings.tts?.globalLock === false) return async () => {};

  const retryMs = Number(deps.lockRetryMs ?? settings.tts?.lockRetryMs ?? 75);
  const staleMs = Number(deps.lockStaleMs ?? settings.tts?.lockStaleMs ?? 120_000);
  const sleepImpl = deps.sleep || sleep;

  while (true) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      return async () => {
        await rm(lockPath, { recursive: true, force: true });
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (await removeStaleLock(lockPath, staleMs)) continue;
      await sleepImpl(retryMs);
    }
  }
}

async function removeStaleLock(lockPath, staleMs) {
  if (staleMs <= 0) return false;
  try {
    const ageMs = Date.now() - (await stat(lockPath)).mtimeMs;
    if (ageMs < staleMs) return false;
    await rm(lockPath, { recursive: true, force: true });
    return true;
  } catch {
    return true;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
