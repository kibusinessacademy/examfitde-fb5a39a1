# Memory: architektur/qualitaets-management/trap-rebalance-ssot-fix-v2
Updated: 2026-03-29

## Root-Cause: 4-Ebenen SSOT-Mismatch

Die Rebalance-Funktion (`package-exam-rebalance`) war funktionsunfähig wegen eines fundamentalen SSOT-Mismatches:

1. **Audit-Card** (`getTrapQualityAudit`) liest Trap-Verteilung **LIVE** aus `exam_questions` → zeigt korrekte Hard-Fails
2. **Rebalance** las `integrity_report.v3.hard_fail_reasons` → bei NULL-Report (16 von 16 betroffenen Paketen) sofortiger Abbruch mit 0 Aktionen
3. **UI** (`callEdge`) verschluckte `{ok: false}` als Erfolg → zeigte "0 Aktionen" statt Fehler
4. **Keine Redistributions-Logik**: `repairTrapCoverage` taggete nur fehlende `trap_type` (NULL), konnte aber Über-/Unterrepräsentation NICHT korrigieren

## Fix (v2)

1. **SSOT-Alignment**: Rebalance liest jetzt LIVE aus `exam_questions` + `trap_distribution_rules` (gleiche SSOT wie Audit)
2. **Neue `redistributeTraps()`**: Identifiziert über-/unterrepräsentierte Typen, reklassifiziert Fragen mit niedrigstem Quality-Score vom Über- zum Unter-Typ (max 10% pro Run)
3. **Difficulty-Fix**: Easy→Medium Reklassifikation statt Rejection (Fragen bleiben im Pool)
4. **UI-Guard**: `callEdge` wirft jetzt Error bei `{ok: false}` Responses
5. **Kein Report-Dependency mehr**: Rebalance funktioniert unabhängig vom Integrity-Report-Status
