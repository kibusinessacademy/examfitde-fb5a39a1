
-- ============================================================
-- 1) AUDIT LOG TABLE for job-type ↔ mode validation decisions
-- ============================================================
CREATE TABLE IF NOT EXISTS public.queue_validation_audit (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  source          text NOT NULL,                  -- 'auto_heal' | 'dry_run' | 'manual'
  cluster         text,
  source_job_id   uuid,
  package_id      uuid,
  job_type        text NOT NULL,
  mode            text,
  is_valid        boolean NOT NULL,
  severity        text,                            -- 'high' | 'medium' | 'info'
  reason          text,
  decision        text NOT NULL,                   -- 'enqueued' | 'skipped' | 'warned' | 'preview_skip' | 'preview_ok'
  payload_excerpt jsonb DEFAULT '{}'::jsonb,
  validation      jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_qva_created_at  ON public.queue_validation_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qva_package     ON public.queue_validation_audit (package_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qva_job_type    ON public.queue_validation_audit (job_type);
CREATE INDEX IF NOT EXISTS idx_qva_source_job  ON public.queue_validation_audit (source_job_id);

ALTER TABLE public.queue_validation_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "qva_admin_read" ON public.queue_validation_audit;
CREATE POLICY "qva_admin_read" ON public.queue_validation_audit
  FOR SELECT TO authenticated
  USING (public.is_admin_user(auth.uid()));

-- No INSERT/UPDATE/DELETE policies → only SECURITY DEFINER functions can write.

-- ============================================================
-- 2) Helper: write a validation audit row (SECURITY DEFINER)
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_log_queue_validation(
  _source text,
  _cluster text,
  _source_job_id uuid,
  _package_id uuid,
  _job_type text,
  _mode text,
  _is_valid boolean,
  _severity text,
  _reason text,
  _decision text,
  _payload_excerpt jsonb,
  _validation jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.queue_validation_audit(
    source, cluster, source_job_id, package_id, job_type, mode,
    is_valid, severity, reason, decision, payload_excerpt, validation
  ) VALUES (
    COALESCE(_source,'auto_heal'), _cluster, _source_job_id, _package_id, _job_type, _mode,
    COALESCE(_is_valid,false), _severity, _reason, COALESCE(_decision,'unknown'),
    COALESCE(_payload_excerpt,'{}'::jsonb), COALESCE(_validation,'{}'::jsonb)
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_log_queue_validation(text,text,uuid,uuid,text,text,boolean,text,text,text,jsonb,jsonb) FROM public, anon, authenticated;

-- ============================================================
-- 3) RPC: read audit (admin-only, paginated)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_get_queue_validation_audit(
  _limit int DEFAULT 100,
  _package_id uuid DEFAULT NULL,
  _source_job_id uuid DEFAULT NULL,
  _only_invalid boolean DEFAULT false
) RETURNS SETOF public.queue_validation_audit
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.queue_validation_audit a
  WHERE public.is_admin_user(auth.uid())
    AND (_package_id IS NULL OR a.package_id = _package_id)
    AND (_source_job_id IS NULL OR a.source_job_id = _source_job_id)
    AND (NOT _only_invalid OR a.is_valid = false)
  ORDER BY a.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(_limit,100), 1000));
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_queue_validation_audit(int, uuid, uuid, boolean) TO authenticated;

-- ============================================================
-- 4) HEALTH ENDPOINT: verify view columns + cluster alignment
--    against fn_auto_heal_cluster source
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_queue_system_healthcheck()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_required_cols text[] := ARRAY[
    'id','job_type','status','package_id','attempts','max_attempts',
    'last_error','error_class','cluster','subcluster','meta','updated_at',
    'recommended_strategy','retryable','is_terminal','is_admin_terminal',
    'is_retry_path_terminal','safe_to_auto_execute'
  ];
  v_present_cols text[];
  v_missing_cols text[];

  v_view_clusters text[];
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

  -- Distinct cluster values from view
  SELECT COALESCE(array_agg(DISTINCT cluster ORDER BY cluster), ARRAY[]::text[])
    INTO v_view_clusters
  FROM public.v_admin_queue_job_classification
  WHERE cluster IS NOT NULL;

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

  -- Clusters present in view but not handled in heal
  SELECT COALESCE(array_agg(c), ARRAY[]::text[])
    INTO v_unhandled_in_heal
  FROM unnest(v_view_clusters) c
  WHERE c <> ALL(v_heal_clusters)
    AND c NOT IN ('OTHER','NON_BUILDING_PACKAGE','QUALITY_THRESHOLD_NOT_MET'); -- non-actionable by design

  -- Clusters referenced in heal but not produced by view
  SELECT COALESCE(array_agg(c), ARRAY[]::text[])
    INTO v_unknown_in_heal
  FROM unnest(v_heal_clusters) c
  WHERE c <> ALL(v_view_clusters);

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
    'view_clusters', to_jsonb(v_view_clusters),
    'heal_clusters', to_jsonb(v_heal_clusters),
    'view_cluster_not_handled', to_jsonb(COALESCE(v_unhandled_in_heal, ARRAY[]::text[])),
    'heal_cluster_not_in_view', to_jsonb(COALESCE(v_unknown_in_heal, ARRAY[]::text[])),
    'functions_missing', to_jsonb(COALESCE(v_missing_fns, ARRAY[]::text[])),
    'warnings', v_warnings
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_queue_system_healthcheck() TO authenticated;

-- ============================================================
-- 5) DRY-RUN: preview repair enqueue with full validation
--    Writes audit rows (decision='preview_skip'|'preview_ok')
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_dry_run_repair_for_package(_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resolver jsonb;
  v_validation jsonb;
  v_job_type text;
  v_mode text;
  v_payload jsonb;
  v_strategy text;
  v_dup_exists boolean;
  v_decision text;
  v_severity text;
  v_reason text;
  v_is_valid boolean;
BEGIN
  IF NOT public.is_admin_user(auth.uid()) THEN
    RETURN jsonb_build_object('error','admin_only');
  END IF;

  v_resolver := public.admin_resolve_repair_strategy_for_package(_package_id);
  v_strategy := v_resolver->>'strategy';
  v_job_type := v_resolver->>'job_type';
  v_payload  := COALESCE(v_resolver->'payload','{}'::jsonb);
  v_mode     := v_payload->>'mode';

  IF v_strategy IN ('no_action_active_job_exists','no_action_no_deficit','manual_review_required','forbidden') OR v_job_type IS NULL THEN
    v_decision := 'preview_skip';
    v_reason   := COALESCE(v_resolver->>'reason', v_strategy);
    v_validation := jsonb_build_object('valid', true, 'mode', v_mode);
    v_is_valid := true;
    v_severity := 'info';
  ELSE
    v_validation := public.admin_validate_repair_job_type(v_job_type, v_payload);
    v_is_valid := COALESCE((v_validation->>'valid')::bool, false);
    v_severity := COALESCE(v_validation->>'severity','info');

    SELECT EXISTS (
      SELECT 1 FROM job_queue j
      WHERE j.package_id = _package_id
        AND j.job_type = v_job_type
        AND j.status = ANY(public.fn_job_active_statuses())
        AND COALESCE(j.payload->>'mode','') = COALESCE(v_mode,'')
    ) INTO v_dup_exists;

    IF NOT v_is_valid AND v_severity = 'high' THEN
      v_decision := 'preview_skip';
      v_reason   := v_validation->>'warning';
    ELSIF v_dup_exists THEN
      v_decision := 'preview_skip';
      v_reason   := 'duplicate_active_job';
    ELSE
      v_decision := 'preview_ok';
      v_reason   := COALESCE(v_resolver->>'reason','ready_to_enqueue');
    END IF;
  END IF;

  PERFORM public.fn_log_queue_validation(
    'dry_run', NULL, NULL, _package_id, COALESCE(v_job_type,'(none)'), v_mode,
    v_is_valid, v_severity, v_reason, v_decision,
    jsonb_build_object('strategy', v_strategy, 'has_payload', v_payload <> '{}'::jsonb),
    v_validation
  );

  RETURN jsonb_build_object(
    'package_id', _package_id,
    'strategy', v_strategy,
    'job_type', v_job_type,
    'mode', v_mode,
    'decision', v_decision,
    'reason', v_reason,
    'severity', v_severity,
    'is_valid', v_is_valid,
    'duplicate_active_job', COALESCE(v_dup_exists, false),
    'resolver', v_resolver,
    'validation', v_validation,
    'preview_only', true,
    'generated_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_dry_run_repair_for_package(uuid) TO authenticated;
