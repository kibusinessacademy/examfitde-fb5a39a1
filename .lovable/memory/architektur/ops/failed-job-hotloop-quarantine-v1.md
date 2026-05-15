---
name: Failed-Job Hotloop Quarantine v1
description: Generischer Schutz gegen deterministische Failure-Loops in job_queue. Helper fn_normalize_job_error_code (NULL→PRE_HEARTBEAT_KILL), View v_failed_job_hotloops_24h (≥5 Fehler), RPCs admin_get_failed_job_hotloops_24h + admin_quarantine_job_hotloop, fn_auto_quarantine_failed_hotloops (Cron 240, alle 30min, threshold=20). Active-Job-Dedup-Trigger für tutor_index types + tutor_index_quarantine flag honoring. Bronze manual_bypass auto-expiriert nach erstem post-bypass Fail (trg_bronze_manual_bypass_auto_expire). UI: FailedJobHotloopsCard im Heal-Cockpit.
type: feature
---

## Sofort-Stopp 2026-05-15
- 217 Tutor-Index Jobs für 3 Pakete (4d4e1f9f, 913605e4, 42bdd4d8) cancelled.
- Root: TOO_FEW_CHUNKS 12-13/20 Materialization-Loop, NICHT CPU-Kill.
- `feature_flags.tutor_index_quarantine.active=true` blockt weitere Jobs via Trigger.

## Bronze-Loophole geschlossen
- `fn_is_bronze_locked` schaltet bei `manual_bypass:true` komplett ab.
- Cluster-A (manual_bypass von 2026-05-05/07) liefert seitdem unbegrenzt integrity_check Jobs.
- Fix: `trg_bronze_manual_bypass_auto_expire` deaktiviert manual_bypass bei erstem failed integrity_check NACH bypass_at → Bronze-Guard greift wieder.

## Verifikation
- Tutor-Index aktive Jobs: 217 → 0.
- Hotloops 24h: 12 (6 ≥20, Auto-Quarantine-Kandidaten beim ersten Cron-Tick).
- Top-Loops: GATE_NOT_PASS für package_repair_exam_pool_lf_coverage (248, 170) — separates Issue, nicht in Scope.
