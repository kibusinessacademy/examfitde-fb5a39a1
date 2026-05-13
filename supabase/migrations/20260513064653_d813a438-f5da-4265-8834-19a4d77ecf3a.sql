DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT q.package_id, q.package_key, q.next_tail_step, q.reconciler_verdict,
           g.gate_class, q.approved_q, q.track
    FROM public.v_queued_tail_without_job q
    LEFT JOIN public.v_publish_readiness_gate g ON g.package_id = q.package_id
    LIMIT 500
  LOOP
    INSERT INTO public.auto_heal_log(action_type,target_type,target_id,result_status,metadata)
    VALUES ('queued_tail_x_gate_peek_2026_05_13','package',r.package_id,'observed',to_jsonb(r));
  END LOOP;
END$$;