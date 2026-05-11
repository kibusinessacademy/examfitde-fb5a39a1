---
name: F2.a seo_internal_link_suggestions Schema Hardening
description: Add source_doc_id (FK seo_documents, nullable, ON DELETE SET NULL), unique idempotency key (source_url,target_url,link_type), lookup index (source_url,status), partial index source_doc_id, status CHECK constraint (suggested|active|approved|rejected) added NOT VALID then VALIDATED (current 3855 rows clean: 3744 suggested + 111 active). No backfill, no linker code, no status harmonization. Audit action_type=seo_ils_schema_hardened_v1.
type: feature
---

## Pre-State (2026-05-11)
- 3855 rows, 0 duplicates on (source_url,target_url,link_type) → unique key safe.
- Status values clean: only `suggested` (3744) + `active` (111). CHECK NOT VALID + VALIDATE works.
- Table had no FK, no CHECK, no indexes on key columns.

## Migration 20260511180743
1. ADD COLUMN source_doc_id uuid NULL REFERENCES seo_documents(id) ON DELETE SET NULL
2. CREATE UNIQUE INDEX uq_seo_ils_source_target_type (source_url,target_url,link_type)
3. CREATE INDEX ix_seo_ils_source_status (source_url,status)
4. CREATE INDEX ix_seo_ils_source_doc_id (source_doc_id) WHERE source_doc_id IS NOT NULL
5. ADD CONSTRAINT seo_ils_status_check CHECK (status IN ('suggested','active','approved','rejected')) NOT VALID; VALIDATE.
6. Smoke: rows count, dups=0, unique exists, check valid, invalid status raises check_violation.
7. Audit row in auto_heal_log.

## Out of scope (defer)
- F2.b: Linker SSOT-Write (upsertSuggestion ON CONFLICT) — code-only follow-up.
- F2.c: Status harmonization (hook reads `active`, admin writes `approved`) — separate.
- Backfill of source_doc_id (slug-join) — separate.

## Rollback
```sql
ALTER TABLE public.seo_internal_link_suggestions DROP CONSTRAINT seo_ils_status_check;
DROP INDEX IF EXISTS public.uq_seo_ils_source_target_type, public.ix_seo_ils_source_status, public.ix_seo_ils_source_doc_id;
ALTER TABLE public.seo_internal_link_suggestions DROP COLUMN source_doc_id;
```
