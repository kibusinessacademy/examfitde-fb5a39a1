-- 0. Job-Type registrieren (Guard-Voraussetzung)
INSERT INTO public.ops_job_type_registry (job_type, pool, description, registered_at)
VALUES (
  'package_auto_generate_seo_suite',
  'marketing',
  'Auto-SEO-Suite: Pillar + Cluster + Blog + FAQ + Internal Links bei course_published',
  now()
)
ON CONFLICT (job_type) DO NOTHING;

-- 1. Auto-SEO-Suite Trigger
CREATE OR REPLACE FUNCTION public.trg_fn_post_publish_seo_suite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF (TG_OP = 'UPDATE'
      AND OLD.status IS DISTINCT FROM 'published'
      AND NEW.status = 'published') THEN

    IF NOT EXISTS (
      SELECT 1 FROM job_queue
      WHERE job_type = 'package_auto_generate_seo_suite'
        AND payload->>'package_id' = NEW.id::text
        AND status IN ('pending','processing')
    ) THEN
      INSERT INTO job_queue (job_type, status, priority, payload, max_attempts, run_after, lane, meta)
      VALUES (
        'package_auto_generate_seo_suite',
        'pending', 2,
        jsonb_build_object(
          'package_id',     NEW.id,
          'curriculum_id',  NEW.curriculum_id,
          'track',          COALESCE(NEW.track::text, 'EXAM_FIRST'),
          'reason',         'post_publish_seo_suite'
        ),
        3, now() + interval '15 seconds', 'marketing',
        jsonb_build_object('source','trg_post_publish_seo_suite','enqueued_at', now())
      );
    END IF;

    INSERT INTO admin_notifications (title, body, severity, category, entity_type, entity_id)
    VALUES (
      '🚀 Auto-SEO-Suite enqueued',
      format('SEO-Suite Job enqueued für Paket %s (track=%s)', NEW.title, COALESCE(NEW.track::text,'?')),
      'info', 'marketing', 'course_package', NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_publish_seo_suite ON public.course_packages;
CREATE TRIGGER trg_post_publish_seo_suite
AFTER UPDATE ON public.course_packages
FOR EACH ROW
EXECUTE FUNCTION public.trg_fn_post_publish_seo_suite();

-- 2. Backfill für 28 published Pakete
INSERT INTO job_queue (job_type, status, priority, payload, max_attempts, run_after, lane, meta)
SELECT
  'package_auto_generate_seo_suite', 'pending', 3,
  jsonb_build_object(
    'package_id',     cp.id,
    'curriculum_id',  cp.curriculum_id,
    'track',          COALESCE(cp.track::text, 'EXAM_FIRST'),
    'reason',         'backfill_published_seo_suite'
  ),
  3, now() + (random() * interval '600 seconds'), 'marketing',
  jsonb_build_object('source','backfill_2026_04_20','enqueued_at', now())
FROM course_packages cp
WHERE cp.status = 'published'
  AND NOT EXISTS (
    SELECT 1 FROM job_queue jq
    WHERE jq.job_type = 'package_auto_generate_seo_suite'
      AND jq.payload->>'package_id' = cp.id::text
      AND jq.status IN ('pending','processing','completed')
  );

-- 3. Cleane View ohne Phantom-Leak
CREATE OR REPLACE VIEW public.v_product_page_published_ssot AS
SELECT * FROM public.v_product_page_ssot
WHERE status = 'published';

COMMENT ON VIEW public.v_product_page_published_ssot IS
  'P0-Fix 2026-04-20: Filtert Phantom-Pages aus v_product_page_ssot. Frontend MUSS diese View nutzen statt v_product_page_ssot.';

-- 4. BB-Pilot v4 Reset
UPDATE public.job_queue
SET status='pending', attempts=0, max_attempts=3,
    run_after = now() + interval '20 seconds',
    last_error=NULL, locked_by=NULL, locked_at=NULL, started_at=NULL,
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
             'wave','15c_param_sets_hybrid_v2',
             'manual_reset_at', now()::text,
             'reset_reason','auto_heal_killed_before_first_run'
           )
WHERE id = '19220d90-19ee-4f81-a799-e9504d31701d';