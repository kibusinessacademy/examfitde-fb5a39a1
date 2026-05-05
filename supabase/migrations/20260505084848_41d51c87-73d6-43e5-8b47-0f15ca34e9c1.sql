-- ============================================================================
-- 1) SEO-Page RLS Heal — beendet False-Positive Drift im Cockpit
-- ============================================================================
ALTER TABLE public.seo_content_pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read published seo pages" ON public.seo_content_pages;
CREATE POLICY "Public can read published seo pages"
  ON public.seo_content_pages
  FOR SELECT
  USING (status = 'published');

DROP POLICY IF EXISTS "Admins can read all seo pages" ON public.seo_content_pages;
CREATE POLICY "Admins can read all seo pages"
  ON public.seo_content_pages
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ============================================================================
-- 2) Verification-Funktion: schreibt Zusammenfassung als auto_heal_log Eintrag
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_pipeline_loop_verification_run()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_counts jsonb;
  v_total int;
BEGIN
  SELECT jsonb_object_agg(action_type, cnt), COALESCE(SUM(cnt),0)
    INTO v_counts, v_total
  FROM (
    SELECT action_type, COUNT(*)::int AS cnt
    FROM public.auto_heal_log
    WHERE created_at > now() - interval '15 minutes'
      AND action_type IN (
        'producer_source_missing_blocked',
        'bronze_locked_enqueue_blocked',
        'producer_blocked_package_progress',
        'pipeline_step_drift_v3_heal',
        'pipeline_step_drift_v3_heal_skipped',
        'tail_step_enqueue_drift_heal',
        'enqueue_source_missing_warn'
      )
    GROUP BY action_type
  ) s;

  v_counts := COALESCE(v_counts, '{}'::jsonb);

  INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'pipeline_loop_verification_summary',
    'system',
    'pipeline',
    CASE
      WHEN COALESCE((v_counts->>'producer_source_missing_blocked')::int, 0) > 0 THEN 'attention'
      WHEN COALESCE((v_counts->>'pipeline_step_drift_v3_heal')::int, 0) > 50 THEN 'attention'
      ELSE 'ok'
    END,
    jsonb_build_object(
      'window', '15 minutes',
      'counts', v_counts,
      'total', v_total,
      'producer_source_missing_blocked', COALESCE((v_counts->>'producer_source_missing_blocked')::int, 0),
      'bronze_locked_enqueue_blocked',   COALESCE((v_counts->>'bronze_locked_enqueue_blocked')::int, 0),
      'producer_blocked_package_progress', COALESCE((v_counts->>'producer_blocked_package_progress')::int, 0)
    )
  );

  RETURN v_counts;
END $$;

REVOKE ALL ON FUNCTION public.fn_pipeline_loop_verification_run() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_pipeline_loop_verification_run() TO service_role;

-- ============================================================================
-- 3) Cron alle 15 Minuten
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pipeline-loop-verification-15min') THEN
    PERFORM cron.unschedule('pipeline-loop-verification-15min');
  END IF;
  PERFORM cron.schedule(
    'pipeline-loop-verification-15min',
    '*/15 * * * *',
    $cron$ SELECT public.fn_pipeline_loop_verification_run(); $cron$
  );
END $$;

-- ============================================================================
-- 4) Manueller Bypass-Heal SEO-Drift (sicherheitshalber, idempotent)
-- ============================================================================
SELECT public.admin_seo_publish_drift_heal();
