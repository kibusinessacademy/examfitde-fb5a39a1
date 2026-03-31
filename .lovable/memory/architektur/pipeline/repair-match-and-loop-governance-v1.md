# Memory: architektur/pipeline/repair-match-and-loop-governance-v1
Updated: now

Das System unterliegt einer 'Repair-Match-Governance' (v3, P0-gehärtet), um wirkungslose 'Heal-Loops' (Churn) zu verhindern.

## Architektur-Guards (P0 implementiert + v3 nachgeschärft)

### 1. Repair-Eligibility-Matrix (SSOT)
Die DB-Funktion `fn_is_repair_action_eligible(p_package_id, p_repair_action)` prüft zentral:
- `repair_exam_pool_quality` nur erlaubt bei exam-pool-spezifischen Blockern
- Bei Publish-/Integrity-Blockern: prüft `hard_fail_reasons` per Text-Containment (robust für gemischte Formate)
- `validate_exam_pool.meta.gate_blocked`: nur noch erlaubt wenn `gate_diagnosis` Array exam-pool-spezifische Codes enthält (nicht mehr pauschal permissiv)
- Supprimiert nach ≥2 `blocked_no_effect`-Einträgen in 6h
- `REPAIR_NO_EFFECT` in blocked_reason blockiert ebenfalls

### 2. Fail-Closed für Automation
`isRepairActionEligible()` differenziert nach `triggerSource`:
- **Automation** (watchdog, stuck-scan, runner, auto-heal): fail-closed bei RPC-Fehlern
- **Admin/Manual**: fail-open (Override möglich)

### 3. No-Effect-Guard mit Gate-Delta-Verifikation
- Pre-Snapshot via `fn_capture_gate_snapshot` vor Repair
- Post-Snapshot + `fn_has_gate_state_changed` nach Repair
- `GateDeltaResult` enthält jetzt `check_failed` + `check_failed_reason` für Diagnostik
- Kein Re-Queue von `validate_exam_pool` wenn `changed=false` — auch nicht bei `poolHealthy`
- Ineligible Repair-Step: `status='blocked'` (nicht `skipped`/`done`) mit `repair_ineligible=true`
- No-Effect Repair: `status='blocked'` (nicht `done`) mit `no_effect_repair=true`
- `blocked_reason` wird NICHT gelöscht bei No-Effect — stattdessen `stuck_reason` mit Diagnose-Info
- Delta-Check-Fehler werden als `REPAIR_DELTA_CHECK_FAILED` vs. `REPAIR_NO_EFFECT` unterschieden

### 4. Strikte Trennung: Domain-Success vs. Reentry-Eligibility (v3 NEU)
- `poolHealthy` = Domain-Erfolg (Repair hat Pool verbessert)
- `reentryEligible` = nur bei `gateChange.changed === true && !gateChange.check_failed`
- `handlePoolHealthyNoReentry()` markiert Repair als `done` aber queued NICHT validate_exam_pool
- Verhindert den Loop: poolHealthy → validate requeued → auto_publish blocked → repair again

### 5. Reentry nur mit Gate-Delta-Verifikation
`recover_and_reenter_package` hat Parameter `p_gate_delta_verified boolean`:
- Automation-Pfade mit integrity/publish-Blockern: Reentry nur wenn `gate_delta_verified=true`
- Admin/Manual: Override weiterhin möglich
- `blocked_reason` nur gelöscht wenn delta-verified ODER admin-triggered
- Sonst: `RECOVER_ATTEMPTED_FROM:<original_blocker>` als blocked_reason erhalten

### 6. Status-Konsolidierung
- `result_status='applied'` → `'success'` normalisiert
- Neue Statuskategorien: `blocked_no_effect`, `blocked`, `skipped`

### Dispatch-Stellen mit Eligibility-Guard + triggerSource
- `heal-dispatch.ts` → `"heal-dispatch"` (fail-closed)
- `job-runner/index.ts` → `"job-runner"` (fail-closed)
- `stuck-scan-hygiene.ts` → `"stuck-scan-delta-guard"` (fail-closed)
- `package-repair-exam-pool-quality/index.ts` → `triggered_by` aus Payload (fail-closed)
