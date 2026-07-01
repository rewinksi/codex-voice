import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export class JsonRpcLineClient {
  #nextId = 1;
  #pending = new Map();
  #output;

  constructor({ input, output }) {
    this.#output = output;
    const rl = createInterface({ input });
    rl.on("line", (line) => this.#handleLine(line));
    rl.on("close", () => this.#rejectAll(new Error("app-server transport closed")));
  }

  request(method, params = {}) {
    const id = this.#nextId;
    this.#nextId += 1;
    const message = { id, method, params };
    const promise = new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
    });
    this.#output.write(`${JSON.stringify(message)}\n`);
    return promise;
  }

  notify(method, params = {}) {
    this.#output.write(`${JSON.stringify({ method, params })}\n`);
  }

  #handleLine(line) {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    if (message.id === undefined) return;
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    this.#pending.delete(message.id);

    if (message.error) {
      const error = new Error(message.error.message || "app-server JSON-RPC error");
      error.code = message.error.code;
      pending.reject(error);
      return;
    }
    pending.resolve(message.result);
  }

  #rejectAll(error) {
    for (const pending of this.#pending.values()) {
      pending.reject(error);
    }
    this.#pending.clear();
  }
}

export class CodexAppServerClient {
  #rpc;
  #initialized = false;
  #process = null;

  constructor(options = {}) {
    this.command = options.command || "codex";
    this.args = options.args || ["app-server"];
    this.cwd = options.cwd;
    this.env = options.env;
    this.#rpc = options.rpc || null;
  }

  async sendText(session, text) {
    await this.#ensureInitialized();
    const resume = await this.#rpc.request("thread/resume", {
      threadId: session.threadId,
      cwd: session.cwd || null,
    });
    const thread = resume.thread;
    const activeTurn = findActiveTurn(thread);
    const input = [{ type: "text", text }];

    if (thread?.status?.type === "active" && activeTurn) {
      await this.#rpc.request("turn/steer", {
        threadId: session.threadId,
        expectedTurnId: activeTurn.id,
        input,
      });
      return { delivered: true, mode: "turn/steer", threadId: session.threadId, turnId: activeTurn.id };
    }

    const started = await this.#rpc.request("turn/start", {
      threadId: session.threadId,
      cwd: session.cwd || null,
      input,
    });
    return {
      delivered: true,
      mode: "turn/start",
      threadId: session.threadId,
      turnId: started?.turn?.id || null,
    };
  }

  async #ensureInitialized() {
    if (!this.#rpc) {
      this.#startProcess();
    }
    if (this.#initialized) return;

    await this.#rpc.request("initialize", {
      clientInfo: {
        name: "codex_voice",
        title: "Codex Voice",
        version: "0.1.3",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    this.#rpc.notify("initialized", {});
    this.#initialized = true;
  }

  #startProcess() {
    this.#process = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: this.env || process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#process.stderr.on("data", () => {});
    this.#rpc = new JsonRpcLineClient({
      input: this.#process.stdout,
      output: this.#process.stdin,
    });
  }
}

function findActiveTurn(thread) {
  if (!Array.isArray(thread?.turns)) return null;
  return [...thread.turns].reverse().find((turn) => turn.status === "inProgress") || null;
}

export class CodexBridge {
  constructor(options = {}) {
    this.clientFactory = options.clientFactory || (() => new CodexAppServerClient(options.appServer || {}));
    this.client = null;
  }

  async sendText(session, text) {
    try {
      if (!this.client) this.client = this.clientFactory();
      return await this.client.sendText(session, text);
    } catch (error) {
      return {
        delivered: false,
        reason: error instanceof Error ? error.message : String(error),
        threadId: session?.threadId || "",
        textLength: text?.length || 0,
      };
    }
  }
}

export function createBridge(options = {}) {
  return new CodexBridge(options);
}
