# Archi — Personal AI Voice Assistant (PRD)

## Original Problem Statement
Adapt github.com/jaredrhod/fullstack-agent (a local Claude Code stack giving an AI "memory, voice, face, and hands") into a web app. Name the assistant **Archi**, give it a **female voice**, and have it **call the user "daddy"**.

## User Choices
- LLM brain: **Claude Sonnet 5** (direct Anthropic API)
- Voice: **Browser Web Speech API** (female TTS + speech-to-text listening)
- Face: **Switchable** glowing orb + living circuit board
- **Persistent memory** across sessions: yes
- Both **voice + typed chat**

## Architecture
- **Backend**: FastAPI + MongoDB (motor). Streaming chat via the official `anthropic` Python SDK (claude-sonnet-5) over SSE. Async background memory extraction.
- **Frontend**: React 19 + framer-motion + lucide-react. CSS/SVG-driven sci-fi HUD visualizer (no heavy 3D deps). Web Speech API hook for voice.
- Session id auto-generated per browser (localStorage), enabling persistent memory.

## Core Requirements (static)
- Jarvis-style immersive HUD, dark neon aesthetic.
- Archi persona: warm, witty female assistant that always addresses user as "Bro".
- Reactive central "face" with idle/listening/thinking/speaking states, orb + circuit modes.
- Persistent, auto-learned memory vault + manual memory add/delete.

## Implemented (2026-08-24)
- Session init with spoken greeting: "Hello Bro. Archi is online..."
- Token-by-token streaming Claude chat with personality (calls user "Bro").
- Auto memory extraction to MongoDB after each turn; Memory Vault panel with manual add/delete.
- Dual switchable visualizer (glowing orb + circuit-board chip labeled ARCHI) with state-reactive colors + mic-level meter.
- Browser female TTS speaks replies; push-to-talk STT; mute toggle; reset conversation.
- Input validation (empty/oversized), background-task references, mobile layout + contrast fixes.
- Verified: 15/15 backend pytest, all testable frontend E2E flows.

## Backlog / Remaining
- P2: AbortController + stop button for hung streams.
- P2: MongoDB index on {session_id, timestamp} + pagination as history grows.
- P2: 404 on delete of non-existent memory id (cosmetic).
- P2: Premium voice option (ElevenLabs/OpenAI TTS) if higher quality desired.

## Notes
- Voice (Web Speech API) is browser-only; not assertable in headless testing but works in real browsers (Chrome recommended). No mocked APIs.
