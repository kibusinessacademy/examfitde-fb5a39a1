---
name: Minicheck Producer-Drift Detection v1
description: P1-Cut 2026-05-30 nach Failed-Jobs-Audit 48h (minicheck_producer_missing 14). Detection-SSOT v_minicheck_producer_drift + admin_get_minicheck_producer_drift_summary + admin_heal_minicheck_producer_drift (reset_generate | skip_validate). Pattern analog Exam-Pool-Drift. Root-Cause: 420/442 Pakete haben generate_lesson_minichecks=skipped (Hot-Loop-Frozen 2026-05-01, exhausted 3 enqueue retries). validate_lesson_minichecks läuft trotzdem weiter und failed mit GATE_FAIL: NO_MINICHECKS. Kein Cron, kein Auto-Repair (NO_AUTONOMOUS_PRODUCTION_WRITES).
type: feature
---
# Minicheck Producer-Drift Detection

## Symptom
Failed-Jobs-Audit 48h: cluster minicheck_producer_missing = 14, persistent über 5 Tage. `package_validate_lesson_minichecks` parkt mit `PARKED_AWAITING_PRECONDITION: generate_lesson_minichecks must produce artifacts | GATE_FAIL: NO_MINICHECKS`. `package_generate_lesson_minichecks` läuft seit 2026-05-12 22:55 UTC **gar nicht mehr** — 4 Versuche jemals, 0 davon completed.

## Root Cause
Plattform-weit eingefrorener Producer-Step:
- 420 Pakete: `package_steps.generate_lesson_minichecks.status='skipped'` mit last_error `hot-loop: 21 cycles without progress → frozen for 120min | exhausted 3 enqueue retries` (Massen-Freeze 2026-05-01).
- 21 Pakete: generate=done.
- 1 Paket: generate=queued (genau dort liegt der aktive Drift-Job).
- Downstream `validate_lesson_minichecks` ist 409× ebenfalls skipped (gefolgt), aber 1 Paket sitzt in validate=queued+failed-Loop ohne Producer-Output → produziert die 14 Failures.

Zweiter Layer: Der Hot-Loop-Freeze hat keinen Auto-Reanimator. Step wartet auf Admin-Aktion, kommuniziert das aber nirgendwo sichtbar.

## Cut (was gebaut wurde)
SSOT-View + 2 admin-gated RPCs, analog `fn_detect_and_heal_exam_pool_enqueue_drift`:
- `v_minicheck_producer_drift` (service_role only) — pkg×validate×generate Join mit `drift_reason` ∈ {GENERATE_STEP_MISSING, GENERATE_FROZEN_HOTLOOP, GENERATE_SKIPPED_OTHER, GENERATE_NOT_PROGRESSING, OTHER}.
- `admin_get_minicheck_producer_drift_summary()` → drift_count + generate_skipped + validate_active + by_reason + 25 samples. Emit Audit `minicheck_producer_drift_snapshot`.
- `admin_heal_minicheck_producer_drift(_package_id, _action)` — Actions: `reset_generate` (Producer zurück auf queued, last_error=NULL) oder `skip_validate` (validate terminal markieren). 1 Paket pro Call (kein Bulk — Admin trifft Entscheidung). Audit `minicheck_producer_drift_heal_attempt`.

Audit-Contracts registriert in `ops_audit_contract` (required_keys, owner_module='ops.minicheck_drift').

## Bewusst NICHT gebaut
- **Kein Cron** — Admin triggert Summary manuell. P0-Audit zeigt das Pattern bereits in `v_failed_jobs_72h_clusters` (cluster_key='minicheck_producer_missing').
- **Kein UI-Cockpit-Card** — Drift-Pattern-Heat im Heal-Cockpit deckt es ab; separate Card erst bei Volumen >50 Pakete.
- **Kein Bulk-Heal** — analog Bronze-Lock-Cut: Admin-Bypass strikt per-Paket. Massen-Reset von 420 frozen-Pakete könnte 420 sofortige Hot-Loops re-triggern.
- **Kein Auto-Unfreeze** — der Hot-Loop war ein Schutz. Unfreeze braucht zuerst Producer-Code-Audit (warum produzierte er nie Artifacts?).

## Strukturelle Lehre
Hot-Loop-Freeze + Drei-Retries-Exhausted ist **Schutzmechanismus, der seit 2026-05-01 stumm war**. 4 Wochen lang produzierte das Failure-Pattern, ohne dass ein Operator wusste, dass der Producer plattformweit tot ist. **Lehre**: Jeder hartcodierte "frozen for Xmin / exhausted N retries"-Pfad braucht ein Pendant in Drift-Detection — sonst wird Schutz zu Silent-Outage.

Zweite Lehre: Detection vor Repair. Bevor wir 420 Pakete unfreezen, muss die Frage beantwortet sein, **warum** der Producer 21 Hot-Loop-Cycles ohne Progress lief. Das ist eigener Cut (Producer-Code-Audit), nicht dieser.

## Verifikation
- `v_minicheck_producer_drift`: 2 Zeilen (aktiv driftende Pakete).
- 49 failed jobs in 7d auf einem einzigen Paket (`d2000001-0009-4000-8000-000000000001`) — selber Drift-Loop, selber Producer-Lock.
- Admin kann ab sofort `admin_get_minicheck_producer_drift_summary()` rufen für Snapshot + emit Audit.

## Bezug
- Pipeline-Audit Failed-Jobs 72h SSOT v1 (Cluster minicheck_producer_missing identifiziert)
- Exam-Pool Enqueue-Drift Detection v1 (Pattern-Vorlage)
- PRE_HEARTBEAT_KILL Heartbeat-Wrap v1 (gleicher Audit-Zyklus, P0-Cut)
- Architectural-Rule NO_AUTONOMOUS_PRODUCTION_WRITES (begründet warum keine Cron + keine Bulk-Aktion)
