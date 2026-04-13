# Job-Completion-Hardening v1: Status-Konvergenz-Fix

## Umgesetzt: 2026-04-13

### Problembild
Nur 2-3 Job-Typen (handbook_expand_section, package_exam_rebalance, package_validate_exam_pool) erreichten zuverlässig `completed`. Alle anderen endeten massenhaft in `cancelled` — obwohl die fachliche Arbeit (Artefakte, Steps) erfolgreich war.

### Root Causes (forensisch bestätigt)

1. **Status-Regression ohne CAS**: Kein Schutz gegen Überschreibung terminaler Zustände. Healer/Reaper/Guardian konnten `completed` → `pending` zurücksetzen.
2. **Step-Done-Trigger killte processing Jobs**: `trg_cancel_orphan_jobs_on_step_done` cancelte `processing` Jobs wenn der Verifier-Reconciler einen Step finalisierte — mitten in der Runner-Ausführung.
3. **Non-Building Reaper zu aggressiv**: Cancelte alle pending Jobs wenn Package auf `quality_gate_failed` kippte — auch konvergenzrelevante Reparatur-Jobs.
4. **Batch-Completion zu früh**: `batch-result-importer` markierte Source-Job als completed sobald *eine* Request importiert wurde — bei Multi-Request-Jobs (Handbook: 8 Sections) entstand false-complete.
5. **Silent Cancels ohne Audit**: 16+ Jobs mit NULL `last_error` cancelled durch Cron-Funktionen.

### Fixes

#### P0: CAS-Guard (DB-Trigger)
- `trg_guard_terminal_status_regression` auf `job_queue` BEFORE UPDATE
- Verhindert: `completed|failed|cancelled` → `pending|processing|batch_pending`
- Silently keeps old status (kein RAISE, verhindert Rollback-Kaskaden)
- Logged blocked regressions via `fn_log_guardrail_event`

#### P1: Step-Done-Trigger gehärtet
- `fn_cancel_orphan_jobs_on_step_done` cancelt nur noch `pending` Jobs
- `processing` Jobs werden nicht mehr angefasst → Runner kann natürlich abschließen
- Audit-Log mit `processing_preserved: true`

#### P2: Non-Building Reaper policy-aware
- `quality_gate_failed` und `publish_failed` whitelistet (brauchen Reparatur-Jobs)
- `system-orphan-reaper` ebenfalls angepasst
- Cancel-Taxonomie: `meta.cancel_reason` + `meta.cancel_source` auf allen Cancel-Pfaden

#### P3: Batch-Completion aggregiert
- `batch-result-importer` gruppiert Requests per `source_job_id`
- Job wird erst `completed` wenn ALLE zugehörigen Requests terminal sind
- Verhindert MATERIALIZATION_GUARD failures bei Handbook-Expansion (4/8 Sections)

### Invarianten
- Terminale Zustände sind monoton: einmal terminal, immer terminal
- Source-Job-Terminalität ≤ Artefakt-Terminalität
- Kein Cancel ohne `cancel_reason` + `cancel_source`
