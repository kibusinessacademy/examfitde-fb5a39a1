-- 0) Pre-Sanitize: invalide blocked_reasons in course_packages
UPDATE public.course_packages
SET blocked_reason = 'other:' || left(blocked_reason, 200)
WHERE blocked_reason IS NOT NULL
  AND blocked_reason NOT IN ('admin_hold','content_gap','manual_review_required','compliance_hold','pipeline_repair_required','awaiting_source_data','intentional_pause','missing_exam_pool','missing_handbook','auto_heal_zombie','governance_backfill_unknown')
  AND blocked_reason NOT LIKE 'other:%';

-- 1) Hollow-Done-Guard erweitern
CREATE OR REPLACE FUNCTION public.fn_guard_hollow_done()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE
  v_critical_steps text[] := ARRAY[
    'generate_learning_content','generate_exam_pool','generate_handbook',
    'generate_lesson_minichecks','generate_oral_exam','build_ai_tutor_index',
    'auto_seed_exam_blueprints'
  ];
  v_blueprint_count integer;
  v_curriculum_id uuid;
BEGIN
  IF NEW.status='done' AND (OLD.status IS DISTINCT FROM 'done') THEN
    IF NEW.step_key='auto_seed_exam_blueprints' THEN
      SELECT cp.curriculum_id INTO v_curriculum_id
        FROM public.course_packages cp WHERE cp.id=NEW.package_id;
      SELECT COUNT(*) INTO v_blueprint_count
        FROM public.exam_blueprints WHERE curriculum_id=v_curriculum_id;
      IF COALESCE(v_blueprint_count,0)=0 THEN
        RAISE EXCEPTION
          'NON_BYPASSABLE_HOLLOW_DONE: auto_seed_exam_blueprints cannot be done with 0 blueprints (package_id=%, curriculum_id=%). No bypass allowed.',
          NEW.package_id, v_curriculum_id
        USING ERRCODE='check_violation';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.step_key=ANY(v_critical_steps) THEN
      IF COALESCE((NEW.meta->>'postcondition_verified')::boolean,false) THEN RETURN NEW; END IF;
      IF COALESCE((NEW.meta->>'allow_regression')::boolean,false) THEN RETURN NEW; END IF;
      IF COALESCE(NEW.exception_approved,false) THEN RETURN NEW; END IF;
      RAISE EXCEPTION 'HOLLOW_DONE_BLOCKED: step "%" cannot transition to done without postcondition_verified=true.', NEW.step_key;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- 2) Track-Migration
UPDATE public.course_packages
SET track='EXAM_FIRST_PLUS'::product_track, updated_at=now()
WHERE upper(coalesce(track::text,'')) IN ('ZERTIFIKAT','BRANCHENZERTIFIKAT');

-- 3) False-Done Reset Seed-Step
WITH hollow_seed AS (
  SELECT ps.package_id
  FROM public.package_steps ps
  JOIN public.course_packages cp ON cp.id=ps.package_id
  LEFT JOIN public.exam_blueprints eb ON eb.curriculum_id=cp.curriculum_id
  WHERE ps.step_key='auto_seed_exam_blueprints' AND ps.status='done'
  GROUP BY ps.package_id HAVING COUNT(eb.id)=0
)
UPDATE public.package_steps ps
SET status='queued', started_at=NULL, finished_at=NULL, last_error=NULL, updated_at=now(),
    meta=COALESCE(ps.meta,'{}'::jsonb)
      - 'done_reason' - 'finalized_by' - 'executed' - 'postcondition_verified'
      || jsonb_build_object(
        'reset_reason','false_done_seed_without_blueprints',
        'reset_at',now(),'wave',7,
        'allow_regression',true,'allow_regression_by','ops_force_reset')
FROM hollow_seed hs
WHERE ps.package_id=hs.package_id AND ps.step_key='auto_seed_exam_blueprints';

-- 4) Downstream-Reset
UPDATE public.package_steps ps
SET status='queued', started_at=NULL, finished_at=NULL, last_error=NULL, updated_at=now(),
    meta=COALESCE(ps.meta,'{}'::jsonb)
      - 'done_reason' - 'finalized_by' - 'executed' - 'postcondition_verified'
      || jsonb_build_object(
        'reset_reason','upstream_seed_false_done_repair',
        'reset_at',now(),'wave',7,
        'allow_regression',true,'allow_regression_by','ops_force_reset')
WHERE ps.package_id IN (
  SELECT ps2.package_id FROM public.package_steps ps2
  WHERE ps2.step_key='auto_seed_exam_blueprints'
    AND ps2.status='queued'
    AND (ps2.meta->>'reset_reason')='false_done_seed_without_blueprints'
)
AND ps.step_key IN (
  'validate_blueprints','generate_blueprint_variants','validate_blueprint_variants',
  'promote_blueprint_variants','generate_exam_pool','validate_exam_pool',
  'repair_exam_pool_quality','repair_exam_pool_competency_coverage','repair_exam_pool_lf_coverage'
)
AND ps.status IN ('done','failed','blocked','skipped');

-- 5) Audit
INSERT INTO public.admin_actions(action, scope, payload)
VALUES (
  'legacy_track_repair_zertifikat_to_exam_first_plus_v1','pipeline',
  jsonb_build_object(
    'wave',7,
    'guard_extended','fn_guard_hollow_done now covers auto_seed_exam_blueprints (non-bypassable)',
    'track_migration','ZERTIFIKAT/BRANCHENZERTIFIKAT → EXAM_FIRST_PLUS',
    'timestamp',now()));