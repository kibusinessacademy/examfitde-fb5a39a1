---
name: AI Gateway SSOT Routing v1
description: callAI() routes provider=openai|google through Lovable AI Gateway with auto-prefixed model IDs; closes ai_gateway_bypass cluster
type: feature
---

# AI Gateway SSOT Routing v1 (2026-05-21)

## Problem
`fail_cluster=ai_gateway_bypass` (24h count active) — Mix aus:
- `AI openai error 400: invalid model ID` (callAI mit provider=openai schickt Gateway-Modell `gpt-5.4-mini` an api.openai.com → 400)
- `GOOGLE_AI_API_KEY not configured` (callAI mit provider=google fällt auf Direct-Call zurück, Key nicht gesetzt)

Quelle: `llm_provider_routing_policies.provider_chain` enthält `provider=openai`/`google` mit Gateway-only Modellnamen. `_shared/ai-client.ts` dispatcht direkt an api.openai.com / generativelanguage.googleapis.com.

## Fix (SSOT)
`supabase/functions/_shared/ai-client.ts` → `callAI`:
- `LOVABLE_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions"`
- Wenn `LOVABLE_API_KEY` gesetzt **und** `provider ∈ {openai, google}` → Route über Gateway, Auth via `LOVABLE_API_KEY`.
- `ensureGatewayModel(provider, model)` prefixt unprefixierte Modelle (`gpt-5.4-mini` → `openai/gpt-5.4-mini`, `gemini-2.5-flash` → `google/gemini-2.5-flash`).
- Anthropic bleibt direkt (separate API-Form, separater Key).
- Console-Log `[AI-CLIENT] Gateway route: ... → ... (auto-prefixed)` für Forensik.

## Migrierte Direkt-Caller
- `generate-seo-slug/index.ts` (war `gpt-5.2` direct → `openai/gpt-5.2` via Gateway)
- `curriculum-import/index.ts` (war `gpt-5.2` direct → `openai/gpt-5.2` via Gateway)

## Guard-Härtung
`scripts/guards/no-direct-llm-fetch-guard.mjs` Phase-1-Patterns erweitert:
- `api.openai.com` (war: nur `/v1/chat`)
- `api.anthropic.com`
- `generativelanguage.googleapis.com` (NEU)

Allowlist unverändert: `_shared/ai-client.ts`, `ai-healthcheck/`, `generate-image/`, `ai-generation-gateway/`.

## Audit
`ops_audit_contract` ergänzt:
- `ai_gateway_route_resolved` (provider, model_in, model_out, target)
- `ai_gateway_bypass_cluster_closed` (cluster_key, prior_24h_count)

## Erwartung 24h
- `fail_cluster=ai_gateway_bypass` count_24h → 0
- Keine neuen `invalid model ID` oder `GOOGLE_AI_API_KEY not configured` in `job_queue.last_error`
- FailClusterDeltaCard zeigt status=green für `ai_gateway_bypass`

## Nicht geändert (bewusst)
- `llm_provider_routing_policies` DB-Einträge — Modellnamen bleiben unprefixiert; Gateway-Routing macht das transparent. Kein DB-Lockstep nötig.
- Anthropic-Pfad — funktioniert direkt, Key vorhanden.
- Phase-2 callAIWithFailover/callAIJSON-Allowlist (separates Cleanup, nicht Teil dieses Cuts).
