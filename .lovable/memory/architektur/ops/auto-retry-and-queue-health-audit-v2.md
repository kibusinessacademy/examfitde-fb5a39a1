---
name: Auto-Retry & Queue Health Audit v2 (Production-Hardened)
description: Wave-2 Härtung — Active-Status SSOT, Anti-Starvation Order, SSOT-Causality Guards, Trigger Honesty, Snapshot-Overlap Stagnation, Admin-Only View Access, Single-Job Action RPC.
type: feature
---

## Wave-2 Änderungen vs. v1

1. **Active-Status SSOT** (`fn_job_active_statuses()`): liefert `[pending, queued, processing, running, batch_pending]`. Duplicate-Guard nutzt das gesamte Set, nicht mehr nur 2 Werte.
2. **Anti-Starvation**: Auto-Retry jetzt `ORDER BY COALESCE(run_after, updated_at) ASC` — älteste Failed-Jobs zuerst.
3. **SSOT-Causality Guards** vor Retry:
   - Guard A: package-bound Jobs (`package_*`) brauchen `package_id`
   - Guard B: `course_packages.status` muss in `[building, queued, blocked, pending, draft]` sein
   - Guard C: kein duplicate über alle aktiven Status
   - Guard D: kein neuerer `completed`-Job für gleiche `(package_id, job_type)`
4. **Trigger ehrlicher**: `trigger_source` defaulted auf `trigger_unknown`, KEINE Role-basierten Lügen mehr. Aufrufer MÜSSEN `set_config('app.transition_source', '<source>', true)` setzen. Trigger feuert auch bei `last_error`/`error` Änderungen, loggt nur wenn relevant.
5. **Stagnations-Alert echt**: Snapshot-Overlap (`queue_health_failed_snapshot`) misst identische `job_id`s zwischen Snapshot vor 30 Min und jetzt. Trigger erst bei `stale_failed >= 10 AND overlap >= 10`. REQUEUE_LOOP-Alert mit angereicherter Metadata (job_types, package_ids, sample_errors).
6. **View-Lockdown**: `v_failed_jobs_root_causes` REVOKED von `authenticated`. Zugriff NUR via `admin_get_failed_root_causes()` RPC (admin-gated).
7. **Single-Job Action RPC** `admin_job_action(_job_id, _action, _reason)`:
   - `force_pending` → status=pending, run_after=+5s, locks/started cleared
   - `cancel` → status=cancelled, error angereichert
   - `mark_terminal` → status=failed, attempts=max_attempts, terminal-Marker
   - Schreibt `admin_actions` Audit-Eintrag + nutzt `app.transition_source` mit User-ID

## Aufrufer-Konventionen

ALLE Pfade die job_queue-Status ändern MÜSSEN setzen:
```sql
PERFORM set_config('app.transition_source', '<source>', true);
```
Bekannte Quellen: `auto_retry_policy`, `health_check`, `admin_ui:<action>:<uid>`, `runner:<lane>`, `watchdog:<reason>`.
