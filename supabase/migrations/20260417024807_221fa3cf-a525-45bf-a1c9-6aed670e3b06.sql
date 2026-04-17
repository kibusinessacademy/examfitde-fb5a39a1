-- Verwende die SSOT-konforme requeue_failed_jobs Funktion (SECURITY DEFINER, umgeht Terminal-Status-Guard)
DO $$
DECLARE
  v_requeued integer;
BEGIN
  SELECT public.requeue_failed_jobs() INTO v_requeued;
  
  INSERT INTO public.admin_actions (action, scope, payload)
  VALUES (
    'manual_unblock_via_requeue_failed_jobs',
    'pipeline',
    jsonb_build_object(
      'requeued_count', v_requeued,
      'reason', 'manual_bypass_runner_optimization',
      'timestamp', now()
    )
  );
END $$;