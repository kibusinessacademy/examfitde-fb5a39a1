---
name: Enqueue-Dedup Burst-Window Guard (Pattern X12)
description: enqueue_job_if_absent erweitert um pg_advisory_xact_lock + 30s Cooldown-Window auf (job_type, package_id, step_key). Schließt Burst-Race und Re-Enqueue-vor-Reconcile. Audit action_type='enqueue_dedup_cooldown_x12'.
type: feature
---

## Symptom (Forensik 24h, 2026-05-02)
- 5.700+ untagged Cancels — alle ohne `enqueue_source`. Kein Drift-Guard greift, weil Producer kein Tag setzt.
- Top: `package_generate_exam_pool` 2.063 cancelled vs 1.092 completed → 1.9× Burst-Faktor.
- Hauptreason `step_finalized` (394/6h) — Schwester-Inserts werden gecancelt nachdem ein Job den Step finalisiert.
- Beispielpaket Gießereimechaniker: Triple-Insert alle 10–15 min (1 completed + 2 cancelled gleichzeitig).

## Root Cause
`enqueue_job_if_absent` Dedup-Check filtert nur auf `status IN active`:
1. **Burst-Race**: 2 Inserts in derselben ms → beide sehen `not found` → beide INSERT.
2. **Re-Enqueue-vor-Reconcile**: Job grade `completed` (vor <60s), Trigger feuert sofort wieder, Step noch `queued` → Phantom-Guard greift nicht.

## Fix
Zwei zusätzliche Schichten **vor** dem aktiven-Duplikat-Check:

### 1) `pg_advisory_xact_lock(hash(job_type|package_id|step_key))`
Serialisiert echte parallele Transaktionen. Auto-Release bei COMMIT/ROLLBACK. Kein Deadlock-Risiko, da single key per call.

### 2) 30s Cooldown-Window
```sql
SELECT id, status, updated_at FROM job_queue
 WHERE job_type=p_job_type AND package_id=p_package_id
   AND coalesce(meta->>'step_key',...) = v_step_key
   AND updated_at > now() - interval '30 seconds'
 ORDER BY updated_at DESC LIMIT 1;
```
Wenn FOUND → Reject mit status `cooldown_dedup`, Audit `enqueue_dedup_cooldown_x12` mit `pattern=X12`, `last_status`, `last_error_code`, `age_ms`.

Cooldown blockiert auch nach `completed`/`cancelled`/`failed` — Reconcile-Trigger braucht ~1-2s bis Step-Sync, bis dahin würde jeder Re-Enqueue-Versuch Phantom-Risiko erzeugen.

## Wirkung
- Triple-Insert-Bursts → 1 Insert + 2 cooldown_dedup Rejects (geloggt, nicht in job_queue).
- `step_finalized` Cancel-Sweep wird größtenteils obsolet (Sweep bleibt als Belt-and-Suspenders).
- Audit-Volume: erwartete ~5.000+ Rejects/24h initial, abnehmend wenn Producer Tag-Hygiene nachzieht.

## Heilung Gießereimechaniker (d1047bc8-...)
- 4 quality_council pending/failed + auto_publish-Loops cancelled mit `PATTERN_X12_QC_LOOP_HEAL`.
- Steps `quality_council` + `auto_publish` reset auf `queued`, attempts=0.
- Atomic-Trigger erzeugte sofort 1 frischen pending Job (X12-Guard ließ Single-Insert durch — korrekt).

## Files
- Migration: `20260502073606_*.sql`
- Index-Update: `enqueue-dedup-burst-window-pattern-x12-v1` ergänzt.
