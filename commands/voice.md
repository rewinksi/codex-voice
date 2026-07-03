---
description: Start, stop, or inspect a per-thread Codex voice side-channel.
---

# Voice

Use this command for `/voice on`, `/voice off`, `/voice status`, `/voice mute`, `/voice unmute`, and `/voice setup`.

## Preflight

1. Parse the subcommand from the user's command text. Default to `status` when no subcommand is provided.
2. Treat secrets as sensitive. Never print API keys or env-file contents.
3. Prefer the current thread id and title if Codex exposes them. If not, pass the current working directory so the tool can resolve the newest matching thread from Codex state.

## Commands

### `/voice on`

1. Call the `codex_voice_on` MCP tool.
2. The first visible line in the thread must be exactly:

```text
Voice listener endpoint: <endpoint>
```

3. After that line, summarize readiness in one or two short lines.
4. If setup needs ElevenLabs details, ask for the missing fields only. Ask for the API key to be provided as a local secret; do not ask the user to paste it into ordinary prose unless the tool explicitly supports secret capture.
5. While voice is active, after milestone-level normal main-thread replies, call `codex_voice_say` with a short spoken summary. Do not speak routine progress chatter, code, logs, secrets, or long technical detail.

The displayed endpoint is for adjacent side-channel input only. Do not route endpoint text into `turn/start` or `turn/steer`, and do not treat it as the user's primary main-thread command path.

### `/voice off`

1. Call the `codex_voice_off` MCP tool.
2. Confirm the listener stopped and include the released port.

### `/voice status`

1. Call the `codex_voice_status` MCP tool.
2. Report the endpoint, active provider, thread binding, mute state, and any missing setup.

### `/voice mute`

1. Call the `codex_voice_mute` MCP tool with `muted: true`.
2. Confirm voice is muted for this thread. Do not stop the listener.

### `/voice unmute`

1. Call the `codex_voice_mute` MCP tool with `muted: false`.
2. Confirm voice is unmuted for this thread.

### `/voice setup`

1. Call the `codex_voice_setup` MCP tool.
2. Show the returned setup panel. This is a thread-local voice setup, not a global default editor.
3. If the user specifies a provider or voice, pass the relevant fields:
   - ElevenLabs: `provider: "elevenlabs"`, plus `voiceName` and optionally `voiceId` or `model`.
   - Supertonic: `provider: "supertonic"` plus `supertonicVoice`.
4. If ElevenLabs setup needs an API key, ask for it as a local secret for `~/.codex/voice/voice_env`; never print existing secret values.

### Spoken summaries

When the current thread has an active voice session, call `codex_voice_say` only for milestone-level replies: completion, failed/blocked state, tests passing/failing, install/restart/deploy success, or something that needs the user's attention. Do not narrate every progress note. Keep the thread as the durable technical record and keep the spoken output brief.

## Verification

For `/voice on`, confirm the endpoint is displayed before any other status text. For `/voice off`, confirm the session is no longer active.
