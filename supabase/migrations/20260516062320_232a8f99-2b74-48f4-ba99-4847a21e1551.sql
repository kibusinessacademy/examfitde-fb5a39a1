-- =============================================================================
-- Helper: service-role variant of seo backlog expand for one package
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fn_seo_backlog_expand_for_package(
  p_package_id uuid,
  p_audit_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_audit_id uuid := COALESCE(p_audit_id, gen_random_uuid());
  v_cur_id uuid;
  v_comp_id uuid;
  v_inserted int := 0;
  v_intents text[] := ARRAY['intent_pruefungsfragen','intent_lernplan','intent_typische_fehler','intent_durchfallquote'];
  v_skipped_reason text;
BEGIN
  SELECT curriculum_id INTO v_cur_id FROM public.course_packages WHERE id = p_package_id;
  IF v_cur_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'skipped_reason', 'package_or_curriculum_missing', 'package_id', p_package_id);
  END IF;

  -- Skip if curriculum already in queue
  IF EXISTS (SELECT 1 FROM public.seo_content_priority_queue q WHERE q.curriculum_id = v_cur_id) THEN
    RETURN jsonb_build_object('ok', true, 'skipped_reason', 'already_in_queue', 'curriculum_id', v_cur_id, 'inserted_rows', 0);
  END IF;

  SELECT cm.id INTO v_comp_id
  FROM public.competencies cm
  JOIN public.learning_fields lf ON lf.id = cm.learning_field_id
  WHERE lf.curriculum_id = v_cur_id
  ORDER BY lf.sort_order NULLS LAST, cm.sort_order NULLS LAST
  LIMIT 1;

  IF v_comp_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'skipped_reason', 'no_competency', 'curriculum_id', v_cur_id);
  END IF;

  WITH ins AS (
    INSERT INTO public.seo_content_priority_queue (
      curriculum_id, competency_id, intent_key, persona_type,
      cluster_priority, semrush_volume, thin_content_risk,
      generation_status, package_publish_eligible, notes
    )
    SELECT v_cur_id, v_comp_id, intent, 'azubi',
           6, 0, 'unknown', 'planned', true,
           'commerce_gate_sellable_pass|audit='||v_audit_id::text||'|pkg='||p_package_id::text
    FROM UNNEST(v_intents) AS intent
    ON CONFLICT (curriculum_id, competency_id, intent_key, persona_type) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM ins;

  RETURN jsonb_build_object('ok', true, 'inserted_rows', v_inserted, 'curriculum_id', v_cur_id, 'audit_id', v_audit_id);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_seo_backlog_expand_for_package(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_seo_backlog_expand_for_package(uuid, uuid) TO service_role;

-- =============================================================================
-- Internal helper to enqueue repair job idempotently
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fn_commerce_enqueue_repair(
  p_package_id uuid,
  p_repair_job_type text,
  p_reason text,
  p_audit_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_reg record;
  v_idem text;
  v_pkg record;
  v_id uuid;
BEGIN
  SELECT lane, pool INTO v_reg FROM public.ops_job_type_registry
    WHERE job_type = p_repair_job_type AND is_active = true LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT id, curriculum_id, package_key INTO v_pkg FROM public.course_packages WHERE id = p_package_id;
  v_idem := format('commerce_repair:%s:%s', p_package_id, p_repair_job_type);

  INSERT INTO public.job_queue (
    job_type, job_name, lane, worker_pool, package_id, payload, status, idempotency_key, priority, meta
  )
  VALUES (
    p_repair_job_type, p_repair_job_type, v_reg.lane, COALESCE(v_reg.pool, 'control'),
    p_package_id,
    jsonb_build_object(
      'package_id', p_package_id,
      'curriculum_id', v_pkg.curriculum_id,
      'package_key', v_pkg.package_key,
      'reason', p_reason,
      'source', 'commerce_gate',
      'enqueue_source', 'commerce_gate',
      'audit_id', p_audit_id
    ),
    'pending', v_idem, 5,
    jsonb_build_object('audit_id', p_audit_id, 'source', 'commerce_gate')
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_commerce_enqueue_repair(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_commerce_enqueue_repair(uuid, text, text, uuid) TO service_role;

-- =============================================================================
-- Gate 1: product visibility
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fn_commerce_product_visibility_check(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_audit_id uuid := gen_random_uuid();
  v_row record;
  v_repair_id uuid;
BEGIN
  SELECT * INTO v_row FROM public.v_post_publish_commerce_status_ssot WHERE package_id = p_package_id;
  IF NOT FOUND THEN
    INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
    VALUES ('commerce_product_visibility_check','course_package',p_package_id::text,'skipped',
      jsonb_build_object('audit_id',v_audit_id,'reason','not_in_ssot_view'));
    RETURN jsonb_build_object('ok',true,'result','skipped','reason','not_in_ssot_view');
  END IF;

  IF v_row.product_public THEN
    INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
    VALUES ('commerce_product_visibility_check','course_package',p_package_id::text,'ok',
      jsonb_build_object('audit_id',v_audit_id,'result','PASS'));
    RETURN jsonb_build_object('ok',true,'result','PASS','audit_id',v_audit_id);
  END IF;

  v_repair_id := public.fn_commerce_enqueue_repair(p_package_id,'commerce_repair_product_missing','PRODUCT_MISSING',v_audit_id);
  INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
  VALUES ('commerce_product_visibility_check','course_package',p_package_id::text,'fail',
    jsonb_build_object('audit_id',v_audit_id,'result','FAIL','reason','PRODUCT_MISSING','repair_job_id',v_repair_id));
  RETURN jsonb_build_object('ok',true,'result','FAIL','reason','PRODUCT_MISSING','repair_job_id',v_repair_id,'audit_id',v_audit_id);
END;
$$;

-- =============================================================================
-- Gate 2: price activation
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fn_commerce_price_activation_check(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_audit_id uuid := gen_random_uuid();
  v_row record;
  v_repair_id uuid;
BEGIN
  SELECT * INTO v_row FROM public.v_post_publish_commerce_status_ssot WHERE package_id = p_package_id;
  IF NOT FOUND THEN
    INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
    VALUES ('commerce_price_activation_check','course_package',p_package_id::text,'skipped',
      jsonb_build_object('audit_id',v_audit_id,'reason','not_in_ssot_view'));
    RETURN jsonb_build_object('ok',true,'result','skipped');
  END IF;

  IF NOT v_row.product_public THEN
    INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
    VALUES ('commerce_price_activation_check','course_package',p_package_id::text,'skipped',
      jsonb_build_object('audit_id',v_audit_id,'reason','upstream_PRODUCT_MISSING'));
    RETURN jsonb_build_object('ok',true,'result','skipped','reason','upstream_PRODUCT_MISSING');
  END IF;

  IF v_row.has_stripe_price THEN
    INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
    VALUES ('commerce_price_activation_check','course_package',p_package_id::text,'ok',
      jsonb_build_object('audit_id',v_audit_id,'result','PASS'));
    RETURN jsonb_build_object('ok',true,'result','PASS','audit_id',v_audit_id);
  END IF;

  v_repair_id := public.fn_commerce_enqueue_repair(p_package_id,'commerce_repair_price_missing','PRICE_MISSING',v_audit_id);
  INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
  VALUES ('commerce_price_activation_check','course_package',p_package_id::text,'fail',
    jsonb_build_object('audit_id',v_audit_id,'result','FAIL','reason','PRICE_MISSING','repair_job_id',v_repair_id));
  RETURN jsonb_build_object('ok',true,'result','FAIL','reason','PRICE_MISSING','repair_job_id',v_repair_id,'audit_id',v_audit_id);
END;
$$;

-- =============================================================================
-- Gate 3: sellability + SEO/CRM downstream fanout on PASS
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fn_commerce_sellability_gate_check(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_audit_id uuid := gen_random_uuid();
  v_row record;
  v_repair_id uuid;
  v_seo jsonb;
  v_reason text;
BEGIN
  SELECT * INTO v_row FROM public.v_post_publish_commerce_status_ssot WHERE package_id = p_package_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',true,'result','skipped','reason','not_in_ssot_view');
  END IF;

  IF v_row.is_sellable THEN
    v_seo := public.fn_seo_backlog_expand_for_package(p_package_id, v_audit_id);
    INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
    VALUES ('commerce_sellability_gate_check','course_package',p_package_id::text,'ok',
      jsonb_build_object(
        'audit_id',v_audit_id,'result','PASS',
        'seo_backlog_expand', v_seo,
        'crm_product_sync','TODO_no_infra'
      ));
    RETURN jsonb_build_object('ok',true,'result','PASS','audit_id',v_audit_id,'seo_backlog_expand',v_seo);
  END IF;

  -- FAIL routing
  IF NOT v_row.product_public THEN
    v_reason := 'PRODUCT_MISSING';
    v_repair_id := public.fn_commerce_enqueue_repair(p_package_id,'commerce_repair_product_missing',v_reason,v_audit_id);
  ELSIF NOT v_row.has_stripe_price THEN
    v_reason := 'PRICE_MISSING';
    v_repair_id := public.fn_commerce_enqueue_repair(p_package_id,'commerce_repair_price_missing',v_reason,v_audit_id);
  ELSIF NOT v_row.lesson_ready THEN
    v_reason := 'LESSON_GATE_FAILED';
    v_repair_id := public.fn_commerce_enqueue_repair(p_package_id,'commerce_repair_lesson_gate_failed',v_reason,v_audit_id);
  ELSE
    v_reason := 'NOT_SELLABLE_OTHER';
  END IF;

  INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
  VALUES ('commerce_sellability_gate_check','course_package',p_package_id::text,'fail',
    jsonb_build_object('audit_id',v_audit_id,'result','FAIL','reason',v_reason,'repair_job_id',v_repair_id));
  RETURN jsonb_build_object('ok',true,'result','FAIL','reason',v_reason,'repair_job_id',v_repair_id,'audit_id',v_audit_id);
END;
$$;

-- =============================================================================
-- Gate 4: audit snapshot
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fn_commerce_audit_snapshot(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_audit_id uuid := gen_random_uuid();
  v_row jsonb;
BEGIN
  SELECT to_jsonb(t) INTO v_row FROM public.v_post_publish_commerce_status_ssot t WHERE t.package_id = p_package_id;
  INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
  VALUES ('commerce_audit_snapshot','course_package',p_package_id::text,
    CASE WHEN v_row IS NULL THEN 'skipped' ELSE 'ok' END,
    jsonb_build_object('audit_id',v_audit_id,'snapshot',COALESCE(v_row,'null'::jsonb)));
  RETURN jsonb_build_object('ok',true,'audit_id',v_audit_id,'snapshot',v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_commerce_product_visibility_check(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_commerce_price_activation_check(uuid)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_commerce_sellability_gate_check(uuid)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_commerce_audit_snapshot(uuid)           FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_commerce_product_visibility_check(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_commerce_price_activation_check(uuid)   TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_commerce_sellability_gate_check(uuid)   TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_commerce_audit_snapshot(uuid)           TO service_role;

-- =============================================================================
-- Phase 4: extend fanout (add 4 commerce gate jobs to existing growth fanout)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fn_post_publish_growth_fanout()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'package_email_sequence_enroll',
    -- Commerce Gate (v1, 2026-05-16):
    'commerce_product_visibility_check',
    'commerce_price_activation_check',
    'commerce_sellability_gate_check',
    'commerce_audit_snapshot'
  ];
  v_jt text;
  v_enqueued int := 0;
  v_skipped int := 0;
  v_idem text;
  v_reg record;
BEGIN
  IF NOT (NEW.status = 'published' AND COALESCE(NEW.is_published, false) = true) THEN
    RETURN NEW;
  END IF;
  IF (OLD.status IS NOT DISTINCT FROM NEW.status)
     AND (OLD.is_published IS NOT DISTINCT FROM NEW.is_published) THEN
    RETURN NEW;
  END IF;
  IF (OLD.status = 'published' AND COALESCE(OLD.is_published, false) = true) THEN
    RETURN NEW;
  END IF;

  FOREACH v_jt IN ARRAY v_jobs LOOP
    v_idem := format('post_publish_growth:%s:%s', NEW.id, v_jt);
    SELECT lane, pool, requires_package_id INTO v_reg
      FROM public.ops_job_type_registry
     WHERE job_type = v_jt AND is_active = true LIMIT 1;
    IF NOT FOUND THEN v_skipped := v_skipped + 1; CONTINUE; END IF;

    BEGIN
      INSERT INTO public.job_queue
        (job_type, job_name, lane, worker_pool, package_id, payload, status, idempotency_key, priority, meta)
      VALUES
        (v_jt, v_jt, v_reg.lane, COALESCE(v_reg.pool, 'core'),
         NEW.id,
         jsonb_build_object(
           'package_id', NEW.id,
           'curriculum_id', NEW.curriculum_id,
           'package_key', NEW.package_key,
           'source', 'post_publish_growth_fanout',
           'enqueue_source', 'post_publish_growth_fanout'
         ),
         'pending', v_idem, 5,
         jsonb_build_object('source', 'post_publish_growth_fanout'));
      v_enqueued := v_enqueued + 1;
    EXCEPTION WHEN unique_violation THEN
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
  VALUES ('post_publish_growth_fanout','course_package',NEW.id::text,'ok',
    jsonb_build_object('enqueued',v_enqueued,'skipped',v_skipped,'jobs',v_jobs));

  RETURN NEW;
END;
$function$;