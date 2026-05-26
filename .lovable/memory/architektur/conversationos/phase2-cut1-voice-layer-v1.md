---
name: ConversationOS Phase 2 Cut 1 — Voice Layer (HR InterviewOS Pilot)
description: Push-to-Talk Voice via ElevenLabs Scribe+Turbo, Quality-Gate, Silence-Press, State-tuned voice. Nur HR InterviewOS.
type: feature
---

# Phase 2 Cut 1 — Voice-native HR Simulation (2026-05-26)

## Live-Stand
Cut 1 vollständig deployed: STT, TTS, Quality-Gate, Push-to-Talk UI, Silence-Timer, State-tuned voice (stability/style nach tension/trust). 21/21 HR-Szenarien mit Voice-ID belegt (gender+role-matched).

## SSOT-Erweiterungen
- `conversation_os_scenarios.character_brief.voice_id` — ElevenLabs voice id pro Charakter.
- `conversation_os_sessions.voice_mode` (bool) — User-Toggle, persistiert.
- `conversation_os_sessions.quality_gate_fails` (int) — Counter, reset auf 0 nach substantieller Antwort, abort bei 3.

## Edge Functions
- `conversation-os-stt` — Auth-gated, akzeptiert audio/webm Body, ruft ElevenLabs `scribe_v2` (deu), liefert `{transcript, language, duration_ms}`. <1000 Bytes → `audio_too_short`. Cap 25 MB.
- `conversation-os-tts` — Auth-gated, body `{session_id, text, voice_id?}`. Resolved voice_id aus character_brief, tuned stability/style aus session.conversation_state (tension>0.7 oder trust<0.3 → stability 0.3/style 0.7). Streamt `audio/mpeg` (Turbo v2.5).
- `conversation-os-turn` — Quality-Gate (`runInputQualityGate`) läuft VOR Painpoint/LLM:
  - `silence` (empty), `gibberish` (single token no vowels, oder vowel-ratio<15%), `too_short` (<2 Wörter <6 Chars)
  - Penalty: trust −0.15, tension +0.2, confidence −0.05, rapport −0.1
  - Charakter-Refusal als synthetischer SSE-Stream (`model_used='quality_gate'`)
  - 3 Fails in Folge → `status='aborted_by_character'`, finished_at gesetzt, Header `x-conv-aborted: 1`
  - Reset `quality_gate_fails=0` auf jeden substantiellen Turn
- Header für Client: `x-conv-painpoint`, `x-conv-state`, `x-conv-voice-id`, `x-conv-aborted`, `x-conv-quality-gate`.

## UI (`ConversationOSRunPage`)
- Voice-Mode Toggle im Header (Switch).
- Push-to-Talk Button (mouse/touch hold), MediaRecorder webm/opus.
- TTS-Playback nach Stream-Complete; pulsierender "Charakter spricht…" Badge.
- Silence-Press-Timer (8s nach Charakter-Turn) → Toast "Der Charakter wartet…".
- Quality-Gate Toast bei Refusal (`silence`/`gibberish`/`too_short`).
- Aborted-Card mit Hinweis auf Debrief.

## Voice-ID Backfill (21 HR-Szenarien, 2026-05-26)
Female: Sarah (EXAVI…), Laura (FGY2W…), Alice (Xb7hH…), Matilda (XrExE…), Jessica (cgSgs…), Lily (pFZP5…).
Male: Brian (nPczC…), George (JBFqn…), Liam (TX3LP…), Will (bIHbv…), Eric (cjVigY…), Chris (iP95p…), Daniel (onwK4…), Bill (pqHfZ…).
Default Fallback Brian (`nPczCjzI2devNBz1zQrb`).

## NICHT in Cut 1 (Anti-Drift)
- Kein Full-Duplex / WebRTC Conversational-Agent (würde Painpoint-Engine umgehen).
- Kein eigener Examiner-Score parallel zur Rubric.
- Keine Interruption während TTS-Playback.
- Keine weiteren Verticals voice-aktiviert (ExamFit Oral hat eigene Pipeline, nicht Voice).
- Keine Timer-UI / Zeitbudget pro Turn.

## Secrets-Requirement
`ELEVENLABS_API_KEY` als Edge Secret gesetzt 2026-05-26. Ohne Key liefert STT/TTS `503 voice_not_configured` — Text-Modus bleibt funktional.

## Akzeptanzkriterien (Pilot HR InterviewOS) — alle erfüllt
1. ✅ Push-to-Talk → STT → Charakter antwortet per Stimme.
2. ✅ Gibberish ("fghjo") → Charakter-Refusal + Trust-Drop, kein freundlicher Weiter-Chat.
3. ✅ 3 Fails → `aborted_by_character`, Critical Moment im Debrief.
4. ✅ 8s Schweigen → Toast-Druck.
5. ✅ Voice-Toggle, Text-Modus als Fallback erhalten.
