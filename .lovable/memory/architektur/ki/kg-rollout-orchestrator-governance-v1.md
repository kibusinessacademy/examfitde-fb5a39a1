# Memory: architektur/ki/kg-rollout-orchestrator-governance-v1
Updated: now

## Automatisierter KG-Rollout-Lifecycle

Die Edge Function `knowledge-graph-rollout-orchestrator` automatisiert den gesamten KG-Lifecycle pro Curriculum:

### Pipeline pro Curriculum
1. **SSOT-Build**: `knowledge-graph-build-ssot` — Knoten/Kanten aus Kompetenzen, Blueprints etc.
2. **Error-Enrichment**: `knowledge-graph-enrich-errors` — KI-generierte Fehlermuster für Kompetenzen mit < N Errors
3. **Readiness-Evaluation**: Direkte DB-Prüfung gegen feste Schwellenwerte
4. **Auto-Flag**: `kg_rollout_curriculum_<id>` in `ops_pipeline_config` wird automatisch gesetzt oder zurückgenommen

### Readiness-Schwellenwerte (SSOT im Orchestrator)
- `MIN_COMPETENCIES`: 20
- `MIN_COVERAGE_PCT`: 60% der Kompetenzen mit ≥2 Error Patterns
- `MIN_ERRORS_PER_COMP`: 2

### Cron-Integration (via `cron-trigger`)
| Tier    | Scope     | Curricula | Enrichment/Curriculum |
|---------|-----------|-----------|----------------------|
| hourly  | pending   | max 5     | max 15 Kompetenzen   |
| nightly | all       | max 50    | max 25 Kompetenzen   |

- **Hourly**: Nur Curricula ohne bestehendes Ready-Flag → schneller Catch-up
- **Nightly**: Vollständiger Scan aller Curricula → Re-Evaluation + Rücknahme wenn Coverage sinkt

### pg_cron
- `nightly` Tier: neuer Cron-Job um 02:15 UTC, ruft `cron-trigger` mit `{ "schedule": "nightly" }`
- `hourly` Tier: bestehender Stunden-Cron triggert Orchestrator mit `scope: "pending"`

### Sicherheitsmerkmale
- **Idempotent**: SSOT-Build und Enrichment sind mehrfach ausführbar
- **Fail-safe**: Enrichment-Fehler verhindern Flag-Setzung; Curriculum bleibt draußen
- **Auto-Rücknahme**: Wenn Coverage unter Schwelle fällt, wird Flag auf `false` gesetzt
- **Budget-limitiert**: `max_competencies_per_enrichment` begrenzt AI-Kosten pro Lauf
- **Dry-Run**: `{ "dry_run": true }` evaluiert ohne Flags zu ändern
- **Kill-Switch**: `kg_exam_pool_enabled = false` deaktiviert alles sofort, unabhängig von Curriculum-Flags

### Ops-Transparenz
- Jeder Lauf wird in `auto_heal_log` protokolliert (action_type: `kg_rollout_orchestrator`)
- Ergebnis enthält: newly_ready, newly_unready, unchanged pro Curriculum
