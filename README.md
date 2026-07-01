# Codex Voice

Codex Voice is a Codex plugin that adds a native `/voice` command for per-thread voice side-channels. Pair it with OpenScreech for a versatile, customizable STT utility and Supertonic for local TTS; ElevenLabs is supported as a hosted TTS alternative.

External STT/PTT clients post transcribed commands to the displayed local endpoint. Codex keeps technical work in the thread and uses the voice channel for concise coordination.

## Status

This repository contains the plugin scaffold, native `/voice` command, MCP lifecycle tools, per-thread port allocation, settings/secrets handling, TTS provider resolution, local STT listener, Codex app-server bridge client, and Git marketplace metadata for distribution.

The installed plugin path has been smoke-tested locally: `/voice on` starts a listener, speaks the online announcement through Supertonic when available, accepts OpenAI-compatible STT POSTs, and bridges received text into a Codex thread. The Codex app-server bridge lives in `scripts/lib/codex-bridge.mjs`; it initializes `codex app-server`, resumes the bound thread, and uses `turn/start` or `turn/steer` depending on thread state. If the app-server bridge is unavailable, STT posts return `503` with `codex_bridge_unavailable` instead of silently dropping commands.

## Install

Install directly from GitHub:

```bash
codex plugin marketplace add https://github.com/rewinksi/codex-voice
codex plugin add codex-voice@codex-voice
```

For local development from a checkout:

```bash
codex plugin marketplace add /path/to/Codex-Voice
codex plugin add codex-voice@codex-voice
```

Start a new Codex thread after installing or reinstalling so the `/voice` command, skill, and MCP tools are loaded into that thread.

## Commands

- `/voice on`
- `/voice off`
- `/voice status`

`/voice on` must print the listener endpoint as the first visible line. Configure your push-to-talk STT client to send OpenAI-compatible chat completion requests to that endpoint.

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

- Supertonic at `http://127.0.0.1:7788` for local TTS
- ElevenLabs via `ELEVENLABS_API_KEY` in `~/.codex/voice/voice_env` as a hosted TTS alternative

For STT, this plugin expects an external push-to-talk client. OpenScreech is a good pairing when you want a versatile and customizable local STT utility that can target the displayed listener endpoint.

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
