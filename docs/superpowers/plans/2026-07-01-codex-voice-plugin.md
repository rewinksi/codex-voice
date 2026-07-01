# Codex Voice Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a native Codex `/voice` plugin with per-thread local STT listener endpoints and configurable Supertonic or ElevenLabs TTS.

**Architecture:** The plugin root contains native command files, a voice skill, an MCP stdio server, and Node scripts. `/voice on` calls the MCP tool, which creates settings, allocates a port, starts a detached listener, and returns the endpoint. The listener normalizes STT payloads and records them as adjacent side-channel input without injecting into the main thread; active main-thread replies use `codex_voice_say` for concise spoken summaries.

**Tech Stack:** Node.js ESM, built-in `node:test`, built-in HTTP server, stdio JSON-RPC MCP shim, Codex plugin manifest, local JSON settings.

---

## File Structure

- `.codex-plugin/plugin.json`: marketplace-ready plugin manifest.
- `.mcp.json`: plugin-provided MCP server config.
- `commands/voice.md`: native `/voice` command behavior.
- `skills/voice/SKILL.md`: operating rules for the side-channel.
- `scripts/lib/paths.mjs`: Codex voice directory paths and safe filesystem helpers.
- `scripts/lib/settings.mjs`: settings and secret-env read/write.
- `scripts/lib/sessions.mjs`: session registry and priority port allocation.
- `scripts/lib/tts.mjs`: Supertonic and ElevenLabs provider validation plus speaking.
- `scripts/lib/stt.mjs`: OpenAI-compatible STT payload parsing.
- `scripts/lib/side-channel.mjs`: side-channel inbox writer.
- `scripts/voice-listener.mjs`: per-thread HTTP listener.
- `scripts/mcp-server.mjs`: MCP tools for `voice_on`, `voice_off`, and `voice_status`.
- `tests/*.test.mjs`: unit and integration tests.

## Tasks

### Task 1: Plugin Skeleton And Docs

**Files:**
- Create: `.codex-plugin/plugin.json`
- Create: `.mcp.json`
- Create: `commands/voice.md`
- Create: `skills/voice/SKILL.md`
- Modify: `package.json`

- [ ] Add manifest, command, skill, and npm scripts.
- [ ] Run plugin validator: `python3 /Users/rewi/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py /Users/rewi/Documents/Codex-Voice`.
- [ ] Commit: `git add . && git commit -m "docs: define codex voice plugin shape"`.

### Task 2: Settings, Secrets, And Ports

**Files:**
- Create: `scripts/lib/paths.mjs`
- Create: `scripts/lib/settings.mjs`
- Create: `scripts/lib/sessions.mjs`
- Create: `tests/settings.test.mjs`
- Create: `tests/sessions.test.mjs`

- [ ] Write failing tests for settings creation, secret file permissions, and port allocation.
- [ ] Run: `npm test -- tests/settings.test.mjs tests/sessions.test.mjs` and confirm failure.
- [ ] Implement path helpers, settings defaults, env parsing/writing, and session allocation.
- [ ] Run the tests and confirm pass.
- [ ] Commit: `git add scripts/lib tests package.json && git commit -m "feat: add voice settings and port allocation"`.

### Task 3: TTS Provider Setup

**Files:**
- Create: `scripts/lib/tts.mjs`
- Create: `tests/tts.test.mjs`
- Modify: `scripts/lib/settings.mjs`

- [ ] Write failing tests for Supertonic discovery and ElevenLabs missing-secret reporting.
- [ ] Run: `npm test -- tests/tts.test.mjs` and confirm failure.
- [ ] Implement provider resolution without printing secrets.
- [ ] Run the TTS tests and confirm pass.
- [ ] Commit: `git add scripts/lib tests && git commit -m "feat: resolve voice tts providers"`.

### Task 4: STT Listener

**Files:**
- Create: `scripts/lib/stt.mjs`
- Create: `scripts/lib/side-channel.mjs`
- Create: `scripts/voice-listener.mjs`
- Create: `tests/stt.test.mjs`
- Create: `tests/listener.test.mjs`

- [ ] Write failing tests for OpenAI payload parsing and listener health/chat endpoints.
- [ ] Run: `npm test -- tests/stt.test.mjs tests/listener.test.mjs` and confirm failure.
- [ ] Implement parser, listener server, auth check, and side-channel inbox recording.
- [ ] Run listener tests and confirm pass.
- [ ] Commit: `git add scripts tests && git commit -m "feat: add voice stt listener"`.

### Task 5: MCP Tools And Slash Command Flow

**Files:**
- Create: `scripts/mcp-server.mjs`
- Create: `tests/mcp-server.test.mjs`
- Modify: `commands/voice.md`
- Modify: `.mcp.json`

- [ ] Write failing tests for `tools/list`, `voice_on`, `voice_status`, and `voice_off` JSON-RPC behavior.
- [ ] Run: `npm test -- tests/mcp-server.test.mjs` and confirm failure.
- [ ] Implement MCP stdio JSON-RPC tool handling and detached listener lifecycle.
- [ ] Run MCP tests and confirm pass.
- [ ] Commit: `git add . && git commit -m "feat: expose codex voice mcp tools"`.

### Task 6: Verification And Distribution

**Files:**
- Modify: `README.md`
- Modify: `.gitignore`

- [ ] Run all tests: `npm test`.
- [ ] Run plugin validator.
- [ ] Smoke-test `voice_on` locally and curl `/healthz`.
- [ ] Prove endpoint input does not call main-thread injection paths; record exact result.
- [ ] Create public GitHub repository and push.
- [ ] Commit final docs: `git add . && git commit -m "docs: add codex voice usage"`.
