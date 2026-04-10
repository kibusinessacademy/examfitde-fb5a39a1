
CREATE OR REPLACE FUNCTION public.fn_go_live_gate()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb := '[]'::jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_checks jsonb := '[]'::jsonb;
  v_val record;
  v_count int;
  v_verdict text;
BEGIN
  -- CHECK 1: Pipeline zombies
  SELECT count(*) INTO v_count FROM job_queue 
  WHERE status = 'processing' AND updated_at < now() - interval '30 minutes';
  IF v_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('gate','pipeline_zombies','status','FAIL','message',format('%s zombie jobs',v_count));
  ELSE
    v_checks := v_checks || jsonb_build_object('gate','pipeline_zombies','status','PASS','message','0 zombie jobs');
  END IF;

  -- CHECK 2: Published integrity
  SELECT count(*) INTO v_count FROM course_packages 
  WHERE status='published' AND (integrity_passed IS NULL OR integrity_passed=false);
  IF v_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('gate','integrity_published','status','FAIL','message',format('%s without integrity',v_count));
  ELSE
    v_checks := v_checks || jsonb_build_object('gate','integrity_published','status','PASS','message','All published OK');
  END IF;

  -- CHECK 3: Open steps on published
  SELECT count(*) INTO v_count FROM package_steps ps
  JOIN course_packages cp ON cp.id=ps.package_id WHERE cp.status='published' AND ps.status NOT IN ('done','skipped');
  IF v_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('gate','open_steps','status','FAIL','message',format('%s open steps',v_count));
  ELSE
    v_checks := v_checks || jsonb_build_object('gate','open_steps','status','PASS','message','No open steps');
  END IF;

  -- CHECK 4: Stripe product mapping
  SELECT count(*) INTO v_count FROM store_products WHERE is_active=true AND (stripe_product_id IS NULL OR stripe_product_id='');
  IF v_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('gate','stripe_mapping','status','FAIL','message',format('%s products no Stripe ID',v_count));
  ELSE
    v_checks := v_checks || jsonb_build_object('gate','stripe_mapping','status','PASS','message','All linked');
  END IF;

  -- CHECK 5: Bundle unique product
  SELECT count(DISTINCT stripe_product_id) INTO v_count FROM store_products WHERE is_active=true;
  IF v_count < (SELECT count(*) FROM store_products WHERE is_active=true) THEN
    v_warnings := v_warnings || jsonb_build_object('gate','bundle_unique','status','WARN','message','Shared Stripe IDs');
  ELSE
    v_checks := v_checks || jsonb_build_object('gate','bundle_unique','status','PASS','message','Unique Stripe IDs');
  END IF;

  -- CHECK 6: Product-curriculum mapping
  SELECT count(*) INTO v_count FROM products p
  JOIN course_packages cp ON cp.id=p.active_package_id
  WHERE cp.status='published' AND p.curriculum_id IS NULL;
  IF v_count > 0 THEN
    v_warnings := v_warnings || jsonb_build_object('gate','product_curriculum','status','WARN','message',format('%s published no curriculum',v_count));
  ELSE
    v_checks := v_checks || jsonb_build_object('gate','product_curriculum','status','PASS','message','All mapped');
  END IF;

  -- CHECK 7: SEO coverage
  SELECT count(*) INTO v_count FROM seo_discovery_state WHERE is_indexable=true;
  IF v_count < 50 THEN
    v_warnings := v_warnings || jsonb_build_object('gate','seo_coverage','status','WARN','message',format('%s URLs',v_count));
  ELSE
    v_checks := v_checks || jsonb_build_object('gate','seo_coverage','status','PASS','message',format('%s URLs',v_count));
  END IF;

  -- CHECK 8: Exam pool via curriculum_id
  SELECT count(*) INTO v_count FROM course_packages cp
  JOIN courses c ON c.id=cp.course_id
  WHERE cp.status='published'
    AND c.curriculum_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM exam_questions eq WHERE eq.curriculum_id=c.curriculum_id AND eq.status='approved' LIMIT 1
    );
  IF v_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('gate','exam_pool','status','FAIL','message',format('%s packages 0 questions',v_count));
  ELSE
    v_checks := v_checks || jsonb_build_object('gate','exam_pool','status','PASS','message','All have questions');
  END IF;

  -- CHECK 9: Entitlement RPC
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname='can_access_product') THEN
    v_checks := v_checks || jsonb_build_object('gate','entitlement_rpc','status','PASS','message','RPC exists');
  ELSE
    v_blockers := v_blockers || jsonb_build_object('gate','entitlement_rpc','status','FAIL','message','RPC missing');
  END IF;

  -- CHECK 10: Failed jobs
  SELECT count(*) INTO v_count FROM job_queue WHERE status='failed';
  IF v_count > 10 THEN
    v_warnings := v_warnings || jsonb_build_object('gate','failed_jobs','status','WARN','message',format('%s failed',v_count));
  ELSE
    v_checks := v_checks || jsonb_build_object('gate','failed_jobs','status','PASS','message',format('%s failed',v_count));
  END IF;

  -- VERDICT
  IF jsonb_array_length(v_blockers) > 0 THEN v_verdict := 'NO_GO';
  ELSIF jsonb_array_length(v_warnings) > 0 THEN v_verdict := 'SOFT_GO';
  ELSE v_verdict := 'GO';
  END IF;

  RETURN jsonb_build_object(
    'verdict', v_verdict, 'checked_at', now(),
    'blocker_count', jsonb_array_length(v_blockers),
    'warning_count', jsonb_array_length(v_warnings),
    'pass_count', jsonb_array_length(v_checks),
    'blockers', v_blockers, 'warnings', v_warnings, 'passes', v_checks
  );
END;
$$;
