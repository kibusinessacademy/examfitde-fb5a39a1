
-- ============================================================================
-- Phase D: Lessons-Gap Policy + SSOT + Dispatcher (v1) — retry
-- ============================================================================

ALTER TABLE public.course_packages
  ADD COLUMN IF NOT EXISTS lesson_policy text
    DEFAULT 'required'
    CHECK (lesson_policy IN ('required','optional','exempt'));

COMMENT ON COLUMN public.course_packages.lesson_policy IS
'Track-aware lessons requirement. required=must have ready lessons; optional=lessons enhance but not gating; exempt=track-design excludes lessons (exam-pool + tutor + handbook delivery).';

INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('lessons_gap_policy_backfilled', '{}', 'lessons_gap'),
  ('lessons_gap_repair_dispatched', '{}', 'lessons_gap'),
  ('lessons_gap_repair_skipped',    '{}', 'lessons_gap'),
  ('lessons_gap_exemption_applied', '{}', 'lessons_gap')
ON CONFLICT (action_type) DO NOTHING;

DO $$
DECLARE
  v_exempt_count int := 0;
  v_required_count int := 0;
BEGIN
  WITH pub AS (
    SELECT cp.id AS package_id, cp.track, cp.curriculum_id
    FROM public.course_packages cp WHERE cp.status='published'
  ),
  mod_counts AS (
    SELECT c.curriculum_id, COUNT(DISTINCT m.id) AS module_count
    FROM public.courses c LEFT JOIN public.modules m ON m.course_id=c.id
    GROUP BY c.curriculum_id
  ),
  classify AS (
    SELECT pub.package_id,
           CASE
             WHEN pub.track='EXAM_FIRST' AND COALESCE(mc.module_count,0)=0 THEN 'exempt'
             ELSE 'required'
           END AS policy
    FROM pub LEFT JOIN mod_counts mc ON mc.curriculum_id=pub.curriculum_id
  ),
  upd AS (
    UPDATE public.course_packages cp
       SET lesson_policy = c.policy
      FROM classify c
     WHERE cp.id = c.package_id
       AND cp.lesson_policy IS DISTINCT FROM c.policy
    RETURNING cp.id, c.policy
  )
  SELECT
    COUNT(*) FILTER (WHERE policy='exempt'),
    COUNT(*) FILTER (WHERE policy='required')
    INTO v_exempt_count, v_required_count
  FROM upd;

  PERFORM public.fn_emit_audit(
    'lessons_gap_policy_backfilled',
    NULL, 'system', NULL,
    jsonb_build_object(
      'exempt_count', v_exempt_count,
      'required_count_updated', v_required_count,
      'criterion', 'EXAM_FIRST + zero modules => exempt; else required',
      'backfilled_at', now()
    ),
    'success'
  );
END $$;

CREATE OR REPLACE VIEW public.v_lessons_gap_ssot AS
WITH pub AS (
  SELECT cp.id AS package_id, cp.package_key, cp.title, cp.curriculum_id,
         cp.track, cp.lesson_policy
  FROM public.course_packages cp
  WHERE cp.status='published'
),
mod_counts AS (
  SELECT c.curriculum_id, COUNT(DISTINCT m.id) AS module_count
  FROM public.courses c LEFT JOIN public.modules m ON m.course_id=c.id
  GROUP BY c.curriculum_id
),
les_counts AS (
  SELECT c.curriculum_id,
         COUNT(l.*) AS lesson_count,
         COUNT(*) FILTER (WHERE l.status IN ('ready','published','approved','active')) AS lesson_ready_count,
         COUNT(*) FILTER (WHERE l.status = 'draft') AS lesson_draft_count
  FROM public.courses c
  LEFT JOIN public.modules m ON m.course_id=c.id
  LEFT JOIN public.lessons l ON l.module_id=m.id
  GROUP BY c.curriculum_id
),
active_jobs AS (
  SELECT package_id, COUNT(*) AS active_repair_jobs
  FROM public.job_queue
  WHERE job_type IN (
        'post_publish_content_repair_lessons',
        'package_scaffold_learning_course',
        'lesson_generate_content',
        'lesson_generate_competency_bundle',
        'package_repair_failed_lessons'
      )
    AND status IN ('pending','processing','queued','running','retry')
  GROUP BY package_id
)
SELECT
  pub.package_id, pub.package_key, pub.title, pub.curriculum_id,
  pub.track, pub.lesson_policy,
  COALESCE(mc.module_count, 0)             AS module_count,
  COALESCE(lc.lesson_count, 0)             AS lesson_count,
  COALESCE(lc.lesson_ready_count, 0)       AS lesson_ready_count,
  COALESCE(lc.lesson_draft_count, 0)       AS lesson_draft_count,
  COALESCE(aj.active_repair_jobs, 0)       AS active_repair_jobs,
  CASE
    WHEN pub.lesson_policy = 'exempt' THEN 'EXEMPT'
    WHEN COALESCE(mc.module_count, 0) = 0 THEN 'NO_MODULES'
    WHEN COALESCE(lc.lesson_count, 0) = 0 THEN 'MODULES_NO_LESSONS'
    WHEN COALESCE(lc.lesson_ready_count, 0) = 0 THEN 'LESSONS_NOT_READY'
    ELSE 'HAS_READY'
  END AS classification,
  CASE
    WHEN pub.lesson_policy = 'exempt' THEN 'none'
    WHEN COALESCE(lc.lesson_ready_count, 0) > 0 THEN 'none'
    WHEN COALESCE(lc.lesson_draft_count, 0) > 0 AND COALESCE(aj.active_repair_jobs,0)=0
      THEN 'dispatch:post_publish_content_repair_lessons'
    WHEN COALESCE(mc.module_count, 0) = 0 AND COALESCE(aj.active_repair_jobs,0)=0
      THEN 'dispatch:package_scaffold_learning_course'
    WHEN COALESCE(aj.active_repair_jobs,0) > 0 THEN 'in_progress'
    ELSE 'manual_review'
  END AS recommended_action,
  pub.lesson_policy = 'exempt' OR COALESCE(lc.lesson_ready_count, 0) > 0 AS customer_safe_for_lessons
FROM pub
LEFT JOIN mod_counts mc ON mc.curriculum_id = pub.curriculum_id
LEFT JOIN les_counts lc ON lc.curriculum_id = pub.curriculum_id
LEFT JOIN active_jobs aj ON aj.package_id = pub.package_id;

REVOKE ALL ON public.v_lessons_gap_ssot FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.v_lessons_gap_ssot TO service_role;

COMMENT ON VIEW public.v_lessons_gap_ssot IS
'SSOT v1: per-published-package lesson gap classification with track-aware policy.';

CREATE OR REPLACE FUNCTION public.admin_get_lessons_gap_summary()
RETURNS TABLE(
  track text,
  classification text,
  n bigint,
  customer_safe_for_lessons_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    v.track,
    v.classification,
    COUNT(*) AS n,
    COUNT(*) FILTER (WHERE v.customer_safe_for_lessons) AS customer_safe_for_lessons_count
  FROM public.v_lessons_gap_ssot v
  WHERE public.has_role(auth.uid(), 'admin')
  GROUP BY v.track, v.classification
  ORDER BY v.track, v.classification;
$$;

REVOKE ALL ON FUNCTION public.admin_get_lessons_gap_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_lessons_gap_summary() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_dispatch_lessons_gap_repair(
  _wave_size int DEFAULT 10,
  _wip_cap int DEFAULT 20,
  _force_no_modules boolean DEFAULT false,
  _dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_wip int;
  v_capacity int;
  v_eligible_count int;
  v_dispatched int := 0;
  v_skipped int := 0;
  v_results jsonb := '[]'::jsonb;
  r record;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT COUNT(*) INTO v_current_wip
  FROM public.job_queue
  WHERE job_type IN (
        'post_publish_content_repair_lessons',
        'package_scaffold_learning_course'
      )
    AND status IN ('pending','processing','queued','running','retry');

  v_capacity := GREATEST(0, LEAST(_wave_size, _wip_cap - v_current_wip));

  SELECT COUNT(*) INTO v_eligible_count
  FROM public.v_lessons_gap_ssot v
  WHERE v.active_repair_jobs = 0
    AND (
      v.classification = 'LESSONS_NOT_READY'
      OR (v.classification = 'NO_MODULES' AND _force_no_modules)
    );

  IF _dry_run THEN
    RETURN jsonb_build_object(
      'dry_run', true,
      'current_wip', v_current_wip,
      'wip_cap', _wip_cap,
      'capacity', v_capacity,
      'eligible_count', v_eligible_count,
      'would_dispatch', LEAST(v_capacity, v_eligible_count)
    );
  END IF;

  FOR r IN
    SELECT v.package_id, v.package_key, v.classification, v.lesson_draft_count
    FROM public.v_lessons_gap_ssot v
    WHERE v.active_repair_jobs = 0
      AND (
        v.classification = 'LESSONS_NOT_READY'
        OR (v.classification = 'NO_MODULES' AND _force_no_modules)
      )
    ORDER BY
      CASE v.classification WHEN 'LESSONS_NOT_READY' THEN 0 ELSE 1 END,
      v.lesson_draft_count DESC NULLS LAST
    LIMIT v_capacity
  LOOP
    BEGIN
      INSERT INTO public.job_queue (
        job_type, package_id, payload, status, priority,
        job_name, correlation_id
      )
      VALUES (
        CASE r.classification
          WHEN 'LESSONS_NOT_READY' THEN 'post_publish_content_repair_lessons'
          ELSE 'package_scaffold_learning_course'
        END,
        r.package_id,
        jsonb_build_object(
          'enqueue_source', 'lessons_gap_dispatcher_v1',
          'classification', r.classification,
          'wave_dispatched_at', now()
        ),
        'pending',
        5,
        'lessons_gap_repair|' || r.package_key,
        'lessons_gap|' || r.package_id::text || '|' || to_char(now(),'YYYYMMDDHH24MISS')
      );
      v_dispatched := v_dispatched + 1;
      v_results := v_results || jsonb_build_object(
        'package_id', r.package_id,
        'package_key', r.package_key,
        'classification', r.classification,
        'status', 'dispatched'
      );

      PERFORM public.fn_emit_audit(
        'lessons_gap_repair_dispatched',
        r.package_id, 'package', r.package_key,
        jsonb_build_object(
          'classification', r.classification,
          'lesson_draft_count', r.lesson_draft_count
        ),
        'success'
      );
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_object(
        'package_id', r.package_id,
        'package_key', r.package_key,
        'status', 'skipped',
        'error', SQLERRM
      );
      PERFORM public.fn_emit_audit(
        'lessons_gap_repair_skipped',
        r.package_id, 'package', r.package_key,
        jsonb_build_object('error', SQLERRM, 'classification', r.classification),
        'failed'
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'dry_run', false,
    'current_wip', v_current_wip,
    'wip_cap', _wip_cap,
    'capacity', v_capacity,
    'eligible_count', v_eligible_count,
    'dispatched', v_dispatched,
    'skipped', v_skipped,
    'results', v_results
  );
END $$;

REVOKE ALL ON FUNCTION public.admin_dispatch_lessons_gap_repair(int,int,boolean,boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_dispatch_lessons_gap_repair(int,int,boolean,boolean)
  TO authenticated, service_role;

-- Audit: mark all backfilled exempt packages
DO $$
DECLARE v_n int;
BEGIN
  WITH ex AS (
    SELECT id, package_key FROM public.course_packages
    WHERE status='published' AND lesson_policy='exempt'
  )
  SELECT COUNT(*) INTO v_n FROM ex;

  PERFORM public.fn_emit_audit(
    'lessons_gap_exemption_applied',
    NULL, 'system', NULL,
    jsonb_build_object(
      'exempt_count', v_n,
      'criterion', 'EXAM_FIRST + zero modules',
      'applied_at', now()
    ),
    'success'
  );
END $$;
