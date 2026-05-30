INSERT INTO ops_audit_contract(action_type, required_keys, owner_module) VALUES
  ('minicheck_producer_drift_snapshot', ARRAY['drift_count','generate_skipped','validate_active'], 'ops.minicheck_drift'),
  ('minicheck_producer_drift_heal_attempt', ARRAY['package_id','action','outcome'], 'ops.minicheck_drift')
ON CONFLICT (action_type) DO UPDATE SET required_keys=EXCLUDED.required_keys, owner_module=EXCLUDED.owner_module;

CREATE OR REPLACE VIEW v_minicheck_producer_drift AS
SELECT
  v.package_id,
  cp.title,
  cp.status AS package_status,
  v.status::text AS validate_status,
  COALESCE(g.status::text, 'MISSING') AS generate_status,
  g.last_error AS generate_last_error,
  v.last_error AS validate_last_error,
  v.updated_at AS validate_updated_at,
  g.updated_at AS generate_updated_at,
  CASE
    WHEN g.status IS NULL THEN 'GENERATE_STEP_MISSING'
    WHEN g.status::text = 'skipped' AND g.last_error LIKE '%hot-loop%' THEN 'GENERATE_FROZEN_HOTLOOP'
    WHEN g.status::text = 'skipped' THEN 'GENERATE_SKIPPED_OTHER'
    WHEN g.status::text IN ('queued','failed') THEN 'GENERATE_NOT_PROGRESSING'
    ELSE 'OTHER'
  END AS drift_reason
FROM package_steps v
LEFT JOIN package_steps g
  ON g.package_id = v.package_id AND g.step_key = 'generate_lesson_minichecks'
LEFT JOIN course_packages cp ON cp.id = v.package_id
WHERE v.step_key = 'validate_lesson_minichecks'
  AND v.status::text IN ('queued','failed')
  AND (g.status IS NULL OR g.status::text <> 'done');

REVOKE ALL ON v_minicheck_producer_drift FROM PUBLIC;
REVOKE ALL ON v_minicheck_producer_drift FROM anon;
REVOKE ALL ON v_minicheck_producer_drift FROM authenticated;
GRANT SELECT ON v_minicheck_producer_drift TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_minicheck_producer_drift_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_drift_count int;
  v_generate_skipped int;
  v_validate_active int;
  v_by_reason jsonb;
  v_samples jsonb;
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE='42501';
  END IF;

  SELECT count(*) INTO v_drift_count FROM v_minicheck_producer_drift;
  SELECT count(*) INTO v_generate_skipped
    FROM package_steps WHERE step_key='generate_lesson_minichecks' AND status::text='skipped';
  SELECT count(*) INTO v_validate_active
    FROM package_steps WHERE step_key='validate_lesson_minichecks' AND status::text IN ('queued','failed');

  SELECT jsonb_object_agg(drift_reason, c)
  INTO v_by_reason
  FROM (SELECT drift_reason, count(*) c FROM v_minicheck_producer_drift GROUP BY 1) s;

  SELECT jsonb_agg(to_jsonb(t))
  INTO v_samples
  FROM (
    SELECT package_id, title, drift_reason, validate_status, generate_status, validate_updated_at
    FROM v_minicheck_producer_drift
    ORDER BY validate_updated_at DESC NULLS LAST
    LIMIT 25
  ) t;

  PERFORM fn_emit_audit(
    _action_type => 'minicheck_producer_drift_snapshot',
    _target_type => 'system',
    _target_id   => NULL,
    _result_status => 'observed',
    _metadata    => jsonb_build_object(
      'drift_count', v_drift_count,
      'generate_skipped', v_generate_skipped,
      'validate_active', v_validate_active,
      'by_reason', COALESCE(v_by_reason, '{}'::jsonb)
    ),
    _actor       => 'admin_rpc',
    _correlation_id => NULL
  );

  RETURN jsonb_build_object(
    'drift_count', v_drift_count,
    'generate_skipped', v_generate_skipped,
    'validate_active', v_validate_active,
    'by_reason', COALESCE(v_by_reason, '{}'::jsonb),
    'samples', COALESCE(v_samples, '[]'::jsonb),
    'computed_at', now()
  );
END$$;

REVOKE ALL ON FUNCTION public.admin_get_minicheck_producer_drift_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_minicheck_producer_drift_summary() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_heal_minicheck_producer_drift(
  _package_id uuid,
  _action text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_outcome text;
  v_validate_status text;
  v_generate_status text;
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE='42501';
  END IF;
  IF _action NOT IN ('reset_generate','skip_validate') THEN
    RAISE EXCEPTION 'action must be reset_generate or skip_validate' USING ERRCODE='22023';
  END IF;

  SELECT status::text INTO v_validate_status FROM package_steps
    WHERE package_id=_package_id AND step_key='validate_lesson_minichecks';
  SELECT status::text INTO v_generate_status FROM package_steps
    WHERE package_id=_package_id AND step_key='generate_lesson_minichecks';

  IF v_validate_status IS NULL THEN
    v_outcome := 'noop_no_validate_step';
  ELSIF _action = 'reset_generate' THEN
    UPDATE package_steps
       SET status='queued', last_error=NULL, updated_at=now()
     WHERE package_id=_package_id AND step_key='generate_lesson_minichecks';
    v_outcome := 'generate_reset_to_queued';
  ELSE
    UPDATE package_steps
       SET status='skipped',
           last_error='manual_admin_heal: producer drift, validate skipped',
           updated_at=now()
     WHERE package_id=_package_id AND step_key='validate_lesson_minichecks';
    v_outcome := 'validate_marked_skipped';
  END IF;

  PERFORM fn_emit_audit(
    _action_type => 'minicheck_producer_drift_heal_attempt',
    _target_type => 'course_package',
    _target_id   => _package_id::text,
    _result_status => 'applied',
    _metadata    => jsonb_build_object(
      'package_id', _package_id,
      'action', _action,
      'outcome', v_outcome,
      'validate_status_before', v_validate_status,
      'generate_status_before', v_generate_status
    ),
    _actor       => 'admin_rpc',
    _correlation_id => NULL
  );

  RETURN jsonb_build_object(
    'package_id', _package_id,
    'action', _action,
    'outcome', v_outcome,
    'validate_status_before', v_validate_status,
    'generate_status_before', v_generate_status
  );
END$$;

REVOKE ALL ON FUNCTION public.admin_heal_minicheck_producer_drift(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_heal_minicheck_producer_drift(uuid, text) TO authenticated;