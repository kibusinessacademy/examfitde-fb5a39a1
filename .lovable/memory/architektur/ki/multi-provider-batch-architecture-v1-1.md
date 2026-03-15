# Memory: architektur/ki/multi-provider-batch-architecture-v1-1
Updated: now

Das Batch-System nutzt eine provider-agnostische Architektur (`llm_batches`, `llm_batch_requests`) für die asynchrone Massenverarbeitung mit 50 % Kostenersparnis. OpenAI ist der primäre Adapter (Files-API, max. 200 MB / 50k Requests). Die Verarbeitung erfolgt über ein automatisiertes Polling (`batch-poll`), das bei Abschluss einen `batch-result-importer` triggert. Dieser fungiert als zentraler Router und delegiert die Resultate basierend auf dem `job_type` an domänenspezifische Importer (z. B. `package_generate_exam_pool`, `lesson_generate_content`), um die Integration in die Pipeline sicherzustellen.

**Kritische Hardening-Fixes (v1.1):**
1. **job_type SSOT**: Zentrale Konstanten in `_shared/batch/job-types.ts` (`BATCH_JOB_TYPES`). Importer-Registry akzeptiert sowohl kanonische (`lesson_generate_content`, `package_generate_exam_pool`) als auch Legacy-Namen (`learning_content`, `exam_pool_generate`).
2. **source_ref Spaltentyp**: Migration von `text` auf `jsonb` für strukturierte Source-Referenzen (lesson_id, course_id etc.).
3. **content-runner batch_mode Guard**: Neuer Guard erkennt `batch_mode: true` + `batch_complete: false` und setzt Job auf `batch_pending` statt fälschlicherweise `completed`.
4. **Deterministischer custom_id**: `lesson_{lessonId}_{stepKey}_{jobHash}` statt `Date.now()` für saubere Idempotenz.
5. **job_queue.meta Write**: `merge_job_meta` RPC statt wirkungslosem `sb.rpc ? undefined` Conditional, mit Fallback auf read-merge-write.

Ein Idempotenz-Schutz (`results_imported_at`, `domain_imported_at`) und die automatische Reconciliation terminaler Zustände sichern die Datenintegrität. Die Abrechnung erfolgt nach SSOT-Pricing.
