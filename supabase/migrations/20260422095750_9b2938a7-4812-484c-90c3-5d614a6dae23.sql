-- ============================================================
-- Wave-5: Action-First Cockpit Backend
-- 1. Härten fn_classify_job_error (UNCLASSIFIED <5%)
-- 2. fn_auto_heal_failed_clusters: 4-Cluster Auto-Heal
-- 3. admin_recommend_queue_actions: priorisierte Aktionsliste
-- 4. admin_execute_recommended_action: 1-Klick Heal
-- ============================================================

-- 1. HÄRTERE Klassifizierung — meta + last_error tiefer parsen
CREATE OR REPLACE FUNCTION public.fn_classify_job_error(_err text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN _err IS NULL OR _err = '' THEN NULL
    -- Hard kills (terminal)
    WHEN _err ~* 'STALE_LOCK_LOOP_HARD_KILL|stale[_ ]lock.*kill|hard[_ ]kill.*lock' THEN 'STALE_LOCK_LOOP_HARD_KILL'
    WHEN _err ~* 'REQUEUE_LOOP_KILLED|requeue[_ ]loop.*kill' THEN 'REQUEUE_LOOP_KILLED'
    WHEN _err ~* 'HARD_FAIL_REPAIR_EXHAUSTED|repair[_ ]exhausted' THEN 'HARD_FAIL_REPAIR_EXHAUSTED'
    WHEN _err ~* 'HARD_FAIL_BREAKER|hard[_ ]fail[_ ]breaker' THEN 'HARD_FAIL_BREAKER'
    -- Repair signals
    WHEN _err ~* 'REPAIR_COMPETENCY_COVERAGE|REPAIR_COMPETENCY|competency[_ ]coverage|fehlende[_ ]kompetenz' THEN 'REPAIR_COMPETENCY_COVERAGE'
    WHEN _err ~* 'REPAIR_BLUEPRINT|blueprint[_ ]missing|missing[_ ]blueprint' THEN 'REPAIR_BLUEPRINT'
    -- Missing data
    WHEN _err ~* 'HARD_FAIL_NO_CURRICULUM|HARD_FAIL_NO_CURR|no[_ ]curriculum|missing[_ ]curriculum' THEN 'HARD_FAIL_NO_CURRICULUM'
    WHEN _err ~* 'HARD_FAIL_NO_BLUEPRINTS|HARD_FAIL_NO_BLUE|no[_ ]blueprints|missing[_ ]blueprints' THEN 'HARD_FAIL_NO_BLUEPRINTS'
    WHEN _err ~* 'NO_QUESTIONS|missing[_ ]questions|empty[_ ]pool' THEN 'NO_QUESTIONS'
    -- Quality gates
    WHEN _err ~* 'QUALITY_THRESHOLD_NOT_MET|quality.*threshold|quality[_ ]gate' THEN 'QUALITY_THRESHOLD_NOT_MET'
    WHEN _err ~* 'INTEGRITY_FAIL|integrity[_ ]check.*fail' THEN 'INTEGRITY_FAIL'
    -- Ops guards
    WHEN _err ~* 'OPS_GUARD:NON_BUILDING_PACKAGE|NON_BUILDING_PACKAGE|not[_ ]building' THEN 'NON_BUILDING_PACKAGE'
    WHEN _err ~* 'OPS_GUARD:WIP_LIMIT|WIP_LIMIT' THEN 'WIP_LIMIT'
    WHEN _err ~* 'OPS_GUARD:COOLDOWN|cooldown' THEN 'COOLDOWN_ACTIVE'
    -- Infrastructure
    WHEN _err ~* 'Watchdog|watchdog' THEN 'WATCHDOG_RECOVERY'
    WHEN _err ~* 'timeout|timed[_ ]out|deadline[_ ]exceeded' THEN 'TIMEOUT'
    WHEN _err ~* 'rate.?limit|too[_ ]many[_ ]requests|429' THEN 'RATE_LIMIT'
    WHEN _err ~* 'connection|ECONNRESET|ETIMEDOUT|network' THEN 'NETWORK_ERROR'
    WHEN _err ~* 'budget|cost[_ ]cap|spending[_ ]limit' THEN 'BUDGET_EXCEEDED'
    WHEN _err ~* 'permission|forbidden|unauthorized|401|403' THEN 'AUTH_ERROR'
    WHEN _err ~* 'invalid[_ ]json|parse[_ ]error|malformed' THEN 'PARSE_ERROR'
    WHEN _err ~* 'constraint|duplicate|unique[_ ]violation' THEN 'DB_CONSTRAINT'
    -- Generic patterns
    WHEN _err ~* 'failed[_ ]to|error[_ ]in|exception' THEN 'GENERIC_FAILURE'
    ELSE 'OTHER'
  END
$function$;

-- 2. AUTO-HEAL ENGINE für 4 Cluster
CREATE OR REPLACE FUNCTION public.fn_auto_heal_failed_clusters(
  _max_per_cluster int DEFAULT 25,
  _dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _row record;
  _healed jsonb := '{}'::jsonb;
  _stale_lock int := 0;
  _repair_comp int := 0;
  _requeue_loop int := 0;
  _unclassified int := 0;
  _new_class text;
  _active_statuses text[];
BEGIN
  _active_statuses := public.fn_job_active_statuses();

  -- CLUSTER A: STALE_LOCK_LOOP_HARD_KILL → reset to pending (safe: lock is stale by definition)
  FOR _row IN
    SELECT q.id, q.job_type, q.package_id, q.updated_at, q.attempts, q.max_attempts
    FROM public.job_queue q
    WHERE q.status = 'failed'
      AND public.fn_classify_job_error(q.last_error) = 'STALE_LOCK_LOOP_HARD_KILL'
      AND COALESCE(q.meta->>'admin_terminal','false') <> 'true'
      AND NOT EXISTS (
        SELECT 1 FROM public.job_queue d
        WHERE d.job_type = q.job_type
          AND d.package_id IS NOT DISTINCT FROM q.package_id
          AND d.status = ANY(_active_statuses)
          AND d.id <> q.id
      )
    ORDER BY q.updated_at ASC
    LIMIT _max_per_cluster
  LOOP
    BEGIN
      IF NOT _dry_run THEN
        UPDATE public.job_queue SET
          status = 'pending',
          run_after = now() + interval '10 seconds',
          attempts = GREATEST(COALESCE(attempts,0) - 1, 0),
          last_error = NULL,
          meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
            'auto_healed_at', now(),
            'auto_heal_cluster', 'STALE_LOCK_LOOP_HARD_KILL',
            'auto_heal_strategy', 'reset_and_requeue'
          )
        WHERE id = _row.id;
      END IF;
      _stale_lock := _stale_lock + 1;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;

  -- CLUSTER B: REPAIR_COMPETENCY_COVERAGE → enqueue blueprint-refill (medium risk)
  FOR _row IN
    SELECT q.id, q.job_type, q.package_id, q.updated_at
    FROM public.job_queue q
    WHERE q.status = 'failed'
      AND public.fn_classify_job_error(q.last_error) = 'REPAIR_COMPETENCY_COVERAGE'
      AND q.package_id IS NOT NULL
      AND COALESCE(q.meta->>'admin_terminal','false') <> 'true'
    ORDER BY q.updated_at ASC
    LIMIT _max_per_cluster
  LOOP
    BEGIN
      IF NOT _dry_run THEN
        -- Mark current as cancelled with audit trail
        UPDATE public.job_queue SET
          status = 'cancelled',
          meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
            'auto_healed_at', now(),
            'auto_heal_cluster', 'REPAIR_COMPETENCY_COVERAGE',
            'auto_heal_strategy', 'cancel_and_refill_blueprints'
          )
        WHERE id = _row.id;
        -- Enqueue blueprint refill for the package (idempotent via active-status check)
        INSERT INTO public.job_queue (job_type, package_id, status, priority, run_after, meta)
        SELECT 'targeted_competency_fill', _row.package_id, 'pending', 100, now() + interval '5 seconds',
               jsonb_build_object('auto_heal_source_job', _row.id, 'reason', 'REPAIR_COMPETENCY_COVERAGE')
        WHERE NOT EXISTS (
          SELECT 1 FROM public.job_queue x
          WHERE x.job_type = 'targeted_competency_fill'
            AND x.package_id = _row.package_id
            AND x.status = ANY(_active_statuses)
        );
      END IF;
      _repair_comp := _repair_comp + 1;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;

  -- CLUSTER C: REQUEUE_LOOP_KILLED → mark explicit terminal (no further retry, alert only)
  FOR _row IN
    SELECT q.id, q.job_type, q.package_id, q.updated_at
    FROM public.job_queue q
    WHERE q.status = 'failed'
      AND public.fn_classify_job_error(q.last_error) = 'REQUEUE_LOOP_KILLED'
      AND COALESCE(q.meta->>'admin_terminal','false') <> 'true'
    ORDER BY q.updated_at ASC
    LIMIT _max_per_cluster
  LOOP
    BEGIN
      IF NOT _dry_run THEN
        UPDATE public.job_queue SET
          attempts = GREATEST(COALESCE(attempts,0), COALESCE(max_attempts, 99)),
          meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
            'auto_healed_at', now(),
            'auto_heal_cluster', 'REQUEUE_LOOP_KILLED',
            'auto_heal_strategy', 'mark_terminal_no_retry',
            'admin_terminal', true,
            'admin_marked_terminal_at', now()
          )
        WHERE id = _row.id;
        -- Notify admins
        INSERT INTO public.admin_notifications(category, severity, title, body, entity_type, entity_id, metadata)
        VALUES (
          'queue_health', 'high',
          'REQUEUE_LOOP_KILLED → terminal markiert',
          format('Job %s (%s) für Paket %s wurde terminal markiert nach Loop-Detection.', _row.id, _row.job_type, _row.package_id),
          'job_queue', _row.id::text,
          jsonb_build_object('cluster', 'REQUEUE_LOOP_KILLED', 'job_type', _row.job_type, 'package_id', _row.package_id)
        );
      END IF;
      _requeue_loop := _requeue_loop + 1;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;

  -- CLUSTER D: UNCLASSIFIED/OTHER/NULL → reclassify against meta.error_class first, then retry if classifiable
  FOR _row IN
    SELECT q.id, q.job_type, q.package_id, q.last_error, q.error, q.meta, q.updated_at, q.attempts
    FROM public.job_queue q
    WHERE q.status = 'failed'
      AND (
        public.fn_classify_job_error(q.last_error) IN ('OTHER','GENERIC_FAILURE')
        OR public.fn_classify_job_error(q.last_error) IS NULL
      )
      AND COALESCE(q.meta->>'admin_terminal','false') <> 'true'
      AND NOT EXISTS (
        SELECT 1 FROM public.job_queue d
        WHERE d.job_type = q.job_type
          AND d.package_id IS NOT DISTINCT FROM q.package_id
          AND d.status = ANY(_active_statuses)
          AND d.id <> q.id
      )
    ORDER BY q.updated_at ASC
    LIMIT _max_per_cluster
  LOOP
    BEGIN
      -- Try reclassifying against meta.error_class or error column
      _new_class := COALESCE(
        public.fn_classify_job_error(_row.meta->>'error_class'),
        public.fn_classify_job_error(_row.error::text),
        public.fn_classify_job_error(_row.meta->>'last_error_detail')
      );
      
      IF NOT _dry_run THEN
        IF _new_class IS NOT NULL AND _new_class NOT IN ('OTHER','GENERIC_FAILURE') THEN
          -- Reclassified → soft retry
          UPDATE public.job_queue SET
            status = 'pending',
            run_after = now() + interval '15 seconds',
            attempts = GREATEST(COALESCE(attempts,0) - 1, 0),
            last_error = NULL,
            meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
              'auto_healed_at', now(),
              'auto_heal_cluster', 'UNCLASSIFIED',
              'auto_heal_strategy', 'reclassified_and_retry',
              'reclassified_as', _new_class
            )
          WHERE id = _row.id;
        ELSE
          -- Still unclassified → soft retry once if attempts < 3, else stay failed
          IF COALESCE(_row.attempts, 0) < 3 THEN
            UPDATE public.job_queue SET
              status = 'pending',
              run_after = now() + interval '30 seconds',
              last_error = NULL,
              meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
                'auto_healed_at', now(),
                'auto_heal_cluster', 'UNCLASSIFIED',
                'auto_heal_strategy', 'soft_retry'
              )
            WHERE id = _row.id;
          END IF;
        END IF;
      END IF;
      _unclassified := _unclassified + 1;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;

  _healed := jsonb_build_object(
    'STALE_LOCK_LOOP_HARD_KILL', _stale_lock,
    'REPAIR_COMPETENCY_COVERAGE', _repair_comp,
    'REQUEUE_LOOP_KILLED', _requeue_loop,
    'UNCLASSIFIED', _unclassified,
    'total', _stale_lock + _repair_comp + _requeue_loop + _unclassified,
    'dry_run', _dry_run,
    'executed_at', now()
  );
  
  RETURN _healed;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_auto_heal_failed_clusters(int, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_auto_heal_failed_clusters(int, boolean) TO service_role;

-- 3. RPC: Admin sieht priorisierte Aktionsliste
CREATE OR REPLACE FUNCTION public.admin_recommend_queue_actions()
RETURNS TABLE(
  action_key text,
  priority int,
  risk_level text,
  cluster text,
  job_count int,
  affected_packages int,
  title text,
  description text,
  recommended_strategy text,
  is_safe boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'access_denied: admin role required';
  END IF;

  RETURN QUERY
  WITH classified AS (
    SELECT 
      public.fn_classify_job_error(q.last_error) AS err_class,
      q.id, q.job_type, q.package_id,
      COALESCE(q.meta->>'admin_terminal','false')::boolean AS is_admin_terminal
    FROM public.job_queue q
    WHERE q.status = 'failed'
  ),
  agg AS (
    SELECT 
      COALESCE(err_class, 'UNCLASSIFIED') AS cluster_name,
      COUNT(*)::int AS jobs,
      COUNT(DISTINCT package_id)::int AS pkgs,
      bool_or(is_admin_terminal) AS has_terminal
    FROM classified
    GROUP BY COALESCE(err_class, 'UNCLASSIFIED')
  )
  SELECT 
    -- action_key
    CASE a.cluster_name
      WHEN 'STALE_LOCK_LOOP_HARD_KILL' THEN 'heal_stale_lock'
      WHEN 'REPAIR_COMPETENCY_COVERAGE' THEN 'heal_repair_competency'
      WHEN 'REQUEUE_LOOP_KILLED' THEN 'mark_requeue_loop_terminal'
      WHEN 'UNCLASSIFIED' THEN 'heal_unclassified'
      WHEN 'OTHER' THEN 'heal_unclassified'
      WHEN 'NON_BUILDING_PACKAGE' THEN 'heal_non_building'
      WHEN 'HARD_FAIL_NO_CURRICULUM' THEN 'review_no_curriculum'
      WHEN 'HARD_FAIL_NO_BLUEPRINTS' THEN 'review_no_blueprints'
      WHEN 'HARD_FAIL_REPAIR_EXHAUSTED' THEN 'review_repair_exhausted'
      WHEN 'TIMEOUT' THEN 'heal_timeout_retry'
      WHEN 'RATE_LIMIT' THEN 'heal_rate_limit_retry'
      ELSE 'manual_review'
    END AS action_key,
    -- priority (lower = higher priority)
    CASE a.cluster_name
      WHEN 'STALE_LOCK_LOOP_HARD_KILL' THEN 10
      WHEN 'UNCLASSIFIED' THEN 20
      WHEN 'OTHER' THEN 20
      WHEN 'TIMEOUT' THEN 25
      WHEN 'RATE_LIMIT' THEN 25
      WHEN 'REPAIR_COMPETENCY_COVERAGE' THEN 30
      WHEN 'NON_BUILDING_PACKAGE' THEN 35
      WHEN 'REQUEUE_LOOP_KILLED' THEN 40
      WHEN 'HARD_FAIL_REPAIR_EXHAUSTED' THEN 50
      ELSE 90
    END AS priority,
    -- risk_level
    CASE a.cluster_name
      WHEN 'STALE_LOCK_LOOP_HARD_KILL' THEN 'SAFE'
      WHEN 'UNCLASSIFIED' THEN 'LOW'
      WHEN 'OTHER' THEN 'LOW'
      WHEN 'TIMEOUT' THEN 'LOW'
      WHEN 'RATE_LIMIT' THEN 'LOW'
      WHEN 'REPAIR_COMPETENCY_COVERAGE' THEN 'MEDIUM'
      WHEN 'NON_BUILDING_PACKAGE' THEN 'MEDIUM'
      WHEN 'REQUEUE_LOOP_KILLED' THEN 'HIGH'
      WHEN 'HARD_FAIL_REPAIR_EXHAUSTED' THEN 'HIGH'
      ELSE 'HIGH'
    END AS risk_level,
    a.cluster_name AS cluster,
    a.jobs AS job_count,
    a.pkgs AS affected_packages,
    -- title (German, action-oriented)
    CASE a.cluster_name
      WHEN 'STALE_LOCK_LOOP_HARD_KILL' THEN format('%s STALE_LOCK Jobs heilen', a.jobs)
      WHEN 'UNCLASSIFIED' THEN format('%s unklassifizierte Jobs neu prüfen', a.jobs)
      WHEN 'OTHER' THEN format('%s sonstige Jobs neu prüfen', a.jobs)
      WHEN 'REPAIR_COMPETENCY_COVERAGE' THEN format('%s Pakete: Competency-Repair starten', a.pkgs)
      WHEN 'REQUEUE_LOOP_KILLED' THEN format('%s Loop-Kills terminal markieren', a.jobs)
      WHEN 'TIMEOUT' THEN format('%s Timeouts erneut versuchen', a.jobs)
      WHEN 'RATE_LIMIT' THEN format('%s Rate-Limit Jobs erneut versuchen', a.jobs)
      WHEN 'NON_BUILDING_PACKAGE' THEN format('%s Non-Building Pakete heilen', a.pkgs)
      WHEN 'HARD_FAIL_NO_CURRICULUM' THEN format('%s Pakete ohne Curriculum prüfen', a.pkgs)
      WHEN 'HARD_FAIL_NO_BLUEPRINTS' THEN format('%s Pakete ohne Blueprints prüfen', a.pkgs)
      WHEN 'HARD_FAIL_REPAIR_EXHAUSTED' THEN format('%s erschöpfte Repairs reviewen', a.jobs)
      ELSE format('%s Jobs (%s) reviewen', a.jobs, a.cluster_name)
    END AS title,
    -- description
    CASE a.cluster_name
      WHEN 'STALE_LOCK_LOOP_HARD_KILL' THEN 'Lock-Detection war False-Positive. Reset auf pending mit Attempt-Decrement.'
      WHEN 'UNCLASSIFIED' THEN 'Reklassifizierung gegen meta.error_class und error-Spalte, dann Soft-Retry.'
      WHEN 'OTHER' THEN 'Reklassifizierung gegen meta.error_class und error-Spalte, dann Soft-Retry.'
      WHEN 'REPAIR_COMPETENCY_COVERAGE' THEN 'Cancel + Enqueue targeted_competency_fill für betroffene Pakete.'
      WHEN 'REQUEUE_LOOP_KILLED' THEN 'Job kreist deterministisch. Markiert als terminal, kein weiterer Retry.'
      WHEN 'TIMEOUT' THEN 'Edge-Function-Timeout. Retry mit längerer Cooldown.'
      WHEN 'RATE_LIMIT' THEN 'Provider-Limit. Retry nach 60s Cooldown.'
      WHEN 'NON_BUILDING_PACKAGE' THEN 'Paket nicht in building-State. Status normalisieren.'
      WHEN 'HARD_FAIL_NO_CURRICULUM' THEN 'Curriculum fehlt → Manueller Review erforderlich.'
      WHEN 'HARD_FAIL_NO_BLUEPRINTS' THEN 'Blueprints fehlen → Manueller Review erforderlich.'
      WHEN 'HARD_FAIL_REPAIR_EXHAUSTED' THEN 'Alle Repair-Versuche erschöpft → Manueller Review.'
      ELSE 'Unbekannter Cluster → Manueller Review.'
    END AS description,
    -- recommended_strategy
    CASE a.cluster_name
      WHEN 'STALE_LOCK_LOOP_HARD_KILL' THEN 'reset_and_requeue'
      WHEN 'UNCLASSIFIED' THEN 'reclassify_and_retry'
      WHEN 'OTHER' THEN 'reclassify_and_retry'
      WHEN 'REPAIR_COMPETENCY_COVERAGE' THEN 'cancel_and_refill_blueprints'
      WHEN 'REQUEUE_LOOP_KILLED' THEN 'mark_terminal_no_retry'
      WHEN 'TIMEOUT' THEN 'retry_with_cooldown'
      WHEN 'RATE_LIMIT' THEN 'retry_with_cooldown'
      WHEN 'NON_BUILDING_PACKAGE' THEN 'normalize_package_status'
      ELSE 'manual_review_required'
    END AS recommended_strategy,
    -- is_safe (auto-executable without admin double-confirm)
    a.cluster_name IN ('STALE_LOCK_LOOP_HARD_KILL','UNCLASSIFIED','OTHER','TIMEOUT','RATE_LIMIT') AS is_safe
  FROM agg a
  WHERE a.jobs > 0
  ORDER BY 
    CASE a.cluster_name
      WHEN 'STALE_LOCK_LOOP_HARD_KILL' THEN 10
      WHEN 'UNCLASSIFIED' THEN 20
      WHEN 'OTHER' THEN 20
      WHEN 'TIMEOUT' THEN 25
      WHEN 'RATE_LIMIT' THEN 25
      WHEN 'REPAIR_COMPETENCY_COVERAGE' THEN 30
      WHEN 'NON_BUILDING_PACKAGE' THEN 35
      WHEN 'REQUEUE_LOOP_KILLED' THEN 40
      ELSE 90
    END;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_recommend_queue_actions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_recommend_queue_actions() TO authenticated;

-- 4. RPC: 1-Klick Heal-Action Executor (admin-gated, throttled)
CREATE OR REPLACE FUNCTION public.admin_execute_recommended_action(
  _action_key text,
  _max_jobs int DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid;
  _result jsonb;
  _heal_result jsonb;
BEGIN
  _uid := auth.uid();
  IF NOT public.has_role(_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'access_denied: admin role required';
  END IF;

  -- Throttle: max 10 recommended-action triggers per minute
  IF NOT public.admin_check_action_throttle(_uid, 'recommended_action_'||_action_key, 10) THEN
    RAISE EXCEPTION 'rate_limit: too many recommended-action triggers (10/min)';
  END IF;

  -- Audit
  INSERT INTO public.admin_actions(action, scope, payload, user_id)
  VALUES ('execute_recommended_action', 'queue_health',
          jsonb_build_object('action_key', _action_key, 'max_jobs', _max_jobs),
          _uid);

  -- Route by action_key
  CASE _action_key
    WHEN 'heal_stale_lock' THEN
      SELECT public.fn_auto_heal_failed_clusters(_max_jobs, false) INTO _heal_result;
      _result := jsonb_build_object('ok', true, 'cluster', 'STALE_LOCK_LOOP_HARD_KILL', 
                                     'healed', _heal_result->'STALE_LOCK_LOOP_HARD_KILL');
    WHEN 'heal_repair_competency' THEN
      SELECT public.fn_auto_heal_failed_clusters(_max_jobs, false) INTO _heal_result;
      _result := jsonb_build_object('ok', true, 'cluster', 'REPAIR_COMPETENCY_COVERAGE',
                                     'healed', _heal_result->'REPAIR_COMPETENCY_COVERAGE');
    WHEN 'mark_requeue_loop_terminal' THEN
      SELECT public.fn_auto_heal_failed_clusters(_max_jobs, false) INTO _heal_result;
      _result := jsonb_build_object('ok', true, 'cluster', 'REQUEUE_LOOP_KILLED',
                                     'healed', _heal_result->'REQUEUE_LOOP_KILLED');
    WHEN 'heal_unclassified' THEN
      SELECT public.fn_auto_heal_failed_clusters(_max_jobs, false) INTO _heal_result;
      _result := jsonb_build_object('ok', true, 'cluster', 'UNCLASSIFIED',
                                     'healed', _heal_result->'UNCLASSIFIED');
    WHEN 'heal_timeout_retry', 'heal_rate_limit_retry' THEN
      -- Generic auto-retry for transient errors
      WITH retried AS (
        UPDATE public.job_queue 
        SET status = 'pending', 
            run_after = now() + interval '60 seconds',
            last_error = NULL,
            meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('auto_healed_at', now(), 'auto_heal_strategy', 'transient_retry')
        WHERE id IN (
          SELECT id FROM public.job_queue 
          WHERE status='failed' 
            AND public.fn_classify_job_error(last_error) IN ('TIMEOUT','RATE_LIMIT')
            AND COALESCE(meta->>'admin_terminal','false') <> 'true'
          ORDER BY updated_at ASC
          LIMIT _max_jobs
        )
        RETURNING id
      )
      SELECT jsonb_build_object('ok', true, 'cluster', 'TIMEOUT/RATE_LIMIT', 'healed', count(*)) INTO _result FROM retried;
    WHEN 'heal_non_building' THEN
      _result := jsonb_build_object('ok', true, 'cluster', 'NON_BUILDING_PACKAGE',
                                     'note', 'Use heal_non_building batch action instead');
    ELSE
      _result := jsonb_build_object('ok', false, 'error', 'unknown_action_key', 'action_key', _action_key);
  END CASE;

  RETURN _result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_execute_recommended_action(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_execute_recommended_action(text, int) TO authenticated;

-- 5. Health-Score-Berechnung (für Header)
CREATE OR REPLACE FUNCTION public.admin_get_queue_health_score()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _failed int;
  _processing int;
  _pending int;
  _total int;
  _critical_clusters int;
  _terminal_count int;
  _score int;
  _status text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'access_denied: admin role required';
  END IF;

  SELECT 
    COUNT(*) FILTER (WHERE status='failed'),
    COUNT(*) FILTER (WHERE status='processing'),
    COUNT(*) FILTER (WHERE status='pending'),
    COUNT(*) FILTER (WHERE status IN ('failed','processing','pending','queued','running','batch_pending')),
    COUNT(*) FILTER (WHERE status='failed' AND COALESCE(meta->>'admin_terminal','false') = 'true')
  INTO _failed, _processing, _pending, _total, _terminal_count
  FROM public.job_queue;

  SELECT COUNT(DISTINCT public.fn_classify_job_error(last_error))
  INTO _critical_clusters
  FROM public.job_queue
  WHERE status='failed' 
    AND public.fn_classify_job_error(last_error) IN (
      'STALE_LOCK_LOOP_HARD_KILL','REQUEUE_LOOP_KILLED','HARD_FAIL_REPAIR_EXHAUSTED','HARD_FAIL_BREAKER'
    );

  -- Score: 100 = perfect, deductions for failed/critical/terminal
  _score := 100;
  _score := _score - LEAST(_failed * 2, 40);
  _score := _score - (_critical_clusters * 10);
  _score := _score - LEAST(_terminal_count * 3, 15);
  _score := GREATEST(_score, 0);

  _status := CASE
    WHEN _score >= 90 THEN 'healthy'
    WHEN _score >= 70 THEN 'attention'
    WHEN _score >= 40 THEN 'degraded'
    ELSE 'critical'
  END;

  RETURN jsonb_build_object(
    'score', _score,
    'status', _status,
    'failed', _failed,
    'processing', _processing,
    'pending', _pending,
    'total_active', _total,
    'critical_clusters', _critical_clusters,
    'terminal_count', _terminal_count,
    'computed_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_queue_health_score() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_queue_health_score() TO authenticated;