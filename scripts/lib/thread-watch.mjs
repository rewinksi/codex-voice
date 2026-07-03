import { stat, open, readdir } from "node:fs/promises";
import path from "node:path";

import { getCodexHome } from "./paths.mjs";
import { ensureSettings } from "./settings.mjs";
import { speakQueuedText } from "./speech-queue.mjs";
import { resolveTtsProvider } from "./tts.mjs";

export function extractAssistantSpeechText(line) {
  if (!line.trim()) return "";
  let item;
  try {
    item = JSON.parse(line);
  } catch {
    return "";
  }

  const payload = item?.payload;
  if (item?.type !== "response_item" || payload?.type !== "message" || payload?.role !== "assistant") {
    return "";
  }

  const parts = Array.isArray(payload.content) ? payload.content : [];
  return parts
    .filter((part) => part?.type === "output_text" && part.text)
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export function summarizeForSpeech(text, maxChars = 260) {
  const cleaned = String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>/g, " ")
    .replace(/^::[^\n]+$/gm, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s*(.+)$/gm, (_, heading) => {
      const trimmed = heading.trim();
      return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
    })
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/[*_~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length <= maxChars) return cleaned;

  const sentences = cleaned.match(/[^.!?]+[.!?]+/g) || [];
  let summary = "";
  for (const sentence of sentences) {
    const next = `${summary}${summary ? " " : ""}${sentence.trim()}`;
    if (next.length > maxChars) break;
    summary = next;
  }
  if (summary) return summary;

  const clipped = cleaned.slice(0, maxChars);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > 80 ? lastSpace : maxChars).trim()}...`;
}

export function shouldSpeakMainThreadSummary(text, settings = {}) {
  const summarySettings = settings.mainThreadSummary || {};
  const mode = String(summarySettings.mode || "milestones").toLowerCase();
  if (["off", "false", "none", "mute", "muted"].includes(mode)) return false;
  if (["all", "everything", "verbose"].includes(mode)) return true;

  const cleaned = summarizeForSpeech(text, Number(summarySettings.maxChars || 140));
  if (!cleaned) return false;
  return /\b(done|fixed|complete|completed|ready|blocked|failed|failure|error|issue|tests?\s+(?:pass|passed|passing|fail|failed)|passing|committed|pushed|installed|restarted|deployed|released|verified|validation\s+passed|suite\s+(?:pass|passed|green)|green)\b/i.test(cleaned);
}

export async function findRolloutPath(options = {}, threadId) {
  const sessionsDir = path.join(getCodexHome(options), "sessions");
  const suffix = `${threadId}.jsonl`;
  return walkForSuffix(sessionsDir, suffix);
}

async function walkForSuffix(dir, suffix) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith(suffix)) return fullPath;
    if (entry.isDirectory()) {
      const found = await walkForSuffix(fullPath, suffix);
      if (found) return found;
    }
  }
  return null;
}

export async function startThreadWatcher({ session, codexHome, intervalMs = 350, settleMs, deps = {} }) {
  const options = { codexHome };
  const rolloutPath = await findRolloutPath(options, session.threadId);
  if (!rolloutPath) {
    return { started: false, reason: "rollout-not-found" };
  }

  let offset = (await stat(rolloutPath)).size;
  let buffer = "";
  let busy = false;
  let pendingText = "";
  let pendingUpdatedAt = 0;

  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const { settings } = await ensureSettings(options);
      const summarySettings = settings.mainThreadSummary || {};
      const maxChars = Number(summarySettings.maxChars || 140);
      const quietMs = Number(settleMs ?? summarySettings.settleMs ?? 450);
      const result = await readNewLines(rolloutPath, offset, buffer);
      offset = result.offset;
      buffer = result.buffer;
      const candidates = result.lines
        .map((line) => extractAssistantSpeechText(line))
        .filter((text) => shouldSpeakMainThreadSummary(text, settings))
        .map((text) => summarizeForSpeech(text, maxChars))
        .filter(Boolean);
      if (candidates.length) {
        pendingText = candidates.at(-1);
        pendingUpdatedAt = Date.now();
      }

      if (!pendingText || Date.now() - pendingUpdatedAt < quietMs) return;

      const text = pendingText;
      pendingText = "";
      const tts = await resolveTtsProvider(options, { fetch: deps.fetch, env: deps.env });
      await speakQueuedText(text, tts, settings, {
        fetch: deps.fetch,
        player: deps.player,
        streamPlayer: deps.streamPlayer,
        sleep: deps.sleep,
      });
    } catch {
      // Keep the listener alive even if one speech attempt fails.
    } finally {
      busy = false;
    }
  }, intervalMs);
  timer.unref();

  return { started: true, rolloutPath, stop: () => clearInterval(timer) };
}

async function readNewLines(filePath, offset, buffer) {
  const size = (await stat(filePath)).size;
  if (size <= offset) return { offset, buffer, lines: [] };

  const length = size - offset;
  const handle = await open(filePath, "r");
  try {
    const readBuffer = Buffer.alloc(length);
    await handle.read(readBuffer, 0, length, offset);
    const text = buffer + readBuffer.toString("utf8");
    const parts = text.split(/\r?\n/);
    const nextBuffer = parts.pop() || "";
    return { offset: size, buffer: nextBuffer, lines: parts.filter(Boolean) };
  } finally {
    await handle.close();
  }
}
