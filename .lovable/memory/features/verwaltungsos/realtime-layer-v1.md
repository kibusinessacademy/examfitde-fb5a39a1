---
name: VerwaltungsOS Realtime-Layer Foundation
description: Cut B2 — Persona→Agent-Mapping (verwaltung_persona_agent_map), Realtime-State-Felder auf verwaltung_oral_sessions, Edge Function verwaltung-realtime-token (ElevenLabs Convai WebRTC), Start/End-RPCs mit Audit. BRIDGE_DONT_FORK von Voice-Layer-Patterns.
type: feature
---

# VerwaltungsOS Realtime-Layer — FROZEN 2026-05-28 (Cut B2)

Foundation für Full-Duplex Persona-Konversationen via ElevenLabs Conversational AI Agents (WebRTC). Anders als Voice-Layer (Push-to-Talk auf bestehender Turn-Engine) ist Realtime ein paralleler Pfad: Agent läuft komplett auf ElevenLabs-Seite, Lovable speichert nur Mapping + Session-State + Audit.

## SSOT
- `verwaltung_persona_agent_map(persona_key UNIQUE, elevenlabs_agent_id, notes, active)` — 9 Personas seeded, agent_id bleibt NULL bis manuell in ElevenLabs-UI provisioniert.
- `verwaltung_oral_sessions.realtime_mode`, `.realtime_convai_session_id`, `.realtime_started_at`, `.realtime_ended_at`.
- `public.verwaltung_resolve_persona_agent(_persona)` STABLE SECURITY DEFINER — returns agent_id or NULL.

## RPCs (SECURITY DEFINER, user-scoped)
- `verwaltung_start_realtime_session(_session_id uuid, _convai_session_id text)` — setzt realtime_mode=true + emit `verwaltung_realtime_session_started`.
- `verwaltung_end_realtime_session(_session_id uuid)` — clear realtime_mode + duration + emit `verwaltung_realtime_session_ended`.

## Edge Function
`verwaltung-realtime-token` — Auth-gated, body `{session_id?, agent_id?}`. Resolved Persona aus Session, fragt `/v1/convai/conversation/token?agent_id=...` ab, schreibt Audit `verwaltung_realtime_token_issued`. Fehlerpfade:
- 401 `auth_required` / `invalid_user`
- 404 `session_not_found`
- 412 `agent_not_provisioned` (Persona-Mapping vorhanden, aber agent_id NULL)
- 502 `elevenlabs_token_failed`
- 503 `voice_not_configured` (Secret fehlt)

## Audit-Contracts (ops_audit_contract, owner=verwaltungsos.realtime)
- `verwaltung_realtime_token_issued` — session_id, persona, agent_id, caller_role
- `verwaltung_realtime_session_started` — session_id, persona, agent_id, convai_session_id, caller_role
- `verwaltung_realtime_session_ended` — session_id, convai_session_id, duration_seconds, caller_role

## Provisioning-Workflow (out-of-band)
Cut B2 stellt die DB- und API-Foundation; konkrete ElevenLabs-Agents werden in der ElevenLabs-Webkonsole pro Persona angelegt (System-Prompt + Voice + Tools + Language=de). Sobald ein Agent existiert: 
```sql
UPDATE public.verwaltung_persona_agent_map
   SET elevenlabs_agent_id = 'agent_xxx'
 WHERE persona_key = 'buerger_neutral';
```
Erst danach gibt der Token-Endpoint ein WebRTC-Token aus.

## Anti-Drift (NICHT in Cut B2)
- Keine UI-Integration (separater Cut B2b — `useConversation`-Hook + Connect/Disconnect-Button in `VerwaltungOralRunner`).
- Keine automatische Agent-Provisionierung über die ElevenLabs-API (manueller Schritt absichtlich — System-Prompts brauchen Review).
- Keine Bridging-Logik Voice→Realtime in derselben Session (Realtime ist Replacement, nicht Add-on; Toggle ist exclusiv).
- Kein Audit auf Turn-Ebene (Convai-Agent betreibt eigenes Logging; nur Session-Start/Ende werden gespiegelt).
- Kein Score-/Debrief-Pfad in B2 (Realtime-Sessions enden ohne Scorecard — kommt in B3 via Convai-Webhook-Bridge).

## Secrets-Requirement
`ELEVENLABS_API_KEY` (bereits gesetzt). Optional: `ELEVENLABS_AGENT_DEFAULT` für Override — derzeit nicht implementiert.

## Smoke
`scripts/verwaltung-realtime-b2-smoke.mjs` — 9 Personas seeded · Resolver NULL-safe · 3 Audit-Contracts · realtime_* Spalten · Edge auth_required/voice_not_configured · State-RPCs anon-blocked.

## Bridge
- Persona-Mapping spiegelt Voice-Layer-Pattern (`verwaltung_persona_voice_id`) — Tabelle statt SQL-Function, weil agent_ids nach Provisioning gepflegt werden müssen.
- Auth-Pattern aus `verwaltung-voice-tts` (Authorization-Header → authClient.getUser() → admin-Client für DB-Writes).
- Audit-Pattern aus B1 (`fn_emit_audit` mit named-params, 3 separate action_types).
