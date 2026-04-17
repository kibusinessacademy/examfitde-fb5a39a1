---
name: Runner-Idle Detection & Status-Drift Auto-Promoter v1
description: v_runner_idle_anomaly erkennt RUNNER_IDLE Patterns; auto_promote_status_drift + auto_resume_blocked_with_progress beheben BUILDING_WITHOUT_ACTIVE_JOB Drift und reaktivieren reparierte Pakete unter WIP-Cap 8
type: feature
---

**Drei Komponenten gegen RUNNER_IDLE und Status-Drift:**

1. **`v_runner_idle_anomaly`** klassifiziert Runner über die letzten 30min:
   - `IDLE_ALL_FAILING` — alive, claimt, aber 0 Erfolge → typisch bei Zombie-Job-Loop (z.B. Textilreiniger-Stale-Heartbeat)
   - `IDLE_NOT_CLAIMING` — alive, Queue hat pending Jobs, aber Runner claimt nicht → Filter-Mismatch / Lane-Drift
   - `IDLE_QUEUE_EMPTY` — erwarteter Idle-Zustand (kein Alarm)
   - `HEALTHY` — alles ok

2. **`auto_promote_status_drift(p_limit int)`** — reconcileert `BUILDING_WITHOUT_ACTIVE_JOB`:
   - Findet `course_packages.status='building'` mit allen `package_steps` in `done|skipped`
   - Klassifiziert via `v_package_release_classification`:
     - `release_ok` → status='published' + published_at=now()
     - sonst → status='blocked' mit `blocked_reason` aus erlaubter Taxonomie (`content_gap` für release_block, `pipeline_repair_required` sonst)
   - Audit in `admin_actions`

3. **`auto_resume_blocked_with_progress(p_limit int)`** — Anti-Stuck-Backlog:
   - Holt blocked Pakete deren Klassifikation auf `release_ok|warn` verbessert wurde
   - Skipt Pakete mit content_gap / admin_hold / manual_review_required (echte Blocker)
   - Setzt published wenn release_ok, sonst building
   - Respektiert WIP-Cap=8 (zählt aktive `building` Pakete)
   - Priorisiert nach `v_package_build_priority.effective_priority`

**Reason-Taxonomie (durchgesetzt von `fn_guard_blocked_requires_reason`):**
admin_hold, content_gap, manual_review_required, compliance_hold, pipeline_repair_required, awaiting_source_data, intentional_pause, missing_exam_pool, missing_handbook, auto_heal_zombie, governance_backfill_unknown — oder `other:<frei>` Prefix.

Beide Funktionen sind SECURITY DEFINER und für Cron/Admin-Trigger geeignet. Sollten in `control-plane-cron` jede 5–10min ausgeführt werden, um permanenten Drift zu verhindern.
