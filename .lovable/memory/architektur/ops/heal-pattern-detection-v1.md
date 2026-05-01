---
name: Heal Pattern-Detection v1
description: Wiederkehrende Cluster aus auto_heal_log werden zu Pattern aggregiert (cluster × target), severity-bewertet und mit AI-Empfehlung (Gemini Flash) versehen
type: feature
---

## Architektur

### Backend (Migration 20260501_*)
- `heal_pattern_recommendations` (Tabelle, RLS admin-only) — persistierte AI-Empfehlungen mit valid_until 24h, status active/superseded/resolved/dismissed
- `v_heal_recurring_patterns` — cluster × target_id über 7d, severity_score (0-100, Cluster-Gewicht + Recurrence + Escalation), pattern_key = sha1(cluster|target_id), JOIN auf course_packages + aktive Empfehlung
- `v_heal_kpi_overview` — 24h KPIs: success_rate_pct, auto_heal_quote_pct, avg_duration_ms, top_clusters_24h jsonb, active_pattern_count
- `v_heal_pattern_root_cause_signals` — verknüpft Pattern mit recent_heal_attempts (last 5) + failed_steps (package_steps.status IN failed/blocked) — für AI-Kontext
- RPCs (admin-only via has_role): `admin_heal_next_best_action(limit)`, `admin_heal_pattern_signal_bundle(pattern_key)`, `admin_heal_pattern_mark_resolved(id, note)`, `admin_heal_pattern_dismiss(id, reason)`

### Edge Function `heal-recommend`
- Input: `{ pattern_key, force? }`
- Auth: User-JWT + has_role('admin') Check
- Lädt Signal-Bundle via RPC, ruft Lovable AI Gateway (google/gemini-2.5-flash) mit Tool-Call submit_heal_recommendation
- Tool-Schema: root_cause, heal_plan {steps[{action, params, why}], expected_outcome}, permanent_fix_suggestion, confidence
- Caching: existierende active Empfehlung mit valid_until>now wird wiederverwendet (Cache-Bypass via force=true)
- Schreibt nach heal_pattern_recommendations + Audit-Eintrag in auto_heal_log (action_type='heal_pattern_recommendation_generated')

### UI
- `HealKpiHeroCard` — neuer Hero unter AlertsBanner: 4 KPI-Tiles + Top-3-Cluster-Badges + active/critical/escalating Pattern-Counts. Refetch 30s.
- `RecurringPatternsCard` — in Sektion 3 "Pakete heilen" oben. Pro Pattern: severity badge, escalation badge, AI-Confidence badge wenn vorhanden, Studio-Link. „AI analysieren" / „Neu analysieren" Button. Aktive Empfehlung inline mit Root-Cause + Permanent-Fix + Mark-Resolved/Dismiss Buttons.

## Filter
Cluster ausgeschlossen (zu rauschig): production_guardian_cycle, pipeline_watchdog_cycle, worker_liveness_check, lc_shard_liveness_revive, atomic_step_enqueue, tail_step_retryable_deferred. Mindest-Recurrence: 3 in 7 Tagen.

## Severity-Formel
LEAST(100, recurrence_7d/50*30 + recurrence_24h/20*30 + min(recurrence_1h*5, 25) + 15 wenn Cluster in {phantom, requeue_loop, hot_loop, stale_lock_hard_kill, zombie_hard_stalled})
