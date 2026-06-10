# VIBEOS_AI_GATEWAY — Rollback Runbook

**Phase 2 Exit:** ersetzt `LOVABLE_API_KEY`-Routing in `_shared/ai-client.ts`
durch eigenen OpenAI-kompatiblen Proxy `vibeos-ai-gateway`.

Wire-Contract identisch (POST `/v1/chat/completions`, OpenAI Body),
Switch erfolgt ENV-basiert. Kein Code-Revert nötig im Rollback.

## Architektur

```
ai-client.ts (callAI)
    │
    ├─ if VIBEOS_AI_GATEWAY_URL set → Proxy (OpenAI/Anthropic/Google direct keys)
    └─ else                          → Lovable AI Gateway (LOVABLE_API_KEY)  [Fallback]
```

## Forward-Cutover (Phase 2)

1. Provisionieren:
   - `VIBEOS_AI_GATEWAY_KEY` (selbst generiert, 32+ bytes)
   - `GOOGLE_AI_API_KEY` (fehlt aktuell, siehe EXIT_SECRET_INVENTORY)
   - `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` (bereits live)
2. Edge `vibeos-ai-gateway` deployen (auto via Lovable Cloud).
3. Smoke-Test:
   ```
   GET  /functions/v1/vibeos-ai-gateway/health
   POST /functions/v1/vibeos-ai-gateway   { model: "openai/gpt-5.4-mini", messages: [...] }
   ```
4. `_shared/ai-client.ts` patchen:
   ```ts
   const GATEWAY_URL = Deno.env.get("VIBEOS_AI_GATEWAY_URL")
     ?? "https://ai.gateway.lovable.dev/v1/chat/completions";
   const GATEWAY_KEY = Deno.env.get("VIBEOS_AI_GATEWAY_KEY")
     ?? Deno.env.get("LOVABLE_API_KEY");
   ```
5. Secret setzen: `VIBEOS_AI_GATEWAY_URL=https://<project>.supabase.co/functions/v1/vibeos-ai-gateway`
6. Canary: 1 Edge Function (z. B. `generate-seo-slug`) — 24h beobachten:
   - `fn_emit_audit` events `vibeos_gateway_route_resolved`
   - `fail_cluster=ai_gateway_bypass` count_24h muss 0 bleiben
7. Cluster-Rollout über alle ~60 Caller automatisch (kein Code-Change pro Funktion).

## Rollback (4 Modi, escalierend)

### R1 — ENV unset (Instant, 0 Downtime)
**Wann:** Proxy schlägt fehl, Audit zeigt 5xx-Spikes, Cost-Spikes.
**Aktion:** `VIBEOS_AI_GATEWAY_URL` Secret löschen → `ai-client.ts` fällt automatisch auf Lovable Gateway zurück.
**Wirkdauer:** sofort (Edge-Functions lesen env per request).
**Verifikation:** Audit-Events wieder `ai_gateway_route_resolved` (alt) statt `vibeos_gateway_route_resolved`.

### R2 — Per-Provider Disable
**Wann:** Nur ein Provider (z. B. Google body-transform) broken.
**Aktion:** im Proxy `routeGoogle` temporär 503 zurückgeben oder Provider-Key entfernen → `ai-client.ts` failover-Pfad greift auf nächsten Provider in `llm_provider_routing_policies.provider_chain`.

### R3 — Edge Function Disable
**Wann:** Proxy-Code-Bug, kein ENV-Switch reicht.
**Aktion:** `vibeos-ai-gateway` Edge entfernen oder ENV `VIBEOS_AI_GATEWAY_URL` unset (= R1).

### R4 — Code-Revert
**Wann:** `ai-client.ts` Patch selbst broken.
**Aktion:** Git-Revert auf vorherige `ai-client.ts` Version. Lovable Gateway unverändert verfügbar.

## Health Checks

| Signal | Quelle | Schwelle |
|---|---|---|
| Proxy 5xx-Rate | `fn_emit_audit` WHERE action_type='vibeos_gateway_route_resolved' AND status>=500 | <1% / 1h |
| Upstream-Latency | audit `ms` field | p95 <3000ms |
| Provider-Key missing | health endpoint | alle 3 = true |
| `fail_cluster=ai_gateway_bypass` | `v_fail_clusters_24h` | count=0 |

## Sicherheits-Constraints

- `VIBEOS_AI_GATEWAY_KEY` **niemals client-side**. Nur in `_shared/ai-client.ts` (server).
- Proxy validiert Key constant-time.
- Provider-Keys (`OPENAI_API_KEY` etc.) niemals an Client; nur Proxy-intern.
- CORS aktiv (Edge wird von anderen Edges aufgerufen, Browser nicht).

## Phase 3 — Final Cutover

Nach 14 Tagen stabilem Proxy-Betrieb:
1. `ai-client.ts` Fallback-Branch auf Lovable Gateway entfernen.
2. `LOVABLE_API_KEY` rotieren (`lovable_api_key--rotate_lovable_api_key`) und ungenutzt lassen.
3. Connector-Gateway-Abhängigkeiten (Firecrawl, GSC, Resend-1) separat migrieren.
4. Memory-Update: `mem://architektur/ki/ai-gateway-ssot-routing-v1` → Successor-Memory `vibeos-ai-gateway-v1`.
