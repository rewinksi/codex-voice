---
name: voice
description: Use when operating the Codex Voice plugin side-channel, including /voice on, /voice off, STT listener endpoints, and concise spoken project commentary.
---

# Codex Voice Side-Channel

Codex Voice adds a conversational command channel beside the main thread. The thread remains the shared workspace for code, diffs, logs, and technical details. The voice channel is for concise coordination: what is happening, what needs a decision, and short answers to the user's spoken instructions.

## Operating Rules

- Keep spoken output short and action-oriented.
- Do not read long code blocks, logs, diffs, or stack traces aloud.
- Put durable technical details in the thread.
- Use voice for state changes, blockers, short questions, and confirmation.
- Never speak or print secrets.
- Treat the external STT endpoint as an intentional push-to-talk command source, not an ambient microphone.

## Activation

When the user runs `/voice on`, use the plugin MCP tool to start or reuse the current thread's voice session. The first visible line in the thread must be the listener endpoint.

When the user runs `/voice off`, stop only the current thread's voice session.

When the user runs `/voice status`, report the current thread's voice state without changing it.
