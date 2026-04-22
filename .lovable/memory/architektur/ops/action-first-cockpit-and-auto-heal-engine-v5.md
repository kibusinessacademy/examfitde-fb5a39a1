---
name: Action-First Cockpit & Auto-Heal Engine v6 (cluster-isoliert + SSOT)
description: Wave-6 — SSOT-Klassifikations-View v_admin_queue_job_classification, cluster-isolierte Heal-Funktion fn_auto_heal_cluster, Strategy-Resolver, gewichteter Health-Score, Dry-Run-Support. Ersetzt Wave-5.
type: feature
---

## Architektur-Prinzipien

1. **SSOT-Klassifikation zuerst.** `v_admin_queue_job_classification` ist die einzige Quelle für Cluster, Subcluster, Risiko, Retry-Fähigkeit, Strategie. Alle RPCs (Health, Recommendations, Heal) lesen von dieser View — kein Logik-Drift mehr zwischen Heal-Funktion, Score und UI.
2. **Eine Action darf nur ihren Cluster anfassen.** `admin_execute_recommended_action('heal_stale_lock')` ruft `fn_auto_heal_cluster('STALE_LOCK_LOOP_HARD_KILL')` — niemals mehrere Cluster gleichzeitig.
3. **Strategy-Resolver vor Coverage-Heal.** Bei REPAIR_COMPETENCY_COVERAGE entscheidet `admin_resolve_repair_strategy_for_package(pkg)`: targeted_blueprint_fill (keine BPs), targeted_competency_fill (BPs vorhanden), no_action_active_job_exists (laufender Job), manual_review_required (keine Kompetenzen / kein Curriculum).
4. **UNCLASSIFIED in 3 Subcluster.** TRANSIENT (timeout/network) → 1× soft retry mit Counter-Cap; RECLASSIFIABLE (meta.error_class vorhanden) → übernehmen + retry; STRUCTURAL (constraint/payload/causality) → KEIN Auto-Retry, manueller Review.
5. **REQUEUE_LOOP_KILLED setzt nur retry_path_terminal.** Globales `admin_terminal=true` nur bei explizitem Unsafe-Confirm. Paket-Heal bleibt möglich, ein admin_notification wird erzeugt.
6. **Gewichteter Health-Score.** Hard-Fail-Cluster ×20, Structural ×8, Requeue-Loop ×10, Stale-Lock ×2, Transient ×1, Backlog-Pressure max 30. Nicht kosmetisch — strukturelle Probleme dominieren.

## Backend-Stack

### View: `v_admin_queue_job_classification`
Spalten: `id, job_type, status, package_id, attempts, max_attempts, last_error, error_class, subcluster, meta, updated_at, created_at, lane, cluster, risk_level, retryable, is_terminal, is_admin_terminal, is_retry_path_terminal, recommended_strategy, strategy_scope, safe_to_auto_execute, has_active_sibling, has_newer_success`.

### `fn_auto_heal_cluster(_cluster, _max_jobs, _dry_run)`
Cluster-isoliert. Per-Row Exception-Isolation. Active-Sibling- und Newer-Success-Guards.
- **STALE_LOCK_LOOP_HARD_KILL** (SAFE): reset → pending, attempts−1
- **REPAIR_COMPETENCY_COVERAGE** (MEDIUM): Resolver entscheidet, dann cancel + enqueue
- **REQUEUE_LOOP_KILLED** (HIGH): nur retry_path_terminal + notification
- **UNCLASSIFIED_RECLASSIFIABLE** (LOW): error übernehmen + retry
- **UNCLASSIFIED_TRANSIENT** (LOW): max 1 soft retry (Counter in meta)
- **TIMEOUT/RATE_LIMIT/NETWORK_ERROR/WATCHDOG_RECOVERY** (LOW): backoff retry
- Unbekannte Cluster: `unsupported_cluster` (kein Heal)

### `fn_auto_heal_failed_clusters` (Cron-Wrapper)
Iteriert über alle bekannten Cluster und ruft `fn_auto_heal_cluster` einzeln auf.

### Admin-RPCs (alle admin-gated, Throttle 10/min)
- `admin_get_queue_health_score()` → score 0-100, status, weighted_breakdown
- `admin_recommend_queue_actions()` → priorisierte Liste (action_key, cluster, risk_level, is_safe, job_count, package_count, title, description, recommended_strategy, why_recommended, oldest_job_at)
- `admin_execute_recommended_action(_action_key, _max_jobs, _dry_run)` → 1:1 Cluster-Mapping mit Dry-Run-Support
- `admin_resolve_repair_strategy_for_package(_package_id)` → JSON mit strategy + reason

## UI

`QueueActionCockpit.tsx` (Hybrid):
1. Kontext-Header: Score + Status-Dot + failed/aktiv/krit. Cluster
2. Action-Cards mit Risk-Badge, Cluster-Tag, Job-/Package-Count, Strategie, "Empfohlen"-Hint auf Top, **Dry-Run-Button + Heal-Button** pro Card
3. Bestätigungsdialog für MEDIUM/HIGH (zeigt Cluster, Strategie, why_recommended)
4. Dry-Run-Dialog mit processed/skipped/errors + bis zu 20 Detail-Zeilen

## Migration
- `supabase/migrations/2026042210xxxx_wave_6_cluster_isolated_heal.sql`
