CREATE OR REPLACE FUNCTION public.fn_guard_redundant_seeding()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  _pkg_id          uuid;
  _curriculum_id   uuid;
  _step_key        text;
  _bp_count        int := 0;
  _variant_count   int := 0;
  _required_min    int := 10;
  _is_truth        boolean := false;
  _reason          text;
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  IF NEW.job_type NOT IN ('package_auto_seed_exam_blueprints','package_generate_blueprint_variants') THEN
    RETURN NEW;
  END IF;

  _pkg_id := (NEW.payload->>'package_id')::uuid;
  IF _pkg_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT cp.curriculum_id INTO _curriculum_id
  FROM course_packages cp WHERE cp.id = _pkg_id;

  IF _curriculum_id IS NULL THEN
    RETURN NEW;
  END IF;

  _step_key := substring(NEW.job_type FROM 9);

  IF NEW.job_type = 'package_auto_seed_exam_blueprints' THEN
    SELECT count(*) INTO _bp_count
    FROM question_blueprints qb
    WHERE qb.curriculum_id = _curriculum_id
      AND qb.status IN ('approved','review');

    _is_truth := (_bp_count >= _required_min);
    _reason   := CASE WHEN _is_truth
                   THEN 'REDUNDANT_BLUEPRINTS_PRESENT'
                   ELSE 'BLUEPRINTS_INSUFFICIENT' END;

  ELSIF NEW.job_type = 'package_generate_blueprint_variants' THEN
    SELECT count(*) INTO _variant_count
    FROM exam_question_variants v
    JOIN question_blueprints qb ON qb.id = v.blueprint_id
    WHERE qb.curriculum_id = _curriculum_id;

    SELECT count(*) INTO _bp_count
    FROM question_blueprints qb
    WHERE qb.curriculum_id = _curriculum_id
      AND qb.status IN ('approved','review');

    _is_truth := (
      _variant_count >= 10
      AND _bp_count > 0
      AND (
        SELECT count(DISTINCT v.blueprint_id)::numeric / NULLIF(_bp_count,0)
        FROM exam_question_variants v
        JOIN question_blueprints qb ON qb.id = v.blueprint_id
        WHERE qb.curriculum_id = _curriculum_id
      ) >= 0.8
    );
    _reason := CASE WHEN _is_truth
                 THEN 'REDUNDANT_VARIANTS_PRESENT'
                 ELSE 'VARIANTS_INSUFFICIENT' END;
  END IF;

  IF _is_truth THEN
    UPDATE package_steps ps
    SET meta = COALESCE(ps.meta,'{}'::jsonb) || jsonb_build_object(
          'redundant_detected', true,
          'redundant_reason',  _reason,
          'redundant_job_type', NEW.job_type,
          'redundant_blueprints', _bp_count,
          'redundant_variants',   _variant_count,
          'redundant_detected_at', now()
        ),
        updated_at = now()
    WHERE ps.package_id = _pkg_id
      AND ps.step_key::text = _step_key
      AND ps.status IN ('queued','enqueued','running','pending_enqueue');

    PERFORM public.fn_log_guardrail_event(
      'redundant_seeding_marked',
      jsonb_build_object(
        'package_id', _pkg_id,
        'curriculum_id', _curriculum_id,
        'job_type', NEW.job_type,
        'step_key', _step_key,
        'reason', _reason,
        'blueprints', _bp_count,
        'variants', _variant_count
      )
    );
    RETURN NULL;
  END IF;

  PERFORM public.fn_log_guardrail_event(
    'redundant_seeding_passthrough',
    jsonb_build_object(
      'package_id', _pkg_id,
      'curriculum_id', _curriculum_id,
      'job_type', NEW.job_type,
      'step_key', _step_key,
      'reason', _reason,
      'blueprints', _bp_count,
      'variants', _variant_count
    )
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_reconcile_redundant_seeding(_dry_run boolean DEFAULT true)
RETURNS TABLE(
  package_id uuid,
  step_key text,
  action text,
  reason text,
  err text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r record;
  v_active_jobs int;
BEGIN
  FOR r IN
    SELECT ps.package_id AS pkg, ps.step_key::text AS sk,
           ps.meta->>'redundant_reason' AS rsn
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE (ps.meta->>'redundant_detected')::boolean = true
      AND ps.status IN ('queued','enqueued','running','pending_enqueue')
      AND cp.status = 'building'
  LOOP
    SELECT count(*) INTO v_active_jobs
    FROM job_queue jq
    WHERE jq.package_id = r.pkg
      AND jq.job_type = 'package_' || r.sk
      AND jq.status IN ('processing','running','batch_pending');

    IF v_active_jobs > 0 THEN
      package_id := r.pkg; step_key := r.sk;
      action := 'skipped'; reason := 'BLOCKED_UPSTREAM_ACTIVE_JOBS'; err := NULL;
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF _dry_run THEN
      package_id := r.pkg; step_key := r.sk;
      action := 'would_close'; reason := r.rsn; err := NULL;
      RETURN NEXT;
      CONTINUE;
    END IF;

    BEGIN
      PERFORM public.admin_force_steps_done(
        r.pkg, ARRAY[r.sk]::text[],
        format('reconcile_redundant_seeding:%s', r.rsn),
        true,
        false
      );
      package_id := r.pkg; step_key := r.sk;
      action := 'closed'; reason := r.rsn; err := NULL;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      package_id := r.pkg; step_key := r.sk;
      action := 'error'; reason := COALESCE(r.rsn,'UNKNOWN'); err := SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;
END;
$fn$;

CREATE OR REPLACE VIEW public.v_ops_redundant_seeding_pending AS
SELECT
  ps.package_id,
  ps.step_key::text AS step_key,
  ps.status,
  ps.meta->>'redundant_reason'    AS reason,
  (ps.meta->>'redundant_blueprints')::int AS blueprints,
  (ps.meta->>'redundant_variants')::int   AS variants,
  (ps.meta->>'redundant_detected_at')::timestamptz AS detected_at,
  cp.status AS package_status
FROM package_steps ps
JOIN course_packages cp ON cp.id = ps.package_id
WHERE (ps.meta->>'redundant_detected')::boolean = true
  AND ps.status IN ('queued','enqueued','running','pending_enqueue');

DO $do$
BEGIN
  PERFORM 1 FROM public.admin_reconcile_redundant_seeding(false);
END
$do$;