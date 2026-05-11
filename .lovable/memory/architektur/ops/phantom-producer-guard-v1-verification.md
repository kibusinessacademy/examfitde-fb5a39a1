---
name: Phantom Producer Guard v1 — Smoke + Verification Result
description: Smoke-RPC admin_smoke_phantom_producer_guard_v1 + Pre/Post-Install Vergleich der STEP_ALREADY_DONE_PHANTOM-Cancels.
type: feature
---

# Phantom Producer Guard v1 — Smoke + Verification

## Smoke RPC
`admin_smoke_phantom_producer_guard_v1()` (admin-only) deckt ab:
- **Guard A (recent_finalized_step <60s):** done / skipped / failed (3 Tests) + Negativfall done >60s
- **Guard B (recent_duplicate_job <60s):** queued / pending / processing / retry_scheduled (4 Tests) + Negativfall >60s
- Ephemeres Test-Paket, explizite Cleanup am Ende, Audit `phantom_producer_guard_v1_smoke_run`
- Bekannte Limitierung: B-Tests hängen an `job_queue_status_enum`-CHECK (nicht alle 4 Status sind als reine INSERT-Werte erlaubt). Guard B ist stattdessen durch Production-Audit (`atomic_enqueue_skipped_recent_finalized_step` Hits) verifiziert.

Sekundärer Artefakt-Test: `supabase/tests/phantom_producer_guard_v1_smoke.sql` (DO-Block + ROLLBACK), nur lauffähig mit DB-Owner-Privilegien.

## Verification (Pre/Post Install Vergleich)
Install-Zeitpunkt: 2026-05-11 18:47:19 UTC

| Phase         | Phantom-Cancels | Span (min) | Rate (Cancels/min) |
|---------------|-----------------|------------|--------------------|
| pre_install   | 171             | 31.8       | **5.38**           |
| post_install  | 53              | 11.1*      | **4.78**           |

*Window weiter offen; Sample noch klein. Erste Reduktion sichtbar, aber keine ~74%-Eliminierung erreicht.

**Befund:** Guards greifen erst bei <60s alten Finalisierungen. Forensische Stichprobe der 24 Post-Install-Cancels im 18:49-Burst zeigte Steps, deren `finished_at` 3–12 Tage zurücklag (313s … 1.091.195s) — Guard A's 60s-Window passt strukturell nicht. Diese Cancels stammen aus Healer-Promotions alter `done`-Steps zurück nach `queued`.

**Konsequenz:** Fix #1 schließt den Microburst-Producer-Pfad (gleicher Step flickt done→queued in Sekunden), nicht das eigentliche Volumen. Echte Reduktion kommt erst mit Fix #2 (Tail-Healer-Cooldown) + Resolver-NO_EFFECT-Loop-Fix.

**Empfehlung:** Fix #2 als nächstes priorisieren — `queued_tail_reconciler_enqueue` und `tail_step_drift_v2_heal` ohne per-package Cooldown sind die echte Quelle der Bursts.
