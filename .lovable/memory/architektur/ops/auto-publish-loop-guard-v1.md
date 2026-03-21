# Memory: architektur/ops/auto-publish-loop-guard-v1
Updated: 2026-03-21

Der `package_auto_publish` Loop Guard (v2) schützt vor endlosen Gate-Loops und heilt gleichzeitig identifizierbare Root Causes.

## Dreistufige Logik im job-runner

**Stufe 1 — Root-Cause-Analyse** (vor jedem Loop-Guard-Check):
1. **Council-Session-Check:** Sind `council_sessions` noch pending?
   - Step `quality_council` = `done` + Sessions pending → SSOT-Widerspruch → Step auf `queued` zurücksetzen
   - Step `queued`/`failed` ohne aktiven Job → `package_quality_council` enqueuen
2. **Integrity-Staleness-Check:** Council fertig, aber `run_integrity_check` veraltet?
   - Wenn `decided_at` der jüngsten Council-Session neuer als `integrity_updated_at` → Integrity-Step auf `queued` zurücksetzen + Job enqueuen
   - Auch bei `run_integrity_check` != `done` ohne aktiven Job → Job enqueuen
3. Root Cause gefunden → Job als `ROOT_CAUSE_HEALED` canceln, kein Loop-Guard-Block

**Stufe 2 — Loop Guard:** Wenn keine Root Cause identifiziert: nach 3 deterministischen Cancels in 2h → `status=blocked`, P0-Notification

**Stufe 3 — Terminal Block:** Step + Package werden blocked, alle pending Jobs gecancelt

## Strukturelle DB-Absicherungen

- **Trigger `trg_guard_quality_council_done`:** Verhindert, dass `quality_council` auf `done` gesetzt wird, solange Sessions pending sind. Eliminiert die SSOT-Widerspruch-Klasse strukturell.
- **RPC `heal_true_stall_steps()`:** 15-Minuten-Schwellenwert, 10 Steps/Lauf, nutzt `ops_pipeline_step_drift.drift_signal = 'TRUE_STALL'`

## Drift-View Signalklassen (`ops_pipeline_step_drift`)

| Signal | Bedeutung |
|--------|-----------|
| `SSOT_MISMATCH_COUNCIL_DONE_BUT_PENDING` | Council-Step done aber Sessions offen |
| `INTEGRITY_STALE_AFTER_COUNCIL` | Integrity-Check veraltet nach Council-Aktivität |
| `LOOP_GUARD_BLOCKED` | Auto-publish durch Loop-Guard blockiert |
| `TRUE_STALL` | Queued + prereqs done + kein Job + >15min |
| `WAITING_PREREQS` | Korrektes Warten auf Upstream |
| `PREMATURE_JOB_DISPATCH` | Job aktiv obwohl Prereqs fehlen |
| `PENDING_DISPATCH` | Frisch queued, Prereqs done, noch kein Job (<15min) |
