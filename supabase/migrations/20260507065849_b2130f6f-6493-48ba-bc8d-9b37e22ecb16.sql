-- ===========================================================
-- Phase 2: Forensik-Tiefen-Audit + Repair RPCs
-- ===========================================================

-- A) Summary RPC (globale Zähler)
CREATE OR REPLACE FUNCTION public.admin_get_forensic_audit_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  q_no_jobs   bigint;
  ssot_drift  bigint;
  stale_proc  bigint;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  SELECT COUNT(*) INTO q_no_jobs
  FROM public.ops_queued_step_without_job
  WHERE has_active_job = false AND dag_ready = true;

  SELECT COUNT(*) INTO ssot_drift FROM public.ops_ssot_step_drift;

  SELECT COUNT(*) INTO stale_proc
  FROM public.job_queue
  WHERE status = 'processing'
    AND updated_at < now() - interval '20 minutes';

  RETURN jsonb_build_object(
    'generated_at', now(),
    'classes', jsonb_build_array(
      jsonb_build_object('class','queued_no_jobs','count',q_no_jobs,
        'severity', CASE WHEN q_no_jobs>50 THEN 'P0' WHEN q_no_jobs>10 THEN 'P1' WHEN q_no_jobs>0 THEN 'P2' ELSE 'info' END,
        'description','Queued Steps ohne aktiven Job (DAG-ready)'),
      jsonb_build_object('class','ssot_step_drift','count',ssot_drift,
        'severity', CASE WHEN ssot_drift>500 THEN 'P0' WHEN ssot_drift>50 THEN 'P1' WHEN ssot_drift>0 THEN 'P2' ELSE 'info' END,
        'description','Step-Status widerspricht track_step_applicability'),
      jsonb_build_object('class','stale_processing','count',stale_proc,
        'severity', CASE WHEN stale_proc>10 THEN 'P0' WHEN stale_proc>0 THEN 'P1' ELSE 'info' END,
        'description','processing-Jobs ohne Update > 20 Min')
    )
  );
END $$;

-- B) Detail RPC
CREATE OR REPLACE FUNCTION public.admin_get_forensic_audit_detail(
  p_class text,
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  rows jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  IF p_class = 'queued_no_jobs' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO rows
    FROM (
      SELECT package_id, step_key, expected_job_type, pkg_status, pkg_priority, step_updated_at, dag_ready
      FROM public.ops_queued_step_without_job
      WHERE has_active_job = false
      ORDER BY dag_ready DESC, pkg_priority DESC NULLS LAST, step_updated_at ASC
      LIMIT GREATEST(1, LEAST(p_limit, 500))
    ) t;
  ELSIF p_class = 'ssot_step_drift' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO rows
    FROM (
      SELECT package_id, package_title, track, package_status, step_key, step_status, drift_type, step_updated_at
      FROM public.ops_ssot_step_drift
      ORDER BY (drift_type='FALSE_SKIP') DESC, track, step_key
      LIMIT GREATEST(1, LEAST(p_limit, 500))
    ) t;
  ELSIF p_class = 'stale_processing' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO rows
    FROM (
      SELECT id, job_type, package_id, status, updated_at, started_at, attempts
      FROM public.job_queue
      WHERE status='processing' AND updated_at < now() - interval '20 minutes'
      ORDER BY updated_at ASC
      LIMIT GREATEST(1, LEAST(p_limit, 500))
    ) t;
  ELSE
    RAISE EXCEPTION 'unknown_class: %', p_class;
  END IF;

  RETURN jsonb_build_object('class', p_class, 'rows', rows);
END $$;

-- C) Repair RPC (Dry-Run + Real-Run, hartes Cap)
CREATE OR REPLACE FUNCTION public.admin_repair_forensic_drift(
  p_class   text,
  p_dry_run boolean DEFAULT true,
  p_cap     integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _cap int := GREATEST(1, LEAST(p_cap, 50));
  _processed int := 0;
  _details jsonb := '[]'::jsonb;
  _r record;
BEGIN
  IF NOT public.has_role(_uid,'admin'::app_role) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  IF p_class = 'queued_no_jobs' THEN
    FOR _r IN
      SELECT package_id, step_key, expected_job_type
      FROM public.ops_queued_step_without_job
      WHERE has_active_job = false AND dag_ready = true
      ORDER BY pkg_priority DESC NULLS LAST, step_updated_at ASC
      LIMIT _cap
    LOOP
      IF NOT p_dry_run THEN
        INSERT INTO public.job_queue(job_type, package_id, status, payload, enqueue_source)
        VALUES(_r.expected_job_type, _r.package_id, 'pending',
               jsonb_build_object('forensic_repair', true, 'step_key', _r.step_key),
               'forensic_drift_repair');
      END IF;
      _details := _details || jsonb_build_object('package_id',_r.package_id,'step_key',_r.step_key,'job_type',_r.expected_job_type,'action','enqueue');
      _processed := _processed + 1;
    END LOOP;

  ELSIF p_class = 'ssot_step_drift' THEN
    FOR _r IN
      SELECT package_id, step_key, drift_type
      FROM public.ops_ssot_step_drift
      ORDER BY (drift_type='FALSE_SKIP') DESC, package_id
      LIMIT _cap
    LOOP
      IF NOT p_dry_run THEN
        IF _r.drift_type = 'FALSE_SKIP' THEN
          UPDATE public.package_steps
            SET status='queued'::step_status, updated_at=now()
          WHERE package_id=_r.package_id AND step_key=_r.step_key AND status='skipped'::step_status;
        ELSIF _r.drift_type = 'FALSE_RUN' THEN
          UPDATE public.package_steps
            SET status='skipped'::step_status, updated_at=now()
          WHERE package_id=_r.package_id AND step_key=_r.step_key
            AND status NOT IN ('skipped'::step_status,'done'::step_status);
        END IF;
      END IF;
      _details := _details || jsonb_build_object('package_id',_r.package_id,'step_key',_r.step_key,'drift_type',_r.drift_type,'action','correct_status');
      _processed := _processed + 1;
    END LOOP;

  ELSIF p_class = 'stale_processing' THEN
    FOR _r IN
      SELECT id, job_type, package_id
      FROM public.job_queue
      WHERE status='processing' AND updated_at < now() - interval '20 minutes'
      ORDER BY updated_at ASC
      LIMIT _cap
    LOOP
      IF NOT p_dry_run THEN
        UPDATE public.job_queue
          SET status='failed', last_error='forensic_drift_repair: stale processing > 20min', updated_at=now()
        WHERE id=_r.id AND status='processing';
      END IF;
      _details := _details || jsonb_build_object('job_id',_r.id,'job_type',_r.job_type,'package_id',_r.package_id,'action','mark_failed');
      _processed := _processed + 1;
    END LOOP;

  ELSE
    RAISE EXCEPTION 'unknown_class: %', p_class;
  END IF;

  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, result_detail, metadata)
  VALUES('forensic_drift_repair', 'system',
         CASE WHEN p_dry_run THEN 'dry_run' ELSE (CASE WHEN _processed>0 THEN 'success' ELSE 'noop' END) END,
         format('class=%s processed=%s cap=%s dry_run=%s', p_class, _processed, _cap, p_dry_run),
         jsonb_build_object('class',p_class,'processed',_processed,'cap',_cap,'dry_run',p_dry_run,'user_id',_uid,'details',_details));

  RETURN jsonb_build_object('ok',true,'class',p_class,'dry_run',p_dry_run,'cap',_cap,
                            'processed',_processed,'details',_details);
END $$;