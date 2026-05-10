-- ============================================================
-- MiniCheck Repair v2 — Effective Quality + Replacement Demand
-- ============================================================

-- 1) Effective quality per package (raw vs effective)
CREATE OR REPLACE VIEW public.v_minicheck_effective_quality AS
SELECT
  cp.id   AS package_id,
  cp.title AS package_title,
  cp.status AS package_status,
  COUNT(mq.*)                                                         AS raw_total,
  COUNT(*) FILTER (WHERE mq.status='approved')                        AS approved,
  COUNT(*) FILTER (WHERE mq.status='archived_duplicate'
                       OR mq.is_duplicate IS TRUE)                    AS archived_duplicates,
  COUNT(*) FILTER (WHERE mq.status='draft' AND mq.link_status='linked')      AS draft_linked,
  COUNT(*) FILTER (WHERE mq.link_status='link_pending')               AS link_pending,
  COUNT(*) FILTER (WHERE mq.status NOT IN ('approved','archived_duplicate')
                       AND COALESCE(mq.is_duplicate,false) = false)   AS active_unapproved,
  -- raw quote
  ROUND( (COUNT(*) FILTER (WHERE mq.status='approved')::numeric
           / NULLIF(COUNT(mq.*),0)) * 100.0, 2)                       AS raw_approval_pct,
  -- effective quote: nur active items
  ROUND( (COUNT(*) FILTER (WHERE mq.status='approved')::numeric
           / NULLIF(
               COUNT(*) FILTER (WHERE mq.status='approved')
             + COUNT(*) FILTER (WHERE mq.status NOT IN ('approved','archived_duplicate')
                                    AND COALESCE(mq.is_duplicate,false) = false),
             0)) * 100.0, 2)                                          AS effective_approval_pct
FROM public.course_packages cp
LEFT JOIN public.minicheck_questions mq ON mq.package_id = cp.id
GROUP BY cp.id, cp.title, cp.status;

REVOKE ALL ON public.v_minicheck_effective_quality FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_minicheck_effective_quality TO service_role;

-- 2) Replacement demand per (package, lesson, competency, question_type)
CREATE OR REPLACE VIEW public.v_minicheck_replacement_demand AS
WITH agg AS (
  SELECT
    mq.package_id,
    mq.lesson_id,
    mq.competency_id,
    mq.mode AS question_type,
    COUNT(*) FILTER (WHERE mq.status='archived_duplicate' OR mq.is_duplicate IS TRUE) AS duplicates,
    COUNT(*) FILTER (WHERE mq.link_status='link_pending')                              AS link_pending,
    COUNT(*) FILTER (WHERE mq.status='draft' AND mq.link_status='linked')              AS draft_linked,
    COUNT(*) FILTER (WHERE mq.status='approved')                                       AS approved
  FROM public.minicheck_questions mq
  WHERE mq.package_id IS NOT NULL AND mq.lesson_id IS NOT NULL
  GROUP BY mq.package_id, mq.lesson_id, mq.competency_id, mq.mode
)
SELECT
  package_id,
  lesson_id,
  competency_id,
  question_type,
  duplicates,
  link_pending,
  draft_linked,
  approved,
  -- target: stable conservative default — 5 approved per lesson
  5 AS target_count,
  GREATEST(5 - approved, 0) AS replacement_needed,
  CASE
    WHEN link_pending > 0 AND link_pending >= duplicates AND link_pending >= draft_linked THEN 'link_pending'
    WHEN duplicates  > draft_linked THEN 'duplicate'
    WHEN draft_linked > 0           THEN 'draft_unapproved_linked'
    WHEN approved < 5               THEN 'undersupplied'
    ELSE 'ok'
  END AS dominant_reason
FROM agg;

REVOKE ALL ON public.v_minicheck_replacement_demand FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_minicheck_replacement_demand TO service_role;

-- 3) Dedupe loop candidates (raw_pct low, effective_pct high, many archived)
CREATE OR REPLACE VIEW public.v_minicheck_dedupe_loop_candidates AS
SELECT
  package_id,
  package_title,
  package_status,
  raw_total,
  approved,
  archived_duplicates,
  active_unapproved,
  raw_approval_pct,
  effective_approval_pct,
  CASE
    WHEN archived_duplicates >= 200
     AND COALESCE(effective_approval_pct,0) - COALESCE(raw_approval_pct,0) >= 10
    THEN 'dedupe_append_loop_likely'
    WHEN archived_duplicates >= 50
     AND COALESCE(effective_approval_pct,0) - COALESCE(raw_approval_pct,0) >= 5
    THEN 'dedupe_append_loop_suspected'
    ELSE 'no_loop_signal'
  END AS loop_verdict
FROM public.v_minicheck_effective_quality
WHERE package_status = 'published'
  AND archived_duplicates > 0;

REVOKE ALL ON public.v_minicheck_dedupe_loop_candidates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_minicheck_dedupe_loop_candidates TO service_role;

-- 4) Enrich rejection clusters with last repair provider/model (best effort)
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
), last_provider AS (
  SELECT DISTINCT ON (package_id)
    package_id,
    provider                AS last_repair_provider,
    payload->>'model'       AS last_repair_model,
    job_type                AS last_repair_job_type,
    completed_at            AS last_repair_completed_at
  FROM public.job_queue
  WHERE job_type IN ('package_repair_lesson_minichecks','package_generate_lesson_minichecks')
    AND status = 'completed'
  ORDER BY package_id, completed_at DESC NULLS LAST
)
SELECT
  b.package_id,
  b.lesson_id,
  b.competency_id,
  b.mode AS question_type,
  b.rejection_reason,
  b.status,
  b.link_status,
  b.audit_status,
  b.has_distractor_meta,
  b.has_trap_tags,
  b.trap_type,
  b.cognitive_level,
  COUNT(*)            AS cluster_size,
  SUM(b.is_approved)   AS approved_count,
  SUM(b.is_unapproved) AS unapproved_count,
  ROUND( (SUM(b.is_approved)::numeric / NULLIF(COUNT(*),0)) * 100.0, 2) AS approval_pct,
  MAX(lp.last_repair_provider)        AS last_repair_provider,
  MAX(lp.last_repair_model)           AS last_repair_model,
  MAX(lp.last_repair_job_type)        AS last_repair_job_type,
  MAX(lp.last_repair_completed_at)    AS last_repair_completed_at
FROM base b
LEFT JOIN last_provider lp ON lp.package_id = b.package_id
GROUP BY b.package_id, b.lesson_id, b.competency_id, b.mode, b.rejection_reason, b.status,
         b.link_status, b.audit_status, b.has_distractor_meta, b.has_trap_tags,
         b.trap_type, b.cognitive_level;

REVOKE ALL ON public.v_minicheck_rejection_clusters FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_minicheck_rejection_clusters TO service_role;

-- 5) Diagnose-only RPC for repair v2 plan
CREATE OR REPLACE FUNCTION public.admin_get_minicheck_repair_v2_plan(
  p_package_ids uuid[],
  p_target_per_lesson int DEFAULT 5
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_quality jsonb;
  v_demand_summary jsonb;
  v_top_lessons jsonb;
  v_dedupe_loop jsonb;
  v_priority jsonb;
BEGIN
  IF NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF p_package_ids IS NULL OR array_length(p_package_ids,1) IS NULL THEN
    RAISE EXCEPTION 'p_package_ids must not be empty';
  END IF;

  SELECT jsonb_agg(row_to_json(q)) INTO v_quality
  FROM (SELECT * FROM public.v_minicheck_effective_quality WHERE package_id = ANY(p_package_ids)) q;

  -- Replacement demand summary per package + dominant_reason
  SELECT jsonb_agg(row_to_json(s)) INTO v_demand_summary
  FROM (
    SELECT
      package_id,
      dominant_reason,
      COUNT(*)                       AS lesson_buckets,
      SUM(replacement_needed)        AS total_replacement_needed,
      SUM(duplicates)                AS duplicates,
      SUM(link_pending)              AS link_pending,
      SUM(draft_linked)              AS draft_linked
    FROM public.v_minicheck_replacement_demand
    WHERE package_id = ANY(p_package_ids)
    GROUP BY package_id, dominant_reason
    ORDER BY total_replacement_needed DESC NULLS LAST
  ) s;

  SELECT jsonb_agg(row_to_json(t)) INTO v_top_lessons
  FROM (
    SELECT
      package_id, lesson_id, competency_id, question_type,
      duplicates, link_pending, draft_linked, approved,
      target_count, replacement_needed, dominant_reason
    FROM public.v_minicheck_replacement_demand
    WHERE package_id = ANY(p_package_ids)
      AND replacement_needed > 0
    ORDER BY replacement_needed DESC
    LIMIT 50
  ) t;

  SELECT jsonb_agg(row_to_json(d)) INTO v_dedupe_loop
  FROM (SELECT * FROM public.v_minicheck_dedupe_loop_candidates WHERE package_id = ANY(p_package_ids)) d;

  -- Priority order: link_pending first, then duplicate, then draft_unapproved_linked
  SELECT jsonb_agg(jsonb_build_object(
    'priority',  rn,
    'package_id', package_id,
    'dominant_reason', dominant_reason,
    'replacement_needed', total_needed,
    'recommended_action',
      CASE dominant_reason
        WHEN 'link_pending'             THEN 'run_linker_pass_first'
        WHEN 'duplicate'                THEN 'dedupe_replace_not_append'
        WHEN 'draft_unapproved_linked'  THEN 'reason_aware_regen_with_council_feedback'
        WHEN 'undersupplied'            THEN 'top_up_generation_with_blueprint_context'
        ELSE 'manual_review'
      END
  )) INTO v_priority
  FROM (
    SELECT
      package_id, dominant_reason,
      SUM(replacement_needed) AS total_needed,
      ROW_NUMBER() OVER (
        ORDER BY
          CASE dominant_reason
            WHEN 'link_pending' THEN 1
            WHEN 'duplicate' THEN 2
            WHEN 'draft_unapproved_linked' THEN 3
            WHEN 'undersupplied' THEN 4
            ELSE 9
          END,
          SUM(replacement_needed) DESC
      ) AS rn
    FROM public.v_minicheck_replacement_demand
    WHERE package_id = ANY(p_package_ids) AND replacement_needed > 0
    GROUP BY package_id, dominant_reason
  ) p;

  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'minicheck_repair_v2_plan_run','system',NULL,'ok',
    jsonb_build_object(
      'actor_uid', v_uid,
      'package_count', array_length(p_package_ids,1),
      'target_per_lesson', p_target_per_lesson,
      'no_repair', true, 'no_new_jobs', true
    )
  );

  RETURN jsonb_build_object(
    'generated_at', now(),
    'package_ids', to_jsonb(p_package_ids),
    'effective_quality',   COALESCE(v_quality,        '[]'::jsonb),
    'demand_summary',      COALESCE(v_demand_summary, '[]'::jsonb),
    'top_lessons',         COALESCE(v_top_lessons,    '[]'::jsonb),
    'dedupe_loop_candidates', COALESCE(v_dedupe_loop, '[]'::jsonb),
    'priority',            COALESCE(v_priority,       '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_minicheck_repair_v2_plan(uuid[],int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_minicheck_repair_v2_plan(uuid[],int) TO authenticated;

-- 6) Targeted re-enqueue (admin-controlled, with WIP-cap, dedupe-replace flags)
CREATE OR REPLACE FUNCTION public.admin_enqueue_minicheck_repair_targeted(
  p_package_ids   uuid[],
  p_target_per_lesson int DEFAULT 5,
  p_max_per_package int DEFAULT 1
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_pkg uuid;
  v_active int;
  v_demand int;
  v_inserted int := 0;
  v_skipped  int := 0;
  v_results jsonb := '[]'::jsonb;
  v_job_id uuid;
  v_payload jsonb;
  v_meta jsonb;
BEGIN
  IF NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF p_package_ids IS NULL OR array_length(p_package_ids,1) IS NULL THEN
    RAISE EXCEPTION 'p_package_ids must not be empty';
  END IF;

  FOREACH v_pkg IN ARRAY p_package_ids LOOP
    SELECT COUNT(*) INTO v_active
    FROM public.job_queue
    WHERE package_id = v_pkg
      AND job_type = 'package_repair_lesson_minichecks'
      AND status IN ('pending','queued','processing');

    SELECT COALESCE(SUM(replacement_needed),0) INTO v_demand
    FROM public.v_minicheck_replacement_demand
    WHERE package_id = v_pkg;

    IF v_demand <= 0 THEN
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'package_id', v_pkg, 'status','skipped', 'reason','no_replacement_demand'
      ));
      INSERT INTO public.auto_heal_log(action_type,target_type,target_id,result_status,metadata)
      VALUES('admin_enqueue_minicheck_repair_targeted','package',v_pkg::text,'skipped',
        jsonb_build_object('actor_uid',v_uid,'reason','no_replacement_demand'));
      CONTINUE;
    END IF;

    IF v_active >= p_max_per_package THEN
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'package_id', v_pkg, 'status','skipped',
        'reason','active_repair_jobs_present', 'active_jobs', v_active
      ));
      INSERT INTO public.auto_heal_log(action_type,target_type,target_id,result_status,metadata)
      VALUES('admin_enqueue_minicheck_repair_targeted','package',v_pkg::text,'skipped',
        jsonb_build_object('actor_uid',v_uid,'reason','active_repair_jobs_present','active_jobs',v_active));
      CONTINUE;
    END IF;

    v_payload := jsonb_build_object(
      'package_id', v_pkg,
      'mode', 'dedupe_replace',
      'target_per_lesson', p_target_per_lesson,
      'is_repair', true,
      'dedupe_replace_mode', true,
      'enqueue_source', 'admin_minicheck_repair_targeted'
    );
    v_meta := jsonb_build_object(
      'is_repair', true,
      'exempt_from_auto_cancel', true,
      'can_run_when_not_building', true,
      'wave', 'minicheck_repair_v2_targeted',
      'actor_uid', v_uid
    );

    INSERT INTO public.job_queue(
      job_type, status, payload, meta, package_id, worker_pool, lane,
      run_after, attempts, max_attempts, priority
    ) VALUES (
      'package_repair_lesson_minichecks', 'pending', v_payload, v_meta, v_pkg,
      'content', 'content', now(), 0, 3, 50
    ) RETURNING id INTO v_job_id;

    v_inserted := v_inserted + 1;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'package_id', v_pkg, 'status','enqueued', 'job_id', v_job_id,
      'replacement_demand', v_demand
    ));
    INSERT INTO public.auto_heal_log(action_type,target_type,target_id,result_status,metadata)
    VALUES('admin_enqueue_minicheck_repair_targeted','package',v_pkg::text,'enqueued',
      jsonb_build_object('actor_uid',v_uid,'job_id',v_job_id,
                         'replacement_demand',v_demand,
                         'target_per_lesson',p_target_per_lesson));
  END LOOP;

  INSERT INTO public.auto_heal_log(action_type,target_type,target_id,result_status,metadata)
  VALUES('admin_enqueue_minicheck_repair_targeted_run','system',NULL,
    CASE WHEN v_inserted>0 THEN 'applied' ELSE 'noop' END,
    jsonb_build_object('actor_uid',v_uid,'inserted',v_inserted,'skipped',v_skipped,
                       'package_count',array_length(p_package_ids,1)));

  RETURN jsonb_build_object(
    'inserted', v_inserted, 'skipped', v_skipped,
    'results', v_results, 'generated_at', now()
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_enqueue_minicheck_repair_targeted(uuid[],int,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_enqueue_minicheck_repair_targeted(uuid[],int,int) TO authenticated;