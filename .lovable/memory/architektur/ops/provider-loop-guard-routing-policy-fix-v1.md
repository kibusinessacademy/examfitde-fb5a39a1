---
name: PROVIDER_LOOP_GUARD Routing-Policy Fix v1
description: Root-Cause-Fix für endlose "unknown/unknown transient" Loops bei Repair-Jobs (pool_fill_*, blueprint_*) durch fehlende llm_provider_routing_policies Einträge
type: feature
---

# PROVIDER_LOOP_GUARD: unknown/unknown Endlosschleife (Fix 2026-04-17)

## Symptom
Repair-Jobs (vor allem `pool_fill_bloom_gaps`) liefen endlos in TRANSIENT-Loops mit
`PROVIDER_LOOP_GUARD: unknown/unknown transient x15+ — reroute`. Der Reroute funktionierte
nie, weil "unknown" als Provider-Identität galt → derselbe Job wurde >25× requeued ohne
echten Reroute, blockierte WIP-Slots und führte zu Stale-Locks.

## Root Cause
Im `content-runner` mappt `WORKLOAD_KEY_MAP` mehrere Job-Typen auf Workload-Keys:
- `pool_fill_bloom_gaps` / `pool_fill_lf_gaps` → `enrichment`
- `package_elite_harden` → `orchestration`
- `package_generate_blueprint_variants` → `blueprint_variants`
- `package_auto_seed_exam_blueprints` → `blueprint_seed`

Diese Workload-Keys hatten **keine Einträge** in `llm_provider_routing_policies`.
`resolve_available_llm_route(workload)` gab `{ok:false, reason:"no_policy"}` zurück
→ `jobProvider = "unknown"`, `jobModel = "unknown"`.

Die `PROVIDER_LOOP_GUARD`-Logik vergleicht dann `unknown==unknown` → zählt sameProvider-
Attempts → triggert Reroute, der aber wieder auf "unknown" landet → **Endlosschleife**.

## Fix
1. **Routing-Policies eingefügt** für die 4 fehlenden Workload-Keys (route_key UNIQUE):
   - `enrichment_default`, `orchestration_default`, `blueprint_variants_default`, `blueprint_seed_default`
   - Alle: `[openai/gpt-5.4-mini → openai/gpt-4o-mini]` cascade
2. **Legacy `blocked_reason` normalisiert**: `pool_fill_in_progress` → `pipeline_repair_required` (SSOT-Taxonomie).
3. **Festhängende Jobs zurückgesetzt** mit Priority 5 + `is_repair=true` Flag.
4. **content-runner, pipeline-runner, admin-ops-actions deployt**.

## Lehre / Dauermaßnahme
- Jeder Eintrag in `WORKLOAD_KEY_MAP` (content-runner) MUSS einen entsprechenden Eintrag
  in `llm_provider_routing_policies` haben, sonst greift der PROVIDER_LOOP_GUARD nicht.
- TODO: CI-Guard `scripts/check-routing-policy-parity.mjs` der WORKLOAD_KEY_MAP gegen
  DB-Workload-Keys vergleicht und bei Drift fehlschlägt.
- TODO: `resolveAvailableRoute()` sollte bei `no_policy` einen P1-Alert in
  `admin_notifications` erzeugen, statt still "unknown" zu liefern.
