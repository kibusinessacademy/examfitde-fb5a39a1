-- ════════════════════════════════════════════════════════════════════
-- Wave-6: SSOT-Klassifikation + Cluster-isolierte Heal-Engine
-- ════════════════════════════════════════════════════════════════════

-- Drop old signatures first to avoid return-type conflicts
DROP FUNCTION IF EXISTS public.admin_recommend_queue_actions() CASCADE;
DROP FUNCTION IF EXISTS public.admin_get_queue_health_score() CASCADE;
DROP FUNCTION IF EXISTS public.admin_execute_recommended_action(text, integer) CASCADE;
DROP FUNCTION IF EXISTS public.admin_execute_recommended_action(text, integer, boolean) CASCADE;
DROP FUNCTION IF EXISTS public.fn_auto_heal_failed_clusters(integer, boolean) CASCADE;
DROP FUNCTION IF EXISTS public.fn_auto_heal_cluster(text, integer, boolean) CASCADE;
DROP FUNCTION IF EXISTS public.admin_resolve_repair_strategy_for_package(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.fn_classify_unclassified_subcluster(text, jsonb) CASCADE;
DROP VIEW IF EXISTS public.v_admin_queue_job_classification CASCADE;

-- ── 1. UNCLASSIFIED Subcluster-Klassifikator ──
CREATE FUNCTION public.fn_classify_unclassified_subcluster(_err text, _meta jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _err IS NULL OR _err = '' THEN 'UNCLASSIFIED_EMPTY'
    WHEN _meta ? 'error_class' OR _meta ? 'error_code' OR _meta ? 'classification_hint' THEN 'UNCLASSIFIED_RECLASSIFIABLE'
    WHEN _err ~* 'timeout|timed[_ ]out|deadline|temporarily|temp.*unavailable|503|502|504|retry|transient|lease|stale' THEN 'UNCLASSIFIED_TRANSIENT'
    WHEN _err ~* 'rate[_ ]?limit|429|too many requests|throttle' THEN 'UNCLASSIFIED_TRANSIENT'
    WHEN _err ~* 'connection|ECONN|ETIMEDOUT|network|socket' THEN 'UNCLASSIFIED_TRANSIENT'
    WHEN _err ~* 'constraint|null value|invalid input|payload|schema|access denied|forbidden|causality|no curriculum|no blueprints|no effect|guard_violation' THEN 'UNCLASSIFIED_STRUCTURAL'
    ELSE 'UNCLASSIFIED_UNKNOWN'
  END
$$;

-- ── 2. SSOT-Klassifikations-View ──
CREATE VIEW public.v_admin_queue_job_classification AS
WITH base AS (
  SELECT
    q.id, q.job_type, q.status, q.package_id, q.attempts, q.max_attempts,
    q.last_error, q.error, q.meta, q.updated_at, q.created_at, q.lane,
    public.fn_classify_job_error(COALESCE(NULLIF(q.last_error,''), q.error)) AS error_class,
    COALESCE(NULLIF(q.last_error,''), q.error) AS effective_error_text
  FROM public.job_queue q
  WHERE q.status = 'failed'
),
enriched AS (
  SELECT b.*,
    CASE WHEN b.error_class IN ('UNCLASSIFIED','OTHER') OR b.error_class IS NULL
         THEN public.fn_classify_unclassified_subcluster(b.effective_error_text, b.meta)
         ELSE NULL END AS subcluster,
    COALESCE((b.meta->>'admin_terminal')::boolean, false) AS is_admin_terminal,
    COALESCE((b.meta->>'retry_path_terminal')::boolean, false) AS is_retry_path_terminal
  FROM base b
)
SELECT
  e.id, e.job_type, e.status, e.package_id, e.attempts, e.max_attempts,
  e.last_error, e.error_class, e.subcluster, e.meta, e.updated_at, e.created_at, e.lane,
  COALESCE(e.error_class, e.subcluster, 'UNCLASSIFIED_UNKNOWN') AS cluster,
  CASE
    WHEN e.is_admin_terminal THEN 'NONE'
    WHEN e.error_class = 'STALE_LOCK_LOOP_HARD_KILL' THEN 'SAFE'
    WHEN e.error_class IN ('TIMEOUT','RATE_LIMIT','NETWORK_ERROR','WATCHDOG_RECOVERY') THEN 'LOW'
    WHEN e.subcluster IN ('UNCLASSIFIED_TRANSIENT','UNCLASSIFIED_RECLASSIFIABLE') THEN 'LOW'
    WHEN e.error_class IN ('REPAIR_COMPETENCY_COVERAGE','REPAIR_BLUEPRINT','COOLDOWN_ACTIVE','WIP_LIMIT','NON_BUILDING_PACKAGE') THEN 'MEDIUM'
    WHEN e.error_class = 'REQUEUE_LOOP_KILLED' THEN 'HIGH'
    WHEN e.error_class IN ('HARD_FAIL_NO_CURRICULUM','HARD_FAIL_NO_BLUEPRINTS','HARD_FAIL_REPAIR_EXHAUSTED','HARD_FAIL_BREAKER','QUALITY_THRESHOLD_NOT_MET','INTEGRITY_FAIL','DB_CONSTRAINT','PARSE_ERROR','AUTH_ERROR') THEN 'HIGH'
    WHEN e.subcluster = 'UNCLASSIFIED_STRUCTURAL' THEN 'HIGH'
    ELSE 'MEDIUM'
  END AS risk_level,
  CASE
    WHEN e.is_admin_terminal THEN false
    WHEN e.error_class = 'STALE_LOCK_LOOP_HARD_KILL' THEN true
    WHEN e.error_class IN ('TIMEOUT','RATE_LIMIT','NETWORK_ERROR','WATCHDOG_RECOVERY','COOLDOWN_ACTIVE','WIP_LIMIT') THEN true
    WHEN e.subcluster IN ('UNCLASSIFIED_TRANSIENT','UNCLASSIFIED_RECLASSIFIABLE') THEN true
    WHEN e.error_class = 'REPAIR_COMPETENCY_COVERAGE' THEN true
    ELSE false
  END AS retryable,
  (e.is_admin_terminal OR e.error_class IN ('REQUEUE_LOOP_KILLED','HARD_FAIL_REPAIR_EXHAUSTED','HARD_FAIL_BREAKER')) AS is_terminal,
  e.is_admin_terminal,
  e.is_retry_path_terminal,
  CASE
    WHEN e.is_admin_terminal THEN 'no_action_terminal'
    WHEN e.error_class = 'STALE_LOCK_LOOP_HARD_KILL' THEN 'reset_to_pending'
    WHEN e.error_class IN ('TIMEOUT','RATE_LIMIT','NETWORK_ERROR','WATCHDOG_RECOVERY') THEN 'soft_retry_with_backoff'
    WHEN e.subcluster = 'UNCLASSIFIED_TRANSIENT' THEN 'soft_retry_capped'
    WHEN e.subcluster = 'UNCLASSIFIED_RECLASSIFIABLE' THEN 'reclassify_then_retry'
    WHEN e.subcluster = 'UNCLASSIFIED_STRUCTURAL' THEN 'manual_review_required'
    WHEN e.error_class = 'REPAIR_COMPETENCY_COVERAGE' THEN 'resolve_repair_strategy'
    WHEN e.error_class = 'REQUEUE_LOOP_KILLED' THEN 'mark_retry_path_terminal'
    WHEN e.error_class IN ('HARD_FAIL_NO_CURRICULUM','HARD_FAIL_NO_BLUEPRINTS') THEN 'manual_review_required'
    WHEN e.error_class IN ('COOLDOWN_ACTIVE','WIP_LIMIT','NON_BUILDING_PACKAGE') THEN 'park_and_retry_later'
    ELSE 'manual_review_required'
  END AS recommended_strategy,
  CASE
    WHEN e.error_class = 'STALE_LOCK_LOOP_HARD_KILL' THEN 'job_instance'
    WHEN e.error_class = 'REPAIR_COMPETENCY_COVERAGE' THEN 'package_step'
    WHEN e.error_class = 'REQUEUE_LOOP_KILLED' THEN 'job_type_for_package'
    ELSE 'job_instance'
  END AS strategy_scope,
  CASE
    WHEN e.is_admin_terminal THEN false
    WHEN e.error_class = 'STALE_LOCK_LOOP_HARD_KILL' THEN true
    WHEN e.error_class IN ('TIMEOUT','RATE_LIMIT','NETWORK_ERROR','WATCHDOG_RECOVERY') THEN true
    WHEN e.subcluster IN ('UNCLASSIFIED_TRANSIENT','UNCLASSIFIED_RECLASSIFIABLE') THEN true
    ELSE false
  END AS safe_to_auto_execute,
  EXISTS (
    SELECT 1 FROM public.job_queue d
    WHERE d.job_type = e.job_type
      AND d.package_id IS NOT DISTINCT FROM e.package_id
      AND d.status = ANY(public.fn_job_active_statuses())
      AND d.id <> e.id
  ) AS has_active_sibling,
  EXISTS (
    SELECT 1 FROM public.job_queue s
    WHERE s.job_type = e.job_type
      AND s.package_id IS NOT DISTINCT FROM e.package_id
      AND s.status = 'completed'
      AND s.updated_at > e.updated_at
      AND s.id <> e.id
  ) AS has_newer_success
FROM enriched e;

GRANT SELECT ON public.v_admin_queue_job_classification TO authenticated;

-- ── 3. Strategy-Resolver ──
CREATE FUNCTION public.admin_resolve_repair_strategy_for_package(_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _curriculum_id uuid;
  _bp_count int := 0;
  _approved_bp_count int := 0;
  _comp_count int := 0;
  _active_fill_jobs int := 0;
  _active_blueprint_jobs int := 0;
BEGIN
  SELECT cp.curriculum_id INTO _curriculum_id FROM public.course_packages cp WHERE cp.id = _package_id;
  IF _curriculum_id IS NULL THEN
    RETURN jsonb_build_object('strategy','manual_review_required','reason','no_curriculum');
  END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE bp.status IN ('approved','review'))
    INTO _bp_count, _approved_bp_count
  FROM public.exam_blueprints bp WHERE bp.curriculum_id = _curriculum_id;

  SELECT COUNT(*) INTO _comp_count
  FROM public.competencies c
  JOIN public.learning_fields lf ON lf.id = c.learning_field_id
  WHERE lf.curriculum_id = _curriculum_id;

  SELECT COUNT(*) INTO _active_fill_jobs FROM public.job_queue j
  WHERE j.job_type = 'targeted_competency_fill' AND j.package_id = _package_id
    AND j.status = ANY(public.fn_job_active_statuses());

  SELECT COUNT(*) INTO _active_blueprint_jobs FROM public.job_queue j
  WHERE j.job_type IN ('targeted_blueprint_fill','blueprint-fanout','blueprint-seed-by-competency')
    AND j.package_id = _package_id AND j.status = ANY(public.fn_job_active_statuses());

  IF _comp_count = 0 THEN
    RETURN jsonb_build_object('strategy','manual_review_required','reason','no_competencies','comp_count',_comp_count);
  END IF;

  IF _approved_bp_count = 0 THEN
    IF _active_blueprint_jobs > 0 THEN
      RETURN jsonb_build_object('strategy','no_action_active_job_exists','reason','blueprint_job_running','active_blueprint_jobs',_active_blueprint_jobs);
    END IF;
    RETURN jsonb_build_object('strategy','targeted_blueprint_fill','reason','no_blueprints','bp_count',_bp_count,'approved_bp_count',_approved_bp_count);
  END IF;

  IF _active_fill_jobs > 0 THEN
    RETURN jsonb_build_object('strategy','no_action_active_job_exists','reason','fill_job_running','active_fill_jobs',_active_fill_jobs);
  END IF;

  RETURN jsonb_build_object('strategy','targeted_competency_fill','reason','blueprints_present','approved_bp_count',_approved_bp_count,'comp_count',_comp_count);
END
$function$;

REVOKE ALL ON FUNCTION public.admin_resolve_repair_strategy_for_package(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_resolve_repair_strategy_for_package(uuid) TO authenticated;

-- ── 4. Cluster-isolierte Heal-Funktion ──
CREATE FUNCTION public.fn_auto_heal_cluster(_cluster text, _max_jobs integer DEFAULT 25, _dry_run boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _row record;
  _processed int := 0;
  _skipped int := 0;
  _errors int := 0;
  _details jsonb := '[]'::jsonb;
  _resolver jsonb;
  _strategy text;
BEGIN
  IF _cluster = 'STALE_LOCK_LOOP_HARD_KILL' THEN
    FOR _row IN SELECT v.* FROM public.v_admin_queue_job_classification v
      WHERE v.cluster='STALE_LOCK_LOOP_HARD_KILL' AND NOT v.is_admin_terminal
        AND NOT v.has_active_sibling AND NOT v.has_newer_success
      ORDER BY v.updated_at ASC LIMIT _max_jobs
    LOOP
      BEGIN
        IF NOT _dry_run THEN
          UPDATE public.job_queue SET status='pending', run_after=now()+interval '10 seconds',
            attempts=GREATEST(COALESCE(attempts,0)-1,0), last_error=NULL,
            meta=COALESCE(meta,'{}'::jsonb)||jsonb_build_object(
              'auto_healed_at',now(),'auto_heal_cluster','STALE_LOCK_LOOP_HARD_KILL','auto_heal_strategy','reset_to_pending')
          WHERE id=_row.id;
        END IF;
        _processed:=_processed+1;
        _details:=_details||jsonb_build_object('job_id',_row.id,'action','reset_to_pending');
      EXCEPTION WHEN OTHERS THEN _errors:=_errors+1; END;
    END LOOP;

  ELSIF _cluster = 'REPAIR_COMPETENCY_COVERAGE' THEN
    FOR _row IN SELECT v.* FROM public.v_admin_queue_job_classification v
      WHERE v.cluster='REPAIR_COMPETENCY_COVERAGE' AND NOT v.is_admin_terminal AND v.package_id IS NOT NULL
      ORDER BY v.updated_at ASC LIMIT _max_jobs
    LOOP
      BEGIN
        _resolver := public.admin_resolve_repair_strategy_for_package(_row.package_id);
        _strategy := _resolver->>'strategy';

        IF _strategy IN ('manual_review_required','no_action_active_job_exists') THEN
          IF NOT _dry_run THEN
            UPDATE public.job_queue SET
              meta=COALESCE(meta,'{}'::jsonb)||jsonb_build_object(
                'auto_heal_skipped_at',now(),'auto_heal_skip_reason',_resolver->>'reason','auto_heal_resolver',_resolver)
            WHERE id=_row.id;
          END IF;
          _skipped:=_skipped+1;
          _details:=_details||jsonb_build_object('job_id',_row.id,'action','skip','strategy',_strategy,'reason',_resolver->>'reason');
        ELSE
          IF NOT _dry_run THEN
            UPDATE public.job_queue SET status='cancelled',
              meta=COALESCE(meta,'{}'::jsonb)||jsonb_build_object(
                'auto_healed_at',now(),'auto_heal_cluster','REPAIR_COMPETENCY_COVERAGE',
                'auto_heal_strategy',_strategy,'cancel_source','auto_heal_replaced_with_'||_strategy,
                'auto_heal_resolver',_resolver)
            WHERE id=_row.id;
            INSERT INTO public.job_queue(job_type,status,package_id,payload,priority,meta,run_after)
            VALUES (_strategy,'pending',_row.package_id,
              jsonb_build_object('package_id',_row.package_id,'source_cluster','REPAIR_COMPETENCY_COVERAGE'),
              5, jsonb_build_object('auto_heal_origin_job_id',_row.id,'auto_heal_source','REPAIR_COMPETENCY_COVERAGE'),
              now()+interval '5 seconds');
          END IF;
          _processed:=_processed+1;
          _details:=_details||jsonb_build_object('job_id',_row.id,'action','enqueue','strategy',_strategy);
        END IF;
      EXCEPTION WHEN OTHERS THEN _errors:=_errors+1; END;
    END LOOP;

  ELSIF _cluster = 'REQUEUE_LOOP_KILLED' THEN
    FOR _row IN SELECT v.* FROM public.v_admin_queue_job_classification v
      WHERE v.cluster='REQUEUE_LOOP_KILLED' AND NOT v.is_admin_terminal AND NOT v.is_retry_path_terminal
      ORDER BY v.updated_at ASC LIMIT _max_jobs
    LOOP
      BEGIN
        IF NOT _dry_run THEN
          UPDATE public.job_queue SET
            meta=COALESCE(meta,'{}'::jsonb)||jsonb_build_object(
              'auto_healed_at',now(),'auto_heal_cluster','REQUEUE_LOOP_KILLED',
              'retry_path_terminal',true,'terminal_scope','job_type_for_package',
              'terminal_reason','requeue_loop_killed','suggested_followup','manual_review')
          WHERE id=_row.id;
          INSERT INTO public.admin_notifications(severity,category,title,body,entity_type,entity_id,metadata)
          VALUES ('warning','queue_health','Requeue-Loop endgültig markiert (Retry-Pfad)',
            'Job '||_row.id::text||' ('||_row.job_type||') als retry_path_terminal markiert. Bitte manuell prüfen.',
            'job_queue',_row.id,
            jsonb_build_object('cluster','REQUEUE_LOOP_KILLED','package_id',_row.package_id));
        END IF;
        _processed:=_processed+1;
        _details:=_details||jsonb_build_object('job_id',_row.id,'action','mark_retry_path_terminal');
      EXCEPTION WHEN OTHERS THEN _errors:=_errors+1; END;
    END LOOP;

  ELSIF _cluster = 'UNCLASSIFIED_RECLASSIFIABLE' THEN
    FOR _row IN SELECT v.* FROM public.v_admin_queue_job_classification v
      WHERE v.subcluster='UNCLASSIFIED_RECLASSIFIABLE' AND NOT v.is_admin_terminal AND NOT v.has_active_sibling
      ORDER BY v.updated_at ASC LIMIT _max_jobs
    LOOP
      BEGIN
        IF NOT _dry_run THEN
          UPDATE public.job_queue SET status='pending', run_after=now()+interval '15 seconds',
            last_error=COALESCE(meta->>'error_class', meta->>'error_code', last_error),
            meta=COALESCE(meta,'{}'::jsonb)||jsonb_build_object(
              'auto_healed_at',now(),'auto_heal_cluster','UNCLASSIFIED_RECLASSIFIABLE',
              'auto_heal_strategy','reclassify_then_retry')
          WHERE id=_row.id;
        END IF;
        _processed:=_processed+1;
        _details:=_details||jsonb_build_object('job_id',_row.id,'action','reclassify_retry');
      EXCEPTION WHEN OTHERS THEN _errors:=_errors+1; END;
    END LOOP;

  ELSIF _cluster = 'UNCLASSIFIED_TRANSIENT' THEN
    FOR _row IN SELECT v.* FROM public.v_admin_queue_job_classification v
      WHERE v.subcluster='UNCLASSIFIED_TRANSIENT' AND NOT v.is_admin_terminal AND NOT v.has_active_sibling
        AND COALESCE((v.meta->>'auto_heal_transient_retry_count')::int,0) < 1
      ORDER BY v.updated_at ASC LIMIT _max_jobs
    LOOP
      BEGIN
        IF NOT _dry_run THEN
          UPDATE public.job_queue SET status='pending', run_after=now()+interval '30 seconds',
            attempts=GREATEST(COALESCE(attempts,0)-1,0),
            meta=COALESCE(meta,'{}'::jsonb)||jsonb_build_object(
              'auto_healed_at',now(),'auto_heal_cluster','UNCLASSIFIED_TRANSIENT',
              'auto_heal_strategy','soft_retry_capped',
              'auto_heal_transient_retry_count',COALESCE((meta->>'auto_heal_transient_retry_count')::int,0)+1)
          WHERE id=_row.id;
        END IF;
        _processed:=_processed+1;
        _details:=_details||jsonb_build_object('job_id',_row.id,'action','transient_soft_retry');
      EXCEPTION WHEN OTHERS THEN _errors:=_errors+1; END;
    END LOOP;

  ELSIF _cluster IN ('TIMEOUT','RATE_LIMIT','NETWORK_ERROR','WATCHDOG_RECOVERY') THEN
    FOR _row IN SELECT v.* FROM public.v_admin_queue_job_classification v
      WHERE v.cluster=_cluster AND NOT v.is_admin_terminal
        AND NOT v.has_active_sibling AND NOT v.has_newer_success
      ORDER BY v.updated_at ASC LIMIT _max_jobs
    LOOP
      BEGIN
        IF NOT _dry_run THEN
          UPDATE public.job_queue SET status='pending', run_after=now()+interval '60 seconds', last_error=NULL,
            meta=COALESCE(meta,'{}'::jsonb)||jsonb_build_object(
              'auto_healed_at',now(),'auto_heal_cluster',_cluster,'auto_heal_strategy','soft_retry_with_backoff')
          WHERE id=_row.id;
        END IF;
        _processed:=_processed+1;
        _details:=_details||jsonb_build_object('job_id',_row.id,'action','backoff_retry');
      EXCEPTION WHEN OTHERS THEN _errors:=_errors+1; END;
    END LOOP;

  ELSE
    RETURN jsonb_build_object('ok',false,'cluster',_cluster,'error','unsupported_cluster');
  END IF;

  RETURN jsonb_build_object('ok',true,'cluster',_cluster,'dry_run',_dry_run,
    'processed',_processed,'skipped',_skipped,'errors',_errors,'details',_details);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_auto_heal_cluster(text,integer,boolean) FROM public;

-- ── 5. Sammel-Wrapper (für Cron) ──
CREATE FUNCTION public.fn_auto_heal_failed_clusters(_max_per_cluster integer DEFAULT 25, _dry_run boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _result jsonb := '{}'::jsonb;
  _cluster text;
BEGIN
  FOREACH _cluster IN ARRAY ARRAY[
    'STALE_LOCK_LOOP_HARD_KILL','TIMEOUT','RATE_LIMIT','NETWORK_ERROR','WATCHDOG_RECOVERY',
    'UNCLASSIFIED_RECLASSIFIABLE','UNCLASSIFIED_TRANSIENT',
    'REPAIR_COMPETENCY_COVERAGE','REQUEUE_LOOP_KILLED'
  ] LOOP
    _result := _result || jsonb_build_object(_cluster, public.fn_auto_heal_cluster(_cluster,_max_per_cluster,_dry_run));
  END LOOP;
  RETURN _result;
END
$function$;

-- ── 6. Health-Score (gewichtet) ──
CREATE FUNCTION public.admin_get_queue_health_score()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid; _failed int; _processing int; _pending int; _terminal int;
  _hard_fail_clusters int; _stale_lock int; _transient int; _structural int; _requeue_loop int;
  _backlog_pressure int; _score int; _status text; _critical_clusters int;
BEGIN
  _uid := auth.uid();
  IF NOT public.has_role(_uid,'admin'::app_role) THEN
    RAISE EXCEPTION 'access_denied: admin role required';
  END IF;

  SELECT COUNT(*) FILTER (WHERE status='failed'),
         COUNT(*) FILTER (WHERE status='processing'),
         COUNT(*) FILTER (WHERE status='pending')
  INTO _failed,_processing,_pending
  FROM public.job_queue WHERE created_at > now() - interval '7 days';

  SELECT COUNT(*) INTO _terminal FROM public.v_admin_queue_job_classification
  WHERE is_admin_terminal OR is_retry_path_terminal;

  SELECT
    COUNT(DISTINCT cluster) FILTER (WHERE risk_level='HIGH' AND cluster NOT IN ('REQUEUE_LOOP_KILLED')),
    COUNT(*) FILTER (WHERE cluster='STALE_LOCK_LOOP_HARD_KILL'),
    COUNT(*) FILTER (WHERE subcluster='UNCLASSIFIED_TRANSIENT' OR cluster IN ('TIMEOUT','RATE_LIMIT','NETWORK_ERROR')),
    COUNT(*) FILTER (WHERE subcluster='UNCLASSIFIED_STRUCTURAL'),
    COUNT(*) FILTER (WHERE cluster='REQUEUE_LOOP_KILLED')
  INTO _hard_fail_clusters,_stale_lock,_transient,_structural,_requeue_loop
  FROM public.v_admin_queue_job_classification;

  _backlog_pressure := GREATEST(0,(_failed+_pending)-50);

  _score := 100 - (_hard_fail_clusters*20) - (_stale_lock*2) - (_transient*1)
            - (_structural*8) - (_requeue_loop*10) - (_terminal*5)
            - LEAST(_backlog_pressure,30);
  _score := GREATEST(0,LEAST(100,_score));

  _status := CASE WHEN _score>=85 THEN 'healthy' WHEN _score>=65 THEN 'attention'
                  WHEN _score>=40 THEN 'degraded' ELSE 'critical' END;

  SELECT COUNT(DISTINCT cluster) INTO _critical_clusters
  FROM public.v_admin_queue_job_classification WHERE risk_level IN ('HIGH','MEDIUM');

  RETURN jsonb_build_object(
    'score',_score,'status',_status,
    'failed',_failed,'processing',_processing,'pending',_pending,
    'terminal_count',_terminal,'critical_clusters',_critical_clusters,
    'total_active',_processing+_pending,
    'weighted_breakdown',jsonb_build_object(
      'hard_fail_clusters',_hard_fail_clusters,'stale_lock',_stale_lock,
      'transient',_transient,'structural',_structural,'requeue_loop',_requeue_loop,
      'terminal',_terminal,'backlog_pressure',_backlog_pressure));
END
$function$;

REVOKE ALL ON FUNCTION public.admin_get_queue_health_score() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_get_queue_health_score() TO authenticated;

-- ── 7. Action-Recommendations basierend auf SSOT-View ──
CREATE FUNCTION public.admin_recommend_queue_actions()
RETURNS TABLE(
  action_key text, cluster text, priority int, risk_level text, is_safe boolean,
  job_count bigint, package_count bigint, title text, description text,
  recommended_strategy text, why_recommended text, oldest_job_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid;
BEGIN
  _uid := auth.uid();
  IF NOT public.has_role(_uid,'admin'::app_role) THEN
    RAISE EXCEPTION 'access_denied: admin role required';
  END IF;

  RETURN QUERY
  WITH agg AS (
    SELECT v.cluster, v.subcluster, v.risk_level, v.recommended_strategy, v.safe_to_auto_execute,
           COUNT(*) AS jc,
           COUNT(DISTINCT v.package_id) FILTER (WHERE v.package_id IS NOT NULL) AS pc,
           MIN(v.updated_at) AS oldest
    FROM public.v_admin_queue_job_classification v
    WHERE NOT v.is_admin_terminal
    GROUP BY v.cluster, v.subcluster, v.risk_level, v.recommended_strategy, v.safe_to_auto_execute
  )
  SELECT
    (CASE a.cluster
      WHEN 'STALE_LOCK_LOOP_HARD_KILL' THEN 'heal_stale_lock'
      WHEN 'REPAIR_COMPETENCY_COVERAGE' THEN 'heal_repair_competency'
      WHEN 'REQUEUE_LOOP_KILLED' THEN 'mark_requeue_loop_terminal'
      WHEN 'TIMEOUT' THEN 'heal_timeout_retry'
      WHEN 'RATE_LIMIT' THEN 'heal_rate_limit_retry'
      WHEN 'NETWORK_ERROR' THEN 'heal_network_retry'
      WHEN 'WATCHDOG_RECOVERY' THEN 'heal_watchdog_retry'
      WHEN 'UNCLASSIFIED_RECLASSIFIABLE' THEN 'heal_unclassified_reclassifiable'
      WHEN 'UNCLASSIFIED_TRANSIENT' THEN 'heal_unclassified_transient'
      WHEN 'UNCLASSIFIED_STRUCTURAL' THEN 'review_unclassified_structural'
      ELSE 'review_'||lower(a.cluster) END)::text,
    a.cluster::text,
    (CASE a.risk_level WHEN 'SAFE' THEN 1 WHEN 'LOW' THEN 2 WHEN 'MEDIUM' THEN 3 WHEN 'HIGH' THEN 4 ELSE 5 END)::int,
    a.risk_level::text,
    a.safe_to_auto_execute::boolean,
    a.jc::bigint,
    a.pc::bigint,
    (CASE a.cluster
      WHEN 'STALE_LOCK_LOOP_HARD_KILL' THEN a.jc::text||' STALE_LOCK Jobs heilen'
      WHEN 'REPAIR_COMPETENCY_COVERAGE' THEN 'Coverage-Lücken reparieren ('||a.jc::text||' Jobs / '||a.pc::text||' Pakete)'
      WHEN 'REQUEUE_LOOP_KILLED' THEN a.jc::text||' Requeue-Loops als Retry-Terminal markieren'
      WHEN 'TIMEOUT' THEN a.jc::text||' Timeout-Jobs neu starten'
      WHEN 'RATE_LIMIT' THEN a.jc::text||' Rate-Limited Jobs neu starten'
      WHEN 'NETWORK_ERROR' THEN a.jc::text||' Netzwerk-Fehler retry'
      WHEN 'WATCHDOG_RECOVERY' THEN a.jc::text||' Watchdog-Jobs erholen'
      WHEN 'UNCLASSIFIED_RECLASSIFIABLE' THEN a.jc::text||' Jobs reklassifizieren & retry'
      WHEN 'UNCLASSIFIED_TRANSIENT' THEN a.jc::text||' transiente Jobs (1× soft retry)'
      WHEN 'UNCLASSIFIED_STRUCTURAL' THEN a.jc::text||' strukturelle Fehler — Review nötig'
      ELSE a.cluster||' ('||a.jc::text||')' END)::text,
    (CASE a.cluster
      WHEN 'STALE_LOCK_LOOP_HARD_KILL' THEN 'False-positive Stale-Lock erkannt, keine aktiven Duplikate. Reset auf pending.'
      WHEN 'REPAIR_COMPETENCY_COVERAGE' THEN 'Resolver entscheidet pro Paket: targeted_competency_fill, targeted_blueprint_fill oder Skip.'
      WHEN 'REQUEUE_LOOP_KILLED' THEN 'Markiert nur Retry-Pfad als terminal (NICHT admin_terminal). Paket-Heal weiterhin möglich.'
      WHEN 'UNCLASSIFIED_TRANSIENT' THEN 'Hinweise auf Timeout/Network. Maximal 1 zusätzlicher Retry pro Job.'
      WHEN 'UNCLASSIFIED_RECLASSIFIABLE' THEN 'meta enthält error_class — wird übernommen, dann retry.'
      WHEN 'UNCLASSIFIED_STRUCTURAL' THEN 'Constraint/Payload/Causality-Fehler — KEIN Auto-Retry, manuelle Diagnose.'
      ELSE a.recommended_strategy END)::text,
    a.recommended_strategy::text,
    ('Cluster: '||a.cluster||' · Risiko: '||a.risk_level||' · Strategie: '||a.recommended_strategy)::text,
    a.oldest
  FROM agg a
  WHERE a.jc > 0
  ORDER BY (CASE a.risk_level WHEN 'SAFE' THEN 1 WHEN 'LOW' THEN 2 WHEN 'MEDIUM' THEN 3 WHEN 'HIGH' THEN 4 ELSE 5 END) ASC, a.jc DESC;
END
$function$;

REVOKE ALL ON FUNCTION public.admin_recommend_queue_actions() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_recommend_queue_actions() TO authenticated;

-- ── 8. Execute-Recommended-Action: cluster-isoliert mit Dry-Run ──
CREATE FUNCTION public.admin_execute_recommended_action(_action_key text, _max_jobs integer DEFAULT 50, _dry_run boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid; _result jsonb; _cluster text;
BEGIN
  _uid := auth.uid();
  IF NOT public.has_role(_uid,'admin'::app_role) THEN
    RAISE EXCEPTION 'access_denied: admin role required';
  END IF;

  IF NOT public.admin_check_action_throttle(_uid,'recommended_action_'||_action_key,10) THEN
    RAISE EXCEPTION 'rate_limit: too many recommended-action triggers (10/min)';
  END IF;

  _cluster := CASE _action_key
    WHEN 'heal_stale_lock' THEN 'STALE_LOCK_LOOP_HARD_KILL'
    WHEN 'heal_repair_competency' THEN 'REPAIR_COMPETENCY_COVERAGE'
    WHEN 'mark_requeue_loop_terminal' THEN 'REQUEUE_LOOP_KILLED'
    WHEN 'heal_timeout_retry' THEN 'TIMEOUT'
    WHEN 'heal_rate_limit_retry' THEN 'RATE_LIMIT'
    WHEN 'heal_network_retry' THEN 'NETWORK_ERROR'
    WHEN 'heal_watchdog_retry' THEN 'WATCHDOG_RECOVERY'
    WHEN 'heal_unclassified_reclassifiable' THEN 'UNCLASSIFIED_RECLASSIFIABLE'
    WHEN 'heal_unclassified_transient' THEN 'UNCLASSIFIED_TRANSIENT'
    ELSE NULL
  END;

  IF _cluster IS NULL THEN
    RAISE EXCEPTION 'unsupported_action: % (review-only or unknown)', _action_key;
  END IF;

  INSERT INTO public.admin_actions(action,scope,payload,user_id)
  VALUES ('execute_recommended_action','queue_health',
    jsonb_build_object('action_key',_action_key,'cluster',_cluster,'max_jobs',_max_jobs,'dry_run',_dry_run),
    _uid);

  _result := public.fn_auto_heal_cluster(_cluster,_max_jobs,_dry_run);

  RETURN jsonb_build_object('ok',true,'action_key',_action_key,'cluster',_cluster,
    'dry_run',_dry_run,'result',_result);
END
$function$;

REVOKE ALL ON FUNCTION public.admin_execute_recommended_action(text,integer,boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_execute_recommended_action(text,integer,boolean) TO authenticated;