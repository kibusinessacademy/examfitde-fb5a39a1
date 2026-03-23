# Memory: architektur/qualitaets-management/auto-rebalancing-governance
Updated: now

Das 'Auto-Rebalancing' ist ein permanenter Governance-Prozess, der bei jedem 'Publish-Gate' (Integrity Check) die didaktische Ausgewogenheit des Prüfungs-Pools sicherstellt. Er erkennt Defizite in drei Problemklassen und stößt automatisiert Reparaturen an:

## Drei Problemklassen (vollständig automatisiert)

1. **Content-Probleme** (falsche Fragen) → Council-Lösung
2. **Verteilungsprobleme** (easy/medium/hard Drift) → Rebalancer difficulty repair
3. **Metadaten-Probleme** (trap_type, bloom, misconceptions) → Metadata gap repair + trap retrofit

## Architektur

### Rebalancer (`package-exam-rebalance`)
- **Proaktiver Metadata-Scan**: Prüft trap_type, bloom (cognitive_level) und misconceptions bei JEDEM Durchlauf — nicht nur bei expliziten Warnings.
- **`repairMetadataGaps()`**: Heuristisches Backfill für fehlende cognitive_level (difficulty→bloom Mapping) und trap_type auf is_trap-Fragen (keyword-basiert).
- **`repairTrapCoverage()`**: Enqueued `rework_trap_retrofit` Jobs für AI-basierte Trap-Analyse (korrigierter Job-Type, war vorher fälschlich `pool_rework_trap_retrofit`).
- **Warning-Aware**: Löst Reparaturen auch bei Warnings (EASY_TOO_LOW, TRAP_COVERAGE_LOW) ohne Hard-Fails aus.

### Integrity Check (`package-run-integrity-check`)
- **Tiered Gate 10 (Trap Coverage)**: >10% fehlend → ⚠️ Warning; >25% fehlend → ❌ Blocker (war vorher immer nur Warning).
- **Gate 10b (Metadata Completeness)**: Neuer Gate für fehlende cognitive_level — gleiche Tiered-Logik (10% warning, 25% blocker).
- **Hard Auto-Enqueue**: Bei erkannten Metadata-Defiziten (TRAP_COVERAGE, METADATA_BLOOM, EASY_TOO_LOW, BLOOM_GATE) wird automatisch `package_exam_rebalance` enqueued — ohne manuelles Triggern, mit Dedup-Guard.

## Invarianten
- Kein Kurs wird ohne Elite-Qualität (≥10% Easy, ≥10% Trap-Coverage, vollständige Bloom-Klassifizierung) veröffentlicht.
- Ein Rebalancer-Durchlauf = alles sauber (difficulty + trap + bloom + metadata).
- Jede Auslösung wird in `auto_heal_log` mit `trigger_classification` und per-action Metriken protokolliert.
