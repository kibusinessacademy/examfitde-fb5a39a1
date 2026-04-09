# Memory: architektur/pipeline/publish-governance-ssot-v2
Updated: 2026-04-09

## Kontext
Wiederholte Finalisierungsfehler bei AEVO, Betriebswirt IHK, Fachkraft Lagerlogistik, Kaufmann Groß-/Außenhandel durch drei gekoppelte Ursachen: (1) council_approved nicht an Session-Finalität gebunden, (2) auto_publish als Ghost-Step ohne valide Materialisierung, (3) Trigger feuern gegeneinander und revertieren Statuswechsel auf Basis inkonsistenter Zwischenzustände.

## Strukturelle Lösung (umgesetzt + gehärtet 2026-04-09)

### 1. Kanonische SSOT-Funktion `fn_package_publish_readiness(uuid) → jsonb`
- **Einzige Wahrheitsquelle** für Publish-Entscheidungen
- Prüft fachliche Finalität: integrity_passed, council-sessions (Finalität + Approvals), alle Pflicht-Steps done/skipped, Ghost-Step-Erkennung
- Package-Status selbst ist NICHT primärer Blocker (nur `blocked` mit explizitem Reason)
- `quality_gate_failed` wird NICHT als Reason gemeldet — der Reconciler heilt das

### 2. Ghost-Step-Hard-Guard `trg_guard_auto_publish_preconditions`
- **BEFORE INSERT OR UPDATE** — verhindert Ghost-Steps schon beim Einfügen
- Blockiert `auto_publish` Übergang zu `running` wenn Vorbedingungen nicht erfüllt
- **STEPS_NOT_DONE wird NICHT gefiltert** — unfertige Pflichtschritte blockieren korrekt
- Nur GHOST_AUTO_PUBLISH (self-referential) wird aus Gründen entfernt
- Ghost-Insert-Guard: INSERT mit status=done/running ohne started_at → queued

### 3. Council-Guard gehärtet `fn_guard_council_approved`
- Trigger explizit auf `BEFORE UPDATE ON course_packages` gebunden
- `council_approved=true` NUR wenn: 0 offene Sessions + mindestens 1 approve
- Schreibt Audit-Notification bei Blockade

### 4. Deterministic Blocking statt Silent Revert
- `guard_building_published_drift` normalisiert mit Audit in `admin_actions`

### 5. Readiness-Aware Drift-Reconciler `fn_reconcile_publish_governance_drift(dry_run)`
- Regel 4 (auto_publish done, package not published) ist **readiness-aware**:
  - Readiness=true → Package auf `published` normalisieren
  - Readiness=false → Step auf `failed` setzen
- Nicht blind: "step done + not published = failed"

## Invarianten
- Jede Publish-Entscheidung MUSS über `fn_package_publish_readiness` laufen
- `council_approved` ist an Session-Finalität gebunden
- `auto_publish` kann nicht zu `running` oder `done` wechseln ohne bestandene Vorbedingungen
- STEPS_NOT_DONE blockiert auto_publish — keine Ausnahme
- Package-Status ist abgeleiteter Zustand, nicht primäre Wahrheit
