---
name: Track 2.3c Safe Growth Repair Dispatcher v1
description: admin_growth_repair_dispatch_dry_run/_live RPCs. Konsumieren NUR v_growth_repair_eligibility_v1 mit safe_to_repair=true + expected_job_type. Mapping-Tabelle, Cooldown, hourly Idem-Key, Audit pro Attempt + Run.
type: feature
---

# Track 2.3c — Safe Growth Repair Dispatcher (2026-05-16)

## Konsum-Quelle (read-only)
`v_growth_repair_eligibility_v1` mit den Filtern:
- `safe_to_repair = true`
- `expected_job_type IS NOT NULL`
- + optional strategy/root_cause/track/package_id

## Alias-Mapping `growth_repair_job_type_map`
| expected_job_type | canonical_job_type | pool | priority | cooldown_min |
|---|---|---|---|---|
| seo_intent_page_generate  | seo_intent_page_generate  | core      | 40 | 60 |
| seo_indexnow_submit       | seo_indexnow_submit       | core      | 50 | 60 |
| seo_internal_link_seed    | seo_internal_links        | core      | 55 | 60 |
| growth_blog_post_generate | package_post_publish_blog | marketing | 60 | 60 |
| growth_og_image_generate  | package_og_image_generate | marketing | 60 | 60 |

**Regel**: Dispatcher leitet `job_type` AUSSCHLIESSLICH aus dieser Tabelle ab (kein Inferenz). Fehlt das Alias → skip `UNMAPPED_JOB_TYPE`. Fehlt der canonical in `ops_job_type_registry` (active) → skip `UNREGISTERED_JOB_TYPE`.

## RPCs (admin-gated, SECURITY DEFINER, search_path=public)
- `admin_growth_repair_dispatch_dry_run(_limit=25, _strategy, _root_cause, _track, _package_id)` — keine Inserts, gibt `{mode:'dry_run', scanned, would_dispatch, would_skip, rows[]}`
- `admin_growth_repair_dispatch_live(_limit=25, …, _reason)` — Pflicht-Reason, Limit-Hardcap 100
- `admin_growth_repair_recent_runs(_limit=20)` — letzte Summary-Audits

## Hard Guards (defense in depth)
Im internen `_growth_repair_decide(jsonb,timestamptz)`:
1. `REQUIRES_PLATFORM_FIX` (requires_platform_fix=true)
2. `blocked_reason` durchgereicht als skip_reason
3. `NOT_SAFE_TO_REPAIR`
4. `ACTIVE_JOB_PRESENT` (view) + `ACTIVE_JOB_PRESENT_CANONICAL` (Re-Check auf canonical job_type)
5. `NO_EXPECTED_JOB_TYPE`
6. `UNMAPPED_JOB_TYPE` / `UNREGISTERED_JOB_TYPE`
7. `COOLDOWN_ACTIVE` (`growth_repair_dispatch_cooldown` per pkg×signal×canonical)
8. `IDEMPOTENCY_CLASH` (unique_violation auf `job_queue.idempotency_key`)

## Idempotency-Key
`growth_repair:{package_id}:{signal}:{expected_job_type}:{YYYYMMDDHH}` (UTC).
`job_queue_idempotency_active` UNIQUE INDEX greift bei status ∈ (pending, processing).

## Audit-Pflicht (`auto_heal_log`)
- Pro Attempt: `action_type='growth_repair_dispatch_attempt'`, target_id=package_id, target_type='course_package', trigger_source='admin_growth_repair_dispatch_live', result_status ∈ (dispatched, skipped, failed)
- Pro Run: `action_type='growth_repair_dispatch_run'`, target_id=run_id, target_type='system', result_status ∈ (ok, partial), metadata enthält dispatched/skipped/failed/scanned + actor + run_id

## Invarianten
- KEINE Mutation von `customer_safe`, `course_packages.status`, oder Entitlements.
- Kein Direct-Table-Read im Frontend — UI nur RPC.
- Strict Attribution (2.3b) bleibt getrennt — Dispatcher fasst `conversion_event_attribution_policy` nicht an.
- Dispatcher NIE auf `requires_platform_fix=true` (`SYSTEMIC_PLATFORM_DRIFT`, `TRACKING_NOT_*`, `conversion_events`-Klassen).

## UI
`GrowthClassificationCard` → Sub-Sektion **Eligible Repairs** (Track 2.3c):
- Limit-Selector (5/10/25/50/100, default 25)
- Dry-Run-Button (FlaskConical) + Dispatch-Button (Rocket, prompt-Pflicht-Reason min 3 Zeichen)
- Last-Result-Liste (canonical_job_type, skip_reason)
- Recent-Runs (Audit-Mirror via `admin_growth_repair_recent_runs`)

## Tests
`src/components/admin/heal/__tests__/growthRepairDispatcher.smoke.test.ts`:
- anon→RPC liefert keinen Schema-Drift-Code (42703/42883/42P01)
- dry-run mit Random-UUID = scanned 0 (Kontrakt)
- Live-RPC-Signatur stabil

## Baseline 2026-05-16
- Safe signals (view): 546 über 169 Pakete
  - seo_intent_page_generate: 169
  - seo_internal_link_seed: 156
  - seo_indexnow_submit: 102
  - growth_og_image_generate: 66
  - growth_blog_post_generate: 53
- Erwarteter erster Live-Lauf (limit 25): ~25 dispatched, 0 skipped (Cooldown noch leer)

## Nächster Schritt
Track 2.3d Local Repair Worker für `TRACKING_NOT_EMITTED` + lokale `FANOUT_NOT_STARTED` — separate Pipeline, da diese Signale `requires_platform_fix=true` haben und vom Dispatcher 2.3c bewusst **nicht** angefasst werden.
