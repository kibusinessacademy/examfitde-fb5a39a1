# Memory: architektur/pipeline/gate-classified-validation-and-repair-v3
Updated: now

Das Validierungssystem nutzt eine granulare Gate-Klassifizierung zur Steuerung der Pipeline: `healthy` (>= 80% Tier 1 Pass), `soft_pass_with_debt` (70-79.9%), `repair_required` (55-69.9%) und `major_regeneration_required` (< 55%). Pakete im Status `soft_pass_with_debt` werden für Downstream-Schritte (Blueprints, Exam-Pool) freigegeben, um Stalls zu vermeiden. Bei niedrigeren Scores werden automatisch gezielte Reparatur-Jobs (`repair_learning_content`) statt statischer Retries ausgelöst. Ein gehärteter Fingerprint (Lektionsanzahl, Materialisierungsgrad, Fehlerstatus und Zeitstempel) verhindert redundante Validierungsläufe auf unveränderten Daten. Zur Vermeidung von SSOT-Mismatches überspringt der Validator 'mini_check' Lektionen, wenn 'has_minichecks=true' in den Feature-Flags gesetzt ist.

## P1-Erweiterungen (v3)

### 1. Strukturierte Failure-Codes
- `_shared/validation-issue.ts`: Definiert `ValidationIssue { code, severity, detail?, metric?, threshold? }` und `T1Result` als SSOT-Typen
- `tier1Check()` erzeugt jetzt typisierte Issues statt Strings (z.B. `{ code: "HTML_TOO_SHORT", severity: "error", metric: 123, threshold: 400 }`)
- `aggregateFailureModes()` nutzt `issue.code` direkt statt `issue.split(":")[0]`
- `detectCatastrophicFailures()` prüft `issue.severity === "critical"` und `issue.metric < threshold * 0.3` statt String-Matching

### 2. Capability-basiertes Downstream-Routing
- `_shared/learning-content-capabilities.ts`: Definiert `LearningContentCapabilities` mit 5 per-Step Flags
- `deriveLearningContentCapabilities()` leitet aus `gateClass + tier1PassRate + coverage` ab:
  - `healthy` / `soft_pass_with_debt` → alle 5 Capabilities true
  - `repair_required` → Blueprints/MiniChecks bei coverage≥90%, ExamPool zusätzlich tier1≥60%, Handbook/Tutor blocked
  - `major_regeneration_required` / `hard_fail` → alles blocked
- Capabilities werden in `package_steps.meta.capabilities` persistiert
- Response enthält `capabilities`-Objekt für Runner/Leitstelle/UI

### 3. SSOT-Dateien
- `_shared/validation-issue.ts`: ValidationIssue, T1Result, aggregateFailureModes, detectCatastrophicFailures
- `_shared/learning-content-capabilities.ts`: LearningContentCapabilities, deriveLearningContentCapabilities, hasAnyDownstreamCapability
- `_shared/learning-content-gate.ts`: Gate-Klassifikation, Fingerprint, Retry-Guard (unverändert von v2.1)
