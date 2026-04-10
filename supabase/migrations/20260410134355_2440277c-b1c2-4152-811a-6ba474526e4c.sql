
-- Fix Bundle: assign dedicated Stripe product ID
UPDATE public.store_products 
SET stripe_product_id = 'prod_UJHudZJaCcCl73'
WHERE product_key = 'bundle';

-- Create Go-Live Gate function
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
  -- CHECK 1: Pipeline - no zombie/stuck jobs
  SELECT count(*) INTO v_count FROM job_queue 
  WHERE status = 'processing' 
    AND updated_at < now() - interval '30 minutes';
  IF v_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_object(
      'gate', 'pipeline_zombies', 'status', 'FAIL',
      'message', format('%s zombie jobs (processing > 30min)', v_count));
  ELSE
    v_checks := v_checks || jsonb_build_object(
      'gate', 'pipeline_zombies', 'status', 'PASS', 'message', '0 zombie jobs');
  END IF;

  -- CHECK 2: All published packages have integrity
  SELECT count(*) INTO v_count FROM course_packages 
  WHERE status = 'published' AND (integrity_passed IS NULL OR integrity_passed = false);
  IF v_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_object(
      'gate', 'integrity_published', 'status', 'FAIL',
      'message', format('%s published packages without integrity', v_count));
  ELSE
    v_checks := v_checks || jsonb_build_object(
      'gate', 'integrity_published', 'status', 'PASS', 'message', 'All published packages have integrity');
  END IF;

  -- CHECK 3: Published packages have no open steps
  SELECT count(*) INTO v_count FROM package_steps ps
  JOIN course_packages cp ON cp.id = ps.package_id
  WHERE cp.status = 'published' AND ps.status NOT IN ('done', 'skipped');
  IF v_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_object(
      'gate', 'open_steps_published', 'status', 'FAIL',
      'message', format('%s open steps on published packages', v_count));
  ELSE
    v_checks := v_checks || jsonb_build_object(
      'gate', 'open_steps_published', 'status', 'PASS', 'message', 'No open steps on published packages');
  END IF;

  -- CHECK 4: Store products have stripe_product_id
  SELECT count(*) INTO v_count FROM store_products 
  WHERE is_active = true AND (stripe_product_id IS NULL OR stripe_product_id = '');
  IF v_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_object(
      'gate', 'stripe_product_mapping', 'status', 'FAIL',
      'message', format('%s active store products without Stripe ID', v_count));
  ELSE
    v_checks := v_checks || jsonb_build_object(
      'gate', 'stripe_product_mapping', 'status', 'PASS', 'message', 'All store products linked to Stripe');
  END IF;

  -- CHECK 5: Bundle has unique Stripe product (not shared)
  SELECT count(DISTINCT stripe_product_id) INTO v_count FROM store_products WHERE is_active = true;
  IF v_count < (SELECT count(*) FROM store_products WHERE is_active = true) THEN
    v_warnings := v_warnings || jsonb_build_object(
      'gate', 'bundle_unique_product', 'status', 'WARN',
      'message', 'Some store products share the same Stripe product ID');
  ELSE
    v_checks := v_checks || jsonb_build_object(
      'gate', 'bundle_unique_product', 'status', 'PASS', 'message', 'Each product has unique Stripe ID');
  END IF;

  -- CHECK 6: Products with published packages have curriculum_id
  SELECT count(*) INTO v_count FROM products p
  JOIN course_packages cp ON cp.id = p.active_package_id
  WHERE cp.status = 'published' AND p.curriculum_id IS NULL;
  IF v_count > 0 THEN
    v_warnings := v_warnings || jsonb_build_object(
      'gate', 'product_curriculum_mapping', 'status', 'WARN',
      'message', format('%s published products without curriculum_id', v_count));
  ELSE
    v_checks := v_checks || jsonb_build_object(
      'gate', 'product_curriculum_mapping', 'status', 'PASS', 'message', 'All published products mapped to curricula');
  END IF;

  -- CHECK 7: SEO discovery coverage
  SELECT count(*) INTO v_count FROM seo_discovery_state WHERE is_indexable = true;
  IF v_count < 50 THEN
    v_warnings := v_warnings || jsonb_build_object(
      'gate', 'seo_coverage', 'status', 'WARN',
      'message', format('Only %s indexable URLs in SEO discovery', v_count));
  ELSE
    v_checks := v_checks || jsonb_build_object(
      'gate', 'seo_coverage', 'status', 'PASS', 
      'message', format('%s indexable URLs in SEO discovery', v_count));
  END IF;

  -- CHECK 8: Exam pool - published packages have questions
  SELECT count(*) INTO v_count FROM course_packages cp
  WHERE cp.status = 'published'
    AND NOT EXISTS (
      SELECT 1 FROM exam_questions eq WHERE eq.package_id = cp.id AND eq.status = 'approved' LIMIT 1
    );
  IF v_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_object(
      'gate', 'exam_pool_coverage', 'status', 'FAIL',
      'message', format('%s published packages with 0 approved questions', v_count));
  ELSE
    v_checks := v_checks || jsonb_build_object(
      'gate', 'exam_pool_coverage', 'status', 'PASS', 'message', 'All published packages have exam questions');
  END IF;

  -- CHECK 9: Entitlement system - function exists
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'can_access_product') THEN
    v_checks := v_checks || jsonb_build_object(
      'gate', 'entitlement_rpc', 'status', 'PASS', 'message', 'can_access_product RPC exists');
  ELSE
    v_blockers := v_blockers || jsonb_build_object(
      'gate', 'entitlement_rpc', 'status', 'FAIL', 'message', 'can_access_product RPC missing');
  END IF;

  -- CHECK 10: Failed jobs backlog
  SELECT count(*) INTO v_count FROM job_queue WHERE status = 'failed';
  IF v_count > 10 THEN
    v_warnings := v_warnings || jsonb_build_object(
      'gate', 'failed_jobs_backlog', 'status', 'WARN',
      'message', format('%s failed jobs in queue', v_count));
  ELSE
    v_checks := v_checks || jsonb_build_object(
      'gate', 'failed_jobs_backlog', 'status', 'PASS',
      'message', format('%s failed jobs (acceptable)', v_count));
  END IF;

  -- VERDICT
  IF jsonb_array_length(v_blockers) > 0 THEN
    v_verdict := 'NO_GO';
  ELSIF jsonb_array_length(v_warnings) > 0 THEN
    v_verdict := 'SOFT_GO';
  ELSE
    v_verdict := 'GO';
  END IF;

  RETURN jsonb_build_object(
    'verdict', v_verdict,
    'checked_at', now(),
    'blocker_count', jsonb_array_length(v_blockers),
    'warning_count', jsonb_array_length(v_warnings),
    'pass_count', jsonb_array_length(v_checks),
    'blockers', v_blockers,
    'warnings', v_warnings,
    'passes', v_checks
  );
END;
$$;
