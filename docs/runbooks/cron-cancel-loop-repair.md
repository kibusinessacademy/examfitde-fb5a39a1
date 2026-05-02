# Runbook: Cron Cancel-Loop Reparatur

**Scope**: Repair-Workflow für blind-enqueueing Crons (z. B. `*/15`-Heiler), die Endlos-Cancel-Loops produzieren.

## Symptome
- `job_queue` hat ≥30 cancelled-Jobs eines Job-Typs in 15 Min (siehe `v_job_type_quarantine_active` oder Query unten)
- `auto_heal_log` zeigt `enqueue_blocked_job_type_quarantined` oder `enqueue_source_missing_warn`
- Pakete im Cockpit "Festgefahren" mit `UPSTREAM_CAUSALITY_NOT_SATISFIED` o. ä.

## Forensik-Checkliste (vor jedem manuellen Heilschritt!)

1. **Cancel-Druck identifizieren**
   ```sql
   SELECT job_type, COUNT(*) AS cancels_15m, COUNT(DISTINCT package_id) AS pkgs
   FROM job_queue WHERE status='cancelled' AND created_at > now()-interval '15 min'
   GROUP BY job_type ORDER BY 2 DESC LIMIT 10;
   ```

2. **Quelle bestimmen**
   ```sql
   SELECT COALESCE(meta->>'enqueue_source', payload->>'enqueue_source','UNTAGGED') AS src,
          job_type, COUNT(*)
   FROM job_queue WHERE created_at > now()-interval '6 hours' AND status='cancelled'
   GROUP BY 1,2 ORDER BY 3 DESC LIMIT 25;
   ```
   - `UNTAGGED` → Producer hat keinen `enqueue_source` gesetzt → Producer suchen via `pg_get_functiondef` + grep auf `INSERT INTO job_queue`.

3. **Aktive Quarantänen prüfen**
   ```sql
   SELECT * FROM v_job_type_quarantine_active;
   SELECT * FROM package_job_quarantine WHERE cleared_at IS NULL AND blocked_until > now();
   ```

4. **DAG-Liveness pro betroffenem Paket**
   ```sql
   SELECT step_key, status FROM package_steps WHERE package_id='<uuid>' ORDER BY step_order;
   ```
   Plus Drift-Guard-Verdict:
   ```sql
   SELECT public.fn_cron_enqueue_drift_guard('<package_uuid>', 'package_<step_key>', 'manual_audit');
   ```

5. **Cron-Abdeckung verifizieren**
   ```sql
   SELECT jobname, schedule, left(command,140) FROM cron.job WHERE active=true ORDER BY jobname;
   ```

## Sichere Bypass-Strategien

### A. Job-Typ entlasten (sofort)
```sql
SELECT public.fn_auto_quarantine_hot_cancel_loops(15, 30, 30);
-- Quarantäniert alle Job-Typen mit ≥30 Cancels/15min für 30min.
```

### B. Manuelle Quarantäne-Aufhebung (nur nach Producer-Fix!)
```sql
SELECT public.admin_clear_job_type_quarantine('package_generate_exam_pool');
```

### C. Cron pausieren statt killen
```sql
UPDATE cron.job SET active=false WHERE jobname='<verdächtiger_cron>';
-- Reaktivieren nach Patch:
UPDATE cron.job SET active=true WHERE jobname='<verdächtiger_cron>';
```

### D. Per-Paket-Bypass (nur wenn approved questions vorhanden + Tail-Step offen)
```sql
-- 1) Cancel-Cooldown-Reset (clears last_atomic_enqueue_at)
UPDATE package_steps SET meta = meta - 'last_atomic_enqueue_at'
 WHERE package_id='<uuid>' AND step_key IN ('run_integrity_check','quality_council','auto_publish');
-- 2) Fresh nudge
SELECT public.admin_nudge_atomic_trigger('<uuid>');
```

### E. NIEMALS
- `started_at` direkt manipulieren → bricht Skip-Guard
- `status='done'` ohne Artefakte setzen → erzeugt Phantom-Steps
- Cron `DROP`pen ohne Producer-Fix → Drift wandert in andere Pfade

## Producer-Härtung (nachhaltige Fixes)

Jeder neue oder bestehende Cron, der Jobs erzeugt, MUSS:

1. **`enqueue_source` Tag setzen** im payload (`{"enqueue_source":"<cron_name>"}`)
   - Ab `2026-05-09` blockiert `enqueue_job_if_absent` untaggte Inserts hard.

2. **Drift-Guard zuerst aufrufen**:
   ```sql
   IF (SELECT (public.fn_cron_enqueue_drift_guard(p_pkg, p_jobtype, '<cron_name>')->>'allow')::boolean) THEN
     PERFORM public.enqueue_job_if_absent(...);
   END IF;
   ```

3. **Quarantäne respektieren**: `enqueue_job_if_absent` blockt automatisch — kein Workaround.

## Bestätigung der Forensik (vor Heilstart)

Vor `admin_clear_job_type_quarantine` oder Cron-Reaktivierung MUSS gelten:

- [ ] Producer identifiziert und gepatcht (DAG-Guard + `enqueue_source`)
- [ ] Heal-Audit `auto_heal_log WHERE action_type LIKE 'enqueue_%' AND created_at > now()-interval '15 min'` zeigt keine neuen Loop-Signaturen
- [ ] Drift-Guard-Verdict für betroffene Pakete = `STEP_TERMINAL` oder `OK` (nicht `PREDECESSORS_NOT_DONE`/`CANCEL_COOLDOWN_ACTIVE`)
- [ ] Mind. 1 erfolgreich completierter Job des Typs nach Patch (`SELECT MAX(updated_at) FROM job_queue WHERE job_type='X' AND status='completed'`)

## Auditspur

- **Auto-Quarantäne**: `auto_heal_log WHERE action_type='job_type_auto_quarantine'`
- **Manuelle Aufhebung**: `auto_heal_log WHERE action_type='job_type_quarantine_cleared'`
- **Blockierte Enqueues**: `auto_heal_log WHERE action_type='enqueue_blocked_job_type_quarantined'`
- **Untagged Producer**: `auto_heal_log WHERE action_type IN ('enqueue_source_missing_warn','enqueue_source_missing_blocked')`

## Cron

- `auto-quarantine-hot-cancel-loops-5min` — `*/5 * * * *` → `fn_auto_quarantine_hot_cancel_loops(15, 30, 30)`
- `coupling_heal_15min_v4` — `*/15 * * * *` → `admin_heal_step_job_coupling_v4()` (DAG + cancel-cooldown)
- `detect-exam-pool-drift-15min` — `*/15 * * * *` → `fn_detect_and_heal_exam_pool_enqueue_drift(25, false, 30)`
