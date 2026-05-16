
CREATE OR REPLACE FUNCTION public.admin_pricing_activation_backfill(
  _limit int DEFAULT 200, _dry_run boolean DEFAULT false
) RETURNS TABLE(activated_count int, skipped_count int, sample jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  _activated int := 0; _skipped int := 0; _sample jsonb := '[]'::jsonb; _row record;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  FOR _row IN
    SELECT v.product_id, v.package_id, v.product_slug
    FROM v_pricing_activation_status v
    WHERE v.activation_state='ELIGIBLE_FOR_ACTIVATION'
    ORDER BY v.package_title
    LIMIT GREATEST(_limit,1)
  LOOP
    IF _dry_run THEN
      _skipped := _skipped + 1;
    ELSE
      UPDATE products SET status='active', visibility='public', updated_at=now()
       WHERE id=_row.product_id AND status='draft' AND visibility='private';
      IF FOUND THEN
        _activated := _activated + 1;
        INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata)
        VALUES('m8_pricing_activation','product',_row.product_id,'completed',
               jsonb_build_object('package_id',_row.package_id,'slug',_row.product_slug));
      ELSE
        _skipped := _skipped + 1;
      END IF;
    END IF;
    IF jsonb_array_length(_sample) < 10 THEN
      _sample := _sample || jsonb_build_array(jsonb_build_object(
        'product_id',_row.product_id,'package_id',_row.package_id,
        'slug',_row.product_slug,'dry_run',_dry_run));
    END IF;
  END LOOP;
  INSERT INTO auto_heal_log(action_type, target_type, result_status, metadata)
  VALUES('m8_pricing_activation_run','system','completed',
         jsonb_build_object('activated',_activated,'skipped',_skipped,'dry_run',_dry_run,'limit',_limit));
  RETURN QUERY SELECT _activated, _skipped, _sample;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_auto_activate_product_on_publish()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.status='published' AND NEW.is_published=true
     AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status OR OLD.is_published IS DISTINCT FROM NEW.is_published)
     AND NEW.product_id IS NOT NULL
     AND public.fn_pricing_activation_eligible(NEW.product_id) THEN
    UPDATE products SET status='active', visibility='public', updated_at=now()
     WHERE id=NEW.product_id AND status='draft' AND visibility='private';
    IF FOUND THEN
      INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata)
      VALUES('m8_pricing_activation_auto','product',NEW.product_id,'completed',
             jsonb_build_object('package_id',NEW.id,'trigger','on_publish'));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_m8_cancel_seo_dead_end_jobs()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _n int;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE job_queue SET status='cancelled', updated_at=now(),
         last_error=COALESCE(last_error,'')||' | m8_cancelled_dead_end'
   WHERE job_type='seo_intent_page_generate' AND status='failed'
     AND last_error LIKE '%SEO_DEAD_END%';
  GET DIAGNOSTICS _n = ROW_COUNT;
  INSERT INTO auto_heal_log(action_type, target_type, result_status, metadata)
  VALUES('m8_seo_dead_end_cleanup','system','completed', jsonb_build_object('cancelled',_n));
  RETURN _n;
END;
$$;
