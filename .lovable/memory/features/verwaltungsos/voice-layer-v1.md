---
name: VerwaltungsOS Voice-Layer Foundation
description: Cut B1 — Persona→Voice-Mapping (9 Personas + default), Voice-Mode/Quality-Gate-Felder auf verwaltung_oral_sessions, Edge Functions verwaltung-voice-tts/-stt (ElevenLabs Turbo/Scribe v2). BRIDGE_DONT_FORK von conversation-os-tts/-stt-Patterns.
type: feature
---

# VerwaltungsOS Voice-Layer — FROZEN 2026-05-28 (Cut B1)

## SSOT
- `verwaltung_oral_sessions.voice_mode` (bool, default false) — User-Toggle pro Session.
- `verwaltung_oral_sessions.voice_quality_gate_fails` (int, default 0) — Counter, reset bei substantieller Antwort.
- `public.verwaltung_persona_voice_id(_persona text) → text` IMMUTABLE — deterministisches Mapping 9 Personas + Default Brian.

## Persona-Voice-Map (ElevenLabs)
| Persona | Voice | ID |
|---|---|---|
| buerger_neutral | Brian | nPczCjzI2devNBz1zQrb |
| buerger_aufgebracht | Chris | iP95p4xoKVk53GoZ742B |
| buerger_unsicher | Matilda | XrExE9yKIg1WjnnlVkGX |
| buerger_juristisch | George | JBFqnCBsd6RMkjVDRZzb |
| antragsteller_familie | Jessica | cgSgspJ2msm6clMCkdW9 |
| antragsteller_unternehmer | Will | bIHbv24MWmeRgasZH58o |
| vorgesetzte_dezernent | Daniel | onwK4e9ZLuTAKqWW03F9 |
| kollege_kollegial | Liam | TX3LPaxmHKxFdv7VOQHJ |
| presse_kritisch | Eric | cjVigY5qzO86Huf0OWal |

Override via `scenario_snapshot.voice_id` möglich.

## Edge Functions
- `verwaltung-voice-tts` — Auth-gated, body `{session_id?, text, voice_id?}`. Resolved voice via persona→Mapping; tuned stability/style nach escalation_state≥3 oder conflict_level=high (0.3/0.7) bzw. ≥2 (0.4/0.55). Streamt audio/mpeg (Turbo v2.5). Header `x-vos-voice-id`, `x-vos-persona`. Audit `verwaltung_voice_tts_request`.
- `verwaltung-voice-stt` — Auth-gated, audio/* body, `?session_id=<uuid>`. <1000 Bytes → `audio_too_short` + quality_gate_fail Audit. Cap 25 MB. ElevenLabs Scribe v2 (deu). Audit `verwaltung_voice_stt_request`.

## Audit-Contracts (ops_audit_contract, owner=verwaltungsos.voice)
- `verwaltung_voice_tts_request` — keys: session_id, persona, voice_id, text_length, caller_role
- `verwaltung_voice_stt_request` — keys: session_id, audio_bytes, transcript_length, caller_role
- `verwaltung_voice_quality_gate_fail` — keys: session_id, reason, fails_total, caller_role

## Secrets-Requirement
`ELEVENLABS_API_KEY` als Edge-Secret (bereits 2026-05-26 für ConversationOS gesetzt). Ohne Key → `503 voice_not_configured` — Text-Modus bleibt funktional.

## Anti-Drift (NICHT in Cut B1)
- Kein eigener Full-Duplex/WebRTC-Pfad — Push-to-Talk reicht.
- Kein Voice-Interrupt während TTS-Playback.
- Keine UI-Integration in Run-Page (separater Cut B1b — Run-Page hat noch keine VerwaltungsOS-Oral-UI gemerged).
- Keine Quality-Gate-Penalty auf Session-State (verwaltung_oral_sessions hat keine trust/tension-Spalten — anders als conversation_os_sessions). Nur Audit-Trail in Cut B1.

## Smoke
`scripts/verwaltung-voice-b1-smoke.mjs` — Persona-Mapping (10 Cases), Spalten-Existenz, 3 Audit-Contracts, Edge-Function Auth-Gate.

## Bridge
Voll spiegelnde Patterns aus `conversation-os-tts/-stt`. ConversationOS bleibt für HR-Szenarien, VerwaltungsOS hat eigene Domain-Funktionen (Persona→Voice via SQL-Function statt character_brief.voice_id). Kein Fork des Engine-Pfads.

## Cut B1b — UI-Integration (2026-05-28)

`VerwaltungOralRunner` (`/branchen/verwaltung/oral/:departmentKey/:oralCaseKey`):
- Voice-Toggle (Switch) im Header — Persist nur Session-lokal.
- Push-to-Talk-Button ersetzt Textarea wenn voiceMode aktiv (mousedown/touchstart → start, mouseup/mouseleave/touchend → stop).
- TTS-Auto-Playback nach jeder Persona-Reaktion via `verwaltung-voice-tts` (session_id+text; voice_id wird serverseitig aus `verwaltung_oral_sessions.persona` resolved).
- STT via `verwaltung-voice-stt?session_id=<uuid>` (audio/webm; opus). Quality-Gate-Fail → Toast + bleibt im Voice-Modus.
- 503 `voice_not_configured` → automatisches Fallback in Text-Modus + Toast.
- BRIDGE_DONT_FORK: spiegelt `ConversationOSRunPage` Patterns (MediaRecorder, blob→fetch, audio.play).

Anti-Drift weiterhin gültig: kein WebRTC/Full-Duplex, kein Interrupt während TTS, kein State-Schreiben auf Quality-Gate.
