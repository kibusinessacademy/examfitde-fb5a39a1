
CREATE OR REPLACE FUNCTION public.fn_e2e_integrity_guard(p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seo_healed int := 0;
  v_pricing_safe int := 0;
  v_alerts_created int := 0;
  v_funnel_mapping_logged int := 0;
  v_total_red int := 0;
  v_total_yellow int := 0;
  v_started timestamptz := clock_timestamp();
  rec record;
BEGIN
  FOR rec IN
    SELECT * FROM public.v_package_e2e_integrity WHERE e2e_status <> 'green'
  LOOP
    IF rec.e2e_status = 'red' THEN v_total_red := v_total_red + 1;
    ELSE v_total_yellow := v_total_yellow + 1; END IF;

    -- AUTO-HEAL: SEO drafts → published
    IF (rec.heal_flags->>'seo_publish_drafts')::boolean THEN
      IF NOT p_dry_run THEN
        UPDATE public.seo_content_pages
           SET status = 'published', updated_at = now()
         WHERE package_id = rec.package_id AND status = 'draft';
      END IF;
      v_seo_healed := v_seo_healed + 1;
      INSERT INTO public.auto_heal_log (trigger_source, action_type, target_type, target_id, result_status, result_detail, input_params, metadata)
      VALUES ('e2e_integrity_guard',
              CASE WHEN p_dry_run THEN 'e2e_seo_publish_drafts_dryrun' ELSE 'e2e_seo_publish_drafts' END,
              'course_package', rec.package_id::text, 'success',
              format('Published %s SEO draft(s) for %s', rec.seo_draft_count, rec.package_title),
              jsonb_build_object('dry_run', p_dry_run, 'draft_count', rec.seo_draft_count),
              jsonb_build_object('certification_id', rec.certification_id, 'e2e_status', rec.e2e_status));
    END IF;

    -- SAFE-CLASSIFY pricing (no apply)
    IF (rec.heal_flags->>'pricing_create')::boolean THEN
      v_pricing_safe := v_pricing_safe + 1;
      INSERT INTO public.auto_heal_log (trigger_source, action_type, target_type, target_id, result_status, result_detail, input_params, metadata)
      VALUES ('e2e_integrity_guard', 'e2e_pricing_safe_to_apply', 'course_package', rec.package_id::text,
              'pending_admin',
              format('Eindeutige Tier-Klassifikation (%s, hoch) — bereit für admin pricing-backfill', rec.suggested_tier),
              jsonb_build_object('dry_run', p_dry_run, 'suggested_tier', rec.suggested_tier),
              jsonb_build_object('certification_id', rec.certification_id));
    END IF;

    -- ALERT: only true blockers (Pricing ambig, Duplicate Product, SEO completely missing)
    IF (rec.heal_flags->>'manual_pricing')::boolean
       OR (rec.heal_flags->>'manual_duplicate_product')::boolean
       OR (rec.heal_flags->>'manual_seo_missing')::boolean
    THEN
      IF NOT p_dry_run THEN
        INSERT INTO public.admin_notifications (title, body, category, severity, entity_type, entity_id, metadata)
        VALUES (
          format('E2E-Drift: %s', rec.package_title),
          format('Pipeline-Status %s. Manuell: %s%s%s',
            rec.e2e_status,
            CASE WHEN (rec.heal_flags->>'manual_pricing')::boolean THEN '[Pricing mehrdeutig] ' ELSE '' END,
            CASE WHEN (rec.heal_flags->>'manual_duplicate_product')::boolean THEN '[Doppelte Produkte] ' ELSE '' END,
            CASE WHEN (rec.heal_flags->>'manual_seo_missing')::boolean THEN '[SEO-Seite fehlt komplett] ' ELSE '' END
          ),
          'e2e_integrity', rec.e2e_status,
          'course_package', rec.package_id,
          jsonb_build_object(
            'heal_flags', rec.heal_flags, 'product_count', rec.product_count,
            'pricing_status', rec.pricing_status, 'seo_status', rec.seo_status,
            'funnel_mapping_status', rec.funnel_mapping_status,
            'suggested_tier', rec.suggested_tier, 'tier_confidence', rec.tier_confidence,
            'guard_run_at', now()
          )
        );
      END IF;
      v_alerts_created := v_alerts_created + 1;
    END IF;

    -- FUNNEL MAPPING missing → soft-log only (Code/Mapping-decision, never alert spam)
    IF (rec.heal_flags->>'manual_funnel_mapping')::boolean THEN
      v_funnel_mapping_logged := v_funnel_mapping_logged + 1;
      INSERT INTO public.auto_heal_log (trigger_source, action_type, target_type, target_id, result_status, result_detail, input_params, metadata)
      VALUES ('e2e_integrity_guard', 'e2e_funnel_mapping_missing', 'course_package', rec.package_id::text,
              'noop_observed',
              format('Funnel-Tracking-Mapping fehlt für %s — Code/Mapping-Entscheidung, kein Alert', rec.package_title),
              jsonb_build_object('dry_run', p_dry_run),
              jsonb_build_object('certification_id', rec.certification_id, 'e2e_status', rec.e2e_status));
    END IF;
  END LOOP;

  INSERT INTO public.auto_heal_log (trigger_source, action_type, target_type, target_id, result_status, result_detail, input_params, metadata, duration_ms)
  VALUES ('e2e_integrity_guard', 'e2e_guard_run_summary', 'platform', 'global', 'success',
          format('seo_healed=%s pricing_safe=%s alerts=%s mapping_logged=%s red=%s yellow=%s',
                 v_seo_healed, v_pricing_safe, v_alerts_created, v_funnel_mapping_logged, v_total_red, v_total_yellow),
          jsonb_build_object('dry_run', p_dry_run),
          jsonb_build_object('seo_healed', v_seo_healed, 'pricing_safe', v_pricing_safe,
                             'alerts_created', v_alerts_created, 'funnel_mapping_logged', v_funnel_mapping_logged,
                             'red', v_total_red, 'yellow', v_total_yellow),
          (EXTRACT(EPOCH FROM (clock_timestamp() - v_started)) * 1000)::int);

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'seo_drafts_published', v_seo_healed,
    'pricing_safe_to_apply', v_pricing_safe,
    'admin_alerts_created', v_alerts_created,
    'funnel_mapping_logged', v_funnel_mapping_logged,
    'total_red', v_total_red, 'total_yellow', v_total_yellow,
    'duration_ms', (EXTRACT(EPOCH FROM (clock_timestamp() - v_started)) * 1000)::int,
    'checked_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_e2e_integrity_guard(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_e2e_integrity_guard(boolean) TO service_role;
