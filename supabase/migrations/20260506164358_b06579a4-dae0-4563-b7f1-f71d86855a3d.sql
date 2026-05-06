BEGIN;

CREATE OR REPLACE FUNCTION public.fn_package_gate_applicable(
  p_track text,
  p_gate text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN upper(coalesce(p_track,'')) = 'EXAM_FIRST'
      AND p_gate IN ('gate_no_lessons','gate_no_minichecks','gate_no_tutor_context')
      THEN false
    WHEN p_gate = 'gate_no_oral'
      THEN upper(coalesce(p_track,'')) IN ('PLUS','FULL','ORAL','BUNDLE','ALL_IN')
    WHEN p_gate = 'gate_no_minichecks'
      THEN upper(coalesce(p_track,'')) IN ('PLUS','FULL','COURSE','BUNDLE','ALL_IN','H5P')
    WHEN p_gate = 'gate_no_tutor_context'
      THEN upper(coalesce(p_track,'')) IN ('PLUS','FULL','COURSE','BUNDLE','ALL_IN','TUTOR','H5P')
    WHEN p_gate = 'gate_no_lessons'
      THEN upper(coalesce(p_track,'')) <> 'EXAM_FIRST'
    ELSE true
  END;
$$;

CREATE OR REPLACE VIEW public.v_package_gate_applicability AS
SELECT
  cp.id AS package_id,
  cp.title,
  cp.status,
  cp.track,
  public.fn_package_gate_applicable(cp.track::text, 'gate_no_lessons') AS applies_lessons,
  public.fn_package_gate_applicable(cp.track::text, 'gate_no_minichecks') AS applies_minichecks,
  public.fn_package_gate_applicable(cp.track::text, 'gate_no_oral') AS applies_oral,
  public.fn_package_gate_applicable(cp.track::text, 'gate_no_tutor_context') AS applies_tutor_context
FROM public.course_packages cp;

DROP VIEW IF EXISTS public.v_learning_gate_track_aware;
CREATE VIEW public.v_learning_gate_track_aware AS
SELECT
  a.*,
  public.fn_package_gate_applicable(a.track::text, 'gate_no_lessons')
    AND coalesce(a.gate_no_lessons,false) AS gate_no_lessons_effective,
  public.fn_package_gate_applicable(a.track::text, 'gate_no_minichecks')
    AND coalesce(a.gate_no_minichecks,false) AS gate_no_minichecks_effective,
  public.fn_package_gate_applicable(a.track::text, 'gate_no_oral')
    AND coalesce(a.gate_no_oral,false) AS gate_no_oral_effective,
  public.fn_package_gate_applicable(a.track::text, 'gate_no_tutor_context')
    AND coalesce(a.gate_no_tutor_context,false) AS gate_no_tutor_context_effective
FROM public.v_learning_integrity_audit a;

CREATE OR REPLACE VIEW public.v_cluster_heal_monitor_2026_05_06 AS
SELECT
  date_trunc('hour', created_at) AS hour,
  action_type,
  result_status,
  metadata->>'reason' AS reason,
  metadata->>'job_type' AS job_type,
  metadata->>'producer' AS producer,
  count(*) AS n
FROM public.auto_heal_log
WHERE created_at > now() - interval '24 hours'
  AND action_type IN (
    'producer_blocked_package_progress',
    'producer_precheck_skip',
    'ssot_payload_warn',
    'cluster_heal_nudge_2026_05_06'
  )
GROUP BY 1,2,3,4,5,6;

INSERT INTO public.auto_heal_log
  (trigger_source, action_type, target_type, result_status, result_detail, metadata)
VALUES
  (
    'migration',
    'track_aware_gate_applicability_installed',
    'system',
    'ok',
    'Installed track-aware applicability matrix for lessons, minichecks, oral and tutor-context gates.',
    jsonb_build_object(
      'gates', jsonb_build_array('gate_no_lessons','gate_no_minichecks','gate_no_oral','gate_no_tutor_context'),
      'monitor_view', 'v_cluster_heal_monitor_2026_05_06'
    )
  );

COMMIT;