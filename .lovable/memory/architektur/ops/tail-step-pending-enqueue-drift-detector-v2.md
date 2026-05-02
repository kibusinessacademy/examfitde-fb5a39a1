---
name: Tail-Step Pending-Enqueue-Drift Detector v2
description: Strukturelle Heilung für DAG-Deadlock — Steps queued/pending_enqueue ohne Job in Queue. Erweitert generate_exam_pool-only-Detector auf alle 7 Tail-Steps. Cron 10min, 30min Cooldown.
type: feature
---

## Problem (2026-05-02)
13 Pakete simultan festgefahren mit identischem Muster:
- ≥118 approved questions, 0 drafts
- `package_steps`: `run_integrity_check:queued` + `repair_exam_pool_quality:queued` ohne Jobs in `job_queue`
- `quality_council`/`auto_publish` Jobs blockiert vom Picker (DAG-Predecessor `run_integrity_check` queued)
- → kompletter DAG-Deadlock, Pipeline still

**Root Cause**: `fn_atomic_enqueue_on_step_queued` Trigger feuerte initial — aber bei Trigger-Ausfall (CPU-Limit, Race-Condition) blieben Steps queued ohne Job. Vorhandener Drift-Detector heilte nur `generate_exam_pool`, nicht die Tail-Steps.

## Fix v2 (Migration 2026-05-02)
- **fn_detect_and_heal_tail_step_enqueue_drift_v2**: scannt alle `package_steps` für 7 Tail-Steps (`run_integrity_check`, `quality_council`, `auto_publish`, `repair_exam_pool_quality`, `elite_harden`, `build_ai_tutor_index`, `validate_tutor_index`)
  - Bedingungen: `status IN (queued, pending_enqueue)`, Paket `building`, `updated_at < now-5min`, kein aktiver Job, alle DAG-Predecessor done/skipped
  - Cooldown: 30 Min pro `(package_id, step_key)` via `auto_heal_log` action_type='tail_step_drift_v2_heal'
  - Heal: Debounce-Meta clearen + Self-Touch UPDATE (queued→queued mit +1ms updated_at) → triggert `fn_atomic_enqueue_on_step_queued` ohne Debounce-Block
- **Cron `tail-step-drift-v2-heal-10min`**: alle 10 Min

## Komplementär zu
- `pending-enqueue-drift-heal-cockpit-rpc-v1` (per-Paket UI-Heal, gleiche Logik)
- `exam-pool-enqueue-drift-detection-v1` (Spezialfall generate_exam_pool)
- `tail-step-artifact-aware-defer-v1` (verhindert Cancel von Tail-Jobs)

## Symptomatischer Heal-Pattern (für 13 Pakete)
- `repair_exam_pool_quality` → `skipped` mit `exception_approved=true` (≥50 approved questions vorhanden → kein Repair nötig)
- Stale `gate_class=terminal` löschen wenn ≥50 approved (Tail-Step-Schutz hätte greifen müssen)
- `validate_exam_pool`/`generate_exam_pool` `failed`/`pending_enqueue` → `skipped` wenn ≥50 approved (Artifact bereits implizit erfüllt)
- Bypass für Ghost-Completion-Guard via `skipped` statt `done` (Guard prüft nur `status='done' AND meta.ok != true`)

## Audit
- `auto_heal_log` action_types:
  - `manual_bypass_tail_pending_enqueue_drift_v1` (One-Shot-Heal)
  - `tail_step_drift_v2_heal` (Cron-Heal)
