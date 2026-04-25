CREATE OR REPLACE FUNCTION public.admin_queue_system_healthcheck()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_required_cols text[] := ARRAY[
    'id','job_type','status','package_id','attempts','max_attempts',
    'last_error','error_class','cluster','subcluster','meta','updated_at',
    'recommended_strategy','retryable','is_terminal','is_admin_terminal',
    'is_retry_path_terminal','safe_to_auto_execute'
  ];
  v_present_cols text[];
  v_missing_cols text[];

  v_view_clusters_produced text[];
  v_view_clusters_defined text[];
  v_view_clusters_all text[];
  v_view_def text;
  v_heal_def text;
  v_heal_clusters text[] := ARRAY[]::text[];
  v_unhandled_in_heal text[];
  v_unknown_in_heal text[];

  v_required_fns text[] := ARRAY[
    'fn_auto_heal_cluster','admin_resolve_repair_strategy_for_package',
    'admin_validate_repair_job_type','admin_get_queue_validation_warnings',
    'admin_queue_cluster_weight','admin_has_recent_terminal_notification',
    'is_admin_user','fn_log_queue_validation','admin_get_queue_validation_audit',
    'admin_dry_run_repair_for_package'
  ];
  v_present_fns text[];
  v_missing_fns text[];

  v_warnings jsonb := '[]'::jsonb;
  v_status text;
BEGIN
  IF NOT public.is_admin_user(auth.uid()) THEN
    RETURN jsonb_build_object('error','admin_only');
  END IF;

  -- Columns present in classification view
  SELECT COALESCE(array_agg(column_name::text), ARRAY[]::text[])
    INTO v_present_cols
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='v_admin_queue_job_classification';

  SELECT COALESCE(array_agg(c), ARRAY[]::text[])
    INTO v_missing_cols
  FROM unnest(v_required_cols) c
  WHERE c <> ALL(v_present_cols);

  -- Distinct cluster values currently produced by the view (live data)
  SELECT COALESCE(array_agg(DISTINCT cluster ORDER BY cluster), ARRAY[]::text[])
    INTO v_view_clusters_produced
  FROM public.v_admin_queue_job_classification
  WHERE cluster IS NOT NULL;

  -- Cluster names statically referenced inside the view definition
  SELECT pg_get_viewdef('public.v_admin_queue_job_classification'::regclass, true) INTO v_view_def;
  IF v_view_def IS NOT NULL THEN
    SELECT COALESCE(array_agg(DISTINCT m[1]), ARRAY[]::text[])
      INTO v_view_clusters_defined
    FROM regexp_matches(v_view_def, $re$'([A-Z][A-Z0-9_]+)'::text$re$, 'g') AS m
    WHERE m[1] = ANY (ARRAY[
      'STALE_LOCK_LOOP_HARD_KILL','REQUEUE_LOOP_KILLED','TIMEOUT','RATE_LIMIT',
      'NETWORK_ERROR','WATCHDOG_RECOVERY','REPAIR_COMPETENCY_COVERAGE',
      'REPAIR_BLUEPRINT','COOLDOWN_ACTIVE','WIP_LIMIT','NON_BUILDING_PACKAGE',
      'HARD_FAIL_NO_CURRICULUM','HARD_FAIL_NO_BLUEPRINTS',
      'HARD_FAIL_REPAIR_EXHAUSTED','HARD_FAIL_BREAKER',
      'QUALITY_THRESHOLD_NOT_MET','INTEGRITY_FAIL','DB_CONSTRAINT',
      'PARSE_ERROR','AUTH_ERROR','UNCLASSIFIED','OTHER'
    ]);
  ELSE
    v_view_clusters_defined := ARRAY[]::text[];
  END IF;

  -- Union: a cluster is "in view" if either currently produced OR statically defined
  v_view_clusters_all := ARRAY(
    SELECT DISTINCT c FROM unnest(
      v_view_clusters_produced || v_view_clusters_defined
    ) c
    ORDER BY c
  );

  -- Extract cluster literals referenced in fn_auto_heal_cluster source
  SELECT pg_get_functiondef(p.oid)
    INTO v_heal_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='fn_auto_heal_cluster'
  LIMIT 1;

  IF v_heal_def IS NOT NULL THEN
    SELECT COALESCE(array_agg(DISTINCT m[1]), ARRAY[]::text[])
      INTO v_heal_clusters
    FROM regexp_matches(v_heal_def, $re$_cluster\s*=\s*'([A-Z_]+)'$re$, 'g') AS m;
  END IF;

  -- Clusters present in view (defined or produced) but not handled in heal
  SELECT COALESCE(array_agg(c), ARRAY[]::text[])
    INTO v_unhandled_in_heal
  FROM unnest(v_view_clusters_all) c
  WHERE c <> ALL(v_heal_clusters)
    AND c NOT IN ('OTHER','NON_BUILDING_PACKAGE','QUALITY_THRESHOLD_NOT_MET');

  -- Clusters referenced in heal but not produced/defined by view
  SELECT COALESCE(array_agg(c), ARRAY[]::text[])
    INTO v_unknown_in_heal
  FROM unnest(v_heal_clusters) c
  WHERE c <> ALL(v_view_clusters_all);

  -- Required functions present
  SELECT COALESCE(array_agg(routine_name::text), ARRAY[]::text[])
    INTO v_present_fns
  FROM information_schema.routines
  WHERE routine_schema='public' AND routine_name = ANY(v_required_fns);

  SELECT COALESCE(array_agg(f), ARRAY[]::text[])
    INTO v_missing_fns
  FROM unnest(v_required_fns) f
  WHERE f <> ALL(v_present_fns);

  -- Build warnings
  IF array_length(v_missing_cols,1) IS NOT NULL THEN
    v_warnings := v_warnings || jsonb_build_object(
      'code','VIEW_COLUMNS_MISSING','severity','high',
      'detail', to_jsonb(v_missing_cols));
  END IF;
  IF array_length(v_unknown_in_heal,1) IS NOT NULL THEN
    v_warnings := v_warnings || jsonb_build_object(
      'code','HEAL_CLUSTER_NOT_IN_VIEW','severity','high',
      'detail', to_jsonb(v_unknown_in_heal));
  END IF;
  IF array_length(v_unhandled_in_heal,1) IS NOT NULL THEN
    v_warnings := v_warnings || jsonb_build_object(
      'code','VIEW_CLUSTER_NOT_HANDLED','severity','medium',
      'detail', to_jsonb(v_unhandled_in_heal));
  END IF;
  IF array_length(v_missing_fns,1) IS NOT NULL THEN
    v_warnings := v_warnings || jsonb_build_object(
      'code','FUNCTIONS_MISSING','severity','high',
      'detail', to_jsonb(v_missing_fns));
  END IF;

  v_status := CASE
    WHEN v_warnings = '[]'::jsonb THEN 'ok'
    WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_warnings) e WHERE e->>'severity'='high') THEN 'fail'
    ELSE 'warn'
  END;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'status', v_status,
    'view_columns_present', to_jsonb(v_present_cols),
    'view_columns_missing', to_jsonb(COALESCE(v_missing_cols, ARRAY[]::text[])),
    'view_clusters', to_jsonb(v_view_clusters_all),
    'view_clusters_produced', to_jsonb(v_view_clusters_produced),
    'view_clusters_defined', to_jsonb(v_view_clusters_defined),
    'heal_clusters', to_jsonb(v_heal_clusters),
    'view_cluster_not_handled', to_jsonb(COALESCE(v_unhandled_in_heal, ARRAY[]::text[])),
    'heal_cluster_not_in_view', to_jsonb(COALESCE(v_unknown_in_heal, ARRAY[]::text[])),
    'functions_missing', to_jsonb(COALESCE(v_missing_fns, ARRAY[]::text[])),
    'warnings', v_warnings
  );
END;
$function$;