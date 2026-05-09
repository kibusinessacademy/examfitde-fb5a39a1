---
name: S5c PHK Forensics + Selective Requeue
description: admin_get_pre_heartbeat_kill_forensics (clusters/top-pkgs/recent kills/quarantined) + admin_requeue_pre_heartbeat_quarantine (selective, reason-required, anti-loop) + edge_invocation_id/heartbeat_count tracking. UI PreHeartbeatKillForensicsCard im Heal-Cockpit Diagnostics-Tab.
type: feature
---

## Kern
- `mark_job_first_heartbeat(job_id, edge_invocation_id?)` schreibt jetzt zusätzlich `meta.heartbeat_count` (++) und `meta.edge_invocation_id` (pinned beim 1. Heartbeat). Service-role only.
- `_shared/first-heartbeat.ts` leitet invocation_id aus `DENO_DEPLOYMENT_ID + Date.now() + random` ab — eindeutig pro Worker-Aufruf, auch bei Isolate-Reuse.
- `admin_get_pre_heartbeat_kill_forensics()` returns jsonb mit 4 Sektionen: clusters (Top-50 job_type×lane×pool 24h), top_packages_24h (25), recent_kills (25, mit heartbeat/invocation/phk_count), quarantined_packages (50).
- `admin_requeue_pre_heartbeat_quarantine(p_package_id, p_job_id, p_reason)`:
  - Pflicht-Reason ≥5 chars
  - Mind. 1 Identifier (package_id ODER job_id)
  - Bei job_id → resolved package, prüft Mismatch
  - Clears `feature_flags.pre_heartbeat_quarantine.active=false` + cleared_at/by/reason
  - Job-Requeue NUR bei status IN (failed,cancelled) AND code IN (PRE_HEARTBEAT_KILL, PRE_HEARTBEAT_KILL_TERMINAL) → status=pending, run_after=+30s
  - Audit `auto_heal_log action_type='phk_quarantine_requeue'` mit phk_count_at_requeue
  - Anti-Loop: Bulk nicht möglich, nur ein einzelner Job pro Aufruf

## UI
`PreHeartbeatKillForensicsCard` im HealCockpit Tab "diagnostics" direkt nach `PreHeartbeatKillRiskCard`. Severity-Logik analog zur Risk-Card. Dialog mit Reason-Pflichtfeld, Toast + invalidateQueries.

## Tests
`src/test/ops/s5c-phk-forensics-and-requeue.test.ts` 4/4 grün — anon-refusal-Contract für alle 3 RPCs.

## Restrisiken
- `phk_count_at_requeue` ist informativ, kein Hard-Cap im RPC (Re-Quarantine läuft via Reaper PHK-A nach erneuten 2 PHK-Vorkommen → idempotent terminal).
- edge_invocation_id beim Worker-Call ist optional — wenn nicht übergeben, generiert Helper. Falls echte Edge-Runtime-Invocation-ID via Header verfügbar wird, im Worker manuell durchreichen.
