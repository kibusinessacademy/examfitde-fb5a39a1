# Memory: architektur/ki/ai-generation-gateway-v1
Updated: now

Das 'AI Generation Gateway' ist die zentrale Kontrollschicht für alle LLM-Generierungen. Es erzwingt einen dreistufigen Prüfpfad vor jedem LLM-Call:

1. **Policy-Engine** (`ai_generation_policies` DB-Tabelle + `_shared/ai-gateway/policies.ts`): Pro `job_type` konfigurierbare Regeln für Batch/Sync-Präferenz, Deficit-Pflicht, Cache-Nutzung, Template-First, max. Retries, erlaubte Modelle und Token-Limits. DB-Werte überschreiben Code-Defaults.

2. **Deficit-Engine** (`_shared/ai-gateway/deficits.ts`): Prüft vor jeder Generierung, ob das Ziel-Artefakt bereits existiert (approved content_version für Lessons, target_count für Exam-Pools). Bei `shouldGenerate: false` wird der LLM-Call übersprungen → sofortige Kostenersparnis.

3. **Cache-Layer** (`ai_generation_cache` Tabelle + `_shared/ai-gateway/cache.ts`): SHA-256 Fingerprint über `job_type + model + prompt_hash + blueprint_id + difficulty`. Cache-Hits liefern gespeicherte Responses ohne LLM-Call. Besonders wertvoll für Blueprint-basierte Generierungen.

4. **Routing-Entscheider** (`_shared/ai-gateway/router.ts`): Pure Function `decideRouting()` → `skipped | cache_hit | template_only | batch | sync`. Entscheidet basierend auf Policy, Deficit, Cache, Urgency und Force-Flags.

5. **Fingerprint-Dedup** (`_shared/ai-gateway/fingerprints.ts`): Verhindert doppelte Requests über `request_fingerprint` in `ai_generation_requests`.

6. **Zentrale Tracking-Tabelle** (`ai_generation_requests`): Jede Generierungsanforderung wird mit Status, Policy-Snapshot, Deficit-Ergebnis, Routing-Mode und Result-Summary persistiert.

Die Edge Function `ai-generation-gateway` dient als eigenständiger Eintrittspunkt. Zusätzlich ist der Gateway-Flow direkt in `process-lesson.ts` integriert (Policy + Deficit + Cache Checks vor Batch/Sync-Entscheidung).

Aktive Policies (6 Job-Types): `lesson_generate_content`, `package_generate_exam_pool`, `expand_handbook_section`, `package_generate_oral_exam`, `package_generate_lesson_minichecks`, `package_generate_glossary`.
