# Memory: architektur/ops/hardened-runner-and-lane-governance
Updated: now

Das System nutzt eine 'Lane-Aware' Claiming-Architektur (v5.0/v6.1), bei der Runner ihre Kapazitäten pro Lane (Control, Recovery, Generation) budgetieren.

## Kritischer Fix v5.0: Workload-Key-Trennung & Health-Gate-Bypass

**Root Cause (behoben):** Alle nicht explizit gemappten Job-Typen fielen auf `workloadKeyForJob() → "learning_content"` zurück. Dadurch wurden Control-/Validation-/Promotion-Jobs in die LLM-Provider-Health-Gate geschickt und bei Provider-Cooldown als `RELEASE_HEALTH_GATE` deferred — obwohl sie gar keine LLM-Calls machen.

**Fix:**
1. **WORKLOAD_KEY_MAP vollständig:** Jeder Job-Typ hat einen expliziten Eintrag. Control-Jobs → `"control"`, LLM-Jobs → spezifische Workload-Keys.
2. **Default geändert:** Unknown Types → `"control"` statt `"learning_content"` (safe-default: kein LLM-Gate).
3. **Health-Gate-Bypass:** `CONTROL_WORKLOAD_KEYS` Set überspringt die `resolveAvailableRoute()`-Prüfung komplett für Control-Workloads.
4. **Timeout-Tier-Korrektur:**
   - `package_promote_blueprint_variants`: T4_LIGHT (10s) → T2_HEAVY (35s) — scannt alle Blueprints sequentiell
   - `package_quality_council`: T4_LIGHT (10s) → T2_HEAVY (35s) — kann Integrity-Scans laufen
   - `package_elite_harden`: T3 (25s) → T2_HEAVY (35s) — hat AI-Phasen
   - `package_repair_exam_pool_quality`: hinzugefügt als T2_HEAVY (35s)

## Heartbeat-System (v6.1)

Der job-runner schreibt jetzt `last_heartbeat_at` + `heartbeat_phase`:
- Pre-dispatch: sofort nach Claim
- Processing-Tick: alle 30s via `setInterval`
- Post-dispatch: implizit über SINGLE EXIT write

Damit erkennt stuck-scan den Unterschied zwischen "aktiv arbeitend" und "tatsächlich tot".

## Budget-Exhausted Telemetrie

`BUDGET_EXHAUSTED` Freigaben werden separat in `ops_budget_exhausted_log` erfasst und explizit nicht als Fehler gewertet. Dies verhindert, dass der Runner-Loop fälschlicherweise abgebrochen wird, wenn schwere Jobs lediglich das Zeitbudget überschreiten.

## Invarianten
- Jede Job-Freigabe muss über `releaseJobToPending` erfolgen
- Control-Workloads (`"control"`) bypassen die LLM Health-Gate komplett
- Unknown job types defaulten zu `"control"` (nicht `"learning_content"`)
- Timeout-Tier muss zur tatsächlichen Laufzeit des Job-Typs passen
- Heartbeats alle 30s in job-runner, alle 20s in content-runner
