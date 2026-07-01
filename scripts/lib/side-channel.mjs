import { appendFile } from "node:fs/promises";

import { ensureVoiceDir, getSideChannelPath } from "./paths.mjs";

export async function recordSideChannelMessage(options = {}, session, text) {
  await ensureVoiceDir(options);
  const entry = {
    ts: new Date().toISOString(),
    route: "side-channel",
    threadId: session.threadId,
    threadName: session.threadName,
    port: session.port,
    text,
  };
  await appendFile(getSideChannelPath(options), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  return entry;
}
