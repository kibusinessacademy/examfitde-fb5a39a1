CREATE OR REPLACE FUNCTION public.fn_package_has_active_stripe_price(p_package_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.course_packages cp
    JOIN public.product_prices pp ON pp.product_id = cp.product_id
    WHERE cp.id = p_package_id AND cp.product_id IS NOT NULL
      AND pp.active = true AND pp.stripe_price_id IS NOT NULL
  );
$$;
REVOKE ALL ON FUNCTION public.fn_package_has_active_stripe_price(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_package_has_active_stripe_price(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_terminate_pricing_blocked_publish_jobs()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_pkg record;
  v_cancelled int;
  v_step_failed int;
  v_pkg_count int := 0;
  v_jobs_total int := 0;
  v_results jsonb := '[]'::jsonb;
  v_system_uuid uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  v_actor uuid := COALESCE(auth.uid(), v_system_uuid);
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  FOR v_pkg IN
    SELECT DISTINCT jq.package_id, cp.title
    FROM public.job_queue jq
    JOIN public.course_packages cp ON cp.id = jq.package_id
    WHERE jq.status = 'pending'
      AND jq.job_type = 'package_auto_publish'
      AND NOT public.fn_package_has_active_stripe_price(jq.package_id)
  LOOP
    UPDATE public.job_queue
    SET status = 'cancelled',
        last_error = 'PRICING_HARD_GATE_BLOCKED: missing active stripe_price_id (pre-claim termination)',
        updated_at = now()
    WHERE package_id = v_pkg.package_id AND job_type = 'package_auto_publish' AND status = 'pending';
    GET DIAGNOSTICS v_cancelled = ROW_COUNT;
    v_jobs_total := v_jobs_total + v_cancelled;

    UPDATE public.package_steps
    SET status = 'failed',
        last_error = 'PRICING_HARD_GATE_BLOCKED: missing active stripe_price_id',
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'block_reason', 'pricing_config_missing',
          'terminated_at', now(),
          'terminated_by', 'admin_terminate_pricing_blocked_publish_jobs'
        )
    WHERE package_id = v_pkg.package_id AND step_key = 'auto_publish' AND status NOT IN ('done','failed');
    GET DIAGNOSTICS v_step_failed = ROW_COUNT;

    UPDATE public.course_packages
    SET blocked_reason = 'pricing_config_missing',
        stuck_reason = 'PRICING_HARD_GATE_BLOCKED: no active stripe_price_id'
    WHERE id = v_pkg.package_id AND COALESCE(blocked_reason, '') = '';

    INSERT INTO public.heal_permanent_fix_tasks(
      pattern_key, cluster, package_id, priority, title, description, status, created_by
    ) VALUES (
      'pricing_missing_stripe_price', 'pricing', v_pkg.package_id, 'high',
      'Stripe-Preis fehlt: ' || COALESCE(v_pkg.title, v_pkg.package_id::text),
      'Paket kann nicht published werden — kein aktiver Stripe-Preis verknüpft. Empfehlung: Stripe-Preis via stripe_price_sync Pipeline anlegen ODER Paket aus Publish-Queue entfernen. (product_prices.active=true + stripe_price_id Pflicht)',
      'open', v_actor
    )
    ON CONFLICT DO NOTHING;

    INSERT INTO public.auto_heal_log(action_type, result_status, target_type, target_id, metadata)
    VALUES ('pricing_blocked_publish_terminated', 'applied', 'course_package', v_pkg.package_id::text,
      jsonb_build_object('title', v_pkg.title, 'jobs_cancelled', v_cancelled, 'step_failed', v_step_failed));

    v_pkg_count := v_pkg_count + 1;
    v_results := v_results || jsonb_build_object('package_id', v_pkg.package_id, 'title', v_pkg.title, 'jobs_cancelled', v_cancelled);
  END LOOP;

  RETURN jsonb_build_object('status','ok','packages_processed',v_pkg_count,'jobs_cancelled_total',v_jobs_total,'results',v_results);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_terminate_pricing_blocked_publish_jobs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_terminate_pricing_blocked_publish_jobs() TO service_role;

CREATE OR REPLACE FUNCTION public.trg_block_publish_enqueue_without_pricing()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.job_type = 'package_auto_publish'
     AND NEW.status IN ('pending','queued')
     AND NEW.package_id IS NOT NULL
     AND NOT public.fn_package_has_active_stripe_price(NEW.package_id)
  THEN
    INSERT INTO public.auto_heal_log(action_type, result_status, target_type, target_id, metadata)
    VALUES ('publish_enqueue_blocked_no_pricing','blocked','course_package',NEW.package_id::text,
      jsonb_build_object('job_type', NEW.job_type, 'reason', 'PRICING_HARD_GATE_PRECONDITION'));
    NEW.status := 'cancelled';
    NEW.last_error := 'PRICING_HARD_GATE_PRECONDITION: no active stripe_price_id — enqueue blocked';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_publish_enqueue_without_pricing ON public.job_queue;
CREATE TRIGGER trg_block_publish_enqueue_without_pricing
  BEFORE INSERT ON public.job_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_block_publish_enqueue_without_pricing();

SELECT public.admin_terminate_pricing_blocked_publish_jobs() AS heal_result;