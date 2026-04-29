---
name: Tail-Chain Trigger-Deadlock Fix v1 (F-1, F-1.1, F-1.2, F-1.3)
description: Reconcile-Trigger fn_trg_job_complete_reconcile_step setzt Producer-Evidence (executed/ok) + Lifecycle (started_at/attempts/finished_at) für Governance- und Non-Governance-Steps, um GHOST-Guards zu lösen. Root-Fix für 24h Worker-Stillstand.
type: feature
---

# Tail-Chain Trigger-Deadlock Fix v1

## Problembild
24h Worker-Stillstand auf control-Lane: `last_completed: 1d`, `completed_6h: 0`,
35 pending, 21 stuck-processing in `package_run_integrity_check`. Auto-Publish
und Quality-Council kamen nicht mehr durch.

## Root Cause (Schichten)
1. **Trigger-Deadlock**: `fn_trg_job_complete_reconcile_step` setzte beim
   Step-Reconcile `meta.executed/ok` NICHT — der Governance-Guard
   `trg_guard_governance_step_finalization` rollbacked die Transaktion.
2. **Cast-Fehler**: Status-Zuweisung verwendete `text` statt `step_status`
   ENUM → SQL-Fehler im Trigger.
3. **Lifecycle-Backfill fehlte**: Zweiter Guard `GHOST_FINALIZATION_BLOCKED`
   forderte `started_at IS NOT NULL` und `attempts >= 1`. Da neue Steps via
   pending_enqueue Drift erstellt wurden, waren beide Felder leer/0.
4. **Non-Governance Producer-Evidence fehlte**: Repair-Steps
   (`repair_exam_pool_quality`) hatten denselben Ghost-Block.

## Fix-Stack
- **F-1** (Trigger-Reconcile): Setzt `meta.executed=true` + `meta.ok` aus
  Job-Result hierarchisch abgeleitet (gate_passed → integrity_passed → ok →
  course_packages.integrity_passed) für `run_integrity_check`,
  `quality_council`, `auto_publish`.
- **F-1.1** (Cast-Fix): Status-Updates explizit auf `step_status` ENUM gecastet.
- **F-1.2** (Lifecycle-Backfill): `started_at = COALESCE(started_at, NEW.started_at, NEW.created_at, now())`,
  `attempts = GREATEST(attempts, NEW.attempts, 1)`,
  `finished_at = COALESCE(finished_at, NEW.completed_at, now())` —
  in BEIDEN Branches.
- **F-1.3** (Non-Governance Evidence): Repair- und Mid-Chain-Steps bekommen
  ebenfalls `meta.executed=true` + `meta.ok` (hierarchisch aus
  result.ok / result.success / result.passed, sonst true).

## Invarianten
- Reconcile-Trigger verwendet IMMER `package_steps.finished_at`
  (NIEMALS `completed_at` — existiert nicht).
- `executed=true` darf NUR gesetzt werden, wenn ein completed Producer-Job
  existiert (NEW.status='completed' Trigger-Eintritt garantiert das).
- Non-Governance `ok`-Default ist `true` (weil Job=completed), Governance
  `ok` muss aus result abgeleitet werden (kein blinder Default).

## Verifikation (Beweise)
- Throughput nach Fix: ~36 Completions/15min (vs. 0 in 24h davor)
- `run_integrity_check` done mit `executed=true,ok=true`: 0 → 42
- `repair_exam_pool_quality` completed: massiv (5414 completed nach Fix)
- Logs: `GHOST_FINALIZATION_BLOCKED` und `ghost completion blocked` → 0
  Matches im job-runner nach Migration-Deploy

## Verbleibende Layer (nicht Trigger-Bug)
- **Guard 3 (Council Score < 85)**: Inhaltliches Quality-Problem,
  Repair-Policy, kein Trigger-Fix.
- **PER_TYPE_CAP-Backlog**: Normales Throttling (~21–28 deferred/min),
  selbstheilend.
- **Coverage-Gap-Steps in queued ohne Meta**: Werden jetzt durch
  funktionierenden Worker abgearbeitet.

## Migrations
- `20260429172440_*.sql` — F-1
- `20260429172937_*.sql` — F-1.1 (Cast)
- `20260429175618_*.sql` — F-1.2 (Lifecycle)
- `20260429180129_*.sql` — F-1.3 (Non-Governance)
