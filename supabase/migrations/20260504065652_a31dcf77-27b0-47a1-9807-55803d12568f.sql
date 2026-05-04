
CREATE OR REPLACE FUNCTION public.fn_reconcile_pricing_heal_tasks()
RETURNS TABLE(closed_count int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  v_task RECORD;
BEGIN
  FOR v_task IN
    SELECT t.id, t.package_id
    FROM heal_permanent_fix_tasks t
    WHERE t.pattern_key = 'pricing_missing_stripe_price'
      AND t.status IN ('open','in_progress')
      AND t.package_id IS NOT NULL
      AND public.fn_package_has_active_stripe_price(t.package_id) = true
  LOOP
    UPDATE heal_permanent_fix_tasks
       SET status = 'done',
           completed_at = now(),
           notes = COALESCE(notes,'') ||
             E'\n[auto] pricing reconciled: active stripe_price detected'
     WHERE id = v_task.id;

    INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata)
    VALUES ('pricing_task_auto_closed','heal_task', v_task.id::text, 'success',
            jsonb_build_object('package_id', v_task.package_id, 'reason','active_stripe_price_present'));

    v_count := v_count + 1;
  END LOOP;

  RETURN QUERY SELECT v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_reconcile_pricing_heal_tasks() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reconcile_pricing_heal_tasks() TO service_role;

SELECT closed_count FROM public.fn_reconcile_pricing_heal_tasks();
