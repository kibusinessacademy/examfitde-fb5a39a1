
-- ═══════════════════════════════════════════════════════════════════
-- 1) BRONZE LOCK HELPER
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_is_bronze_locked(p_package_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM course_packages
     WHERE id = p_package_id
       AND (
         (feature_flags->'bronze'->>'requires_review')::boolean = true
         OR (feature_flags->'bronze'->>'repair_attempts')::int >= 1
         OR (feature_flags->'bronze'->>'final_state') IN ('requires_review','manual_review_required')
       )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.fn_is_bronze_locked(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_is_bronze_locked(uuid) TO service_role;

-- ═══════════════════════════════════════════════════════════════════
-- 2) GOVERNANCE GUARD ERWEITERN — Bronze als gültiges Ergebnis
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_guard_governance_step_finalization()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_integrity_passed boolean;
  v_job_exists boolean;
  v_meta jsonb;
  v_executed boolean;
  v_status text;
  v_verdict text;
  v_badge text;
  v_score numeric;
BEGIN
  IF NEW.status <> 'done' THEN RETURN NEW; END IF;
  IF OLD.status = 'done' THEN RETURN NEW; END IF;

  v_meta := COALESCE(NEW.meta, '{}'::jsonb);

  -- ═══ run_integrity_check (unverändert) ═══
  IF NEW.step_key = 'run_integrity_check' THEN
    SELECT EXISTS(
      SELECT 1 FROM job_queue
      WHERE job_type = 'package_run_integrity_check'
        AND package_id = NEW.package_id
        AND status = 'completed'
    ) INTO v_job_exists;

    IF NOT v_job_exists AND (v_meta->>'executed')::boolean IS DISTINCT FROM true THEN
      PERFORM fn_log_guardrail_event('governance_phantom_blocked', jsonb_build_object(
        'package_id', NEW.package_id, 'step_key', NEW.step_key,
        'reason', 'NO_COMPLETED_JOB_AND_NO_EXECUTION_EVIDENCE'));
      RAISE EXCEPTION 'GOVERNANCE GUARD: run_integrity_check cannot be done without completed job or meta.executed=true (package=%)', NEW.package_id;
    END IF;

    SELECT integrity_passed INTO v_integrity_passed FROM course_packages WHERE id = NEW.package_id;
    IF v_integrity_passed IS DISTINCT FROM true THEN
      PERFORM fn_log_guardrail_event('governance_phantom_blocked', jsonb_build_object(
        'package_id', NEW.package_id, 'step_key', NEW.step_key,
        'reason', 'INTEGRITY_NOT_PASSED', 'integrity_passed', v_integrity_passed));
      RAISE EXCEPTION 'GOVERNANCE GUARD: run_integrity_check cannot be done when integrity_passed=% (package=%)', v_integrity_passed, NEW.package_id;
    END IF;
  END IF;

  -- ═══ quality_council (Bronze-Erweiterung) ═══
  IF NEW.step_key = 'quality_council' THEN
    SELECT EXISTS(
      SELECT 1 FROM job_queue
      WHERE job_type = 'package_quality_council'
        AND package_id = NEW.package_id
        AND status = 'completed'
    ) INTO v_job_exists;

    v_executed := (v_meta->>'executed')::boolean;
    v_status   := v_meta->>'status';
    v_verdict  := v_meta->>'verdict';
    v_badge    := v_meta->>'badge';
    v_score    := NULLIF(v_meta->>'score','')::numeric;

    -- Phantom-Schutz wie bisher: kein Job UND keine Step-Evidenz → BLOCK
    IF NOT v_job_exists AND v_executed IS DISTINCT FROM true THEN
      PERFORM fn_log_guardrail_event('governance_phantom_blocked', jsonb_build_object(
        'package_id', NEW.package_id, 'step_key', NEW.step_key,
        'reason', 'NO_COMPLETED_JOB_AND_NO_EXECUTION_EVIDENCE',
        'verdict', v_verdict, 'badge', v_badge, 'score', v_score));
      RAISE EXCEPTION 'GOVERNANCE GUARD: quality_council cannot be done without completed job or meta.executed=true (package=%)', NEW.package_id;
    END IF;

    -- Drei zugelassene Outcomes:
    --   PASS         : score>=85 (alt)
    --   BRONZE       : verdict=REVIEW_REQUIRED, badge=bronze, score 75..84 (NEU)
    --   MANUAL_BYPASS: meta.bypass=true (vom Admin gesetzt)
    IF v_executed IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'GOVERNANCE GUARD: quality_council requires meta.executed=true (package=%)', NEW.package_id;
    END IF;

    IF (v_meta->>'bypass')::boolean = true THEN
      -- expliziter Admin-Bypass: erlaubt, aber als Audit-Trail
      PERFORM fn_log_guardrail_event('governance_council_admin_bypass', jsonb_build_object(
        'package_id', NEW.package_id, 'verdict', v_verdict, 'badge', v_badge, 'score', v_score));
      RETURN NEW;
    END IF;

    -- PASS-Pfad
    IF v_status = 'pass' AND v_score IS NOT NULL AND v_score >= 85 THEN
      RETURN NEW;
    END IF;

    -- BRONZE-Pfad (REVIEW_REQUIRED) — verdict + badge + score erforderlich
    IF v_verdict = 'REVIEW_REQUIRED'
       AND v_badge = 'bronze'
       AND v_score IS NOT NULL
       AND v_score >= 75 AND v_score < 85 THEN
      PERFORM fn_log_guardrail_event('governance_council_bronze_finalized', jsonb_build_object(
        'package_id', NEW.package_id, 'score', v_score, 'verdict', v_verdict));
      RETURN NEW;
    END IF;

    -- Sonst: BLOCK
    PERFORM fn_log_guardrail_event('governance_phantom_blocked', jsonb_build_object(
      'package_id', NEW.package_id, 'step_key', NEW.step_key,
      'reason', 'STEP_META_DOES_NOT_PROVE_PASS_OR_BRONZE',
      'executed', v_executed, 'status', v_status,
      'verdict', v_verdict, 'badge', v_badge, 'score', v_score));
    RAISE EXCEPTION 'GOVERNANCE GUARD: quality_council finalization requires PASS (status=pass, score>=85) or BRONZE (verdict=REVIEW_REQUIRED, badge=bronze, score 75..84). Got status=%, verdict=%, badge=%, score=% (package=%)',
      v_status, v_verdict, v_badge, v_score, NEW.package_id;
  END IF;

  RETURN NEW;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- 3) BRONZE TARGETED REPAIR DISPATCH (atomar, einmalig pro Paket)
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_bronze_targeted_repair_dispatch(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller_is_admin boolean;
  v_pkg record;
  v_council record;
  v_score numeric;
  v_badge text;
  v_verdict text;
  v_attempts int;
  v_failed_rules jsonb;
  v_repair_vector jsonb;
  v_dispatch_kind text;
  v_job_id uuid;
  v_audit_id uuid;
BEGIN
  -- Auth
  v_caller_is_admin := has_role(auth.uid(), 'admin'::app_role);
  IF NOT v_caller_is_admin AND current_setting('role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: admin role required';
  END IF;

  SELECT cp.* INTO v_pkg FROM course_packages cp WHERE cp.id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PACKAGE_NOT_FOUND: %', p_package_id;
  END IF;

  SELECT ps.* INTO v_council FROM package_steps ps
   WHERE ps.package_id = p_package_id AND ps.step_key = 'quality_council'
   ORDER BY ps.updated_at DESC LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COUNCIL_STEP_NOT_FOUND for package %', p_package_id;
  END IF;

  v_score   := NULLIF(v_council.meta->>'score','')::numeric;
  v_badge   := v_council.meta->>'badge';
  v_verdict := v_council.meta->>'verdict';

  IF v_badge IS DISTINCT FROM 'bronze' OR v_score IS NULL OR v_score < 75 OR v_score >= 85 THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'NOT_BRONZE',
      'badge', v_badge, 'score', v_score, 'verdict', v_verdict);
  END IF;

  -- Dedup: nur EIN aktiver Repair pro Paket
  v_attempts := COALESCE((v_pkg.feature_flags->'bronze'->>'repair_attempts')::int, 0);
  IF (v_pkg.feature_flags->'bronze'->>'repair_active')::boolean = true THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'REPAIR_ALREADY_ACTIVE',
      'attempts', v_attempts);
  END IF;
  IF v_attempts >= 1 THEN
    -- Terminal: nur noch requires_review setzen
    UPDATE course_packages
       SET feature_flags = jsonb_set(
             COALESCE(feature_flags,'{}'::jsonb),
             '{bronze}',
             COALESCE(feature_flags->'bronze','{}'::jsonb) || jsonb_build_object(
               'requires_review', true,
               'final_state', 'requires_review',
               'final_state_at', now(),
               'last_score', v_score
             ),
             true)
     WHERE id = p_package_id;

    INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
    VALUES ('admin_bronze_targeted_repair_dispatch','bronze_terminal_review_required',
            p_package_id::text,'package','success',
            'Bronze repair attempts >=1 → terminal requires_review',
            jsonb_build_object('package_id', p_package_id, 'score', v_score, 'attempts', v_attempts));

    RETURN jsonb_build_object('terminal', true, 'final_state', 'requires_review',
      'attempts', v_attempts, 'score', v_score);
  END IF;

  -- Repair-Vector aus Council-Meta extrahieren
  v_failed_rules  := COALESCE(v_council.meta->'failed_rules', '[]'::jsonb);
  v_repair_vector := COALESCE(v_council.meta->'repair_vector', '{}'::jsonb);

  -- Dispatch-Kind heuristisch wählen
  v_dispatch_kind := CASE
    WHEN v_repair_vector ? 'lf_coverage_gap'
         AND jsonb_array_length(COALESCE(v_repair_vector->'lf_coverage_gap','[]'::jsonb)) > 0
      THEN 'targeted_competency_fill'
    WHEN v_repair_vector ? 'weak_competencies'
         AND jsonb_array_length(COALESCE(v_repair_vector->'weak_competencies','[]'::jsonb)) > 0
      THEN 'targeted_blueprint_fill'
    ELSE 'elite_harden'
  END;

  -- Repair-Job enqueuen
  INSERT INTO job_queue (job_type, package_id, status, priority, payload, meta, enqueue_source, idempotency_key)
  VALUES (
    'package_' || v_dispatch_kind,
    p_package_id,
    'queued',
    7,
    jsonb_build_object(
      'package_id', p_package_id,
      'enqueue_source', 'bronze_targeted_repair',
      'failed_rules', v_failed_rules,
      'repair_vector', v_repair_vector,
      'bronze_attempt', v_attempts + 1,
      'origin_council_score', v_score
    ),
    jsonb_build_object('bronze_repair', true, 'attempt', v_attempts + 1),
    'bronze_targeted_repair',
    'bronze_repair:' || p_package_id::text || ':' || (v_attempts + 1)::text
  )
  RETURNING id INTO v_job_id;

  -- Bronze-State markieren
  UPDATE course_packages
     SET feature_flags = jsonb_set(
           COALESCE(feature_flags,'{}'::jsonb),
           '{bronze}',
           COALESCE(feature_flags->'bronze','{}'::jsonb) || jsonb_build_object(
             'repair_active', true,
             'repair_attempts', v_attempts + 1,
             'repair_started_at', now(),
             'repair_job_id', v_job_id,
             'repair_kind', v_dispatch_kind,
             'requires_review', false,
             'final_state', NULL
           ),
           true)
   WHERE id = p_package_id;

  INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
  VALUES ('admin_bronze_targeted_repair_dispatch','bronze_targeted_repair_dispatched',
          p_package_id::text,'package','success',
          format('Bronze repair attempt #%s dispatched: %s', v_attempts + 1, v_dispatch_kind),
          jsonb_build_object(
            'package_id', p_package_id,
            'job_id', v_job_id,
            'kind', v_dispatch_kind,
            'attempt', v_attempts + 1,
            'score', v_score,
            'failed_rules', v_failed_rules,
            'repair_vector', v_repair_vector));

  RETURN jsonb_build_object(
    'dispatched', true,
    'job_id', v_job_id,
    'kind', v_dispatch_kind,
    'attempt', v_attempts + 1,
    'score', v_score
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_bronze_targeted_repair_dispatch(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_bronze_targeted_repair_dispatch(uuid) TO service_role;

-- ═══════════════════════════════════════════════════════════════════
-- 4) BACKFILL: bestehende Bronze-Pakete bekommen requires_review=true
--    (wenn noch kein Repair stattgefunden hat → final_state=requires_review,
--     da wir keinen retroaktiven Repair erzwingen wollen)
-- ═══════════════════════════════════════════════════════════════════
WITH bronze_pkgs AS (
  SELECT DISTINCT cp.id, ps.meta->>'score' AS score
    FROM course_packages cp
    JOIN package_steps ps ON ps.package_id = cp.id AND ps.step_key = 'quality_council'
   WHERE ps.meta->>'badge' = 'bronze'
     AND NULLIF(ps.meta->>'score','')::numeric BETWEEN 75 AND 84
     AND COALESCE((cp.feature_flags->'bronze'->>'requires_review')::boolean, false) = false
)
UPDATE course_packages cp
   SET feature_flags = jsonb_set(
         COALESCE(cp.feature_flags,'{}'::jsonb),
         '{bronze}',
         COALESCE(cp.feature_flags->'bronze','{}'::jsonb) || jsonb_build_object(
           'requires_review', true,
           'final_state', 'requires_review',
           'final_state_at', now(),
           'backfilled', true,
           'backfill_at', now(),
           'last_score', NULLIF(bp.score,'')::numeric
         ),
         true)
  FROM bronze_pkgs bp
 WHERE cp.id = bp.id;

INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
SELECT 'bronze_backfill_2026_05_04','bronze_backfill_requires_review',
       cp.id::text,'package','success',
       'Backfill: Bronze package marked requires_review=true (no retroactive repair).',
       jsonb_build_object('package_id', cp.id, 'title', cp.title,
         'score', cp.feature_flags->'bronze'->>'last_score')
  FROM course_packages cp
 WHERE (cp.feature_flags->'bronze'->>'backfilled')::boolean = true
   AND (cp.feature_flags->'bronze'->>'backfill_at')::timestamptz > now() - interval '5 minutes';

COMMENT ON FUNCTION public.fn_is_bronze_locked(uuid) IS
  'Bronze-Lock-Check für Watchdog/Reconciler/Heal-Playbook. TRUE = Paket nicht automatisch requeuen.';
COMMENT ON FUNCTION public.admin_bronze_targeted_repair_dispatch(uuid) IS
  'Atomarer Einmal-Dispatch eines Bronze-Repair-Jobs (targeted_competency_fill / targeted_blueprint_fill / elite_harden). Dedup über feature_flags.bronze.repair_active. Nach 1 Versuch terminal requires_review.';
