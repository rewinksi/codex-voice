#!/usr/bin/env node
import http from "node:http";
import { readFile } from "node:fs/promises";

import { recordSideChannelMessage } from "./lib/side-channel.mjs";
import { extractTranscriptText } from "./lib/stt.mjs";
import { startThreadWatcher } from "./lib/thread-watch.mjs";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
};

function sendJson(response, status, body) {
  response.writeHead(status, JSON_HEADERS);
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function isAuthorized(request, settings) {
  const token = settings?.stt?.bearerToken;
  if (!token) return true;
  return request.headers.authorization === `Bearer ${token}`;
}

function openAiAck() {
  return {
    id: "chatcmpl-codex-voice",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "codex-voice-stt",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: "Side-channel message received.",
        },
        finish_reason: "stop",
      },
    ],
  };
}

export function createVoiceServer({ session, settings, codexHome, recorder = recordSideChannelMessage }) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);

    if (request.method === "GET" && url.pathname === "/healthz") {
      sendJson(response, 200, {
        status: "ok",
        threadId: session.threadId,
        threadName: session.threadName,
        port: session.port,
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/models") {
      sendJson(response, 200, {
        object: "list",
        data: [
          {
            id: "codex-voice-stt",
            object: "model",
            owned_by: "codex-voice",
          },
        ],
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
      if (!isAuthorized(request, settings)) {
        sendJson(response, 401, { error: { message: "Unauthorized", type: "authentication_error" } });
        return;
      }

      try {
        const payload = await readJson(request);
        const text = extractTranscriptText(payload);
        await recorder({ codexHome }, session, text);

        sendJson(response, 200, openAiAck());
      } catch (error) {
        sendJson(response, 400, {
          error: {
            message: error instanceof Error ? error.message : String(error),
            type: "invalid_request_error",
          },
        });
      }
      return;
    }

    sendJson(response, 404, { error: { message: "Not Found", type: "not_found" } });
  });
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item.startsWith("--")) {
      args[item.slice(2)] = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args["session-file"]) {
    throw new Error("--session-file is required");
  }

  const data = JSON.parse(await readFile(args["session-file"], "utf8"));
  const server = createVoiceServer({
    session: data.session,
    settings: data.settings,
    codexHome: data.codexHome,
  });

  const host = data.settings.host || "127.0.0.1";
  const port = data.session.port;
  server.listen(port, host, () => {
    process.stdout.write(`codex voice listener online at http://${host}:${port}/v1/chat/completions\n`);
  });
  const watcher = await startThreadWatcher({
    session: data.session,
    codexHome: data.codexHome,
  });
  if (watcher.started) {
    process.stdout.write(`codex voice thread watcher online for ${data.session.threadId}\n`);
  } else {
    process.stderr.write(`codex voice thread watcher unavailable: ${watcher.reason}\n`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message || error}\n`);
    process.exit(1);
  });
}
