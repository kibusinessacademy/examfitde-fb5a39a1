
-- =========================================================
-- 1) legacy_exempt columns on course_packages
-- =========================================================
ALTER TABLE public.course_packages
  ADD COLUMN IF NOT EXISTS legacy_exempt_from_hollow_guard boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS legacy_exempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS legacy_exempt_reason text;

-- =========================================================
-- 2) SSOT artifact view per package
-- =========================================================
CREATE OR REPLACE VIEW public.v_package_hollow_guard_ssot AS
WITH pkg AS (
  SELECT
    cp.id AS package_id,
    cp.title,
    cp.status,
    cp.track,
    cp.curriculum_id,
    cp.legacy_exempt_from_hollow_guard,
    cp.integrity_report,
    cp.blocked_reason
  FROM public.course_packages cp
),
lesson_stats AS (
  SELECT
    cp.id AS package_id,
    COUNT(l.id) AS lessons_total,
    COUNT(l.id) FILTER (
      WHERE l.content IS NOT NULL
        AND l.content::text <> '{}'
        AND COALESCE(l.content->>'_placeholder', 'false') <> 'true'
    ) AS lessons_real,
    COUNT(l.id) FILTER (
      WHERE l.content IS NOT NULL
        AND COALESCE(l.content->>'_placeholder', 'false') = 'true'
    ) AS lessons_placeholder,
    COUNT(DISTINCT cv.id) FILTER (
      WHERE cv.status = 'approved'
    ) AS cv_approved,
    COUNT(l.id) FILTER (
      WHERE COALESCE(l.qc_status, '') = 'approved'
    ) AS lessons_qc_approved
  FROM public.course_packages cp
  LEFT JOIN public.learning_fields lf
    ON lf.curriculum_id = cp.curriculum_id
  LEFT JOIN public.competencies c
    ON c.learning_field_id = lf.id
  LEFT JOIN public.lessons l
    ON l.competency_id = c.id
  LEFT JOIN public.content_versions cv
    ON cv.lesson_id = l.id
   AND cv.status != 'rejected'
  GROUP BY cp.id
),
exam_stats AS (
  SELECT
    cp.id AS package_id,
    COUNT(*) FILTER (WHERE eq.qc_status = 'approved') AS approved_questions,
    COUNT(*) AS total_questions,
    COUNT(DISTINCT eb.id) AS total_blueprints
  FROM public.course_packages cp
  LEFT JOIN public.exam_questions eq
    ON eq.curriculum_id = cp.curriculum_id
  LEFT JOIN public.exam_blueprints eb
    ON eb.curriculum_id = cp.curriculum_id
  GROUP BY cp.id
),
handbook_stats AS (
  SELECT
    cp.id AS package_id,
    COUNT(hs.id) AS handbook_sections
  FROM public.course_packages cp
  LEFT JOIN public.handbook_chapters hc
    ON hc.curriculum_id = cp.curriculum_id
  LEFT JOIN public.handbook_sections hs
    ON hs.chapter_id = hc.id
  GROUP BY cp.id
),
oral_stats AS (
  SELECT
    cp.id AS package_id,
    COUNT(oeb.id) AS oral_blueprints
  FROM public.course_packages cp
  LEFT JOIN public.oral_exam_blueprints oeb
    ON oeb.curriculum_id = cp.curriculum_id
  GROUP BY cp.id
),
minicheck_stats AS (
  SELECT
    cp.id AS package_id,
    COUNT(mq.id) AS minichecks
  FROM public.course_packages cp
  LEFT JOIN public.learning_fields lf
    ON lf.curriculum_id = cp.curriculum_id
  LEFT JOIN public.competencies c
    ON c.learning_field_id = lf.id
  LEFT JOIN public.minicheck_questions mq
    ON mq.competency_id = c.id
  GROUP BY cp.id
),
tutor_stats AS (
  SELECT
    cp.id AS package_id,
    COUNT(ti.id) AS tutor_index_rows
  FROM public.course_packages cp
  LEFT JOIN public.ai_tutor_context_index ti
    ON ti.package_id = cp.id
  GROUP BY cp.id
)
SELECT
  p.package_id,
  p.title,
  p.status,
  p.track,
  p.curriculum_id,
  p.legacy_exempt_from_hollow_guard,
  p.integrity_report,
  p.blocked_reason,

  COALESCE(ls.lessons_total, 0) AS lessons_total,
  COALESCE(ls.lessons_real, 0) AS lessons_real,
  COALESCE(ls.lessons_placeholder, 0) AS lessons_placeholder,
  COALESCE(ls.cv_approved, 0) AS cv_approved,
  COALESCE(ls.lessons_qc_approved, 0) AS lessons_qc_approved,

  COALESCE(es.approved_questions, 0) AS approved_questions,
  COALESCE(es.total_questions, 0) AS total_questions,
  COALESCE(es.total_blueprints, 0) AS total_blueprints,

  COALESCE(hs.handbook_sections, 0) AS handbook_sections,
  COALESCE(os.oral_blueprints, 0) AS oral_blueprints,
  COALESCE(ms.minichecks, 0) AS minichecks,
  COALESCE(ts.tutor_index_rows, 0) AS tutor_index_rows,

  (
    COALESCE(es.approved_questions, 0) > 0
    OR COALESCE(hs.handbook_sections, 0) > 0
    OR COALESCE(os.oral_blueprints, 0) > 0
    OR COALESCE(ms.minichecks, 0) > 0
    OR COALESCE(ts.tutor_index_rows, 0) > 0
    OR COALESCE(ls.lessons_real, 0) > 0
  ) AS has_substantive_artifacts,

  CASE
    WHEN p.track IN ('EXAM_FIRST', 'EXAM_FIRST_PLUS') THEN false
    ELSE true
  END AS lessons_expected

FROM pkg p
LEFT JOIN lesson_stats ls ON ls.package_id = p.package_id
LEFT JOIN exam_stats es ON es.package_id = p.package_id
LEFT JOIN handbook_stats hs ON hs.package_id = p.package_id
LEFT JOIN oral_stats os ON os.package_id = p.package_id
LEFT JOIN minicheck_stats ms ON ms.package_id = p.package_id
LEFT JOIN tutor_stats ts ON ts.package_id = p.package_id;

-- =========================================================
-- 3) SSOT hollow decision function
-- =========================================================
CREATE OR REPLACE FUNCTION public.fn_should_hollow_quarantine_package(p_package_id uuid)
RETURNS TABLE (
  should_quarantine boolean,
  reason_code text,
  reason_detail jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v v_package_hollow_guard_ssot%ROWTYPE;
  v_all_lessons_placeholder boolean;
  v_no_real_lessons boolean;
  v_no_exam_pool boolean;
  v_no_substantive_artifacts boolean;
BEGIN
  SELECT *
  INTO v
  FROM v_package_hollow_guard_ssot
  WHERE package_id = p_package_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'PACKAGE_NOT_FOUND'::text, jsonb_build_object('package_id', p_package_id);
    RETURN;
  END IF;

  IF v.legacy_exempt_from_hollow_guard IS TRUE THEN
    RETURN QUERY SELECT false, 'LEGACY_EXEMPT'::text, jsonb_build_object('package_id', p_package_id);
    RETURN;
  END IF;

  IF v.status <> 'published' THEN
    RETURN QUERY SELECT false, 'NOT_PUBLISHED'::text, jsonb_build_object('status', v.status);
    RETURN;
  END IF;

  v_all_lessons_placeholder :=
    v.lessons_total > 0 AND v.lessons_placeholder = v.lessons_total;

  v_no_real_lessons :=
    v.lessons_expected
    AND v.lessons_total > 0
    AND v.lessons_real = 0;

  v_no_exam_pool :=
    v.approved_questions < 10
    AND v.total_blueprints < 10;

  v_no_substantive_artifacts :=
    NOT v.has_substantive_artifacts;

  -- Case 1: 100% placeholder lessons
  IF v_all_lessons_placeholder THEN
    RETURN QUERY SELECT true, 'ALL_LESSONS_PLACEHOLDER'::text,
      jsonb_build_object('lessons_total', v.lessons_total, 'lessons_placeholder', v.lessons_placeholder);
    RETURN;
  END IF;

  -- Case 2: lessons expected but none real AND no exam pool
  IF v_no_real_lessons AND v_no_exam_pool THEN
    RETURN QUERY SELECT true, 'NO_REAL_LESSONS_AND_NO_EXAM_POOL'::text,
      jsonb_build_object('lessons_total', v.lessons_total, 'lessons_real', v.lessons_real,
        'approved_questions', v.approved_questions, 'total_blueprints', v.total_blueprints);
    RETURN;
  END IF;

  -- Case 3: zero substantive artifacts at all
  IF v_no_substantive_artifacts THEN
    RETURN QUERY SELECT true, 'NO_SUBSTANTIVE_ARTIFACTS'::text,
      jsonb_build_object('approved_questions', v.approved_questions, 'handbook_sections', v.handbook_sections,
        'oral_blueprints', v.oral_blueprints, 'minichecks', v.minichecks,
        'tutor_index_rows', v.tutor_index_rows, 'lessons_real', v.lessons_real);
    RETURN;
  END IF;

  -- Not hollow
  RETURN QUERY SELECT false, 'PACKAGE_NOT_HOLLOW'::text,
    jsonb_build_object('approved_questions', v.approved_questions, 'handbook_sections', v.handbook_sections,
      'oral_blueprints', v.oral_blueprints, 'minichecks', v.minichecks,
      'tutor_index_rows', v.tutor_index_rows, 'lessons_real', v.lessons_real);
END;
$$;

-- =========================================================
-- 4) Reconciliation function
-- =========================================================
CREATE OR REPLACE FUNCTION public.run_hollow_published_guard_ssot()
RETURNS TABLE (
  package_id uuid,
  action text,
  reason_code text,
  reason_detail jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  d record;
BEGIN
  FOR r IN
    SELECT cp.id, cp.status
    FROM course_packages cp
    WHERE cp.status = 'published'
       OR (cp.status = 'quality_gate_failed' AND cp.integrity_report->>'verdict' = 'hollow_published_auto_quarantine')
  LOOP
    SELECT * INTO d FROM fn_should_hollow_quarantine_package(r.id);

    IF d.should_quarantine THEN
      -- Check if already quarantined for hollow
      IF r.status = 'quality_gate_failed' THEN
        RETURN QUERY SELECT r.id, 'already_quarantined'::text, d.reason_code, d.reason_detail;
      ELSE
        PERFORM quarantine_package(r.id, 'hollow_published_auto_quarantine');
        RETURN QUERY SELECT r.id, 'quarantined'::text, d.reason_code, d.reason_detail;
      END IF;
    ELSE
      -- Restore false positives
      IF r.status = 'quality_gate_failed' THEN
        UPDATE course_packages
        SET status = COALESCE(
              NULLIF(integrity_report->>'previous_status', ''),
              'published'
            ),
            blocked_reason = NULL,
            integrity_passed = true,
            integrity_report = COALESCE(integrity_report, '{}'::jsonb) || jsonb_build_object(
              'hollow_guard_restored_at', now(),
              'hollow_guard_restore_reason', d.reason_code,
              'hollow_guard_restore_detail', d.reason_detail,
              'verdict', 'restored_by_ssot_guard'
            ),
            updated_at = now()
        WHERE id = r.id;

        INSERT INTO ops_guardrail_events (guard_key, details)
        VALUES ('hollow_guard_false_positive_restore', jsonb_build_object(
          'package_id', r.id,
          'reason_code', d.reason_code,
          'reason_detail', d.reason_detail,
          'restored_to', COALESCE(
            NULLIF((SELECT integrity_report->>'previous_status' FROM course_packages WHERE id = r.id), ''),
            'published'
          )
        ));

        RETURN QUERY SELECT r.id, 'restored'::text, d.reason_code, d.reason_detail;
      END IF;
    END IF;
  END LOOP;
END;
$$;

-- =========================================================
-- 5) Replace Guard 4 in run_nightly_pipeline_guards
-- =========================================================
CREATE OR REPLACE FUNCTION public.run_nightly_pipeline_guards()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_done_not_ok int := 0;
  v_queued_stale int := 0;
  v_building_no_start int := 0;
  v_hollow_published int := 0;
  v_quarantined_ids uuid[] := '{}';
  v_restored_ids uuid[] := '{}';
  rec record;
BEGIN
  -- Guard 1: done but meta.ok explicitly not true
  SELECT COUNT(*) INTO v_done_not_ok
  FROM public.package_steps
  WHERE status = 'done'
    AND (meta ? 'ok')
    AND (meta->>'ok')::text <> 'true';

  IF v_done_not_ok > 0 THEN
    INSERT INTO public.ops_guardrail_events (guard_key, details)
    VALUES ('done_implies_ok', jsonb_build_object('count', v_done_not_ok));
  END IF;

  -- Guard 2: queued with stale metadata
  SELECT COUNT(*) INTO v_queued_stale
  FROM public.package_steps
  WHERE status = 'queued'
    AND meta IS NOT NULL
    AND (meta ? 'ok' OR meta ? 'batch_complete');

  IF v_queued_stale > 0 THEN
    INSERT INTO public.ops_guardrail_events (guard_key, details)
    VALUES ('queued_meta_hygiene', jsonb_build_object('count', v_queued_stale));
  END IF;

  -- Guard 3: building packages with done steps missing started_at
  SELECT COUNT(*) INTO v_building_no_start
  FROM public.package_steps ps
  JOIN public.course_packages cp ON cp.id = ps.package_id
  WHERE cp.status = 'building'
    AND ps.status = 'done'
    AND ps.started_at IS NULL
    AND ps.finished_at IS NOT NULL;

  IF v_building_no_start > 0 THEN
    INSERT INTO public.ops_guardrail_events (guard_key, details)
    VALUES ('building_done_without_started_at', jsonb_build_object('count', v_building_no_start));
  END IF;

  -- Guard 4: SSOT-aware hollow published detection
  FOR rec IN
    SELECT r.package_id, r.action, r.reason_code, r.reason_detail
    FROM run_hollow_published_guard_ssot() r
  LOOP
    IF rec.action = 'quarantined' THEN
      v_quarantined_ids := array_append(v_quarantined_ids, rec.package_id);
      v_hollow_published := v_hollow_published + 1;
    ELSIF rec.action = 'restored' THEN
      v_restored_ids := array_append(v_restored_ids, rec.package_id);
    END IF;
  END LOOP;

  IF v_hollow_published > 0 OR array_length(v_restored_ids, 1) > 0 THEN
    INSERT INTO public.ops_guardrail_events (guard_key, details)
    VALUES ('hollow_published_ssot_guard', jsonb_build_object(
      'quarantined_count', v_hollow_published,
      'quarantined_ids', to_jsonb(v_quarantined_ids),
      'restored_count', COALESCE(array_length(v_restored_ids, 1), 0),
      'restored_ids', to_jsonb(v_restored_ids)
    ));
  END IF;

  RETURN jsonb_build_object(
    'done_but_not_ok', v_done_not_ok,
    'queued_with_stale_meta', v_queued_stale,
    'building_done_without_started_at', v_building_no_start,
    'hollow_published', v_hollow_published,
    'quarantined_ids', to_jsonb(v_quarantined_ids),
    'restored_ids', to_jsonb(v_restored_ids),
    'all_clear', (v_done_not_ok = 0 AND v_queued_stale = 0 AND v_building_no_start = 0 AND v_hollow_published = 0)
  );
END;
$$;
