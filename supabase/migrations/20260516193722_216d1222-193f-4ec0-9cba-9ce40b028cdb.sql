-- =====================================================
-- Sprint 1: Entitlement Foundation — Helper + Summary RPC
-- =====================================================

CREATE OR REPLACE FUNCTION public.fn_default_channel_policy(_track text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_track text := COALESCE(_track, 'EXAM_FIRST');
  v_access int;
  v_b2b_min int;
  v_b2b_max int;
  v_oral boolean := false;
  v_h5p boolean := false;
BEGIN
  CASE v_track
    WHEN 'EXAM_FIRST' THEN
      v_access := 12; v_b2b_min := 5;  v_b2b_max := 500;
    WHEN 'EXAM_FIRST_PLUS' THEN
      v_access := 12; v_b2b_min := 5;  v_b2b_max := 500;
      v_oral := true; v_h5p := true;
    WHEN 'AUSBILDUNG_VOLL' THEN
      v_access := 24; v_b2b_min := 10; v_b2b_max := 2000;
      v_oral := true; v_h5p := true;
    ELSE
      -- Unknown track: conservative B2C-only default
      v_access := 12; v_b2b_min := 5;  v_b2b_max := 100;
  END CASE;

  RETURN jsonb_build_object(
    'version',          1,
    'track',            v_track,
    'generated_at',     to_jsonb(now()),
    'b2c', jsonb_build_object(
      'enabled',        true,
      'seats',          1,
      'access_months',  v_access,
      'transferable',   false,
      'features', jsonb_build_object(
        'exam_trainer', true,
        'ai_tutor',     true,
        'minichecks',   true,
        'oral_exam',    v_oral,
        'h5p',          v_h5p
      )
    ),
    'b2b', jsonb_build_object(
      'enabled',          true,
      'min_seats',        v_b2b_min,
      'max_seats',        v_b2b_max,
      'access_months',    v_access,
      'seat_management',  'self_serve',
      'billing',          'invoice_or_card',
      'reassignable',     true,
      'features', jsonb_build_object(
        'exam_trainer',     true,
        'ai_tutor',         true,
        'minichecks',       true,
        'oral_exam',        v_oral,
        'h5p',              v_h5p,
        'admin_dashboard',  true,
        'sso_optional',     true,
        'reporting',        true
      )
    )
  );
END;
$$;

COMMENT ON FUNCTION public.fn_default_channel_policy(text) IS
  'Sprint 1 Entitlement Foundation: track-aware default policy (B2C + B2B Multi-Seat). Tracks: EXAM_FIRST, EXAM_FIRST_PLUS, AUSBILDUNG_VOLL.';

-- =====================================================
-- Admin Summary RPC
-- =====================================================
CREATE OR REPLACE FUNCTION public.admin_get_entitlement_foundation_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_by_track jsonb;
  v_totals jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;

  WITH base AS (
    SELECT
      cp.track::text AS track,
      pr.id AS product_id,
      (pr.channel_policy_json IS NOT NULL AND pr.channel_policy_json <> '{}'::jsonb) AS template_ready,
      (pr.channel_policy_json->'b2c'->>'enabled')::boolean AS b2c_enabled,
      (pr.channel_policy_json->'b2b'->>'enabled')::boolean AS b2b_enabled,
      (pr.channel_policy_json->>'version')::int AS policy_version
    FROM products pr
    JOIN course_packages cp ON cp.curriculum_id = pr.curriculum_id AND cp.status = 'published'
    WHERE pr.status = 'active' AND pr.curriculum_id IS NOT NULL
  )
  SELECT
    jsonb_object_agg(track, t),
    jsonb_build_object(
      'total_products',     SUM((t->>'total')::int),
      'template_ready',     SUM((t->>'template_ready')::int),
      'b2c_enabled',        SUM((t->>'b2c_enabled')::int),
      'b2b_enabled',        SUM((t->>'b2b_enabled')::int),
      'policy_v1',          SUM((t->>'policy_v1')::int)
    )
  INTO v_by_track, v_totals
  FROM (
    SELECT
      track,
      jsonb_build_object(
        'total',          COUNT(*),
        'template_ready', COUNT(*) FILTER (WHERE template_ready),
        'b2c_enabled',    COUNT(*) FILTER (WHERE b2c_enabled),
        'b2b_enabled',    COUNT(*) FILTER (WHERE b2b_enabled),
        'policy_v1',      COUNT(*) FILTER (WHERE policy_version = 1)
      ) AS t
    FROM base GROUP BY track
  ) g;

  RETURN jsonb_build_object(
    'by_track',     COALESCE(v_by_track, '{}'::jsonb),
    'totals',       COALESCE(v_totals,   '{}'::jsonb),
    'computed_at',  now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_entitlement_foundation_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_entitlement_foundation_summary() TO authenticated;

-- =====================================================
-- Smoke + Audit
-- =====================================================
DO $$
DECLARE
  v_policy jsonb;
BEGIN
  v_policy := public.fn_default_channel_policy('EXAM_FIRST_PLUS');
  IF (v_policy->>'version')::int <> 1
     OR (v_policy->'b2c'->'features'->>'oral_exam')::boolean <> true
     OR (v_policy->'b2b'->>'enabled')::boolean <> true THEN
    RAISE EXCEPTION 'smoke fail: %', v_policy;
  END IF;
END $$;

INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
VALUES (
  'entitlement_foundation_schema_init',
  'system',
  'success',
  jsonb_build_object(
    'sprint', 'entitlement_foundation_s1',
    'helper', 'fn_default_channel_policy(track)',
    'rpc',    'admin_get_entitlement_foundation_summary',
    'tracks', ARRAY['EXAM_FIRST','EXAM_FIRST_PLUS','AUSBILDUNG_VOLL'],
    'note',   'Backfill via separate data update'
  )
);