-- =====================================================================
-- Tail-Orchestration-Audit + Harte SSOT-Payload-Validierung v1
-- =====================================================================
-- Findings (24h):
--   - 615 completed package_generate_exam_pool ohne package_id
--   - 2766 Tail-Jobs ohne step_key
--   - 3982 Jobs ohne enqueue_source (warn-only, nicht durchgesetzt)
--   - assert_job_payload prüft nur curriculum_id, nicht package_id/step_key
--   - fn_atomic_enqueue_on_step_queued schreibt step_key NICHT in payload
--   - ~40 Funktionen INSERTen direkt in job_queue (umgehen Guard)
--
-- Fix:
--   1) assert_job_payload erweitern (package_id + step_key Pflicht für package_*-Jobs)
--   2) BEFORE INSERT Trigger trg_job_queue_ssot_validate (fängt ALLE Producer)
--   3) fn_atomic_enqueue_on_step_queued: step_key in payload schreiben
--   4) fn_heal_assert_payload(): SECURITY DEFINER RPC für Heal-Pfade, fail-closed
--   5) View v_ssot_payload_violations für Forensik
--   6) Phase 1: warn-only bis 2026-05-09 (parallel zur enqueue_source-Phase)
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1) assert_job_payload erweitern
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assert_job_payload(job jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_job_type text;
  v_payload jsonb;
BEGIN
  IF NOT (job ? 'payload') THEN
    RAISE EXCEPTION 'SSOT VIOLATION: job payload missing entirely';
  END IF;
  v_payload := job->'payload';
  v_job_type := COALESCE(job->>'job_type', '<unknown>');

  -- curriculum_id Pflicht (immer)
  IF NOT (v_payload ? 'curriculum_id') OR NULLIF(v_payload->>'curriculum_id','') IS NULL THEN
    RAISE EXCEPTION 'SSOT VIOLATION: job % (id=%) missing curriculum_id',
      v_job_type, COALESCE(job->>'id','?');
  END IF;

  -- package_id Pflicht für alle package_*-Jobs
  IF v_job_type LIKE 'package_%' THEN
    IF NOT (v_payload ? 'package_id') OR NULLIF(v_payload->>'package_id','') IS NULL THEN
      RAISE EXCEPTION 'SSOT VIOLATION: job % (id=%) missing package_id',
        v_job_type, COALESCE(job->>'id','?');
    END IF;
    -- step_key Pflicht für package_*-Jobs (außer Top-Level Trigger ohne Step-Bezug)
    IF NOT (v_payload ? 'step_key') OR NULLIF(v_payload->>'step_key','') IS NULL THEN
      RAISE EXCEPTION 'SSOT VIOLATION: job % (id=%) missing step_key',
        v_job_type, COALESCE(job->>'id','?');
    END IF;
  END IF;

  -- Verbotene Slug-Felder
  IF v_payload ? 'slug' OR v_payload ? 'profession_slug'
     OR v_payload ? 'curriculum_slug' OR v_payload ? 'curriculumCode' THEN
    RAISE EXCEPTION 'SSOT VIOLATION: slug fields detected in job %', v_job_type;
  END IF;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────
-- 2) BEFORE INSERT Trigger auf job_queue (single chokepoint)
--    Phase 1: warn-only bis 2026-05-09 (parallel zur enqueue_source enforce phase)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_job_queue_ssot_validate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_enforce_at timestamptz := '2026-05-09 00:00:00+00'::timestamptz;
  v_enforce boolean := now() >= v_enforce_at;
  v_violations text[] := ARRAY[]::text[];
  v_step_key text;
BEGIN
  -- Skip system-internal job types ohne package_id requirement
  IF NEW.job_type NOT LIKE 'package_%' THEN
    RETURN NEW;
  END IF;

  -- 1) curriculum_id Pflicht
  IF NEW.payload IS NULL OR NULLIF(NEW.payload->>'curriculum_id','') IS NULL THEN
    v_violations := v_violations || 'missing_curriculum_id';
  END IF;

  -- 2) package_id Pflicht (sowohl in column als auch in payload)
  IF NEW.package_id IS NULL THEN
    v_violations := v_violations || 'missing_package_id_column';
  END IF;
  IF NULLIF(NEW.payload->>'package_id','') IS NULL THEN
    v_violations := v_violations || 'missing_package_id_payload';
  END IF;

  -- 3) step_key Pflicht (oder ableitbar aus job_type)
  v_step_key := COALESCE(NEW.payload->>'step_key', NEW.payload->>'step', NEW.payload->>'target_step');
  IF v_step_key IS NULL OR v_step_key = '' THEN
    -- Auto-derive für package_*-Jobs falls fehlend (warn aber repariere)
    v_step_key := regexp_replace(NEW.job_type, '^package_', '');
    NEW.payload := COALESCE(NEW.payload, '{}'::jsonb) || jsonb_build_object('step_key', v_step_key);
    v_violations := v_violations || 'auto_derived_step_key';
  END IF;

  -- 4) Slug-Verbot
  IF NEW.payload ? 'slug' OR NEW.payload ? 'profession_slug'
     OR NEW.payload ? 'curriculum_slug' OR NEW.payload ? 'curriculumCode' THEN
    v_violations := v_violations || 'forbidden_slug_field';
  END IF;

  IF array_length(v_violations,1) > 0 THEN
    INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id,
                                     result_status, result_detail, metadata)
    VALUES (
      CASE WHEN v_enforce THEN 'ssot_payload_blocked' ELSE 'ssot_payload_warn' END,
      'trg_job_queue_ssot_validate', 'job', COALESCE(NEW.package_id::text,'null'),
      CASE WHEN v_enforce THEN 'rejected' ELSE 'warn' END,
      format('Job %s violations: %s', NEW.job_type, array_to_string(v_violations,',')),
      jsonb_build_object(
        'job_type', NEW.job_type,
        'package_id', NEW.package_id,
        'violations', v_violations,
        'enqueue_source', NEW.payload->>'enqueue_source',
        'phase', CASE WHEN v_enforce THEN 'enforce' ELSE 'warn' END
      )
    );
    -- Hard-Block nur bei kritischen Violations (nicht bei auto_derived_step_key)
    IF v_enforce AND (
       'missing_curriculum_id' = ANY(v_violations)
       OR 'missing_package_id_column' = ANY(v_violations)
       OR 'missing_package_id_payload' = ANY(v_violations)
       OR 'forbidden_slug_field' = ANY(v_violations)
    ) THEN
      RAISE EXCEPTION 'SSOT VIOLATION (job_queue insert blocked): % | %',
        NEW.job_type, array_to_string(v_violations,',');
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_job_queue_ssot_validate ON public.job_queue;
CREATE TRIGGER trg_job_queue_ssot_validate
BEFORE INSERT ON public.job_queue
FOR EACH ROW
EXECUTE FUNCTION public.fn_job_queue_ssot_validate();

-- ─────────────────────────────────────────────────────────────────────
-- 3) fn_atomic_enqueue_on_step_queued: step_key in payload schreiben
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_atomic_enqueue_on_step_queued()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_curriculum_id uuid;
  v_job_type text;
  v_existing_active int;
  v_recent_done int;
  v_is_applicable boolean;
BEGIN
  IF NOT (NEW.status = 'queued'::step_status AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'queued'::step_status)) THEN
    RETURN NEW;
  END IF;

  IF NEW.meta ? 'last_atomic_enqueue_at'
     AND (NEW.meta->>'last_atomic_enqueue_at')::timestamptz > now() - interval '30 seconds' THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_recent_done
  FROM auto_heal_log
  WHERE action_type IN ('step_finalized_done','step_finalized_skipped')
    AND target_id = NEW.id::text
    AND created_at > now() - interval '5 minutes';
  IF v_recent_done > 0 THEN
    INSERT INTO auto_heal_log(action_type,trigger_source,result_status,result_detail,target_type,target_id)
    VALUES ('pattern_x10_phantom_atomic_blocked','trg_atomic_enqueue_on_step_queued','blocked',
            jsonb_build_object('package_id',NEW.package_id,'step_key',NEW.step_key,
                               'reason','step recently finalized → phantom re-enqueue blocked')::text,
            'package_step', NEW.id::text);
    RETURN NEW;
  END IF;

  v_is_applicable := public.fn_is_step_applicable_for_package(NEW.package_id, NEW.step_key);
  IF v_is_applicable IS FALSE THEN
    NEW.status := 'skipped'::step_status;
    NEW.meta := COALESCE(NEW.meta,'{}'::jsonb) || jsonb_build_object(
      'skipped_reason','TRACK_NOT_APPLICABLE',
      'pattern_x7_auto_skip_at', now()
    );
    INSERT INTO auto_heal_log(action_type,trigger_source,result_status,result_detail,target_type,target_id)
    VALUES ('pattern_x7_auto_reskip','trg_atomic_enqueue_on_step_queued','done',
            jsonb_build_object('package_id',NEW.package_id,'step_key',NEW.step_key)::text,
            'package_step', NEW.id::text);
    RETURN NEW;
  END IF;

  SELECT curriculum_id INTO v_curriculum_id FROM course_packages WHERE id=NEW.package_id;
  v_job_type := 'package_'||NEW.step_key::text;

  -- Fail-loud wenn curriculum_id fehlt — keine still verschwindenden Payloads mehr
  IF v_curriculum_id IS NULL THEN
    INSERT INTO auto_heal_log(action_type,trigger_source,result_status,result_detail,target_type,target_id, metadata)
    VALUES ('atomic_enqueue_missing_curriculum','trg_atomic_enqueue_on_step_queued','rejected',
            'Cannot enqueue '||v_job_type||' — package missing curriculum_id',
            'package_step', NEW.id::text,
            jsonb_build_object('package_id',NEW.package_id,'step_key',NEW.step_key));
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_existing_active FROM job_queue
  WHERE package_id=NEW.package_id AND job_type=v_job_type
    AND status IN ('pending','queued','processing','running','batch_pending');
  IF v_existing_active > 0 THEN RETURN NEW; END IF;

  -- KEY FIX: step_key in payload schreiben (war vorher fehlend → 2766 Violations/24h)
  INSERT INTO job_queue(job_type,payload,status,max_attempts,priority,package_id,meta)
  VALUES(v_job_type,
    jsonb_build_object(
      'package_id', NEW.package_id,
      'curriculum_id', v_curriculum_id,
      'step_key', NEW.step_key::text,
      'enqueue_source','trg_atomic_enqueue'
    ),
    'pending',8,50,NEW.package_id,
    jsonb_build_object('source','atomic_step_enqueue','enqueue_source','trg_atomic_enqueue','enqueued_at',now())
  );

  NEW.meta := COALESCE(NEW.meta,'{}'::jsonb) || jsonb_build_object('last_atomic_enqueue_at',now());
  RETURN NEW;
END $function$;

-- ─────────────────────────────────────────────────────────────────────
-- 4) Heal-Helper: fn_heal_assert_payload (für Heal-RPCs explizit aufrufbar)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_heal_assert_payload(
  p_job_type text,
  p_package_id uuid,
  p_curriculum_id uuid,
  p_step_key text,
  p_enqueue_source text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_violations text[] := ARRAY[]::text[];
BEGIN
  IF p_job_type IS NULL OR p_job_type = '' THEN v_violations := v_violations || 'missing_job_type'; END IF;
  IF p_package_id IS NULL THEN v_violations := v_violations || 'missing_package_id'; END IF;
  IF p_curriculum_id IS NULL THEN v_violations := v_violations || 'missing_curriculum_id'; END IF;
  IF p_job_type LIKE 'package_%' AND (p_step_key IS NULL OR p_step_key = '') THEN
    v_violations := v_violations || 'missing_step_key';
  END IF;
  IF p_enqueue_source IS NULL OR p_enqueue_source = '' THEN
    v_violations := v_violations || 'missing_enqueue_source';
  END IF;

  IF array_length(v_violations,1) > 0 THEN
    INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id,
                              result_status, result_detail, metadata)
    VALUES ('heal_assert_payload_failed', COALESCE(p_enqueue_source,'<unknown>'), 'job',
            COALESCE(p_package_id::text,'null'), 'rejected',
            format('Heal payload incomplete for %s: %s', p_job_type, array_to_string(v_violations,',')),
            jsonb_build_object('job_type',p_job_type,'package_id',p_package_id,
                               'curriculum_id',p_curriculum_id,'step_key',p_step_key,
                               'violations',v_violations));
    RAISE EXCEPTION 'HEAL SSOT VIOLATION (% / pkg=%): %',
      p_job_type, p_package_id, array_to_string(v_violations,',');
  END IF;

  RETURN jsonb_build_object('valid',true,'job_type',p_job_type,'package_id',p_package_id);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────
-- 5) Forensik-View
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_ssot_payload_violations AS
SELECT
  date_trunc('hour', created_at) AS hour_bucket,
  metadata->>'job_type' AS job_type,
  result_status,
  COUNT(*) AS n,
  COUNT(DISTINCT (metadata->>'package_id')) AS distinct_pkgs,
  (array_agg(DISTINCT (metadata->'violations')::text))[1:5] AS sample_violations,
  (array_agg(DISTINCT COALESCE(metadata->>'enqueue_source','<missing>')))[1:5] AS sources
FROM public.auto_heal_log
WHERE action_type IN ('ssot_payload_warn','ssot_payload_blocked',
                      'enqueue_source_missing_warn','enqueue_source_missing_blocked',
                      'heal_assert_payload_failed','atomic_enqueue_missing_curriculum')
  AND created_at > now() - interval '7 days'
GROUP BY 1,2,3
ORDER BY 1 DESC, n DESC;

REVOKE ALL ON public.v_ssot_payload_violations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_ssot_payload_violations TO service_role;

-- Admin RPC
CREATE OR REPLACE FUNCTION public.admin_get_ssot_payload_violations(
  p_hours integer DEFAULT 24
) RETURNS SETOF public.v_ssot_payload_violations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;
  RETURN QUERY
  SELECT * FROM public.v_ssot_payload_violations
  WHERE hour_bucket > now() - (p_hours || ' hours')::interval
  ORDER BY hour_bucket DESC, n DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_ssot_payload_violations(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_ssot_payload_violations(integer) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 6) Initial-Audit Snapshot
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id,
                                 result_status, result_detail, metadata)
VALUES (
  'tail_orchestration_audit_v1', 'migration_2026_05_02', 'system', 'global',
  'done',
  'Tail-Orchestration-Audit + harte SSOT-Payload-Validierung deployed. Phase 1 (warn-only) bis 2026-05-09, danach hard-block.',
  jsonb_build_object(
    'audit_findings_24h', jsonb_build_object(
      'completed_exam_pool_no_pkg_id', 615,
      'tail_jobs_no_step_key', 2766,
      'jobs_no_enqueue_source', 3982
    ),
    'fixes_applied', jsonb_build_array(
      'assert_job_payload_extended_pkg_step',
      'before_insert_trigger_chokepoint',
      'atomic_enqueue_step_key_in_payload',
      'fn_heal_assert_payload_fail_loud'
    ),
    'enforce_at', '2026-05-09T00:00:00Z'
  )
);