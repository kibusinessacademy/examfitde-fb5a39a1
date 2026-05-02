# Runbook: Manueller Bypass Tail-Phase (sicher)

**Zweck:** Wiederherstellung von Paketen, deren Tail-Phase wegen obsoleter
failed Jobs, Gate-Widersprüchen oder Pending-Enqueue-Drift hängt.

**Niemals** ohne Forensik-Checkliste anwenden.

## ⚠️ Forensik-Checkliste (Pflicht vor jedem manuellen Heal)

1. **Approved-Artefakte prüfen** — `≥ 50` für Tail-Bypass, `≥ 158` für Auto-Publish:
   ```sql
   SELECT COUNT(*) FROM exam_questions WHERE package_id = $1 AND status='approved';
   ```
2. **Aktive Jobs zählen** — *wenn > 0, NICHT manuell heilen, abwarten*:
   ```sql
   SELECT COUNT(*) FROM job_queue WHERE package_id=$1 AND status IN ('pending','processing');
   ```
3. **Gate-Class prüfen** — bei `terminal` zuerst Quarantäne klären:
   ```sql
   SELECT gate_class, status FROM course_packages WHERE id=$1;
   SELECT * FROM package_quarantine WHERE package_id=$1 AND released_at IS NULL;
   ```
4. **Tail-Step-Alter** — > 10 Min queued/pending_enqueue:
   ```sql
   SELECT step_key, status, updated_at FROM package_steps
   WHERE package_id=$1 AND status::text IN ('queued','pending_enqueue');
   ```
5. **Snapshot vorher** — IMMER zuerst:
   ```sql
   SELECT public.fn_snapshot_package_layers($1);
   ```

## ✅ Sichere Bypass-Strategien

### Strategie A — Obsolete Failed Jobs Cleanup (Auto)
Self-healing via Cron alle 10 Min, oder manuell:
```sql
SELECT public.fn_detect_obsolete_failed_tail_jobs(false, true); -- live + debug
```

### Strategie B — Gate-Conflict Quarantäne
```sql
SELECT public.fn_quarantine_terminal_gate_conflicts(false);
```

### Strategie C — Atomic Nudge (nur wenn A nicht greift)
```sql
UPDATE package_steps
SET meta = COALESCE(meta,'{}'::jsonb) - 'last_atomic_enqueue_at',
    updated_at = now()
WHERE package_id=$1 AND step_key=$2
  AND status::text IN ('queued','pending_enqueue');
```
**`started_at` NIEMALS direkt manipulieren** — Skip-Guards umgehen sich nur via:
- `meta - 'last_atomic_enqueue_at'` (Debounce-Reset)
- `exception_approved=true + exception_reason='manual_bypass:<grund>'`

### Strategie D — Quarantäne lösen (nach Review)
```sql
UPDATE package_quarantine
SET released_at=now(), released_by='admin:<name>'
WHERE package_id=$1 AND released_at IS NULL;
```

## 📜 Auditpflicht
Jeder manuelle Eingriff MUSS in `heal_audit_layers` mit allen 5 Ebenen
(Symptom/Step/DAG/Gate/Artifact) before+after geloggt werden. Beispiel:
```sql
INSERT INTO heal_audit_layers (package_id, trigger_source, action_type,
  symptom_before, symptom_after, ..., notes)
VALUES ($1, 'manual:<user>', 'manual_bypass_<grund>',
  (SELECT public.fn_snapshot_package_layers($1)->'symptom'), ..., 'Begründung');
```

## 🚫 Anti-Patterns
- `started_at` zurücksetzen, um Skip-Guard zu umgehen → erzeugt Drift
- `gate_class='terminal'` ohne Quarantäne ignorieren → Deadlock
- Failed Jobs löschen statt cancellen → Audit-Verlust
- `package_steps.status` direkt auf `done` ohne `exception_approved` → SSOT-Bruch

## Cron-Coverage
| Cron | Schedule | Zweck |
|---|---|---|
| `tail-obsolete-failed-jobs-cleanup-10min` | `*/10 * * * *` | Pattern X1 (this) |
| `gate-conflict-quarantine-30min` | `*/30 * * * *` | Pattern X2 (this) |
| `pipeline-step-drift-v3-heal-5min` | `*/5 * * * *` | 29 Pipeline-Steps |
| `tail-step-drift-v2-heal-10min` | `*/10 * * * *` | 7 Tail-Steps Enqueue-Drift |
| `detect-exam-pool-drift-15min` | `*/15 * * * *` | Exam-Pool spezifisch |
