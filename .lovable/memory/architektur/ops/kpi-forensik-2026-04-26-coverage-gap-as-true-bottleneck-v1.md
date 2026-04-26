---
name: KPI-Forensik 2026-04-26 — Coverage-Lücke ist der wahre Bottleneck
description: Die externe „21 blocked / 7 building / 9.3% published"-Analyse hat die richtige Fassade, aber die falsche Diagnose. Echte Root-Cause-Kette steht hier.
type: feature
---

## TL;DR
Die KI-Analyse („Task Force Unblock", „Time-to-Market", „Ressourcen-Fehlplanung") behandelt das System wie eine **Manufaktur mit zu wenig Personal**. In Wirklichkeit ist es ein **Pipeline-Problem mit drei klar lokalisierbaren Code-Defekten**:

1. **Coverage-Gap-Trigger blockt auto_publish silently** → 6 building-Pakete drehen sich im 25×-Retry-Storm  
2. **repair_exam_pool_quality liefert no-op** → 19 Pakete im `REPAIR_NO_EFFECT`-Loop, falscher block_reason  
3. **267/346 queued sind seit >7 Tagen kalt** → Dashboard zeigt phantom backlog, statt echte 79 aktive Pakete

Kein „Personal" oder „Eskalation" nötig — drei chirurgische Fixes.

## Reale Zahlen (forensisch verifiziert)

| KPI | Behauptet | Wahr | Anmerkung |
|---|---|---|---|
| published | 41 | 41 | korrekt |
| blocked | 21 | 21 | korrekt |
| building | 7 | 7 | korrekt |
| queued | 346 | 346 (davon 267 stale >7d) | nur **79 sind echter Backlog** |
| Time-to-Market-Risiko | „Jahre" | Wochen | bei Fix der drei Defekte |

## Die drei echten Defekte

### Defekt 1: Coverage-Gap → P0001 → HTTP 500 → 25× Retry-Storm
`package-auto-publish` ruft DB auf → DB-Trigger wirft `P0001 COVERAGE_GAP_BELOW_TRACK_THRESHOLD: 72.2 < 80.0`.  
Edge-Function übersetzt das zu `HTTP 500` → Job-Queue interpretiert als transient → exponential retry bis 25.  
→ **Edge-Function muss P0001-Codes als TERMINAL klassifizieren** und Paket in `targeted_competency_fill`-Lane parken.

### Defekt 2: REPAIR_NO_EFFECT-Loop bei 19 Paketen
Pattern überall identisch:
```
done_steps=12-17, failed_steps=1 (repair_exam_pool_quality), 
queued_steps=3 (run_integrity_check, quality_council, auto_publish)
stuck_reason: "REPAIR_NO_EFFECT: exam_pool repair completed without verified gate delta"
blocked_reason: "quality_no_progress_3x"
```
**Wahrer Grund** (ad-hoc berechnet): coverage_pct zwischen 8.3% (Eisenbahner) und 100%.  
- Die mit <80% sind **nicht reparierbar via repair_exam_pool_quality**, sie brauchen `targeted_competency_fill`.  
- Die mit 100% (z.B. Bankfachwirt, Finanzanlagenvermittler, PRINCE2) sind **fälschlich blockiert** — Repair-Loop trotz erfüllter Gate-Bedingung.

### Defekt 3: Phantom-Backlog
267 von 346 queued Paketen haben `last_progress_at < now() - 7d`.  
→ Cockpit-KPIs verzerrt, Empfehlungen verzerrt, Dispatcher-Heuristik verzerrt.

## Maßnahmen
1. Edge `package-auto-publish`: P0001 → terminal-skip mit `block_reason='coverage_gap'`
2. View `v_package_coverage_gap` als kanonische Diagnose, Cockpit-Karte
3. Trigger `fn_route_repair_no_effect_to_targeted_fill`: bei `REPAIR_NO_EFFECT` und `coverage<track_min` → enqueue `package_targeted_competency_fill`, sonst direkt `auto_publish`-Requeue (für die 100%-Fälle)
4. Backfill: 19 blocked + 6 building → korrekte Lane
5. View `v_active_vs_cold_backlog` für ehrliches Cockpit

## Invariante
Wenn `auto_publish` für >2 Versuche `HTTP 500` zurückliefert UND Postgres-Code `P0001` → **niemals retryable**.  
Wenn `coverage_pct < track_min` → niemals `repair_exam_pool_quality` aufrufen, sondern `targeted_competency_fill`.
