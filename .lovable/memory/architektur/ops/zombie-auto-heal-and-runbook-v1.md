---
name: Zombie Auto-Heal & Run-Integrity Runbook v1
description: RPCs + Cron + UI für zombie-locked Jobs, safe-requeue Integrity-Check, REQUEUE-Loop terminal, Cancel-Audit-Summary, Runbook-Page
type: feature
---

## Backend RPCs (alle SECURITY DEFINER + has_role admin Guard)

- `admin_detect_zombie_locked_jobs(_age_min int default 15)` → Liste mit `zombie_reason` (locked_never_started | no_heartbeat_since_lock | heartbeat_stale | locked_stale)
- `admin_heal_zombie_locked_job(_job_id, _reason)` → Cancel + Step-Reset (running/enqueued/processing → queued, started_at/last_heartbeat_at/runner_id/job_id NULL) + Audit
- `admin_safe_requeue_integrity_check(_package_id, _reason)` → Guards: kein aktiver Job, Step `queued|pending`, alle upstream Steps `done|skipped|completed`. Insert mit priority=2.
- `admin_mark_requeue_loop_terminal(_job_id, _reason)` → status=failed, `meta.manual_review_required=true`, `meta.retry_path_terminal=true` + Audit
- `admin_get_job_cancel_audit_summary(_job_id)` → Reason, Step-Status, timestamps, linked admin_actions + reconciler_actions
- `admin_get_run_integrity_runbook(_package_id)` → Causes (stale_lock | ghost_finalization | orphan_no_job | requeue_loop) + Flags + Heal-Action/Target

## Cron
- `auto-heal-zombie-locked-jobs` alle 10 Min → `fn_auto_heal_zombie_locked_jobs()` markiert Jobs mit lock>15min ohne Heartbeat als cancelled, resettet Step, audit-loggt.
- Skipped wenn `meta.admin_terminal=true` oder `meta.manual_review_required=true` (kein Override existing terminal flags).

## Frontend
- `src/lib/admin/queue/zombieHealApi.ts` — Client-Wrapper
- `src/components/admin/queue/JobLiveProgressList.tsx` — Live-Progress aller processing/running Jobs mit Ghost-Badge + Heal-Button (eingebunden in QueueStagnationPage)
- `src/components/admin/queue/JobCancelAuditSummary.tsx` — Audit-Trail-Panel für einen Job (reason_code, step, timestamps, admin_actions, reconciler_actions, Link zum Runbook)
- `src/pages/admin/v2/IntegrityCheckRunbookPage.tsx` (Route: `/admin/v2/runbook/integrity-check?package_id=…`) — Cause-Cards + Heal-Buttons

## Heal-Reasons (Konvention)
- `zombie_locked_auto_heal` (manual via API)
- `zombie_locked_auto_heal_cron` (Cron)
- `manual_ghost_heal` (UI Live-Progress Heal)
- `runbook_heal` / `runbook_requeue` / `runbook_loop_terminal` (Runbook-Page)
- `requeue_loop_manual_review` (Default für mark_requeue_loop_terminal)
- `manual_safe_requeue` (Default für safe-requeue)
