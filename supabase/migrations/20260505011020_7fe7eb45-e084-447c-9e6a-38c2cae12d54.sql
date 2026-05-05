DROP FUNCTION IF EXISTS public.fn_step_already_terminal(text, uuid);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='fn_step_already_terminal'
      AND pg_get_function_identity_arguments(p.oid) = 'p_job_type text, p_package_id uuid, p_payload jsonb'
  ) THEN
    RAISE EXCEPTION 'fn_step_already_terminal(text,uuid,jsonb) missing — abort';
  END IF;
END $$;

INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
VALUES ('fn_step_already_terminal_overload_dropped','migration','system','system','ok',
        'Removed ambiguous 2-arg overload; 3-arg with default payload is canonical',
        jsonb_build_object('sqlstate_fixed','42725','loop','resolve_pending_enqueue_per_row_error'));