# Codex Voice Plugin Design

## Goal

Build a distributable Codex plugin that adds a native `/voice` command to any Codex thread. When enabled, it creates a per-thread voice side-channel: external STT posts text to a local OpenAI-compatible endpoint, Codex receives those commands in the bound thread, and Codex can answer concisely over a configured TTS provider while leaving technical work in the thread.

## Scope

This is a full plugin, not a standalone skill. The plugin packages native slash-command files, a voice operating skill, an MCP server for `/voice` tools, local listener scripts, settings/secrets handling, tests, and marketplace-ready metadata.

The plugin is local-first. It does not capture microphone audio itself. The user intentionally wires an external STT/PTT provider to the displayed listener endpoint for the intended thread.

## Native Command Behavior

The plugin exposes `/voice` through `commands/voice.md`.

Supported subcommands:

- `/voice on`: create or reuse the thread voice session.
- `/voice off`: stop the current thread voice session.
- `/voice status`: show the current listener, provider, and session state.

On `/voice on`, the first visible line in the thread must be:

```text
Voice listener endpoint: http://127.0.0.1:<port>/v1/chat/completions
```

After the endpoint is visible, Codex may print concise setup status and speak:

```text
Voice online for <thread name>
```

## Port And Session Model

Voice sessions bind one listener per active thread. Ports start at `6901` and are allocated in priority order. If thread A gets `6901`, thread B gets `6902`, and thread C gets `6903`. If a thread reactivates while its previous port is still free, it reuses that port. This keeps the user's PTT buttons stable and intentional.

Session state is stored under the Codex home directory:

```text
~/.codex/voice/settings.json
~/.codex/voice/voice_env
~/.codex/voice/sessions.json
~/.codex/voice/logs/
```

`settings.json` stores non-secret settings. `voice_env` stores secrets such as `ELEVENLABS_API_KEY` and must be written with user-only permissions.

## Settings

If `settings.json` does not exist, `/voice on` creates it with safe defaults:

```json
{
  "version": 1,
  "host": "127.0.0.1",
  "portBase": 6901,
  "maxSessions": 16,
  "stt": {
    "openAiCompatiblePath": "/v1/chat/completions"
  },
  "tts": {
    "provider": "supertonic",
    "speakOnOnline": true,
    "supertonic": {
      "baseUrl": "http://127.0.0.1:7788",
      "path": "/v1/tts",
      "voice": "F4F2Dynamic01",
      "speed": 1.2,
      "responseFormat": "wav"
    },
    "elevenlabs": {
      "baseUrl": "https://api.elevenlabs.io",
      "voiceName": "",
      "model": "eleven_flash_v2_5",
      "responseFormat": "mp3_44100_128"
    }
  }
}
```

The defaults are intentionally compatible with the existing local Supertonic proxy convention on this machine, while remaining editable for other users.

## TTS Provider Behavior

Supported providers:

- `supertonic`
- `elevenlabs`

Provider selection comes from `settings.json`. If unset or invalid, the plugin prefers Supertonic when reachable, then prompts for ElevenLabs setup. OpenScreech is the recommended companion STT utility for users who want a versatile, customizable push-to-talk transcription client.

Supertonic setup:

- Check `settings.json` for `tts.supertonic`.
- Probe the configured base URL.
- If missing, try the known local default `http://127.0.0.1:7788`.
- Persist discovered non-secret details back into `settings.json`.

ElevenLabs setup:

- Read `tts.elevenlabs.voiceName` from `settings.json`.
- Read `ELEVENLABS_API_KEY` from `voice_env` or the process environment.
- If either is missing, `/voice on` reports exactly which fields are missing and asks the user for the voice name and key.
- The key is saved only in `voice_env`, never in `settings.json`, logs, or thread text.
- Speaking resolves the configured voice name through ElevenLabs voices, then calls the text-to-speech endpoint with the configured model and output format.

## STT Listener Contract

Each active voice session starts a local HTTP listener. The primary endpoint is OpenAI-compatible:

```text
POST /v1/chat/completions
```

Accepted payload shapes:

- OpenAI chat completions style: `{ "messages": [{ "role": "user", "content": "..." }] }`
- Direct transcription style: `{ "text": "..." }`
- Transcript style: `{ "transcript": "..." }`

The listener extracts the user's text, rejects empty input, and forwards the command to the bound Codex thread.

The listener also exposes:

```text
GET /healthz
GET /v1/models
```

These endpoints support external STT client setup and simple health checks.

## Codex Thread Injection

The listener must deliver STT text to the exact thread that ran `/voice on`.

Preferred path:

- The `/voice` MCP tool resolves and stores the current thread id at activation.
- Incoming STT uses Codex app-server APIs to send `turn/start` when the thread is idle or `turn/steer` when the active turn is steerable.

Fallback path:

- If app-server transport is unavailable, the plugin stores the received command in the session inbox and returns a clear `503` explaining that the Codex bridge is not connected.
- The session state remains visible through `/voice status`.

Implementation must prove thread injection with a small smoke test before claiming end-to-end voice control.

## Security

The listener binds to `127.0.0.1` by default. Non-loopback binding is out of V1 scope.

The listener accepts an optional bearer token configured in settings. If a token is configured, requests without `Authorization: Bearer <token>` are rejected.

Secrets are never printed. `voice_env` is created with mode `0600`, and `~/.codex/voice` is created with mode `0700`.

## Packaging And Distribution

The repository root is the plugin root. It contains:

```text
.codex-plugin/plugin.json
.mcp.json
commands/voice.md
skills/voice/SKILL.md
scripts/
tests/
docs/
```

The repo should be public on GitHub when complete. The plugin should be installable through a Git-backed marketplace or local marketplace entry.

## Verification

Minimum verification before completion:

- Plugin manifest validates.
- Unit tests pass.
- `/voice on` creates settings and session files.
- Port allocation starts at `6901` and increments with concurrent sessions.
- Missing ElevenLabs secrets are detected without leaking values.
- Supertonic discovery persists non-secret settings.
- Listener accepts OpenAI-compatible STT payloads.
- Listener health endpoints work.
- `/voice off` stops the listener and releases the active session.
- Thread injection proof is run or reported as blocked with exact evidence.
