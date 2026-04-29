---
name: Pending-Enqueue Drift Cockpit-Heal RPC
description: Kapselt das wiederkehrende atomic-coupling Drift-Muster (gate_class=terminal Cancel-Loop) als kontrollierten Cockpit-RPC mit strengen Eligibility-Gates. KEIN pg_cron — bewusst manuell.
type: feature
---

# admin_heal_pending_enqueue_drift — 2026-04-29

## Problem
Tail-Steps (`repair_exam_pool_quality`, `run_integrity_check`, `quality_council`, `auto_publish`) werden vom atomic-coupling-Trigger gecancelled, sobald ein Paket kurz auf `blocked` (gate_class=terminal) wechselt. Manuelle DO-Block-Heilung hält nur ~5 Minuten.

## RPC `admin_heal_pending_enqueue_drift(p_package_ids uuid[], p_reason text, p_dry_run boolean)`

**Eligibility (alle 4 müssen TRUE sein):**
1. `course_packages.status IN ('building','blocked')` und nicht archived
2. `exam_questions.status='approved'` count > 0
3. KEIN aktiver Job in (`processing`,`running`,`pending`,`queued`,`retry_scheduled`,`batch_pending`)
4. ≥1 cancelled Job in den letzten 30min für einen der 4 Tail-Job-Types

**Aktion (nur bei Eligibility):**
- `blocked → building` mit Audit-Tag in `course_packages.feature_flags`:
  - `admin_force_building_reason='pending_enqueue_drift_heal'`
  - `admin_force_building_at`, `admin_force_building_by`
- Reset der 4 Tail-Steps in `(queued, failed, blocked, timeout, pending_enqueue)`:
  - `attempts=0`, `last_error=NULL`
  - `pending_enqueue` bleibt `pending_enqueue`, sonst → `queued`
  - `meta.reset_reason=p_reason`, `previous_status`, `previous_attempts`
- `admin_nudge_atomic_trigger(pkg)` (Fehler werden in step_actions geloggt, kein Crash)
- Audit in `auto_heal_log` mit `action_type='cockpit_pending_enqueue_drift_heal'`

**Skip-Reasons (sichtbar im Result):**
- `archived`, `status_not_building_or_blocked`, `no_approved_questions`, `active_jobs_exist`, `no_recent_cancelled_loop`

## AuthZ (strikt — 2026-04-29 gehärtet)
- NUR `has_role(auth.uid(),'admin')` ODER `request.jwt.claim.role='service_role'`
- KEIN `session_user`-Fallback in produktiven Admin-RPCs (Privilege-Escalation-Risiko)
- Für ad-hoc Tool-Kontext-Heilungen: einmaliger DO-Block / Migration mit Audit-Tag `trigger_source='one_time_sql_bypass'`
- `EXECUTE` für `authenticated`, `service_role`

## Bewusste Architektur-Entscheidungen
- **Kein pg_cron** im ersten Schritt — erst kontrolliert stabilisieren, dann automatisieren
- **Tail-Steps only** — kein blindes Reset aller Steps
- **Eligibility hart** — vermeidet Heilung von Paketen, die gerade legitim laufen
- **Audit-Tag in feature_flags**, weil `course_packages` keine `meta`-Spalte hat

## Verwendung
```sql
-- Dry-Run
SELECT admin_heal_pending_enqueue_drift(
  ARRAY['<uuid1>'::uuid,'<uuid2>'::uuid],
  'cockpit_drift_heal', true);

-- Execute
SELECT admin_heal_pending_enqueue_drift(
  ARRAY['<uuid1>'::uuid,'<uuid2>'::uuid],
  'cockpit_drift_heal', false);
```

## Erste Erfolge
2026-04-29 — Heilung Finanzanlagenvermittler §34f (`ba96f6d9…`):
- 7 cancelled loops in 30min, 386 approved questions
- forced building, 4 Tail-Steps reset, atomic-Nudge ok
- Audit `cockpit_pending_enqueue_drift_heal` in auto_heal_log
