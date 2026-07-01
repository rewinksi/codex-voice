import { execFile } from "node:child_process";
import { mkdtemp, open, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveTtsProvider, speakText } from "./tts.mjs";
import { findRolloutPath, summarizeForSpeech } from "./thread-watch.mjs";

export async function respondToSideChannel(options = {}, session, settings, text, deps = {}) {
  const tts = await resolveTtsProvider(options, { fetch: deps.fetch, env: deps.env });
  if (settings.sideChannel?.speakImmediateAck !== false) {
    await speakText("Got it. I am answering on the side channel.", tts, {
      fetch: deps.fetch,
      player: deps.player,
      streamPlayer: deps.streamPlayer,
    });
  }

  const responseText = await generateSideChannelResponse(session, settings, text, {
    ...deps,
    codexHome: options.codexHome,
  });
  const spokenText = summarizeForSpeech(responseText, settings.sideChannel?.maxResponseChars || 260);
  if (!spokenText) return { spoken: false, reason: "empty-response" };

  const spoken = await speakText(spokenText, tts, {
    fetch: deps.fetch,
    player: deps.player,
    streamPlayer: deps.streamPlayer,
  });
  return { ...spoken, text: spokenText };
}

export async function generateSideChannelResponse(session, settings, text, deps = {}) {
  const mode = settings.sideChannel?.responseMode || "codex-exec";
  if (mode === "ack") {
    return "I heard you on the side channel. I will keep the main thread uninterrupted.";
  }
  if (mode === "ollama") {
    try {
      return await runOllamaResponder(session, settings, text, deps);
    } catch {
      return "I heard the side-channel message, but the quick local responder did not answer in time.";
    }
  }
  if (mode !== "codex-exec") {
    return `Unsupported side-channel response mode: ${mode}`;
  }

  const runner = deps.runCodexExec || runCodexExecResponder;
  try {
    return await runner(session, settings, text, deps);
  } catch {
    return "I heard the side-channel message, but I could not generate a quick answer.";
  }
}

async function runOllamaResponder(session, settings, text, deps = {}) {
  const baseUrl = (settings.sideChannel?.ollama?.baseUrl || "http://127.0.0.1:11434").replace(/\/$/, "");
  const model = settings.sideChannel?.ollama?.model || "llama3.2:3b";
  const timeout = Number(settings.sideChannel?.timeoutMs || 6000);
  const context = await readRecentThreadContext({ codexHome: deps.codexHome }, session, settings);
  const prompt = [
    "You are Codex Voice's fast spoken side-channel.",
    "Answer in one short sentence. Be useful, casual, and do not mention implementation details unless asked.",
    "Do not modify files or interact with the main thread.",
    context ? "\nRecent main-thread context:\n" + context : "",
    "",
    `Side-channel message: ${text}`,
  ].join("\n");

  const fetchImpl = deps.fetch || globalThis.fetch;
  const response = await fetchImpl(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: {
        num_predict: 80,
        temperature: 0.3,
      },
    }),
    signal: AbortSignal.timeout?.(timeout),
  });
  if (!response.ok) throw new Error(`ollama-http-${response.status}`);
  const payload = await response.json();
  return String(payload.response || "").trim();
}

async function runCodexExecResponder(session, settings, text, deps = {}) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "codex-voice-side-response-"));
  const outputPath = path.join(tempDir, "response.txt");
  const timeout = Number(settings.sideChannel?.timeoutMs || 20000);
  const cwd = session.cwd || process.cwd();
  const context = await readRecentThreadContext({ codexHome: deps.codexHome }, session, settings);
  const prompt = [
    "You are Codex Voice's adjacent spoken side-channel.",
    "Answer the user's spoken side-channel message in one or two short sentences.",
    "Do not write files, do not modify code, and do not interact with the main thread.",
    "If you lack context, say so briefly and ask for the missing detail.",
    context ? "\nRecent main-thread context:\n" + context : "",
    "",
    `Side-channel message: ${text}`,
  ].join("\n");

  try {
    await execFilePromise(
      deps.codexCommand || "codex",
      [
        "exec",
        "--ephemeral",
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        "--cd",
        cwd,
        "--output-last-message",
        outputPath,
        prompt,
      ],
      {
        timeout,
        env: deps.env || process.env,
      },
    );
    return (await readFile(outputPath, "utf8")).trim();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function readRecentThreadContext(options = {}, session, settings = {}) {
  if (settings.sideChannel?.includeRecentThreadContext === false) return "";
  const rolloutPath = await findRolloutPath(options, session.threadId);
  if (!rolloutPath) return "";

  const bytes = Number(settings.sideChannel?.contextBytes || 120000);
  const maxChars = Number(settings.sideChannel?.maxContextChars || 2400);
  const size = (await stat(rolloutPath)).size;
  const start = Math.max(0, size - bytes);
  const handle = await open(rolloutPath, "r");
  try {
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const lines = buffer.toString("utf8").split(/\r?\n/).filter(Boolean);
    const messages = [];
    for (const line of lines) {
      const message = extractRolloutMessage(line);
      if (message) messages.push(message);
    }
    return messages.slice(-8).join("\n").slice(-maxChars);
  } finally {
    await handle.close();
  }
}

function extractRolloutMessage(line) {
  let item;
  try {
    item = JSON.parse(line);
  } catch {
    return "";
  }
  const payload = item?.payload;
  if (item?.type !== "response_item" || payload?.type !== "message") return "";
  if (!["user", "assistant"].includes(payload.role)) return "";
  const text = extractContentText(payload.content);
  if (!text) return "";
  return `${payload.role}: ${summarizeForSpeech(text, 420)}`;
}

function extractContentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => part?.text || "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function execFilePromise(command, args, options) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}
