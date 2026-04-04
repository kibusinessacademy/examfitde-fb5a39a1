# Memory: architektur/pipeline/gate-classified-validation-and-repair-v4-capabilities
Updated: now

Das System nutzt ein Capability-basiertes DAG-Gating, um den Pipeline-Fortschritt von der Inhalts-Validierung zu entkoppeln. Der Schritt `validate_learning_content` klassifiziert Pakete in fünf Klassen: `healthy` (>= 80% Tier 1 Pass), `soft_pass_with_debt` (70-79.9%), `repair_required` (55-69.9%), `major_regeneration_required` (< 55%) und `hard_fail`. Basierend auf dieser Klasse werden 'Capabilities' (z. B. `allowsBlueprintSeeding`, `allowsMiniCheckGeneration`) in `package_steps.meta` freigegeben. Downstream-Steps können starten, wenn ihre benötigte Capability aktiv ist, auch wenn die Validierung im Zustand `repair_required` verharrt. Ein Fingerprint-basierter Retry-Guard und die automatisierte Repair-Orchestrierung (`repair_learning_content` / `regenerate_learning_content_cluster`) verhindern redundante Läufe und beheben Defekte gezielt, statt den Prozess in Sackgassen-Retries zu blockieren. Zur Vermeidung von SSOT-Mismatches werden 'mini_check' Lektionen übersprungen, wenn 'has_minichecks=true' gesetzt ist.

## Profilbasierte Validierung (v4.1)

### Integrity-Profile-Resolver
Die Validierung nutzt ein profilgesteuertes System (`integrity_profile` → `track` → Default). Profile:
- `AUSBILDUNG_VOLL`: IHK-Prüfungsnähe, betriebliche Handlungssituation, Tier-1 Threshold 80%/70%/55%
- `STUDIUM`: Akademische Terminologie, Theorie-Modell-Bezug, angepasste Thresholds 65%/55%/40%
- `WEITERBILDUNG`: Operativer Kontext ohne IHK-Pflicht

### Policy-Layer
`_shared/validation/learning-content-policy.ts` kapselt alle profilspezifischen Regeln:
- Tier-2 LLM-Persona wird profiliert (IHK-Prüfer vs. Hochschuldozent)
- Schwellenwerte für Gate-Klassen sind profilabhängig
- Universelle Checks (Struktur, Kompetenzbezug) bleiben trackübergreifend

### Runner-Optimierung (v5.1)
- WIP- und Target-Counts in 2 parallelen Queries statt N+1
- Lendable Slots werden proportional nach Target-Count verteilt (nicht winner-takes-all)
