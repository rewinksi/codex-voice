export class CodexBridge {
  async sendText(session, text) {
    return {
      delivered: false,
      reason: "codex-app-server-bridge-not-connected",
      threadId: session?.threadId || "",
      textLength: text?.length || 0,
    };
  }
}

export function createBridge() {
  return new CodexBridge();
}
