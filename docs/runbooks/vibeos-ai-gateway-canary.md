# VIBEOS_AI_GATEWAY — Canary Runbook (Phase 2.1)

**Erste Canary-Funktion:** `generate-seo-slug`
**Begründung:** niedrige Kritikalität, klar prüfbarer JSON-Output, OpenAI-Pfad,
keine Kauf-/Tutor-/Course-Generation-Abhängigkeit.

## Routing-SSOT (per-Function Override)

`generate-seo-slug/index.ts` löst Routing in dieser Reihenfolge:

1. `AI_GATEWAY_MODE_GENERATE_SEO_SLUG` (Canary-Switch, function-scoped)
2. `AI_GATEWAY_MODE` (global SSOT)
3. Auto: VibeOS wenn `VIBEOS_AI_GATEWAY_URL`+`KEY` gesetzt, sonst Lovable

→ Nur die Canary-Funktion ist betroffen; alle anderen ~60 Caller bleiben unverändert.

## Voraussetzungen (Secrets)

| Secret | Status | Pflicht? |
|---|---|---|
| `VIBEOS_AI_GATEWAY_URL` | https://ubdvvvsiryenhrfmqsvw.supabase.co/functions/v1/vibeos-ai-gateway | ja |
| `VIBEOS_AI_GATEWAY_KEY` | gesetzt | ja |
| `OPENAI_API_KEY` | live | ja (Proxy-intern) |
| `AI_GATEWAY_MODE_GENERATE_SEO_SLUG` | `vibeos` | **canary-aktivierung** |

## Canary-Aktivierung

```
secrets set AI_GATEWAY_MODE_GENERATE_SEO_SLUG=vibeos
secrets set VIBEOS_AI_GATEWAY_URL=https://ubdvvvsiryenhrfmqsvw.supabase.co/functions/v1/vibeos-ai-gateway
secrets set VIBEOS_AI_GATEWAY_KEY=<32+ bytes>
```

`AI_GATEWAY_MODE` bleibt **unset** → keine globale Auswirkung.

## 5–10 Testläufe

Auswahl 5–10 unpublished curriculum_products und anstoßen:

```ts
await supabase.functions.invoke('generate-seo-slug', {
  body: { curriculumProductId: '<uuid>' }
});
```

oder via Admin-UI: "SEO-Slug regenerieren".

## Akzeptanzkriterien

Pro Lauf prüfen (in DB / Edge-Logs):

| Signal | Quelle | Erwartet |
|---|---|---|
| Audit-Event | `audit_log WHERE action_type='vibeos_gateway_route_resolved' AND payload->>'caller'='generate-seo-slug'` | `route=vibeos`, `canary=true`, `status=200` |
| Edge-Log | `[SEO-SLUG] route=vibeos status=200 ms=<N>` | ms < 5000 p95 |
| Modell-Prefix | Audit `payload->>'model'` | `openai/gpt-5.2` (kein nackter `gpt-5.2`) |
| Secret-Leak | Edge-Log scan | keine `Bearer …`, keine Key-Substrings |
| SEO-Output | `curriculum_products.seo_title`/`seo_description` | nicht leer, ≤60 / ≤160 chars |
| Fail-Cluster | `v_fail_clusters_24h WHERE cluster_key='ai_gateway_bypass'` | count_24h ≤ baseline |

```sql
-- Canary-Audit der letzten Läufe
SELECT
  created_at,
  payload->>'route'   as route,
  payload->>'status'  as status,
  payload->>'ms'      as ms,
  payload->>'model'   as model,
  payload->>'canary'  as canary
FROM audit_log
WHERE action_type = 'vibeos_gateway_route_resolved'
  AND payload->>'caller' = 'generate-seo-slug'
ORDER BY created_at DESC
LIMIT 20;
```

## Rollback (instant)

```
secrets unset AI_GATEWAY_MODE_GENERATE_SEO_SLUG
```

→ Funktion fällt auf Lovable Gateway zurück (kein Code-Revert, 0 Downtime).
Bei Proxy-Bug zusätzlich: `secrets unset VIBEOS_AI_GATEWAY_URL` (= R1).

## Nächste Stufe — Canary #2

Nach 24h grünem Canary auf `generate-seo-slug`:

1. **`seo-generate`** als Canary #2 mit gleichem per-function Override patchen
   (`AI_GATEWAY_MODE_SEO_GENERATE=vibeos`).
2. 24h beobachten.

## Auto-Mode global

**Erst nach 2 grünen Canaries (≥48h):**

```
secrets set VIBEOS_AI_GATEWAY_URL=...   # bereits gesetzt
# AI_GATEWAY_MODE bleibt unset → _shared/ai-client.ts auto-resolved auf vibeos,
# da URL+KEY vorhanden. Alle ~60 Caller schalten transparent um.
```

Rollback global: `secrets unset VIBEOS_AI_GATEWAY_URL`.

## Memory-Update

Nach Canary #1 grün → `mem://architektur/ki/ai-gateway-ssot-routing-v1`
Successor-Notiz: `canary generate-seo-slug PASS YYYY-MM-DD`.
