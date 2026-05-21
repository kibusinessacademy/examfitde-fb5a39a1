---
name: Runtime Intelligence Layer v1.3
description: Cooldown-Registry + Cascade-Guard-Trigger + Intelligence-Views + Cascade-Pattern + Advisory-Recommendations RPC + 2 Cards (Intelligence + Recommendations) in /admin/runtime. Operator-first, governance-first, niemals autonom mutierend.
type: feature
---

# Runtime Intelligence Layer v1.3 (2026-05-21)

Schließt die Lücke zwischen v1.2 (Rollback+Dry-Run) und autonomem Verhalten: ExamFit kann jetzt Probleme erklären, Risiken einordnen, historische Muster sehen, Cascades verhindern — **OHNE** autonome Mutationen.

## Schema
- `runtime_action_cooldowns(action_key PK→runtime_safe_actions, cooldown_seconds 0..86400, max_per_hour 1..1000, max_concurrent_per_target 1..100, scope global|per_target|per_actor, notes)` — seeded per severity/destructive: critical→300s/4ph/1conc, high→120s/10ph, medium→60s/20ph, low→30s/60ph.

## Views (alle locked, nur via RPC)
- `v_runtime_action_cooldown_state` — per (action_key, target_id): last_action_at, retry_after_seconds, last_hour_count, concurrent_count, in_cooldown.
- `v_runtime_action_intelligence` — per action_key (30d): runs_30d/24h, success/failed/rolled_back, cooldown_blocks_7d, failure_rate_pct, rollback_rate_pct, avg_duration_ms, top_failure_reasons jsonb.
- `v_runtime_action_cascade_pattern` — temporal Sequenzpaare (a→b innerhalb 5min, ≥2 Vorkommen).

## RPCs (SECURITY DEFINER + has_role-Gate)
- `admin_check_runtime_cooldown(_action_key,_target_id)` → {allowed, retry_after_seconds, reason: ok|cooldown_window_active|hourly_rate_limit_exceeded|concurrent_limit_exceeded}.
- `admin_get_runtime_intelligence()` → SETOF.
- `admin_get_runtime_cascade_patterns()` → SETOF.
- `admin_get_runtime_recommendations()` → jsonb-Array (kind: high_failure_rate | cascade_pattern | cooldown_pressure | heal_pattern_link). Bridge zu `heal_pattern_recommendations` (active, severity≥60).

## Cascade-Guard (BEFORE INSERT auf runtime_action_results)
`trg_guard_runtime_cooldown` + `fn_guard_runtime_cooldown`:
- Skip wenn simulation_only OR is_rollback OR payload.cooldown_override=true.
- Bei Cooldown-Violation: setzt status='cancelled', error='cooldown_blocked', outcome={cooldown_blocked, retry_after_seconds, last_hour_count, concurrent_count} und emittiert `runtime_safe_action_cooldown_blocked` Audit. **Kein Hard-Fail** — explizite Cancel-Row mit Evidence.

## Audit-Contract
- `runtime_safe_action_cooldown_blocked` · required: action_key, target_id, retry_after_seconds (owner_module=runtime_intelligence_v1_3).

## UI (/admin/runtime, neuer Default-Tab "Intelligence")
- `RuntimeRecommendationsCard.tsx` — Advisory-Feed (read-only). 4 Recommendation-Kinds mit Severity-Badge, Vorschlag, Evidence-Drilldown.
- `RuntimeIntelligenceCard.tsx` — pro Action: Status-Badge (OK/WARN/CRIT/IDLE), 5-Stat-Grid (Runs/Erfolg/Fehler/Rollback/Cooldown-Blocks), Top-3-Fehlergruende, Cooldown-Konfig inline.
- RuntimeCommandCenterPage Badge v1.3 + neuer Default-Tab "Intelligence" vor "Actions".

## Invarianten
- Cooldown-Trigger blockiert nie Simulation/Rollback (sonst wird Rollback selbst unmoeglich).
- Recommendations sind 100% read-only — keine Buttons zum Direkt-Dispatch (Operator muss bewusst zum Safe-Actions-Tab wechseln).
- Cascade-Detection erkennt Sequenzen, fuehrt aber niemals selbst aus.
- Override-Pfad nur ueber explizites payload.cooldown_override=true (audit-bar via runtime_action_results.payload).

## Verwandt
- mem://architektur/ops/safe-actions-framework-v1
- mem://architektur/ops/safe-actions-dispatcher-v1
- mem://architektur/ops/runtime-command-center-observability-v1-1
- mem://architektur/ops/runtime-command-center-v1-2-rollback-dry-run
- mem://architektur/ops/heal-pattern-detection-v1 (Bridge via heal_pattern_link Recommendation)
