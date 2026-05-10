
-- ROLLBACK HINT:
--   DROP TRIGGER IF EXISTS trg_post_publish_growth_fanout ON public.course_packages;
--   DROP FUNCTION IF EXISTS public.fn_post_publish_growth_fanout() CASCADE;
--   DROP FUNCTION IF EXISTS public.admin_backfill_post_publish_growth(uuid) CASCADE;

-- =============================================================
-- 1) Fanout function — enqueues 9 growth jobs idempotently
-- =============================================================
CREATE OR REPLACE FUNCTION public.fn_post_publish_growth_fanout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_jobs text[] := ARRAY[
    'package_auto_generate_seo_suite',
    'seo_sitemap_refresh',
    'seo_indexnow_submit',
    'package_post_publish_blog',
    'seo_internal_links',
    'package_og_image_generate',
    'package_distribution_plan',
    'package_campaign_assets_generate',
    'package_email_sequence_enroll'
  ];
  v_jt text;
  v_enqueued int := 0;
  v_skipped int := 0;
  v_idem text;
  v_reg record;
BEGIN
  -- Only fire on REAL transition into published (status='published' AND is_published=true)
  IF NOT (NEW.status = 'published' AND COALESCE(NEW.is_published, false) = true) THEN
    RETURN NEW;
  END IF;

  -- Skip if neither status nor is_published actually changed (idempotent on no-op updates)
  IF (OLD.status IS NOT DISTINCT FROM NEW.status)
     AND (OLD.is_published IS NOT DISTINCT FROM NEW.is_published) THEN
    RETURN NEW;
  END IF;

  -- Skip if previous state was already published (no transition)
  IF (OLD.status = 'published' AND COALESCE(OLD.is_published, false) = true) THEN
    RETURN NEW;
  END IF;

  -- Enqueue each job with stable idempotency key
  FOREACH v_jt IN ARRAY v_jobs LOOP
    v_idem := format('post_publish_growth:%s:%s', NEW.id, v_jt);

    SELECT lane, pool, requires_package_id
      INTO v_reg
      FROM public.ops_job_type_registry
     WHERE job_type = v_jt AND is_active = true
     LIMIT 1;

    IF NOT FOUND THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    BEGIN
      INSERT INTO public.job_queue
        (job_type, job_name, lane, worker_pool, package_id, payload, status, idempotency_key, priority, meta)
      VALUES
        (v_jt,
         v_jt,
         v_reg.lane,
         COALESCE(v_reg.pool, 'core'),
         NEW.id,
         jsonb_build_object(
           'package_id', NEW.id,
           'curriculum_id', NEW.curriculum_id,
           'package_key', NEW.package_key,
           'source', 'post_publish_growth_fanout'
         ),
         'pending',
         v_idem,
         50,
         jsonb_build_object(
           'enqueue_source', 'post_publish_growth_fanout',
           'idempotency_key', v_idem
         ))
      ON CONFLICT (idempotency_key) WHERE (idempotency_key IS NOT NULL AND status = ANY (ARRAY['pending'::text,'processing'::text]))
        DO NOTHING;

      IF FOUND THEN
        v_enqueued := v_enqueued + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, error_message, metadata)
      VALUES ('post_publish_growth_enqueue_error', 'trg_post_publish_growth_fanout', 'package', NEW.id::text, 'error', SQLERRM,
              jsonb_build_object('job_type', v_jt, 'idempotency_key', v_idem));
    END;
  END LOOP;

  -- Insert package_published conversion event (top-level package_id is generated column from metadata)
  BEGIN
    INSERT INTO public.conversion_events
      (event_type, curriculum_id, page_path, metadata, anonymous_id, session_id)
    VALUES
      ('package_published',
       NEW.curriculum_id,
       NULL,
       jsonb_build_object(
         'package_id', NEW.id,
         'package_key', NEW.package_key,
         'curriculum_id', NEW.curriculum_id,
         'source', 'post_publish_growth_fanout'
       ),
       'system',
       'system');
  EXCEPTION WHEN OTHERS THEN
    -- never fail publish on tracking error
    INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, error_message)
    VALUES ('post_publish_growth_event_error', 'trg_post_publish_growth_fanout', 'package', NEW.id::text, 'error', SQLERRM);
  END;

  -- Audit
  INSERT INTO public.auto_heal_log
    (action_type, trigger_source, target_type, target_id, result_status, metadata)
  VALUES
    ('post_publish_growth_fanout',
     'trg_post_publish_growth_fanout',
     'package',
     NEW.id::text,
     CASE WHEN v_enqueued = array_length(v_jobs, 1) THEN 'success'
          WHEN v_enqueued = 0 THEN 'noop'
          ELSE 'partial' END,
     jsonb_build_object(
       'package_id', NEW.id,
       'package_key', NEW.package_key,
       'jobs_total', array_length(v_jobs, 1),
       'jobs_enqueued', v_enqueued,
       'jobs_skipped', v_skipped,
       'jobs', v_jobs
     ));

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_post_publish_growth_fanout() FROM PUBLIC;

-- =============================================================
-- 2) Trigger — fires only on real transition INTO published
-- =============================================================
DROP TRIGGER IF EXISTS trg_post_publish_growth_fanout ON public.course_packages;

CREATE TRIGGER trg_post_publish_growth_fanout
AFTER UPDATE OF status, is_published ON public.course_packages
FOR EACH ROW
WHEN (NEW.status = 'published'
      AND COALESCE(NEW.is_published, false) = true
      AND (OLD.status IS DISTINCT FROM NEW.status
           OR OLD.is_published IS DISTINCT FROM NEW.is_published))
EXECUTE FUNCTION public.fn_post_publish_growth_fanout();

-- =============================================================
-- 3) Admin RPC — manual re-trigger for a single package (admin-gated)
-- =============================================================
CREATE OR REPLACE FUNCTION public.admin_backfill_post_publish_growth(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg record;
  v_jobs text[] := ARRAY[
    'package_auto_generate_seo_suite','seo_sitemap_refresh','seo_indexnow_submit',
    'package_post_publish_blog','seo_internal_links','package_og_image_generate',
    'package_distribution_plan','package_campaign_assets_generate','package_email_sequence_enroll'
  ];
  v_jt text;
  v_idem text;
  v_enqueued int := 0;
  v_skipped int := 0;
  v_reg record;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT id, status, is_published, curriculum_id, package_key
    INTO v_pkg
    FROM public.course_packages WHERE id = p_package_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'package not found: %', p_package_id;
  END IF;

  IF v_pkg.status <> 'published' OR COALESCE(v_pkg.is_published, false) = false THEN
    RAISE EXCEPTION 'package % not in published state (status=%, is_published=%)', p_package_id, v_pkg.status, v_pkg.is_published;
  END IF;

  FOREACH v_jt IN ARRAY v_jobs LOOP
    v_idem := format('post_publish_growth:%s:%s', v_pkg.id, v_jt);

    SELECT lane, pool INTO v_reg FROM public.ops_job_type_registry WHERE job_type = v_jt AND is_active = true LIMIT 1;
    IF NOT FOUND THEN v_skipped := v_skipped + 1; CONTINUE; END IF;

    BEGIN
      INSERT INTO public.job_queue
        (job_type, job_name, lane, worker_pool, package_id, payload, status, idempotency_key, priority, meta)
      VALUES
        (v_jt, v_jt, v_reg.lane, COALESCE(v_reg.pool,'core'), v_pkg.id,
         jsonb_build_object('package_id', v_pkg.id, 'curriculum_id', v_pkg.curriculum_id,
                            'package_key', v_pkg.package_key, 'source', 'admin_backfill_post_publish_growth'),
         'pending', v_idem, 50,
         jsonb_build_object('enqueue_source','admin_backfill_post_publish_growth','idempotency_key', v_idem))
      ON CONFLICT (idempotency_key) WHERE (idempotency_key IS NOT NULL AND status = ANY (ARRAY['pending'::text,'processing'::text]))
        DO NOTHING;
      IF FOUND THEN v_enqueued := v_enqueued + 1; ELSE v_skipped := v_skipped + 1; END IF;
    EXCEPTION WHEN OTHERS THEN v_skipped := v_skipped + 1;
    END;
  END LOOP;

  INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, metadata)
  VALUES ('post_publish_growth_backfill', 'admin_backfill_post_publish_growth', 'package', v_pkg.id::text,
          CASE WHEN v_enqueued = array_length(v_jobs,1) THEN 'success' WHEN v_enqueued = 0 THEN 'noop' ELSE 'partial' END,
          jsonb_build_object('actor', auth.uid(), 'jobs_enqueued', v_enqueued, 'jobs_skipped', v_skipped));

  RETURN jsonb_build_object('package_id', v_pkg.id, 'enqueued', v_enqueued, 'skipped', v_skipped, 'jobs_total', array_length(v_jobs,1));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_backfill_post_publish_growth(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_backfill_post_publish_growth(uuid) TO authenticated;

-- =============================================================
-- 4) Smoke
-- =============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_post_publish_growth_fanout') THEN
    RAISE EXCEPTION 'trigger not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_post_publish_growth_fanout') THEN
    RAISE EXCEPTION 'function not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'admin_backfill_post_publish_growth') THEN
    RAISE EXCEPTION 'admin RPC not created';
  END IF;
END$$;

INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, result_status, metadata)
VALUES ('post_publish_growth_install', 'migration', 'system', 'success',
        jsonb_build_object('migration','growth_fanout_trigger_v1','jobs',9));
