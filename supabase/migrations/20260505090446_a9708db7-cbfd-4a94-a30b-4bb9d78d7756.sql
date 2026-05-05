-- 1) MANUAL BYPASS
DO $$
DECLARE v_count int := 0; v_row record;
BEGIN
  FOR v_row IN
    SELECT ps.package_id, ps.step_key, cp.status AS pkg_status
    FROM package_steps ps JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.status='pending_enqueue'
      AND cp.status IN ('done','published','blocked','queued','planning')
  LOOP
    BEGIN
      UPDATE package_steps
      SET status='skipped'::step_status, updated_at=now(),
          meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
            'phantom_pending_enqueue_bypass_skipped_at', now(),
            'phantom_bypass_reason','package_status_not_building',
            'package_status_at_bypass', v_row.pkg_status,
            'allow_regression', true,
            'allow_regression_by','pipeline_loop_hardening_v4')
      WHERE package_id=v_row.package_id AND step_key=v_row.step_key;
      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.auto_heal_log(action_type,trigger_source,target_type,target_id,result_status,metadata)
      VALUES ('manual_bypass_phantom_pending_enqueue_failed','migration_v4','package',v_row.package_id::text,'failed',
              jsonb_build_object('step_key',v_row.step_key,'error',SQLERRM,'sqlstate',SQLSTATE));
    END;
  END LOOP;
  INSERT INTO public.auto_heal_log(action_type,trigger_source,target_type,target_id,result_status,metadata)
  VALUES ('manual_bypass_phantom_pending_enqueue','migration_v4','system','global','healed',
          jsonb_build_object('skipped_steps',v_count));
END $$;

-- 2) Drop + recreate resolver with package-status gate, preserve TABLE return shape
DROP FUNCTION IF EXISTS public.fn_resolve_pending_enqueue_steps();

CREATE OR REPLACE FUNCTION public.fn_resolve_pending_enqueue_steps()
RETURNS TABLE(out_package_id uuid, out_step_key text, out_action text, out_detail text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row record;
  v_job_type text;
  v_skipped_status int := 0;
BEGIN
  FOR v_row IN
    SELECT ps.package_id, ps.step_key, cp.status AS pkg_status
    FROM package_steps ps JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.status='pending_enqueue' AND ps.updated_at < now() - interval '5 minutes'
    LIMIT 200
  LOOP
    IF v_row.pkg_status <> 'building' THEN
      v_skipped_status := v_skipped_status + 1;
      out_package_id := v_row.package_id; out_step_key := v_row.step_key;
      out_action := 'skipped_status'; out_detail := 'pkg_status='||v_row.pkg_status;
      RETURN NEXT;
      CONTINUE;
    END IF;
    BEGIN
      v_job_type := 'package_'||v_row.step_key;
      INSERT INTO public.job_queue(job_type,package_id,status,priority,payload,created_at)
      VALUES (v_job_type,v_row.package_id,'queued',5,
              jsonb_build_object('step_key',v_row.step_key,'package_id',v_row.package_id,
                                 'enqueue_source','pending_enqueue_resolver'),
              now())
      ON CONFLICT DO NOTHING;
      UPDATE public.package_steps SET status='queued'::step_status, updated_at=now()
      WHERE package_id=v_row.package_id AND step_key=v_row.step_key AND status='pending_enqueue';
      out_package_id := v_row.package_id; out_step_key := v_row.step_key;
      out_action := 'resolved'; out_detail := v_job_type;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      out_package_id := v_row.package_id; out_step_key := v_row.step_key;
      out_action := 'error'; out_detail := SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;

  IF v_skipped_status > 0 THEN
    INSERT INTO public.auto_heal_log(action_type,trigger_source,target_type,target_id,result_status,metadata)
    VALUES ('phantom_pending_enqueue_skipped','fn_resolve_pending_enqueue_steps','system','global','skipped',
            jsonb_build_object('skipped_count',v_skipped_status,'reason','package_status_not_building'));
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_resolve_pending_enqueue_steps() TO service_role;

-- 3) Zombie log throttle
CREATE TABLE IF NOT EXISTS public.zombie_log_throttle (
  package_id uuid PRIMARY KEY,
  zombie_class text NOT NULL,
  last_logged_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.zombie_log_throttle ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_full_access_zombie_throttle" ON public.zombie_log_throttle;
CREATE POLICY "service_role_full_access_zombie_throttle"
  ON public.zombie_log_throttle FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.fn_should_log_zombie(p_package_id uuid, p_zombie_class text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_last timestamptz;
BEGIN
  SELECT last_logged_at INTO v_last FROM public.zombie_log_throttle WHERE package_id=p_package_id;
  IF v_last IS NOT NULL AND v_last > now() - interval '30 minutes' THEN RETURN false; END IF;
  INSERT INTO public.zombie_log_throttle(package_id,zombie_class,last_logged_at)
  VALUES (p_package_id,p_zombie_class,now())
  ON CONFLICT (package_id) DO UPDATE SET zombie_class=EXCLUDED.zombie_class, last_logged_at=now();
  RETURN true;
END; $$;
GRANT EXECUTE ON FUNCTION public.fn_should_log_zombie(uuid,text) TO service_role;

NOTIFY pgrst, 'reload schema';