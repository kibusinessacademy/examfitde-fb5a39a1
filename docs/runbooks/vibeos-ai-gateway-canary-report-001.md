# VIBEOS_AI_GATEWAY — Canary Report #001

**Date:** 2026-06-11
**Runner:** `vibeos-gateway-canary` (temporäre interne Edge-Funktion, Option 2b)
**Mode:** Internal (kein Key-Leak, kein Test-DB-Row, kein produktiver Datentouch)

## Setup

| Item | Wert |
|---|---|
| Proxy-Endpoint | `https://ubdvvvsiryenhrfmqsvw.supabase.co/functions/v1/vibeos-ai-gateway/v1/chat/completions` |
| Auth | `Vibeos-Gateway-Key` (intern aus Secrets gelesen) |
| Model | `openai/gpt-4o-mini` (Direct-OpenAI, Vibeos-Proxy → api.openai.com) |
| Prompts | 5 Standard + 5 Edge-Cases (Umlaute, lange Titel, Sonderzeichen, EN/DE Mix, leerer Input) |
| Spacing | 800 ms pro Request |

## Findings

### ✅ Routing-Stack — funktioniert
1. Supabase Edge-Router routet `/vibeos-ai-gateway/v1/chat/completions` korrekt (Vorbedingung: Platform-`apikey`+`Authorization` Bearer Anon-Key in edge-to-edge Call).
2. Proxy-Auth (`Vibeos-Gateway-Key`) — constant-time-vergleich PASS, 0 auth_errors.
3. **Hotfix während Canary:** Header-Prio im Proxy korrigiert (`vibeos-gateway-key` wird jetzt **vor** `Authorization` ausgewertet, damit edge-to-edge Caller die Platform-JWT in Authorization mitschicken können, ohne die Gateway-Auth zu verfälschen). Deployed.
4. Erste falsche Default-Annahme: `openai/gpt-5.2-mini` ist **kein** OpenAI-Direct-Modell — nur ein Lovable-Gateway-Alias. Auf real OpenAI antwortet das mit 404 (`model_not_found`). Default auf `openai/gpt-4o-mini` korrigiert.

### ❌ Upstream OpenAI — 10 / 10 mit HTTP 429
Nach Routing-Fix und Modell-Fix: alle 10 Calls quittiert `api.openai.com` mit **429 Too Many Requests**, p50 285 ms, p95 1278 ms (RTT, keine echte Inferenz).

| Signal | Soll | Ist |
|---|---|---|
| ok_count | 10 / 10 | **0 / 10** |
| auth_errors | 0 | 0 ✅ |
| provider_errors (5xx) | 0 | 0 ✅ |
| timeouts | 0 | 0 ✅ |
| malformed_response | 0 | 0 ✅ |
| http_429 | 0 | **10** ❌ |
| p95 ms | < 5000 | 1278 ✅ |

429 trotz 800 ms Spacing zwischen Requests deutet **nicht** auf Burst-Rate-Limit, sondern auf
**Account-Level-Quota** des `OPENAI_API_KEY` hin (kein Guthaben oder kein aktiver Tier).

### Audit
Audit-Event `vibeos_gateway_canary_report` wurde best-effort an `fn_emit_audit` gesendet
(siehe Edge-Logs für `vibeos-gateway-canary`).

## Verdict — RED 🚨

**Nicht** wegen Proxy-Bug — der Proxy ist ready.
**Sondern** wegen Upstream-Provider-Quota.

## Empfehlung

1. **Generate-seo-slug Canary NICHT freigeben.** `AI_GATEWAY_MODE_GENERATE_SEO_SLUG` bleibt aktiv,
   würde aber bei jedem Slug-Run gegen denselben 429-Wall laufen — **dort sofort rollbacken**
   (`secrets unset AI_GATEWAY_MODE_GENERATE_SEO_SLUG`) bis der OpenAI-Key Quota hat.
2. **OPENAI_API_KEY prüfen** (Billing-Tier, Limits, ggf. neuen Key mit Pay-As-You-Go provisionieren).
3. Nach Quota-Fix: `vibeos-gateway-canary` erneut feuern. Bei 10/10 GREEN → Canary #1 auf
   `generate-seo-slug` mit 5 echten Produkt-Slugs verifizieren (parallel zu Lovable-Gateway-Shadow).
4. Erst nach **zweitem** grünen Canary (z. B. `seo-generate`, 24h) globaler Auto-Mode.

## Hygiene

- `vibeos-gateway-canary` bleibt deployed, aber:
  - kein Cron, kein Client-Aufruf → effectively disabled,
  - nur per `assertAdmin` (Service-Role / Admin-JWT / `EDGE_INTERNAL_SHARED_SECRET`) erreichbar,
  - kein Schreibzugriff auf produktive Tabellen (nur Audit-RPC),
  - kein Secret im Request/Response-Body.
- Nach erfolgreichem Cutover entfernen (`supabase--delete_edge_functions`).
