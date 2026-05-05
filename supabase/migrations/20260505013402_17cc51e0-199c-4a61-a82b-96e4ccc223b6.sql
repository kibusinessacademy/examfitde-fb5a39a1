-- ----- FIX 1: Bronze-Guard erweitert auf integrity_check -----
CREATE OR REPLACE FUNCTION public.fn_guard_bronze_lock_on_job_enqueue()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_locked boolean; v_source text; v_pkg_id uuid;
BEGIN
  IF NEW.job_type NOT IN ('package_quality_council','package_auto_publish','package_run_integrity_check') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IN ('queued','pending','processing') AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  IF NEW.status NOT IN ('queued','pending','processing') THEN RETURN NEW; END IF;
  v_pkg_id := COALESCE(NEW.package_id, NULLIF(NEW.payload->>'package_id','')::uuid);
  IF v_pkg_id IS NULL THEN RETURN NEW; END IF;
  SELECT public.fn_is_bronze_locked(v_pkg_id) INTO v_locked;
  IF NOT v_locked THEN RETURN NEW; END IF;
  v_source := COALESCE(
    NEW.payload->>'enqueue_source', NEW.meta->>'enqueue_source',
    NEW.meta->>'source', NEW.payload->>'source',
    NEW.payload->>'_origin', NEW.payload->>'mode', 'unknown');
  IF v_source = 'bronze_targeted_repair' THEN RETURN NEW; END IF;
  IF (NEW.payload->>'bronze_lock_override')::boolean = true THEN
    INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
    VALUES ('fn_guard_bronze_lock_on_job_enqueue','bronze_lock_admin_override',
            v_pkg_id::text,'package','success',
            format('Admin override: %s', NEW.job_type),
            jsonb_build_object('package_id', v_pkg_id, 'job_type', NEW.job_type, 'enqueue_source', v_source));
    RETURN NEW;
  END IF;
  INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
  VALUES ('fn_guard_bronze_lock_on_job_enqueue','bronze_locked_enqueue_blocked',
          v_pkg_id::text,'package','skipped',
          format('Bronze lock — %s rejected (source=%s)', NEW.job_type, v_source),
          jsonb_build_object('package_id', v_pkg_id, 'job_type', NEW.job_type,
            'enqueue_source', v_source, 'tg_op', TG_OP, 'skipped_reason','BRONZE_LOCKED_REQUIRES_REVIEW'));
  IF TG_OP = 'INSERT' THEN
    RETURN NULL;
  ELSE
    NEW.status := 'cancelled';
    NEW.completed_at := COALESCE(NEW.completed_at, now());
    NEW.last_error := 'BRONZE_LOCKED_REQUIRES_REVIEW';
    NEW.result := COALESCE(NEW.result, '{}'::jsonb) || jsonb_build_object(
      'cancelled_by','bronze_lock_guard','reason','BRONZE_LOCKED_REQUIRES_REVIEW',
      'enqueue_source', v_source);
    RETURN NEW;
  END IF;
END;
$function$;

UPDATE job_queue
SET status='cancelled', completed_at=now(),
    last_error='BRONZE_LOCKED_REQUIRES_REVIEW: cluster_b_v1 retro'
WHERE job_type='package_run_integrity_check'
  AND status IN ('pending','queued','processing')
  AND package_id IN (SELECT id FROM course_packages WHERE fn_is_bronze_locked(id));

INSERT INTO auto_heal_log (trigger_source, action_type, target_type, result_status, result_detail, metadata)
VALUES ('cluster_b_targeted_heal_v1','bronze_guard_extended_to_integrity','system','success',
        'integrity_check now in bronze guard scope', jsonb_build_object('version','phase_2b'));

-- ----- FIX 2: Stanz + 4 Phantom-Pakete zu Bronze -----
UPDATE course_packages cp
SET feature_flags = COALESCE(feature_flags,'{}'::jsonb) || jsonb_build_object(
      'bronze', jsonb_build_object(
        'reason', CASE WHEN cp.id='c83f2003-3324-47bb-bd1b-3843c69303bb'::uuid
                       THEN 'coverage_gap_below_track_threshold'
                       ELSE 'dormant_phantom_no_integrity_run' END,
        'final_state','requires_review','requires_review',true,
        'source','cluster_b_targeted_heal_v1','locked_at', now()::text)),
    updated_at=now()
WHERE cp.id = ANY(ARRAY[
  'c83f2003-3324-47bb-bd1b-3843c69303bb'::uuid,
  '262affd2-8c03-4700-adaa-419101a1a1f5'::uuid,
  '277a17e2-c91b-46e6-9313-439bdcf47cec'::uuid,
  'd2000000-0011-4000-8000-000000000001'::uuid,
  'f21a9114-bdb3-4433-8b11-895a33700c26'::uuid
]);

UPDATE package_steps SET status='skipped',
    last_error='cluster_b_v1: bronze classified',
    updated_at=now()
WHERE package_id='c83f2003-3324-47bb-bd1b-3843c69303bb'
  AND step_key='auto_publish' AND status='failed';

INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
SELECT 'cluster_b_targeted_heal_v1','bronze_classify',
       pkg_id::text,'package','success',
       reason,
       jsonb_build_object('package_id', pkg_id, 'reason', reason)
FROM (VALUES
  ('c83f2003-3324-47bb-bd1b-3843c69303bb'::uuid, 'coverage_gap_75.7_below_80'),
  ('262affd2-8c03-4700-adaa-419101a1a1f5'::uuid, 'dormant_phantom_no_integrity_run'),
  ('277a17e2-c91b-46e6-9313-439bdcf47cec'::uuid, 'dormant_phantom_no_integrity_run'),
  ('d2000000-0011-4000-8000-000000000001'::uuid, 'dormant_phantom_no_integrity_run'),
  ('f21a9114-bdb3-4433-8b11-895a33700c26'::uuid, 'dormant_phantom_no_integrity_run')
) AS t(pkg_id, reason);

INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
VALUES ('cluster_b_targeted_heal_v1','dormant_phantom_audit_only',
        'a9f19137-a004-4850-838a-bdc8f8a705f5','package','skipped',
        'AUSBILDUNG_VOLL: didaktik 2/4 done — needs separate decision',
        jsonb_build_object('didaktik_done',2));

-- ----- FIX 3: 2 Cooldown-Pakete heilen -----
UPDATE job_queue
SET status='cancelled', completed_at=now(),
    last_error='cluster_b_v1: NEVER_PICKED_UP cooldown reset'
WHERE job_type='package_auto_publish'
  AND status IN ('processing','pending','queued')
  AND package_id IN ('9c1b3734-bb25-4986-baef-5bb1c20a212c','fd1d8192-a16f-496b-80c8-5e06f70ec21a');

UPDATE package_steps SET status='queued', last_error=NULL, updated_at=now()
WHERE package_id IN ('9c1b3734-bb25-4986-baef-5bb1c20a212c','fd1d8192-a16f-496b-80c8-5e06f70ec21a')
  AND step_key='auto_publish';

INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
SELECT 'cluster_b_targeted_heal_v1','cooldown_dedup_reset',
       pkg_id::text,'package','success',
       'auto_publish: cooldown cleared',
       jsonb_build_object('package_id', pkg_id)
FROM (VALUES
  ('9c1b3734-bb25-4986-baef-5bb1c20a212c'::uuid),
  ('fd1d8192-a16f-496b-80c8-5e06f70ec21a'::uuid)
) AS t(pkg_id);
