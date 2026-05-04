DO $$
DECLARE v_pkg uuid; v_failed_qc uuid[] := ARRAY[
    '163b33c0-2d1b-4eb0-bb6b-d3b4bf10eac6','351260d4-4351-4c0a-8593-10b2ab163e45',
    '4866a5b0-1430-4ab3-825b-141605d99612','586c6a12-3042-46d2-8981-5d7645b2cbf6',
    'eebb9776-4634-4118-8f53-9329c5018e66']::uuid[]; r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  BEGIN PERFORM public.admin_heal_failed_quality_councils(); EXCEPTION WHEN OTHERS THEN NULL; END;
  FOREACH v_pkg IN ARRAY v_failed_qc LOOP
    BEGIN PERFORM public.admin_step_reset_detailed(v_pkg, ARRAY['quality_council']::text[],
      'dag_blocked_failed_parent_heal_2026_05_04','manual_dag_unblock', true);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;
  BEGIN PERFORM public.admin_step_reset_detailed('55edacdf-5230-4e9a-b9c1-dcde00b8cd47'::uuid,
    ARRAY['validate_tutor_index']::text[],'dag_blocked_failed_parent_heal_2026_05_04','manual_dag_unblock',true);
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM public.admin_step_reset_detailed('4ee66313-e8e7-4c82-9b08-3e2c7b10c9ef'::uuid,
    ARRAY['generate_oral_exam']::text[],'dag_blocked_failed_parent_heal_2026_05_04','manual_dag_unblock',true);
  EXCEPTION WHEN OTHERS THEN NULL; END;
  r := public.admin_heal_pending_enqueue_drift(ARRAY[
      '41b8c6db-059b-44ff-986b-5d2e7f212a0c','56aee54d-5fd6-4f18-90c0-c6f7f493618a',
      '5d74dcbf-8ae7-4c82-b181-09e23f02dd2c','96d0fb31-9951-408d-a83e-b2937f5a6af8',
      'a02cde5e-a0ad-45fc-a5db-ffe239d387f5','a9f19137-a004-4850-838a-bdc8f8a705f5',
      'd2000001-0009-4000-8000-000000000001']::uuid[],
    'dag_blocked_parents_no_active_job_manual_heal_2026_05_04', false);
  INSERT INTO public.auto_heal_log (trigger_source,action_type,target_id,target_type,input_params,result_status,result_detail)
  VALUES ('manual_migration','dag_blocked_bulk_heal_2026_05_04','system','system',
          jsonb_build_object('packages_failed_qc',v_failed_qc),'success', COALESCE(r::text,'{}'));
END $$;

CREATE OR REPLACE FUNCTION public.trg_block_publish_without_product()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE v_pkg_id uuid; v_product_id uuid;
BEGIN
  IF NEW.job_type IN ('package_auto_publish','package_publish') THEN
    v_pkg_id := COALESCE(NEW.package_id, (NEW.payload->>'package_id')::uuid);
    IF v_pkg_id IS NOT NULL THEN
      SELECT product_id INTO v_product_id FROM public.course_packages WHERE id=v_pkg_id;
      IF v_product_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.products WHERE id=v_product_id) THEN
        RAISE EXCEPTION 'BLOCKED_PUBLISH_NO_PRODUCT: package % has no valid product_id (job_type=%)', v_pkg_id, NEW.job_type
          USING ERRCODE='check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_block_publish_without_product ON public.job_queue;
CREATE TRIGGER trg_block_publish_without_product BEFORE INSERT ON public.job_queue
  FOR EACH ROW EXECUTE FUNCTION public.trg_block_publish_without_product();

INSERT INTO public.heal_permanent_fix_tasks (pattern_key, cluster, package_id, priority, title, description, status, notes, created_by)
SELECT 'PRICING_NO_PRODUCT_LINK','pricing_governance', cp.id,'high',
  'Seed-Paket ohne Produkt: '|| cp.title,
  'Paket '||cp.title||' ('||cp.id||') hat keinen product_id-Link.','open',
  'In products Zeile anlegen (slug=package_key), course_packages.product_id setzen, dann fn_backfill_default_pricing_for_building.',
  '00000000-0000-0000-0000-000000000000'::uuid
FROM public.course_packages cp
WHERE cp.product_id IS NULL AND cp.status='queued'
ON CONFLICT DO NOTHING;