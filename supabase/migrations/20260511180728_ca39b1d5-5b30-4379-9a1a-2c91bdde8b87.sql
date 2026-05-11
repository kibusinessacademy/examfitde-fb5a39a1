
-- F2.a: seo_internal_link_suggestions schema hardening (no backfill, no linker code)
BEGIN;

-- 1) source_doc_id nullable + FK
ALTER TABLE public.seo_internal_link_suggestions
  ADD COLUMN IF NOT EXISTS source_doc_id uuid NULL
    REFERENCES public.seo_documents(id) ON DELETE SET NULL;

-- 2) Unique idempotency key
CREATE UNIQUE INDEX IF NOT EXISTS uq_seo_ils_source_target_type
  ON public.seo_internal_link_suggestions (source_url, target_url, link_type);

-- 3) Lookup index for hook (source_url, status)
CREATE INDEX IF NOT EXISTS ix_seo_ils_source_status
  ON public.seo_internal_link_suggestions (source_url, status);

-- 4) Partial index on source_doc_id (only where set)
CREATE INDEX IF NOT EXISTS ix_seo_ils_source_doc_id
  ON public.seo_internal_link_suggestions (source_doc_id)
  WHERE source_doc_id IS NOT NULL;

-- 5) Status guard via CHECK NOT VALID + VALIDATE (current values: suggested, active — clean)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'seo_ils_status_check'
      AND conrelid = 'public.seo_internal_link_suggestions'::regclass
  ) THEN
    ALTER TABLE public.seo_internal_link_suggestions
      ADD CONSTRAINT seo_ils_status_check
      CHECK (status IN ('suggested','active','approved','rejected')) NOT VALID;
    ALTER TABLE public.seo_internal_link_suggestions
      VALIDATE CONSTRAINT seo_ils_status_check;
  END IF;
END $$;

-- 6+7) Smoke + audit
DO $$
DECLARE
  v_rows bigint;
  v_dups bigint;
  v_has_unique boolean;
  v_has_check boolean;
  v_invalid_blocked boolean := false;
BEGIN
  SELECT COUNT(*) INTO v_rows FROM public.seo_internal_link_suggestions;

  SELECT COUNT(*) INTO v_dups FROM (
    SELECT source_url, target_url, link_type, COUNT(*) c
    FROM public.seo_internal_link_suggestions
    GROUP BY 1,2,3 HAVING COUNT(*) > 1
  ) d;

  SELECT EXISTS(
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='uq_seo_ils_source_target_type'
  ) INTO v_has_unique;

  SELECT EXISTS(
    SELECT 1 FROM pg_constraint
    WHERE conname='seo_ils_status_check'
      AND conrelid='public.seo_internal_link_suggestions'::regclass
      AND convalidated = true
  ) INTO v_has_check;

  -- Test invalid status is blocked (rolled back via savepoint)
  BEGIN
    INSERT INTO public.seo_internal_link_suggestions
      (source_url, target_url, link_type, anchor_text, status)
    VALUES ('__smoke__','__smoke__','__smoke__','x','__invalid__');
  EXCEPTION WHEN check_violation THEN
    v_invalid_blocked := true;
  END;

  IF v_dups <> 0 THEN
    RAISE EXCEPTION 'F2.a smoke FAIL: duplicates=%', v_dups;
  END IF;
  IF NOT v_has_unique THEN
    RAISE EXCEPTION 'F2.a smoke FAIL: unique index missing';
  END IF;
  IF NOT v_has_check THEN
    RAISE EXCEPTION 'F2.a smoke FAIL: status check missing/invalid';
  END IF;
  IF NOT v_invalid_blocked THEN
    RAISE EXCEPTION 'F2.a smoke FAIL: invalid status was not blocked';
  END IF;

  INSERT INTO public.auto_heal_log (action_type, target_type, result_status, trigger_source, metadata)
  VALUES (
    'seo_ils_schema_hardened_v1',
    'system',
    'ok',
    'migration',
    jsonb_build_object(
      'rows', v_rows,
      'duplicates', v_dups,
      'unique_index', 'uq_seo_ils_source_target_type',
      'status_check', 'seo_ils_status_check (VALID)',
      'allowed_status', ARRAY['suggested','active','approved','rejected'],
      'fk_added', 'source_doc_id -> seo_documents(id) ON DELETE SET NULL',
      'rollback_hint', 'DROP CONSTRAINT seo_ils_status_check; DROP INDEX uq_seo_ils_source_target_type, ix_seo_ils_source_status, ix_seo_ils_source_doc_id; ALTER TABLE ... DROP COLUMN source_doc_id;'
    )
  );
END $$;

COMMIT;
