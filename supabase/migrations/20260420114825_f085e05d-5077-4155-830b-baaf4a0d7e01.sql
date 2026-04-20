-- ─────────────────────────────────────────────────────────────
-- P0-Härtung Auto-SEO-Suite (2026-04-20)
-- 1. Unique constraint für UPSERT in package-auto-generate-seo-suite
-- 2. Re-Backfill für 28 published Pakete (vorheriger Backfill kam nicht durch)
-- ─────────────────────────────────────────────────────────────

-- 1. Unique constraint (idempotent, schützt vor Duplikat-Persona-Pages)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.seo_content_pages'::regclass
      AND conname = 'seo_content_pages_pkg_type_persona_uq'
  ) THEN
    -- Erst potenzielle Duplikate aufräumen (sollte leer sein, aber defensiv)
    DELETE FROM public.seo_content_pages a USING public.seo_content_pages b
    WHERE a.id < b.id
      AND a.package_id = b.package_id
      AND COALESCE(a.page_type,'') = COALESCE(b.page_type,'')
      AND COALESCE(a.persona_type,'') = COALESCE(b.persona_type,'');

    ALTER TABLE public.seo_content_pages
      ADD CONSTRAINT seo_content_pages_pkg_type_persona_uq
      UNIQUE (package_id, page_type, persona_type);
  END IF;
END $$;

-- 2. Re-Backfill für published Pakete ohne pending/processing/completed Job
INSERT INTO job_queue (job_type, status, priority, payload, max_attempts, run_after, lane, meta)
SELECT
  'package_auto_generate_seo_suite',
  'pending',
  3,
  jsonb_build_object(
    'package_id',     cp.id,
    'curriculum_id',  cp.curriculum_id,
    'track',          COALESCE(cp.track::text, 'EXAM_FIRST'),
    'reason',         'backfill_published_seo_suite_v2'
  ),
  3,
  now() + (random() * interval '300 seconds'),
  'marketing',
  jsonb_build_object('source','backfill_2026_04_20_v2','enqueued_at', now())
FROM course_packages cp
WHERE cp.status = 'published'
  AND NOT EXISTS (
    SELECT 1 FROM job_queue jq
    WHERE jq.job_type = 'package_auto_generate_seo_suite'
      AND jq.payload->>'package_id' = cp.id::text
      AND jq.status IN ('pending','processing','completed')
  );