---
name: Reverter-Guard Audit Throttle + Caller Forensics
description: fn_guard_block_building_to_queued_revert + fn_detect_status_reverter throttlen Audits auf 1×/15min/package und loggen backend_pid + pg_stat_activity.query in metadata. Block-Wirkung unverändert. Verhindert Audit-Storms (~2000/6h beobachtet) bei wiederkehrenden Cron-Producern und macht "unknown_trigger"-Reverter rückverfolgbar.
type: feature
---

## Wann anschlagen

Wenn `auto_heal_log.action_type='guard_block_building_revert'` mit trigger_source='unknown_trigger' >50/h auf einzelnem package_id erscheint:

```sql
SELECT metadata->>'caller_query' AS query, metadata->>'backend_pid' AS pid, count(*)
FROM auto_heal_log
WHERE action_type='guard_block_building_revert'
  AND created_at > now() - interval '1 hour'
GROUP BY 1,2 ORDER BY count(*) DESC LIMIT 10;
```

→ identifiziert den Cron-Producer, der `course_packages.status='queued'` auf protected packages setzt.

## Sofort-Heal (Loop bereits aktiv)

1. Bypass-Cooldown setzen: `UPDATE course_packages SET manual_heal_cooldown_until = now()+'1 hour' WHERE id IN (...)` mit `SET LOCAL session_replication_role=replica`.
2. Phantom-Steps (pending_enqueue mit done-Vorgänger) → `status='skipped'`.
3. Failed Tail-Steps ohne last_error → `status='queued'`.
4. `admin_nudge_atomic_trigger(pkg, false)` re-enqueued Tail-Jobs.

## Permanent-Fix (offen)

Caller-Cron identifizieren und entweder gate-en (skip protected packages) oder hart abschalten.
