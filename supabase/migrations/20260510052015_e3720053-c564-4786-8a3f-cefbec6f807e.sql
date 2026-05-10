-- ============================================================================
-- Wave 6: Hollow-Published EXAM_FIRST Repair
-- ============================================================================

-- 1. SSOT View (admin-only)
CREATE OR REPLACE VIEW public.v_hollow_published_exam_first AS
WITH base AS (
  SELECT
    cp.id              AS package_id,
    cp.title           AS package_title,
    cp.package_key,
    cp.curriculum_id,
    cp.track::text     AS track,
    (SELECT COUNT(*) FROM public.handbook_chapters hc
       WHERE hc.curriculum_id = cp.curriculum_id)                                  AS hb_total,
    (SELECT COUNT(*) FROM public.handbook_chapters hc
       WHERE hc.curriculum_id = cp.curriculum_id AND hc.is_published)              AS hb_published,
    (SELECT COUNT(*) FROM public.minicheck_questions mq
       WHERE mq.package_id = cp.id AND mq.status = 'approved')                     AS minich_approved,
    (SELECT COUNT(*) FROM public.exam_questions eq
       WHERE eq.package_id = cp.id AND eq.status = 'approved')                     AS eq_approved,
    EXISTS (
      SELECT 1 FROM public.package_steps ps
       WHERE ps.package_id = cp.id
         AND ps.step_key = 'build_ai_tutor_index'
         AND ps.status = 'done'
    ) AS tutor_idx_done
  FROM public.course_packages cp
  WHERE cp.status = 'published'
    AND cp.track::text = 'EXAM_FIRST'
)
SELECT
  package_id, package_title, package_key, curriculum_id, track,
  hb_total, hb_published, minich_approved, eq_approved, tutor_idx_done,
  (hb_total = 0)        AS needs_handbook,
  (minich_approved = 0) AS needs_minichecks,
  CASE
    WHEN eq_approved = 0          THEN 'SKIP_NO_APPROVED_QUESTIONS'
    WHEN NOT tutor_idx_done       THEN 'SKIP_NO_TUTOR_INDEX'
    WHEN hb_total = 0 AND minich_approved = 0 THEN 'REPAIR_BOTH'
    WHEN hb_total = 0             THEN 'REPAIR_HANDBOOK_ONLY'
    WHEN minich_approved = 0      THEN 'REPAIR_MINICHECKS_ONLY'
    ELSE 'NOT_HOLLOW'
  END AS classification
FROM base
WHERE (hb_total = 0 OR minich_approved = 0);

-- Hard-lock view: admin path only via SECURITY DEFINER RPC
REVOKE ALL ON public.v_hollow_published_exam_first FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.v_hollow_published_exam_first TO service_role;

COMMENT ON VIEW public.v_hollow_published_exam_first IS
  'Wave 6 SSOT: published EXAM_FIRST packages missing Handbook OR approved Minichecks. Admin-only.';

-- 2. Admin summary RPC (read-only, gated)
CREATE OR REPLACE FUNCTION public.admin_get_hollow_published_exam_first(p_limit int DEFAULT 200)
RETURNS SETOF public.v_hollow_published_exam_first
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT * FROM public.v_hollow_published_exam_first
     WHERE classification IN ('REPAIR_BOTH','REPAIR_HANDBOOK_ONLY','REPAIR_MINICHECKS_ONLY')
     ORDER BY package_title
     LIMIT GREATEST(COALESCE(p_limit, 200), 1);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_hollow_published_exam_first(int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_get_hollow_published_exam_first(int) TO authenticated, service_role;

-- 3. Repair RPC (dry-run default, gated, idempotent)
CREATE OR REPLACE FUNCTION public.admin_repair_hollow_exam_first(
  p_dry_run boolean DEFAULT true,
  p_limit   int     DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin       boolean;
  v_run_id         uuid := gen_random_uuid();
  v_repaired       int  := 0;
  v_jobs_enqueued  int  := 0;
  v_skipped        int  := 0;
  v_planned        jsonb := '[]'::jsonb;
  v_skip           jsonb := '[]'::jsonb;
  r                record;
  v_active_handbook boolean;
  v_active_minich   boolean;
  v_per_pkg_jobs    jsonb;
BEGIN
  v_is_admin := public.has_role(auth.uid(), 'admin'::app_role);
  IF NOT v_is_admin AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden: admin or service_role required'
      USING ERRCODE = '42501';
  END IF;

  FOR r IN
    SELECT *
      FROM public.v_hollow_published_exam_first
     WHERE classification IN ('REPAIR_BOTH','REPAIR_HANDBOOK_ONLY','REPAIR_MINICHECKS_ONLY')
     ORDER BY package_title
     LIMIT GREATEST(COALESCE(p_limit, 50), 1)
  LOOP
    -- Dedup: any active job for this package + job_type already?
    SELECT
      EXISTS (
        SELECT 1 FROM public.job_queue jq
         WHERE jq.package_id = r.package_id
           AND jq.job_type = 'package_generate_handbook'
           AND jq.status IN ('pending','processing','queued')
      ),
      EXISTS (
        SELECT 1 FROM public.job_queue jq
         WHERE jq.package_id = r.package_id
           AND jq.job_type = 'package_generate_lesson_minichecks'
           AND jq.status IN ('pending','processing','queued')
      )
    INTO v_active_handbook, v_active_minich;

    v_per_pkg_jobs := '[]'::jsonb;

    -- Handbook
    IF r.needs_handbook THEN
      IF v_active_handbook THEN
        v_skip := v_skip || jsonb_build_object(
          'package_id', r.package_id, 'job_type', 'package_generate_handbook',
          'reason', 'ACTIVE_JOB_EXISTS');
        v_skipped := v_skipped + 1;
      ELSE
        v_per_pkg_jobs := v_per_pkg_jobs || jsonb_build_object(
          'job_type','package_generate_handbook','reason','HANDBOOK_TOTAL_ZERO');
        IF NOT p_dry_run THEN
          INSERT INTO public.job_queue (
            job_type, status, payload, package_id, worker_pool, lane, meta, job_name
          ) VALUES (
            'package_generate_handbook',
            'pending',
            jsonb_build_object(
              'package_id', r.package_id,
              'mode', 'wave6_hollow_exam_first_repair',
              'enqueue_source','wave6_hollow_exam_first_repair',
              '_origin','wave6_hollow_exam_first_repair'
            ),
            r.package_id,
            'content',
            public.derive_job_lane('package_generate_handbook'),
            jsonb_build_object('wave','wave6','run_id', v_run_id),
            'wave6.handbook'
          );
          v_jobs_enqueued := v_jobs_enqueued + 1;
        END IF;
      END IF;
    END IF;

    -- Minichecks
    IF r.needs_minichecks THEN
      IF v_active_minich THEN
        v_skip := v_skip || jsonb_build_object(
          'package_id', r.package_id, 'job_type','package_generate_lesson_minichecks',
          'reason','ACTIVE_JOB_EXISTS');
        v_skipped := v_skipped + 1;
      ELSE
        v_per_pkg_jobs := v_per_pkg_jobs || jsonb_build_object(
          'job_type','package_generate_lesson_minichecks','reason','MINICHECKS_APPROVED_ZERO');
        IF NOT p_dry_run THEN
          INSERT INTO public.job_queue (
            job_type, status, payload, package_id, worker_pool, lane, meta, job_name
          ) VALUES (
            'package_generate_lesson_minichecks',
            'pending',
            jsonb_build_object(
              'package_id', r.package_id,
              'mode','wave6_hollow_exam_first_repair',
              'enqueue_source','wave6_hollow_exam_first_repair',
              '_origin','wave6_hollow_exam_first_repair'
            ),
            r.package_id,
            'content',
            public.derive_job_lane('package_generate_lesson_minichecks'),
            jsonb_build_object('wave','wave6','run_id', v_run_id),
            'wave6.minichecks'
          );
          v_jobs_enqueued := v_jobs_enqueued + 1;
        END IF;
      END IF;
    END IF;

    IF jsonb_array_length(v_per_pkg_jobs) > 0 THEN
      v_repaired := v_repaired + 1;
      v_planned := v_planned || jsonb_build_object(
        'package_id', r.package_id,
        'package_title', r.package_title,
        'classification', r.classification,
        'jobs', v_per_pkg_jobs
      );
    END IF;
  END LOOP;

  -- Audit
  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'wave6_hollow_exam_first_repair',
    'system',
    NULL,
    CASE WHEN p_dry_run THEN 'dry_run' ELSE 'applied' END,
    jsonb_build_object(
      'run_id', v_run_id,
      'dry_run', p_dry_run,
      'limit', p_limit,
      'repaired_packages', v_repaired,
      'jobs_enqueued', v_jobs_enqueued,
      'skipped', v_skipped,
      'planned', v_planned,
      'skip_details', v_skip
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'run_id', v_run_id,
    'dry_run', p_dry_run,
    'repaired_packages', v_repaired,
    'jobs_enqueued', v_jobs_enqueued,
    'skipped', v_skipped,
    'remaining_hollow_after', (
      SELECT COUNT(*) FROM public.v_hollow_published_exam_first
       WHERE classification IN ('REPAIR_BOTH','REPAIR_HANDBOOK_ONLY','REPAIR_MINICHECKS_ONLY')
    ),
    'planned', v_planned,
    'skip_details', v_skip
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_repair_hollow_exam_first(boolean,int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_repair_hollow_exam_first(boolean,int) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_repair_hollow_exam_first(boolean,int) IS
  'Wave 6: enqueue ONLY missing handbook + minicheck generation steps for hollow published EXAM_FIRST packages. No status demote, no force-publish, no bronze-override. Idempotent (dedup on active job_queue rows). Audit in auto_heal_log.';
