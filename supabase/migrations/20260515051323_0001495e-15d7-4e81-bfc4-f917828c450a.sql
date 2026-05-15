-- ============================================================
-- Variant Pipeline Health Forensics v1
-- Read-only views + RPC. No bridges, no enqueue side effects.
-- ============================================================

-- 1) Per-package pipeline health
CREATE OR REPLACE VIEW public.v_variant_pipeline_health AS
WITH base AS (
  SELECT
    cp.id AS package_id,
    cp.title,
    cp.curriculum_id,
    v.status,
    v.created_at,
    v.updated_at,
    v.learning_field_id
  FROM public.course_packages cp
  JOIN public.exam_question_variants v ON v.curriculum_id = cp.curriculum_id
)
SELECT
  package_id,
  title,
  curriculum_id,
  COUNT(*) FILTER (WHERE status='review')   AS review_cnt,
  COUNT(*) FILTER (WHERE status='approved') AS approved_cnt,
  COUNT(*) FILTER (WHERE status='rejected') AS rejected_cnt,
  COUNT(*) FILTER (WHERE status='review' AND created_at < now() - interval '24 hours') AS review_older_24h,
  COUNT(*) FILTER (WHERE status='review' AND created_at < now() - interval '7 days')   AS review_older_7d,
  COUNT(*) FILTER (WHERE status='approved' AND updated_at > now() - interval '24 hours') AS approved_24h,
  COUNT(*) FILTER (WHERE status='approved' AND updated_at > now() - interval '7 days')   AS approved_7d,
  COUNT(*) FILTER (WHERE status='rejected' AND updated_at > now() - interval '24 hours') AS rejected_24h,
  EXTRACT(EPOCH FROM (now() - MIN(created_at) FILTER (WHERE status='review')))::bigint AS oldest_review_sec,
  EXTRACT(EPOCH FROM percentile_cont(0.5)  WITHIN GROUP (ORDER BY now() - created_at) FILTER (WHERE status='review'))::bigint AS p50_review_age_sec,
  EXTRACT(EPOCH FROM percentile_cont(0.95) WITHIN GROUP (ORDER BY now() - created_at) FILTER (WHERE status='review'))::bigint AS p95_review_age_sec
FROM base
GROUP BY package_id, title, curriculum_id;

REVOKE ALL ON public.v_variant_pipeline_health FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_variant_pipeline_health TO service_role;

-- 2) RPC (admin only)
CREATE OR REPLACE FUNCTION public.admin_get_variant_pipeline_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_global jsonb;
  v_aging jsonb;
  v_throughput jsonb;
  v_queue jsonb;
  v_stalled jsonb;
  v_lf_hot jsonb;
  v_review_total bigint;
  v_approved_24h bigint;
  v_approved_per_hour numeric;
  v_drain_hours numeric;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Global counters
  SELECT
    jsonb_build_object(
      'review',   COUNT(*) FILTER (WHERE status='review'),
      'approved', COUNT(*) FILTER (WHERE status='approved'),
      'rejected', COUNT(*) FILTER (WHERE status='rejected'),
      'approved_1h',  COUNT(*) FILTER (WHERE status='approved' AND updated_at > now() - interval '1 hour'),
      'approved_24h', COUNT(*) FILTER (WHERE status='approved' AND updated_at > now() - interval '24 hours'),
      'approved_7d',  COUNT(*) FILTER (WHERE status='approved' AND updated_at > now() - interval '7 days'),
      'rejected_1h',  COUNT(*) FILTER (WHERE status='rejected' AND updated_at > now() - interval '1 hour'),
      'rejected_24h', COUNT(*) FILTER (WHERE status='rejected' AND updated_at > now() - interval '24 hours'),
      'rejected_7d',  COUNT(*) FILTER (WHERE status='rejected' AND updated_at > now() - interval '7 days')
    )
  INTO v_global
  FROM public.exam_question_variants;

  v_review_total := COALESCE((v_global->>'review')::bigint, 0);
  v_approved_24h := COALESCE((v_global->>'approved_24h')::bigint, 0);
  v_approved_per_hour := CASE WHEN v_approved_24h > 0 THEN v_approved_24h::numeric / 24.0 ELSE 0 END;
  v_drain_hours := CASE WHEN v_approved_per_hour > 0 THEN v_review_total::numeric / v_approved_per_hour ELSE NULL END;

  -- Aging buckets
  SELECT jsonb_agg(jsonb_build_object('bucket', bucket, 'cnt', cnt) ORDER BY ord)
  INTO v_aging
  FROM (
    SELECT
      CASE
        WHEN now()-created_at < interval '1 hour'  THEN '<1h'
        WHEN now()-created_at < interval '6 hours' THEN '<6h'
        WHEN now()-created_at < interval '24 hours' THEN '<24h'
        WHEN now()-created_at < interval '7 days'  THEN '<7d'
        ELSE '>7d'
      END AS bucket,
      CASE
        WHEN now()-created_at < interval '1 hour'  THEN 1
        WHEN now()-created_at < interval '6 hours' THEN 2
        WHEN now()-created_at < interval '24 hours' THEN 3
        WHEN now()-created_at < interval '7 days'  THEN 4
        ELSE 5
      END AS ord,
      COUNT(*) AS cnt
    FROM public.exam_question_variants
    WHERE status='review'
    GROUP BY 1,2
  ) s;

  -- Validate worker throughput last 24h
  SELECT jsonb_build_object(
    'completed_24h', COUNT(*) FILTER (WHERE status='completed' AND completed_at > now() - interval '24 hours'),
    'completed_1h',  COUNT(*) FILTER (WHERE status='completed' AND completed_at > now() - interval '1 hour'),
    'failed_24h',    COUNT(*) FILTER (WHERE status='failed'    AND completed_at > now() - interval '24 hours'),
    'cancelled_24h', COUNT(*) FILTER (WHERE status='cancelled' AND created_at   > now() - interval '24 hours'),
    'avg_wait_sec_24h',       AVG(EXTRACT(EPOCH FROM (started_at - created_at)))   FILTER (WHERE status='completed' AND completed_at > now() - interval '24 hours'),
    'avg_processing_sec_24h', AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) FILTER (WHERE status='completed' AND completed_at > now() - interval '24 hours')
  ) INTO v_throughput
  FROM public.job_queue
  WHERE job_type = 'package_validate_blueprint_variants';

  -- Queue saturation
  SELECT jsonb_build_object(
    'pending_validate',   COUNT(*) FILTER (WHERE job_type='package_validate_blueprint_variants' AND status='pending'),
    'processing_validate',COUNT(*) FILTER (WHERE job_type='package_validate_blueprint_variants' AND status='processing'),
    'pending_promote',    COUNT(*) FILTER (WHERE job_type='package_promote_blueprint_variants'  AND status='pending'),
    'pending_generate',   COUNT(*) FILTER (WHERE job_type='package_generate_blueprint_variants' AND status='pending'),
    'processing_generate',COUNT(*) FILTER (WHERE job_type='package_generate_blueprint_variants' AND status='processing')
  ) INTO v_queue
  FROM public.job_queue
  WHERE job_type IN (
    'package_validate_blueprint_variants',
    'package_promote_blueprint_variants',
    'package_generate_blueprint_variants'
  );

  -- Top 10 stalled packages (largest review backlog with 0 approvals in 7d)
  SELECT jsonb_agg(jsonb_build_object(
    'package_id', package_id,
    'title', title,
    'review_cnt', review_cnt,
    'approved_cnt', approved_cnt,
    'approved_7d', approved_7d,
    'oldest_review_sec', oldest_review_sec,
    'p95_review_age_sec', p95_review_age_sec
  ) ORDER BY review_cnt DESC)
  INTO v_stalled
  FROM (
    SELECT * FROM public.v_variant_pipeline_health
    WHERE review_cnt > 0
    ORDER BY review_cnt DESC
    LIMIT 10
  ) s;

  -- Hottest LF bottlenecks
  SELECT jsonb_agg(jsonb_build_object(
    'learning_field_id', lf_id,
    'lf_code', lf_code,
    'lf_title', lf_title,
    'review_cnt', review_cnt,
    'approved_cnt', approved_cnt,
    'oldest_review_sec', oldest_review_sec
  ) ORDER BY review_cnt DESC)
  INTO v_lf_hot
  FROM (
    SELECT
      v.learning_field_id AS lf_id,
      lf.code AS lf_code,
      lf.title AS lf_title,
      COUNT(*) FILTER (WHERE v.status='review')   AS review_cnt,
      COUNT(*) FILTER (WHERE v.status='approved') AS approved_cnt,
      EXTRACT(EPOCH FROM (now() - MIN(v.created_at) FILTER (WHERE v.status='review')))::bigint AS oldest_review_sec
    FROM public.exam_question_variants v
    LEFT JOIN public.learning_fields lf ON lf.id = v.learning_field_id
    WHERE v.learning_field_id IS NOT NULL
    GROUP BY v.learning_field_id, lf.code, lf.title
    HAVING COUNT(*) FILTER (WHERE v.status='review') > 0
    ORDER BY 4 DESC
    LIMIT 10
  ) s;

  RETURN jsonb_build_object(
    'snapshot_at', now(),
    'global', v_global,
    'approved_per_hour_24h', v_approved_per_hour,
    'projected_drain_hours', v_drain_hours,
    'aging_buckets', COALESCE(v_aging, '[]'::jsonb),
    'validate_throughput', v_throughput,
    'queue', v_queue,
    'top_stalled_packages', COALESCE(v_stalled, '[]'::jsonb),
    'hottest_lf_bottlenecks', COALESCE(v_lf_hot, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_variant_pipeline_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_variant_pipeline_health() TO authenticated;

-- Audit
INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
VALUES (
  'variant_pipeline_health_view_created',
  'system',
  'ok',
  jsonb_build_object(
    'view', 'v_variant_pipeline_health',
    'rpc',  'admin_get_variant_pipeline_health',
    'note', 'Read-only forensics; no enqueue side effects'
  )
);