
CREATE OR REPLACE FUNCTION public.admin_bulk_publish_done_packages(
  p_cap int DEFAULT 18,
  p_default_price_cents int DEFAULT 2490,
  p_default_access_months int DEFAULT 24
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg record;
  v_processed int := 0;
  v_promoted int := 0;
  v_skipped int := 0;
  v_failed int := 0;
  v_results jsonb := '[]'::jsonb;
  v_err_msg text;
  v_err_code text;
  v_cancelled int;
BEGIN
  -- Service-role or admin only
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  FOR v_pkg IN
    SELECT id, title, status, is_published, product_id, integrity_passed
    FROM course_packages
    WHERE status='done' AND COALESCE(is_published,false)=false
    ORDER BY updated_at ASC
    LIMIT GREATEST(p_cap,0)
  LOOP
    v_processed := v_processed + 1;
    BEGIN
      PERFORM set_config('app.transition_source','admin_bulk_publish_done', true);

      -- Cancel offene Jobs
      UPDATE job_queue
         SET status='cancelled', completed_at=now(),
             last_error='admin_bulk_publish_done: package manually published'
       WHERE package_id = v_pkg.id
         AND status IN ('pending','queued','processing','running','batch_pending','retry_scheduled');
      GET DIAGNOSTICS v_cancelled = ROW_COUNT;

      -- Tail-Steps schliessen
      UPDATE package_steps
         SET status='done'::step_status, finished_at=now(),
             meta = COALESCE(meta,'{}'::jsonb)
                    || jsonb_build_object('force_published_at', now()::text, 'reason','admin_bulk_publish_done')
       WHERE package_id = v_pkg.id
         AND step_key IN ('auto_publish','quality_council','run_integrity_check')
         AND status NOT IN ('done'::step_status,'skipped'::step_status);

      -- Status -> published
      UPDATE course_packages
         SET status='published', is_published=true,
             published_at = COALESCE(published_at, now()),
             blocked_reason=NULL, last_error=NULL, updated_at=now()
       WHERE id = v_pkg.id;

      -- Product aktivieren/verknuepfen
      IF v_pkg.product_id IS NOT NULL THEN
        UPDATE products
           SET status='active', visibility='public',
               active_package_id=COALESCE(active_package_id, v_pkg.id),
               updated_at=now()
         WHERE id = v_pkg.product_id;

        -- Aktiven Default-Price sicherstellen
        IF NOT EXISTS (SELECT 1 FROM product_prices WHERE product_id=v_pkg.product_id AND active=true) THEN
          INSERT INTO product_prices(product_id, currency, amount_cents, billing_type, access_months, active)
          VALUES (v_pkg.product_id, 'EUR', p_default_price_cents, 'one_time', p_default_access_months, true);
        END IF;
      END IF;

      INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
      VALUES ('admin_bulk_publish_done','admin_bulk_publish_done','package', v_pkg.id::text,'applied',
              format('Published done-package "%s" (cancelled %s jobs)', v_pkg.title, v_cancelled),
              jsonb_build_object('package_id', v_pkg.id, 'cancelled_jobs', v_cancelled));

      v_promoted := v_promoted + 1;
      v_results := v_results || jsonb_build_object(
        'package_id', v_pkg.id, 'title', v_pkg.title,
        'result', 'promoted', 'cancelled_jobs', v_cancelled);
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT, v_err_code = RETURNED_SQLSTATE;
      v_failed := v_failed + 1;
      v_results := v_results || jsonb_build_object(
        'package_id', v_pkg.id, 'title', v_pkg.title,
        'result','failed','reason_code', v_err_code,
        'reason', left(v_err_msg, 500));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'processed_count', v_processed,
    'promoted_count', v_promoted,
    'skipped_count', v_skipped,
    'failed_count', v_failed,
    'wip_cap', p_cap,
    'results', v_results
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_bulk_publish_done_packages(int,int,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bulk_publish_done_packages(int,int,int) TO service_role;
