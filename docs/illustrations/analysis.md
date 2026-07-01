# Codex Voice README Illustration Analysis

## Source
- Article: `README.md`
- Product: Codex Voice GitHub summary page

## Content type
- Technical product overview
- Installation/tutorial-adjacent
- Plugin feature showcase

## Purpose
- Make the GitHub summary section immediately legible and visually distinctive
- Show how the plugin fits between Codex, side-channel STT, and spoken output
- Reinforce the three headline capabilities without forcing readers through a wall of text

## Core arguments
1. Codex Voice adds a native `/voice` command to Codex.
2. Main-thread work stays in the thread while concise spoken summaries are read aloud.
3. External push-to-talk STT can post adjacent side-channel requests without interrupting the active thread.
4. The plugin supports local-first TTS via Supertonic and hosted TTS via ElevenLabs.
5. The listener endpoint, per-thread sessions, and latest-only speech behavior are central differentiators.

## Illustration positions
1. **Hero heading** — directly under `# Codex Voice` to establish product identity and explain the core loop at a glance.
2. **Inline feature trio** — immediately after the opening summary paragraph to break the feature set into scannable visual chunks.
3. **Optional comparison framing inside the hero** — communicate “main thread stays focused / side channel stays adjacent” without literal metaphor clutter.

## Recommended settings
- Preset: `warm-knowledge`
- Type mix: `framework` hero + `infographic` inline cards
- Style: `vector-illustration`
- Palette: `warm`
- Language: English

## Constraints
- GitHub README-safe: SVG assets with relative links only.
- Keep text in graphics large and sparse.
- Use article-specific labels: `/voice`, `127.0.0.1:6901`, `OpenScreech`, `Supertonic`, `ElevenLabs`, `latest-only speech`, `side-channel`.
- Avoid visual noise; this is a repo landing page, not a Vegas slot machine pretending to be documentation.
