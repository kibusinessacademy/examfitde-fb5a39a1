---
name: Phantom Producer Guard v1 — Smoke + Verification Result
description: Smoke-RPC admin_smoke_phantom_producer_guard_v1 (gehärtet mit EXCEPTION-Cleanup) + Pre/Post-Install Vergleich der STEP_ALREADY_DONE_PHANTOM-Cancels.
type: feature
---

# Phantom Producer Guard v1 — Smoke + Verification

## Smoke RPC (gehärtet)
`admin_smoke_phantom_producer_guard_v1()` (admin-only, GRANT EXECUTE TO authenticated/service_role/anon, Admin-Gate intern).

Hardening:
- **EXCEPTION-Block** garantiert Cleanup auch bei unerwarteten Fehlern (job_queue, package_steps, course_pipeline_events, auto_heal_log, course_packages).
- **B1-Loop:** per-Iteration `EXCEPTION WHEN check_violation` markiert nicht-insertable Statuses (queued, retry_scheduled) als `skipped:true` statt failure — `job_queue_status_enum` lässt nur pending/processing/completed/failed/cancelled zu.
- **B-Tests** nutzen kanonischen step_key (damit Trigger einen registrierten job_type ableitet) + Audit-Delta-Messung statt target_id-Match.

Ergebnis Run 2026-05-11 19:38 UTC:
```
ok=true, passed=7, failed=0, skipped=2
A1_done_lt60s             ✓ (jobs=0, audits=1)
A2_skipped_lt60s          ✓
A3_failed_lt60s           ✓
A4_done_gt60s_negative    ✓ (kein Audit, korrekt)
B1_dup_pending_lt60s      ✓ (jobs=1, audit_delta=1)
B1_dup_processing_lt60s   ✓
B1_dup_queued             ⊘ skipped (CHECK)
B1_dup_retry_scheduled    ⊘ skipped (CHECK)
B2_dup_gt60s_negative     ✓ (kein Audit, korrekt)
```

## Verification (Pre/Post Install Vergleich)
Install-Zeitpunkt: 2026-05-11 18:47:19 UTC

| Phase         | Phantom-Cancels | Span (min) | Rate (cancels/min) |
|---------------|-----------------|------------|--------------------|
| pre_install   | 171             | 34.0       | **5.03**           |
| post_install  | 97              | 51.7       | **1.88**           |

→ **~63 % Reduktion**.

Production Guard-Hits (post): `atomic_enqueue_skipped_recent_finalized_step` = 2, `atomic_enqueue_skipped_recent_duplicate` = 0 in 6h.

**Befund:** Guards greifen — aber nur 2 Microburst-Hits erklären den Rückgang nicht alleine. Wahrscheinlich Mit-Effekt anderer parallel laufender Heal-Loop-Stabilisierungen. Die echten Phantom-Quellen sind weiterhin Healer-Promotions alter `done`-Steps (3–12 Tage zurück), die das 60s-Window strukturell verfehlen.

**Konsequenz:** Fix #2 (Tail-Healer-Cooldown für `queued_tail_reconciler` und `tail_step_drift_v2_heal`) bleibt der nächste priorisierte Schritt, um das verbleibende Volumen zu eliminieren.
