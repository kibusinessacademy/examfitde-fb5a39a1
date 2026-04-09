# Memory: architektur/pipeline/publish-governance-ssot-v2
Updated: 2026-04-09

## Kontext
Wiederholte Finalisierungsfehler bei AEVO, Betriebswirt IHK, Fachkraft Lagerlogistik, Kaufmann Groß-/Außenhandel durch drei gekoppelte Ursachen: (1) council_approved nicht an Session-Finalität gebunden, (2) auto_publish als Ghost-Step ohne valide Materialisierung, (3) Trigger feuern gegeneinander und revertieren Statuswechsel auf Basis inkonsistenter Zwischenzustände.

## Strukturelle Lösung (umgesetzt 2026-04-09)

### 1. Kanonische SSOT-Funktion `fn_package_publish_readiness(uuid) → jsonb`
- **Einzige Wahrheitsquelle** für Publish-Entscheidungen
- Prüft: integrity_passed, council_sessions (Finalität + Approvals), alle Pflicht-Steps done/skipped, Ghost-Step-Erkennung, blocked_reason
- Gibt strukturierte `reasons[]` zurück für deterministische Diagnostik
- Alle Trigger, Reconciler, Watchdogs SOLLEN diese Funktion nutzen

### 2. Ghost-Step-Hard-Guard `trg_guard_auto_publish_preconditions`
- Blockiert `auto_publish` Übergang zu `running` wenn Vorbedingungen nicht erfüllt
- Nutzt `fn_package_publish_readiness` als Prüfquelle
- Revertiert zu `queued` mit `PRECONDITION_NOT_MET` statt Exception
- Macht Ghost-Steps technisch unmöglich bei neuen Paketen

### 3. Council-Guard gehärtet `fn_guard_council_approved`
- `council_approved=true` NUR wenn:
  - 0 offene Sessions (pending/processing)
  - Mindestens 1 `completed/approve` Session
- Schreibt Audit-Notification bei Blockade
- Eliminiert die SSOT-Widerspruch-Klasse (Flag vs. Sessions) strukturell

### 4. Deterministic Blocking statt Silent Revert
- `guard_building_published_drift` normalisiert mit Audit-Trail in `admin_actions`
- Keine heimlichen Statuswechsel mehr ohne Evidenz

### 5. Idempotenter Drift-Reconciler `fn_reconcile_publish_governance_drift(dry_run)`
- Heilt 4 Drift-Klassen:
  1. Ghost auto_publish Steps (started_at NULL in running/done)
  2. Council-approved Drift (flag=false aber Sessions terminal+approved)
  3. QGF-Bounces (quality_gate_failed aber publish-ready)
  4. auto_publish done aber Package nicht published
- Unterstützt `dry_run=true` für risikolose Diagnose

## Invarianten
- Jede Publish-Entscheidung MUSS über `fn_package_publish_readiness` laufen
- `council_approved` ist KEINE frei kippbare Flag mehr — gebunden an Session-Finalität
- `auto_publish` Step kann nicht zu `running` wechseln ohne bestandene Vorbedingungen
- Reconciler läuft idempotent und evidenzbasiert
