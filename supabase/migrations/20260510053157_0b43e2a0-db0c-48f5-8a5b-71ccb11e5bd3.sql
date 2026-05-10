-- ============================================================================
-- Wave 6 v2 — Track-aware hollow detection + QA reference report
-- ============================================================================

-- 1) Drop old generation
DROP FUNCTION IF EXISTS public.admin_repair_hollow_exam_first(boolean,int);
DROP FUNCTION IF EXISTS public.admin_get_hollow_published_exam_first(int);
DROP VIEW     IF EXISTS public.v_hollow_published_exam_first;

-- 2) New SSOT view: only tracks where handbook AND/OR minichecks are SSOT-required
CREATE OR REPLACE VIEW public.v_hollow_published_learning_required AS
WITH base AS (
  SELECT
    cp.id            AS package_id,
    cp.title         AS package_title,
    cp.package_key,
    cp.curriculum_id,
    cp.track::text   AS track,
    -- SSOT applicability lookups
    COALESCE((SELECT tsa.should_run FROM track_step_applicability tsa
               WHERE tsa.track::text = cp.track::text AND tsa.step_key='generate_handbook' LIMIT 1), false) AS hb_required,
    COALESCE((SELECT tsa.should_run FROM track_step_applicability tsa
               WHERE tsa.track::text = cp.track::text AND tsa.step_key='generate_lesson_minichecks' LIMIT 1), false) AS mc_required,
    (SELECT COUNT(*) FROM handbook_chapters hc WHERE hc.curriculum_id = cp.curriculum_id) AS hb_total,
    (SELECT COUNT(*) FROM handbook_chapters hc WHERE hc.curriculum_id = cp.curriculum_id AND hc.is_published) AS hb_published,
    (SELECT COUNT(*) FROM minicheck_questions mq WHERE mq.package_id = cp.id AND mq.status='approved') AS minich_approved,
    (SELECT COUNT(*) FROM exam_questions eq WHERE eq.package_id = cp.id AND eq.status='approved') AS eq_approved,
    EXISTS (SELECT 1 FROM package_steps ps
             WHERE ps.package_id=cp.id AND ps.step_key='build_ai_tutor_index' AND ps.status='done') AS tutor_idx_done
  FROM course_packages cp
  WHERE cp.status='published'
)
SELECT
  package_id, package_title, package_key, curriculum_id, track,
  hb_required, mc_required, hb_total, hb_published, minich_approved, eq_approved, tutor_idx_done,
  (hb_required AND hb_total = 0)        AS needs_handbook,
  (mc_required AND minich_approved = 0) AS needs_minichecks,
  CASE
    WHEN NOT hb_required AND NOT mc_required                 THEN 'TRACK_NOT_APPLICABLE'
    WHEN eq_approved = 0                                     THEN 'SKIP_NO_APPROVED_QUESTIONS'
    WHEN NOT tutor_idx_done                                  THEN 'SKIP_NO_TUTOR_INDEX'
    WHEN (hb_required AND hb_total=0) AND (mc_required AND minich_approved=0) THEN 'REPAIR_BOTH'
    WHEN (hb_required AND hb_total=0)                        THEN 'REPAIR_HANDBOOK_ONLY'
    WHEN (mc_required AND minich_approved=0)                 THEN 'REPAIR_MINICHECKS_ONLY'
    ELSE 'NOT_HOLLOW'
  END AS classification
FROM base;

REVOKE ALL ON public.v_hollow_published_learning_required FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.v_hollow_published_learning_required TO service_role;

COMMENT ON VIEW public.v_hollow_published_learning_required IS
  'Wave 6 v2 SSOT: published packages where handbook OR minichecks are SSOT-required by track but missing. EXAM_FIRST shows as TRACK_NOT_APPLICABLE (diagnostic only).';

-- 3) Admin summary RPC (read-only)
CREATE OR REPLACE FUNCTION public.admin_get_hollow_published_learning_required(p_limit int DEFAULT 200)
RETURNS SETOF public.v_hollow_published_learning_required
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
    SELECT * FROM public.v_hollow_published_learning_required
     WHERE classification IN ('REPAIR_BOTH','REPAIR_HANDBOOK_ONLY','REPAIR_MINICHECKS_ONLY','TRACK_NOT_APPLICABLE')
     ORDER BY (classification='TRACK_NOT_APPLICABLE'), package_title
     LIMIT GREATEST(COALESCE(p_limit,200),1);
END; $$;
REVOKE ALL ON FUNCTION public.admin_get_hollow_published_learning_required(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_hollow_published_learning_required(int) TO authenticated, service_role;

-- 4) Track-aware repair RPC
CREATE OR REPLACE FUNCTION public.admin_repair_hollow_learning_required(
  p_dry_run boolean DEFAULT true,
  p_limit   int     DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_run_id uuid := gen_random_uuid();
  v_repaired int := 0; v_jobs int := 0; v_skipped int := 0;
  v_planned jsonb := '[]'::jsonb; v_skip jsonb := '[]'::jsonb;
  r record; v_active_hb boolean; v_active_mc boolean; v_per jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden: admin or service_role required' USING ERRCODE='42501';
  END IF;

  FOR r IN
    SELECT * FROM public.v_hollow_published_learning_required
     WHERE classification IN ('REPAIR_BOTH','REPAIR_HANDBOOK_ONLY','REPAIR_MINICHECKS_ONLY')
     ORDER BY package_title
     LIMIT GREATEST(COALESCE(p_limit,50),1)
  LOOP
    SELECT
      EXISTS(SELECT 1 FROM job_queue jq WHERE jq.package_id=r.package_id
               AND jq.job_type='package_generate_handbook' AND jq.status IN ('pending','processing','queued')),
      EXISTS(SELECT 1 FROM job_queue jq WHERE jq.package_id=r.package_id
               AND jq.job_type='package_generate_lesson_minichecks' AND jq.status IN ('pending','processing','queued'))
      INTO v_active_hb, v_active_mc;
    v_per := '[]'::jsonb;

    IF r.needs_handbook THEN
      IF v_active_hb THEN
        v_skip := v_skip || jsonb_build_object('package_id',r.package_id,'job_type','package_generate_handbook','reason','ACTIVE_JOB_EXISTS');
        v_skipped := v_skipped+1;
      ELSE
        v_per := v_per || jsonb_build_object('job_type','package_generate_handbook');
        IF NOT p_dry_run THEN
          INSERT INTO job_queue(job_type,status,payload,package_id,worker_pool,lane,meta,job_name)
          VALUES('package_generate_handbook','pending',
            jsonb_build_object('package_id',r.package_id,'curriculum_id',r.curriculum_id,
              'mode','wave6v2_learning_required_repair','enqueue_source','wave6v2_learning_required_repair','_origin','wave6v2_learning_required_repair'),
            r.package_id,'content',public.derive_job_lane('package_generate_handbook'),
            jsonb_build_object('wave','wave6v2','run_id',v_run_id),'wave6v2.handbook');
          v_jobs := v_jobs+1;
        END IF;
      END IF;
    END IF;

    IF r.needs_minichecks THEN
      IF v_active_mc THEN
        v_skip := v_skip || jsonb_build_object('package_id',r.package_id,'job_type','package_generate_lesson_minichecks','reason','ACTIVE_JOB_EXISTS');
        v_skipped := v_skipped+1;
      ELSE
        v_per := v_per || jsonb_build_object('job_type','package_generate_lesson_minichecks');
        IF NOT p_dry_run THEN
          INSERT INTO job_queue(job_type,status,payload,package_id,worker_pool,lane,meta,job_name)
          VALUES('package_generate_lesson_minichecks','pending',
            jsonb_build_object('package_id',r.package_id,'curriculum_id',r.curriculum_id,
              'mode','wave6v2_learning_required_repair','enqueue_source','wave6v2_learning_required_repair','_origin','wave6v2_learning_required_repair'),
            r.package_id,'content',public.derive_job_lane('package_generate_lesson_minichecks'),
            jsonb_build_object('wave','wave6v2','run_id',v_run_id),'wave6v2.minichecks');
          v_jobs := v_jobs+1;
        END IF;
      END IF;
    END IF;

    IF jsonb_array_length(v_per) > 0 THEN
      v_repaired := v_repaired+1;
      v_planned := v_planned || jsonb_build_object('package_id',r.package_id,'package_title',r.package_title,'track',r.track,'classification',r.classification,'jobs',v_per);
    END IF;
  END LOOP;

  INSERT INTO auto_heal_log(action_type,target_type,target_id,result_status,metadata)
  VALUES('wave6v2_hollow_learning_required_repair','system',NULL,
    CASE WHEN p_dry_run THEN 'dry_run' ELSE 'applied' END,
    jsonb_build_object('run_id',v_run_id,'dry_run',p_dry_run,'limit',p_limit,
      'repaired_packages',v_repaired,'jobs_enqueued',v_jobs,'skipped',v_skipped,
      'planned',v_planned,'skip_details',v_skip));

  RETURN jsonb_build_object('ok',true,'run_id',v_run_id,'dry_run',p_dry_run,
    'repaired_packages',v_repaired,'jobs_enqueued',v_jobs,'skipped',v_skipped,
    'remaining_hollow_after',(SELECT COUNT(*) FROM v_hollow_published_learning_required
      WHERE classification IN ('REPAIR_BOTH','REPAIR_HANDBOOK_ONLY','REPAIR_MINICHECKS_ONLY')),
    'planned',v_planned,'skip_details',v_skip);
END; $$;
REVOKE ALL ON FUNCTION public.admin_repair_hollow_learning_required(boolean,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_repair_hollow_learning_required(boolean,int) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_repair_hollow_learning_required(boolean,int) IS
  'Wave 6 v2: enqueue ONLY missing handbook/minicheck steps for tracks where SSOT requires them. EXAM_FIRST is excluded (diagnostic only). Idempotent. Audit in auto_heal_log.';

-- 5) QA reference product report (admin-only)
CREATE OR REPLACE VIEW public.v_qa_reference_product_metrics AS
SELECT
  cp.id              AS package_id,
  cp.package_key,
  cp.title           AS package_title,
  cp.track::text     AS track,
  cp.status,
  cp.curriculum_id,
  -- Lessons
  (SELECT COUNT(*) FROM modules m JOIN lessons l ON l.module_id=m.id
     JOIN courses co ON co.id=m.course_id WHERE co.curriculum_id=cp.curriculum_id) AS lessons_total,
  -- Handbook
  (SELECT COUNT(*) FROM handbook_chapters hc WHERE hc.curriculum_id=cp.curriculum_id) AS handbook_chapters_total,
  (SELECT COUNT(*) FROM handbook_chapters hc WHERE hc.curriculum_id=cp.curriculum_id AND hc.is_published) AS handbook_chapters_published,
  -- Exam questions
  (SELECT COUNT(*) FROM exam_questions eq WHERE eq.package_id=cp.id) AS exam_questions_total,
  (SELECT COUNT(*) FROM exam_questions eq WHERE eq.package_id=cp.id AND eq.status='approved') AS exam_questions_approved,
  -- AI tutor index
  EXISTS(SELECT 1 FROM package_steps ps WHERE ps.package_id=cp.id AND ps.step_key='build_ai_tutor_index' AND ps.status='done') AS tutor_index_done,
  -- Minichecks
  (SELECT COUNT(*) FROM minicheck_questions mq WHERE mq.package_id=cp.id) AS minichecks_total,
  (SELECT COUNT(*) FROM minicheck_questions mq WHERE mq.package_id=cp.id AND mq.status='approved') AS minichecks_approved,
  -- SSOT gates
  COALESCE((SELECT should_run FROM track_step_applicability WHERE track::text=cp.track::text AND step_key='generate_handbook' LIMIT 1), false) AS hb_required_by_track,
  COALESCE((SELECT should_run FROM track_step_applicability WHERE track::text=cp.track::text AND step_key='generate_lesson_minichecks' LIMIT 1), false) AS mc_required_by_track
FROM course_packages cp
WHERE cp.status='published';

REVOKE ALL ON public.v_qa_reference_product_metrics FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_qa_reference_product_metrics TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_qa_reference_product_metrics(
  p_track text DEFAULT NULL,
  p_limit int  DEFAULT 200
) RETURNS SETOF public.v_qa_reference_product_metrics
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
    SELECT * FROM public.v_qa_reference_product_metrics
     WHERE (p_track IS NULL OR track = p_track)
     ORDER BY package_title
     LIMIT GREATEST(COALESCE(p_limit,200),1);
END; $$;
REVOKE ALL ON FUNCTION public.admin_get_qa_reference_product_metrics(text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_qa_reference_product_metrics(text,int) TO authenticated, service_role;

-- 6) Audit: 100 cancelled wave6 jobs as expected_guard_cancelled
INSERT INTO auto_heal_log(action_type,target_type,target_id,result_status,metadata)
SELECT 'wave6_expected_guard_cancelled','system',NULL,'audited',
  jsonb_build_object(
    'reason','EXAM_FIRST is SSOT-non-applicable for handbook + minichecks; cancellation is correct policy enforcement',
    'cancelled_jobs', (SELECT COUNT(*) FROM job_queue WHERE meta->>'wave'='wave6' AND status='cancelled'),
    'no_requeue', true,
    'replaced_by','admin_repair_hollow_learning_required',
    'tracks_in_scope_handbook', ARRAY['AUSBILDUNG_VOLL','EXAM_FIRST_PLUS','STUDIUM'],
    'tracks_in_scope_minichecks', ARRAY['AUSBILDUNG_VOLL','STUDIUM']
  );
