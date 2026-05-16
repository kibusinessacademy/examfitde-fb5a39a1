
INSERT INTO public.ops_job_type_registry (job_type, lane, pool, requires_package_id, is_active, is_governance, description)
VALUES
  ('package_seo_backlog_expand',          'growth', 'core', true, true, false, 'Idempotente SEO-Backlog-Expansion für sellable Paket (Post-Publish Orchestrator).'),
  ('package_license_template_prepare',    'growth', 'core', true, true, false, 'Bereitet Lizenz-Template für gekauftes Paket vor (B2B/B2C).'),
  ('package_post_publish_audit_snapshot', 'growth', 'core', true, true, false, 'Schreibt finalen Readiness-Snapshot ins auto_heal_log nach Post-Publish-Run.')
ON CONFLICT (job_type) DO UPDATE SET is_active=true, description=EXCLUDED.description;

INSERT INTO public.job_type_policies (job_type, can_run_when_not_building, exempt_from_auto_cancel)
VALUES
  ('package_seo_backlog_expand',          true, true),
  ('package_license_template_prepare',    true, true),
  ('package_post_publish_audit_snapshot', true, true)
ON CONFLICT (job_type) DO UPDATE SET can_run_when_not_building=true, exempt_from_auto_cancel=true;

CREATE OR REPLACE FUNCTION public.fn_post_publish_growth_fanout()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_jobs text[] := ARRAY[
    'package_auto_generate_seo_suite','seo_sitemap_refresh','seo_indexnow_submit',
    'package_post_publish_blog','seo_internal_links','package_og_image_generate',
    'package_distribution_plan','package_campaign_assets_generate','package_email_sequence_enroll',
    'commerce_product_visibility_check','commerce_price_activation_check',
    'commerce_sellability_gate_check','commerce_audit_snapshot',
    'package_seo_backlog_expand','package_license_template_prepare','package_post_publish_audit_snapshot'
  ];
  v_jt text; v_enqueued int := 0; v_skipped int := 0; v_idem text; v_reg record;
BEGIN
  IF NOT (NEW.status='published' AND COALESCE(NEW.is_published,false)=true) THEN RETURN NEW; END IF;
  IF (OLD.status IS NOT DISTINCT FROM NEW.status) AND (OLD.is_published IS NOT DISTINCT FROM NEW.is_published) THEN RETURN NEW; END IF;
  IF (OLD.status='published' AND COALESCE(OLD.is_published,false)=true) THEN RETURN NEW; END IF;

  FOREACH v_jt IN ARRAY v_jobs LOOP
    v_idem := format('post_publish_growth:%s:%s', NEW.id, v_jt);
    SELECT lane,pool,requires_package_id INTO v_reg FROM public.ops_job_type_registry WHERE job_type=v_jt AND is_active=true LIMIT 1;
    IF NOT FOUND THEN v_skipped := v_skipped+1; CONTINUE; END IF;
    BEGIN
      INSERT INTO public.job_queue
        (job_type, job_name, lane, worker_pool, package_id, payload, status, idempotency_key, priority, meta)
      VALUES (v_jt, v_jt, v_reg.lane, COALESCE(v_reg.pool,'core'), NEW.id,
        jsonb_build_object('package_id',NEW.id,'curriculum_id',NEW.curriculum_id,'package_key',NEW.package_key,
                           'source','post_publish_growth_fanout','enqueue_source','post_publish_growth_fanout'),
        'pending', v_idem, 5, jsonb_build_object('source','post_publish_growth_fanout'));
      v_enqueued := v_enqueued+1;
    EXCEPTION WHEN unique_violation THEN v_skipped := v_skipped+1;
    END;
  END LOOP;

  INSERT INTO public.auto_heal_log(action_type,target_type,target_id,result_status,metadata)
  VALUES ('post_publish_orchestrator','course_package', NEW.id::text,'ok',
    jsonb_build_object('enqueued',v_enqueued,'skipped',v_skipped,'jobs',v_jobs,'version','v1'));
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE VIEW public.v_post_publish_readiness AS
WITH pkgs AS (
  SELECT cp.id AS package_id, cp.package_key, cp.title AS package_title,
         cp.curriculum_id, cp.published_at
    FROM course_packages cp
   WHERE cp.status='published' AND COALESCE(cp.is_published,false)=true
),
commerce AS (
  SELECT package_id, product_public, has_stripe_price, lesson_ready, is_sellable, gate_state
    FROM v_post_publish_commerce_status_ssot
),
seo AS (
  SELECT scpq.curriculum_id,
         COUNT(*) FILTER (WHERE scpq.generation_status IN ('queued','generating','generated','ready')) AS seo_backlog_rows,
         COUNT(*) FILTER (WHERE scpq.generation_status='generated') AS seo_done_rows
    FROM seo_content_priority_queue scpq
   GROUP BY scpq.curriculum_id
),
license AS (
  SELECT pr.curriculum_id,
         bool_or(pr.channel_policy_json IS NOT NULL AND pr.channel_policy_json <> '{}'::jsonb) AS has_license_template
    FROM products pr
   WHERE pr.curriculum_id IS NOT NULL AND pr.status='active'
   GROUP BY pr.curriculum_id
),
tracking AS (
  SELECT package_id,
         bool_or(event_type='pricing_view') AS has_pricing_view,
         bool_or(event_type='checkout_started') AS has_checkout_started
    FROM conversion_events
   WHERE created_at > now() - interval '30 days' AND package_id IS NOT NULL
   GROUP BY package_id
),
last_audit AS (
  SELECT DISTINCT ON (target_id) target_id::uuid AS package_id, created_at AS last_audit_at
    FROM auto_heal_log
   WHERE action_type IN ('post_publish_orchestrator','commerce_audit_snapshot','post_publish_growth_fanout')
     AND target_type='course_package'
   ORDER BY target_id, created_at DESC
)
SELECT
  p.package_id, p.package_key, p.package_title, p.curriculum_id, p.published_at,
  COALESCE(c.gate_state,'UNKNOWN') AS commerce_gate_state,
  COALESCE(c.is_sellable,false) AS is_sellable,
  COALESCE(c.product_public,false) AS product_public,
  COALESCE(c.has_stripe_price,false) AS has_stripe_price,
  COALESCE(c.lesson_ready,false) AS lesson_ready,
  COALESCE(s.seo_backlog_rows,0) AS seo_backlog_rows,
  COALESCE(s.seo_done_rows,0) AS seo_done_rows,
  (COALESCE(s.seo_backlog_rows,0)>0) AS seo_present,
  COALESCE(l.has_license_template,false) AS license_template_ready,
  COALESCE(t.has_pricing_view,false) AS tracking_pricing_view,
  COALESCE(t.has_checkout_started,false) AS tracking_checkout_started,
  la.last_audit_at,
  EXTRACT(EPOCH FROM (now() - p.published_at))/60 AS minutes_since_publish,
  CASE WHEN la.last_audit_at IS NOT NULL THEN EXTRACT(EPOCH FROM (now() - la.last_audit_at))/60
       ELSE EXTRACT(EPOCH FROM (now() - p.published_at))/60 END AS minutes_since_audit,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN NOT COALESCE(c.product_public,false)        THEN 'product_missing'           END,
    CASE WHEN NOT COALESCE(c.has_stripe_price,false)      THEN 'price_missing'             END,
    CASE WHEN NOT COALESCE(c.lesson_ready,false)          THEN 'lesson_gate_failed'        END,
    CASE WHEN NOT COALESCE(c.is_sellable,false)           THEN 'not_sellable'              END,
    CASE WHEN COALESCE(s.seo_backlog_rows,0)=0            THEN 'seo_missing'               END,
    CASE WHEN NOT COALESCE(t.has_pricing_view,false)      THEN 'tracking_missing'          END,
    CASE WHEN NOT COALESCE(l.has_license_template,false)  THEN 'license_template_missing'  END
  ], NULL) AS repair_reasons,
  CASE
    WHEN COALESCE(c.is_sellable,false) AND COALESCE(s.seo_backlog_rows,0)>0
     AND COALESCE(l.has_license_template,false) AND COALESCE(t.has_pricing_view,false)
    THEN 'READY'
    WHEN COALESCE(c.gate_state,'UNKNOWN') IN ('PRODUCT_MISSING','PRICE_MISSING','LESSON_GATE_FAILED')
    THEN 'COMMERCE_REPAIR_REQUIRED'
    WHEN NOT COALESCE(c.is_sellable,false) THEN 'NOT_SELLABLE'
    WHEN COALESCE(s.seo_backlog_rows,0)=0  THEN 'SEO_PENDING'
    ELSE 'PARTIAL'
  END AS readiness_state
FROM pkgs p
LEFT JOIN commerce  c ON c.package_id=p.package_id
LEFT JOIN seo       s ON s.curriculum_id=p.curriculum_id
LEFT JOIN license   l ON l.curriculum_id=p.curriculum_id
LEFT JOIN tracking  t ON t.package_id=p.package_id
LEFT JOIN last_audit la ON la.package_id=p.package_id;

REVOKE ALL ON public.v_post_publish_readiness FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_post_publish_readiness TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_post_publish_readiness(
  p_state_filter text DEFAULT NULL, p_limit int DEFAULT 200
) RETURNS SETOF v_post_publish_readiness
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
  SELECT * FROM public.v_post_publish_readiness
   WHERE (p_state_filter IS NULL OR readiness_state=p_state_filter)
   ORDER BY (readiness_state='READY'), minutes_since_publish DESC
   LIMIT GREATEST(1, LEAST(p_limit,1000));
END $$;
REVOKE ALL ON FUNCTION public.admin_get_post_publish_readiness(text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_post_publish_readiness(text,int) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_repair_post_publish_package(
  p_package_id uuid, p_repair_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_reasons text[]; v_reason text; v_jobs text[] := '{}';
  v_jt text; v_idem text; v_reg record; v_pkg record; v_enqueued int := 0;
  v_map jsonb := jsonb_build_object(
    'product_missing','commerce_repair_product_missing',
    'price_missing','commerce_repair_price_missing',
    'lesson_gate_failed','commerce_repair_lesson_gate_failed',
    'not_sellable','commerce_sellability_gate_check',
    'seo_missing','package_seo_backlog_expand',
    'tracking_missing','commerce_audit_snapshot',
    'license_template_missing','package_license_template_prepare'
  );
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT package_id, repair_reasons INTO v_pkg
    FROM public.v_post_publish_readiness WHERE package_id=p_package_id;
  IF v_pkg.package_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','package_not_published_or_unknown');
  END IF;
  v_reasons := CASE WHEN p_repair_reason IS NULL THEN v_pkg.repair_reasons ELSE ARRAY[p_repair_reason] END;

  FOREACH v_reason IN ARRAY COALESCE(v_reasons,'{}'::text[]) LOOP
    v_jt := v_map->>v_reason;
    IF v_jt IS NULL THEN CONTINUE; END IF;
    SELECT lane,pool INTO v_reg FROM public.ops_job_type_registry
     WHERE job_type=v_jt AND is_active=true LIMIT 1;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_idem := format('post_publish_repair:%s:%s:%s', p_package_id, v_reason,
                     to_char(date_trunc('hour',now()),'YYYYMMDDHH24'));
    BEGIN
      INSERT INTO public.job_queue
        (job_type, job_name, lane, worker_pool, package_id, payload, status, idempotency_key, priority, meta)
      VALUES (v_jt, v_jt, v_reg.lane, COALESCE(v_reg.pool,'core'), p_package_id,
        jsonb_build_object('package_id',p_package_id,
                           'curriculum_id',(SELECT curriculum_id FROM course_packages WHERE id=p_package_id),
                           'repair_reason',v_reason,'source','admin_repair_post_publish_package',
                           'enqueue_source','admin_repair_post_publish_package'),
        'pending', v_idem, 4,
        jsonb_build_object('source','admin_repair_post_publish_package','repair_reason',v_reason));
      v_enqueued := v_enqueued+1; v_jobs := array_append(v_jobs, v_jt);
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
  END LOOP;

  INSERT INTO public.auto_heal_log(action_type,target_type,target_id,result_status,metadata)
  VALUES ('post_publish_orchestrator','course_package', p_package_id::text,'ok',
    jsonb_build_object('mode','admin_repair','reasons',v_reasons,'jobs',v_jobs,'enqueued',v_enqueued));
  RETURN jsonb_build_object('ok',true,'package_id',p_package_id,'reasons',v_reasons,'jobs_enqueued',v_enqueued,'jobs',v_jobs);
END $$;
REVOKE ALL ON FUNCTION public.admin_repair_post_publish_package(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_repair_post_publish_package(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_detect_post_publish_sla_breach(p_sla_minutes int DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_breaches int := 0; v_repaired int := 0; v_row record; v_idem text;
BEGIN
  FOR v_row IN
    SELECT package_id, readiness_state, minutes_since_audit
      FROM public.v_post_publish_readiness
     WHERE minutes_since_audit > p_sla_minutes AND readiness_state <> 'READY'
     LIMIT 50
  LOOP
    v_breaches := v_breaches+1;
    v_idem := format('post_publish_sla:%s:%s', v_row.package_id, to_char(date_trunc('hour',now()),'YYYYMMDDHH24'));
    BEGIN
      INSERT INTO public.job_queue
        (job_type, job_name, lane, worker_pool, package_id, payload, status, idempotency_key, priority, meta)
      VALUES ('package_post_publish_audit_snapshot','package_post_publish_audit_snapshot',
              'growth','core', v_row.package_id,
              jsonb_build_object('package_id',v_row.package_id,'source','sla_breach_auto_repair',
                                 'enqueue_source','sla_breach_auto_repair'),
              'pending', v_idem, 4,
              jsonb_build_object('source','sla_breach','sla_minutes',p_sla_minutes,'state',v_row.readiness_state));
      v_repaired := v_repaired+1;
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
  END LOOP;

  INSERT INTO public.auto_heal_log(action_type,target_type,target_id,result_status,metadata)
  VALUES ('post_publish_orchestrator','system','sla_detector',
    CASE WHEN v_breaches=0 THEN 'noop' ELSE 'ok' END,
    jsonb_build_object('sla_minutes',p_sla_minutes,'breaches',v_breaches,'auto_repaired',v_repaired));
  RETURN jsonb_build_object('ok',true,'sla_minutes',p_sla_minutes,'breaches',v_breaches,'auto_repaired',v_repaired);
END $$;
REVOKE ALL ON FUNCTION public.fn_detect_post_publish_sla_breach(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_detect_post_publish_sla_breach(int) TO service_role;
