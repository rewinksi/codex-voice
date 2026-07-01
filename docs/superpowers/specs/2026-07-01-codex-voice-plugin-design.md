# Codex Voice Plugin Design

## Goal

Build a distributable Codex plugin that adds a native `/voice` command to any Codex thread. When enabled, it creates concise spoken summaries for normal main-thread work and a separate per-thread side-channel endpoint for adjacent STT input. External STT posts to the endpoint must not start, steer, or interrupt the main Codex thread.

## Scope

This is a full plugin, not a standalone skill. The plugin packages native slash-command files, a voice operating skill, an MCP server for `/voice` tools, local listener scripts, settings/secrets handling, tests, and marketplace-ready metadata.

The plugin is local-first. It does not capture microphone audio itself. The user's primary PTT path may inject text directly into the main Codex composer. The displayed listener endpoint is reserved for adjacent side-channel questions or notes that should not interrupt the work happening in the main thread.

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

While voice is active, Codex should answer normal main-thread user messages in the thread as usual and call `codex_voice_say` with a short spoken summary after substantive replies. Spoken summaries must avoid code, logs, diffs, long command output, and secrets.

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
- ElevenLabs offers streaming TTS options. A future latency-focused implementation should prefer streaming playback for ElevenLabs instead of waiting for full audio before starting local playback.

## STT Listener Contract

Each active voice session starts a local HTTP listener. The primary endpoint is OpenAI-compatible:

```text
POST /v1/chat/completions
```

Accepted payload shapes:

- OpenAI chat completions style: `{ "messages": [{ "role": "user", "content": "..." }] }`
- Direct transcription style: `{ "text": "..." }`
- Transcript style: `{ "transcript": "..." }`

The listener extracts the user's text, rejects empty input, records the message to the local side-channel inbox, and returns an OpenAI-compatible acknowledgement. It must not forward endpoint text into the main Codex thread.

The listener also exposes:

```text
GET /healthz
GET /v1/models
```

These endpoints support external STT client setup and simple health checks.

## Side-Channel Handling

The listener must bind side-channel messages to the exact thread that ran `/voice on`, but it must not inject those messages into the main thread.

Side-channel path:

- The `/voice` MCP tool resolves and stores the current thread id at activation.
- Incoming endpoint STT is appended to `~/.codex/voice/side-channel.jsonl` with timestamp, route, thread id, thread name, port, and text.
- The HTTP response acknowledges receipt with `"Side-channel message received."`.

Main-thread path:

- Normal main-thread messages are handled by Codex normally.
- While voice is active, Codex calls `codex_voice_say` to speak a concise summary of the main-thread reply.

Implementation must prove that endpoint STT does not call `turn/start`, `turn/steer`, or any Codex app-server injection path.

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
- Listener records endpoint payloads as side-channel messages without main-thread injection.
- Listener health endpoints work.
- `codex_voice_say` speaks summaries only for active voice sessions.
- `/voice off` stops the listener and releases the active session.
