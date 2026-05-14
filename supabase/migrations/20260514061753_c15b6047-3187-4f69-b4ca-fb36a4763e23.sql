-- SEO Intent Loop A persistence hardening: allow multiple intent pages per published package
-- Smoke: verifies no duplicate legacy package/persona pages and that the intent unique index exists.
-- Rollback hint: drop idx_seo_content_pages_pkg_type_persona_legacy_uq and recreate constraint seo_content_pages_pkg_type_persona_uq on (package_id,page_type,persona_type) after consolidating intent_page rows.

ALTER TABLE public.seo_content_pages
  DROP CONSTRAINT IF EXISTS seo_content_pages_pkg_type_persona_uq;

DROP INDEX IF EXISTS public.seo_content_pages_pkg_type_persona_uq;

CREATE UNIQUE INDEX IF NOT EXISTS idx_seo_content_pages_pkg_type_persona_legacy_uq
  ON public.seo_content_pages (package_id, page_type, persona_type)
  WHERE package_id IS NOT NULL
    AND intent_template IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS seo_content_pages_intent_uq
  ON public.seo_content_pages (curriculum_id, competency_id, intent_template, persona_type)
  WHERE competency_id IS NOT NULL
    AND intent_template IS NOT NULL;

DO $$
DECLARE
  v_legacy_dupes int;
  v_intent_idx int;
BEGIN
  SELECT COUNT(*) INTO v_legacy_dupes
  FROM (
    SELECT package_id, page_type, persona_type
    FROM public.seo_content_pages
    WHERE package_id IS NOT NULL
      AND intent_template IS NULL
    GROUP BY package_id, page_type, persona_type
    HAVING COUNT(*) > 1
  ) d;

  SELECT COUNT(*) INTO v_intent_idx
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'seo_content_pages'
    AND indexname = 'seo_content_pages_intent_uq';

  IF v_legacy_dupes > 0 THEN
    RAISE EXCEPTION 'Smoke FAIL: duplicate legacy seo_content_pages rows=%', v_legacy_dupes;
  END IF;

  IF v_intent_idx <> 1 THEN
    RAISE EXCEPTION 'Smoke FAIL: missing seo_content_pages_intent_uq';
  END IF;

  INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
  VALUES (
    'seo_intent_persistence_index_hardened',
    'system',
    'success',
    jsonb_build_object(
      'concern', 'seo_content_pages package/persona uniqueness no longer blocks multiple intent pages',
      'legacy_unique_index', 'idx_seo_content_pages_pkg_type_persona_legacy_uq',
      'intent_unique_index', 'seo_content_pages_intent_uq',
      'legacy_duplicate_count', v_legacy_dupes,
      'rollback_hint', 'Recreate seo_content_pages_pkg_type_persona_uq only after consolidating intent_page rows per package/persona.'
    )
  );
END $$;