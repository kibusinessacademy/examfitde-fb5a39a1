---
name: Heal v3 Big Bang
description: Top-3-Cluster Noise-Killer (DAG/SHADOW/STALE), SHADOW_STALLED Auto-Heal mit Backlog-Eskalation, generate_exam_pool 3-Stufen-Fallback, Per-Course adaptive AI-Heal-Plans
type: feature
---

## Problem-Diagnose (24h-Forensik)
35.821 von 45.248 Heal-Events (79%) waren Noise — Re-Detections desselben Pakets:
- `dag_guard_block` (17.676): DB-Trigger loggte jeden geblockten INSERT (statt 1× pro Signatur).
- `progress_guard_shadow_stalled` (12.148): Guardian-Cron loggte alle 5min, Dedup nur für Notification, nicht für Log. Dazu: keine Heal-Action.
- `guardian_stale_fail` (5.760): "always log" inklusive Skip-Status.
Resultat: 2% scheinbare Heal-Erfolgsrate.

## Stufe 1 — Noise-Killer (90%+ Reduktion erwartet)
- `fn_guard_dag_prerequisites`: Log nur 1×/5min pro signature.
- `production-guardian` (G1): Log 1×/60min pro Pkg + ruft danach `guardian_heal_shadow_stalled`.
- `production-guardian` (3b): `guardian_stale_fail` skipped nur 1×/h pro Pkg geloggt; applied immer.

## Stufe 1.5 — Echte Heal-Action für SHADOW_STALLED
RPC `guardian_heal_shadow_stalled(uuid)`:
- Skip wenn Pkg >7 Tage alt (Mensch entscheidet)
- Sonst: ältesten queued/processing/failed Step via `admin_retry_failed_step` retryen
- Nach 3 Versuchen / 6h → `admin_create_permanent_fix_task` (priority=high)
- Audit `action_type='shadow_stalled_auto_heal'`

## Stufe 2 — generate_exam_pool 3-Stufen-Fallback
Tabelle `exam_pool_fallback_state` + RPC `fn_exam_pool_fallback_progress(uuid)`:
- 3 Fails/6h → `provider_switch` (model_override=openai/gpt-5-mini)
- 5 Fails/6h → `constraint_relax` (lf_min=80, bloom relaxed)
- 8 Fails/6h → `paused` + P1 Notification + Permanent-Fix-Task (critical)
Worker müssen `model_override` und `constraint_overrides` aus diesem State respektieren.

## Stufe 3 — Per-Course Adaptive AI-Heal-Plans
Tabelle `course_heal_plans` + Edge-Function `course-heal-plan-generate`:
- Trigger: initial bei Paket-Erstellung, manuell, oder nach Hard-Fail (attempts ≥ 3)
- DB-Trigger `trg_invalidate_heal_plan_on_hard_fail` markiert alten Plan als inactive
- Lovable AI Gateway (gemini-2.5-flash) via Tool-Call `submit_course_heal_plan`
- RPC `fn_get_active_heal_plan(uuid)` für Engine-Lookup

## UI
- `CourseHealPlansCard` in HealCockpitPage Sektion 3 (nach PermanentFixBacklogCard).
- Zeigt aktive Fallback-States (außer normal) + aktive Heal-Plans mit Confidence + Re-Generate-Button.

## View
`v_heal_noise_breakdown` zeigt pro action_type: events_24h, distinct_targets, applied/skipped/failed/detected, avg_events_per_target — direkter Noise-vs-Real Indikator.
