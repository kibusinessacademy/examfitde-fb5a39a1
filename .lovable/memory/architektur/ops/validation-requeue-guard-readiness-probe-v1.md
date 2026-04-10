# Fix: validation-requeue-guard Zero-Deficit Bug (F-4.3)

## Umgesetzt: 2026-04-10

### Root Cause (gleiche Fehlerklasse wie validate_exam_pool Guard)
`validation-requeue-guard.ts` (F-4) prüfte nur Upstream-Deltas (Step-Completions + Artefakt-Timestamps). Wenn ein Validator alle Kriterien bereits erfüllte aber kein trackbarer Upstream-Step sich änderte (z.B. direkte DB-Korrektur, Backfill, Trigger-basierte Heilung), klassifizierte der Guard das als "kein Fortschritt" → HARD_BLOCK nach 3 identischen Fails.

### Betroffen: 9 Validator-Job-Typen
- `package_validate_lesson_minichecks`
- `package_validate_exam_pool`
- `package_validate_handbook` / `_depth`
- `package_validate_learning_content`
- `package_validate_oral_exam`
- `package_validate_tutor_index`
- `package_validate_blueprints`
- `package_validate_blueprint_variants`

### Fix: 3-Layer Readiness-Probe-Architektur

**Layer 0: STEP_ALREADY_DONE Short-Circuit**
- Wenn Step `status = 'done'` → sofort `blocked: false`
- Verhindert falsches Nachblocken nach bereits erfolgter Heilung

**Layer 1: Gate-Probe (für Validatoren mit Gate-Funktionen)**
- `package_validate_exam_pool` → `fn_classify_exam_pool_gate()` → PASS=allow, HARD_FAIL=block
- `package_validate_learning_content` → `gate_class` aus Step-Meta

**Layer 2: Generic Readiness Probe (für alle anderen)**
- Prüft ob die Artefakt-Datenlage den Validator bestehen lassen würde
- Minichecks: question_count ≥ lesson_count
- Handbook: chapter_count > 0
- Blueprints: approved_count ≥ 10
- Blueprint-Variants: variant_count ≥ blueprint_count × 2
- Oral Exam: question_count ≥ 5
- Tutor Index: index exists

**Layer 3: Original Delta-Logik (Fallback)**
- Nur wenn Probe UNKNOWN oder STILL_BLOCKED zurückgibt
- Unveränderte upstream-progress + cooldown + identical-fail Logik

### Design-Prinzip
> "Der Guard darf keine fehlende Veränderung bestrafen, wenn der Validator-Zielzustand bereits erfüllt ist oder erfüllbar wäre."
