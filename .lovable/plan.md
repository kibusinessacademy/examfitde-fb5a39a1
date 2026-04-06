
# Pre-Build Architektur — Blueprint Variant Inventory

## Phase 1: Worker-Pool Separation

### 1a. Migration: `worker_pool = 'prebuild'` für Variant-Jobs
- Alle bestehenden `package_generate_blueprint_variants` Jobs in Pool `prebuild` umleiten
- `claim_pending_jobs_v4` anpassen: Build-Worker (default pool) claimen keine `prebuild`-Jobs mehr
- Neuer Parameter/Logik: Prebuild-Worker claimen nur `prebuild`-Pool
- Fan-Out-Cap auf 30 für Prebuild-Pool (intern), kein Cap nötig da eigener Pool

### 1b. Job-Type-Policy
- `job_type_policies` Eintrag für `package_generate_blueprint_variants`: `worker_pool = 'prebuild'`
- Neuer Eintrag für `ensure_variant_inventory` und `validate_variant_inventory`

## Phase 2: Variant Prebuild Status + Readiness Gate

### 2a. Migration: `variant_prebuild_status` auf `course_packages`
- Neues Feld: `variant_prebuild_status` ENUM ('pending', 'materializing', 'ready', 'stale', 'failed')
- Default: 'pending'

### 2b. Readiness-Gate vor `generate_exam_pool`
- DB-Funktion `fn_is_variant_inventory_ready(p_package_id)` → boolean
- Prüft: alle Blueprints haben Mindest-Varianten, Mindest-Approved-Quote, keine harten Fehler
- Guard-Integration: `generate_exam_pool` blockiert mit `WAITING_FOR_VARIANT_PREBUILD` wenn nicht ready

## Phase 3: Inventory-Tabelle + Planner-Job

### 3a. Migration: `blueprint_variant_inventory` Tabelle
```
blueprint_id UUID PK FK → exam_blueprints
curriculum_id UUID FK
package_id UUID FK (nullable, für package-spezifische Overrides)
target_count INT DEFAULT 20
materialized_count INT DEFAULT 0
approved_count INT DEFAULT 0
coverage_ratio NUMERIC GENERATED
status TEXT DEFAULT 'missing' -- missing|partial|ready|stale|invalid
last_job_at TIMESTAMPTZ
last_error TEXT
fingerprint TEXT
created_at / updated_at
```

### 3b. Planner-Job: `ensure_variant_inventory`
- Prüft Soll/Ist pro Blueprint
- Enqueue't nur fehlende Arbeit (gezielt pro Blueprint)
- Capped: max N neue Jobs pro Durchlauf
- Dedupliziert via Fingerprint
- Läuft im `prebuild` Worker-Pool

### 3c. Validator-Job: `validate_variant_inventory`
- Prüft Coverage-Ratio, Approved-Quote, Fingerprint-Aktualität
- Setzt `variant_prebuild_status` auf Package-Ebene
- Markiert Package als `prebuilt` wenn alle Inventory-Einträge `ready`

### 3d. Edge Function Updates
- `generate-blueprint-variants`: nach Completion → Inventory-Update (materialized_count++)
- Promotion-Logic: nach Approval → Inventory-Update (approved_count++)
- Trigger auf `blueprint_variant_inventory` → auto-update `coverage_ratio` und `status`

## Reihenfolge der Umsetzung
1. Migration (Tabelle + Felder + Funktionen + Policies) — einzelner Batch
2. Job-Type-Registry Updates
3. `claim_pending_jobs_v4` Update (Pool-Routing)
4. Edge Function Updates (Inventory-Tracking)
5. Guard-Integration (Readiness-Gate)
6. Bestehende pending Jobs in neuen Pool migrieren
