---
name: voice
description: Use when operating the Codex Voice plugin side-channel, including /voice on, /voice off, STT listener endpoints, and concise spoken project commentary.
---

# Codex Voice Side-Channel

Codex Voice adds concise spoken summaries beside the main thread and a separate local endpoint for adjacent side-channel input. The thread remains the shared workspace for code, diffs, logs, and technical details. The voice channel is for quick conversational flow: what happened, what needs a decision, and short answers that are useful to hear.

## Operating Rules

- Keep spoken output short and action-oriented.
- Do not read long code blocks, logs, diffs, or stack traces aloud.
- Put durable technical details in the thread.
- Use voice for state changes, blockers, short questions, and confirmation.
- Never speak or print secrets.
- Treat normal main-thread user messages as the primary command path.
- When voice is active, call `codex_voice_say` after substantive main-thread replies with a concise spoken summary.
- Treat the external STT endpoint as an intentional adjacent side-channel source, not the main command path and not an ambient microphone.
- Do not inject endpoint messages into the main thread or steer an active turn.

## Activation

When the user runs `/voice on`, use the plugin MCP tool to start or reuse the current thread's voice session. The first visible line in the thread must be the listener endpoint.

After `/voice on`, for each normal main-thread message the user sends, continue answering in the thread as usual and also call `codex_voice_say` with a short spoken summary. Use one or two sentences. If the response contains code, logs, diffs, or detailed commands, speak only the high-level result and next action.

When the user runs `/voice off`, stop only the current thread's voice session.

When the user runs `/voice status`, report the current thread's voice state without changing it.
