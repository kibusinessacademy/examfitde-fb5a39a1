# Memory: architektur/pipeline/gate-classified-validation-and-repair-v3
Updated: now

Das Validierungssystem nutzt eine granulare Gate-Klassifizierung zur Steuerung der Pipeline: `healthy` (>= 80% Tier 1 Pass), `soft_pass_with_debt` (70-79.9%), `repair_required` (55-69.9%) und `major_regeneration_required` (< 55%). Pakete im Status `soft_pass_with_debt` werden für Downstream-Schritte (Blueprints, Exam-Pool) freigegeben, um Stalls zu vermeiden. Bei niedrigeren Scores werden automatisch gezielte Reparatur-Jobs (`repair_learning_content`) statt statischer Retries ausgelöst. Ein gehärteter Fingerprint (Lektionsanzahl, Materialisierungsgrad, Fehlerstatus und Zeitstempel) verhindert redundante Validierungsläufe auf unveränderten Daten. Zur Vermeidung von SSOT-Mismatches überspringt der Validator 'mini_check' Lektionen, wenn 'has_minichecks=true' in den Feature-Flags gesetzt ist.

## P1-Erweiterungen (v3)

### 1. Strukturierte Failure-Codes
- `_shared/validation-issue.ts`: Definiert `ValidationIssue { code, severity, detail?, metric?, threshold? }` und `T1Result` als SSOT-Typen
- `tier1Check()` erzeugt jetzt typisierte Issues statt Strings
- `aggregateFailureModes()` nutzt `issue.code` direkt statt `issue.split(":")[0]`
- `detectCatastrophicFailures()` prüft `issue.severity === "critical"` und `issue.metric < threshold * 0.3`

### 2. Capability-basiertes Downstream-Routing
- `_shared/learning-content-capabilities.ts`: `LearningContentCapabilities` mit 5 per-Step Flags
- `deriveLearningContentCapabilities()`: healthy/soft_pass → alles; repair_required → selektiv; major_regen/hard_fail → nichts
- Capabilities in `package_steps.meta.capabilities` persistiert

## P2-Erweiterungen

### 3. Capability-aware DAG Gating
- `_shared/capability-gating.ts`: SSOT-Mapping step_key → capability flag
- `isCapabilityGranted()`: prüft ob validate_learning_content eine capability für einen Downstream-Step gewährt hat
- `pipeline-helpers.ts` `areDependenciesMet()`: akzeptiert jetzt capability-granted deps von validate_learning_content
- `pipeline-process.ts`: DAG integrity guard + zombie check respektieren capabilities
- Betrifft: `auto_seed_exam_blueprints`, `generate_lesson_minichecks`, `generate_handbook`

### 4. Admin UI Gate Visibility
- `RealtimePipelineMonitor.tsx`: `GateClassDetail` Komponente zeigt für validate_learning_content:
  - Gate-Class Badge (farbcodiert)
  - Tier-1 Pass Rate
  - Reason Code
  - Repair Action Badge
  - Capabilities (grün = erlaubt, durchgestrichen = blockiert)
  - Top Failure Modes mit Counts
  - Betroffene Lektionen Count
