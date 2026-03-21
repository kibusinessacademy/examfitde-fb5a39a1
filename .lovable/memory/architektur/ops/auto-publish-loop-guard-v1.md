# Memory: architektur/ops/auto-publish-loop-guard-v1
Updated: 2026-03-21

Der `package_auto_publish` Loop Guard (v2) verhindert endlose Job-Spam-Loops bei deterministischen Gate-Fehlern. **Neu in v2:** Bevor der Loop Guard greift, prüft der job-runner eine Root-Cause-Analyse:

1. **Council-Session-Check:** Sind `council_sessions` noch `pending`? Falls ja:
   - Wenn `quality_council` Step = `done` aber Sessions pending → SSOT-Widerspruch: Step wird auf `queued` zurückgesetzt (Council-Done-Invariant-Trigger `trg_guard_quality_council_done` verhindert dies künftig strukturell).
   - Wenn `quality_council` Step = `queued`/`failed` ohne aktiven Job → `package_quality_council` Job wird enqueued.
2. **Integrity-Check:** Wenn Council fertig, aber `run_integrity_check` nicht `done` und kein aktiver Job → `package_run_integrity_check` wird enqueued.

Nur wenn keine Root Cause identifiziert werden konnte, greift der bisherige Loop Guard: Nach 3 Cancellations innerhalb von 2 Stunden → `status=blocked`, P0-Notification, alle pending Jobs gecancelt.

**Strukturelle Absicherung:** Der DB-Trigger `trg_guard_quality_council_done` auf `package_steps` verhindert, dass `quality_council` jemals auf `done` gesetzt werden kann, solange noch `council_sessions` im Status `pending`/`running` existieren. Dies eliminiert die SSOT-Widerspruch-Klasse an der Quelle.

**TRUE_STALL Healing:** Die RPC `heal_true_stall_steps()` wurde auf 15-Minuten-Schwellenwert und 10 Steps pro Lauf gehärtet (vorher 120min/5). Sie dispatcht fehlende Jobs automatisch für Steps mit Signal `TRUE_STALL` aus `ops_pipeline_step_drift`.
