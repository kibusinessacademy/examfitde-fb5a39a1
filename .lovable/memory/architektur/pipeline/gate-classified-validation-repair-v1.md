# Memory: architektur/pipeline/gate-classified-validation-repair-v1
Updated: now

Das 'Gate-Classified Validation & Repair' System (v2.1) löst den systemischen Blocker des binären pass/fail Learning-Content-Gates.

## Kernprinzip
`validate_learning_content` ist kein binäres Gate mehr, sondern ein **Routing- und Repair-Gate** mit 5 Klassen:

1. **healthy** (≥80% Tier-1) → `done`, DAG läuft weiter
2. **soft_pass_with_debt** (70–79.9%) → `done` mit `quality_debt=true`, DAG läuft weiter
3. **repair_required** (55–69.9%) → Enqueue `repair_learning_content`, kein blind Retry
4. **major_regeneration_required** (<55%) → Enqueue `regenerate_learning_content_cluster`
5. **hard_fail** → Nur bei SSOT-Bruch, catastrophic failures, 0 Content

## SSOT-Dateien
- `_shared/learning-content-gate.ts`: Klassifikationslogik, Fingerprint, Retry-Guard
- `package-validate-learning-content/index.ts`: Edge Function mit Gate-Routing
- `_shared/job-map.ts`: Neue Job-Types `repair_learning_content` + `regenerate_learning_content_cluster`
- `_shared/enqueue.ts`: Repair-Jobs in REPAIR_JOB_TYPES Allowlist
- `src/lib/jobs/job-registry.ts`: Client-seitige Registry
- DB: `fn_learning_content_allows_downstream(gate_class)`, `ops_job_type_registry`

## v2.1 P0-Härtungen (2026-04-04)

### 1. Retry-Guard (gehärtet)
- Gibt jetzt ein strukturiertes Objekt `{ retry, reason }` zurück statt nur `boolean`
- Neue Inputs: `repairEnqueuedSinceLastValidation`, `repairInFlight`
- Erkennt "no_repair_mechanism"-Zustand: wenn identischer Fingerprint + blocking gate class + kein Repair existiert → erzwingt Re-Validierung mit anschließendem Repair-Enqueue statt stillem Skip
- Vermeidet den "sauber aber stuck"-Zustand

### 2. Fingerprint (verstärkt)
- v2: `packageId:lessonCount:materializedCount:failedCount:placeholderCount:maxUpdatedAt`
- Höhere Sensitivität für Content-Zustandsänderungen ohne timestamp-Drift

### 3. Meta-Persistenz (kontraktsicher)
- Verwendet `mergePackageStepMeta` statt rohem `.update({ meta })` → schützt guard_state und andere Contract-Keys
- Speichert `repair_enqueued_at`, `repair_job_id`, `repair_job_type` nach erfolgreichem Enqueue

### 4. Repair-Enqueue (via SSOT-Helper)
- Verwendet `enqueueJob()` aus `_shared/enqueue.ts` mit voller Idempotenz, Revive-on-Conflict und Pool-Guard
- Kein rohes `job_queue.insert` mehr

### 5. Runner-kompatible Rückgaben
- Routing-Zustände (repair_required, major_regen) → `ok: true, completed: true, advance_pipeline: false`
- Nur `hard_fail` → `ok: false, permanent: true`
- Skip wegen Repair in-flight → `ok: true, completed: true, skipped: true`
- Neue Felder: `advance_pipeline`, `repair_enqueued`, `completed`

### 6. Kein Placeholder-Reset bei Hard-Fail
- Statt Lessons durch Placeholder zu ersetzen, werden sie nur mit `quality_flags.needs_regeneration = true` markiert
- Bewahrt die beste vorhandene Ausgangsbasis für spätere Reparatur

## Fingerprint-basierter Retry-Guard
Validator wird bei identischem Content-Fingerprint übersprungen → verhindert sinnlose Retries ohne Datenzustandsänderung. Erneuter Lauf nur bei:
- Fingerprint geändert (neuer Content)
- Repair-Job abgeschlossen seit letzter Validierung
- Erster Lauf
- Kein Repair-Mechanismus aktiv (erzwingt Re-Validierung + Repair-Enqueue)

## Step-Meta Kontrakt
```json
{
  "gate_class": "repair_required",
  "reason_code": "LOW_TIER1_RATE_REPAIRABLE",
  "quality_debt": true,
  "allows_downstream": false,
  "tier1_pass_rate": 0.636,
  "affected_lessons_count": 48,
  "top_failure_modes": [...],
  "last_validation_fingerprint": "pkg:120:...:...:...:2026-04-04T...",
  "last_validate_completed_at": "...",
  "repair_enqueued_at": "...",
  "repair_job_type": "repair_learning_content",
  "repair_job_id": "..."
}
```

## DAG-Entkopplung
`auto_seed_exam_blueprints` und nachgelagerte Schritte werden für `healthy` und `soft_pass_with_debt` freigegeben. Pakete mit verwertbarem Content (>70% Tier-1) verlieren nicht mehr den gesamten Blueprint-/Exam-Pfad.
