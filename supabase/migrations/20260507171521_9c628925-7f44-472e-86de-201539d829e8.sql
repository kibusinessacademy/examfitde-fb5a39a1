CREATE OR REPLACE FUNCTION public.fn_normalize_track(p_track text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE upper(coalesce(trim(p_track), ''))
    WHEN 'AUSBILDUNG_VOLL'       THEN 'AUSBILDUNG_VOLL'
    WHEN 'AUSBILDUNG'            THEN 'AUSBILDUNG_VOLL'
    WHEN 'AUSBILDUNG-VOLL'       THEN 'AUSBILDUNG_VOLL'
    WHEN 'AUSBILDUNG_VOLL_ELITE' THEN 'AUSBILDUNG_VOLL'
    WHEN 'ELITE'                 THEN 'AUSBILDUNG_VOLL'
    WHEN 'EXAM_FIRST'            THEN 'EXAM_FIRST'
    WHEN 'EXAMFIRST'             THEN 'EXAM_FIRST'
    WHEN 'EXAM-FIRST'            THEN 'EXAM_FIRST'
    WHEN 'EXAM_FIRST_PLUS'       THEN 'EXAM_FIRST_PLUS'
    WHEN 'EXAM-FIRST-PLUS'       THEN 'EXAM_FIRST_PLUS'
    WHEN 'EXAMFIRSTPLUS'         THEN 'EXAM_FIRST_PLUS'
    WHEN 'FORTBILDUNG'           THEN 'EXAM_FIRST_PLUS'
    WHEN 'ZERTIFIKAT'            THEN 'EXAM_FIRST_PLUS'
    WHEN 'STUDIUM'               THEN 'STUDIUM'
    WHEN 'HIGHER_ED'             THEN 'STUDIUM'
    WHEN 'HIGHER_EDUCATION'      THEN 'STUDIUM'
    WHEN 'BACHELOR'              THEN 'STUDIUM'
    WHEN 'MASTER'                THEN 'STUDIUM'
    WHEN 'ACADEMIC'              THEN 'STUDIUM'
    ELSE 'AUSBILDUNG_VOLL'
  END;
$$;

CREATE OR REPLACE FUNCTION public.fn_package_has_oral_exam(p_package_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE v_track text; v_cert_id uuid; v_cert_oral boolean;
BEGIN
  SELECT public.fn_normalize_track(p.track::text), p.certification_id
    INTO v_track, v_cert_id
  FROM course_packages p WHERE p.id = p_package_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_track = 'AUSBILDUNG_VOLL' THEN RETURN true; END IF;
  IF v_track = 'EXAM_FIRST'      THEN RETURN true; END IF;
  IF v_track = 'STUDIUM'         THEN RETURN false; END IF;
  IF v_track = 'EXAM_FIRST_PLUS' AND v_cert_id IS NOT NULL THEN
    SELECT coalesce(c.oral_exam_enabled, false) INTO v_cert_oral
    FROM certifications c WHERE c.id = v_cert_id;
    RETURN coalesce(v_cert_oral, false);
  END IF;
  RETURN false;
END; $$;

CREATE OR REPLACE FUNCTION public.fn_step_globally_required(p_step_key text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT p_step_key IN (
    'auto_seed_exam_blueprints','validate_blueprints',
    'generate_blueprint_variants','validate_blueprint_variants','promote_blueprint_variants',
    'generate_exam_pool','validate_exam_pool',
    'build_ai_tutor_index','validate_tutor_index',
    'run_integrity_check','quality_council','auto_publish'
  );
$$;

CREATE OR REPLACE FUNCTION public.fn_skip_reason_legitimate(p_reason text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT p_reason IS NOT NULL
    AND p_reason NOT ILIKE 'phantom%'
    AND p_reason NOT ILIKE 'data_holes%'
    AND p_reason NOT ILIKE 'sweep%'
    AND p_reason IN (
      'track_not_applicable','track_ssot_not_applicable','auto_skipped_not_applicable',
      'oral_exam_qc_unhealable_below_threshold',
      'governance_bypass','admin_manual','admin_bypass',
      'capability_optional','cert_oral_disabled'
    );
$$;

CREATE OR REPLACE FUNCTION public.fn_guard_no_required_step_phantom_skip()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_reason text; v_has_oral boolean; v_is_oral_step boolean;
  v_is_required boolean; v_legitimate boolean;
BEGIN
  IF NEW.status::text <> 'skipped' THEN RETURN NEW; END IF;
  IF OLD.status::text  =  'skipped' THEN RETURN NEW; END IF;
  IF current_setting('session_replication_role', true) = 'replica' THEN RETURN NEW; END IF;
  IF current_setting('app.allow_required_skip', true) = 'on'        THEN RETURN NEW; END IF;

  v_reason       := NEW.meta->>'skip_reason';
  v_legitimate   := public.fn_skip_reason_legitimate(v_reason);
  v_is_required  := public.fn_step_globally_required(NEW.step_key);
  v_is_oral_step := NEW.step_key IN ('generate_oral_exam','validate_oral_exam');

  IF v_is_required AND NOT v_legitimate THEN
    INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
    VALUES ('phantom_skip_blocked_required_step', 'package_steps', NEW.id, 'blocked',
      jsonb_build_object('package_id', NEW.package_id,'step_key', NEW.step_key,
        'attempted_skip_reason', v_reason,'rule','globally_required_step_phantom_skip_blocked'));
    RAISE EXCEPTION 'phantom_skip_blocked_required_step: % (reason=%) on package %',
      NEW.step_key, coalesce(v_reason,'<null>'), NEW.package_id USING ERRCODE = 'check_violation';
  END IF;

  IF v_is_oral_step THEN
    v_has_oral := public.fn_package_has_oral_exam(NEW.package_id);
    IF v_has_oral AND NOT v_legitimate THEN
      INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
      VALUES ('phantom_skip_blocked_required_step', 'package_steps', NEW.id, 'blocked',
        jsonb_build_object('package_id', NEW.package_id,'step_key', NEW.step_key,
          'attempted_skip_reason', v_reason,'rule','oral_step_blocked_on_oral_eligible_package'));
      RAISE EXCEPTION 'phantom_skip_blocked_oral_eligible: % (reason=%) on package %',
        NEW.step_key, coalesce(v_reason,'<null>'), NEW.package_id USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NOT v_is_required AND NOT v_is_oral_step
     AND (v_reason IS NULL OR v_reason ILIKE 'phantom%' OR v_reason ILIKE 'data_holes%' OR v_reason ILIKE 'sweep%')
  THEN
    INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
    VALUES ('phantom_skip_blocked_optional_step', 'package_steps', NEW.id, 'blocked',
      jsonb_build_object('package_id', NEW.package_id,'step_key', NEW.step_key,
        'attempted_skip_reason', v_reason,'rule','optional_step_requires_explicit_reason'));
    RAISE EXCEPTION 'phantom_skip_blocked_optional: % (reason=%) on package % — explicit skip_reason required',
      NEW.step_key, coalesce(v_reason,'<null>'), NEW.package_id USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_guard_no_required_step_phantom_skip ON public.package_steps;
CREATE TRIGGER trg_guard_no_required_step_phantom_skip
BEFORE UPDATE OF status ON public.package_steps
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_no_required_step_phantom_skip();

REVOKE ALL ON FUNCTION public.fn_normalize_track(text)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_package_has_oral_exam(uuid)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_step_globally_required(text)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_skip_reason_legitimate(text)      FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_normalize_track(text)         TO service_role;
GRANT  EXECUTE ON FUNCTION public.fn_package_has_oral_exam(uuid)   TO service_role;
GRANT  EXECUTE ON FUNCTION public.fn_step_globally_required(text)  TO service_role;
GRANT  EXECUTE ON FUNCTION public.fn_skip_reason_legitimate(text)  TO service_role;

-- Smoke: must throw on phantom skip of a globally-required step
DO $smoke$
DECLARE v_pkg uuid; v_step_id uuid; v_blocked boolean := false;
BEGIN
  SELECT ps.package_id, ps.id INTO v_pkg, v_step_id
  FROM package_steps ps
  JOIN course_packages p ON p.id = ps.package_id
  WHERE ps.step_key = 'build_ai_tutor_index'
    AND ps.status::text NOT IN ('skipped','done')
    AND p.status IN ('queued','blocked','building')
  LIMIT 1;

  IF v_step_id IS NULL THEN
    RAISE NOTICE 'smoke: no candidate step — skipping smoke';
    RETURN;
  END IF;

  BEGIN
    UPDATE package_steps SET status='skipped'::step_status WHERE id = v_step_id;
  EXCEPTION WHEN check_violation THEN v_blocked := true;
  END;

  IF NOT v_blocked THEN
    RAISE EXCEPTION 'smoke FAILED: trigger did not block phantom skip on build_ai_tutor_index pkg=%', v_pkg;
  END IF;
  RAISE NOTICE 'smoke OK: trigger blocked phantom skip pkg=% step=%', v_pkg, v_step_id;
END $smoke$;

INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
VALUES ('pra_phantom_skip_guard_installed', 'system', 'success',
  jsonb_build_object(
    'globally_required_steps', ARRAY[
      'auto_seed_exam_blueprints','validate_blueprints',
      'generate_blueprint_variants','validate_blueprint_variants','promote_blueprint_variants',
      'generate_exam_pool','validate_exam_pool',
      'build_ai_tutor_index','validate_tutor_index',
      'run_integrity_check','quality_council','auto_publish'],
    'capability_steps', ARRAY['generate_oral_exam','validate_oral_exam'],
    'bypass', 'session GUC app.allow_required_skip=on or session_replication_role=replica',
    'note', 'PR-A root-cause stopper. PR-B (heal) follows separately.'
  ));