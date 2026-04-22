---
name: Action-First Cockpit & Auto-Heal Engine v7 (SSOT-Repair-Chain + Resolver-Enqueue-Plan)
description: Wave-7 — Deficit-aware Coverage-Resolver liefert vollständigen Enqueue-Plan (strategy+job_type+payload), korrekte registrierte Job-Types (package_repair_exam_pool_*), SSOT-Payload-Contract, Notification-Dedup, last_error-Schutz, zentrale Health-Score-Gewichte. Ersetzt Wave-6.
type: feature
---

## Architektur-Prinzipien (Wave-7)

1. **Strategy ≠ Job-Type.** Resolver liefert vollständigen Enqueue-Plan: `{strategy, job_type, payload, reason, target_competency_ids}`. UI/Heal-Funktion verwenden niemals den Strategy-Namen als Queue-Job-Type.
2. **Registrierte Job-Types nur.** Coverage-Heal enqueued ausschließlich `package_repair_exam_pool_competency_coverage` oder `package_repair_exam_pool_lf_coverage` (existieren in der Queue als SSOT).
3. **SSOT-Payload-Contract.** Enqueued Repair-Jobs enthalten zwingend: `package_id, curriculum_id, is_repair, mode, target_competency_ids, continuation_of_targeted_fill, continuation_depth, root_job_id, parent_job_id`.
4. **Deficit-aware Resolver.** `admin_resolve_repair_strategy_for_package(pkg)` löst echte fehlende Kompetenzen via SSOT-Join (`competencies → learning_fields → curriculum`) auf, prüft Blueprints-Verfügbarkeit und entscheidet:
   - keine Curriculum/keine Competencies → `manual_review_required`
   - aktive Repair-Sibling → `no_action_active_job_exists`
   - NO_EFFECT/NO_PROGRESS-Historie (≥2 in 24h) → `manual_review_required`
   - keine BPs → `targeted_blueprint_fill` (job_type `package_repair_exam_pool_lf_coverage`)
   - BPs vorhanden + Defizit → `targeted_competency_fill` (job_type `package_repair_exam_pool_competency_coverage`)
   - kein Defizit → `no_action_no_deficit`
5. **last_error bleibt forensisch wahr.** UNCLASSIFIED_RECLASSIFIABLE schreibt `effective_error_class` nur in `meta`, niemals in `last_error`. UNCLASSIFIED_TRANSIENT setzt `last_error=NULL` UND kapselt Original in `meta.last_error_before_retry`.
6. **REQUEUE_LOOP mit Notification-Dedup.** `admin_has_recent_terminal_notification(pkg, job_type)` verhindert Notification-Spam (24h-Fenster, ungelesene queue_terminal-Notifications).
7. **Zentrale Health-Score-Gewichte.** `admin_queue_cluster_weight(cluster) → int` ist SSOT für alle Score-Berechnungen, KPI-Views und spätere Analytics.

## Backend-Stack (v7)

### `admin_resolve_repair_strategy_for_package(_package_id)` → jsonb
Vollständiger Enqueue-Plan inkl. `target_competency_ids` und `payload`. STABLE/SECURITY DEFINER.

### `fn_auto_heal_cluster(_cluster, _max_jobs, _dry_run)`
Cluster-isoliert, per-row Exception-Isolation, Active-Sibling- und Newer-Success-Guards. Coverage-Pfad ruft Resolver und enqueued mit dessen `job_type` + `payload`. UNCLASSIFIED-Pfade respektieren `last_error`-Forensik. REQUEUE_LOOP nutzt Notification-Dedup.

### `admin_queue_cluster_weight(_cluster)` → int
Zentrale Gewichtsfunktion. Hard-Fail ×20, Structural ×8, Requeue ×10, Coverage ×5, Stale-Lock ×2, Reclassifiable ×2, Transient/Timeout/Network ×1.

### `admin_has_recent_terminal_notification(pkg, job_type, within=24h)` → bool
Dedup-Helfer für queue_terminal-Notifications.

### `admin_get_queue_health_score()` → jsonb
Nutzt `admin_queue_cluster_weight` für gewichtete Penalties + Backlog-Pressure (Cap 30). Liefert `score, status, weighted_breakdown, queue_counts`.

## UI (unverändert)
`QueueActionCockpit.tsx` zeigt cluster-isolierte Action-Cards mit Dry-Run + Heal pro Card; Bestätigungsdialog für MEDIUM/HIGH; Resolver-Strategie wird im Action-Card-Footer angezeigt.

## Migration
- `supabase/migrations/2026042210xxxx_wave_7_resolver_enqueue_plan.sql`
