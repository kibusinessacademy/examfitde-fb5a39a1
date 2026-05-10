-- ============================================================
-- MiniCheck Quality v2 — Diagnosis only (no repair, no jobs)
-- ============================================================

-- 1) v_minicheck_rejection_clusters
CREATE OR REPLACE VIEW public.v_minicheck_rejection_clusters AS
WITH base AS (
  SELECT
    mq.id,
    mq.package_id,
    mq.lesson_id,
    mq.competency_id,
    mq.curriculum_id,
    mq.mode,
    mq.status,
    mq.link_status,
    mq.audit_status,
    mq.is_duplicate,
    mq.trap_type,
    (mq.distractor_meta IS NOT NULL AND mq.distractor_meta::text NOT IN ('null','{}','[]')) AS has_distractor_meta,
    (mq.trap_tags IS NOT NULL AND array_length(mq.trap_tags,1) > 0) AS has_trap_tags,
    mq.cognitive_level,
    CASE
      WHEN mq.is_duplicate IS TRUE OR mq.status = 'archived_duplicate' THEN 'duplicate'
      WHEN mq.link_status = 'unlinked_generic' THEN 'unlinked_generic'
      WHEN mq.link_status = 'link_pending'    THEN 'link_pending'
      WHEN mq.status = 'draft' AND mq.link_status = 'linked' THEN 'draft_unapproved_linked'
      WHEN mq.status = 'draft' THEN 'draft_other'
      WHEN mq.status = 'approved' AND COALESCE(mq.audit_status,'') = '' THEN 'approved_unaudited'
      WHEN mq.status = 'approved' THEN 'approved_audited'
      ELSE 'other'
    END AS rejection_reason,
    CASE WHEN mq.status = 'approved' THEN 1 ELSE 0 END AS is_approved,
    CASE WHEN mq.status IN ('approved') THEN 0 ELSE 1 END AS is_unapproved
  FROM public.minicheck_questions mq
)
SELECT
  package_id,
  lesson_id,
  competency_id,
  mode AS question_type,
  rejection_reason,
  status,
  link_status,
  audit_status,
  has_distractor_meta,
  has_trap_tags,
  trap_type,
  cognitive_level,
  COUNT(*) AS cluster_size,
  SUM(is_approved)   AS approved_count,
  SUM(is_unapproved) AS unapproved_count,
  ROUND( (SUM(is_approved)::numeric / NULLIF(COUNT(*),0)) * 100.0, 2) AS approval_pct
FROM base
GROUP BY 1,2,3,4,5,6,7,8,9,10,11,12;

REVOKE ALL ON public.v_minicheck_rejection_clusters FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_minicheck_rejection_clusters TO service_role;

-- 2) admin_get_minicheck_quality_diagnosis
CREATE OR REPLACE FUNCTION public.admin_get_minicheck_quality_diagnosis(
  p_package_ids uuid[]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_overview  jsonb;
  v_top_clusters jsonb;
  v_lessons   jsonb;
  v_examples  jsonb;
  v_strategy  jsonb;
  v_result    jsonb;
BEGIN
  IF NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  IF p_package_ids IS NULL OR array_length(p_package_ids,1) IS NULL THEN
    RAISE EXCEPTION 'p_package_ids must not be empty';
  END IF;

  -- Per-package overview
  SELECT jsonb_agg(row_to_json(o)) INTO v_overview
  FROM (
    SELECT
      cp.id AS package_id,
      cp.title AS package_title,
      cp.status AS package_status,
      COUNT(mq.*) AS total_mc,
      COUNT(*) FILTER (WHERE mq.status='approved') AS approved,
      COUNT(*) FILTER (WHERE mq.status<>'approved') AS unapproved,
      COUNT(*) FILTER (WHERE mq.is_duplicate IS TRUE OR mq.status='archived_duplicate') AS duplicates,
      COUNT(*) FILTER (WHERE mq.link_status='link_pending') AS link_pending,
      COUNT(*) FILTER (WHERE mq.link_status='unlinked_generic') AS unlinked_generic,
      COUNT(*) FILTER (WHERE mq.status='draft' AND mq.link_status='linked') AS draft_linked,
      ROUND( (COUNT(*) FILTER (WHERE mq.status='approved')::numeric
               / NULLIF(COUNT(mq.*),0)) * 100.0, 2) AS approval_pct
    FROM public.course_packages cp
    LEFT JOIN public.minicheck_questions mq ON mq.package_id = cp.id
    WHERE cp.id = ANY (p_package_ids)
    GROUP BY cp.id, cp.title, cp.status
  ) o;

  -- Top rejection clusters across selected packages
  SELECT jsonb_agg(row_to_json(c)) INTO v_top_clusters
  FROM (
    SELECT
      package_id,
      rejection_reason,
      question_type,
      SUM(cluster_size)     AS cluster_size,
      SUM(unapproved_count) AS unapproved_count,
      SUM(approved_count)   AS approved_count,
      ROUND( (SUM(approved_count)::numeric / NULLIF(SUM(cluster_size),0)) * 100.0, 2) AS approval_pct,
      COUNT(DISTINCT lesson_id)     AS lessons_affected,
      COUNT(DISTINCT competency_id) AS competencies_affected
    FROM public.v_minicheck_rejection_clusters
    WHERE package_id = ANY (p_package_ids)
    GROUP BY package_id, rejection_reason, question_type
    ORDER BY unapproved_count DESC NULLS LAST
    LIMIT 50
  ) c;

  -- Top affected lessons
  SELECT jsonb_agg(row_to_json(l)) INTO v_lessons
  FROM (
    SELECT
      mq.package_id,
      mq.lesson_id,
      l.title AS lesson_title,
      mq.competency_id,
      COUNT(*) AS total_mc,
      COUNT(*) FILTER (WHERE mq.status='approved') AS approved,
      COUNT(*) FILTER (WHERE mq.status<>'approved') AS unapproved,
      ROUND( (COUNT(*) FILTER (WHERE mq.status='approved')::numeric
               / NULLIF(COUNT(*),0)) * 100.0, 2) AS approval_pct
    FROM public.minicheck_questions mq
    LEFT JOIN public.lessons l ON l.id = mq.lesson_id
    WHERE mq.package_id = ANY (p_package_ids)
    GROUP BY mq.package_id, mq.lesson_id, l.title, mq.competency_id
    HAVING COUNT(*) FILTER (WHERE mq.status<>'approved') > 0
    ORDER BY unapproved DESC
    LIMIT 50
  ) l;

  -- Example unapproved MCs (small sample)
  SELECT jsonb_agg(row_to_json(e)) INTO v_examples
  FROM (
    SELECT
      mq.id,
      mq.package_id,
      mq.lesson_id,
      mq.competency_id,
      mq.status,
      mq.link_status,
      mq.is_duplicate,
      LEFT(mq.question_text, 220) AS question_preview,
      mq.options,
      mq.correct_answer,
      mq.trap_type,
      CASE
        WHEN mq.is_duplicate IS TRUE OR mq.status='archived_duplicate' THEN 'duplicate'
        WHEN mq.link_status = 'unlinked_generic' THEN 'unlinked_generic'
        WHEN mq.link_status = 'link_pending'    THEN 'link_pending'
        WHEN mq.status = 'draft' AND mq.link_status = 'linked' THEN 'draft_unapproved_linked'
        WHEN mq.status = 'draft' THEN 'draft_other'
        ELSE 'other'
      END AS rejection_reason
    FROM public.minicheck_questions mq
    WHERE mq.package_id = ANY (p_package_ids)
      AND mq.status <> 'approved'
    ORDER BY mq.updated_at DESC NULLS LAST
    LIMIT 30
  ) e;

  -- Recommended repair strategy per dominant reason
  WITH agg AS (
    SELECT
      rejection_reason,
      SUM(unapproved_count) AS n
    FROM public.v_minicheck_rejection_clusters
    WHERE package_id = ANY (p_package_ids)
      AND rejection_reason NOT IN ('approved_audited','approved_unaudited')
    GROUP BY rejection_reason
  )
  SELECT jsonb_agg(jsonb_build_object(
    'rejection_reason', rejection_reason,
    'unapproved_count', n,
    'recommended_strategy', CASE rejection_reason
      WHEN 'duplicate'                 THEN 'dedupe_then_replace: drop duplicates, regenerate replacements with negative-example prompt'
      WHEN 'unlinked_generic'          THEN 'relink_or_regenerate: re-link to lesson/competency or regenerate with explicit competency context'
      WHEN 'link_pending'              THEN 'force_relink: run linker pass, fall back to regeneration with blueprint context'
      WHEN 'draft_unapproved_linked'   THEN 'reason_aware_regen: feed council rejection rationale + blueprint context, replace not append'
      WHEN 'draft_other'               THEN 'audit_first: classify rejection cause before regenerating'
      ELSE 'manual_review'
    END
  )) INTO v_strategy
  FROM agg ORDER BY n DESC;

  v_result := jsonb_build_object(
    'generated_at', now(),
    'package_ids',  to_jsonb(p_package_ids),
    'overview',     COALESCE(v_overview,    '[]'::jsonb),
    'top_clusters', COALESCE(v_top_clusters,'[]'::jsonb),
    'lessons',      COALESCE(v_lessons,     '[]'::jsonb),
    'examples',     COALESCE(v_examples,    '[]'::jsonb),
    'strategy',     COALESCE(v_strategy,    '[]'::jsonb)
  );

  -- Audit (diagnosis only)
  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'minicheck_quality_diagnosis_run',
    'system',
    NULL,
    'ok',
    jsonb_build_object(
      'actor_uid',         v_uid,
      'package_ids',       to_jsonb(p_package_ids),
      'package_count',     array_length(p_package_ids,1),
      'overview_size',     COALESCE(jsonb_array_length(v_overview),0),
      'top_clusters_size', COALESCE(jsonb_array_length(v_top_clusters),0),
      'lessons_size',      COALESCE(jsonb_array_length(v_lessons),0),
      'examples_size',     COALESCE(jsonb_array_length(v_examples),0),
      'strategy_size',     COALESCE(jsonb_array_length(v_strategy),0),
      'no_repair',         true,
      'no_new_jobs',       true
    )
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_minicheck_quality_diagnosis(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_minicheck_quality_diagnosis(uuid[]) TO authenticated;