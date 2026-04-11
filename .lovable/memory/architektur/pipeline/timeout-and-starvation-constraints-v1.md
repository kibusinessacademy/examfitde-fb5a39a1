# Timeout-Synchronisation, Verifier-Entkopplung & Track-Starvation-Fix

## Umgesetzt: 2026-04-11

### Defekt A: Dispatch-Timeout > Runner-Lifetime (BEHOBEN)
- **Root Cause:** `DISPATCH_TIMEOUT_GENERATION_MS=130s` überschritt `LOOP_MAX_MS=50s` und das Edge-Function-Limit (60s). Erfolgreiche Target-Functions konnten ihren Status nicht zurückschreiben → Stale-Lock-Loops.
- **Fix:** Alle Dispatch-Timeouts auf ≤40s gesenkt (Tier 1: 40s, Tier 2: 35s, Tier 3: 25s). Zusätzlich Budget-Guard: kein Dispatch wenn `remaining_budget < timeout + 5s write-buffer`. Timeout wird dynamisch auf verbleibendes Budget geclampt.
- **v2.3 Fix:** BUDGET_EXHAUSTED wird jetzt als Fast-Release behandelt — Job wird sofort auf `pending` gesetzt OHNE Attempt-Increment (5s Backoff). Vorher fiel BUDGET_EXHAUSTED in den Permanent-Error-Pfad → Stale Processing.
- **Version:** content-runner v2.3-budget-release

### Defekt B: Verifier-Starvation (BEHOBEN)
- **Root Cause:** Rootstep-Verifier lief nur innerhalb `processPackage()`, das einen Lease erfordert. WIP-blockierte Pakete (z.B. AUSBILDUNG_VOLL 8/5) bekamen keinen Lease → Verifier konnte nie prüfen.
- **Fix:** Standalone `verifier-reconciler` Edge Function (v2), die unabhängig von Leases/WIP alle `building`-Pakete prüft und SSOT-basiert finalisiert. Läuft als Cron alle 3 Minuten.
- **v2 Verbesserungen:**
  - DAG-geordnete Verarbeitung (generate_learning_content vor finalize)
  - `countInFlightJobs()`: Nur processing (frische Locks <3min) + running zählen als aktiv
  - Pending/Queued-Jobs blockieren NICHT wenn Verifier Artefakt-Vollständigkeit bestätigt
  - Graceful Prereq-Handling statt Crash bei fehlenden Upstream-Steps

### Defekt C: Track-Starvation / Monopolisierung (BEHOBEN)
- **Root Cause:** Rebalancing konnte einem Track unbegrenzt Slots zuweisen → AUSBILDUNG_VOLL monopolisierte alle 18 WIP-Slots.
- **Fix:** Hard-Cap pro Track: `base_quota + 2`. Kein Track kann über sein Basis-Kontingent plus 2 Bonus-Slots hinaus skalieren, unabhängig von Rebalancing-Ergebnissen. Starvation-Warnings werden aktiv geloggt.

### Defekt D: Rootstep-Verifier zählt Pending als Active (BEHOBEN)
- **Root Cause:** `rootstep-verifier.ts` zählte `pending`/`queued` Child-Jobs als aktiv. Wenn Artefakte bereits vollständig materialisiert waren, blockierten verwaiste Pending-Jobs die Finalisierung.
- **Fix:** Verifier prüft nur `processing` (frischer Lock <3min) und `running` als in-flight. Pending/Queued werden ignoriert wenn SSOT-Artefaktprüfung Vollständigkeit bestätigt.

### Invarianten
- Dispatch-Timeout ≤ LOOP_MAX_MS - STATUS_WRITE_BUFFER_MS (5s)
- BUDGET_EXHAUSTED → sofortige Freigabe zu pending (kein Attempt-Increment)
- Verifier-Reconciler prüft alle building-Pakete ohne Lease-Abhängigkeit
- In-Flight = processing (lock_age < 3min) + running; NICHT pending/queued
- Track-WIP ≤ base_quota + TRACK_HARD_CAP_BONUS (2)
- Steps werden in DAG-Reihenfolge finalisiert
