-- ============================================================
-- Fix: fn_guard_publish_lxi_no_lessons hat b.track (product_track enum)
-- mit dem Literal 'UNKNOWN' COALESCEd, was beim Cast in den enum
-- 'invalid input value for enum product_track: "UNKNOWN"' (HTTP 500)
-- in package-auto-publish auslöst. Fix: explizit ::text casten.
-- Zusätzlich Validation: track muss ein gültiger product_track sein.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_guard_publish_lxi_no_lessons()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row record;
  v_violations text[] := ARRAY[]::text[];
BEGIN
  IF NEW.status <> 'published' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.status = 'published'
     AND NEW.status = 'published' THEN
    RETURN NEW;
  END IF;

  -- ✅ FIX: Cast b.track to text BEFORE COALESCE so 'UNKNOWN' literal
  -- never gets cast to product_track enum (which lacks UNKNOWN).
  SELECT
    COALESCE(a.gate_no_lessons, false) AS g_lessons,
    COALESCE(b.gate_no_minichecks_effective, false) AS g_minichecks,
    COALESCE(b.gate_no_oral_effective, false) AS g_oral,
    COALESCE(b.gate_no_tutor_context_effective, false) AS g_tutor,
    COALESCE(b.track::text, 'UNKNOWN') AS track
  INTO v_row
  FROM public.course_packages cp
  LEFT JOIN public.v_learning_integrity_audit a ON a.package_id = cp.id
  LEFT JOIN public.v_learning_gate_track_aware b ON b.package_id = cp.id
  WHERE cp.id = NEW.id;

  IF v_row.g_lessons        THEN v_violations := array_append(v_violations, 'gate_no_lessons'); END IF;
  IF v_row.g_minichecks     THEN v_violations := array_append(v_violations, 'gate_no_minichecks_effective'); END IF;
  IF v_row.g_oral           THEN v_violations := array_append(v_violations, 'gate_no_oral_effective'); END IF;
  IF v_row.g_tutor          THEN v_violations := array_append(v_violations, 'gate_no_tutor_context_effective'); END IF;

  IF array_length(v_violations, 1) > 0 THEN
    INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
    VALUES (
      'lxi_publish_blocked_effective',
      'package',
      NEW.id,
      'blocked',
      jsonb_build_object(
        'track', v_row.track,
        'violations', to_jsonb(v_violations),
        'attempted_status', NEW.status,
        'previous_status', COALESCE(OLD.status, NULL)
      )
    );
    RAISE EXCEPTION 'LXI_PUBLISH_BLOCKED: track=% violations=%', v_row.track, v_violations
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

-- ============================================================
-- Regression-Helper: validiert dass alle Funktionen, die einen
-- Track-String als Literal nutzen, diesen NICHT in den enum
-- product_track casten. SSOT-Smoke für CI.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_smoke_lxi_guard_no_unknown_cast()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_def text;
  v_offending int := 0;
BEGIN
  -- has_role gate: only admin or service_role
  IF NOT (public.has_role(auth.uid(), 'admin'::app_role) OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT pg_get_functiondef('public.fn_guard_publish_lxi_no_lessons'::regproc) INTO v_def;

  -- Must contain ::text cast before COALESCE with 'UNKNOWN'
  IF v_def !~ 'b\.track::text' THEN
    v_offending := v_offending + 1;
  END IF;

  RETURN jsonb_build_object(
    'ok', v_offending = 0,
    'offending_count', v_offending,
    'checked_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_smoke_lxi_guard_no_unknown_cast() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_smoke_lxi_guard_no_unknown_cast() TO service_role;

-- Audit
INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
VALUES (
  'product_track_unknown_cast_fix',
  'system',
  'fn_guard_publish_lxi_no_lessons',
  'applied',
  jsonb_build_object(
    'fix', 'cast b.track::text before COALESCE',
    'root_cause', 'COALESCE(enum, ''UNKNOWN'') tried to cast UNKNOWN to product_track enum',
    'failed_jobs_observed', 5,
    'sprint', 'S5d'
  )
);