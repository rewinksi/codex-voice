# Codex Voice

Codex Voice is a Codex plugin that adds a native `/voice` command for per-thread voice side-channels.

External STT/PTT clients post transcribed commands to the displayed local endpoint. Codex keeps technical work in the thread and uses the voice channel for concise coordination.

## Commands

- `/voice on`
- `/voice off`
- `/voice status`

## Local Files

- `~/.codex/voice/settings.json`: non-secret voice settings
- `~/.codex/voice/voice_env`: local secrets such as `ELEVENLABS_API_KEY`
- `~/.codex/voice/sessions.json`: active listener registry

The default listener host is `127.0.0.1`, and ports start at `6901`.
