---
name: Pattern X14 — Plateau-Defer Drift Loop (Tail-Step)
description: Tail-Steps (run_integrity_check/quality_council) bleiben endlos auf queued ohne Job, weil Defer-Logik bei stabilen Score-Plateaus keine neuen Jobs anstößt
type: feature
---

## Problem (2026-05-02 09:30)
DAG-Audit zeigte: 91 `package_auto_publish` Jobs pending, 19 building-Pakete in Defer-Schleife.
- `auto_heal_log.action_type='tail_step_retryable_deferred'`: 190× in 6h
- Identische Score-Plateaus (z.B. 93/93/93, 91/91/91, 82/82/82) → `defer_reason=TAIL_STEP_RETRYABLE_WITH_ARTIFACTS`, `min_improvement=3`, `score_range=0`
- Tail-Steps `run_integrity_check`/`quality_council` = `queued` ohne aktiven Job
- Dedup-Cooldown (Pattern X12, 30s) blockiert Re-Enqueue zusätzlich
- 17 von 19 Plateau-Paketen haben gleichzeitig pending `auto_publish` Jobs → kein Fortschritt

## Root-Cause
Die Defer-Logik (`fn_record_integrity_run_and_check_progress` → "Tail-Step Artifact-Aware Defer", Memory v1) **schiebt korrekt nicht zu blocken**, aber sie **enqueued nichts neu**. Sie nimmt an, dass ein anderer Heiler den nächsten Job triggert. Tut aber niemand:
- `tail_step_drift_v2_heal` läuft, sieht den Plateau-Score und respektiert die Defer-Sperre
- Pattern X12 Cooldown verhindert spontane Re-Enqueues
- → Endlos-Drift bei objektiv "good enough" Paketen

## Fix (Migration 20260502_x14_plateau_heal)
`fn_heal_plateau_defer_loop_x14()`:
1. Findet Pakete mit ≥3 `tail_step_retryable_deferred` Logs in 6h
2. Cancelt stale pending Tail-Jobs (`auto_publish`, `quality_council`, `run_integrity_check`) → bricht Cooldown-Lock
3. Enqueued frischen `package_run_integrity_check` Job mit `enqueue_source='pattern_x14_heal'`
4. Worker-Pfad finalisiert sequenziell integrity → council → auto_publish (reguläre DAG-Promotion)
5. Loggt jede Aktion in `auto_heal_log` als `pattern_x14_plateau_heal`

Cron `pattern-x14-plateau-heal-30min` (alle 30 Min) als Sicherheitsnetz.

## Sofortige Wirkung (2026-05-02)
18 Plateau-Pakete requeued, 15 frische integrity-Jobs pending innerhalb 30s. Pakete: BWL-Steuern, Glasapparatebauer, Fachinformatiker, Bankfachwirt, Versicherungs-Fachwirt u.a.

## Invariante
Wenn `auto_heal_log` für ein Paket ≥3× `tail_step_retryable_deferred` in 6h zeigt UND das Paket auf `building` steht, dann **muss innerhalb 30 Min ein neuer Tail-Job enqueued werden**. Andernfalls hängt das Paket dauerhaft.

## Beziehung zu anderen Patterns
- **X12** (Triple-Enqueue Race / Dedup Cooldown): X12-Guard wird durch X14-Heal vorab gebrochen via Cancel der alten Jobs.
- **X13** (DAG Enqueue-Drift): X13 deckt Drift bei nie-enqueueten Steps ab. X14 deckt Drift bei chronisch-deferred Tail-Steps ab.
- **Tail-Step Artifact-Aware Defer** (Memory): Defer bleibt korrekt; X14 ist der "Wake-Up"-Counterpart.
