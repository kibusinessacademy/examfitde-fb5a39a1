
# PIPELINE.RECOVERY.OS.3 — Lane Dispatcher Repair

Aufsatz auf OS.1 (Plan) + OS.2 (Run+Verify). OS.3 schließt die **Dispatcher-Lücke**: Loops stoppen am Worker, Planning-Hänger werden diagnostiziert vor Restart, und failed Done-Reaudits werden nicht endlos retriggert.

## Hard Guardrails (unverändert ggü. OS.1/OS.2)
- Kein direkter Schreibzugriff auf `integrity_passed`, `council_approved`, `is_published`.
- Kein Auto-Approve, kein Publish-Bypass.
- Alle Aktionen idempotent, auditiert via `auto_heal_log` + `fn_emit_audit`.
- CI-Guard `guard-recovery-forbidden.mjs` wird auf neue Edge Functions erweitert.

---

## Cut 1 — LF Quarantine Guard (Worker-seitig)

**Problem:** Quarantine-Ledger wird gesetzt (OS.2 fix), aber `package_repair_exam_pool_lf_coverage` fragt ihn nicht ab → 9 unnötige Cycles trotz Quarantäne.

**Lösung — Pure SSOT** `src/lib/pipelineRecovery/quarantineGuard.ts` (+ Edge-Mirror):
- `isPackageQuarantined(packageId, reasonCode, ledgerRows)` → boolean
- Allowlist: `LF_REPAIR_LOOP`, `MAX_ATTEMPTS_EXHAUSTED`, `PROVIDER_LOOP_GUARD`
- Status-Filter: `under_review` blockt Requeue; `cleared` lässt durch.

**Worker-Patches (read-only Gate, kein Mutationspfad):**
- `supabase/functions/package_repair_exam_pool_lf_coverage/index.ts`: vor Enqueue → Ledger-Lookup → bei Treffer `auto_heal_log` mit `action_type='skipped_due_to_quarantine'` + early return.
- Analog für `package_repair_exam_pool_lf_assign`, falls vorhanden (rg vorab prüfen).

**SQL-Helper-View** `v_active_quarantine_packages` (kein neues Table):
```sql
SELECT DISTINCT package_id, reason_code, status
FROM package_quarantine_ledger
WHERE status = 'under_review';
```

---

## Cut 2 — Planning Dispatcher Diagnose

**Problem:** OS.1 `restart_planning` enqueued, aber Jobs bleiben pending → Dispatcher liest nicht oder Routing falsch.

**Lösung — Pure SSOT** `src/lib/pipelineRecovery/planningDiagnosis.ts`:
- Input: `job_queue` Rows + `ops_worker_heartbeats` + `job_type_quarantine` + `job_type_policies`.
- Output: `PlanningDiagnosis` mit Cause-Enum:
  - `WORKER_HEARTBEAT_STALE` (>10min)
  - `JOB_TYPE_QUARANTINED`
  - `POOL_MISMATCH` (queue.worker_pool ≠ policy.worker_pool)
  - `CLAIM_LOST` (processing >30min, kein Heartbeat-Update)
  - `DISPATCHER_OFF` (kein Worker für Pool aktiv)
  - `HEALTHY_BUT_PENDING` (kein erkennbarer Block)
- **Restart nur, wenn Cause ∈ {CLAIM_LOST, HEALTHY_BUT_PENDING}**. Sonst → `manual_review_required` + Reason.

**Edge Function `pipeline-recovery-diagnose`** (read-only):
- Aggregiert Diagnose für alle 17 stuck planning packages.
- Schreibt Snapshot in `pipeline_recovery_plans.summary.diagnosis`.

**Plan-Erweiterung:** `planningRecovery.ts` ruft `planningDiagnosis` und emittiert nur dann `restart_planning`, wenn Diagnose grünes Licht gibt — sonst `mark_manual_review_required` mit Diagnose-Cause als Reason.

---

## Cut 3 — Quality No-Progress Lock

**Problem:** 23 `done`-Pakete failen Reaudit → Cron würde sie täglich erneut enqueuen → Worker-Noise + kein realer Fortschritt.

**Lösung — Pure SSOT** `src/lib/pipelineRecovery/qualityNoProgress.ts`:
- Input: package_id, letzter Reaudit-Run aus `pipeline_recovery_actions`, content-/lf-fix-Signale aus `auto_heal_log` + `package_steps.updated_at`.
- Regel: `daysSinceLastReaudit ≥ 1 && !contentOrLfFixSince(lastReauditAt)` → `quality_no_progress=true`.
- Konsequenz: `enqueue_done_reaudit` wird im Plan **unterdrückt**, stattdessen Action `lock_bronze_review` (idempotent: setzt nur Quarantine-Ledger-Marker, kein Quality-Flag-Mutation).

**Neue Action-Type** in `pipeline-recovery-act`:
- `lock_bronze_review` → INSERT `package_quarantine_ledger` mit `reason_code='QUALITY_NO_PROGRESS'`, `status='under_review'`, `details->>'requires'='content_or_lf_fix'`. Idempotent via Unique (package_id, reason_code, status).
- Verbietet bewusst jegliche Mutation an `course_packages` → bleibt SSOT-konform.

**Done-Reaudit-Gate** im Plan: wenn aktiver `QUALITY_NO_PROGRESS`-Ledger-Eintrag existiert → kein Reaudit, Cause `QUALITY_LOCKED_PENDING_FIX`.

---

## Cut 4 — Post-OS3 Audit

**Edge Function `pipeline-recovery-audit-postos3`** (read-only, JWT+admin):
Aggregiert in EINER Response:
- `lf_attempts_6h` (vorher 319 → Ziel: stark fallend)
- `lf_skipped_due_to_quarantine_6h` (neu, sollte > 0 werden)
- `planning_stuck_count` + Breakdown nach Diagnose-Cause
- `planning_restarts_emitted_24h` vs. `planning_manual_review_emitted_24h`
- `done_reaudit_blocked_by_no_progress`
- `done_ready_to_publish` (unverändert SSOT-Query)

Schreibt Snapshot in `auto_heal_log` `action_type='pipeline_recovery_postos3_audit'`.

**UI:** Neue Card `PipelineRecoveryAuditCard` auf `/admin/heal` direkt unter `PipelineRecoveryRunsCard`. Zeigt 4 KPI-Tiles + Last-Run-Timestamp + "Re-Audit"-Button.

---

## DB / Migrationen

Minimal-invasiv:
1. View `v_active_quarantine_packages` (oder Edge-side Query, kein DDL nötig).
2. Optional Composite-Index `idx_pql_active(package_id, reason_code) WHERE status='under_review'` für Worker-Hot-Path.
3. Keine neuen Tabellen.

## CI-Guard
`scripts/guard-recovery-forbidden.mjs`: ROOTS erweitern um
- `supabase/functions/pipeline-recovery-diagnose`
- `supabase/functions/pipeline-recovery-audit-postos3`

Worker-Patches (`package_repair_exam_pool_lf_coverage`) bleiben außerhalb des Recovery-Guards (legitime Mutationen), aber neuer Guard `scripts/guard-quarantine-respect.mjs` prüft, dass jeder LF-Worker `package_quarantine_ledger` liest, bevor er enqueued.

## Tests (≥30 neu, Ziel ≥96 grün)
- `quarantineGuard` (6): under_review_blocks / cleared_passes / unknown_reason_passes / multi_row / empty / idempotent
- `planningDiagnosis` (8): jede Cause + healthy + mixed
- `qualityNoProgress` (6): no_progress_locks / progress_releases / first_run_skip / content_fix_signal / lf_fix_signal / idempotent
- `postos3Aggregator` (4)
- `forbidden-actions` (3): `lock_bronze_review` darf keine `course_packages.update` triggern.
- Worker-Skip-Test (3) für `package_repair_exam_pool_lf_coverage`.

## Definition of Done
- Pure SSOT + Edge-Mirror für 3 neue Module.
- 2 neue Edge Functions deployt (`diagnose`, `audit-postos3`).
- `pipeline-recovery-act` um `lock_bronze_review` erweitert.
- Worker `package_repair_exam_pool_lf_coverage` mit Quarantine-Gate.
- `PipelineRecoveryAuditCard` in `/admin/heal`.
- CI-Guards erweitert (`guard-recovery-forbidden`, neu: `guard-quarantine-respect`).
- ≥30 neue Tests grün, alle alten grün.
- Memory `.lovable/memory/features/pipeline-recovery-os-3.md`.

## Out of Scope (bewusst)
- Echter Worker-Scale (Dispatcher Repair beschränkt sich auf Diagnose + sichere Restarts).
- STUDIUM-Routing-Repair (nur Diagnose, bleibt OS.4).
- Bronze-Review-UI (Lock erfolgt nur via Ledger-Marker, UI bleibt bestehender Bronze-Pfad).
- Auto-Content-Fix (Reaudit-Block ist passiv).

## Erwartete Wirkung nach Deploy
- LF Attempts/6h: 319 → < 20.
- Planning-Hänger: 17 → diagnostiziert, ≤ Anteil mit `CLAIM_LOST` wird restartet, Rest in manual review.
- Done-Reaudit-Noise: 23 → 0 (gelockt bis Content-/LF-Fix).
- Erst danach belastbare Neubewertung von `done_ready_to_publish`.

---

**Bestätigen zum Scaffolden?** Bei OK: Implementation in einem Pass (Pure SSOT + Mirror → Edge Functions → Worker-Patch → UI → Guards → Tests → Memory) und anschließend Post-OS3-Audit-Run.
