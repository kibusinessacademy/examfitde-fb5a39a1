---
name: Job-Step-Coherence Guard v1 (P0)
description: Erweiterter Step→terminal Trigger cancelt verwaiste pending/queued/enqueued/batch_pending Jobs für done|skipped|failed Steps. Verhindert REQUEUE_LOOP_KILLED bei skipped Steps.
type: feature
---

# Job-Step-Coherence Guard v1 — Umgesetzt 2026-04-21

## Problem
Der bestehende Trigger `trg_cancel_orphan_jobs_on_step_done` deckte nur `step.status='done'` ab und cancelte nur `job.status='pending'`.
Folge: Bei `step.status='skipped'` (z. B. durch Track-Applicability) liefen Jobs in `queued|enqueued|batch_pending` weiter, requeueten sich und endeten in `REQUEUE_LOOP_KILLED` nach 13 Versuchen.

## Fix
- Neuer Trigger `trg_cancel_orphan_jobs_on_step_terminal` ersetzt den alten.
- Feuert bei Transition in `done | skipped | failed`.
- Cancelt alle Jobs in `pending | queued | enqueued | batch_pending` für die per `step_job_mapping` zugeordneten `job_type`s.
- `processing` bleibt unangetastet — Runner müssen natürlich abschließen (verhindert CAS-Guard-Konflikte).
- Cancel-Reason: `step_finalized_job_obsoleted`, `cancel_source: trg_cancel_orphan_jobs_on_step_terminal`, inkl. `step_terminal_status`.
- Audit via `auto_heal_log`.

## Backfill
Einmalig bestehende Drift bereinigt (3 Jobs). Verifikation: 0 verbleibende Drift-Rows nach Migration.

## Invarianten
- `package_steps.status ∈ {done,skipped,failed}` ⇒ keine offenen Jobs für mappinggleiche `job_type`s mehr (außer `processing`).
- Komplementär zu `fn_guard_terminal_status_regression` (CAS) und `fn_guard_obsolete_processing_jobs` (Pre-Run-Guard im Runner).
