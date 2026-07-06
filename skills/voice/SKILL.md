---
name: voice
description: Use when operating the Codex Voice plugin side-channel, including /voice on, /voice off, /voice mute, /voice setup, STT listener endpoints, and concise milestone commentary.
---

# Codex Voice Side-Channel

Codex Voice adds concise spoken summaries beside the main thread and a separate local endpoint for adjacent side-channel input. The thread remains the shared workspace for code, diffs, logs, and technical details. The voice channel is for quick conversational flow: what happened, what needs a decision, and short answers that are useful to hear.

## Operating Rules

- Keep spoken output short, casual, kiwi-flavoured, and action-oriented.
- Do not read long code blocks, logs, diffs, or stack traces aloud.
- Put durable technical details in the thread.
- Use voice for state changes, blockers, short questions, and confirmation. Cheeky kiwi humour and the occasional well-placed swear are fine; long narration is not.
- Never speak or print secrets.
- Treat normal main-thread user messages as the primary command path.
- When voice is active, call `codex_voice_say` only after milestone-level main-thread replies: completed work, failed checks, blockers, installs/restarts, or decisions needing the user's attention.
- Do not speak routine progress updates while work is running.
- Treat the external STT endpoint as an intentional adjacent side-channel source, not the main command path and not an ambient microphone.
- Side-channel acknowledgements should use only a varied configured phrase, not subject keywords or a status sentence.
- Main-thread summaries and side-channel speech must share one speech lane across active threads; never let them talk over each other.
- Do not inject endpoint messages into the main thread or steer an active turn.

## Activation

When the user runs `/voice on`, treat it as an actionable native plugin command. Do not refuse just because the `codex_voice_*` tools are not already visible in the current tool list. A hidden or unloaded tool surface is an activation task, not proof that voice is unavailable.

Activation order:

1. Use the exposed `codex_voice_on` MCP tool if it is already available.
2. If the tool is not visible and tool discovery is available, search for `codex_voice_on`, `codex-voice`, or `/voice`, then call the discovered tool.
3. If discovery is unavailable but this command file is loaded, assume the plugin is installed and try to activate through the configured Codex Voice MCP server before asking the user to reinstall or start a new thread.
4. Only report that voice cannot be activated after checking the actual available tools or plugin installation state.

The first visible line in the thread must be the listener endpoint.

After `/voice on`, continue answering normal main-thread messages in the thread as usual. Call `codex_voice_say` only for milestone summaries. Use one quick sentence when possible. If the response contains code, logs, diffs, or detailed commands, speak only the high-level result and next action.

When the user runs `/voice off`, stop only the current thread's voice session.

When the user runs `/voice status`, report the current thread's voice state without changing it.

When the user runs `/voice mute` or `/voice unmute`, call `codex_voice_mute` for the current thread. Muting must silence spoken output without stopping the listener.

When the user runs `/voice setup`, call `codex_voice_setup`. Show the returned setup panel, and pass thread-local provider or voice choices when the user supplies them.
