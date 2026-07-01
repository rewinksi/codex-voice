import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  allocateSession,
  loadSessions,
  releaseSession,
} from "../scripts/lib/sessions.mjs";
import { ensureSettings } from "../scripts/lib/settings.mjs";

test("allocateSession assigns ports in priority order and reuses the same thread port", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-voice-sessions-"));
  try {
    const { settings } = await ensureSettings({ codexHome });

    const first = await allocateSession(
      { codexHome },
      { threadId: "thread-a", threadName: "Alpha", cwd: "/tmp/a" },
      settings,
    );
    const second = await allocateSession(
      { codexHome },
      { threadId: "thread-b", threadName: "Beta", cwd: "/tmp/b" },
      settings,
    );
    const firstAgain = await allocateSession(
      { codexHome },
      { threadId: "thread-a", threadName: "Alpha", cwd: "/tmp/a" },
      settings,
    );

    assert.equal(first.port, 6901);
    assert.equal(second.port, 6902);
    assert.equal(firstAgain.port, 6901);

    const registry = await loadSessions({ codexHome });
    assert.equal(registry.sessions["thread-a"].endpoint, "http://127.0.0.1:6901/v1/chat/completions");
    assert.equal(registry.sessions["thread-b"].endpoint, "http://127.0.0.1:6902/v1/chat/completions");
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
});

test("releaseSession marks only the target thread inactive and frees its port", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-voice-release-"));
  try {
    const { settings } = await ensureSettings({ codexHome });
    await allocateSession({ codexHome }, { threadId: "thread-a", threadName: "Alpha" }, settings);
    await allocateSession({ codexHome }, { threadId: "thread-b", threadName: "Beta" }, settings);

    const released = await releaseSession({ codexHome }, "thread-a");
    const replacement = await allocateSession(
      { codexHome },
      { threadId: "thread-c", threadName: "Gamma" },
      settings,
    );

    assert.equal(released.port, 6901);
    assert.equal(replacement.port, 6901);

    const registry = await loadSessions({ codexHome });
    assert.equal(registry.sessions["thread-a"].active, false);
    assert.equal(registry.sessions["thread-b"].active, true);
    assert.equal(registry.sessions["thread-c"].active, true);
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
});
