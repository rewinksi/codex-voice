# Codex Voice

Codex Voice is a Codex plugin that adds a native `/voice` command for per-thread voice side-channels.

External STT/PTT clients post transcribed commands to the displayed local endpoint. Codex keeps technical work in the thread and uses the voice channel for concise coordination.

## Status

This repository contains the plugin scaffold, native `/voice` command, MCP lifecycle tools, per-thread port allocation, settings/secrets handling, TTS provider resolution, local STT listener, and a Codex app-server bridge client.

The listener side is verified. The Codex app-server bridge lives in `scripts/lib/codex-bridge.mjs`; it initializes `codex app-server`, resumes the bound thread, and uses `turn/start` or `turn/steer` depending on thread state. If the app-server bridge is unavailable, STT posts return `503` with `codex_bridge_unavailable` instead of silently dropping commands.

## Commands

- `/voice on`
- `/voice off`
- `/voice status`

## Local Files

- `~/.codex/voice/settings.json`: non-secret voice settings
- `~/.codex/voice/voice_env`: local secrets such as `ELEVENLABS_API_KEY`
- `~/.codex/voice/sessions.json`: active listener registry

The default listener host is `127.0.0.1`, and ports start at `6901`.

## STT Endpoint

`/voice on` prints the endpoint first:

```text
Voice listener endpoint: http://127.0.0.1:6901/v1/chat/completions
```

Accepted POST shapes:

```json
{ "messages": [{ "role": "user", "content": "run the tests" }] }
```

```json
{ "text": "run the tests" }
```

```json
{ "transcript": "run the tests" }
```

Health and setup helpers:

```text
GET /healthz
GET /v1/models
```

## TTS Providers

Supported providers:

- Supertonic at `http://127.0.0.1:7788`
- ElevenLabs via `ELEVENLABS_API_KEY` in `~/.codex/voice/voice_env`

Secrets belong in `voice_env`, not `settings.json`.

## Development

Run tests:

```bash
npm test
```

Validate the plugin:

```bash
python3 /Users/rewi/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py /path/to/codex-voice
```
