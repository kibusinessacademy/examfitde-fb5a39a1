---
name: VibeOS Voice Agent v1 (Verwaltungs-Oral)
description: Voice-Stack für Verwaltungs-Oral-Sim — komplett ohne ElevenLabs. B1 (Server STT/TTS), B2 (Browser Web Speech API), B3 (generischer HMAC-Webhook).
type: feature
---

# VibeOS Voice Agent v1 — Verwaltungs-Oral

**Verworfen 2026-05-28: ElevenLabs Convai / @elevenlabs/react.** Kein externer Realtime-Provider, kein Convai-Agent, keine WebRTC-Provider-Session. Begründung: Provider-Lock-in vermeiden, Voice-Stack vollständig im eigenen Stack (Browser + Lovable AI Gateway + eigener HMAC-Webhook).

## Modi (mutually exclusive)

| Mode | STT | LLM | TTS | Trigger |
|------|-----|-----|-----|---------|
| **Text** | — | `verwaltung-oral-bridge` (Lovable AI Gateway) | — | Textarea + Senden |
| **Voice (Server)** B1b | Edge `verwaltung-voice-stt` | Bridge | Edge `verwaltung-voice-tts` | Push-to-Talk |
| **VibeOS Voice Agent** B2 | Browser `SpeechRecognition` (de-DE) | Bridge | Browser `SpeechSynthesisUtterance` (de-DE Voice) | Start/Stop, kontinuierlicher Loop |

UI-Toggles in `src/pages/verwaltung/VerwaltungOralRunner.tsx` (Header). Switches gegenseitig deaktiviert. VibeOS-Toggle disabled wenn Browser kein Web Speech API hat (Hinweis "nicht verfügbar" — Safari kann fehlen).

## VibeOS Voice Agent Loop (B2)

1. `startAgent()` → primt Mic-Permission, spricht letzte Persona-Utterance, dann `startAgentListening()`.
2. `SpeechRecognition` (continuous=false, single utterance) → `onresult` → `handleSend(transcript)`.
3. `handleSend` postet an `verwaltung-oral-bridge` → `agentSpeak(data.persona_utterance)` → nach `onend` re-arm `startAgentListening()`.
4. `stopAgent()` setzt `agentLiveRef=false`, cancelt SpeechSynthesis, stoppt Recognition.

Refs: `agentLiveRef` (sync mirror für event handlers), `ttsVoiceRef` (de-Voice ausgewählt einmalig bei `voiceschanged`).

## B3 — VibeOS Webhook (post-session)

- Edge: `supabase/functions/verwaltung-realtime-webhook` (Name beibehalten für DB-Audit-Kompatibilität, intern komplett provider-neutral).
- Auth: HMAC-SHA256 + Secret `VIBEOS_WEBHOOK_SECRET`. Header `vibeos-signature: t=<unix>,v0=<hex>`. 30-min Toleranzfenster.
- `verify_jwt=false` in `supabase/config.toml`.
- Payload (generisch):
  ```json
  {
    "session_id": "<uuid>",
    "external_id": "<optional trace>",
    "transcript": [{ "role": "user|persona|agent", "content": "…" }],
    "metadata": { }
  }
  ```
- Findet Bridge-Session per `session_id` direkt (kein Convai-Lookup mehr).
- Generiert Debrief via Lovable AI Gateway (`google/gemini-3-flash-preview`, `response_format: json_object`), wichtet 6 Dimensionen per Cluster.
- Persistiert via `verwaltung_finalize_realtime_session` (SECURITY DEFINER, service_role only, idempotent).
- Audit-Contracts unverändert: `verwaltung_realtime_webhook_received` (outcomes: accepted/signature_invalid/parse_error), `verwaltung_realtime_debrief_generated`.

## Trigger-Optionen für B3

- Manueller cURL (eigenes Script signiert + postet)
- n8n / eigener Cron mit HMAC-Generator
- Optional: Browser-Trigger nach `stopAgent` (TODO — Browser dürfte VIBEOS_WEBHOOK_SECRET nicht halten; stattdessen `verwaltung-oral-bridge action=debrief` aus UI nutzen, was bereits live ist)

## Anti-Drift

- **Nicht** `@elevenlabs/react` o.ä. wieder einführen.
- **Nicht** Convai-Agent-Provisionierung wieder bauen.
- **Nicht** B2/B3-Scores auf Turn-Ebene mischen (Turn-Ebene = Bridge; Debrief = Bridge oder Webhook).
- **Nicht** Browser-seitig den Webhook-Secret verwenden.
- Mixed-Mode (Voice + Agent gleichzeitig) verboten — Toggles mutually disabled.

## Entfernt 2026-05-28

- `supabase/functions/verwaltung-realtime-token` (Convai-Agent-Provisioning).
- npm dep `@elevenlabs/react`.
- Secrets `ELEVENLABS_*` werden vom Webhook nicht mehr gelesen.
