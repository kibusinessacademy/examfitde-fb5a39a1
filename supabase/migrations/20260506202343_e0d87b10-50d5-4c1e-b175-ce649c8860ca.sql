
ALTER VIEW public.v_learning_integrity_audit RENAME TO v_learning_integrity_audit_raw;

CREATE OR REPLACE VIEW public.v_learning_integrity_audit AS
SELECT
  raw.package_id,
  raw.package_key,
  raw.title,
  raw.curriculum_id,
  raw.status,
  raw.learningfield_count,
  raw.competency_count,
  raw.lesson_count,
  raw.minicheck_count,
  raw.tutor_context_count,
  raw.oral_blueprint_count,
  raw.approved_exam_question_count,
  raw.total_exam_question_count,
  raw.duplicate_exam_question_count,
  raw.competency_coverage_pct,
  raw.blueprint_coverage_pct,
  raw.duplicate_question_ratio,
  raw.gate_no_lessons,
  -- Track-aware override
  (raw.gate_no_minichecks
   AND NOT coalesce(
     (SELECT bool_or(should_run = false AND condition IS NULL)
        FROM public.track_step_applicability tsa
       WHERE tsa.step_key = 'generate_lesson_minichecks'
         AND tsa.track::text = raw.track::text), false)) AS gate_no_minichecks,
  raw.gate_low_exam_questions,
  (raw.gate_no_oral
   AND NOT coalesce(
     (SELECT bool_or(should_run = false AND condition IS NULL)
        FROM public.track_step_applicability tsa
       WHERE tsa.step_key = 'generate_oral_exam'
         AND tsa.track::text = raw.track::text), false)) AS gate_no_oral,
  raw.gate_no_tutor_context,
  raw.gate_low_competency_coverage,
  raw.gate_low_blueprint_coverage,
  raw.gate_high_duplicates,
  raw.learning_integrity_score,
  raw.publish_learning_status,
  raw.track
FROM public.v_learning_integrity_audit_raw raw;

INSERT INTO public.auto_heal_log(target_type, action_type, result_status, result_detail, metadata)
VALUES (
  'system',
  'lxi_gate_no_minichecks_track_aware_calibrated',
  'success',
  'gate_no_minichecks/gate_no_oral now track-aware via track_step_applicability override',
  jsonb_build_object('phase','LXI_2b','tracks_excluded_minichecks', ARRAY['EXAM_FIRST','EXAM_FIRST_PLUS'])
);
