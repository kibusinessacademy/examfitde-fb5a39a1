---
name: Artifact-Tabellen package_id Backfill & Orphan-Policy
description: Backfill von package_id auf 6 Artifact-Tabellen (exam_blueprints, oral_exam_blueprints, exam_questions, minicheck_questions, blueprint_targets, question_blueprints) per chunked Edge-Function admin-backfill-minicheck-package-id (118k rows). Trigger-Bypass via ALTER TABLE DISABLE TRIGGER nötig (statement_timeout sonst). Verbleibende NULL = echte Orphans (Curriculum existiert nicht mehr).
type: feature
---

## Backfill-Pipeline für minicheck_questions.package_id

- **Edge Function**: `admin-backfill-minicheck-package-id` (chunked, idempotent, body `{max_chunks, chunk_size, curriculum_id?}`)
- **RPC #1**: `admin_minicheck_pending_curricula()` → liefert curricula mit NULL-Rows + Count
- **RPC #2**: `admin_minicheck_backfill_chunk(curriculum_id, package_id, limit)` → Chunked UPDATE, returns row count
- **Trigger-Bypass**: RPC deaktiviert `trg_auto_promote_minicheck`, `trg_guard_minicheck_duplicate`, `trg_validate_minicheck_mode`, `trg_autofill_package_id`, `update_minicheck_questions_updated_at` für die Transaktion (sonst Statement-Timeout bei >300 rows). `session_replication_role` geht NICHT (kein superuser).
- Reaktivierung erfolgt per EXCEPTION-Block + finalem `ENABLE TRIGGER`.

## Orphan-Policy

- 204 minicheck_questions zeigen auf `curriculum_id = a0b0c0d0-0003-4000-8000-000000000001` — **das Curriculum existiert nicht mehr** und es gibt keinen Course-Package dazu.
- Diese Zeilen bleiben mit `package_id = NULL` und sollten beim nächsten Cleanup-Sweep gelöscht werden (orphaned Seed/Test-Daten).
- Pattern: Vor Backfill IMMER `LEFT JOIN curricula` + `LEFT JOIN course_packages` prüfen, um Orphans früh zu identifizieren.

## Result

- 118.593 / 118.797 Zeilen (99,83%) erfolgreich backfilled.
- Restliche 204 sind Orphans (kein Curriculum, kein Paket).
- Auto-Trigger `trg_autofill_package_id` greift ab jetzt für alle neuen INSERTs.
