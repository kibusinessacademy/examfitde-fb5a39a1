# Memory: architektur/ki/multi-provider-batch-architecture-v1-1
Updated: now

Das Batch-System nutzt eine provider-agnostische Architektur (`llm_batches`, `llm_batch_requests`) für die asynchrone Massenverarbeitung mit 50 % Kostenersparnis. OpenAI ist der primäre Adapter (Files-API, max. 200 MB / 50k Requests). Die Verarbeitung erfolgt über ein automatisiertes Polling (`batch-poll`, Minute-Tier, 40 Batches/Zyklus), das bei Abschluss einen `batch-result-importer` triggert. Dieser fungiert als zentraler Router und delegiert die Resultate basierend auf dem `job_type` an domänenspezifische Importer.

**Aktive Batch-Pfade (4 Job-Types):**
1. `lesson_generate_content` → `content_versions` Tabelle (Lessons + Minichecks)
2. `package_generate_exam_pool` → `exam_questions` Tabelle (mit Fingerprint-Dedup, Jaccard, Contamination-Guard)
3. `package_generate_handbook` → `handbook_sections` Tabelle (basis_content, Upsert auf chapter_id+section_key)
4. `package_generate_lesson_minichecks` → `minicheck_questions` Tabelle (per-lesson/drill, 4-Option MC)

**Nicht batch-fähig:** `package_generate_oral_exam` (keine LLM-Calls, Template-basiert), `package_generate_glossary` (einzelner gecachter Call), `expand_handbook_section` (Heavyweight-Modelle).

**Kritische Hardening-Fixes (v1.1):**
1. **job_type SSOT**: Zentrale Konstanten in `_shared/batch/job-types.ts` (`BATCH_JOB_TYPES`).
2. **source_ref JSONB**: Strukturierte Source-Referenzen (lesson_id, chapter_id, section_key etc.).
3. **Catch-up Loop**: `batch-poll` triggert automatisch bis zu 40 pending Domain-Imports pro Zyklus.
4. **Dual-Path Fallback**: Bei Batch-Submit-Fehler fällt jeder Generator automatisch auf Sync zurück.
5. **parseLlmJson**: Zentraler LLM-JSON-Parser für Arrays, Objekte, Concatenated-JSON und Truncation.

Ein Idempotenz-Schutz (`results_imported_at`, `domain_imported_at`) und die automatische Reconciliation terminaler Zustände sichern die Datenintegrität. Die Abrechnung erfolgt nach SSOT-Pricing.
