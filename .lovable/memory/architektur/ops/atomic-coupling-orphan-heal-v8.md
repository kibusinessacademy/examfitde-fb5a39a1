---
name: Atomic-Coupling Orphan-Heal & Trigger-Härtung v8
description: Wave-8 Härtung. fn_atomic_enqueue_on_step_queued akzeptiert jetzt Reset-Cases (queued→queued mit meta.wave/reset_reason/allow_regression). Neue Heal-Function fn_heal_orphan_queued_steps(limit) + Cron alle 5 min. Verwaiste queued-Steps ohne aktiven Job werden idempotent re-enqueued (mit DAG-Check, WIP-Cap-Respect, pending_enqueue-Fallback).
type: feature
---

# Atomic-Coupling Orphan-Heal & Trigger-Härtung v8 — 2026-04-19

## Problem
Wave-7 hat 392 seed_steps und 1.639 downstream Steps mit `allow_regression=true` zurückgesetzt (queued). Atomic-Trigger feuerte BEFORE UPDATE, aber `enqueue_job_if_absent` rejected wegen WIP-Cap (51 in_flight bei 35 cap). Trigger schrieb status normalerweise auf `pending_enqueue`, aber bei Wave-7-Reset blieb status `queued` weil OLD.status bereits `queued` war (Idempotenz-Skip in alter Trigger-Logik).

Resultat: 8.500+ Steps in queued ohne aktiven Job, kein Reconciler bestand außer für seed_blueprints (der zudem an `cannot ALTER TABLE` scheiterte).

## Root Cause
`fn_atomic_enqueue_on_step_queued` skippte jeden UPDATE wo `OLD.status='queued'` — sinnvoll für normale Idempotenz, aber fatal bei kontrollierten Resets. Kein systemweiter Fallback existierte.

## Fix
1. **Trigger-Härtung**: Bei UPDATE mit `OLD.status=queued` wird Re-Enqueue erlaubt wenn `meta.allow_regression=true` ODER `meta.reset_reason` ODER `meta.wave` gesetzt. Schützt vor Endlosschleifen, erlaubt Repair-Wellen.
2. **Heal-Function** `fn_heal_orphan_queued_steps(p_limit int)`: heilt systemweit queued-Steps ohne aktiven Job. Respektiert step_dag_edges, WIP-Cap (via enqueue_job_if_absent), schreibt pending_enqueue bei Cap-Reject. Logged in `auto_heal_log` und `admin_actions`.
3. **Cron-Job** `heal-orphan-queued-steps` (jede 5 min, limit 800).

## Erkenntnis: Die Mehrheit der queued-Steps ist nicht "verwaist"
Bei Verifikation zeigte sich: 99% (792 von 800 im ersten Batch) sind durch unmet DAG-Dependencies blockiert — z.B. `auto_seed_exam_blueprints` wartet auf `validate_learning_content`. Das ist korrektes Topologie-Verhalten, kein Drift. Heal-Function überspringt diese sauber.

## Invarianten
- `fn_atomic_enqueue_on_step_queued`: nur ein Job pro (package_id, step_key) gleichzeitig.
- `fn_heal_orphan_queued_steps`: idempotent, springt bei DAG-Block oder fehlendem job-mapping. Cron-safe.
- Wave-Reset-Convention: meta MUSS enthalten `wave` ODER `reset_reason` ODER `allow_regression=true` damit Trigger erneut greift.

## Erwartete Wirkung
- Repair-Wellen (Wave-7+) schreiben Steps zu queued → Trigger enqueued direkt.
- Cap-Rejects landen sauber in `pending_enqueue` (vorhandener Resolver heilt).
- Cron `heal-orphan-queued-steps` greift bei Edge-Cases (Trigger-Exception, manuelle SQL-Updates).
